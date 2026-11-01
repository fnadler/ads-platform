"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { lerSegredo, salvarSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { ErroMeta } from "@/lib/integracoes/meta";
import { ClienteMetaEscrita, lerPrerequisitos } from "@/lib/integracoes/metaEscrita";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { BUCKET_UPLOADS, carregarContextoPublicacao } from "./job";
import { CHAMADAS, payloadCampanha, validarRascunho } from "./modelo";

// Ações do assistente de campanhas. Gestor monta e envia; o dono conecta a credencial de publicação e
// define Página, Instagram, conjunto de dados e o teto de verba. Ativar (começar a gastar) pede confirmação.

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const agoraIso = () => new Date().toISOString();

// ───────────────────────────── Conexão e configuração ─────────────────────────────

/** Token do usuário do sistema com ads_management: valida (leitura) e guarda cifrado. */
export async function conectarPublicacao(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const token = String(dados.get("token") ?? "").trim();
  if (token.length < 50) return { erro: "Cole o token completo do usuário do sistema (começa com EAA…)." };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const { data: conta } = await admin.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId).eq("ativa", true).limit(1).maybeSingle();
    if (!conta) return { erro: "Ligue primeiro uma conta de anúncios na conexão de leitura da Meta (logo acima)." };
    const p = await lerPrerequisitos(token, conta.account_id);
    if (!p.permissoes.includes("ads_management"))
      return { erro: `O token não tem a permissão ads_management (tem: ${p.permissoes.join(", ") || "nenhuma"}). Gere outro marcando ads_management.` };
    if (!p.conta) return { erro: `O token não enxerga a conta ${conta.account_id}. Atribua a conta ao usuário do sistema com “Gerenciar campanhas”.` };
    const faltando = ["pages_show_list", "pages_read_engagement"].filter((x) => !p.permissoes.includes(x));

    const { data: conexao, error } = await admin
      .from("conexoes")
      .upsert(
        { organizacao_id: orgId, tipo: "meta_publicacao", nome: "Meta (publicação)", status: "ativa", ultimo_erro: null, validado_em: agoraIso(), criado_por: usuario.id, config: { usuario_nome: p.usuario.nome }, atualizado_em: agoraIso() },
        { onConflict: "organizacao_id,tipo,nome" },
      )
      .select("id, organizacao_id")
      .single();
    if (error || !conexao) return { erro: error?.message ?? "Não foi possível gravar a conexão." };
    await salvarSegredo(admin, conexao, { token });
    // Primeira vez: já deixa a conta e, se houver só uma opção, a Página e o conjunto de dados escolhidos.
    const { data: atual } = await admin.from("config_publicacao").select("organizacao_id").eq("organizacao_id", orgId).maybeSingle();
    if (!atual) {
      const unica = <T,>(l: T[]) => (l.length === 1 ? l[0] : null);
      const pag = unica(p.paginas);
      const ig = unica(p.instagram);
      const px = unica(p.pixels);
      await admin.from("config_publicacao").insert({
        organizacao_id: orgId,
        account_id: conta.account_id,
        page_id: pag?.id ?? null,
        page_nome: pag?.nome ?? null,
        instagram_user_id: ig?.id ?? null,
        instagram_nome: ig?.nome ?? null,
        pixel_id: px?.id ?? null,
        pixel_nome: px?.nome ?? null,
      });
    }
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.meta_publicacao", p_detalhes: { usuario_meta: p.usuario.nome } });
    refresh();
    return {
      mensagem: faltando.length
        ? `Conectado como ${p.usuario.nome ?? p.usuario.id}, mas o token não tem ${faltando.join(" e ")}: sem isso a Meta não lista as Páginas. Gere o token marcando também essas permissões (e instagram_basic).`
        : `Conectado como ${p.usuario.nome ?? p.usuario.id}. Confira abaixo a Página, o Instagram e o conjunto de dados.`,
    };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

const Config = z.object({
  organizacao_id: z.uuid(),
  page: z.string().regex(/^\d+\|.*$/, "Escolha a Página."),
  instagram: z.string().regex(/^(\d+\|.*)?$/),
  pixel: z.string().regex(/^\d+\|.*$/, "Escolha o conjunto de dados."),
  teto_verba_diaria: z.coerce.number().positive("Informe o teto de verba diária."),
});

