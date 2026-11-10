import { describe, expect, it } from "vitest";
import { resumirPageSpeed } from "./resumo";
import { lerVelocidade, traduzirMotivo } from "./diagnostico";

// Recorte de uma resposta real (Lighthouse 13.6, gncoleciona.com.br, 10/11/2026), com os mesmos formatos.
const resposta = (extra: { tbt?: number; lcp?: number; cls?: number; campo?: boolean } = {}) => ({
  analysisUTCTimestamp: "2026-11-10T22:03:05.758Z",
  ...(extra.campo
    ? {
        loadingExperience: {
          origin_fallback: true,
          metrics: {
            LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3600, category: "AVERAGE", distributions: [{ proportion: 0.37 }, { proportion: 0.5 }, { proportion: 0.13 }] },
            CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 20, category: "AVERAGE", distributions: [{ proportion: 0.6 }, { proportion: 0.3 }, { proportion: 0.1 }] },
          },
        },
      }
    : { loadingExperience: {}, originLoadingExperience: {} }),
  lighthouseResult: {
    finalDisplayedUrl: "https://www.loja.com/",
    fetchTime: "2026-11-10T22:03:05.758Z",
    lighthouseVersion: "13.6.0",
    configSettings: { formFactor: "mobile" },
    categories: { performance: { score: 0.95 } },
    fullPageScreenshot: { screenshot: { data: "data:image/jpeg;base64,AAAA", width: 412, height: 9270 } },
    audits: {
      "largest-contentful-paint": { numericValue: extra.lcp ?? 974, score: 1, scoreDisplayMode: "numeric" },
      "first-contentful-paint": { numericValue: 974, score: 1, scoreDisplayMode: "numeric" },
      "total-blocking-time": { numericValue: extra.tbt ?? 257.5, score: 0.83, scoreDisplayMode: "numeric" },
      "cumulative-layout-shift": { numericValue: extra.cls ?? 0, score: 1, scoreDisplayMode: "numeric" },
      "speed-index": { numericValue: 1961, score: 0.99, scoreDisplayMode: "numeric" },
      "lcp-breakdown-insight": {
        score: 1,
        scoreDisplayMode: "informative",
        details: {
          type: "list",
          items: [
            {
              type: "table",
              items: [
                { subpart: "timeToFirstByte", duration: 3.2 },
                { subpart: "elementRenderDelay", duration: 1098.2 },
              ],
            },
            { type: "node", selector: "section.mk-hero > p.mk-hero-sub", nodeLabel: "Marque grátis as 994 figurinhas" },
          ],
        },
      },
      "render-blocking-insight": {
        title: "Render-blocking requests",
        displayValue: "Est savings of 430 ms",
        score: 0,
        scoreDisplayMode: "metricSavings",
        metricSavings: { LCP: 450, FCP: 450 },
        details: {
          type: "table",
          items: [
            { url: "https://www.loja.com/_next/static/a.css", totalBytes: 16731, wastedMs: 170 },
            { url: "https://www.loja.com/_next/static/b.css", totalBytes: 9472, wastedMs: 507 },
          ],
        },
      },
      "image-delivery-insight": {
        title: "Improve image delivery",
        score: 0.5,
        scoreDisplayMode: "metricSavings",
        metricSavings: { LCP: 0, FCP: 0 },
        details: {
          type: "table",
          items: [
            {
              url: "https://www.loja.com/brand/copa.webp?dpl=x",
              totalBytes: 150000,
              wastedBytes: 120000,
              node: { nodeLabel: "div.card > img" },
              subItems: { items: [{ reason: "This image file is larger than it needs to be (480x556) for its displayed dimensions (167x194). Use responsive images." }] },
            },
          ],
        },
      },
      "unused-javascript": {
        title: "Reduce unused JavaScript",
        score: 0.5,
        scoreDisplayMode: "metricSavings",
        details: {
          type: "opportunity",
          items: [
            { url: "https://www.loja.com/_next/static/c.js", totalBytes: 68751, wastedBytes: 56902 },
            { url: "https://connect.facebook.net/en_US/fbevents.js", totalBytes: 114165, wastedBytes: 42661 },
          ],
        },
      },
      "long-tasks": {
        score: 1,
        scoreDisplayMode: "informative",
        metricSavings: { TBT: 250 },
        details: {
          type: "table",
          items: [
            { url: "https://connect.facebook.net/signals/config/1?v=2", duration: 169 },
            { url: "https://www.loja.com/_next/static/turbopack.js", duration: 116 },
          ],
        },
      },
      "third-parties-insight": { score: 1, scoreDisplayMode: "informative", details: { type: "table", items: [{ entity: "Facebook", mainThreadTime: 261, transferSize: 220660 }] } },
      "viewport-insight": { score: 1, scoreDisplayMode: "numeric", metricSavings: { INP: 0 } },
      "dom-size-insight": { score: null, scoreDisplayMode: "notApplicable" },
    },
  },
});

