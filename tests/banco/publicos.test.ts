// Públicos: quem cria, isolamento e quem entra em cada segmento do funil.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

let db: PGlite;
let org: string;
let outra: string;
const gestor = { id: "", email: "g@x.com" };
const leitor = { id: "", email: "l@x.com" };
const intruso = { id: "", email: "i@x.com" };

beforeAll(async () => {
  db = await criarBanco();
  for (const u of [gestor, leitor, intruso]) u.id = await criarUsuario(db, u.email);
  org = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('GN', 'gn') returning id")).rows[0].id;
  outra = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('Outra', 'outra') returning id")).rows[0].id;
  await db.query("insert into public.membros values ($1, $2, 'gestor'), ($1, $3, 'leitura'), ($4, $5, 'dono')", [org, gestor.id, leitor.id, outra, intruso.id]);
  await db.query(
    `insert into public.leads (organizacao_id, id_externo, criado_em, email_hash, teste_iniciado_em, primeiro_pagamento_em, codigo_teste) values
       ($1, 'pagou',     now() - interval '40 days', 'h-pagou', now(), now(), null),
       ($1, 'testando',  now() - interval '5 days',  'h-teste', now(), null,  null),
       ($1, 'cadastro',  now() - interval '2 days',  'h-cad',   null,  null,  null),
       ($1, 'antigo',    now() - interval '90 days', 'h-velho', null,  null,  null),
       ($1, 'semhash',   now(),                      null,      null,  null,  null),
       ($1, 'rastreio',  now(),                      'h-teste-rastreio', null, null, 'abc123')`,
    [org],
  );
});

const segmento = async (s: string, dias: number | null = null) =>
  (await db.query<{ email_hash: string }>("select email_hash from public.membros_publico_funil($1, $2, $3) order by 1", [org, s, dias])).rows.map((r) => r.email_hash);

describe("segmentos do funil", () => {
  it("pagantes, testando e cadastrados sem teste; sem lead de rastreio nem sem hash", async () => {
    expect(await segmento("pagantes")).toEqual(["h-pagou"]);
    expect(await segmento("teste_sem_pagamento")).toEqual(["h-teste"]);
    expect(await segmento("cadastrados_sem_teste")).toEqual(["h-cad", "h-velho"]);
    expect(await segmento("todos")).toEqual(["h-cad", "h-pagou", "h-teste", "h-velho"]);
  });

  it("limita pela data de cadastro", async () => {
    expect(await segmento("cadastrados_sem_teste", 30)).toEqual(["h-cad"]);
  });

  it("só o servidor lê a lista de clientes", async () => {
    await expect(como(db, gestor, () => db.query("select * from public.membros_publico_funil($1, 'todos', null)", [org]))).rejects.toThrow(/permission denied/);
  });
});

describe("públicos", () => {
  it("gestor cria; leitura e outra organização não", async () => {
    const criar = (u: typeof gestor) =>
      como(db, u, () => db.query("insert into public.publicos (organizacao_id, nome, tipo, criado_por) values ($1, $2, 'detalhado', $3)", [org, `P ${u.email}`, u.id]));
    await criar(gestor);
    await expect(criar(leitor)).rejects.toThrow(/row-level security/);
    await expect(criar(intruso)).rejects.toThrow(/row-level security/);
  });

  it("não dá para criar já ligado a um público da Meta", async () => {
    await expect(
      como(db, gestor, () =>
        db.query("insert into public.publicos (organizacao_id, nome, tipo, criado_por, meta_audience_id) values ($1, 'X', 'funil', $2, '123')", [org, gestor.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("outra organização não vê", async () => {
    const r = await como(db, intruso, () => db.query("select * from public.publicos"));
    expect(r.rows).toHaveLength(0);
  });
});
