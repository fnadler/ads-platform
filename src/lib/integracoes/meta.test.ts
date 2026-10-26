import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { normalizarContaMeta } = await import("./meta");

describe("normalizarContaMeta", () => {
  it("aceita act_, só o número e o link do Gerenciador", () => {
    expect(normalizarContaMeta("act_1234567890")).toBe("act_1234567890");
    expect(normalizarContaMeta(" 1234567890 ")).toBe("act_1234567890");
    expect(normalizarContaMeta("https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1234567890&business_id=9")).toBe("act_1234567890");
    expect(normalizarContaMeta("GN Coleciona")).toBeNull();
  });
});
