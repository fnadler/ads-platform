"use server";

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { conectarMeta } from "@/lib/conexoes/acoes";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { validarTokenMeta } from "@/lib/integracoes/meta";
import { conectarPublicacao } from "@/lib/publicacao/acoes";
import { montarUrlTeste, PARAMETROS_META } from "@/lib/rastreio/regras";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { permissoesDoToken, RespostasNegocio, usaCheckoutExterno, type Onboarding } from "./modelo";
import { analisarPagina, validarUrlPagina } from "./pagina";
import { abrirPagina, lerScripts } from "./rede";

// Ações do assistente de configuração. Elas reaproveitam as conexões que já existem: aqui fica só o que é próprio
// do passo a passo (guardar respostas, usar um token só, conferir a página, criar o teste sem anúncio).

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const irPara = (slug: FormDataEntryValue | null, tela: string) => redirect(rotaOrg(String(slug), `/configurar?tela=${tela}`));

async function atualizar(orgId: string, patch: Partial<Onboarding>, extra: Record<string, unknown> = {}) {
  const admin = criarClienteAdmin();
  const { data: org, error: e1 } = await admin.from("organizacoes").select("onboarding").eq("id", orgId).single();
  if (e1) throw new Error(e1.message);
  const { error } = await admin
    .from("organizacoes")
    .update({ onboarding: { ...(org.onboarding as object), ...patch }, ...extra })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
}

export async function salvarNegocio(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const v = RespostasNegocio.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  try {
    await acessoOrganizacao(orgId, "gestor");
    await atualizar(orgId, v.data, { funil: v.data.funil });
  } catch (e) {
    return { erro: mensagem(e) };
  }
  return irPara(dados.get("slug"), "meta-acesso");
}

/** Um token só: confere as permissões do caminho escolhido e conecta a leitura. A publicação usa o mesmo token. */
export async function conectarToken(anterior: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const token = String(dados.get("token") ?? "").trim();
  if (token.length < 50) return { erro: "Cole o token completo: ele começa com EAA e é bem longo." };
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const { data: org } = await supabase.from("organizacoes").select("onboarding").eq("id", orgId).single();
    const campanhas = (org?.onboarding as Onboarding | undefined)?.campanhas === "sim";
    const { permissoes } = await validarTokenMeta(token);
    const faltando = permissoesDoToken(campanhas).filter((p) => !permissoes.includes(p));
    if (faltando.length) return { erro: `O token é válido, mas foi gerado sem: ${faltando.join(", ")}. Gere outro token e marque todas as permissões da lista.` };
    const r = await conectarMeta(anterior, dados);
    if (r?.erro) return r;
  } catch (e) {
    return { erro: mensagem(e) };
  }
  return irPara(dados.get("slug"), "meta-escolhas");
}

const Escolhas = z.object({
  organizacao_id: z.uuid(),
  pixel: z.string().regex(/^\d+\|.*$/, "Escolha o pixel do seu site."),
  page: z
    .string()
    .regex(/^(\d+\|.*)?$/)
    .optional(),
  instagram: z
    .string()
    .regex(/^(\d+\|.*)?$/)
    .optional(),
  teto_verba_diaria: z.coerce.number().positive("Informe o teto de verba diária.").optional(),
});
const separar = (s?: string) => {
  const i = s?.indexOf("|") ?? -1;
  return i > 0 ? [s!.slice(0, i), s!.slice(i + 1)] : [null, null];
};

