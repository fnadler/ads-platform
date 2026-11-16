import { describe, expect, it } from "vitest";
import type { Achado } from "@/lib/leitura/modelo";
import { montarBalanco, type EntradaBalanco } from "./modelo";

// Caso real: GN Coleciona, campanha "GN | Cadastro Loja | A1 ganchos", pausada em 16/11/2026.
// O balanço tem de chegar às mesmas conclusões da análise feita à mão.
const achado = (id: string, extra: Partial<Achado> = {}): Achado => ({ id, tom: "observar", area: "geral", titulo: id, detalhe: "", ...extra });

const GN: EntradaBalanco = {
  funil: "cadastro_teste_venda",
  moeda: "BRL",
  hoje: "2026-11-16",
  de: "2026-11-01",
  ate: "2026-11-16",
  situacao: "pausada",
  total: { gasto: 711.94, impressoes: 51247, cliques: 1805, visitas: 1566, leadsMeta: 327, comprasMeta: 0, leads: 223, testes: 27, vendas: 6, receita: 119.4 },
  anuncios: [
    { adId: "a", nome: "A1 | A repetida", gasto: 36.94, leadsMeta: 18, leads: 10, testes: 2, vendas: 0 },
    { adId: "b", nome: "A1 | B Gaveta", gasto: 424.88, leadsMeta: 212, leads: 147, testes: 19, vendas: 6 },
    { adId: "c", nome: "A1 | C Digitando", gasto: 6.91, leadsMeta: 1, leads: 2, testes: 0, vendas: 0 },
    { adId: "d", nome: "A1 | D Como Vender", gasto: 243.21, leadsMeta: 96, leads: 64, testes: 6, vendas: 0 },
  ],
  testesResolvidos: 15,
  testesPagos: 6,
  testesEmAberto: ["2026-11-16", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-21", "2026-11-22", "2026-11-22", "2026-11-22", "2026-11-23"],
  achados: [
    achado("vencedor-b", { titulo: "“A1 | B Gaveta” trouxe 6 vendas de 6" }),
    achado("diferenca-meta", { destaque: { para: "68%", rotulo: "" } }),
    achado("navegador-app", { destaque: { para: "64%", rotulo: "" } }),
    achado("redistribuicao-x", { titulo: "Depois que você pausou “A1 | C Digitando” em 08/11, a Meta passou a gastar 58% em “A1 | D Como Vender”" }),
  ],
  marcos: [],
  mensalidade: 19.9,
};

describe("montarBalanco — caso GN", () => {
  const b = montarBalanco(GN);

  it("resume o resultado em uma frase, com o payback da assinatura", () => {
    expect(b.frase).toContain("6 assinantes");
    expect(b.frase).toContain("se paga em cerca de 6 meses de mensalidade");
    expect(b.frase.replace(/\u00a0/g, " ")).toContain("R$ 118,66 por assinante");
    expect(b.numeros.at(-1)).toMatchObject({ rotulo: "Cada assinante se paga em", valor: "cerca de 6 meses" });
    expect(b.periodo).toBe("01/11 a 16/11 · 16 dias");
  });

  it("aponta os dois vazamentos do funil: cadastros que não chegam e cadastros que não testam", () => {
    expect(b.funil.filter((e) => e.vazou).map((e) => e.rotulo)).toEqual(["Cadastros da Meta → chegaram ao sistema", "Cadastraram → começaram o teste"]);
    expect(b.funil.find((e) => e.rotulo === "Teste terminou → pagou")?.taxa).toBe("40% dos testes já terminados viraram pagamento");
  });

  it("o que funcionou e o que não: B Gaveta e D Como Vender, pela venda", () => {
    expect(b.funcionou[0].texto).toContain("“A1 | B Gaveta” foi o melhor anúncio: 6 vendas");
    expect(b.naoFuncionou.some((i) => i.texto.startsWith("“A1 | D Como Vender” gastou"))).toBe(true);
    expect(b.naoFuncionou.some((i) => i.texto.includes("pausou “A1 | C Digitando”"))).toBe(true);
  });

  it("diz quando sai o veredito dos testes em aberto", () => {
    expect(b.emAberto[0]).toContain("12 testes grátis ainda estão em andamento");
    expect(b.emAberto[0]).toContain("23/11");
    expect(b.emAberto[0]).toContain("5 viram vendas");
    expect(b.emAberto[0]).toContain("se paga em cerca de 3 meses");
  });

  it("recomenda o mesmo que a análise manual, na ordem de impacto", () => {
    expect(b.recomendacoes.map((r) => r.titulo)).toEqual([
      "Concentre a próxima etapa no argumento de “A1 | B Gaveta”",
      "Corrija o momento em que o site avisa a Meta do cadastro",
      "Leve quem se cadastra até o teste grátis",
      "Teste o seu cadastro dentro do Instagram",
      "Monte a próxima campanha já com os anúncios finais",
    ]);
  });

  it("campanha sem venda julga pelo teste e não inventa vencedor", () => {
    const semVenda = montarBalanco({ ...GN, achados: [], total: { ...GN.total, vendas: 0, receita: 0 }, anuncios: GN.anuncios.map((a) => ({ ...a, vendas: 0 })) });
    expect(semVenda.funcionou[0].texto).toContain("19 testes");
    expect(semVenda.recomendacoes[0].titulo).not.toContain("Concentre");
  });
});