export async function salvarConfigPublicacao(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Config.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  const separar = (s: string) => {
    const i = s.indexOf("|");
    return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [null, null];
  };
  const [pageId, pageNome] = separar(v.data.page);
  const [igId, igNome] = separar(v.data.instagram);
  const [pixelId, pixelNome] = separar(v.data.pixel);
  try {
    const { supabase } = await acessoOrganizacao(v.data.organizacao_id, "dono");
    const { error } = await supabase
      .from("config_publicacao")
      .update({ page_id: pageId, page_nome: pageNome, instagram_user_id: igId, instagram_nome: igNome, pixel_id: pixelId, pixel_nome: pixelNome, teto_verba_diaria: v.data.teto_verba_diaria, atualizado_em: agoraIso() })
      .eq("organizacao_id", v.data.organizacao_id);
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Configuração de publicação salva." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Rascunhos ─────────────────────────────

const amanha = (fuso: string) => `${new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: fuso })}T00:00`;

export async function criarRascunho(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const slug = String(dados.get("slug"));
  const nome = String(dados.get("nome") ?? "").trim();
  if (nome.length < 2) return { erro: "Dê um nome à campanha." };
  let id: string;
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
    const [{ data: org }, { data: config }, { data: ultima }] = await Promise.all([
      supabase.from("organizacoes").select("fuso").eq("id", orgId).single(),
      supabase.from("config_publicacao").select("teto_verba_diaria").eq("organizacao_id", orgId).maybeSingle(),
      supabase.from("campanhas_assistente").select("rascunho").eq("organizacao_id", orgId).order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const anterior = (ultima?.rascunho ?? {}) as Record<string, unknown>;
    const { data, error } = await supabase
      .from("campanhas_assistente")
      .insert({
        organizacao_id: orgId,
        nome,
        criado_por: usuario.id,
        rascunho: {
          verba_diaria: Math.min(50, Number(config?.teto_verba_diaria ?? 50)),
          inicio: amanha(org?.fuso ?? "America/Sao_Paulo"),
          evento: anterior.evento ?? "COMPLETE_REGISTRATION",
          paises: ["BR"],
          idade_min: 18,
          idade_max: 65,
          publico_advantage: true,
          url_destino: anterior.url_destino ?? "",
        },
      })
      .select("id")
      .single();
    if (error || !data) return { erro: error?.message ?? "Não foi possível criar o rascunho." };
    id = data.id;
  } catch (e) {
    return { erro: mensagem(e) };
  }
  redirect(rotaOrg(slug, `/campanhas/${id}`));
}

export async function salvarRascunho(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const nome = String(dados.get("nome") ?? "").trim();
    const rascunho = {
      verba_diaria: Number(String(dados.get("verba_diaria") ?? "").replace(",", ".")),
      inicio: String(dados.get("inicio") ?? ""),
      fim: String(dados.get("fim") ?? ""),
      evento: String(dados.get("evento") ?? "COMPLETE_REGISTRATION"),
      paises: ["BR"],
      idade_min: Number(dados.get("idade_min") ?? 18),
      idade_max: Number(dados.get("idade_max") ?? 65),
      publico_advantage: dados.get("publico_advantage") === "on",
      url_destino: String(dados.get("url_destino") ?? "").trim(),
    };
    const { error, count } = await supabase
      .from("campanhas_assistente")
      .update({ nome, rascunho, status: "rascunho", erro: null, atualizado_em: agoraIso() }, { count: "exact" })
      .eq("id", id)
      .eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    if (!count) return { erro: "Esta campanha já foi enviada à Meta e não pode mais ser editada aqui." };
    refresh();
    return { mensagem: "Rascunho salvo." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function excluirRascunho(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: arquivos } = await supabase.from("criativos_assistente").select("arquivo_path").eq("campanha_id", id);
    const { error, count } = await supabase.from("campanhas_assistente").delete({ count: "exact" }).eq("id", id).eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    if (!count) return { erro: "Só dá para excluir campanhas que ainda não foram enviadas à Meta." };
    if (arquivos?.length) await supabase.storage.from(BUCKET_UPLOADS).remove(arquivos.map((a) => a.arquivo_path));
  } catch (e) {
    return { erro: mensagem(e) };
  }
  redirect(rotaOrg(String(dados.get("slug")), "/campanhas"));
}

// ───────────────────────────── Criativos ─────────────────────────────

/** Depois do upload direto ao Storage (navegador), registra o criativo. O RLS confere o caminho. */
export async function registrarCriativo(orgId: string, campanhaId: string, arquivo: { path: string; nome: string; mime: string; tamanho: number }) {
  const { supabase } = await acessoOrganizacao(orgId, "gestor");
  const tipo = arquivo.mime.startsWith("video/") ? "video" : "imagem";
  const { count } = await supabase.from("criativos_assistente").select("*", { count: "exact", head: true }).eq("campanha_id", campanhaId);
  const { error } = await supabase.from("criativos_assistente").insert({
    organizacao_id: orgId,
    campanha_id: campanhaId,
    ordem: count ?? 0,
    nome: arquivo.nome.replace(/\.[a-z0-9]+$/i, "").slice(0, 200) || "Criativo",
    tipo,
    arquivo_path: arquivo.path,
    arquivo_nome: arquivo.nome,
    mime: arquivo.mime,
    tamanho: arquivo.tamanho,
  });
  if (error) throw new Error(error.message);
  refresh();
}

const Criativo = z.object({
  organizacao_id: z.uuid(),
  id: z.uuid(),
  nome: z.string().trim().min(1, "Dê um nome ao anúncio.").max(200),
  texto: z.string().max(2000),
  titulo: z.string().max(255),
  chamada: z.enum(Object.keys(CHAMADAS) as [keyof typeof CHAMADAS, ...Array<keyof typeof CHAMADAS>]),
});

export async function salvarCriativo(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Criativo.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  try {
    const { supabase } = await acessoOrganizacao(v.data.organizacao_id, "gestor");
    const { error, count } = await supabase
      .from("criativos_assistente")
      .update({ nome: v.data.nome, texto: v.data.texto, titulo: v.data.titulo, chamada: v.data.chamada }, { count: "exact" })
      .eq("id", v.data.id)
      .eq("organizacao_id", v.data.organizacao_id);
    if (error) return { erro: error.message };
    if (!count) return { erro: "Este anúncio já foi criado na Meta e não pode mais ser editado aqui." };
    refresh();
    return { mensagem: "Salvo." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Copia texto, título e botão de um criativo para todos os outros da campanha (ganchos com o mesmo corpo). */
export async function copiarTextosParaTodos(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: c } = await supabase.from("criativos_assistente").select("campanha_id, texto, titulo, chamada").eq("id", id).eq("organizacao_id", orgId).single();
    if (!c) return { erro: "Criativo não encontrado." };
    const { error } = await supabase
      .from("criativos_assistente")
      .update({ texto: c.texto, titulo: c.titulo, chamada: c.chamada })
      .eq("campanha_id", c.campanha_id)
      .eq("organizacao_id", orgId)
      .is("meta_creative_id", null);
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Texto, título e botão copiados para os outros anúncios." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function removerCriativo(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: c } = await supabase.from("criativos_assistente").select("arquivo_path").eq("id", String(dados.get("id"))).eq("organizacao_id", orgId).maybeSingle();
    const { error, count } = await supabase.from("criativos_assistente").delete({ count: "exact" }).eq("id", String(dados.get("id"))).eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    if (!count) return { erro: "Este anúncio já foi criado na Meta." };
    if (c?.arquivo_path) await supabase.storage.from(BUCKET_UPLOADS).remove([c.arquivo_path]);
    refresh();
    return null;
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Validar, enviar, ativar ─────────────────────────────

/** Regras do modelo + leitura dos pré-requisitos + validação da campanha pela própria Meta (sem criar nada). */
export async function validarNaMeta(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { usuario } = await acessoOrganizacao(orgId, "gestor");
    const admin = criarClienteAdmin();
    const ctx = await carregarContextoPublicacao(admin, orgId, id);
    const { problemas } = validarRascunho(ctx.campanha.rascunho, ctx.criativos, ctx.config, ctx.fuso);
    if (problemas.length) return { erro: problemas.map((p) => p.texto).join(" ") };
    const p = await lerPrerequisitos(ctx.token, ctx.config!.account_id!);
    const avisos: string[] = [];
    if (!p.permissoes.includes("ads_management")) return { erro: "O token de publicação perdeu a permissão ads_management." };
    if (!p.conta?.ativa) return { erro: `A conta de anúncios está ${p.conta?.motivo ?? "inacessível"}: resolva no Gerenciador antes de publicar.` };
    if (!p.paginas.some((x) => x.id === ctx.config!.page_id)) return { erro: "A conta não pode anunciar pela Página escolhida. Confira a Página em Configurações." };
    const pixel = p.pixels.find((x) => x.id === ctx.config!.pixel_id);
    if (!pixel) return { erro: "O conjunto de dados escolhido não está conectado à conta de anúncios." };
    if (!pixel.ultimoEvento || Date.now() - Date.parse(pixel.ultimoEvento) > 7 * 86_400_000) avisos.push("o conjunto de dados não recebe eventos há mais de 7 dias");
    const meta = new ClienteMetaEscrita({ token: ctx.token, admin, organizacaoId: orgId, campanhaId: id, usuarioId: usuario.id });
    await meta.criar(ctx.config!.account_id!, "campaigns", payloadCampanha(ctx.campanha.nome), true);
    return { mensagem: `Tudo certo: a Meta aceitou a campanha e os pré-requisitos estão ok${avisos.length ? ` (atenção: ${avisos.join("; ")})` : ""}. O conjunto e os anúncios são conferidos pela Meta na criação.` };
  } catch (e) {
    return { erro: e instanceof ErroMeta ? `A Meta recusou: ${e.message}` : mensagem(e) };
  }
}

/** Envia para a fila: cria tudo PAUSADO na Meta. */
export async function enviarParaMeta(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    await acessoOrganizacao(orgId, "gestor");
    const admin = criarClienteAdmin();
    const ctx = await carregarContextoPublicacao(admin, orgId, id);
    if (!["rascunho", "erro"].includes(ctx.campanha.status)) return { erro: "Esta campanha já está sendo criada ou já foi criada." };
    const { problemas } = validarRascunho(ctx.campanha.rascunho, ctx.criativos, ctx.config, ctx.fuso, ctx.campanha.meta_campaign_id ? new Date(0) : new Date());
    if (problemas.length) return { erro: problemas.map((p) => p.texto).join(" ") };
    await admin.from("campanhas_assistente").update({ status: "criando", erro: null, atualizado_em: agoraIso() }).eq("id", id).eq("organizacao_id", orgId);
    const { error } = await admin.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "meta_publicacao", p_alvo: id, p_modo: "manual" });
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Enviada. A criação começa em até 1 minuto; vídeos podem levar alguns minutos para a Meta processar." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Ativa anúncios, conjunto e campanha criados pelo sistema (a campanha por último). Começa a gastar no início programado. */
export async function ativarCampanha(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  if (dados.get("confirmacao") !== "ATIVAR") return { erro: "Digite ATIVAR para confirmar." };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
    const admin = criarClienteAdmin();
    const { data: c } = await admin.from("campanhas_assistente").select("status, meta_campaign_id, meta_adset_id").eq("id", id).eq("organizacao_id", orgId).single();
    if (c?.status !== "criada" || !c.meta_campaign_id || !c.meta_adset_id) return { erro: "Só dá para ativar uma campanha criada e ainda pausada." };
    const { data: anuncios } = await admin.from("criativos_assistente").select("meta_ad_id").eq("campanha_id", id).not("meta_ad_id", "is", null);
    const conexao = await admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "meta_publicacao").single();
    const segredo = conexao.data ? await lerSegredo<SegredoMeta>(admin, orgId, conexao.data.id) : null;
    if (!segredo) return { erro: "Conexão de publicação ausente." };
    await admin.from("campanhas_assistente").update({ status: "ativando", atualizado_em: agoraIso() }).eq("id", id);
    const meta = new ClienteMetaEscrita({ token: segredo.token, admin, organizacaoId: orgId, campanhaId: id, usuarioId: usuario.id });
    try {
      for (const a of anuncios ?? []) await meta.ativar(a.meta_ad_id!);
      await meta.ativar(c.meta_adset_id);
      await meta.ativar(c.meta_campaign_id);
    } catch (e) {
      await admin.from("campanhas_assistente").update({ status: "criada", erro: `Falha ao ativar: ${mensagem(e)}`, atualizado_em: agoraIso() }).eq("id", id);
      throw e;
    }
    await admin.from("campanhas_assistente").update({ status: "ativa", erro: null, ativada_em: agoraIso(), ativada_por: usuario.id, atualizado_em: agoraIso() }).eq("id", id);
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "campanha.ativada", p_detalhes: { campanha: id, meta_campaign_id: c.meta_campaign_id } });
    refresh();
    return { mensagem: "Campanha ativada. Ela começa a veicular no início programado, depois da análise da Meta." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
