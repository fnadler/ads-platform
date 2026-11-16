import { describe, expect, it } from "vitest";
import { efeitoDoMarco, marcosDeOperacoes, type OperacaoMeta } from "./marcos";

// Caso real: GN Coleciona, campanha "GN | Cadastro Loja | A1 ganchos" (nov/2026).
const CAMP = "120248425685830436";
const A = "120248425706090436";
const B = "120248425706140436";
const C = "120248425708100436";
const D = "120248425707540436";
const CONJ = "120248425685900436";
const nomes = {
  campanhaId: CAMP,
  anuncios: new Map([
    [A, "A1 | A repetida"],
    [B, "A1 | B Gaveta"],
    [C, "A1 | C Digitando"],
    [D, "A1 | D Como Vender"],
  ]),
  conjuntos: new Map([[CONJ, "GN | Cadastro Loja | A1 ganchos | BR 18-65 | Advantage+"]]),
};
const op = (criado_em: string, caminho: string, parametros: Record<string, unknown>, status_http = 200): OperacaoMeta => ({
  criado_em,
  caminho,
  parametros,
  status_http,
  resposta: null,
  usuario_id: "u1",
});
const OPS: OperacaoMeta[] = [
  op("2026-11-01T01:28:06Z", "act_1/advideos", { name: "A1 | A repetida" }),
  op("2026-11-01T01:29:03Z", "act_1/campaigns", { status: "PAUSED", name: "GN | Cadastro Loja | A1 ganchos" }),
  op("2026-11-01T01:29:05Z", "act_1/adsets", { status: "PAUSED", name: "GN | Cadastro Loja | A1 ganchos | BR 18-65 | Advantage+" }),
  op("2026-11-01T01:29:10Z", "act_1/adcreatives", { name: "A1 | A repetida" }, 400),
  op("2026-11-01T01:37:03Z", "act_1/ads", { status: "PAUSED", name: "A1 | A repetida" }),
  op("2026-11-01T01:49:21Z", A, { status: "ACTIVE" }),
  op("2026-11-01T01:49:22Z", B, { status: "ACTIVE" }),
  op("2026-11-01T01:49:23Z", D, { status: "ACTIVE" }),
  op("2026-11-01T01:49:25Z", C, { status: "ACTIVE" }),
  op("2026-11-01T01:49:26Z", CONJ, { status: "ACTIVE" }),
  op("2026-11-01T01:49:27Z", CAMP, { status: "ACTIVE" }),
  op("2026-11-09T01:30:16Z", C, { status: "PAUSED" }),
  op("2026-11-12T21:53:47Z", CAMP, { status: "PAUSED" }),
  op("2026-11-13T15:19:32Z", CAMP, { status: "ACTIVE" }),
  op("2026-11-16T12:04:19Z", CAMP, { status: "PAUSED" }),
];

const GASTOS = [
  { dia: "2026-11-05", ad_id: A, gasto: 1.9 },
  { dia: "2026-11-05", ad_id: B, gasto: 29.02 },
  { dia: "2026-11-05", ad_id: D, gasto: 6.25 },
  { dia: "2026-11-05", ad_id: C, gasto: 0.05 },
  { dia: "2026-11-06", ad_id: C, gasto: 0.38 },
  { dia: "2026-11-06", ad_id: A, gasto: 1.85 },
  { dia: "2026-11-06", ad_id: B, gasto: 29.0 },
  { dia: "2026-11-06", ad_id: D, gasto: 7.06 },
  { dia: "2026-11-07", ad_id: D, gasto: 12.56 },
  { dia: "2026-11-07", ad_id: C, gasto: 2.68 },
  { dia: "2026-11-07", ad_id: B, gasto: 35.5 },
  { dia: "2026-11-07", ad_id: A, gasto: 3.26 },
  { dia: "2026-11-08", ad_id: D, gasto: 10.44 },
  { dia: "2026-11-08", ad_id: B, gasto: 36.8 },
  { dia: "2026-11-08", ad_id: C, gasto: 0.87 },
  { dia: "2026-11-08", ad_id: A, gasto: 2.45 },
  { dia: "2026-11-09", ad_id: D, gasto: 27.06 },
  { dia: "2026-11-09", ad_id: A, gasto: 2.85 },
  { dia: "2026-11-09", ad_id: B, gasto: 11.65 },
  { dia: "2026-11-10", ad_id: D, gasto: 23.16 },
  { dia: "2026-11-10", ad_id: B, gasto: 11.25 },
  { dia: "2026-11-10", ad_id: A, gasto: 3.28 },
  { dia: "2026-11-11", ad_id: D, gasto: 24.55 },
  { dia: "2026-11-11", ad_id: B, gasto: 23.06 },
  { dia: "2026-11-11", ad_id: A, gasto: 3.23 },
];
const RESULTADOS = [
  { dia: "2026-11-05", gasto: 37.22, leads: 11 },
  { dia: "2026-11-06", gasto: 38.29, leads: 12 },
  { dia: "2026-11-07", gasto: 54.0, leads: 9 },
  { dia: "2026-11-08", gasto: 50.56, leads: 15 },
  { dia: "2026-11-09", gasto: 41.56, leads: 15 },
  { dia: "2026-11-10", gasto: 37.69, leads: 14 },
  { dia: "2026-11-11", gasto: 50.84, leads: 7 },
];

