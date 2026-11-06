// Coletas do Clarity: membros da organização leem; outras organizações não; ninguém grava pela API.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

let db: PGlite;
let org: string;
let coleta: string;
const membro = { id: "", email: "membro@x.com" };
const intruso = { id: "", email: "intruso@x.com" };

beforeAll(async () => {
  db = await criarBanco();
  for (const u of [membro, intruso]) u.id = await criarUsuario(db, u.email);
  org = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('GN', 'gn') returning id")).rows[0].id;
  const outra = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('Outra', 'outra') returning id")).rows[0].id;
  await db.query("insert into public.membros values ($1, $2, 'leitura'), ($3, $4, 'dono')", [org, membro.id, outra, intruso.id]);
  coleta = (
    await db.query<{ id: string }>(
      "insert into public.clarity_coletas (organizacao_id, projeto_id, num_dias, dia, resposta) values ($1, 'z9fvwq0b1n', 1, '2026-11-06', '[]') returning id",
      [org],
    )
  ).rows[0].id;
  await db.query(`insert into public.clarity_metricas (coleta_id, organizacao_id, metrica, valores) values ($1, $2, 'Traffic', '{"totalSessionCount": 10}')`, [coleta, org]);
});

describe("clarity", () => {
  it("membro lê; outra organização não vê nada", async () => {
    for (const tabela of ["clarity_coletas", "clarity_metricas"]) {
      expect((await como(db, membro, () => db.query(`select * from public.${tabela}`))).rows).toHaveLength(1);
      expect((await como(db, intruso, () => db.query(`select * from public.${tabela}`))).rows).toHaveLength(0);
    }
  });

  it("ninguém grava pela API (só o worker, com a service role)", async () => {
    await expect(
      como(db, membro, () => db.query("insert into public.clarity_coletas (organizacao_id, projeto_id, num_dias, resposta) values ($1, 'x', 1, '[]')", [org])),
    ).rejects.toThrow(/row-level security/);
    const del = await como(db, membro, () => db.query("delete from public.clarity_coletas"));
    expect(del.affectedRows).toBe(0);
  });

  it("uma coleta diária por dia e recorte; a sincronização aceita o tipo clarity", async () => {
    await expect(
      db.query("insert into public.clarity_coletas (organizacao_id, projeto_id, num_dias, dia, resposta) values ($1, 'z9fvwq0b1n', 1, '2026-11-06', '[]')", [org]),
    ).rejects.toThrow(/duplicate key/);
    await db.query("insert into public.sincronizacoes (organizacao_id, tipo, alvo, modo) values ($1, 'clarity', 'x', 'incremental')", [org]);
  });
});
