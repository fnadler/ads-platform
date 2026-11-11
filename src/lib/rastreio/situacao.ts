import type { SupabaseClient } from "@supabase/supabase-js";
import { TIPOS_PLATAFORMA } from "@/lib/vendas/plataformas/catalogo";
import { avaliarDestino, avaliarParametros, type Problema, type StatusRastreio } from "./regras";

// Rastreio por campanha: cada anúncio avaliado pelos "Parâmetros de URL" e pelo destino, somado por campanha,
// com o último teste de ponta a ponta dela. Serve a Gerenciar › Rastreio (onde se corrige) e aos avisos de
// Analisar (o quanto dá para confiar nos números da campanha).

/** Anúncios que gastam ou vão gastar: é neles que rastreio faltando custa atribuição. */
export const VIVOS = ["ACTIVE", "PENDING_REVIEW", "PREAPPROVED", "IN_PROCESS"];
const FORA = "(ARCHIVED,DELETED,EXPIRED)";

export interface AnuncioAvaliado {
  ad_id: string;
  nome: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  status: string | null;
  destinos: string[];
  status_rastreio: StatusRastreio;
  problemas: Problema[];
  vivo: boolean;
}

export interface TesteRastreio {
  status: string;
  criado_em: string;
  verificado_em: string | null;
}

export interface SaudeCampanha {
  campaignId: string;
  nome: string;
  anuncios: number;
  vivos: number;
  /** Anúncios vivos cujos cadastros e vendas chegam sem o anúncio de origem. */
  semRastreio: number;
  /** Anúncios vivos com algo a melhorar, sem perder a atribuição. */
  atencao: number;
  ultimoTeste: TesteRastreio | null;
}

export function avaliarAnuncio(
  a: { url_tags: string | null; destinos: unknown; status: string | null },
  checkout: boolean,
): { status_rastreio: StatusRastreio; problemas: Problema[]; vivo: boolean } {
  const p = avaliarParametros(a.url_tags, { checkout });
  const destino = avaliarDestino((a.destinos as string[]) ?? []);
  return {
    status_rastreio: destino && p.status === "ok" ? "alerta" : p.status,
    problemas: destino ? [...p.problemas, destino] : p.problemas,
    vivo: VIVOS.includes(a.status ?? ""),
  };
}

/** Situação para a etiqueta: o pior que acontece nos anúncios vivos da campanha. */
export function rotuloSaude(s: Pick<SaudeCampanha, "vivos" | "semRastreio" | "atencao">): { rotulo: string; tom: "ok" | "alerta" | "erro" | "info" } {
  if (s.semRastreio) return { rotulo: `${s.semRastreio} sem rastreio`, tom: "erro" };
  if (s.atencao) return { rotulo: `${s.atencao} com atenção`, tom: "alerta" };
  if (!s.vivos) return { rotulo: "Nada no ar", tom: "info" };
  return { rotulo: "Rastreada", tom: "ok" };
}

export async function carregarRastreio(supabase: SupabaseClient, orgId: string, campanha: string | null = null) {
  let consulta = supabase
    .from("meta_anuncios")
    .select("ad_id, nome, campaign_id, campaign_name, adset_name, status, url_tags, destinos")
    .eq("organizacao_id", orgId)
    .not("status", "in", FORA);
  let testes = supabase.from("verificacoes_rastreio").select("campaign_id, status, criado_em, verificado_em").eq("organizacao_id", orgId);
  if (campanha) {
    consulta = consulta.eq("campaign_id", campanha);
    testes = testes.eq("campaign_id", campanha);
  }
  const [{ data: anuncios }, { data: conexoes }, { data: verificacoes }] = await Promise.all([
    consulta.order("campaign_name").order("adset_name").order("nome"),
    supabase.from("conexoes").select("tipo").eq("organizacao_id", orgId).in("tipo", TIPOS_PLATAFORMA),
    testes.order("criado_em", { ascending: false }).limit(200),
  ]);
  const checkout = !!conexoes?.length;
  const avaliados: AnuncioAvaliado[] = (anuncios ?? []).map((a) => ({ ...a, destinos: (a.destinos as string[]) ?? [], ...avaliarAnuncio(a, checkout) }));

  const ultimo = new Map<string, TesteRastreio>();
  for (const v of verificacoes ?? []) if (!ultimo.has(v.campaign_id)) ultimo.set(v.campaign_id, v);

  const porCampanha = new Map<string, SaudeCampanha>();
  for (const a of avaliados) {
    if (!a.campaign_id) continue;
    const s = porCampanha.get(a.campaign_id) ?? {
      campaignId: a.campaign_id,
      nome: a.campaign_name ?? a.campaign_id,
      anuncios: 0,
      vivos: 0,
      semRastreio: 0,
      atencao: 0,
      ultimoTeste: ultimo.get(a.campaign_id) ?? null,
    };
    s.anuncios++;
    if (a.vivo) {
      s.vivos++;
      if (a.status_rastreio === "erro") s.semRastreio++;
      else if (a.status_rastreio === "alerta") s.atencao++;
    }
    porCampanha.set(a.campaign_id, s);
  }
  // Problemas primeiro, depois o que está no ar, depois o resto.
  const campanhas = [...porCampanha.values()].sort(
    (a, b) => b.semRastreio - a.semRastreio || b.atencao - a.atencao || b.vivos - a.vivos || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  return { anuncios: avaliados, campanhas, checkout };
}