describe("resumirPageSpeed", () => {
  const r = resumirPageSpeed(resposta());

  it("medidas, nota, LCP e tamanho da página", () => {
    expect(r.nota).toBe(95);
    expect(r.laboratorio.tbt).toBe(257.5);
    expect(r.lcp).toEqual({ elemento: "Marque grátis as 994 figurinhas", seletor: "section.mk-hero > p.mk-hero-sub", fases: { servidor: 3, atrasoDesenho: 1098 } });
    expect(r.pagina).toEqual({ largura: 412, altura: 9270 });
    expect(r.tela).toEqual({ largura: 412, altura: 823 });
    expect(r.campo).toBeNull();
  });

  it("achados só com o que pede atenção, endereços sem parâmetros", () => {
    expect(r.achados.map((a) => a.id).sort()).toEqual(["image-delivery-insight", "long-tasks", "render-blocking-insight", "unused-javascript"]);
    const img = r.achados.find((a) => a.id === "image-delivery-insight")!;
    expect(img.itens[0]).toMatchObject({ url: "www.loja.com/brand/copa.webp", rotulo: "div.card > img", desperdicio: 120000 });
    expect(r.achados.find((a) => a.id === "render-blocking-insight")?.exibicao).toBe("Est savings of 430 ms");
  });

  it("dados de campo herdados do site contam como do site; CLS volta à escala certa", () => {
    const c = resumirPageSpeed(resposta({ campo: true })).campo!;
    expect(c.fonte).toBe("site");
    expect(c.metricas.LCP).toEqual({ p75: 3600, categoria: "melhorar", distribuicao: [0.37, 0.5, 0.13] });
    expect(c.metricas.CLS?.p75).toBe(0.2);
  });
});

