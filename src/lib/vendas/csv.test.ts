import { describe, expect, it } from "vitest";
import { dataIso, lerCsv, linhaParaEvento, valorNumerico } from "./csv";

describe("csv", () => {
  it("lê ponto e vírgula com aspas", () => {
    const r = lerCsv('id_externo;valor;nome\n"p1";"1.234,56";"Ana ""A"""\np2;21,50;Bia\n');
    expect(r).toEqual([
      { id_externo: "p1", valor: "1.234,56", nome: 'Ana "A"' },
      { id_externo: "p2", valor: "21,50", nome: "Bia" },
    ]);
  });

  it("converte valores e datas brasileiros", () => {
    expect(valorNumerico("R$ 1.234,56")).toBe(1234.56);
    expect(valorNumerico("1234.56")).toBe(1234.56);
    expect(dataIso("03/11/2026 14:05")).toBe("2026-11-03T14:05:00-03:00");
  });

  it("linha com valor vira venda com atribuição", () => {
    expect(linhaParaEvento({ id_externo: "p1", valor: "21,50", utm_ad_id: "123456", data: "2026-11-03" })).toMatchObject({
      tipo: "venda",
      valor: 21.5,
      atribuicao: { utm_ad_id: "123456" },
      ocorrido_em: "2026-11-03T12:00:00-03:00",
    });
  });
});