/** Pixel e, para quem cria campanhas, Página, Instagram e teto. A publicação nasce aqui, com o token já conectado. */
export async function salvarEscolhas(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Escolhas.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  const orgId = v.data.organizacao_id;
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const [{ data: org }, { data: conta }, { data: leitura }, { data: publicacao }] = await Promise.all([
      admin.from("organizacoes").select("onboarding").eq("id", orgId).single(),
      admin.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId).eq("ativa", true).limit(1).maybeSingle(),
      admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "meta").maybeSingle(),
      admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "meta_publicacao").maybeSingle(),
    ]);
    if (!conta || !leitura) return { erro: "Conecte a Meta e escolha a conta de anúncios primeiro." };
    const campanhas = (org?.onboarding as Onboarding | undefined)?.campanhas === "sim";
    const [pageId, pageNome] = separar(v.data.page);
    const [igId, igNome] = separar(v.data.instagram);
    const [pixelId, pixelNome] = separar(v.data.pixel);
    if (campanhas && !pageId) return { erro: "Escolha a Página que assina os anúncios. Se a lista estiver vazia, volte a Acesso aos ativos e dê acesso à Página." };
    if (campanhas && !publicacao) {
      const segredo = await lerSegredo<SegredoMeta>(admin, orgId, leitura.id);
      const fd = new FormData();
      fd.set("organizacao_id", orgId);
      fd.set("token", segredo?.token ?? "");
      const r = await conectarPublicacao(null, fd);
      if (r?.erro) return r;
    }
    const { error } = await admin.from("config_publicacao").upsert(
      {
        organizacao_id: orgId,
        account_id: conta.account_id,
        pixel_id: pixelId,
        pixel_nome: pixelNome,
        ...(campanhas ? { page_id: pageId, page_nome: pageNome, instagram_user_id: igId, instagram_nome: igNome, teto_verba_diaria: v.data.teto_verba_diaria ?? 100 } : {}),
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "organizacao_id" },
    );
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "onboarding.meta", p_detalhes: { conta: conta.account_id, pixel: pixelId } });
  } catch (e) {
    return { erro: mensagem(e) };
  }
  return irPara(dados.get("slug"), "pagina");
}

export async function salvarDestino(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const destino = dados.get("destino");
  if (destino !== "checkout" && destino !== "pagina") return { erro: "Escolha para onde o anúncio leva." };
  try {
    await acessoOrganizacao(orgId, "gestor");
    await atualizar(orgId, { destino });
    refresh();
    return null;
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function conferirPagina(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const v = validarUrlPagina(String(dados.get("url") ?? ""));
  if ("erro" in v) return { erro: v.erro };
  const url = v.url.toString();
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const [{ data: org }, { data: config }] = await Promise.all([
      supabase.from("organizacoes").select("onboarding").eq("id", orgId).single(),
      supabase.from("config_publicacao").select("pixel_id").eq("organizacao_id", orgId).maybeSingle(),
    ]);
    const em = new Date().toISOString();
    let resultado;
    try {
      const { status, html } = await abrirPagina(v.url);
      const scripts = status < 400 ? await lerScripts(html, url) : [];
      resultado = analisarPagina({
        url,
        status,
        html,
        scripts,
        em,
        pixelEsperado: config?.pixel_id ?? null,
        exigeScript: usaCheckoutExterno((org?.onboarding ?? {}) as Onboarding),
      });
    } catch (e) {
      resultado = {
        url,
        em,
        status: "erro" as const,
        itens: [{ tom: "erro" as const, titulo: "Não consegui abrir a página", detalhe: `Confira o endereço e se ela está publicada. Detalhe: ${mensagem(e)}` }],
      };
    }
    await atualizar(orgId, { pagina: resultado });
    refresh();
    return null;
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Teste de ponta a ponta antes de existir anúncio: IDs de teste no link e um código no e-mail. */
export async function iniciarTesteCadastro(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: org } = await supabase.from("organizacoes").select("onboarding").eq("id", orgId).single();
    const destino = (org?.onboarding as Onboarding | undefined)?.pagina?.url;
    if (!destino) return { erro: "Confira a página de destino primeiro: o teste abre o link dela." };
    const ids = { campanha: "999000000001", conjunto: "999000000002", anuncio: "999000000003" };
    const codigo = randomBytes(3).toString("hex");
    const url = montarUrlTeste(destino, PARAMETROS_META, {
      "campaign.id": ids.campanha,
      "adset.id": ids.conjunto,
      "ad.id": ids.anuncio,
      "campaign.name": "Teste do assistente",
      "adset.name": "Teste do assistente",
      "ad.name": "Teste do assistente",
    });
    const esperado = { utm_source: "meta", utm_campaign_id: ids.campanha, utm_adset_id: ids.conjunto, utm_ad_id: ids.anuncio, anuncio: "Teste do assistente" };
    const { error } = await criarClienteAdmin()
      .from("verificacoes_rastreio")
      .insert({ organizacao_id: orgId, account_id: "teste", campaign_id: ids.campanha, ad_id: ids.anuncio, codigo, url_teste: url, esperado, criado_por: usuario.id });
    if (error) return { erro: error.message };
    refresh();
    return null;
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function concluirOnboarding(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    await acessoOrganizacao(orgId, "gestor");
    await atualizar(orgId, { concluido_em: new Date().toISOString() });
  } catch (e) {
    return { erro: mensagem(e) };
  }
  return redirect(rotaOrg(String(dados.get("slug")), String(dados.get("destino") ?? "")));
}
