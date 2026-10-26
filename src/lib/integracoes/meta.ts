import "server-only";

// Graph API da Meta (Marketing API), só leitura. Porte do cliente do footure-os, sem nada de cliente fixo:
// o token vem da conexão da organização e as ações que contam como lead/compra, de config_metricas.
// • Insights diários (time_increment=1) por campanha ou anúncio, janelas 7d_click + 1d_view.
// • Anúncios da conta (todos menos arquivados/excluídos, inclusive os ainda sem gasto): nome, status,
//   "Parâmetros de URL", destinos, textos e imagem (original pelo hash; senão a miniatura).
// • Limite de uso: poucas tentativas curtas aqui; persistindo, lança ErroLimiteMeta e o worker reagenda
//   o job (não segura a função da Vercel dormindo).
// A v26 não aceita ?ids= em lote para estes objetos: filtra-se por id com `filtering`.

const API = "https://graph.facebook.com";
const versao = () => process.env.META_API_VERSION || "v26.0";
const JANELAS = ["7d_click", "1d_view"] as const;

const ACAO_CLIQUE = "link_click";
const ACAO_VISITA = "landing_page_view";
const ACAO_CONVERSA = "onsite_conversion.messaging_conversation_started_7d";

export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly codigo?: number,
  ) {
    super(mensagem);
  }
}
/** Limite de uso da API: o job deve ser reprogramado para daqui a `esperarSegundos`. */
export class ErroLimiteMeta extends ErroMeta {
  constructor(readonly esperarSegundos: number) {
    super(`A Meta limitou as consultas desta conta por enquanto; nova tentativa em ${Math.round(esperarSegundos / 60)} min.`);
  }
}

const CODIGOS_LIMITE = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function get<T>(token: string, caminho: string, params: Record<string, string> = {}): Promise<T> {
  const url = caminho.startsWith("http") ? caminho : `${API}/${versao()}/${caminho}?${new URLSearchParams({ ...params, access_token: token })}`;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let resposta: Response;
    try {
      resposta = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    } catch {
      await esperar(2 ** tentativa * 2000);
      continue;
    }
    const json = (await resposta.json().catch(() => ({}))) as { error?: { code?: number; message?: string; error_user_msg?: string } } & T;
    if (resposta.ok) return json;
    const codigo = json.error?.code;
    if (codigo !== undefined && CODIGOS_LIMITE.has(codigo)) {
      if (tentativa < 2) {
        await esperar((tentativa + 1) * 5000);
        continue;
      }
      throw new ErroLimiteMeta(15 * 60);
    }
    if (codigo === 190) throw new ErroMeta("O token da Meta expirou ou foi revogado. Cole um token novo em Configurações → Conexões.", codigo);
    if (codigo === 200 || codigo === 10)
      throw new ErroMeta(`Sem permissão na Meta: o usuário do sistema precisa de acesso à conta e da permissão ads_read. (${json.error?.message})`, codigo);
    throw new ErroMeta(`Erro da Meta (${codigo ?? resposta.status}): ${json.error?.error_user_msg ?? json.error?.message ?? resposta.statusText}`, codigo);
  }
  throw new ErroMeta("Não foi possível falar com a Meta (rede). Tente de novo.");
}

/** Todas as páginas de uma listagem. */
async function todas<T>(token: string, caminho: string, params: Record<string, string>): Promise<T[]> {
  const itens: T[] = [];
  let pagina = await get<{ data?: T[]; paging?: { next?: string } }>(token, caminho, params);
  for (;;) {
    itens.push(...(pagina.data ?? []));
    if (!pagina.paging?.next) return itens;
    pagina = await get(token, pagina.paging.next);
  }
}

// ───────────────────────────── Token e contas ─────────────────────────────

export interface ContaMeta {
  account_id: string; // act_…
  nome: string;
  moeda: string;
  fuso: string;
  ativa: boolean;
}

type ContaBruta = { id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number };
const CAMPOS_CONTA = "id,name,currency,timezone_name,account_status";
const paraConta = (c: ContaBruta): ContaMeta => ({ account_id: c.id, nome: c.name ?? c.id, moeda: c.currency ?? "BRL", fuso: c.timezone_name ?? "America/Sao_Paulo", ativa: c.account_status === 1 });

/** "act_123", "123" ou o link do Gerenciador (…act=123…) → "act_123". */
export function normalizarContaMeta(v: string) {
  const id = v.match(/act[_=](\d+)/)?.[1] ?? v.match(/^\s*(\d{6,})\s*$/)?.[1];
  return id ? `act_${id}` : null;
}

/**
 * Valida o token (chamada de leitura) e devolve as contas de anúncio que ele enxerga: as que a Meta lista
 * em /me/adaccounts e as informadas à mão (lidas uma a uma, o que confirma o acesso a cada uma). Sem
 * nenhuma conta, devolve as permissões do token para a tela explicar o que falta.
 */