describe("lerVelocidade", () => {
  it("o que deixa lenta, do maior ganho para o menor, sem o que é de terceiros", () => {
    const l = lerVelocidade(resumirPageSpeed(resposta()));
    expect(l.medidas.map((m) => m.categoria)).toEqual(["bom", "melhorar", "bom"]);
    expect(l.diagnosticos.map((d) => [d.id, d.tom])).toEqual([
      ["render-blocking-insight", "agir"],
      ["image-delivery-insight", "agir"],
      ["travamento", "observar"],
      ["unused-javascript", "observar"],
    ]);
    const js = l.diagnosticos.find((d) => d.id === "unused-javascript")!;
    expect(js.detalhes).toHaveLength(1); // o do Facebook fica de fora (não dá para mudar)
    expect(js.porque).toMatch(/pixel da Meta/);
    expect(l.diagnosticos.find((d) => d.id === "travamento")?.comoResolver.join(" ")).toMatch(/Não remova o pixel da Meta/);
    // Relatório para quem executa: o que fazer, como resolver, como conferir, terceiros à parte.
    expect(l.textoTecnico).toMatch(/O QUE FAZER/);
    expect(l.textoTecnico).toMatch(/Como resolver:/);
    expect(l.textoTecnico).toMatch(/Como conferir:/);
    expect(l.textoTecnico).toMatch(/FORA DO CONTROLE DO SITE/);
    expect(l.textoTecnico).toMatch(/Next\.js/); // os arquivos em /_next/static/ ligam as dicas de Next
    expect(l.textoTecnico).not.toMatch(/Render-blocking requests|atrasoDesenho/);
    // Os arquivos do Facebook não entram na lista do que mexer.
    const blocoJs = l.textoTecnico.split("Código baixado que a página não usa")[1].split("Como conferir")[0];
    expect(blocoJs).not.toMatch(/connect\.facebook\.net/);
  });

  it("LCP ruim vira o primeiro item, explicando a fase que mais pesa", () => {
    const l = lerVelocidade(resumirPageSpeed(resposta({ lcp: 4800 })));
    const d = l.diagnosticos.find((x) => x.id === "conteudo-principal")!;
    expect(d.tom).toBe("agir");
    expect(d.porque).toMatch(/espera estilos, fontes e scripts/);
    expect(l.medidas[0]).toMatchObject({ valor: "4,8 s", categoria: "ruim" });
  });

  it("tempo travado dentro do bom não vira item", () => {
    const l = lerVelocidade(resumirPageSpeed(resposta({ tbt: 100 })));
    expect(l.diagnosticos.some((d) => d.id === "travamento")).toBe(false);
  });

  it("no computador: deslocamento pela fonte, sem a linha de total, com texto sem falar em celular", () => {
    const base = resposta({ cls: 0.147 });
    const lr = base.lighthouseResult as Record<string, unknown> & { audits: Record<string, unknown>; configSettings: Record<string, unknown> };
    lr.configSettings = { formFactor: "desktop" };
    lr.audits["cls-culprits-insight"] = {
      title: "Layout shift culprits",
      score: 0,
      scoreDisplayMode: "numeric",
      metricSavings: { CLS: 0 },
      details: {
        type: "list",
        items: [
          {
            type: "table",
            items: [
              { score: 0.147, node: { type: "text", value: "Total" } },
              {
                score: 0.147,
                node: { type: "node", selector: "section.mk-hero > div.mk-hero-card", nodeLabel: "Brasil\nBRA1–20" },
                subItems: { type: "subitems", items: [{ cause: "Web font", extra: { type: "url", value: "https://www.loja.com/fonte.woff2" } }] },
              },
            ],
          },
        ],
      },
    };
    const r = resumirPageSpeed(base);
    expect(r.tela).toEqual({ largura: 1350, altura: 940 });
    expect(r.achados.find((a) => a.id === "cls-culprits-insight")?.itens).toEqual([{ rotulo: "section.mk-hero > div.mk-hero-card", deslocamento: 0.147, motivo: "Web font" }]);
    const l = lerVelocidade(r);
    const d = l.diagnosticos.find((x) => x.id === "cls-culprits-insight")!;
    expect(d).toMatchObject({ tom: "observar", frente: "estabilidade" });
    expect(d.comoResolver.join(" ")).toMatch(/Pré-carregue a fonte/);
    expect(l.diagnosticos.map((x) => x.porque).join(" ")).not.toMatch(/celular/);
    expect(l.textoTecnico).toMatch(/computador/);
  });

  it("fontes demais na primeira carga viram item, com a dica de next/font", () => {
    const base = resposta();
    const audits = (base.lighthouseResult as { audits: Record<string, unknown> }).audits;
    audits["network-requests"] = {
      score: 1,
      scoreDisplayMode: "informative",
      details: {
        type: "table",
        items: Array.from({ length: 10 }, (_, i) => ({ url: `https://www.loja.com/_next/static/media/f${i}.woff2`, resourceType: "Font", transferSize: 18000 })).concat([
          { url: "https://www.loja.com/", resourceType: "Document", transferSize: 16000 } as never,
        ]),
      },
    };
    const r = resumirPageSpeed(base);
    expect(r.fontes).toHaveLength(10);
    const d = lerVelocidade(r).diagnosticos.find((x) => x.id === "fontes")!;
    expect(d).toMatchObject({ tom: "agir", ganho: "10 fontes, 176 KB" });
    expect(d.comoResolver.join(" ")).toMatch(/preload: false/);
    // Poucas fontes: nada a apontar.
    (audits["network-requests"] as { details: { items: unknown[] } }).details.items = [{ url: "https://www.loja.com/a.woff2", resourceType: "Font", transferSize: 20000 }];
    expect(lerVelocidade(resumirPageSpeed(base)).diagnosticos.some((x) => x.id === "fontes")).toBe(false);
  });

  it("traduz os motivos mais comuns", () => {
    expect(traduzirMotivo("This image file is larger than it needs to be (480x556) for its displayed dimensions (167x194).")).toBe("o arquivo tem 480x556 px e aparece em 167x194 px");
    expect(traduzirMotivo("Increasing the image compression factor could improve this image’s download size")).toBe("dá para comprimir mais");
  });
});
