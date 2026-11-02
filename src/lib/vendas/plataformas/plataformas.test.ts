// Tradução dos webhooks e regras de recebimento. As amostras seguem a documentação das plataformas.
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { Evento, processarEvento } = await import("../ingestao");
const { hotmart } = await import("./hotmart");
const { kiwify } = await import("./kiwify");
const { receberEvento } = await import("./receber");
const { SCRIPT_CHECKOUT } = await import("./catalogo");
const { dataIso, idMeta } = await import("./comum");

const compraHotmart = (evento: string, extra: Record<string, unknown> = {}) => ({
  id: "entrega-1",
  event: evento,
  version: "2.0.0",
  creation_date: 1_793_000_000_000,
  data: {
    buyer: { email: "Comprador@Exemplo.com", name: "Comprador" },
    purchase: {
      transaction: "HP123",
      status: "APPROVED",
      approved_date: 1_793_000_100_000,
      price: { value: 197.5, currency_value: "BRL" },
      origin: { sck: "120248425685830436", src: "120248425685830000" },
      ...extra,
    },
  },
});
const pedidoKiwify = (evento: string, extra: Record<string, unknown> = {}) => ({
  order_id: "pedido-1",
  webhook_event_type: evento,
  approved_date: "2026-11-02 10:30",
  Customer: { email: "cliente@exemplo.com" },
  Commissions: { charge_amount: 9700, currency: "BRL" },
  TrackingParameters: { sck: "120248425685830436", src: "120248425685830000", utm_source: "meta" },
  ...extra,
});
const req = (corpo: string, cabecalhos: Record<string, string> = {}, url = "https://x.test/") => ({ corpo, cabecalhos: new Headers(cabecalhos), url: new URL(url) });

describe("Hotmart", () => {
  it("autentica pelo Hottok no cabeçalho ou no corpo", () => {
    expect(hotmart.autenticar(req("{}", { "x-hotmart-hottok": "segredo-certo" }), "segredo-certo")).toBe(true);
    expect(hotmart.autenticar(req('{"hottok":"segredo-certo"}'), "segredo-certo")).toBe(true);
    expect(hotmart.autenticar(req("{}", { "x-hotmart-hottok": "outro" }), "segredo-certo")).toBe(false);
    expect(hotmart.autenticar(req("{}"), "segredo-certo")).toBe(false);
    expect(hotmart.autenticar(req("nao é json"), "segredo-certo")).toBe(false);
  });

  it("compra aprovada vira venda com o anúncio do sck e passa na validação", () => {
    const [cru] = hotmart.traduzir(compraHotmart("PURCHASE_APPROVED")).eventos;
    expect(Evento.parse(cru)).toMatchObject({
      tipo: "venda",
      id_externo: "HP123",
      valor: 197.5,
      moeda: "BRL",
      primeira: true,
      ocorrido_em: new Date(1_793_000_100_000).toISOString(),
      atribuicao: { utm_ad_id: "120248425685830436", utm_campaign_id: "120248425685830000" },
    });
  });

  it("conta a comissão líquida do produtor, não o preço pago", () => {
    const comissoes = (commissions: unknown[]) => {
      const c = compraHotmart("PURCHASE_APPROVED");
      return hotmart.traduzir({ ...c, data: { ...c.data, commissions } }).eventos[0];
    };
    const divisao = [
      { value: 19.75, currency_value: "BRL", source: "MARKETPLACE" },
      { value: 80, currency_value: "BRL", source: "AFFILIATE" },
      { value: 97.75, currency_value: "BRL", source: "PRODUCER" },
    ];
    expect(Evento.parse(comissoes(divisao))).toMatchObject({ valor: 97.75, moeda: "BRL" });
    expect(
      Evento.parse(
        comissoes([{ value: 20, currency_value: "USD", source: "PRODUCER", currency_conversion: { converted_value: 110, converted_to_currency: "BRL", conversion_rate: 5.5 } }]),
      ),
    ).toMatchObject({ valor: 110, moeda: "BRL" });
    expect(Evento.parse(comissoes([{ value: 19.75, currency_value: "BRL", source: "MARKETPLACE" }]))).toMatchObject({ valor: 197.5 });
  });

  it("aceita também o formato purchase.tracking", () => {
    const [cru] = hotmart.traduzir(compraHotmart("PURCHASE_APPROVED", { origin: undefined, tracking: { source_sck: "120248425685830436", source: "120248425685830000" } })).eventos;
    expect((cru as { atribuicao: unknown }).atribuicao).toEqual({ utm_ad_id: "120248425685830436", utm_campaign_id: "120248425685830000" });
  });

  it("sck que não é ID de anúncio não vira atribuição", () => {
    const [cru] = hotmart.traduzir(compraHotmart("PURCHASE_APPROVED", { origin: { sck: "instagram_bio" } })).eventos;
    expect((cru as { atribuicao: { utm_ad_id?: string } }).atribuicao.utm_ad_id).toBeUndefined();
  });

  it("renovação não é a primeira compra", () => {
    const [cru] = hotmart.traduzir(compraHotmart("PURCHASE_APPROVED", { recurrence_number: 2 })).eventos;
    expect((cru as { primeira: boolean }).primeira).toBe(false);
  });

  it.each([
    ["PURCHASE_COMPLETE", "venda", "HP123"],
    ["PURCHASE_BILLET_PRINTED", "venda_pendente", "HP123"],
    ["PURCHASE_EXPIRED", "venda_expirada", "HP123"],
    ["PURCHASE_CANCELED", "venda_expirada", "HP123"],
    ["PURCHASE_REFUNDED", "reembolso", "HP123:reembolso"],
    ["PURCHASE_CHARGEBACK", "chargeback", "HP123:chargeback"],
  ])("%s → %s", (evento, tipo, id) => {
    expect(Evento.parse(hotmart.traduzir(compraHotmart(evento)).eventos[0])).toMatchObject({ tipo, id_externo: id });
  });

  it("eventos que não mudam os números são ignorados", () => {
    expect(hotmart.traduzir(compraHotmart("SWITCH_PLAN")).eventos).toEqual([]);
    expect(hotmart.traduzir({}).eventos).toEqual([]);
  });

  it("compra sem transação ou sem valor é recusada pela validação", () => {
    expect(Evento.safeParse(hotmart.traduzir(compraHotmart("PURCHASE_APPROVED", { transaction: undefined })).eventos[0]).success).toBe(false);
    expect(Evento.safeParse(hotmart.traduzir(compraHotmart("PURCHASE_APPROVED", { price: {} })).eventos[0]).success).toBe(false);
  });
});

