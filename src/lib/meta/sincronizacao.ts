import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conexaoComSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { buscarAnunciosMeta, buscarInsightsMeta, type AcoesConfiguradas, type LinhaMeta, type NivelMeta } from "@/lib/integracoes/meta";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";

// Sincronização de uma conta de anúncio da Meta (um job da fila). Porte da sincronização do footure-os,
// por organização e retomável:
// • carga: histórico desde contas_anuncio.sincronizar_desde, mês a mês, nível campanha e depois anúncio;
// • incremental/manual: reescreve os últimos 7 dias (a Meta revisa conversões na janela de 7 dias);
// • no fim de toda execução, a dimensão de anúncios (nome, status, parâmetros de URL, destinos, textos)
//   e as imagens que faltam, baixadas para o Storage (as URLs da Meta expiram).
// A cada fatia o cursor é gravado; sem tempo, devolve "continuar" e o worker reenfileira.

const DIAS_INCREMENTAL = 7;
const LIMITE_IMAGENS = 80;
const DIAS_NOVA_TENTATIVA_ORIGINAL = 7;
export const BUCKET_CRIATIVOS = "criativos";

interface Cursor {
  campanha?: string;
  anuncio?: string;
  dimensao?: boolean;
}

const hojeNoFuso = (fuso: string) => new Date().toLocaleDateString("sv-SE", { timeZone: fuso });
const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fimDoMes = (iso: string) => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const menor = (a: string, b: string) => (a < b ? a : b);

async function gravarEmLotes(admin: SupabaseClient, tabela: string, linhas: object[], conflito: string) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await admin.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: conflito });
    if (error) throw new Error(`Falha ao gravar ${tabela}: ${error.message}`);
  }
}

function paraLinha(org: string, conta: string, l: LinhaMeta, nivel: NivelMeta, agora: string) {
  const base = {
    organizacao_id: org,
    account_id: conta,
    dia: l.dia,
    campaign_id: l.campaign_id,
    campaign_name: l.campaign_name,
    gasto: l.gasto,
    impressoes: l.impressoes,
    frequencia: l.frequencia,
    cliques_link: l.cliques_link,
    visualizacoes_pagina: l.visualizacoes_pagina,
    leads: l.leads,
    compras: l.compras,
    valor_compras: l.valor_compras,
    conversas_iniciadas: l.conversas_iniciadas,
    acoes_brutas: l.acoes_brutas,
    sincronizado_em: agora,
  };
  return nivel === "campaign" ? base : { ...base, ad_id: l.ad_id, adset_id: l.adset_id, adset_name: l.adset_name, ad_name: l.ad_name };
}

async function puxar(admin: SupabaseClient, token: string, org: string, conta: string, de: string, ate: string, nivel: NivelMeta, acoes: AcoesConfiguradas) {
  const agora = new Date().toISOString();
  const linhas = (await buscarInsightsMeta(token, conta, de, ate, nivel, acoes)).filter((l) => l.dia && l.campaign_id && (nivel === "campaign" || l.ad_id));
  if (nivel === "campaign")
    await gravarEmLotes(admin, "meta_campanha_dia", linhas.map((l) => paraLinha(org, conta, l, nivel, agora)), "organizacao_id,account_id,campaign_id,dia");
  else await gravarEmLotes(admin, "meta_anuncio_dia", linhas.map((l) => paraLinha(org, conta, l, nivel, agora)), "organizacao_id,account_id,ad_id,dia");
  return linhas.length;
}

