"use server";

import { refresh } from "next/cache";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { ClienteMetaEscrita } from "@/lib/integracoes/metaEscrita";
import { moeda as formatarMoeda } from "@/lib/formato";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { CAMPOS_CONJUNTO, fimDoTeste, temOrcamento, nomeConjuntoTeste, payloadConjuntoTeste, podeTirarDoTotal, verbaPorDia, type ConjuntoOriginal } from "./ajustes";
import { menorUnidade } from "./modelo";

// Ações que corrigem uma campanha a partir das sugestões da leitura: testar anúncios com verba própria,
// pausar um anúncio e ajustar a verba. Só em campanha que a plataforma criou (está em campanhas_assistente),
// só para gestor, sempre depois da confirmação na tela, e com registro na auditoria.

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ddmm = (d: Date, fuso: string) => d.toLocaleDateString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" });

async function contexto(orgId: string, metaCampaignId: string) {
  const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
  const admin = criarClienteAdmin();
  const [{ data: campanha }, { data: config }, { data: conexao }, { data: org }] = await Promise.all([
    admin
      .from("campanhas_assistente")
      .select("id, nome, status, rascunho, account_id, meta_campaign_id, meta_adset_id")
      .eq("organizacao_id", orgId)
      .eq("meta_campaign_id", metaCampaignId)
      .maybeSingle(),
    admin.from("config_publicacao").select("teto_verba_diaria").eq("organizacao_id", orgId).maybeSingle(),
    admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "meta_publicacao").maybeSingle(),
    admin.from("organizacoes").select("moeda, fuso").eq("id", orgId).single(),
  ]);
  if (!campanha) throw new Error("Esta campanha não foi criada pela plataforma. Faça o ajuste no Gerenciador de Anúncios.");
  if (campanha.status !== "ativa" && campanha.status !== "criada") throw new Error("A campanha ainda não terminou de ser criada na Meta.");
  const segredo = conexao ? await lerSegredo<SegredoMeta>(admin, orgId, conexao.id) : null;
  if (!segredo) throw new Error("Falta a conexão de publicação na Meta (Configurações → Meta (publicação)).");
  const meta = new ClienteMetaEscrita({ token: segredo.token, admin, organizacaoId: orgId, campanhaId: campanha.id, usuarioId: usuario.id });
  return {
    usuario,
    supabase,
    admin,
    meta,
    campanha,
    teto: Number(config?.teto_verba_diaria) || 0,
    moedaOrg: (org?.moeda as string) || "BRL",
    fuso: (org?.fuso as string) || "America/Sao_Paulo",
  };
}

/** Anúncios (id na Meta) desta campanha que a plataforma criou, com o criativo de cada um. */
async function anunciosDaCampanha(admin: ReturnType<typeof criarClienteAdmin>, orgId: string, campanhaId: string) {
  const { data: conjuntos } = await admin.from("conjuntos_assistente").select("id, ordem, meta_adset_id").eq("organizacao_id", orgId).eq("campanha_id", campanhaId);
  const { data: anuncios } = await admin
    .from("anuncios_assistente")
    .select("meta_ad_id, criativo_id, conjunto_id, criativos_assistente(nome, meta_creative_id)")
    .eq("organizacao_id", orgId)
    .in(
      "conjunto_id",
      (conjuntos ?? []).map((c) => c.id),
    );
  type Criativo = { nome: string; meta_creative_id: string | null };
  return {
    conjuntos: conjuntos ?? [],
    anuncios: (anuncios ?? []).map((a) => ({
      meta_ad_id: a.meta_ad_id as string | null,
      criativo_id: a.criativo_id as string,
      criativo: (Array.isArray(a.criativos_assistente) ? a.criativos_assistente[0] : a.criativos_assistente) as Criativo | null,
    })),
  };
}

const numero = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(",", "."));

// ───────────────────────────── Testar anúncios com verba própria ─────────────────────────────

/**
 * Cria um conjunto novo na mesma campanha, com o mesmo público do conjunto original e verba própria, põe
 * nele os anúncios escolhidos (os mesmos criativos) e ativa. A verba pode sair do orçamento atual (o gasto
 * total não muda) ou somar a ele.
 */
