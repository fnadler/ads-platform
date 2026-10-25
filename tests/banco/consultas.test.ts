// Agregações do painel: mídia × leads × vendas por anúncio, cobertura e isolamento.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

let db: PGlite;
let org: string;
let outra: string;
const dono = { id: "", email: "dono@x.com" };
const intruso = { id: "", email: "intruso@x.com" };

beforeAll(async () => {
  db = await criarBanco();
  dono.id = await criarUsuario(db, dono.email);
  intruso.id = await criarUsuario(db, intruso.email);
  org = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('GN', 'gn') returning id")).rows[0].id;
  outra = (await db.query<{ id: string }>("insert into public.organizacoes (nome, slug) values ('Outra', 'outra') returning id")).rows[0].id;
  await db.query("insert into public.membros values ($1, $2, 'dono'), ($3, $4, 'dono')", [org, dono.id, outra, intruso.id]);

  // Dois dias de mídia do anúncio 111 (campanha 100) e um do 222
  await db.query(
    `insert into public.meta_anuncio_dia (organizacao_id, account_id, ad_id, dia, campaign_id, ad_name, gasto, impressoes, frequencia, leads)
     values ($1, 'act_1', '111111', '2026-11-03', '100000', 'A1', 50, 1000, 1.0, 5),
            ($1, 'act_1', '111111', '2026-11-04', '100000', 'A1', 50, 3000, 2.0, 7),
            ($1, 'act_1', '222222', '2026-11-04', '100000', 'B1', 20, 500, 1.0, 1)`,
    [org],
  );
  await db.query(
    `insert into public.meta_campanha_dia (organizacao_id, account_id, campaign_id, dia, gasto, leads)
     values ($1, 'act_1', '100000', '2026-11-03', 50, 5), ($1, 'act_1', '100000', '2026-11-04', 70, 8)`,
    [org],
  );
  // Leads: 3 do anúncio 111 (um às 23h de 04/11 em Brasília = 05/11 UTC), 1 sem atribuição
  await db.query(
    `insert into public.leads (organizacao_id, id_externo, criado_em, utm_ad_id, utm_campaign_id, teste_iniciado_em) values
       ($1, 'u1', '2026-11-03T15:00:00Z', '111111', '100000', '2026-11-03T16:00:00Z'),
       ($1, 'u2', '2026-11-04T15:00:00Z', '111111', '100000', null),
       ($1, 'u3', '2026-11-05T02:00:00Z', '111111', '100000', null),
       ($1, 'u4', '2026-11-04T15:00:00Z', null, null, null)`,
    [org],
  );
  // Vendas: u1 pagou (vinculada pelo id do lead), u4 pagou sem anúncio, reembolso parcial de u1
  await db.query(
    `insert into public.vendas (organizacao_id, origem, id_externo, valor, ocorrida_em, lead_id_externo, tipo) values
       ($1, 'stripe', 'in_1', 21.5, '2026-11-04T12:00:00Z', 'u1', 'pagamento'),
       ($1, 'stripe', 'in_2', 21.5, '2026-11-04T12:00:00Z', 'u4', 'pagamento'),
       ($1, 'stripe', 'ch_1:reembolso', -1.5, '2026-11-04T13:00:00Z', 'u1', 'reembolso')`,
    [org],
  );
});

describe("desempenho_anuncios", () => {
  it("cruza mídia, leads (pelo fuso) e vendas por anúncio", async () => {
    const r = await como(db, dono, () => db.query<Record<string, string | number>>("select * from public.desempenho_anuncios($1, '2026-11-03', '2026-11-04') order by ad_id", [org]));
    const a = r.rows.find((x) => x.ad_id === "111111")!;
    expect(Number(a.gasto)).toBe(100);
    expect(Number(a.impressoes)).toBe(4000);
    expect(Number(a.frequencia)).toBeCloseTo(1.75); // ponderada pelas impressões
    expect(Number(a.leads_meta)).toBe(12);
    expect(Number(a.leads)).toBe(3); // o das 23h de 04/11 em Brasília entra
    expect(Number(a.testes)).toBe(1);
    expect(Number(a.vendas)).toBe(1);
    expect(Number(a.receita)).toBe(20); // 21,50 − 1,50 de reembolso
    expect(r.rows.find((x) => x.ad_id === "222222")).toMatchObject({ leads: 0 });
  });

  it("outra organização não vê nada", async () => {
    const r = await como(db, intruso, () => db.query("select * from public.desempenho_anuncios($1, '2026-11-01', '2026-11-30')", [org]));
    expect(r.rows).toHaveLength(0);
  });
});

describe("cobertura e série", () => {
  it("mostra quanto chega ao anúncio", async () => {
    const r = await como(db, dono, () => db.query<Record<string, number>>("select * from public.cobertura_atribuicao($1, '2026-11-01', '2026-11-30')", [org]));
    expect(r.rows[0]).toMatchObject({ leads: 4, leads_com_anuncio: 3, vendas: 2, vendas_com_anuncio: 1 });
    expect(Number(r.rows[0].receita)).toBe(41.5);
    expect(Number(r.rows[0].receita_com_anuncio)).toBe(20);
  });

  it("leads por dia preenche os dias vazios", async () => {
    const r = await como(db, dono, () => db.query<{ dia: string; leads_meta: number; leads: number }>("select * from public.leads_por_dia($1, '2026-11-02', '2026-11-05')", [org]));
    expect(r.rows.map((x) => Number(x.leads_meta))).toEqual([0, 5, 8, 0]);
    expect(r.rows.map((x) => Number(x.leads))).toEqual([0, 1, 2, 0]);
  });
});
