// Isolamento entre organizações e regras de acesso, direto no banco (RLS + funções).
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, criarUsuario } from "./pglite";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let db: PGlite;
const u = {} as Record<"admin" | "ana" | "bia" | "caio", { id: string; email: string }>;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await criarBanco();
  for (const nome of ["admin", "ana", "bia", "caio"] as const) {
    const email = `${nome}@exemplo.com`;
    u[nome] = { id: await criarUsuario(db, email), email };
  }
  await db.query("insert into public.administradores_plataforma (usuario_id) values ($1)", [u.admin.id]);
  orgA = await como(db, u.admin, async () => (await db.query<{ id: string }>("select public.criar_organizacao('Org A', 'org-a') as id")).rows[0].id);
  orgB = await como(db, u.admin, async () => (await db.query<{ id: string }>("select public.criar_organizacao('Org B', 'org-b') as id")).rows[0].id);
  // ana: dona da A (admin sai depois); bia: leitura na B
  await db.query("insert into public.membros values ($1, $2, 'dono'), ($3, $4, 'leitura')", [orgA, u.ana.id, orgB, u.bia.id]);
  await db.query("delete from public.membros where organizacao_id = $1 and usuario_id = $2", [orgA, u.admin.id]);
  // dados nas duas organizações
  for (const org of [orgA, orgB]) {
    await db.query("insert into public.conexoes (id, organizacao_id, tipo, nome, status) values (gen_random_uuid(), $1, 'meta', 'Meta', 'ativa')", [org]);
    await db.query(
      "insert into public.conexoes_segredos (conexao_id, organizacao_id, cifrado) select id, organizacao_id, 'v1:x' from public.conexoes where organizacao_id = $1",
      [org],
    );
    await db.query("insert into public.leads (organizacao_id, id_externo, criado_em, utm_ad_id) values ($1, 'lead-1', now(), '120200000001')", [org]);
    await db.query("insert into public.meta_campanha_dia (organizacao_id, account_id, campaign_id, dia, gasto) values ($1, 'act_1', '1201', current_date, 10)", [org]);
  }
});

describe("organizações", () => {
  it("só admin da plataforma cria organização", async () => {
    await expect(como(db, u.ana, () => db.query("select public.criar_organizacao('X', 'xx')"))).rejects.toThrow(/administrador/);
  });

  it("quem cria entra como dono", async () => {
    const r = await db.query<{ papel: string }>("select papel from public.membros where organizacao_id = $1 and usuario_id = $2", [orgB, u.admin.id]);
    expect(r.rows[0].papel).toBe("dono");
  });

  it("cada um vê só as suas organizações", async () => {
    const ana = await como(db, u.ana, () => db.query<{ slug: string }>("select slug from public.organizacoes order by slug"));
    expect(ana.rows.map((r) => r.slug)).toEqual(["org-a"]);
    const caio = await como(db, u.caio, () => db.query("select * from public.organizacoes"));
    expect(caio.rows).toHaveLength(0);
  });

  it("admin vê a organização mas não os dados de quem não é membro", async () => {
    const orgs = await como(db, u.admin, () => db.query("select * from public.organizacoes where id = $1", [orgA]));
    expect(orgs.rows).toHaveLength(1);
    const leads = await como(db, u.admin, () => db.query("select * from public.leads where organizacao_id = $1", [orgA]));
    expect(leads.rows).toHaveLength(0);
  });

  it("anônimo não vê nada", async () => {
    const r = await como(db, null, () => db.query("select * from public.leads"));
    expect(r.rows).toHaveLength(0);
  });
});