export async function validarTokenMeta(token: string, informadas: string[] = []) {
  const eu = await get<{ id: string; name?: string }>(token, "me", { fields: "id,name" });
  const listadas = await todas<ContaBruta>(token, "me/adaccounts", { fields: CAMPOS_CONTA, limit: "200" });
  const contas = new Map(listadas.map((c) => [c.id, paraConta(c)]));
  for (const id of informadas) {
    if (contas.has(id)) continue;
    try {
      contas.set(id, paraConta(await get<ContaBruta>(token, id, { fields: CAMPOS_CONTA })));
    } catch (e) {
      throw new ErroMeta(`Sem acesso à conta ${id}: dê ao usuário do sistema acesso a ela em Atribuir ativos → Contas de anúncios. (${(e as Error).message})`);
    }
  }
  let permissoes: string[] = [];
  if (!contas.size) {
    const r = await get<{ data?: Array<{ permission: string; status: string }> }>(token, "me/permissions").catch(() => ({ data: [] }));
    permissoes = (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
  }
  return { usuario: { id: eu.id, nome: eu.name ?? null }, contas: [...contas.values()], permissoes };
}

// ───────────────────────────── Insights ─────────────────────────────

export type NivelMeta = "campaign" | "ad";

export interface AcaoMeta {
  action_type?: string;
  value?: string;
  [janela: string]: string | undefined;
}

export interface AcoesConfiguradas {
  lead: string[];
  compra: string[];
}

export interface LinhaMeta {
  dia: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  gasto: number;
  impressoes: number;
  frequencia: number;
  cliques_link: number;
  visualizacoes_pagina: number;
  leads: number;
  compras: number;
  valor_compras: number;
  conversas_iniciadas: number;
  acoes_brutas: AcaoMeta[];
}

interface InsightBruto {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  frequency?: string;
  actions?: AcaoMeta[];
  action_values?: AcaoMeta[];
}

const CAMPOS_CAMPANHA = ["date_start", "campaign_id", "campaign_name", "spend", "impressions", "frequency", "actions", "action_values"];
const CAMPOS_ANUNCIO = [...CAMPOS_CAMPANHA, "adset_id", "adset_name", "ad_id", "ad_name"];

/** Valor de uma ação: `value` (total das janelas pedidas) ou a soma das janelas. */
function valorAcao(acoes: AcaoMeta[] | undefined, tipo: string) {
  const a = acoes?.find((x) => x.action_type === tipo);
  if (!a) return 0;
  if (a.value !== undefined) return num(a.value);
  return JANELAS.reduce((s, j) => s + num(a[j]), 0);
}
const somaAcoes = (acoes: AcaoMeta[] | undefined, tipos: string[]) => tipos.reduce((s, t) => s + valorAcao(acoes, t), 0);

export function normalizarInsight(b: InsightBruto, acoes: AcoesConfiguradas): LinhaMeta {
  return {
    dia: b.date_start ?? "",
    campaign_id: b.campaign_id ?? "",
    campaign_name: b.campaign_name ?? null,
    adset_id: b.adset_id ?? null,
    adset_name: b.adset_name ?? null,
    ad_id: b.ad_id ?? null,
    ad_name: b.ad_name ?? null,
    gasto: num(b.spend),
    impressoes: Math.round(num(b.impressions)),
    frequencia: num(b.frequency),
    cliques_link: Math.round(valorAcao(b.actions, ACAO_CLIQUE)),
    visualizacoes_pagina: Math.round(valorAcao(b.actions, ACAO_VISITA)),
    leads: Math.round(somaAcoes(b.actions, acoes.lead)),
    compras: Math.round(somaAcoes(b.actions, acoes.compra)),
    valor_compras: somaAcoes(b.action_values, acoes.compra),
    conversas_iniciadas: Math.round(valorAcao(b.actions, ACAO_CONVERSA)),
    acoes_brutas: [...(b.actions ?? []), ...(b.action_values ?? []).map((v) => ({ ...v, action_type: `valor:${v.action_type}` }))],
  };
}

export async function buscarInsightsMeta(token: string, accountId: string, de: string, ate: string, nivel: NivelMeta, acoes: AcoesConfiguradas) {
  const brutos = await todas<InsightBruto>(token, `${accountId}/insights`, {
    level: nivel,
    time_increment: "1",
    fields: (nivel === "ad" ? CAMPOS_ANUNCIO : CAMPOS_CAMPANHA).join(","),
    action_attribution_windows: JSON.stringify(JANELAS),
    time_range: JSON.stringify({ since: de, until: ate }),
    limit: "200",
  });
  return brutos.map((b) => normalizarInsight(b, acoes));
}

// ───────────────────────────── Anúncios ─────────────────────────────

interface CriativoBruto {
  id?: string;
  thumbnail_url?: string;
  image_hash?: string;
  link_url?: string;
  url_tags?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  object_story_spec?: {
    link_data?: { link?: string; message?: string; name?: string; call_to_action?: { type?: string } };
    video_data?: { message?: string; title?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  };
  asset_feed_spec?: {
    images?: Array<{ hash?: string }>;
    bodies?: Array<{ text?: string }>;
    titles?: Array<{ text?: string }>;
    link_urls?: Array<{ website_url?: string; url_tags?: string }>;
  };
}

interface AnuncioBruto {
  id: string;
  name?: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
  campaign?: { name?: string; stop_time?: string };
  adset?: { name?: string; end_time?: string };
  creative?: CriativoBruto;
}

export interface AnuncioMeta {
  ad_id: string;
  nome: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  status: string | null;
  creative_id: string | null;
  url_tags: string | null;
  destinos: string[];
  titulo: string | null;
  texto: string | null;
  chamada: string | null;
  imagem_url: string | null;
  imagem_original: boolean;
}

const CAMPOS_ANUNCIO_DIM =
  "id,name,effective_status,campaign_id,adset_id,campaign{name,stop_time},adset{name,end_time}," +
  "creative{id,thumbnail_url,image_hash,link_url,url_tags,title,body,call_to_action_type," +
  "object_story_spec{link_data{link,message,name,call_to_action{type}},video_data{message,title,call_to_action{type,value{link}}}}," +
  "asset_feed_spec{images,bodies,titles,link_urls{website_url,url_tags}}}";

const STATUS_LISTADOS = ["ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"];

/**
 * Anúncios da conta (todos fora de arquivados/excluídos, ou só os ids pedidos, em lotes de 50).
 * A Meta mantém ACTIVE no anúncio cujo conjunto/campanha já terminou: nesse caso devolve EXPIRED.
 */
export async function buscarAnunciosMeta(token: string, accountId: string, adIds?: string[]): Promise<AnuncioMeta[]> {
  const brutos: AnuncioBruto[] = [];
  const lotes = adIds ? Array.from({ length: Math.ceil(adIds.length / 50) }, (_, i) => adIds.slice(i * 50, i * 50 + 50)) : [null];
  for (const lote of lotes) {
    const filtro = lote ? [{ field: "id", operator: "IN", value: lote }] : [{ field: "effective_status", operator: "IN", value: STATUS_LISTADOS }];
    brutos.push(
      ...(await todas<AnuncioBruto>(token, `${accountId}/ads`, {
        fields: CAMPOS_ANUNCIO_DIM,
        filtering: JSON.stringify(filtro),
        thumbnail_width: "600",
        thumbnail_height: "600",
        limit: "100",
      })),
    );
  }

  // Imagem original pelo hash (criativo simples ou o primeiro do dinâmico).
  const hashDe = (c?: CriativoBruto) => c?.image_hash ?? c?.asset_feed_spec?.images?.find((im) => im.hash)?.hash ?? null;
  const hashes = [...new Set(brutos.map((a) => hashDe(a.creative)).filter((h): h is string => !!h))];
  const urlDoHash = new Map<string, string>();
  for (let i = 0; i < hashes.length; i += 50) {
    const r = await get<{ data?: Array<{ hash?: string; url?: string }> }>(token, `${accountId}/adimages`, {
      hashes: JSON.stringify(hashes.slice(i, i + 50)),
      fields: "hash,url",
    });
    for (const im of r.data ?? []) if (im.hash && im.url) urlDoHash.set(im.hash, im.url);
  }

  const agora = Date.now();
  return brutos.map((a) => {
    const c = a.creative;
    const fim = [a.adset?.end_time, a.campaign?.stop_time].map((d) => (d ? Date.parse(d) : NaN)).filter((t) => !Number.isNaN(t));
    const status = a.effective_status === "ACTIVE" && fim.some((t) => t < agora) ? "EXPIRED" : (a.effective_status ?? null);
    const destinos = [c?.link_url, c?.object_story_spec?.link_data?.link, c?.object_story_spec?.video_data?.call_to_action?.value?.link, ...(c?.asset_feed_spec?.link_urls ?? []).map((l) => l.website_url)]
      .filter((u): u is string => !!u && /^https?:\/\//.test(u))
      .map((u) => u.split("?")[0]);
    const original = urlDoHash.get(hashDe(c) ?? "") ?? null;
    return {
      ad_id: a.id,
      nome: a.name ?? null,
      campaign_id: a.campaign_id ?? null,
      campaign_name: a.campaign?.name ?? null,
      adset_id: a.adset_id ?? null,
      adset_name: a.adset?.name ?? null,
      status,
      creative_id: c?.id ?? null,
      url_tags: c?.url_tags || c?.asset_feed_spec?.link_urls?.find((l) => l.url_tags)?.url_tags || null,
      destinos: [...new Set(destinos)],
      titulo: c?.title ?? c?.object_story_spec?.link_data?.name ?? c?.object_story_spec?.video_data?.title ?? c?.asset_feed_spec?.titles?.[0]?.text ?? null,
      texto: c?.body ?? c?.object_story_spec?.link_data?.message ?? c?.object_story_spec?.video_data?.message ?? c?.asset_feed_spec?.bodies?.[0]?.text ?? null,
      chamada: c?.call_to_action_type ?? c?.object_story_spec?.link_data?.call_to_action?.type ?? c?.object_story_spec?.video_data?.call_to_action?.type ?? null,
      imagem_url: original ?? c?.thumbnail_url ?? null,
      imagem_original: !!original,
    };
  });
}
