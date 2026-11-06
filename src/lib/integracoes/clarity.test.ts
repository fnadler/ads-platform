import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { normalizarInsightsClarity, normalizarProjetoClarity, ErroClarity } = await import("./clarity");

describe("normalizarInsightsClarity", () => {
  it("separa dimensões de valores e converte números em texto", () => {
    const linhas = normalizarInsightsClarity(
      [
        {
          metricName: "Traffic",
          information: [
            { totalSessionCount: "9554", totalBotSessionCount: "8369", distantUserCount: "189733", PagesPerSessionPercentage: 1.0931, OS: "Other" },
            { totalSessionCount: "291942", OS: "Android" },
          ],
        },
        { metricName: "Scroll Depth", information: [{ averageScrollDepth: 41.2, OS: "Android" }] },
      ],
      ["OS"],
    );
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toEqual({
      metrica: "Traffic",
      dimensoes: { OS: "Other" },
      valores: { totalSessionCount: 9554, totalBotSessionCount: 8369, distantUserCount: 189733, PagesPerSessionPercentage: 1.0931 },
    });
    expect(linhas[2]).toEqual({ metrica: "Scroll Depth", dimensoes: { OS: "Android" }, valores: { averageScrollDepth: 41.2 } });
  });

  it("sem dimensões, tudo é valor; texto não numérico fica como texto; lixo é ignorado", () => {
    const linhas = normalizarInsightsClarity(
      // @ts-expect-error resposta malformada de propósito
      [{ metricName: "Popular Pages", information: [{ url: "https://x.com/", visitsCount: "12" }] }, { foo: 1 }, null],
      [],
    );
    expect(linhas).toEqual([{ metrica: "Popular Pages", dimensoes: {}, valores: { url: "https://x.com/", visitsCount: 12 } }]);
  });
});

describe("normalizarProjetoClarity", () => {
  it("aceita o ID, o script e o endereço do painel", () => {
    expect(normalizarProjetoClarity("z9fvwq0b1n")).toBe("z9fvwq0b1n");
    expect(normalizarProjetoClarity(`<script>(function(c,l,a,r,i,t,y){t.src="https://www.clarity.ms/tag/"+i;})(window, document, "clarity", "script", "z9fvwq0b1n");</script>`)).toBe("z9fvwq0b1n");
    expect(normalizarProjetoClarity("https://clarity.microsoft.com/projects/view/z9fvwq0b1n/dashboard")).toBe("z9fvwq0b1n");
    expect(normalizarProjetoClarity("meu projeto")).toBeNull();
  });
});

describe("ErroClarity", () => {
  it("4xx é definitivo (não repete, para não gastar cota); 401/403 são de credencial", () => {
    expect(new ErroClarity("x", 429).definitivo).toBe(true);
    expect(new ErroClarity("x", 429).deCredencial).toBe(false);
    expect(new ErroClarity("x", 401).deCredencial).toBe(true);
    expect(new ErroClarity("x", 503).definitivo).toBe(false);
    expect(new ErroClarity("rede").definitivo).toBe(false);
  });
});
