import { describe, expect, it } from "vitest";
import { mediana, mesesParaPagar, textoMeses } from "./payback";

describe("payback de assinatura — caso GN", () => {
  it("mensalidade pela mediana dos pagamentos (ignora reembolso e zero)", () => {
    expect(mediana([19.9, 19.9, 19.9, -19.9, 0, 9.9])).toBe(19.9);
  });
  it("R$ 712 por 6 assinantes a R$ 19,90: cerca de 6 meses; com 11, cerca de 3", () => {
    expect(textoMeses(mesesParaPagar(712.07, 6, 19.9)!)).toBe("cerca de 6 meses");
    expect(textoMeses(mesesParaPagar(712.07, 11, 19.9)!)).toBe("cerca de 3 meses");
  });
  it("sem assinante ou sem mensalidade, não há payback", () => {
    expect(mesesParaPagar(100, 0, 19.9)).toBeNull();
    expect(mesesParaPagar(100, 3, null)).toBeNull();
    expect(textoMeses(0.6)).toBe("menos de 1 mês");
    expect(textoMeses(1.2)).toBe("cerca de 1 mês");
  });
});
