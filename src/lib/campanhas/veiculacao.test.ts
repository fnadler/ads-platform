import { describe, expect, it } from "vitest";
import { situacaoPelosAnuncios, statusDepoisDe, veiculacaoPelosAnuncios } from "./veiculacao";

describe("veiculacaoPelosAnuncios", () => {
  it("ligada quando algum anúncio veicula, está em análise ou com problema", () => {
    expect(veiculacaoPelosAnuncios(["ACTIVE", "PAUSED"])).toBe("ligada");
    expect(veiculacaoPelosAnuncios(["PENDING_REVIEW"])).toBe("ligada");
    expect(veiculacaoPelosAnuncios(["DISAPPROVED", "ADSET_PAUSED"])).toBe("ligada");
  });
  it("pausada quando a pausa é da campanha", () => {
    expect(veiculacaoPelosAnuncios(["CAMPAIGN_PAUSED", "CAMPAIGN_PAUSED"])).toBe("pausada");
    expect(veiculacaoPelosAnuncios(["CAMPAIGN_PAUSED", "EXPIRED"])).toBe("pausada");
  });
  it("parada quando só conjuntos ou anúncios foram pausados", () => {
    expect(veiculacaoPelosAnuncios(["PAUSED", "ADSET_PAUSED"])).toBe("parada");
  });
  it("encerrada sem nada vivo", () => {
    expect(veiculacaoPelosAnuncios(["EXPIRED", "ARCHIVED", null])).toBe("encerrada");
    expect(veiculacaoPelosAnuncios([])).toBe("encerrada");
  });
});

describe("situacaoPelosAnuncios", () => {
  it("mostra o estado mais vivo", () => {
    expect(situacaoPelosAnuncios(["PAUSED", "ACTIVE"]).rotulo).toBe("No ar");
    expect(situacaoPelosAnuncios(["CAMPAIGN_PAUSED"]).rotulo).toBe("Pausada");
    expect(situacaoPelosAnuncios(["EXPIRED"]).rotulo).toBe("Encerrada");
  });
});

describe("statusDepoisDe", () => {
  it("pausar a campanha segura tudo o que estava vivo", () => {
    expect(statusDepoisDe("pausar", "ACTIVE")).toBe("CAMPAIGN_PAUSED");
    expect(statusDepoisDe("pausar", "PENDING_REVIEW")).toBe("CAMPAIGN_PAUSED");
    expect(statusDepoisDe("pausar", "PAUSED")).toBe("PAUSED");
    expect(statusDepoisDe("pausar", "EXPIRED")).toBe("EXPIRED");
  });
  it("reativar só solta o que a pausa da campanha segurava", () => {
    expect(statusDepoisDe("reativar", "CAMPAIGN_PAUSED")).toBe("ACTIVE");
    expect(statusDepoisDe("reativar", "ADSET_PAUSED")).toBe("ADSET_PAUSED");
  });
  it("depois de pausar, a campanha aparece pausada (e não mais para pausar)", () => {
    const antes = ["ACTIVE", "PAUSED", "ADSET_PAUSED", "PENDING_REVIEW"];
    const pausados = antes.map((s) => statusDepoisDe("pausar", s));
    expect(veiculacaoPelosAnuncios(pausados)).toBe("pausada");
    expect(veiculacaoPelosAnuncios(pausados.map((s) => statusDepoisDe("reativar", s)))).toBe("ligada");
  });
});
