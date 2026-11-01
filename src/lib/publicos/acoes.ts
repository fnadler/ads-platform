"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { hashEmail } from "@/lib/vendas/ingestao";
import { buscarInteresses, buscarRegioes, estimarAlcance, type InteresseMeta } from "@/lib/integracoes/metaEscrita";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { DEFINICOES, DefinicaoDetalhado, targetingDoPublico, type Publico, type TipoPublico } from "./modelo";

// Ações dos públicos. Gestor monta; públicos com dados de clientes só são enviados à Meta depois do aceite
// do dono. O sistema nunca apaga públicos na Meta (excluir aqui só tira do Adverdad).

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Token da Meta da organização (o de publicação; sem ele, o de leitura) e a conta de anúncios. */
async function credencialMeta(orgId: string) {
  const admin = criarClienteAdmin();
  const [{ data: conexoes }, { data: config }, { data: conta }] = await Promise.all([
    admin.from("conexoes").select("id, tipo").eq("organizacao_id", orgId).in("tipo", ["meta_publicacao", "meta"]),
    admin.from("config_publicacao").select("account_id, pixel_id").eq("organizacao_id", orgId).maybeSingle(),
    admin.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId).eq("ativa", true).limit(1).maybeSingle(),
  ]);
  const conexao = conexoes?.find((c) => c.tipo === "meta_publicacao") ?? conexoes?.find((c) => c.tipo === "meta");
  const segredo = conexao ? await lerSegredo<SegredoMeta>(admin, orgId, conexao.id) : null;
  if (!segredo) throw new Error("Conecte a Meta em Configurações primeiro.");
  const accountId = config?.account_id ?? conta?.account_id;
  if (!accountId) throw new Error("Ligue uma conta de anúncios em Configurações.");
  return { token: segredo.token, accountId, pixelId: config?.pixel_id ?? null };
}

export async function buscarInteressesAcao(orgId: string, termo: string): Promise<InteresseMeta[]> {
  await acessoOrganizacao(orgId, "gestor");
  if (termo.trim().length < 2) return [];
  const { token } = await credencialMeta(orgId);
  return buscarInteresses(token, termo.trim());
}

export async function buscarRegioesAcao(orgId: string, termo: string) {
  await acessoOrganizacao(orgId, "gestor");
  if (termo.trim().length < 2) return [];
  const { token } = await credencialMeta(orgId);
  return buscarRegioes(token, termo.trim());
}

/** Alcance mensal estimado de um público de interesses (sem salvar). */
export async function estimarAlcanceAcao(orgId: string, definicao: unknown): Promise<{ min: number | null; max: number | null; erro?: string }> {
  await acessoOrganizacao(orgId, "gestor");
  const d = DefinicaoDetalhado.safeParse(definicao);
  if (!d.success) return { min: null, max: null, erro: "Definição incompleta." };
  try {
    const { token, accountId, pixelId } = await credencialMeta(orgId);
    const publico: Publico = { id: "", nome: "", tipo: "detalhado", definicao: d.data, meta_audience_id: null, situacao: "rascunho" };
    return await estimarAlcance(token, accountId, targetingDoPublico(publico, { paises: ["BR"], idade_min: 18, idade_max: 65, advantage: true }, []), pixelId);
  } catch (e) {
    return { min: null, max: null, erro: mensagem(e) };
  }
}

const Salvar = z.object({
  organizacao_id: z.uuid(),
  slug: z.string(),
  id: z.string().optional(),
  tipo: z.enum(["detalhado", "funil", "site", "semelhante"]),
  nome: z.string().trim().min(2, "Dê um nome ao público.").max(120),
  definicao: z.string().optional(),
  estimativa: z.string().optional(),
});

