import { describe, expect, it } from "vitest";
import { comDias, intervalo, lerDias } from "./periodo";

describe("periodo", () => {
  it("lê só os períodos conhecidos", () => {
    expect(lerDias("30")).toBe(30);
    expect(lerDias("31")).toBe(7);
    expect(lerDias(undefined)).toBe(7);
  });
  it("o período anterior encosta no atual, do mesmo tamanho", () => {
    const agora = Date.parse("2026-11-11T15:00:00Z");
    expect(intervalo(7, "America/Sao_Paulo", agora)).toEqual({ de: "2026-11-05", ate: "2026-11-11", deAnterior: "2026-10-29", ateAnterior: "2026-11-04" });
  });
  it("leva o período no endereço, sem o padrão", () => {
    expect(comDias("/o/x/vendas", 7)).toBe("/o/x/vendas");
    expect(comDias("/o/x/vendas", 30)).toBe("/o/x/vendas?dias=30");
    expect(comDias("/o/x/vendas?campanha=1", 14)).toBe("/o/x/vendas?campanha=1&dias=14");
  });
});