export async function testarAnuncios(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const metaCampaignId = String(dados.get("campanha"));
  const escolhidos = dados.getAll("anuncio").map(String);
  const verba = numero(dados.get("verba"));
  const origem = dados.get("origem") === "somar" ? "somar" : "tirar";
  if (!escolhidos.length) return { erro: "Escolha pelo menos um anúncio para testar." };
  if (!(verba > 0)) return { erro: "Informe a verba do teste." };
  let jaReduzido = "";
  try {
    const ctx = await contexto(orgId, metaCampaignId);
    const { admin, meta, campanha, fuso, moedaOrg } = ctx;
    const { conjuntos, anuncios } = await anunciosDaCampanha(admin, orgId, campanha.id);
    const originalId = campanha.meta_adset_id ?? conjuntos.sort((a, b) => a.ordem - b.ordem)[0]?.meta_adset_id;
    if (!originalId) return { erro: "Não encontrei o conjunto original da campanha." };

    // Criativos dos anúncios escolhidos (um por criativo, mesmo que o anúncio exista em mais de um conjunto).
    const porCriativo = new Map<string, { criativo_id: string; nome: string; meta_creative_id: string }>();
    for (const a of anuncios)
      if (a.meta_ad_id && escolhidos.includes(a.meta_ad_id) && a.criativo?.meta_creative_id)
        porCriativo.set(a.criativo_id, { criativo_id: a.criativo_id, nome: a.criativo.nome, meta_creative_id: a.criativo.meta_creative_id });
    if (!porCriativo.size) return { erro: "Os anúncios escolhidos não são desta campanha." };
    const pecas = [...porCriativo.values()];

    const original = await meta.get<ConjuntoOriginal & { id: string }>(originalId, { fields: CAMPOS_CONJUNTO });
    const tipo = temOrcamento(original.lifetime_budget) ? "total" : "diario";
    const agora = new Date();
    const fim = fimDoTeste(original, agora);
    if (fim.getTime() - agora.getTime() < 2 * 86_400_000) return { erro: "A campanha termina em menos de 2 dias: não dá tempo de o teste dizer alguma coisa." };
    if (ctx.teto && verbaPorDia(verba, tipo, fim, agora) > ctx.teto)
      return { erro: `O teste passaria do teto de verba diária da organização (${formatarMoeda(ctx.teto, moedaOrg)} por dia). Diminua o valor.` };

    // Tirar do orçamento atual: confere com o que já foi gasto (a Meta recusa orçamento total abaixo do gasto).
    const atual = Number(tipo === "total" ? original.lifetime_budget : original.daily_budget) / 100;
    let novoOriginal: number | null = null;
    if (origem === "tirar") {
      if (tipo === "total") {
        const { data: gastos } = await admin.from("meta_anuncio_dia").select("gasto").eq("organizacao_id", orgId).eq("adset_id", originalId);
        const gasto = (gastos ?? []).reduce((s, g) => s + Number(g.gasto), 0);
        const ok = podeTirarDoTotal(atual, gasto, verba);
        if (!ok.ok) return { erro: ok.erro };
      } else if (atual - verba < 5) return { erro: "A verba diária que sobra no conjunto original ficaria baixa demais. Diminua o teste ou some ao orçamento." };
      novoOriginal = atual - verba;
    }

    const nome = nomeConjuntoTeste(
      campanha.nome,
      pecas.map((p) => p.nome),
    );
    const payload = payloadConjuntoTeste(nome, metaCampaignId, original, verba, moedaOrg, agora);
    await meta.criar(campanha.account_id!, "adsets", payload, true); // valida antes de mexer no orçamento
    if (novoOriginal !== null) {
      await meta.atualizar(originalId, { [tipo === "total" ? "lifetime_budget" : "daily_budget"]: menorUnidade(novoOriginal, moedaOrg) });
      jaReduzido = ` Atenção: o orçamento do conjunto original já tinha sido reduzido de ${formatarMoeda(atual, moedaOrg)} para ${formatarMoeda(novoOriginal, moedaOrg)}; o teste ficou incompleto (o que foi criado está pausado). Ajuste no Gerenciador ou tente de novo.`;
    }

    const criado = await meta.criar(campanha.account_id!, "adsets", payload);
    if (!criado.id) throw new Error("A Meta não devolveu o id do conjunto de teste.");
    const ordem = Math.max(0, ...conjuntos.map((c) => c.ordem)) + 1;
    const { data: conjunto } = await admin
      .from("conjuntos_assistente")
      .insert({ organizacao_id: orgId, campanha_id: campanha.id, ordem, nome, meta_adset_id: criado.id })
      .select("id")
      .single();
    const novos: string[] = [];
    for (const p of pecas) {
      const ad = await meta.criar(campanha.account_id!, "ads", { name: p.nome, adset_id: criado.id, creative: { creative_id: p.meta_creative_id }, status: "PAUSED" });
      if (!ad.id) throw new Error(`A Meta não devolveu o id do anúncio ${p.nome}.`);
      novos.push(ad.id);
      if (conjunto) await admin.from("anuncios_assistente").insert({ organizacao_id: orgId, criativo_id: p.criativo_id, conjunto_id: conjunto.id, meta_ad_id: ad.id });
    }
    for (const id of novos) await meta.ativar(id);
    await meta.ativar(criado.id);

    if (novoOriginal !== null) {
      const r = (campanha.rascunho ?? {}) as Record<string, unknown>;
      await admin
        .from("campanhas_assistente")
        .update({ rascunho: { ...r, [tipo === "total" ? "verba_total" : "verba_diaria"]: novoOriginal }, atualizado_em: agora.toISOString() })
        .eq("id", campanha.id);
    }
    await ctx.supabase.rpc("registrar_auditoria", {
      p_org: orgId,
      p_acao: "campanha.teste_criado",
      p_detalhes: { campanha: campanha.id, conjunto: criado.id, anuncios: novos, verba, tipo, origem, verba_original: novoOriginal },
    });
    refresh();
    const quanto = tipo === "total" ? `${formatarMoeda(verba, moedaOrg)} até ${ddmm(fim, fuso)}` : `${formatarMoeda(verba, moedaOrg)} por dia até ${ddmm(fim, fuso)}`;
    const deOnde = novoOriginal !== null ? ` O conjunto original passou a ter ${formatarMoeda(novoOriginal, moedaOrg)}${tipo === "diario" ? " por dia" : ""}.` : "";
    return { mensagem: `Teste criado e ativado: ${quanto}.${deOnde} A Meta analisa os anúncios antes de começar, o que costuma levar alguns minutos.` };
  } catch (e) {
    return { erro: `${mensagem(e)}${jaReduzido}` };
  }
}

