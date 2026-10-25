"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { novoToken, sha256 } from "@/lib/cifra";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { urlSistema } from "@/lib/url";

const PAPEIS = ["leitura", "gestor", "dono"] as const;

const NovaOrganizacao = z.object({
  nome: z.string().trim().min(2, "Nome muito curto."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "Endereço: só letras minúsculas, números e hífen (2 a 40)."),
});

export async function criarOrganizacao(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = NovaOrganizacao.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("criar_organizacao", { p_nome: v.data.nome, p_slug: v.data.slug });
  if (error) return { erro: error.code === "23505" ? "Já existe uma organização com esse endereço." : error.message };
  redirect(rotaOrg(v.data.slug, "/configuracoes/membros"));
}

const NovoConvite = z.object({
  organizacao_id: z.uuid(),
  email: z.email("E-mail inválido.").trim().toLowerCase(),
  papel: z.enum(PAPEIS),
});

/** Cria o convite e devolve o link (uma vez só) para mandar à pessoa. */
export async function convidar(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = NovoConvite.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  try {
    const { usuario, supabase } = await acessoOrganizacao(v.data.organizacao_id, "dono");
    const token = novoToken();
    const { error } = await supabase.from("convites").insert({
      organizacao_id: v.data.organizacao_id,
      email: v.data.email,
      papel: v.data.papel,
      token_hash: sha256(token),
      criado_por: usuario.id,
    });
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: v.data.organizacao_id, p_acao: "convite.criado", p_detalhes: { email: v.data.email, papel: v.data.papel } });
    refresh();
    return { mensagem: `Convite criado para ${v.data.email}. Mande este link (vale 7 dias):`, segredo: `${await urlSistema()}/convite/${token}` };
  } catch (e) {
    return { erro: (e as Error).message };
  }
}

export async function revogarConvite(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const { error } = await supabase.from("convites").delete().eq("id", String(dados.get("id"))).eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    refresh();
    return null;
  } catch (e) {
    return { erro: (e as Error).message };
  }
}

export async function alterarPapel(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const papel = z.enum(PAPEIS).safeParse(dados.get("papel"));
  if (!papel.success) return { erro: "Papel inválido." };
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const usuarioId = String(dados.get("usuario_id"));
    const { error } = await supabase.from("membros").update({ papel: papel.data }).eq("organizacao_id", orgId).eq("usuario_id", usuarioId);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "membro.papel", p_detalhes: { usuario_id: usuarioId, papel: papel.data } });
    refresh();
    return null;
  } catch (e) {
    return { erro: (e as Error).message };
  }
}

export async function removerMembro(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const usuarioId = String(dados.get("usuario_id"));
    const { error } = await supabase.from("membros").delete().eq("organizacao_id", orgId).eq("usuario_id", usuarioId);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "membro.removido", p_detalhes: { usuario_id: usuarioId } });
    refresh();
    return null;
  } catch (e) {
    return { erro: (e as Error).message };
  }
}

/** Já logado com o e-mail do convite: entra na organização. */
export async function aceitarConvite(_: Resultado, dados: FormData): Promise<Resultado> {
  const supabase = await criarClienteServidor();
  const { data: slug, error } = await supabase.rpc("aceitar_convite", { p_token: String(dados.get("token")) });
  if (error) return { erro: error.message };
  redirect(rotaOrg(slug as string));
}

/** Sem conta ainda: cria a conta do e-mail convidado com a senha escolhida, entra e aceita. */
export async function criarContaPorConvite(_: Resultado, dados: FormData): Promise<Resultado> {
  const token = String(dados.get("token"));
  const senha = String(dados.get("senha") ?? "");
  if (senha.length < 10) return { erro: "A senha precisa ter pelo menos 10 caracteres." };
  if (senha !== String(dados.get("confirmacao") ?? "")) return { erro: "As senhas não conferem." };

  const supabase = await criarClienteServidor();
  const { data: convite } = await supabase.rpc("ver_convite", { p_token: token }).maybeSingle<{ email: string; situacao: string }>();
  if (!convite || convite.situacao !== "valido") return { erro: "Convite inválido, expirado ou já usado." };

  const { error: erroConta } = await criarClienteAdmin().auth.admin.createUser({ email: convite.email, password: senha, email_confirm: true });
  if (erroConta) {
    return /already|registered|exists/i.test(erroConta.message)
      ? { erro: "Já existe uma conta com este e-mail. Entre com ela e abra o link do convite de novo." }
      : { erro: erroConta.message };
  }
  const { error: erroLogin } = await supabase.auth.signInWithPassword({ email: convite.email, password: senha });
  if (erroLogin) return { erro: erroLogin.message };
  const { data: slug, error } = await supabase.rpc("aceitar_convite", { p_token: token });
  if (error) return { erro: error.message };
  redirect(rotaOrg(slug as string));
}
