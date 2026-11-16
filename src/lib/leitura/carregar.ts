import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";
import { inicioDoDia } from "@/lib/formato";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { caminho } from "@/lib/clarity/campanha";
import { carregarMetas } from "@/lib/campanhas/metas";
import { contarIniciados } from "@/lib/vendas/iniciados";
import { efeitoDoMarco, marcosDeOperacoes, marcosDePagina, type GastoAnuncioDia, type OperacaoMeta, type TestePagina } from "./marcos";
import { lerCampanha, type AnuncioResumo, type DiaCampanha, type DiaClarity, type Leitura } from "./modelo";

// Junta, com o cliente da sessão (RLS de membro), os números que a leitura da campanha usa: mídia por
// dia, leads e testes pelo dia do cadastro, totais por anúncio, testes em andamento e o Clarity. As mudanças
// feitas na campanha (operacoes_meta, que o RLS só mostra a gestor) vêm pelo servidor: viram marcos com rótulo,
// sem dado pessoal, e quem só lê também precisa ver o que mudou.

const JANELA_DIAS = 30;

interface Org {
  id: string;
  fuso: string;
  moeda: string;
  funil: Funil;
  dias_teste?: number | null;
}

const diaNoFuso = (iso: string, fuso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: fuso });
const horaNoFuso = (iso: string, fuso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).replace(":", "h");
const n = (v: unknown) => Number(v) || 0;
/** Começo de hoje no fuso da organização (ISO). */
const inicioHoje = (fuso: string) => inicioDoDia(diaNoFuso(new Date().toISOString(), fuso), fuso);

/** Métricas do total do site numa coleta diária do Clarity (nomes como a API devolve). */
function diaClarity(dia: string, metricas: Array<{ metrica: string; valores: Record<string, unknown> }>): DiaClarity {
  const de = (nome: string, campo: string) => {
    const v = metricas.find((m) => m.metrica.replace(/\s/g, "").toLowerCase() === nome.toLowerCase())?.valores?.[campo];
    return typeof v === "number" ? v : null;
  };
  return {
    dia,
    sessoes: de("Traffic", "totalSessionCount"),
    rolagem: de("ScrollDepth", "averageScrollDepth"),
    tempoAtivo: de("EngagementTime", "activeTime"),
    voltaRapida: de("QuickbackClick", "sessionsWithMetricPercentage"),
    cliqueMorto: de("DeadClickCount", "sessionsWithMetricPercentage"),
    cliqueRaiva: de("RageClickCount", "sessionsWithMetricPercentage"),
    erroScript: de("ScriptErrorCount", "sessionsWithMetricPercentage"),
  };
}

