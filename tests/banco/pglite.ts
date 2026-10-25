// Banco de teste: Postgres em WASM (PGlite) com as migrações do projeto e um "auth" mínimo no formato do
// Supabase (auth.users, auth.uid(), auth.jwt() e os papéis anon/authenticated/service_role). Pula as
// migrações de infraestrutura (pgmq, pg_cron, pg_net, Storage), que o PGlite não tem.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
const PULAR = /_infra_/;

const AUTH_FALSO = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export async function criarBanco() {
  const db = new PGlite();
  await db.exec(AUTH_FALSO);
  for (const arquivo of readdirSync(PASTA).filter((f) => f.endsWith(".sql") && !PULAR.test(f)).sort()) {
    try {
      await db.exec(readFileSync(join(PASTA, arquivo), "utf8"));
    } catch (e) {
      throw new Error(`Migração ${arquivo}: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Cria um usuário em auth.users. */
export async function criarUsuario(db: PGlite, email: string) {
  const id = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

/** Roda `fn` como o usuário (papel authenticated, com o JWT dele), e volta ao superusuário no fim. */
export async function como<T>(db: PGlite, usuario: { id: string; email: string } | null, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
    usuario?.id ?? "",
    usuario ? JSON.stringify({ sub: usuario.id, email: usuario.email }) : "",
  ]);
  await db.exec(`set role ${usuario ? "authenticated" : "anon"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)");
  }
}
