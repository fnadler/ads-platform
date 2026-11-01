import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { interessesDescontinuados } = await import("./metaEscrita");

describe("interessesDescontinuados", () => {
  it("lê o erro 1870247 da Meta com a alternativa sugerida", () => {
    const msg =
      'Algumas opções de direcionamento detalhado foram combinadas: Atualize a especificação de direcionamento para remover ou substituir por opções alternativas. Opções alternativas relevantes: [{"deprecated_interest_id":"6003331991294","deprecated_interest_name":"Panini Group","alternative_interest_id":"6003065814670","alternative_interest_name":"Publishing"}] (código 100/1870247)';
    expect(interessesDescontinuados(msg)).toEqual([{ id: "6003331991294", nome: "Panini Group", alternativa: { id: "6003065814670", nome: "Publishing" } }]);
  });

  it("outros erros não são de interesse descontinuado", () => {
    expect(interessesDescontinuados("Erro da Meta (código 100/1234)")).toBeNull();
  });
});
