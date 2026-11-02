// Contrato entre o webhook e o banco: todo campo de atribuição aceito precisa ter coluna em leads.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { criarBanco } from "./pglite";

vi.mock("server-only", () => ({}));
const { Atribuicao } = await import("@/lib/vendas/ingestao");

let colunas: Set<string>;
let db: PGlite;

beforeAll(async () => {
  db = await criarBanco();
  const r = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'leads'");
  colunas = new Set(r.rows.map((x) => x.column_name));
});

describe("campos de atribuição", () => {
  const utm = Object.keys(Atribuicao.shape).filter((k) => k.startsWith("utm_"));

  it("cobre os campos esperados", () => {
    expect(utm).toEqual(expect.arrayContaining(["utm_source", "utm_term", "utm_campaign_id", "utm_ad_id"]));
  });

  it.each(utm)("%s tem coluna de último e de primeiro toque", (campo) => {
    expect(colunas.has(campo)).toBe(true);
    expect(colunas.has(`ftp_${campo}`)).toBe(true);
  });
});
