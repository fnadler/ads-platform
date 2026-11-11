import { describe, expect, it } from "vitest";
import { inicioDoDia } from "./formato";

describe("inicioDoDia", () => {
  it("meia-noite em São Paulo é 3h UTC", () => {
    expect(inicioDoDia("2026-11-03", "America/Sao_Paulo")).toBe("2026-11-03T03:00:00.000Z");
  });
  it("UTC fica igual", () => {
    expect(inicioDoDia("2026-11-03", "UTC")).toBe("2026-11-03T00:00:00.000Z");
  });
  it("fuso adiantado volta para o dia anterior em UTC", () => {
    expect(inicioDoDia("2026-11-03", "Europe/Lisbon")).toBe("2026-11-03T00:00:00.000Z");
    expect(inicioDoDia("2026-07-03", "Europe/Lisbon")).toBe("2026-07-02T23:00:00.000Z");
  });
});
