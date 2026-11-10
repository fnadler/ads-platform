// Testes de velocidade das páginas: membros da organização leem; outras organizações não; ninguém grava pela API.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

let db: PGlite;
let org: string;
const membro = { id: "", email: "membro@x.com" };
const intruso = { id: "", email: "intruso@x.com" };

beforeAll(async () => {
  db = await criarBanco();
  for (const u of [membro, intruso]) u.id = await criarUsuario(db, u.email);
  org = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('GN', 'gn') returning id")).rows[0].id;
  const outra = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('Outra', 'outra') returning id")).rows[0].id;
  await db.query("insert into public.membros values ($1, $2, 'leitura'), ($3, $4, 'dono')", [org, membro.id, outra, intruso.id]);
  await db.query("insert into public.pagina_testes (organizacao_id, url, chave, nota, resumo) values ($1, 'https://loja.com/', 'loja.com/', 95, '{}')", [org]);
});

describe("pagina_testes", () => {
  it("membro lê; outra organização não vê nada", async () => {
    expect((await como(db, membro, () => db.query("select * from public.pagina_testes"))).rows).toHaveLength(1);
    expect((await como(db, intruso, () => db.query("select * from public.pagina_testes"))).rows).toHaveLength(0);
  });

  it("ninguém grava pela API (só o worker, com a service role)", async () => {
    await expect(
      como(db, membro, () => db.query("insert into public.pagina_testes (organizacao_id, url, chave, resumo) values ($1, 'x', 'x', '{}')", [org])),
    ).rejects.toThrow(/row-level security/);
    expect((await como(db, membro, () => db.query("delete from public.pagina_testes"))).affectedRows).toBe(0);
  });

  it("nota entre 0 e 100; a sincronização aceita o tipo pagespeed", async () => {
    await expect(db.query("insert into public.pagina_testes (organizacao_id, url, chave, nota, resumo) values ($1, 'x', 'x', 120, '{}')", [org])).rejects.toThrow(/check/);
    await db.query("insert into public.sincronizacoes (organizacao_id, tipo, alvo, modo) values ($1, 'pagespeed', 'https://loja.com/', 'manual')", [org]);
  });
});