/** Cria ou atualiza o público. Personalizados vão para a fila de envio à Meta. */
export async function salvarPublico(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Salvar.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  const { organizacao_id: orgId, slug, tipo, nome } = v.data;
  // Interesses mandam a definição pronta (JSON do editor); os outros tipos, campos simples do formulário.
  let definicaoBruta: unknown;
  if (v.data.definicao) {
    try {
      definicaoBruta = JSON.parse(v.data.definicao);
    } catch {
      return { erro: "Definição inválida." };
    }
  } else {
    const campo = (k: string) => (dados.get(k) === "" || dados.get(k) === null ? undefined : String(dados.get(k)));
    definicaoBruta = { segmento: campo("segmento"), dias: campo("dias") ?? null, origem_publico_id: campo("origem_publico_id"), percentual: campo("percentual"), pais: "BR" };
  }
  const d = DEFINICOES[tipo as TipoPublico].safeParse(definicaoBruta);
  if (!d.success) return { erro: d.error.issues[0].message };
  if (tipo === "detalhado" && d.data && "idade_min" in d.data && d.data.idade_min > d.data.idade_max) return { erro: "A idade mínima é maior que a máxima." };
  let id = v.data.id && v.data.id !== "novo" ? v.data.id : null;
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
    const estimativa = v.data.estimativa ? JSON.parse(v.data.estimativa) : null;
    if (id) {
      const { data: atual } = await supabase.from("publicos").select("tipo, meta_audience_id").eq("id", id).eq("organizacao_id", orgId).single();
      if (atual?.meta_audience_id && (atual.tipo === "site" || atual.tipo === "semelhante"))
        return { erro: "Este público já foi criado na Meta e não pode mudar de regra. Crie outro público." };
      const { error } = await supabase
        .from("publicos")
        .update({ nome, definicao: d.data, ...(tipo === "detalhado" ? { estimativa, situacao: "pronto" } : {}), atualizado_em: new Date().toISOString() })
        .eq("id", id)
        .eq("organizacao_id", orgId);
      if (error) return { erro: error.code === "23505" ? "Já existe um público com esse nome." : error.message };
    } else {
      const { data, error } = await supabase
        .from("publicos")
        .insert({ organizacao_id: orgId, nome, tipo, definicao: d.data, estimativa: tipo === "detalhado" ? estimativa : null, criado_por: usuario.id })
        .select("id")
        .single();
      if (error || !data) return { erro: error?.code === "23505" ? "Já existe um público com esse nome." : (error?.message ?? "Não foi possível salvar.") };
      id = data.id as string;
      if (tipo === "detalhado") await criarClienteAdmin().from("publicos").update({ situacao: "pronto" }).eq("id", id);
    }
    if (tipo !== "detalhado") {
      const r = await enfileirarEnvio(orgId, id, tipo);
      if (r) return { erro: r };
    }
  } catch (e) {
    return { erro: mensagem(e) };
  }
  redirect(rotaOrg(slug, `/publicos/${id}`));
}

async function enfileirarEnvio(orgId: string, publicoId: string, tipo: string) {
  const admin = criarClienteAdmin();
  if (tipo === "funil") {
    const { data: cfg } = await admin.from("config_publicacao").select("aceite_publicos_clientes_em").eq("organizacao_id", orgId).maybeSingle();
    if (!cfg?.aceite_publicos_clientes_em) return null; // fica em rascunho até o dono autorizar (a tela avisa)
  }
  const { error } = await admin.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "meta_publico", p_alvo: publicoId, p_modo: "manual" });
  return error ? error.message : null;
}

/** Envia (ou reenvia) o público à Meta agora. */
export async function enviarPublico(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: p } = await supabase.from("publicos").select("tipo").eq("id", id).eq("organizacao_id", orgId).single();
    if (!p) return { erro: "Público não encontrado." };
    if (p.tipo === "funil") {
      const { data: cfg } = await supabase.from("config_publicacao").select("aceite_publicos_clientes_em").eq("organizacao_id", orgId).maybeSingle();
      if (!cfg?.aceite_publicos_clientes_em) return { erro: "O dono precisa autorizar o uso de dados de clientes em públicos (Configurações → Meta (publicação))." };
    }
    const r = await enfileirarEnvio(orgId, id, p.tipo);
    if (r) return { erro: r };
    refresh();
    return { mensagem: "Na fila. Em até 1 minuto o público é atualizado na Meta." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function excluirPublico(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { error } = await supabase.from("publicos").delete().eq("id", String(dados.get("id"))).eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
  } catch (e) {
    return { erro: mensagem(e) };
  }
  redirect(rotaOrg(String(dados.get("slug")), "/publicos"));
}

/** Dono autoriza (ou revoga) o uso de dados de clientes (hash de e-mail e telefone) em públicos da Meta. */
export async function aceitarPublicosClientes(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const aceitar = dados.get("aceite") === "sim";
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const { error } = await supabase
      .from("config_publicacao")
      .update(aceitar ? { aceite_publicos_clientes_em: new Date().toISOString(), aceite_publicos_clientes_por: usuario.id } : { aceite_publicos_clientes_em: null, aceite_publicos_clientes_por: null })
      .eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: aceitar ? "publicos.clientes_autorizado" : "publicos.clientes_revogado", p_detalhes: {} });
    refresh();
    return { mensagem: aceitar ? "Autorizado. Os públicos do funil já podem ser enviados à Meta." : "Autorização revogada. As listas deixam de ser atualizadas." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Direito de oposição: tira um e-mail de todos os públicos (vale na atualização diária seguinte). */
export async function retirarDosPublicos(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const email = String(dados.get("email") ?? "").trim();
  if (!email.includes("@")) return { erro: "Informe um e-mail válido." };
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const { count, error } = await criarClienteAdmin()
      .from("leads")
      .update({ fora_de_publicos_em: new Date().toISOString() }, { count: "exact" })
      .eq("organizacao_id", orgId)
      .eq("email_hash", hashEmail(email)!);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "publicos.oposicao", p_detalhes: { encontrados: count ?? 0 } });
    return count
      ? { mensagem: "Pronto: este e-mail sai das listas na próxima atualização diária (ou agora, se você clicar em “Atualizar agora” nos públicos do funil)." }
      : { mensagem: "Nenhum lead com este e-mail: ele não está em nenhuma lista." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
