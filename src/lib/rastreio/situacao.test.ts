import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { avaliarAnuncio, rotuloSaude } = await import("./situacao");
const { PARAMETROS_META } = await import("./regras");

describe("avaliarAnuncio", () => {
  it("sem parâmetros e no ar: sem rastreio, vivo", () => {
    expect(avaliarAnuncio({ url_tags: null, destinos: ["https://x.com"], status: "ACTIVE" })).toMatchObject({ status_rastreio: "erro", vivo: true });
  });
  it("parâmetros completos: ok", () => {
    expect(avaliarAnuncio({ url_tags: PARAMETROS_META, destinos: ["https://x.com"], status: "PAUSED" })).toMatchObject({ status_rastreio: "ok", vivo: false });
  });
  it("sem destino rebaixa ok para atenção", () => {
    expect(avaliarAnuncio({ url_tags: PARAMETROS_META, destinos: [], status: "PENDING_REVIEW" })).toMatchObject({ status_rastreio: "alerta", vivo: true });
  });
});

describe("rotuloSaude", () => {
  it("o pior manda", () => {
    expect(rotuloSaude({ vivos: 5, semRastreio: 2, atencao: 1 })).toEqual({ rotulo: "2 sem rastreio", tom: "erro" });
    expect(rotuloSaude({ vivos: 5, semRastreio: 0, atencao: 1 })).toEqual({ rotulo: "1 com atenção", tom: "alerta" });
    expect(rotuloSaude({ vivos: 0, semRastreio: 0, atencao: 0 }).rotulo).toBe("Nada no ar");
    expect(rotuloSaude({ vivos: 3, semRastreio: 0, atencao: 0 }).rotulo).toBe("Rastreada");
  });
});