describe("marcosDeOperacoes — caso GN", () => {
  const marcos = marcosDeOperacoes(OPS, nomes, "America/Sao_Paulo", "BRL");

  it("vira uma linha do tempo legível, sem a montagem peça por peça", () => {
    expect(marcos.map((m) => [m.dia, m.tipo])).toEqual([
      ["2026-10-31", "criada"],
      ["2026-10-31", "ativada"],
      ["2026-11-08", "pausa_anuncio"],
      ["2026-11-12", "pausa_campanha"],
      ["2026-11-13", "retomada_campanha"],
      ["2026-11-16", "pausa_campanha"],
    ]);
  });

  it("dá nome ao anúncio pausado", () => {
    expect(marcos[2].rotulo).toBe("Pausou o anúncio “A1 | C Digitando”");
    expect(marcos[2].adId).toBe(C);
  });

  it("ignora operação que falhou e lê verba e teste de anúncios", () => {
    const mais = marcosDeOperacoes(
      [
        op("2026-11-10T12:00:00Z", CAMP, { lifetime_budget: 90000 }),
        op("2026-11-10T13:00:00Z", "act_1/adsets", { name: "GN | Cadastro Loja | A1 ganchos | Teste | A repetida" }),
        op("2026-11-10T14:00:00Z", B, { status: "PAUSED" }, 400),
      ],
      nomes,
      "America/Sao_Paulo",
      "BRL",
    );
    expect(mais.map((m) => m.rotulo.replace(/\u00a0/g, " "))).toEqual(["Mudou a verba da campanha para R$ 900,00 no total", "Criou um teste com verba própria: A repetida"]);
  });
});

describe("efeitoDoMarco — a pausa de 08/11 tirou a verba do anúncio que vendia", () => {
  const pausa = marcosDeOperacoes(OPS, nomes, "America/Sao_Paulo", "BRL").find((m) => m.tipo === "pausa_anuncio")!;
  const e = efeitoDoMarco(pausa, GASTOS, RESULTADOS, "2026-11-16");

  it("compara 3 dias antes com 3 dias depois, sem o dia da mudança", () => {
    expect(e.antes.dias).toBe(3);
    expect(e.depois.dias).toBe(3);
  });

  it("aponta quem ganhou e quem perdeu verba", () => {
    expect(e.ganhou?.adId).toBe(D);
    expect(e.ganhou!.de).toBeCloseTo(0.2, 1);
    expect(e.ganhou!.para).toBeGreaterThan(0.5);
    expect(e.perdeu?.adId).toBe(B);
    expect(e.perdeu!.de).toBeGreaterThan(0.7);
    expect(e.perdeu!.para).toBeLessThan(0.4);
  });

  it("depois do último dia completo não inventa dados", () => {
    const recente = efeitoDoMarco({ ...pausa, dia: "2026-11-11" }, GASTOS, RESULTADOS, "2026-11-12");
    expect(recente.depois.dias).toBe(0);
  });
});
