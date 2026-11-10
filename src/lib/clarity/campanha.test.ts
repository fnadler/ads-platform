import { describe, expect, it } from "vitest";
import { caminho, experienciaDaCampanha, type ColetaBruta } from "./campanha";

const url = (fbclid: string, campanha = "123") => `https://loja.com/?utm_source=meta&utm_campaign_id=${campanha}&fbclid=${fbclid}`;

const coleta: ColetaBruta = {
  dia: "2026-11-07",
  resposta: [
    {
      metricName: "Traffic",
      information: [
        { Url: url("a"), Device: "Mobile", totalSessionCount: 1 },
        { Url: url("b"), Device: "Mobile", totalSessionCount: 1 },
        { Url: url("c"), Device: "Mobile", totalSessionCount: 2 },
        { Url: url("d"), Device: "PC", totalSessionCount: 1 },
        { Url: url("x", "999"), Device: "Mobile", totalSessionCount: 50 },
        { Url: "https://loja.com/lojas", Device: "Mobile", totalSessionCount: 9 },
      ],
    },
    {
      metricName: "ScrollDepth",
      information: [
        { Url: url("a"), Device: "Mobile", averageScrollDepth: 15 },
        { Url: url("b"), Device: "Mobile", averageScrollDepth: 55 },
        { Url: url("c"), Device: "Mobile", averageScrollDepth: 100 },
        { Url: url("d"), Device: "PC", averageScrollDepth: 80 },
      ],
    },
    {
      metricName: "DeadClickCount",
      information: [
        { Url: url("a"), Device: "Mobile", sessionsCount: 1, sessionsWithMetricPercentage: 100 },
        { Url: url("b"), Device: "Mobile", sessionsCount: 1, sessionsWithMetricPercentage: 0 },
      ],
    },
  ],
};

describe("experienciaDaCampanha", () => {
  const e = experienciaDaCampanha([coleta], "123");

  it("conta só as visitas da campanha, por aparelho", () => {
    expect(e.sessoes).toBe(5);
    expect(e.porAparelho.Mobile?.sessoes).toBe(4);
    expect(e.porAparelho.PC?.sessoes).toBe(1);
    expect(e.paginas).toEqual([{ url: "https://loja.com/", sessoes: 5 }]);
  });

  it("monta a curva de rolagem ponderada pelas visitas", () => {
    const m = e.porAparelho.Mobile!;
    expect(m.rolagem).toBeCloseTo((15 + 55 + 200) / 4);
    expect(m.curva![0]).toBe(1);
    expect(m.curva![2]).toBe(0.75); // 20%: b e c (3 de 4 visitas)
    expect(m.curva![6]).toBe(0.5); // 60%: só c (2 visitas)
    expect(m.curva![10]).toBe(0.5);
    expect(m.cliqueMorto).toBe(0.5);
  });
});

