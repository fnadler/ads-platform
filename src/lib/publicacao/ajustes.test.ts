import { describe, expect, it } from "vitest";
import { fimDoTeste, nomeConjuntoTeste, payloadConjuntoTeste, podeTirarDoTotal, verbaPorDia, verbaSugeridaTeste } from "./ajustes";

const agora = new Date("2026-11-08T15:00:00Z");

describe("ajustes da campanha", () => {
  it("sugere verba para exibir cada anúncio 3 mil vezes", () => {
    // GN: R$ 14,29 por mil, 2 anúncios → R$ 85,74 → R$ 90.
    expect(verbaSugeridaTeste(2, 14.29, "total")).toBe(90);
    expect(verbaSugeridaTeste(2, 14.29, "diario")).toBe(15);
    expect(verbaSugeridaTeste(1, null, "total")).toBe(60);
  });

  it("dá nome curto ao conjunto de teste", () => {
    expect(nomeConjuntoTeste("GN | Cadastro Loja | A1 ganchos", ["A1 | A repetida", "A1 | C Digitando"])).toBe(
      "GN | Cadastro Loja | A1 ganchos | Teste | A repetida + C Digitando",
    );
  });

  it("copia o público e usa o orçamento do mesmo tipo do original", () => {
    const original = {
      targeting: { geo_locations: { countries: ["BR"] } },
      optimization_goal: "OFFSITE_CONVERSIONS",
      lifetime_budget: "75000",
      end_time: "2026-11-17T02:59:00+0000",
    };
    const p = payloadConjuntoTeste("Teste", "c1", original, 90, "BRL", agora);
    expect(p).toMatchObject({ lifetime_budget: 9000, status: "PAUSED", targeting: original.targeting, campaign_id: "c1" });
    expect(p.end_time).toBe(new Date("2026-11-17T02:59:00Z").toISOString());
    const diario = payloadConjuntoTeste("Teste", "c1", { daily_budget: "5000", lifetime_budget: "0" }, 15, "BRL", agora);
    expect(diario).toMatchObject({ daily_budget: 1500 });
    // A Meta devolve "0" no tipo que o conjunto não usa.
    expect(payloadConjuntoTeste("T", "c1", { lifetime_budget: "75000", daily_budget: "0", end_time: "2026-11-17T02:59:00+0000" }, 90, "BRL", agora)).toMatchObject({
      lifetime_budget: 9000,
    });
    expect(fimDoTeste({ daily_budget: "5000" }, agora).toISOString()).toBe("2026-11-15T15:00:00.000Z");
  });

  it("compara o teste com o teto diário", () => {
    expect(verbaPorDia(90, "total", new Date("2026-11-17T03:00:00Z"), agora)).toBeCloseTo(90 / 8.5);
    expect(verbaPorDia(15, "diario", agora, agora)).toBe(15);
  });

  it("só tira do orçamento total o que não deixa a campanha abaixo do gasto", () => {
    expect(podeTirarDoTotal(750, 330, 90).ok).toBe(true);
    expect(podeTirarDoTotal(750, 640, 90).ok).toBe(false);
    expect(podeTirarDoTotal(80, 0, 90).ok).toBe(false);
  });
});
