import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fatos, Onboarding } from "./modelo";
import { usaCheckoutExterno } from "./modelo";

export interface LinhaEvento {
  tipo: string;
  chave_idempotencia: string;
  payload: Record<string, unknown>;
  recebido_em: string;
  erro: string | null;
}

const trazAnuncio = (e: LinhaEvento) => {
  const lista = e.tipo === "teste" ? ((e.payload.eventos as Array<Record<string, unknown>>) ?? []) : [e.payload];
  return lista.some((v) => !!(v.atribuicao as { utm_ad_id?: string } | undefined)?.utm_ad_id);
};

/** Lê o que o sistema sabe sobre a configuração da organização (com o RLS de quem chama). */
export async function lerFatos(
  supabase: SupabaseClient,
  orgId: string,
  onboarding: Onboarding,
): Promise<Fatos & { conexaoPlataforma?: { id: string; status: string; config: { modo_teste?: boolean } }; eventos: LinhaEvento[] }> {
  const [{ data: conexoes }, { data: contas }, { data: config }, { data: testes }] = await Promise.all([
    supabase.from("conexoes").select("id, tipo, status, config").eq("organizacao_id", orgId),
    supabase.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId).eq("ativa", true).limit(1),
    supabase.from("config_publicacao").select("pixel_id, page_id").eq("organizacao_id", orgId).maybeSingle(),
    supabase.from("verificacoes_rastreio").select("id").eq("organizacao_id", orgId).eq("status", "ok").limit(1),
  ]);
  const de = (tipo: string) => conexoes?.find((c) => c.tipo === tipo);
  const conexaoPlataforma = usaCheckoutExterno(onboarding) ? de(String(onboarding.plataforma)) : undefined;
  const { data: recebidos } = conexaoPlataforma
    ? await supabase
        .from("eventos_recebidos")
        .select("tipo, chave_idempotencia, payload, recebido_em, erro")
        .eq("conexao_id", conexaoPlataforma.id)
        .order("recebido_em", { ascending: false })
        .limit(20)
    : { data: [] };
  const eventos = (recebidos ?? []) as LinhaEvento[];
  return {
    onboarding,
    temToken: de("meta")?.status === "ativa",
    temPublicacao: de("meta_publicacao")?.status === "ativa",
    contaAtiva: !!contas?.length,
    pixelId: config?.pixel_id ?? null,
    paginaFacebookId: config?.page_id ?? null,
    stripeAtivo: de("stripe")?.status === "ativa",
    webhookAtivo: de("webhook")?.status === "ativa",
    plataformaAtiva: conexaoPlataforma?.status === "ativa",
    plataformaEmTeste: (conexaoPlataforma?.config as { modo_teste?: boolean } | undefined)?.modo_teste !== false,
    eventosPlataforma: eventos.filter((e) => !e.erro).length,
    eventoComAnuncio: eventos.some((e) => !e.erro && trazAnuncio(e)),
    testeLeadOk: !!testes?.length,
    conexaoPlataforma: conexaoPlataforma as { id: string; status: string; config: { modo_teste?: boolean } } | undefined,
    eventos,
  };
}
