import { describe, expect, it } from "vitest";
import { experienciaDaCampanha, type ColetaBruta } from "./campanha";

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
