import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("cifra", () => {
  beforeAll(() => {
    process.env.CHAVE_CIFRAGEM = randomBytes(32).toString("base64");
  });

  it("cifra e decifra; cada cifragem sai diferente", async () => {
    const { cifrar, decifrar } = await import("./cifra");
    const a = cifrar("EAAG-token-secreto");
    expect(a).not.toContain("EAAG");
    expect(a).not.toBe(cifrar("EAAG-token-secreto"));
    expect(decifrar(a)).toBe("EAAG-token-secreto");
  });

  it("recusa texto adulterado", async () => {
    const { cifrar, decifrar } = await import("./cifra");
    const [v, iv, tag, c] = cifrar("abc").split(":");
    const adulterado = [v, iv, tag, Buffer.from("xyz").toString("base64url") + c.slice(4)].join(":");
    expect(() => decifrar(adulterado)).toThrow();
  });

  it("lê a versão antiga depois da troca de chave", async () => {
    const { cifrar, decifrar } = await import("./cifra");
    const antigo = cifrar("v1");
    process.env.CHAVE_CIFRAGEM_V2 = randomBytes(32).toString("base64");
    process.env.CHAVE_CIFRAGEM_VERSAO = "2";
    const novo = cifrar("v2");
    expect(novo.startsWith("v2:")).toBe(true);
    expect(decifrar(antigo)).toBe("v1");
    expect(decifrar(novo)).toBe("v2");
    delete process.env.CHAVE_CIFRAGEM_VERSAO;
  });
});
