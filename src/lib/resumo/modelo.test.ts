import { describe, expect, it } from "vitest";
import { zero, type Soma } from "@/app/o/[org]/desempenho/soma";
import { melhorEPior, variacao, type CampanhaResumo } from "./modelo";

const c = (id: string, s: Partial<Soma>): CampanhaResumo => ({ id, nome: id, soma: { ...zero(), ...s } });

describe("variacao", () => {
  it("relativa ao anterior, sem base quando o anterior é zero", () => {
    expect(variacao(120, 100)).toBeCloseTo(0.2);
    expect(variacao(80, 100)).toBeCloseTo(-0.2);
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(null, 10)).toBeNull();
  });
});

describe("melhorEPior", () => {
  it("com venda, julga pelo retorno", () => {
    const r = melhorEPior([c("a", { gasto: 100, vendas: 2, receita: 300 }), c("b", { gasto: 100, vendas: 1, receita: 50 })], "cadastro_venda");
    expect(r?.criterio).toBe("retorno");
    expect(r?.melhor.id).toBe("a");
    expect(r?.pior?.id).toBe("b");
  });
  it("sem venda, julga pelo custo por cadastro; sem cadastro vai para o fim", () => {
    const r = melhorEPior([c("a", { gasto: 100, leads: 10 }), c("b", { gasto: 100, leads: 0 }), c("x", { gasto: 100, leads: 20 })], "cadastro_venda");
    expect(r?.criterio).toBe("cadastro");
    expect(r?.melhor.id).toBe("x");
    expect(r?.pior?.id).toBe("b");
  });
  it("ignora campanha com gasto irrelevante", () => {
    const r = melhorEPior([c("a", { gasto: 1000, vendas: 1, receita: 500 }), c("miuda", { gasto: 5, vendas: 1, receita: 500 })], "cadastro_venda");
    expect(r?.melhor.id).toBe("a");
    expect(r?.pior).toBeNull();
  });
  it("venda direta sem venda: não há como julgar", () => {
    expect(melhorEPior([c("a", { gasto: 100, leads: 3 })], "venda_direta")).toBeNull();
  });
  it("empate não vira pior", () => {
    const r = melhorEPior([c("a", { gasto: 100, vendas: 1, receita: 100 }), c("b", { gasto: 100, vendas: 1, receita: 100 })], "cadastro_venda");
    expect(r?.pior).toBeNull();
  });
});
