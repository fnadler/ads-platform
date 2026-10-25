// Cria (ou promove) um administrador da plataforma: quem cria organizações no piloto.
//
//   node --env-file=.env.local scripts/criar-admin.mjs voce@empresa.com.br
//
// Se a conta não existe, é criada com uma senha aleatória, mostrada uma vez (troque depois entrando
// com o link por e-mail ou pedindo nova senha). Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email?.includes("@")) {
  console.error("Uso: node --env-file=.env.local scripts/criar-admin.mjs <email>");
  process.exit(1);
}
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.");
  process.exit(1);
}
const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let usuario = null;
for (let page = 1; !usuario; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  usuario = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 1000) break;
}

let senha = null;
if (!usuario) {
  senha = randomBytes(12).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw error;
  usuario = data.user;
}

const { error } = await admin.from("administradores_plataforma").upsert({ usuario_id: usuario.id });
if (error) throw error;
console.log(`${email} agora é administrador da plataforma.`);
if (senha) console.log(`Conta criada. Senha provisória (aparece só agora): ${senha}`);