describe("Kiwify", () => {
  const assinar = (corpo: string, token: string) => createHmac("sha1", token).update(corpo).digest("hex");

  it("confere o HMAC-SHA1 do corpo exato", () => {
    const corpo = JSON.stringify(pedidoKiwify("order_approved"));
    expect(kiwify.autenticar(req(corpo, {}, `https://x.test/?signature=${assinar(corpo, "token-certo")}`), "token-certo")).toBe(true);
    expect(kiwify.autenticar(req(`${corpo} `, {}, `https://x.test/?signature=${assinar(corpo, "token-certo")}`), "token-certo")).toBe(false);
    expect(kiwify.autenticar(req(corpo, {}, `https://x.test/?signature=${assinar(corpo, "outro")}`), "token-certo")).toBe(false);
    expect(kiwify.autenticar(req(corpo), "token-certo")).toBe(false);
  });

  it("compra aprovada: centavos em reais, anúncio no sck e data em Brasília", () => {
    expect(Evento.parse(kiwify.traduzir(pedidoKiwify("order_approved")).eventos[0])).toMatchObject({
      tipo: "venda",
      id_externo: "pedido-1",
      valor: 97,
      primeira: true,
      ocorrido_em: "2026-11-02T13:30:00.000Z",
      atribuicao: { utm_ad_id: "120248425685830436", utm_campaign_id: "120248425685830000" },
    });
  });

  it.each([
    ["pix_created", "venda_pendente", "pedido-1"],
    ["billet_created", "venda_pendente", "pedido-1"],
    ["order_rejected", "venda_expirada", "pedido-1"],
    ["order_refunded", "reembolso", "pedido-1:reembolso"],
    ["chargeback", "chargeback", "pedido-1:chargeback"],
    ["subscription_renewed", "venda", "pedido-1"],
  ])("%s → %s", (evento, tipo, id) => {
    expect(Evento.parse(kiwify.traduzir(pedidoKiwify(evento)).eventos[0])).toMatchObject({ tipo, id_externo: id });
  });

  it("sem valor, recusa em vez de gravar venda zerada", () => {
    expect(Evento.safeParse(kiwify.traduzir(pedidoKiwify("order_approved", { Commissions: {} })).eventos[0]).success).toBe(false);
  });

  it("carrinho abandonado e cancelamento de assinatura não mudam os números", () => {
    expect(kiwify.traduzir({ checkout_link: "x", status: "abandoned" }).eventos).toEqual([]);
    expect(kiwify.traduzir(pedidoKiwify("subscription_canceled")).eventos).toEqual([]);
  });
});