describe("por anúncio, por navegador e sinais", () => {
  const u = (fbclid: string, ad: string, nome: string) => `https://loja.com/?utm_campaign_id=123&utm_ad_id=${ad}&utm_content=${encodeURIComponent(nome)}&fbclid=${fbclid}`;
  const antigo: ColetaBruta = {
    dia: "2026-11-08",
    resposta: [{ metricName: "Traffic", information: [{ Url: u("p", "A1", "Gaveta"), Device: "Mobile", totalSessionCount: 1 }] }],
  };
  const novo: ColetaBruta = {
    dia: "2026-11-09",
    resposta: [
      {
        metricName: "Traffic",
        information: [
          { Url: u("q", "A1", "Gaveta"), Device: "Mobile", Browser: "InstagramApp", totalSessionCount: 3, pagesPerSessionPercentage: 2 },
          { Url: u("r", "B2", "Vitrine"), Device: "Mobile", Browser: "FacebookApp", totalSessionCount: 1, pagesPerSessionPercentage: 4 },
        ],
      },
      {
        metricName: "ScriptErrorCount",
        information: [{ Url: u("r", "B2", "Vitrine"), Device: "Mobile", Browser: "FacebookApp", sessionsCount: 1, sessionsWithMetricPercentage: 100 }],
      },
    ],
  };
  const e = experienciaDaCampanha([antigo, novo], "123");

  it("separa por anúncio, com o nome da URL", () => {
    expect(e.porAnuncio.map((g) => [g.chave, g.rotulo, g.sessoes])).toEqual([
      ["A1", "Gaveta", 4],
      ["B2", "Vitrine", 1],
    ]);
  });

  it("navegador só nos dias que têm a dimensão", () => {
    expect(e.porNavegador.map((g) => [g.chave, g.sessoes])).toEqual([
      ["InstagramApp", 3],
      ["FacebookApp", 1],
    ]);
    expect(e.diasComNavegador).toEqual(["2026-11-09"]);
    expect(e.dias).toEqual(["2026-11-08", "2026-11-09"]);
  });

  it("erro de script e páginas por visita, ponderados", () => {
    expect(e.geral?.erroScript).toBe(1); // só a visita r tem a métrica
    expect(e.geral?.paginasPorVisita).toBeCloseTo((2 * 3 + 4) / 4);
  });
});

describe("chegadas e comparação na mesma página", () => {
  const c = (q: string) => `https://www.loja.com/${q}`;
  const coleta: ColetaBruta = {
    dia: "2026-11-09",
    resposta: [
      {
        metricName: "Traffic",
        information: [
          { Url: c("?utm_campaign_id=123&fbclid=a"), Device: "Mobile", totalSessionCount: 1 },
          { Url: c("?utm_campaign_id=123&fbclid=b"), Device: "Mobile", totalSessionCount: 1 },
          { Url: c("login?utm_campaign_id=123"), Device: "Mobile", totalSessionCount: 1 }, // página interna da mesma visita
          { Url: c("?utm_campaign_id=999&fbclid=z"), Device: "Mobile", totalSessionCount: 2 },
          { Url: c(""), Device: "Mobile", totalSessionCount: 4 },
        ],
      },
      {
        metricName: "ScrollDepth",
        information: [
          { Url: c("?utm_campaign_id=123&fbclid=a"), Device: "Mobile", averageScrollDepth: 10 },
          { Url: c("?utm_campaign_id=123&fbclid=b"), Device: "Mobile", averageScrollDepth: 30 },
          { Url: c("login?utm_campaign_id=123"), Device: "Mobile", averageScrollDepth: 100 },
          { Url: c(""), Device: "Mobile", averageScrollDepth: 60 },
        ],
      },
    ],
  };

  it("com destino conhecido, só a página de destino conta como chegada", () => {
    const e = experienciaDaCampanha([coleta], "123", ["https://loja.com/"]);
    expect(e.sessoes).toBe(2);
    expect(e.geral?.rolagem).toBe(20);
  });

  it("sem destino, vale o fbclid", () => {
    expect(experienciaDaCampanha([coleta], "123").sessoes).toBe(2);
  });

  it("compara com outras campanhas e com quem chegou sem anúncio, na mesma página", () => {
    const { comparacao } = experienciaDaCampanha([coleta], "123");
    expect(comparacao?.pagina).toBe("https://www.loja.com/");
    expect(comparacao?.estaCampanha.sessoes).toBe(2);
    expect(comparacao?.outrasCampanhas?.sessoes).toBe(2);
    expect(comparacao?.semAnuncio?.sessoes).toBe(4);
    expect(comparacao?.semAnuncio?.rolagem).toBe(60);
  });

  it("caminho ignora www, parâmetros e barra no fim", () => {
    expect(caminho("https://WWW.Loja.com/colecao/?x=1")).toBe("loja.com/colecao");
    expect(caminho("https://loja.com")).toBe("loja.com/");
  });
});
