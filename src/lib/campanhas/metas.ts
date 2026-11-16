import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Metas da campanha: o que foi salvo em Gerenciar (metas_campanha) ou, se nada foi salvo, o que a pessoa pôs
// no rascunho do assistente ao montar a campanha.

export interface Metas {
  /** Custo por cadastro aceito. */
  cadastro: number | null;
  /** Custo por venda aceito. */
  venda: number | null;
}

const positivo = (v: unknown) => (Number(v) > 0 ? Number(v) : null);

export async function carregarMetas(supabase: SupabaseClient, orgId: string, metaCampaignId: string): Promise<Metas> {
  const [{ data: salvas }, { data: montada }] = await Promise.all([
    supabase.from("metas_campanha").select("custo_cadastro, custo_venda").eq("organizacao_id", orgId).eq("meta_campaign_id", metaCampaignId).maybeSingle(),
    supabase.from("campanhas_assistente").select("rascunho").eq("organizacao_id", orgId).eq("meta_campaign_id", metaCampaignId).maybeSingle(),
  ]);
  if (salvas) return { cadastro: positivo(salvas.custo_cadastro), venda: positivo(salvas.custo_venda) };
  const r = (montada?.rascunho ?? {}) as Record<string, unknown>;
  return { cadastro: positivo(r.meta_cadastro), venda: positivo(r.meta_venda) };
}
