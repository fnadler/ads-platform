// Teste cancelado antes da cobrança: leitura das assinaturas do Stripe e regras da ingestão.
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cancelamentoDoTeste, situacaoDoTeste } = await import("./stripe");
const { Evento, processarEvento } = await import("./ingestao");
const { linhaParaEvento } = await import("./csv");

const assinatura = (campos: Partial<Stripe.Subscription>) =>
  ({ id: "sub_1", customer: "cus_1", created: 100, status: "trialing", trial_start: 100, cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null, metadata: { user_id: "u1" }, ...campos }) as Stripe.Subscription;
const comAssinaturas = (lista: Stripe.Subscription[]) => ({ subscriptions: { list: vi.fn(async () => ({ data: lista })) } }) as unknown as Stripe;

describe("situação do teste", () => {
  it("cancelar durante o teste conta na hora, com a data do pedido", () => {
    expect(situacaoDoTeste(assinatura({ cancel_at_period_end: true, canceled_at: 1_800_000_000 }), "u1")).toEqual({ tipo: "teste_cancelado", id_externo: "u1", ocorrido_em: new Date(1_800_000_000_000).toISOString() });
    expect(situacaoDoTeste(assinatura({ cancel_at: 200 }), "u1")?.tipo).toBe("teste_cancelado");
    expect(situacaoDoTeste(assinatura({ status: "canceled" }), "u1")?.tipo).toBe("teste_cancelado");
  });

  it("em teste sem cancelamento reativa; ativa ou sem teste não marca nada", () => {
    expect(situacaoDoTeste(assinatura({}), "u1")?.tipo).toBe("teste_reativado");
    expect(situacaoDoTeste(assinatura({ status: "active" }), "u1")).toBeNull();
    expect(situacaoDoTeste(assinatura({ status: "canceled", trial_start: null }), "u1")).toBeNull();
  });
});

describe("cancelamento pela assinatura mais recente", () => {
  it("cancelou uma e iniciou outra: segue em teste", async () => {
    const antiga = assinatura({ id: "sub_1", created: 100, status: "canceled" });
    const nova = assinatura({ id: "sub_2", created: 200 });
    expect((await cancelamentoDoTeste(comAssinaturas([antiga, nova]), antiga, "user_id"))?.tipo).toBe("teste_reativado");
  });

  it("evento atrasado não vence o estado atual", async () => {
    const atrasado = assinatura({});
    expect((await cancelamentoDoTeste(comAssinaturas([assinatura({ cancel_at_period_end: true })]), atrasado, "user_id"))?.tipo).toBe("teste_cancelado");
  });

  it("não consulta o Stripe para assinatura ativa ou sem lead", async () => {
    const stripe = comAssinaturas([]);
    expect(await cancelamentoDoTeste(stripe, assinatura({ status: "active" }), "user_id")).toBeNull();
    expect(await cancelamentoDoTeste(stripe, assinatura({ metadata: {} }), "user_id")).toBeNull();
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });
});

/** Cliente falso do Supabase: um lead e o registro do que foi gravado. */
function contexto(lead: Record<string, unknown> | null) {
  const gravado: Array<Record<string, unknown>> = [];
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: lead }) }) }) }),
      update: (campos: Record<string, unknown>) => ({ eq: async () => (gravado.push(campos), { error: null }) }),
      upsert: (campos: Record<string, unknown>) => {
        if (!("chave_idempotencia" in campos)) gravado.push(campos);
        return Object.assign(Promise.resolve({ error: null }), { select: () => ({ single: async () => ({ data: { id: "novo" }, error: null }) }) });
      },
    }),
  } as unknown as SupabaseClient;
  return { ctx: { admin, organizacaoId: "org", conexaoId: null, origem: "stripe" as const }, gravado };
}
const cancelado = { tipo: "teste_cancelado", id_externo: "u1", ocorrido_em: "2026-11-02T05:10:00Z" } as const;

describe("ingestão do cancelamento", () => {
  it("marca o lead com a data do cancelamento", async () => {
    const { ctx, gravado } = contexto({ id: "l1", teste_cancelado_em: null, primeiro_pagamento_em: null });
    await processarEvento(ctx, cancelado);
    expect(gravado).toEqual([{ id_externo: "u1", teste_cancelado_em: "2026-11-02T05:10:00.000Z" }]);
  });

  it("quem já pagou não vira teste cancelado, e o primeiro cancelamento não muda", async () => {
    const pagou = contexto({ id: "l1", teste_cancelado_em: null, primeiro_pagamento_em: "2026-11-09T00:00:00Z" });
    await processarEvento(pagou.ctx, cancelado);
    expect(pagou.gravado).toEqual([]);
    const repetido = contexto({ id: "l1", teste_cancelado_em: "2026-11-01T00:00:00Z", primeiro_pagamento_em: null });
    await processarEvento(repetido.ctx, cancelado);
    expect(repetido.gravado).toEqual([]);
  });

  it("reativar limpa o cancelamento; sem cancelamento não grava nada", async () => {
    const reativado = { tipo: "teste_reativado", id_externo: "u1" } as const;
    const com = contexto({ id: "l1", teste_cancelado_em: "2026-11-01T00:00:00Z", primeiro_pagamento_em: null });
    await processarEvento(com.ctx, reativado);
    expect(com.gravado).toEqual([{ id_externo: "u1", teste_cancelado_em: null }]);
    const sem = contexto({ id: "l1", teste_cancelado_em: null, primeiro_pagamento_em: null });
    await processarEvento(sem.ctx, reativado);
    expect(sem.gravado).toEqual([]);
  });

  it("chega também por webhook genérico e CSV", () => {
    expect(Evento.safeParse({ tipo: "teste_cancelado", id_externo: "u1" }).success).toBe(true);
    expect(Evento.safeParse(linhaParaEvento({ tipo: "teste_reativado", id_externo: "u1" })).success).toBe(true);
  });
});
