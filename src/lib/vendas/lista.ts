import type { SupabaseClient } from "@supabase/supabase-js";

// Últimos leads e vendas, da organização inteira ou de uma campanha. A campanha de cada um vem dos IDs
// que chegaram com ele (leads.campaign_id; na venda, a do anúncio dela ou a do lead de origem).

/** null = todas; "sem" = só o que chegou sem campanha (orgânico, antigo ou sem rastreio); senão o id da Meta. */
export type FiltroCampanha = string | null;
export const SEM_CAMPANHA = "sem";

export interface LeadLinha {
  id_externo: string;
  criado_em: string;
  utm_source: string | null;
  utm_campaign: string | null;
  campaign_id: string | null;
  ad_id: string | null;
  atribuicao: string;
  teste_iniciado_em: string | null;
  teste_cancelado_em: string | null;
  primeiro_pagamento_em: string | null;
  codigo_teste: string | null;
}

export interface VendaLinha {
  id_externo: string;
  tipo: string;
  valor: number;
  moeda: string;
  ocorrida_em: string;
  campaign_id: string | null;
  ad_id: string | null;
  origem: string;
}

export interface LeadsVendas {
  leads: LeadLinha[];
  vendas: VendaLinha[];
  nomeAnuncio: Map<string, string>;
  nomeCampanha: Map<string, string>;
}

export async function carregarLeadsVendas(
  supabase: SupabaseClient,
  orgId: string,
  { campanha = null, desde = null, limite = 50 }: { campanha?: FiltroCampanha; desde?: string | null; limite?: number } = {},
): Promise<LeadsVendas> {
  let leads = supabase
    .from("leads")
    .select("id_externo, criado_em, utm_source, utm_campaign, campaign_id, ad_id, atribuicao, teste_iniciado_em, teste_cancelado_em, primeiro_pagamento_em, codigo_teste")
    .eq("organizacao_id", orgId);
  let vendas = supabase.from("vendas_atribuidas").select("id_externo, tipo, valor, moeda, ocorrida_em, campaign_id, ad_id, origem").eq("organizacao_id", orgId);
  if (campanha === SEM_CAMPANHA) {
    leads = leads.is("campaign_id", null);
    vendas = vendas.is("campaign_id", null);
  } else if (campanha) {
    leads = leads.eq("campaign_id", campanha);
    vendas = vendas.eq("campaign_id", campanha);
  }
  if (desde) {
    leads = leads.gte("criado_em", desde);
    vendas = vendas.gte("ocorrida_em", desde);
  }
  const [{ data: l }, { data: v }, { data: anuncios }] = await Promise.all([
    leads.order("criado_em", { ascending: false }).limit(limite),
    vendas.order("ocorrida_em", { ascending: false }).limit(limite),
    supabase.from("meta_anuncios").select("ad_id, nome, campaign_id, campaign_name").eq("organizacao_id", orgId),
  ]);
  const nomeAnuncio = new Map<string, string>();
  const nomeCampanha = new Map<string, string>();
  for (const a of anuncios ?? []) {
    if (a.nome) nomeAnuncio.set(a.ad_id, a.nome);
    if (a.campaign_id && a.campaign_name) nomeCampanha.set(a.campaign_id, a.campaign_name);
  }
  return { leads: (l as LeadLinha[]) ?? [], vendas: (v as VendaLinha[]) ?? [], nomeAnuncio, nomeCampanha };
}