// ───────────────────────────── Pausar anúncio ─────────────────────────────

/** Pausa o anúncio em todos os conjuntos desta campanha em que ele (o mesmo criativo) aparece. */
export async function pausarAnuncio(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const metaCampaignId = String(dados.get("campanha"));
  const anuncio = String(dados.get("anuncio"));
  try {
    const ctx = await contexto(orgId, metaCampaignId);
    const { anuncios } = await anunciosDaCampanha(ctx.admin, orgId, ctx.campanha.id);
    const alvo = anuncios.find((a) => a.meta_ad_id === anuncio);
    if (!alvo) return { erro: "Este anúncio não foi criado pela plataforma nesta campanha. Pause no Gerenciador de Anúncios." };
    await ctx.meta.pausar(anuncio);
    await ctx.supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "anuncio.pausado", p_detalhes: { campanha: ctx.campanha.id, anuncio } });
    await ctx.admin.from("meta_anuncios").update({ status: "PAUSED" }).eq("organizacao_id", orgId).eq("ad_id", anuncio);
    refresh();
    return { mensagem: `“${alvo.criativo?.nome ?? anuncio}” foi pausado. Os outros anúncios continuam no ar, e a verba passa para eles.` };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Volta a veicular um anúncio pausado pela plataforma. */