/** Dimensão de anúncios + imagens que faltam. Falha nas imagens não derruba o job. */
export async function sincronizarAnuncios(admin: SupabaseClient, token: string, org: string, conta: string, temTempo: () => boolean) {
  const anuncios = await buscarAnunciosMeta(token, conta);
  const agora = new Date().toISOString();
  const { data: guardados } = await admin.from("meta_anuncios").select("ad_id, imagem_path, imagem_original, imagem_em").eq("organizacao_id", org).eq("account_id", conta);
  const guardado = new Map((guardados ?? []).map((g) => [g.ad_id as string, g]));
  await gravarEmLotes(
    admin,
    "meta_anuncios",
    anuncios.map((a) => ({
      organizacao_id: org,
      account_id: conta,
      ad_id: a.ad_id,
      nome: a.nome,
      campaign_id: a.campaign_id,
      campaign_name: a.campaign_name,
      adset_id: a.adset_id,
      adset_name: a.adset_name,
      status: a.status,
      creative_id: a.creative_id,
      url_tags: a.url_tags,
      destinos: a.destinos,
      titulo: a.titulo,
      texto: a.texto,
      chamada: a.chamada,
      atualizado_em: agora,
    })),
    "organizacao_id,account_id,ad_id",
  );

  const limite = Date.now() - DIAS_NOVA_TENTATIVA_ORIGINAL * 86_400_000;
  const pendentes = anuncios
    .filter((a) => a.imagem_url)
    .filter((a) => {
      const g = guardado.get(a.ad_id);
      if (!g?.imagem_path) return true;
      return !g.imagem_original && a.imagem_original && (!g.imagem_em || Date.parse(g.imagem_em) < limite);
    })
    .slice(0, LIMITE_IMAGENS);
  let imagens = 0;
  let tentadas = 0;
  for (const a of pendentes) {
    if (!temTempo()) break;
    tentadas++;
    try {
      const resposta = await fetch(a.imagem_url!, { signal: AbortSignal.timeout(15_000) });
      if (!resposta.ok) continue;
      const tipo = resposta.headers.get("content-type") ?? "image/jpeg";
      const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : "jpg";
      const caminho = `${org}/${conta}/${a.ad_id}.${ext}`;
      const { error } = await admin.storage.from(BUCKET_CRIATIVOS).upload(caminho, await resposta.arrayBuffer(), { contentType: tipo, upsert: true });
      if (error) throw new Error(error.message);
      await admin
        .from("meta_anuncios")
        .update({ imagem_path: caminho, imagem_original: a.imagem_original, imagem_em: new Date().toISOString() })
        .eq("organizacao_id", org)
        .eq("account_id", conta)
        .eq("ad_id", a.ad_id);
      imagens++;
    } catch (e) {
      console.error("[meta imagem]", org, a.ad_id, (e as Error).message);
    }
  }
  // Completo quando todas as pendentes foram tentadas (as que falharam voltam na próxima sincronização).
  return { anuncios: anuncios.length, imagens, completo: tentadas === pendentes.length };
}

export async function executarSincronizacaoMeta(admin: SupabaseClient, s: Sincronizacao, temTempo: () => boolean): Promise<ResultadoJob> {
  const { data: conta } = await admin
    .from("contas_anuncio")
    .select("account_id, fuso, sincronizar_desde, ativa")
    .eq("organizacao_id", s.organizacao_id)
    .eq("account_id", s.alvo)
    .maybeSingle();
  if (!conta) throw new Error("Conta de anúncio não encontrada nesta organização.");
  const credencial = await conexaoComSegredo<SegredoMeta>(admin, s.organizacao_id, "meta");
  if (!credencial) throw new Error("Organização sem conexão com a Meta.");
  const { data: config } = await admin.from("config_metricas").select("acoes_lead, acoes_compra").eq("organizacao_id", s.organizacao_id).single();
  const acoes: AcoesConfiguradas = { lead: config?.acoes_lead ?? [], compra: config?.acoes_compra ?? [] };
  const token = credencial.segredo.token;
  const org = s.organizacao_id;
  const hoje = hojeNoFuso(conta.fuso || "America/Sao_Paulo");
  const inicio = s.modo === "carga" ? conta.sincronizar_desde : somarDias(hoje, -(DIAS_INCREMENTAL - 1));

  const cursor: Cursor = { ...(s.cursor as Cursor) };
  let campanha = cursor.campanha ?? inicio;
  let anuncio = cursor.anuncio ?? inicio;
  let linhas = s.linhas;
  const salvar = () => admin.from("sincronizacoes").update({ cursor: { campanha, anuncio, dimensao: cursor.dimensao ?? false }, linhas, janela_de: inicio, janela_ate: hoje, atualizado_em: new Date().toISOString() }).eq("id", s.id);

  while (campanha <= hoje && temTempo()) {
    const fim = menor(fimDoMes(campanha), hoje);
    linhas += await puxar(admin, token, org, conta.account_id, campanha, fim, "campaign", acoes);
    campanha = somarDias(fim, 1);
    await salvar();
  }
  while (campanha > hoje && anuncio <= hoje && temTempo()) {
    const fim = menor(fimDoMes(anuncio), hoje);
    linhas += await puxar(admin, token, org, conta.account_id, anuncio, fim, "ad", acoes);
    anuncio = somarDias(fim, 1);
    await salvar();
  }
  if (campanha <= hoje || anuncio <= hoje) return { status: "continuar", cursor: { campanha, anuncio }, linhas };

  if (!cursor.dimensao && temTempo()) cursor.dimensao = (await sincronizarAnuncios(admin, token, org, conta.account_id, temTempo)).completo;
  if (!cursor.dimensao) return { status: "continuar", cursor: { campanha, anuncio, dimensao: false }, linhas };
  return { status: "pronto", linhas };
}