/** Cliente falso: guarda as gravações e responde o select da venda atual. */
function contexto(vendaAtual: { tipo: string } | null = null) {
  const vendas: Array<Record<string, unknown>> = [];
  const eventos: Array<Record<string, unknown>> = [];
  const admin = {
    from: (tabela: string) => {
      const encadeado = { eq: () => encadeado, is: () => encadeado, maybeSingle: async () => ({ data: vendaAtual }) };
      return {
        select: () => encadeado,
        update: () => encadeado,
        upsert: async (linha: Record<string, unknown>) => {
          (tabela === "vendas" ? vendas : eventos).push(linha);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { ctx: { admin, organizacaoId: "org", conexaoId: "cx", origem: "hotmart" as const }, vendas, eventos };
}

describe("estados da venda", () => {
  const venda = { id_externo: "HP1", valor: 100, moeda: "BRL" };

  it("chargeback e reembolso entram negativos", async () => {
    for (const tipo of ["chargeback", "reembolso"] as const) {
      const { ctx, vendas } = contexto();
      await processarEvento(ctx, { ...venda, tipo });
      expect(vendas[0]).toMatchObject({ tipo, valor: -100 });
    }
  });

  it("Pix gerado fica pendente e o pagamento confirma no mesmo id", async () => {
    const { ctx, vendas } = contexto();
    await processarEvento(ctx, { ...venda, tipo: "venda_pendente" });
    expect(vendas[0]).toMatchObject({ tipo: "pendente", valor: 100, id_externo: "HP1" });
    const pago = contexto({ tipo: "pendente" });
    await processarEvento(pago.ctx, { ...venda, tipo: "venda" });
    expect(pago.vendas[0]).toMatchObject({ tipo: "pagamento", id_externo: "HP1" });
  });

  it("evento atrasado não desfaz um pagamento", async () => {
    for (const tipo of ["venda_pendente", "venda_expirada"] as const) {
      const { ctx, vendas } = contexto({ tipo: "pagamento" });
      await processarEvento(ctx, { ...venda, tipo });
      expect(vendas).toEqual([]);
    }
  });
});

describe("recebimento", () => {
  it("modo de teste registra o que foi entendido, sem criar venda e sem o e-mail", async () => {
    const { ctx, vendas, eventos } = contexto();
    expect(await receberEvento(ctx, hotmart, true, compraHotmart("PURCHASE_APPROVED"))).toEqual({ evento: "PURCHASE_APPROVED", aceitos: 0 });
    expect(vendas).toEqual([]);
    expect(eventos[0]).toMatchObject({ tipo: "teste", erro: null, chave_idempotencia: "teste:PURCHASE_APPROVED:HP123" });
    expect(JSON.stringify(eventos[0])).toContain("197.5");
    expect(JSON.stringify(eventos[0]).toLowerCase()).not.toContain("comprador@");
  });

  it("modo de teste também mostra os eventos ignorados", async () => {
    const { ctx, eventos } = contexto();
    await receberEvento(ctx, hotmart, true, compraHotmart("SWITCH_PLAN"));
    expect(eventos[0]).toMatchObject({ tipo: "teste", payload: { evento: "SWITCH_PLAN", eventos: [] } });
  });

  it("fora do modo de teste, a venda entra", async () => {
    const { ctx, vendas } = contexto();
    expect((await receberEvento(ctx, hotmart, false, compraHotmart("PURCHASE_APPROVED"))).aceitos).toBe(1);
    expect(vendas[0]).toMatchObject({ tipo: "pagamento", utm_ad_id: "120248425685830436", origem: "hotmart" });
  });

  it("evento fora do formato vira erro visível, sem venda", async () => {
    const { ctx, vendas, eventos } = contexto();
    await receberEvento(ctx, hotmart, false, compraHotmart("PURCHASE_APPROVED", { price: {} }));
    expect(vendas).toEqual([]);
    expect(eventos[0]).toMatchObject({ tipo: "invalido" });
    expect(String(eventos[0].erro)).toMatch(/PURCHASE_APPROVED.*valor/);
  });
});

describe("apoios", () => {
  it("idMeta e dataIso", () => {
    expect(idMeta("120248425685830436")).toBe("120248425685830436");
    expect(idMeta("abc")).toBeUndefined();
    expect(idMeta("123")).toBeUndefined();
    expect(dataIso(1_793_000_000_000)).toBe(new Date(1_793_000_000_000).toISOString());
    expect(dataIso("2026-11-02 10:30")).toBe("2026-11-02T13:30:00.000Z");
    expect(dataIso("2026-11-02T10:30:00Z")).toBe("2026-11-02T10:30:00.000Z");
    expect(dataIso("lixo")).toBeUndefined();
  });

  it("o script leva os parâmetros ao link de compra sem sobrescrever os que existem", () => {
    const codigo = SCRIPT_CHECKOUT.replace(/^<script>|<\/script>$/g, "");
    const links = [{ href: "https://pay.hotmart.com/ABC?off=1" }, { href: "https://pay.hotmart.com/ABC?sck=fixo" }];
    const document = { addEventListener: (_: string, f: () => void) => f(), querySelectorAll: () => links };
    new Function("document", "location", codigo)(document, { search: "?sck=120248425685830436&src=99&outro=x" });
    expect(new URL(links[0].href).searchParams.get("sck")).toBe("120248425685830436");
    expect(new URL(links[0].href).searchParams.get("src")).toBe("99");
    expect(new URL(links[0].href).searchParams.get("outro")).toBeNull();
    expect(new URL(links[1].href).searchParams.get("sck")).toBe("fixo");
  });
});
