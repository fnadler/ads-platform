import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroLimiteMeta, ErroMeta } from "./meta";

// Escrita na Marketing API (assistente de campanhas). Só o necessário para CRIAR objetos novos e ativar os
// que o próprio sistema criou — nada de editar, pausar ou apagar o que já existe na conta. Toda chamada
// de escrita é registrada em operacoes_meta (sem o token). Erros da Meta viram ErroMeta com a mensagem
// para o usuário (error_user_title/error_user_msg) quando ela vem.

const API = "https://graph.facebook.com";
const versao = () => process.env.META_API_VERSION || "v26.0";
const CODIGOS_LIMITE = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

interface ErroGraph {
  code?: number;
  error_subcode?: number;
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

/** Mensagem legível do erro da Meta (a que ela mostra ao usuário, quando há). */
export function mensagemErroMeta(e: ErroGraph | undefined, status: number) {
  if (!e) return `A Meta respondeu ${status} sem detalhes.`;
  if (e.code === 190) return "O token de publicação expirou ou foi revogado. Cole um token novo em Configurações → Meta (publicação).";
  if (e.code === 200 || e.code === 10 || e.code === 294)
    return `Sem permissão para publicar: o usuário do sistema precisa de ads_management e de “Gerenciar campanhas” na conta. (${e.message ?? ""})`;
  const usuario = [e.error_user_title, e.error_user_msg].filter(Boolean).join(": ");
  return `${usuario || e.message || "Erro da Meta"} (código ${e.code ?? status}${e.error_subcode ? `/${e.error_subcode}` : ""})`;
}

const paraForm = (params: Record<string, unknown>) => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    f.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return f;
};

/** GET simples (leituras de apoio: situação de vídeo, miniatura, pré-requisitos). */
export async function getMeta<T>(token: string, caminho: string, params: Record<string, string> = {}): Promise<T> {
  const url = `${API}/${versao()}/${caminho}?${new URLSearchParams({ ...params, access_token: token })}`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const json = (await r.json().catch(() => ({}))) as { error?: ErroGraph } & T;
  if (r.ok) return json;
  if (json.error?.code !== undefined && CODIGOS_LIMITE.has(json.error.code)) throw new ErroLimiteMeta(10 * 60);
  throw new ErroMeta(mensagemErroMeta(json.error, r.status), json.error?.code);
}

export interface ContextoEscrita {
  token: string;
  admin: SupabaseClient;
  organizacaoId: string;
  campanhaId?: string | null;
  usuarioId?: string | null;
}

export class ClienteMetaEscrita {
  constructor(private readonly ctx: ContextoEscrita) {}

  get<T>(caminho: string, params: Record<string, string> = {}) {
    return getMeta<T>(this.ctx.token, caminho, params);
  }

  /** POST com registro em operacoes_meta. validar = execution_options validate_only (não cria nada). */
  async post<T>(caminho: string, params: Record<string, unknown>, opcoes: { validar?: boolean; registrar?: Record<string, unknown> } = {}): Promise<T> {
    const corpo = paraForm({ ...params, ...(opcoes.validar ? { execution_options: ["validate_only"] } : {}), access_token: this.ctx.token });
    let status = 0;
    let json: { error?: ErroGraph } & Record<string, unknown> = {};
    try {
      const r = await fetch(`${API}/${versao()}/${caminho}`, { method: "POST", body: corpo, cache: "no-store", signal: AbortSignal.timeout(120_000) });
      status = r.status;
      json = (await r.json().catch(() => ({}))) as typeof json;
    } finally {
      await this.ctx.admin.from("operacoes_meta").insert({
        organizacao_id: this.ctx.organizacaoId,
        campanha_id: this.ctx.campanhaId ?? null,
        usuario_id: this.ctx.usuarioId ?? null,
        metodo: "POST",
        caminho,
        parametros: opcoes.registrar ?? params,
        validacao: !!opcoes.validar,
        status_http: status || null,
        resposta: json,
      });
    }
    if (status >= 200 && status < 300 && !json.error) return json as T;
    if (json.error?.code !== undefined && CODIGOS_LIMITE.has(json.error.code)) throw new ErroLimiteMeta(10 * 60);
    throw new ErroMeta(mensagemErroMeta(json.error, status), json.error?.code);
  }

  /** A Meta baixa o vídeo da URL (assinada, do nosso Storage). Devolve o id do vídeo. */
  async enviarVideo(accountId: string, urlArquivo: string, nome: string) {
    return (await this.post<{ id: string }>(`${accountId}/advideos`, { file_url: urlArquivo, name: nome }, { registrar: { name: nome, file_url: "(url assinada)" } })).id;
  }

  async situacaoVideo(videoId: string) {
    const r = await this.get<{ status?: { video_status?: string; processing_progress?: number } }>(videoId, { fields: "status" });
    return { situacao: r.status?.video_status ?? "processing", progresso: r.status?.processing_progress ?? 0 };
  }

  /** Miniatura preferida do vídeo (a Meta exige uma imagem de capa no anúncio de vídeo). */
  async miniaturaVideo(videoId: string) {
    const r = await this.get<{ data?: Array<{ uri?: string; is_preferred?: boolean }> }>(`${videoId}/thumbnails`, { fields: "uri,is_preferred" });
    const lista = r.data ?? [];
    return (lista.find((t) => t.is_preferred) ?? lista[0])?.uri ?? null;
  }