export async function carregarLeitura(supabase: SupabaseClient, org: Org, campanhaId: string): Promise<Leitura> {
  const hoje = diaNoFuso(new Date().toISOString(), org.fuso);
  const inicio = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();
  const deDia = diaNoFuso(inicio, org.fuso);

  const [{ data: midia }, { data: porAnuncio }, { data: leads }, { data: coletas }, { count: conexoesClarity }, { data: ops }, { data: lidos }, { data: pagas }, metas, iniciados] = await Promise.all([
    supabase
      .from("meta_campanha_dia")
      .select("dia, gasto, impressoes, frequencia, cliques_link, visualizacoes_pagina, leads, sincronizado_em")
      .eq("organizacao_id", org.id)
      .eq("campaign_id", campanhaId)
      .gte("dia", deDia)
      .order("dia"),
    supabase.from("meta_anuncio_dia").select("dia, ad_id, ad_name, gasto, impressoes, leads").eq("organizacao_id", org.id).eq("campaign_id", campanhaId).gte("dia", deDia),
    supabase
      .from("leads")
      .select("ad_id, criado_em, teste_iniciado_em, teste_cancelado_em, primeiro_pagamento_em")
      .eq("organizacao_id", org.id)
      .eq("campaign_id", campanhaId)
      .is("codigo_teste", null)
      .gte("criado_em", inicio),
    supabase
      .from("clarity_coletas")
      .select("dia, clarity_metricas(metrica, valores)")
      .eq("organizacao_id", org.id)
      .not("dia", "is", null)
      .eq("dimensoes", "{}")
      .gte("dia", deDia)
      .order("dia"),
    supabase.from("conexoes").select("id", { count: "exact", head: true }).eq("organizacao_id", org.id).eq("tipo", "clarity").eq("status", "ativa"),
    criarClienteAdmin()
      .from("operacoes_meta")
      .select("criado_em, caminho, parametros, status_http, resposta, usuario_id")
      .eq("organizacao_id", org.id)
      .eq("meta_campaign_id", campanhaId)
      .eq("validacao", false)
      .gte("criado_em", inicio)
      .order("criado_em"),
    supabase.from("meta_anuncios").select("ad_id, nome, adset_id, adset_name, titulo, texto, status, destinos").eq("organizacao_id", org.id).eq("campaign_id", campanhaId),
    // Vendas pagas ligadas a cada anúncio (o anúncio da venda, ou o do cadastro de origem).
    supabase.from("vendas_atribuidas").select("ad_id").eq("organizacao_id", org.id).eq("campaign_id", campanhaId).eq("tipo", "pagamento").gte("ocorrida_em", inicio),
    carregarMetas(supabase, org.id, campanhaId),
    // Só dias completos: o começo de hoje (no fuso) fica de fora, como no resto da leitura.
    contarIniciados(supabase, org.id, { desde: inicio, campanha: campanhaId, ate: inicioHoje(org.fuso) }),
  ]);

  // Mídia por dia (somando contas) + leads e testes pelo dia do cadastro.
  const dias = new Map<string, DiaCampanha>();
  const diaVazio = (dia: string): DiaCampanha => ({ dia, gasto: 0, impressoes: 0, frequencia: 0, cliques_link: 0, visualizacoes_pagina: 0, leads_meta: 0, leads: 0, testes: 0 });
  let sincronizado: string | null = null;
  for (const m of midia ?? []) {
    const d = dias.get(m.dia) ?? diaVazio(m.dia);
    const impressoes = n(m.impressoes);
    d.frequencia = d.impressoes + impressoes ? (d.frequencia * d.impressoes + n(m.frequencia) * impressoes) / (d.impressoes + impressoes) : 0;
    d.gasto += n(m.gasto);
    d.impressoes += impressoes;
    d.cliques_link += n(m.cliques_link);
    d.visualizacoes_pagina += n(m.visualizacoes_pagina);
    d.leads_meta += n(m.leads);
    dias.set(m.dia, d);
    if (!sincronizado || m.sincronizado_em > sincronizado) sincronizado = m.sincronizado_em;
  }
  for (const l of leads ?? []) {
    const dia = diaNoFuso(l.criado_em, org.fuso);
    const d = dias.get(dia) ?? diaVazio(dia);
    d.leads += 1;
    if (l.teste_iniciado_em) d.testes += 1;
    dias.set(dia, d);
  }

  // Totais por anúncio na janela.
  const anuncios = new Map<string, AnuncioResumo>();
  const anuncio = (id: string, nome?: string | null) => {
    const a = anuncios.get(id) ?? { ad_id: id, nome: nome ?? id, gasto: 0, impressoes: 0, leads_meta: 0, leads: 0, testes: 0 };
    if (nome) a.nome = nome;
    anuncios.set(id, a);
    return a;
  };
  for (const m of porAnuncio ?? []) {
    const a = anuncio(m.ad_id, m.ad_name);
    a.gasto += n(m.gasto);
    a.impressoes += n(m.impressoes);
    a.leads_meta += n(m.leads);
  }
  for (const l of leads ?? []) {
    if (!l.ad_id) continue;
    const a = anuncio(l.ad_id);
    a.leads += 1;
    if (l.teste_iniciado_em) a.testes += 1;
  }

  // Marcos: cada mudança feita na campanha, com o antes e depois (gasto por anúncio e cadastros por dia).
  const gastos: GastoAnuncioDia[] = (porAnuncio ?? []).map((m) => ({ dia: m.dia as string, ad_id: m.ad_id, gasto: n(m.gasto) }));
  const resultados = [...dias.values()].map((d) => ({ dia: d.dia, gasto: d.gasto, leads: d.leads, visitas: d.visualizacoes_pagina, leadsMeta: d.leads_meta }));
  const nomesAnuncios = new Map<string, string>();
  const nomesConjuntos = new Map<string, string>();
  for (const a of lidos ?? []) {
    nomesAnuncios.set(a.ad_id, a.nome ?? a.ad_id);
    if (a.adset_id) nomesConjuntos.set(a.adset_id, a.adset_name ?? a.adset_id);
  }
  for (const a of anuncios.values()) if (!nomesAnuncios.has(a.ad_id)) nomesAnuncios.set(a.ad_id, a.nome);
  // Página principal da campanha (o destino dos anúncios ativos) e os testes diários dela: mudanças na página.
  const destinos = new Map<string, number>();
  for (const a of lidos ?? [])
    for (const d of (a.destinos as string[] | null) ?? []) {
      const k = caminho(d);
      if (k) destinos.set(k, (destinos.get(k) ?? 0) + (a.status === "ACTIVE" ? 10 : 1));
    }
  const [principal] = [...destinos].sort((a, b) => b[1] - a[1]);
  const { data: testesPagina } = principal
    ? await supabase
        .from("pagina_testes")
        .select("testado_em, resumo")
        .eq("organizacao_id", org.id)
        .eq("chave", principal[0])
        .eq("estrategia", "mobile")
        .gte("testado_em", new Date(Date.now() - (JANELA_DIAS + 7) * 86_400_000).toISOString())
        .order("testado_em")
    : { data: [] };
  const marcos = [
    ...marcosDeOperacoes((ops ?? []) as OperacaoMeta[], { campanhaId, anuncios: nomesAnuncios, conjuntos: nomesConjuntos }, org.fuso, org.moeda),
    ...marcosDePagina((testesPagina ?? []) as TestePagina[], org.fuso).filter((m) => m.em >= inicio),
  ]
    .sort((a, b) => a.em.localeCompare(b.em))
    .map((m) => ({ ...m, efeito: efeitoDoMarco(m, gastos, resultados, hoje) }));

  // Vendas, título e texto por anúncio (vencedor por venda e o roteiro das variações).
  for (const v of pagas ?? []) if (v.ad_id) anuncio(v.ad_id).vendas = (anuncio(v.ad_id).vendas ?? 0) + 1;
  for (const a of lidos ?? []) {
    const r = anuncios.get(a.ad_id);
    if (r) Object.assign(r, { titulo: a.titulo ?? null, texto: a.texto ?? null });
  }

  // Visitas por navegador nos últimos 7 dias (Clarity, total do site): quanto abre dentro do Instagram.
  const seteDias = diaNoFuso(new Date(Date.now() - 7 * 86_400_000).toISOString(), org.fuso);
  const porNavegador = new Map<string, number>();
  for (const c of (coletas ?? []) as unknown as Array<{ dia: string; clarity_metricas: Array<{ metrica: string; valores: Record<string, unknown> }> }>) {
    if (c.dia < seteDias) continue;
    for (const m of c.clarity_metricas ?? []) {
      if (m.metrica !== "Browser" || typeof m.valores?.name !== "string") continue;
      porNavegador.set(m.valores.name, (porNavegador.get(m.valores.name) ?? 0) + n(m.valores.sessionsCount));
    }
  }

  const testesAtivos = (leads ?? []).filter((l) => l.teste_iniciado_em && !l.teste_cancelado_em && !l.primeiro_pagamento_em).map((l) => l.teste_iniciado_em as string);
  const vendas = (leads ?? []).filter((l) => l.primeiro_pagamento_em).length;
  const clarity = ((coletas ?? []) as unknown as Array<{ dia: string; clarity_metricas: Array<{ metrica: string; valores: Record<string, unknown> }> }>).map((c) =>
    diaClarity(c.dia, c.clarity_metricas ?? []),
  );

  return lerCampanha({
    hoje,
    sincronizadoAs: sincronizado ? horaNoFuso(sincronizado, org.fuso) : null,
    funil: org.funil,
    diasTeste: org.dias_teste ?? 7,
    moeda: org.moeda,
    dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    anuncios: [...anuncios.values()],
    testesAtivos,
    vendas,
    clarityConectado: !!conexoesClarity,
    clarity,
    marcos,
    navegadores: [...porNavegador].map(([nome, sessoes]) => ({ nome, sessoes })),
    metas,
    iniciados: iniciados ?? undefined,
  });
}

/** Campanhas com gasto nos últimos 3 dias (as que a leitura do Início acompanha). */
export async function campanhasAtivas(supabase: SupabaseClient, org: Org) {
  const desde = diaNoFuso(new Date(Date.now() - 3 * 86_400_000).toISOString(), org.fuso);
  const { data } = await supabase.from("meta_campanha_dia").select("campaign_id, campaign_name, gasto").eq("organizacao_id", org.id).gte("dia", desde).gt("gasto", 0);
  const nomes = new Map<string, string>();
  for (const c of data ?? []) nomes.set(c.campaign_id, c.campaign_name ?? c.campaign_id);
  return [...nomes].map(([id, nome]) => ({ id, nome }));
}
