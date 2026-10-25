import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrar, decifrar } from "@/lib/cifra";

// Credenciais das conexões: JSON cifrado em conexoes_segredos (tabela sem policy; só a service role).

export interface SegredoMeta {
  token: string;
}
export interface SegredoStripe {
  chave: string;
  segredo_webhook?: string;
}

export async function salvarSegredo(admin: SupabaseClient, conexao: { id: string; organizacao_id: string }, valor: object) {
  const { error } = await admin
    .from("conexoes_segredos")
    .upsert({ conexao_id: conexao.id, organizacao_id: conexao.organizacao_id, cifrado: cifrar(JSON.stringify(valor)), atualizado_em: new Date().toISOString() });
  if (error) throw new Error(`Não foi possível guardar a credencial: ${error.message}`);
}

/** Lê a credencial de uma conexão da organização (confere a organização para não cruzar clientes). */
export async function lerSegredo<T>(admin: SupabaseClient, organizacaoId: string, conexaoId: string): Promise<T | null> {
  const { data } = await admin.from("conexoes_segredos").select("cifrado").eq("conexao_id", conexaoId).eq("organizacao_id", organizacaoId).maybeSingle();
  return data ? (JSON.parse(decifrar(data.cifrado)) as T) : null;
}

/** Conexão ativa de um tipo (a primeira) com a credencial. */
export async function conexaoComSegredo<T>(admin: SupabaseClient, organizacaoId: string, tipo: "meta" | "stripe") {
  const { data: conexao } = await admin
    .from("conexoes")
    .select("id, organizacao_id, status, config")
    .eq("organizacao_id", organizacaoId)
    .eq("tipo", tipo)
    .order("criado_em")
    .limit(1)
    .maybeSingle();
  if (!conexao) return null;
  const segredo = await lerSegredo<T>(admin, organizacaoId, conexao.id);
  return segredo ? { conexao, segredo } : null;
}

export async function marcarErroConexao(admin: SupabaseClient, conexaoId: string, erro: string | null) {
  await admin
    .from("conexoes")
    .update(erro ? { status: "erro", ultimo_erro: erro, atualizado_em: new Date().toISOString() } : { status: "ativa", ultimo_erro: null, atualizado_em: new Date().toISOString() })
    .eq("id", conexaoId);
}
