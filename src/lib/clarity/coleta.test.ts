import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { diaAnterior } = await import("./coleta");

describe("diaAnterior", () => {
  it("às 0h10 em Brasília (3h10 UTC), a janela de 24 h cobre o dia anterior", () => {
    expect(diaAnterior(new Date("2026-11-07T03:10:00Z"), "America/Sao_Paulo")).toBe("2026-11-06");
  });
  it("vira o mês", () => {
    expect(diaAnterior(new Date("2026-12-01T03:10:00Z"), "America/Sao_Paulo")).toBe("2026-11-30");
  });
});
