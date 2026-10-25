import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Camada de acesso: quem está logado e com que papel em qual organização. O RLS do banco é a garantia;
// estas checagens só dão a resposta certa na tela (redirecionar, 404) antes de consultar.

export type Papel = "leitura" | "gestor" | "dono";
const ORDEM: Record<Papel, number> = { leitura: 1, gestor: 2, dono: 3 };
export const temPapel = (papel: Papel | null, minimo: Papel) => !!papel && ORDEM[papel] >= ORDEM[minimo];

export interface Usuario {
  id: string;
  email: string;
}

export interface Organizacao {
  id: string;
  nome: string;
  slug: string;
  fuso: string;
  moeda: string;
}

export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
});

export async function exigirUsuario(): Promise<Usuario> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/entrar");
  return usuario;
}

export const ehAdminPlataforma = cache(async () => {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("eh_admin_plataforma");
  return data === true;
});

/** Organização pelo slug com o papel de quem está logado. Sem acesso (ou papel abaixo do mínimo): 404. */
export const exigirOrganizacao = cache(async (slug: string, minimo: Papel = "leitura") => {
  const usuario = await exigirUsuario();
  const supabase = await criarClienteServidor();
  const { data: org } = await supabase.from("organizacoes").select("id, nome, slug, fuso, moeda").eq("slug", slug).maybeSingle<Organizacao>();
  if (!org) notFound();
  const { data: papel } = await supabase.rpc("papel_na_org", { p_org: org.id });
  if (!temPapel(papel as Papel | null, minimo)) notFound();
  return { usuario, org, papel: papel as Papel, supabase };
});

/** Para server actions: devolve erro em vez de redirecionar. */
export async function acessoOrganizacao(orgId: string, minimo: Papel) {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sua sessão expirou. Entre de novo.");
  const { data: papel } = await supabase.rpc("papel_na_org", { p_org: orgId });
  if (!temPapel(papel as Papel | null, minimo)) throw new Error("Você não tem permissão para isso nesta organização.");
  return { usuario: { id: data.user.id, email: data.user.email ?? "" }, papel: papel as Papel, supabase };
}

export const ROTULO_PAPEL: Record<Papel, string> = { dono: "Dono", gestor: "Gestor", leitura: "Leitura" };