describe("isolamento dos dados", () => {
  it("leads, Meta e conexões só da própria organização", async () => {
    for (const tabela of ["leads", "meta_campanha_dia", "conexoes"]) {
      const r = await como(db, u.bia, () => db.query<{ organizacao_id: string }>(`select organizacao_id from public.${tabela}`));
      expect(r.rows.length, tabela).toBeGreaterThan(0);
      expect(r.rows.every((x) => x.organizacao_id === orgB), tabela).toBe(true);
    }
  });

  it("segredos nunca chegam a quem está logado", async () => {
    await expect(como(db, u.ana, () => db.query("select * from public.conexoes_segredos"))).rejects.toThrow(/permission denied/);
    await expect(como(db, u.ana, () => db.query("select * from public.tokens_webhook"))).rejects.toThrow(/permission denied/);
  });

  it("ninguém grava leads pela API (só o servidor)", async () => {
    await expect(
      como(db, u.ana, () => db.query("insert into public.leads (organizacao_id, id_externo, criado_em) values ($1, 'x', now())", [orgA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("leitura não altera conexões", async () => {
    const r = await como(db, u.bia, () => db.query("update public.conexoes set nome = 'outro' where organizacao_id = $1", [orgB]));
    expect(r.affectedRows).toBe(0);
  });
});

describe("convites", () => {
  it("leitura não convida; dono convida", async () => {
    await expect(
      como(db, u.bia, () =>
        db.query("insert into public.convites (organizacao_id, email, papel, token_hash, criado_por) values ($1, 'x@y.com', 'gestor', 'h1', $2)", [orgB, u.bia.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    await como(db, u.ana, () =>
      db.query("insert into public.convites (organizacao_id, email, papel, token_hash, criado_por) values ($1, 'caio@exemplo.com', 'gestor', $2, $3)", [
        orgA,
        sha("token-do-caio"),
        u.ana.id,
      ]),
    );
  });

  it("convite só vale para o e-mail convidado", async () => {
    await expect(como(db, u.bia, () => db.query("select public.aceitar_convite('token-do-caio')"))).rejects.toThrow(/outro e-mail/);
  });

  it("aceitar dá o papel e não pode ser reusado", async () => {
    const r = await como(db, u.caio, () => db.query<{ slug: string }>("select public.aceitar_convite('token-do-caio') as slug"));
    expect(r.rows[0].slug).toBe("org-a");
    const papel = await db.query<{ papel: string }>("select papel from public.membros where organizacao_id = $1 and usuario_id = $2", [orgA, u.caio.id]);
    expect(papel.rows[0].papel).toBe("gestor");
    await expect(como(db, u.caio, () => db.query("select public.aceitar_convite('token-do-caio')"))).rejects.toThrow(/já usado/);
  });

  it("a organização nunca fica sem dono", async () => {
    await expect(
      como(db, u.ana, () => db.query("update public.membros set papel = 'gestor' where organizacao_id = $1 and usuario_id = $2", [orgA, u.ana.id])),
    ).rejects.toThrow(/pelo menos um dono/);
  });
});

describe("atribuição", () => {
  const lead = async (campos: Record<string, string>) => {
    const chaves = Object.keys(campos);
    const r = await db.query<{ ad_id: string | null; campaign_id: string | null; atribuicao: string }>(
      `insert into public.leads (organizacao_id, id_externo, criado_em, ${chaves.join(", ")})
       values ($1, gen_random_uuid()::text, now(), ${chaves.map((_, i) => `$${i + 2}`).join(", ")})
       returning ad_id, campaign_id, atribuicao`,
      [orgA, ...Object.values(campos)],
    );
    return r.rows[0];
  };

  it("usa o ID do anúncio do último toque", async () => {
    expect(await lead({ utm_ad_id: "120200000009", utm_campaign_id: "120200000001", ftp_utm_ad_id: "120200000005" })).toMatchObject({
      ad_id: "120200000009",
      campaign_id: "120200000001",
      atribuicao: "ultimo_toque",
    });
  });

  it("macro não substituída ou nome não contam: cai no primeiro toque", async () => {
    expect(await lead({ utm_ad_id: "{{ad.id}}", utm_content: "Criativo A", ftp_utm_ad_id: "120200000005" })).toMatchObject({
      ad_id: "120200000005",
      atribuicao: "primeiro_toque",
    });
  });

  it("sem anúncio, fica a campanha; sem nada, nenhuma", async () => {
    expect(await lead({ utm_campaign_id: "120200000001" })).toMatchObject({ ad_id: null, campaign_id: "120200000001", atribuicao: "so_campanha" });
    expect(await lead({ utm_source: "instagram" })).toMatchObject({ ad_id: null, campaign_id: null, atribuicao: "nenhuma" });
  });

  it("venda herda o anúncio do lead pelo id externo", async () => {
    await db.query(
      "insert into public.vendas (organizacao_id, origem, id_externo, valor, ocorrida_em, lead_id_externo) values ($1, 'stripe', 'in_1', 21.5, now(), 'lead-1')",
      [orgA],
    );
    const r = await como(db, u.ana, () => db.query<{ ad_id: string }>("select ad_id from public.vendas_atribuidas where id_externo = 'in_1'"));
    expect(r.rows[0].ad_id).toBe("120200000001");
    const bia = await como(db, u.bia, () => db.query("select * from public.vendas_atribuidas where id_externo = 'in_1'"));
    expect(bia.rows).toHaveLength(0);
  });
});

describe("funções de apoio", () => {
  it("lista membros com e-mail só para membros", async () => {
    const ana = await como(db, u.ana, () => db.query<{ email: string }>("select email from public.membros_da_organizacao($1)", [orgA]));
    expect(ana.rows.map((r) => r.email).sort()).toEqual(["ana@exemplo.com", "caio@exemplo.com"]);
    const bia = await como(db, u.bia, () => db.query("select * from public.membros_da_organizacao($1)", [orgA]));
    expect(bia.rows).toHaveLength(0);
  });

  it("mostra o convite pelo token, inclusive sem login", async () => {
    const r = await como(db, null, () => db.query<{ situacao: string; organizacao: string }>("select * from public.ver_convite('token-do-caio')"));
    expect(r.rows[0]).toMatchObject({ organizacao: "Org A", situacao: "usado" });
    const nada = await como(db, null, () => db.query("select * from public.ver_convite('outro')"));
    expect(nada.rows).toHaveLength(0);
  });
});
