import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";
import { lerCampanha, type AnuncioResumo, type DiaCampanha, type DiaClarity, type Leitura } from "./modelo";

// Junta, com o cliente da sessão (RLS de membro), os números que a leitura da campanha usa: mídia por
// dia, leads e testes pelo dia do cadastro, totais por anúncio, testes em andamento e o Clarity.

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

  const [{ data: midia }, { data: porAnuncio }, { data: leads }, { data: coletas }, { count: conexoesClarity }] = await Promise.all([
    supabase
      .from("meta_campanha_dia")
      .select("dia, gasto, impressoes, frequencia, cliques_link, visualizacoes_pagina, leads, sincronizado_em")
      .eq("organizacao_id", org.id)
      .eq("campaign_id", campanhaId)
      .gte("dia", deDia)
      .order("dia"),
    supabase.from("meta_anuncio_dia").select("ad_id, ad_name, gasto, impressoes, leads").eq("organizacao_id", org.id).eq("campaign_id", campanhaId).gte("dia", deDia),
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
