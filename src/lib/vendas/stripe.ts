import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Evento } from "./ingestao";

// Adaptador Stripe: transforma faturas, assinaturas e reembolsos em eventos da ingestão comum.
// • Venda = fatura paga com valor (amount_paid > 0). A primeira paga da assinatura marca o pagante.
// • Teste grátis = assinatura criada em "trialing".
// • Reembolso = charge.refunded (valor acumulado, negativo).
// O lead vem do metadata da assinatura (campo configurável, ex.: user_id); sem ele, do metadata do
// cliente; e a venda ainda casa pelo hash do e-mail da fatura.

const idDe = (v: string | { id: string } | null | undefined) => (v ? (typeof v === "string" ? v : v.id) : null);
const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : undefined);

async function leadDoCliente(stripe: Stripe, cliente: string | null, campo: string) {
  if (!cliente) return null;
  try {
    const c = await stripe.customers.retrieve(cliente);
    return ("metadata" in c && c.metadata?.[campo]) || null;
  } catch {
    return null;
  }
}

/** Fatura paga → venda (ou null se não tem valor). */
export async function vendaDaFatura(stripe: Stripe, fatura: Stripe.Invoice, campo: string): Promise<Evento | null> {
  if (!fatura.id || fatura.amount_paid <= 0) return null;
  const detalhes = fatura.parent?.subscription_details;
  const assinatura = idDe(detalhes?.subscription);
  const cliente = idDe(fatura.customer);
  let lead = detalhes?.metadata?.[campo] ?? null;
  if (!lead && assinatura) {
    try {
      lead = (await stripe.subscriptions.retrieve(assinatura)).metadata?.[campo] ?? null;
    } catch {
      /* segue sem */
    }
  }
  lead ??= await leadDoCliente(stripe, cliente, campo);

  // Primeira cobrança com valor desta assinatura (no teste grátis a primeira fatura sai com 0).
  let primeira = fatura.billing_reason === "subscription_create";
  if (assinatura && !primeira) {
    const pagas = await stripe.invoices.list({ subscription: assinatura, status: "paid", limit: 100 });
    const primeiraPaga = pagas.data.filter((f) => f.amount_paid > 0).sort((a, b) => a.created - b.created)[0];
    primeira = primeiraPaga?.id === fatura.id;
  }
  return {
    tipo: "venda",
    id_externo: fatura.id,
    valor: fatura.amount_paid / 100,
    moeda: (fatura.currency || "brl").toUpperCase(),
    ocorrido_em: iso(fatura.status_transitions?.paid_at ?? fatura.created),
    lead_id_externo: lead ?? undefined,
    email: fatura.customer_email ?? undefined,
    primeira,
    cliente_externo: cliente ?? undefined,
  };
}

/** Assinatura que começou em teste grátis → marco "teste iniciado" do lead. */
export function testeDaAssinatura(assinatura: Stripe.Subscription, campo: string): Evento | null {
  const lead = assinatura.metadata?.[campo];
  if (!lead || !assinatura.trial_start) return null;
  return { tipo: "teste_iniciado", id_externo: lead, ocorrido_em: iso(assinatura.trial_start) };
}

/** Cobrança reembolsada → reembolso (negativo). O lead vem da venda anterior do mesmo cliente. */
export async function reembolsoDaCobranca(admin: SupabaseClient, organizacaoId: string, cobranca: Stripe.Charge): Promise<Evento | null> {
  if (!cobranca.amount_refunded) return null;
  const cliente = idDe(cobranca.customer);
  const { data: anterior } = cliente
    ? await admin.from("vendas").select("lead_id_externo").eq("organizacao_id", organizacaoId).eq("cliente_externo", cliente).not("lead_id_externo", "is", null).limit(1).maybeSingle()
    : { data: null };
  return {
    tipo: "reembolso",
    id_externo: `${cobranca.id}:reembolso`,
    valor: cobranca.amount_refunded / 100,
    moeda: (cobranca.currency || "brl").toUpperCase(),
    ocorrido_em: new Date().toISOString(),
    lead_id_externo: anterior?.lead_id_externo ?? undefined,
    email: cobranca.billing_details?.email ?? undefined,
    cliente_externo: cliente ?? undefined,
  };
}
