import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { codigoTeste, CorpoWebhook, Evento, hashEmail, hashTelefone } = await import("./ingestao");

describe("contrato do webhook", () => {
  it("aceita o lead como o GN Coleciona envia (lib/adsPlatform.ts)", () => {
    const r = Evento.safeParse({
      tipo: "lead",
      id_externo: "5b1f0d1e-0000-4000-8000-000000000001",
      ocorrido_em: "2026-11-03T17:05:12.345678+00:00",
      email: "Cliente@Exemplo.com",
      atribuicao: { utm_source: "meta", utm_campaign: "GN Cadastro", utm_campaign_id: "120211", utm_adset_id: "120212", utm_ad_id: "120213", fbclid: "abc", landing_path: "/" },
      primeiro_toque: { utm_source: "meta", utm_ad_id: "120299", landing_path: "/" },
    });
    expect(r.success).toBe(true);
  });

  it("aceita lote e recusa evento sem id", () => {
    expect(CorpoWebhook.safeParse({ eventos: [{ tipo: "lead" }] }).success).toBe(true);
    expect(Evento.safeParse({ tipo: "lead" }).success).toBe(false);
    expect(Evento.safeParse({ tipo: "venda", id_externo: "p1", valor: "21.5" }).success).toBe(true);
    expect(Evento.safeParse({ tipo: "venda", id_externo: "p1" }).success).toBe(false);
  });
});

describe("dados pessoais", () => {
  it("hash do e-mail ignora caixa e espaços; telefone ganha o 55", () => {
    expect(hashEmail(" Cliente@Exemplo.com ")).toBe(hashEmail("cliente@exemplo.com"));
    expect(hashTelefone("(11) 98888-7777")).toBe(hashTelefone("+55 11 98888-7777"));
    expect(hashEmail("")).toBeNull();
  });

  it("acha o código do lead de teste no e-mail ou no nome", () => {
    expect(codigoTeste("voce+rastreio-4F9A2C@gmail.com")).toBe("4f9a2c");
    expect(codigoTeste(undefined, "Teste rastreio-abc123")).toBe("abc123");
    expect(codigoTeste("voce@gmail.com")).toBeNull();
  });
});
