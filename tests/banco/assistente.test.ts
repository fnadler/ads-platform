// Assistente de campanhas: quem cria e edita rascunhos, e o que fica travado depois que vai para a Meta.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

let db: PGlite;
let org: string;
let outra: string;
const gestor = { id: "", email: "gestor@x.com" };
const leitor = { id: "", email: "leitor@x.com" };
const intruso = { id: "", email: "intruso@x.com" };

const novaCampanha = (quem: typeof gestor, orgId: string, extra = "") =>
  como(db, quem, () =>
    db.query<{ id: string }>(`insert into public.campanhas_assistente (organizacao_id, nome, criado_por${extra ? ", " + extra.split("=")[0] : ""}) values ($1, 'Teste', $2${extra ? ", '" + extra.split("=")[1] + "'" : ""}) returning id`, [orgId, quem.id]),
  );

beforeAll(async () => {
  db = await criarBanco();
  for (const u of [gestor, leitor, intruso]) u.id = await criarUsuario(db, u.email);
  org = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('GN', 'gn') returning id")).rows[0].id;
  outra = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('Outra', 'outra') returning id")).rows[0].id;
  await db.query("insert into public.membros values ($1, $2, 'dono'), ($1, $3, 'leitura'), ($4, $5, 'dono')", [org, gestor.id, leitor.id, outra, intruso.id]);
});

describe("rascunhos", () => {
  it("gestor cria; leitura e outra organização não", async () => {
    expect((await novaCampanha(gestor, org)).rows).toHaveLength(1);
    await expect(novaCampanha(leitor, org)).rejects.toThrow(/row-level security/);
    await expect(novaCampanha(intruso, org)).rejects.toThrow(/row-level security/);
  });

  it("não dá para criar já como enviada à Meta", async () => {
    await expect(novaCampanha(gestor, org, "status=criada")).rejects.toThrow(/row-level security/);
  });

  it("criativo só no caminho da própria organização e campanha", async () => {
    const id = (await novaCampanha(gestor, org)).rows[0].id;
    const inserir = (caminho: string) =>
      como(db, gestor, () =>
        db.query("insert into public.criativos_assistente (organizacao_id, campanha_id, nome, tipo, arquivo_path) values ($1, $2, 'A', 'video', $3)", [org, id, caminho]),
      );
    await inserir(`${org}/${id}/a.mp4`);
    await expect(inserir(`${outra}/${id}/a.mp4`)).rejects.toThrow(/row-level security/);
  });

  it("depois de enviada à Meta, ninguém edita nem apaga pela API", async () => {
    const id = (await novaCampanha(gestor, org)).rows[0].id;
    await db.query("update public.campanhas_assistente set status = 'criada', meta_campaign_id = '120200000000001', meta_adset_id = '120200000000002' where id = $1", [id]);
    const upd = await como(db, gestor, () => db.query("update public.campanhas_assistente set nome = 'outro' where id = $1", [id]));
    expect(upd.affectedRows).toBe(0);
    const del = await como(db, gestor, () => db.query("delete from public.campanhas_assistente where id = $1", [id]));
    expect(del.affectedRows).toBe(0);
  });

  it("se a Meta recusar o conjunto depois de criar a campanha, o rascunho continua editável", async () => {
    const id = (await novaCampanha(gestor, org)).rows[0].id;
    await db.query("update public.campanhas_assistente set status = 'erro', meta_campaign_id = '120200000000009' where id = $1", [id]);
    const upd = await como(db, gestor, () => db.query("update public.campanhas_assistente set rascunho = '{\"idade_min\": 25}' where id = $1", [id]));
    expect(upd.affectedRows).toBe(1);
  });

  it("outra organização não vê rascunhos nem auditoria", async () => {
    await db.query("insert into public.operacoes_meta (organizacao_id, metodo, caminho) values ($1, 'POST', 'act_1/campaigns')", [org]);
    const c = await como(db, intruso, () => db.query("select * from public.campanhas_assistente"));
    const o = await como(db, intruso, () => db.query("select * from public.operacoes_meta"));
    expect(c.rows).toHaveLength(0);
    expect(o.rows).toHaveLength(0);
    const leit = await como(db, leitor, () => db.query("select * from public.operacoes_meta"));
    expect(leit.rows).toHaveLength(0); // auditoria só para gestor
  });
});

describe("configuração de publicação", () => {
  it("só o dono grava", async () => {
    await expect(
      como(db, leitor, () => db.query("insert into public.config_publicacao (organizacao_id, teto_verba_diaria) values ($1, 50)", [org])),
    ).rejects.toThrow(/row-level security/);
    await como(db, gestor, () => db.query("insert into public.config_publicacao (organizacao_id, teto_verba_diaria) values ($1, 50)", [org]));
  });
});