  /** Imagem em base64 → hash na biblioteca de imagens da conta. */
  async enviarImagem(accountId: string, base64: string, nome: string) {
    const r = await this.post<{ images?: Record<string, { hash?: string }> }>(`${accountId}/adimages`, { bytes: base64, name: nome }, { registrar: { name: nome, bytes: "(imagem)" } });
    const hash = Object.values(r.images ?? {})[0]?.hash;
    if (!hash) throw new ErroMeta("A Meta não devolveu o hash da imagem enviada.");
    return hash;
  }

  async criar(accountId: string, edge: "campaigns" | "adsets" | "adcreatives" | "ads", payload: Record<string, unknown>, validar = false) {
    return this.post<{ id?: string; success?: boolean }>(`${accountId}/${edge}`, payload, { validar });
  }

  /** Ativa um objeto que o sistema criou (campanha, conjunto ou anúncio). */
  async ativar(objetoId: string) {
    return this.post<{ success?: boolean }>(objetoId, { status: "ACTIVE" });
  }
}

// ───────────────────────────── Pré-requisitos ─────────────────────────────

export interface Prerequisitos {
  usuario: { id: string; nome: string | null };
  permissoes: string[];
  conta: { id: string; nome: string; moeda: string; fuso: string; ativa: boolean; motivo?: string } | null;
  paginas: Array<{ id: string; nome: string }>;
  instagram: Array<{ id: string; nome: string }>;
  pixels: Array<{ id: string; nome: string; ultimoEvento: string | null }>;
}

const STATUS_CONTA: Record<number, string> = { 2: "desativada", 3: "com pagamento pendente", 7: "em análise de risco", 8: "com pagamento pendente", 9: "em período de carência", 101: "encerrada" };

/** Lê tudo o que o assistente precisa saber da conta antes de publicar (só leituras). */
export async function lerPrerequisitos(token: string, accountId: string): Promise<Prerequisitos> {
  const cli = { get: <T,>(caminho: string, params: Record<string, string> = {}) => getMeta<T>(token, caminho, params) };
  const eu = await cli.get<{ id: string; name?: string }>("me", { fields: "id,name" });
  const perms = await cli.get<{ data?: Array<{ permission: string; status: string }> }>("me/permissions").catch(() => ({ data: [] }));
  const conta = await cli
    .get<{ id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>(accountId, { fields: "id,name,currency,timezone_name,account_status" })
    .catch(() => null);
  // Páginas: as que a conta pode promover e as atribuídas ao usuário do sistema (esta traz também o Instagram
  // ligado a cada Página). Listar Páginas exige pages_show_list no token; Instagram, instagram_basic — sem
  // elas a Meta devolve lista vazia, sem erro.
  type PaginaBruta = { id: string; name?: string; instagram_business_account?: { id: string; username?: string } };
  const promoviveis = await cli.get<{ data?: PaginaBruta[] }>(`${accountId}/promote_pages`, { fields: "id,name", limit: "100" }).catch(() => ({ data: [] as PaginaBruta[] }));
  const doUsuario = await cli
    .get<{ data?: PaginaBruta[] }>("me/accounts", { fields: "id,name,instagram_business_account{id,username}", limit: "100" })
    .catch(() => ({ data: [] as PaginaBruta[] }));
  const paginas = new Map<string, { id: string; nome: string }>();
  for (const pg of [...(promoviveis.data ?? []), ...(doUsuario.data ?? [])]) paginas.set(pg.id, { id: pg.id, nome: pg.name ?? pg.id });
  const contaIg = await cli
    .get<{ data?: Array<{ id: string; username?: string }> }>(`${accountId}/instagram_accounts`, { fields: "id,username", limit: "100" })
    .catch(() => ({ data: [] }));
  const instagram = new Map<string, { id: string; nome: string }>();
  for (const ig of [...(contaIg.data ?? []), ...(doUsuario.data ?? []).flatMap((pg) => (pg.instagram_business_account ? [pg.instagram_business_account] : []))])
    instagram.set(ig.id, { id: ig.id, nome: ig.username ? `@${ig.username}` : ig.id });
  const pixels = await cli
    .get<{ data?: Array<{ id: string; name?: string; last_fired_time?: string }> }>(`${accountId}/adspixels`, { fields: "id,name,last_fired_time", limit: "100" })
    .catch(() => ({ data: [] }));
  return {
    usuario: { id: eu.id, nome: eu.name ?? null },
    permissoes: (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
    conta: conta
      ? {
          id: conta.id,
          nome: conta.name ?? conta.id,
          moeda: conta.currency ?? "BRL",
          fuso: conta.timezone_name ?? "America/Sao_Paulo",
          ativa: conta.account_status === 1,
          motivo: conta.account_status && conta.account_status !== 1 ? STATUS_CONTA[conta.account_status] ?? `status ${conta.account_status}` : undefined,
        }
      : null,
    paginas: [...paginas.values()],
    instagram: [...instagram.values()],
    pixels: (pixels.data ?? []).map((p) => ({ id: p.id, nome: p.name ?? p.id, ultimoEvento: p.last_fired_time ?? null })),
  };
}