export async function reativarAnuncio(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const metaCampaignId = String(dados.get("campanha"));
  const anuncio = String(dados.get("anuncio"));
  try {
    const ctx = await contexto(orgId, metaCampaignId);
    const { anuncios } = await anunciosDaCampanha(ctx.admin, orgId, ctx.campanha.id);
    if (!anuncios.some((a) => a.meta_ad_id === anuncio)) return { erro: "Este anúncio não foi criado pela plataforma nesta campanha." };
    await ctx.meta.ativar(anuncio);
    await ctx.supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "anuncio.reativado", p_detalhes: { campanha: ctx.campanha.id, anuncio } });
    await ctx.admin.from("meta_anuncios").update({ status: "ACTIVE" }).eq("organizacao_id", orgId).eq("ad_id", anuncio);
    refresh();
    return { mensagem: "Anúncio de volta ao ar." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Ajustar verba ─────────────────────────────

/** Muda a verba do conjunto original (ou da campanha, quando o orçamento é dela), do mesmo tipo que já tem. */
export async function ajustarVerba(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const metaCampaignId = String(dados.get("campanha"));
  const valor = numero(dados.get("verba"));
  if (!(valor > 0)) return { erro: "Informe a nova verba." };
  try {
    const ctx = await contexto(orgId, metaCampaignId);
    const { admin, meta, campanha, moedaOrg } = ctx;
    const daCampanha = await meta.get<{ daily_budget?: string; lifetime_budget?: string; stop_time?: string }>(metaCampaignId, {
      fields: "daily_budget,lifetime_budget,stop_time",
    });
    const alvoId = temOrcamento(daCampanha.daily_budget) || temOrcamento(daCampanha.lifetime_budget) ? metaCampaignId : campanha.meta_adset_id;
    if (!alvoId) return { erro: "Não encontrei onde fica o orçamento desta campanha." };
    const alvo = alvoId === metaCampaignId ? daCampanha : await meta.get<ConjuntoOriginal>(alvoId, { fields: "daily_budget,lifetime_budget,end_time" });
    const tipo = temOrcamento(alvo.lifetime_budget) ? "total" : "diario";
    const agora = new Date();
    const fim = new Date((alvo as ConjuntoOriginal).end_time ?? (alvo as { stop_time?: string }).stop_time ?? agora.getTime() + 86_400_000);
    if (tipo === "total") {
      const { data: gastos } = await admin.from("meta_campanha_dia").select("gasto").eq("organizacao_id", orgId).eq("campaign_id", metaCampaignId);
      const gasto = (gastos ?? []).reduce((s, g) => s + Number(g.gasto), 0);
      if (valor < gasto * 1.1) return { erro: `O orçamento total precisa cobrir o que já foi gasto (${formatarMoeda(gasto, moedaOrg)}), com folga.` };
      // O teto é por dia: compara o que ainda falta gastar com os dias que faltam.
      if (ctx.teto && verbaPorDia(valor - gasto, "total", fim, agora) > ctx.teto)
        return { erro: `Com esse orçamento, a campanha gastaria mais que o teto diário da organização (${formatarMoeda(ctx.teto, moedaOrg)}).` };
    } else if (ctx.teto && valor > ctx.teto) return { erro: `O teto de verba diária da organização é ${formatarMoeda(ctx.teto, moedaOrg)}.` };

    const anterior = Number(tipo === "total" ? alvo.lifetime_budget : alvo.daily_budget) / 100;
    await meta.atualizar(alvoId, { [tipo === "total" ? "lifetime_budget" : "daily_budget"]: menorUnidade(valor, moedaOrg) });
    const r = (campanha.rascunho ?? {}) as Record<string, unknown>;
    await admin
      .from("campanhas_assistente")
      .update({ rascunho: { ...r, [tipo === "total" ? "verba_total" : "verba_diaria"]: valor }, atualizado_em: agora.toISOString() })
      .eq("id", campanha.id);
    await ctx.supabase.rpc("registrar_auditoria", {
      p_org: orgId,
      p_acao: "campanha.verba_ajustada",
      p_detalhes: { campanha: campanha.id, alvo: alvoId, tipo, de: anterior, para: valor },
    });
    refresh();
    return {
      mensagem: `Verba ajustada: de ${formatarMoeda(anterior, moedaOrg)} para ${formatarMoeda(valor, moedaOrg)}${tipo === "diario" ? " por dia" : " no total"}. Mudar a verba em mais de 20% pode fazer a Meta reaprender por alguns dias.`,
    };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
