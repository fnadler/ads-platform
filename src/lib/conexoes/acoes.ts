"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { novoToken, sha256 } from "@/lib/cifra";
import { validarTokenMeta } from "@/lib/integracoes/meta";
import { validarChaveStripe } from "@/lib/integracoes/stripe";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { urlSistema } from "@/lib/url";
import { lerSegredo, salvarSegredo, type SegredoStripe } from "./segredos";

// Conexões da organização. Credenciais só passam por aqui: validadas na hora com uma chamada de leitura,
// cifradas e gravadas com a service role (o navegador nunca as recebe de volta).

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function gravarConexao(orgId: string, usuarioId: string, tipo: "meta" | "stripe" | "webhook", nome: string, campos: Record<string, unknown>) {
  const admin = criarClienteAdmin();
  const { data, error } = await admin
    .from("conexoes")
    .upsert(
      { organizacao_id: orgId, tipo, nome, criado_por: usuarioId, atualizado_em: new Date().toISOString(), ...campos },
      { onConflict: "organizacao_id,tipo,nome" },
    )
    .select("id, organizacao_id")
    .single();
  if (error || !data) throw new Error(`Não foi possível gravar a conexão: ${error?.message}`);
  return { admin, conexao: data };
}

// ───────────────────────────── Meta ─────────────────────────────

export async function conectarMeta(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const token = String(dados.get("token") ?? "").trim();
  if (token.length < 50) return { erro: "Cole o token completo do usuário do sistema (começa com EAA…)." };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const { usuario: usuarioMeta, contas } = await validarTokenMeta(token);
    if (!contas.length) return { erro: "O token é válido, mas não enxerga nenhuma conta de anúncio. Dê ao usuário do sistema acesso à conta no Business Manager." };

    const { admin, conexao } = await gravarConexao(orgId, usuario.id, "meta", "Meta", {
      status: "ativa",
      ultimo_erro: null,
      validado_em: new Date().toISOString(),
      config: { usuario_id: usuarioMeta.id, usuario_nome: usuarioMeta.nome },
    });
    await salvarSegredo(admin, conexao, { token });

    // Contas novas entram desligadas (a não ser que seja a única); as existentes só têm os dados atualizados.
    const { data: existentes } = await admin.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId);
    const conhecidas = new Set((existentes ?? []).map((c) => c.account_id));
    for (const c of contas) {
      const campos = { nome: c.nome, moeda: c.moeda, fuso: c.fuso, conexao_id: conexao.id };
      const { error } = conhecidas.has(c.account_id)
        ? await admin.from("contas_anuncio").update(campos).eq("organizacao_id", orgId).eq("account_id", c.account_id)
        : await admin.from("contas_anuncio").insert({ ...campos, organizacao_id: orgId, account_id: c.account_id, ativa: contas.length === 1 });
      if (error) throw new Error(error.message);
    }
    if (contas.length === 1 && !conhecidas.has(contas[0].account_id))
      await admin.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "meta", p_alvo: contas[0].account_id, p_modo: "carga" });

    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.meta", p_detalhes: { usuario_meta: usuarioMeta.nome, contas: contas.length } });
    refresh();
    return { mensagem: `Conectado como ${usuarioMeta.nome ?? usuarioMeta.id}. ${contas.length} conta(s) de anúncio encontrada(s).` };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

const Conta = z.object({
  organizacao_id: z.uuid(),
  account_id: z.string().regex(/^act_\d+$/),
  ativa: z.enum(["sim", "nao"]),
  sincronizar_desde: z.iso.date().optional(),
});

/** Liga/desliga a sincronização de uma conta; ao ligar, enfileira a carga do histórico. */
export async function alterarConta(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Conta.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: "Dados inválidos." };
  try {
    const { supabase } = await acessoOrganizacao(v.data.organizacao_id, "gestor");
    const ativa = v.data.ativa === "sim";
    const { error } = await supabase
      .from("contas_anuncio")
      .update({ ativa, ...(v.data.sincronizar_desde ? { sincronizar_desde: v.data.sincronizar_desde } : {}) })
      .eq("organizacao_id", v.data.organizacao_id)
      .eq("account_id", v.data.account_id);
    if (error) return { erro: error.message };
    if (ativa) {
      const { error: e2 } = await supabase.rpc("enfileirar_sincronizacao", { p_org: v.data.organizacao_id, p_tipo: "meta", p_alvo: v.data.account_id, p_modo: "carga" });
      if (e2) return { erro: e2.message };
    }
    refresh();
    return { mensagem: ativa ? "Conta ligada. A carga do histórico entrou na fila." : "Conta desligada." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Webhook genérico ─────────────────────────────

/** Gera um token novo para o webhook (o anterior deixa de valer) e mostra uma vez. */
export async function gerarTokenWebhook(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const token = novoToken("whk_");
    const { admin, conexao } = await gravarConexao(orgId, usuario.id, "webhook", "Webhook", {
      status: "ativa",
      validado_em: new Date().toISOString(),
      config: { prefixo: token.slice(0, 10) },
    });
    await admin.from("tokens_webhook").update({ revogado_em: new Date().toISOString() }).eq("conexao_id", conexao.id).is("revogado_em", null);
    const { error } = await admin.from("tokens_webhook").insert({ token_hash: sha256(token), organizacao_id: orgId, conexao_id: conexao.id });
    if (error) throw new Error(error.message);
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.webhook_token", p_detalhes: { prefixo: token.slice(0, 10) } });
    refresh();
    return {
      mensagem: `Token gerado. Endereço: ${await urlSistema()}/api/webhook/eventos — envie o token no cabeçalho "Authorization: Bearer <token>".`,
      segredo: token,
    };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Stripe ─────────────────────────────

const Stripe = z.object({
  organizacao_id: z.uuid(),
  chave: z.string().trim().optional(),
  segredo_webhook: z.string().trim().optional(),
  campo_lead: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{1,40}$/, "Campo de metadata inválido."),
});

/**
 * Chave restrita (leitura de faturas, assinaturas e clientes) + segredo de assinatura do endpoint de
 * webhook + o campo de metadata da assinatura que guarda o id do lead (no GN Coleciona: user_id).
 * Pode ser salvo em duas etapas: primeiro a chave (para ver o endereço do webhook), depois o segredo.
 */
export async function conectarStripe(_: Resultado, dados: FormData): Promise<Resultado> {
  const v = Stripe.safeParse(Object.fromEntries(dados));
  if (!v.success) return { erro: v.error.issues[0].message };
  const { organizacao_id: orgId, chave, segredo_webhook, campo_lead } = v.data;
  if (segredo_webhook && !segredo_webhook.startsWith("whsec_")) return { erro: "O segredo de assinatura do webhook começa com whsec_." };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const { data: atual } = await admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "stripe").eq("nome", "Stripe").maybeSingle();
    const anterior = atual ? await lerSegredo<SegredoStripe>(admin, orgId, atual.id) : null;
    const segredo: SegredoStripe = { chave: chave || anterior?.chave || "", segredo_webhook: segredo_webhook || anterior?.segredo_webhook };
    if (!segredo.chave) return { erro: "Cole a chave restrita do Stripe." };
    const { modo } = chave ? await validarChaveStripe(chave) : { modo: undefined };

    const completa = !!segredo.segredo_webhook;
    const { conexao } = await gravarConexao(orgId, usuario.id, "stripe", "Stripe", {
      status: completa ? "ativa" : "pendente",
      ultimo_erro: completa ? null : "Falta o segredo de assinatura do webhook (whsec_…).",
      validado_em: new Date().toISOString(),
      config: { campo_lead, ...(modo ? { modo } : {}) },
    });
    await salvarSegredo(admin, conexao, segredo);
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.stripe", p_detalhes: { campo_lead, completa } });
    refresh();
    return completa ? { mensagem: "Stripe conectado. Use “Importar histórico” para trazer as faturas já pagas." } : { mensagem: "Chave salva. Agora crie o webhook no Stripe e cole o segredo whsec_." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Enfileira a importação das faturas e assinaturas já existentes no Stripe. */
export async function importarHistoricoStripe(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: conexao } = await supabase.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "stripe").maybeSingle();
    if (!conexao) return { erro: "Conecte o Stripe primeiro." };
    const { error } = await supabase.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "stripe_historico", p_alvo: conexao.id, p_modo: "carga" });
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Importação na fila. Acompanhe em Sincronizações." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function removerConexao(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const id = String(dados.get("id"));
    const { error } = await supabase.from("conexoes").delete().eq("id", id).eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.removida", p_detalhes: { id } });
    refresh();
    return { mensagem: "Conexão removida." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Métricas ─────────────────────────────

const Metricas = z.object({
  organizacao_id: z.uuid(),
  acoes_lead: z.array(z.string().regex(/^[\w.:]+$/)).min(1, "Escolha ao menos uma ação para lead."),
  acoes_compra: z.array(z.string().regex(/^[\w.:]+$/)),
});

export async function salvarMetricas(_: Resultado, dados: FormData): Promise<Resultado> {
  const lista = (k: string) =>
    dados
      .getAll(k)
      .flatMap((v) => String(v).split(/[\s,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  const v = Metricas.safeParse({ organizacao_id: dados.get("organizacao_id"), acoes_lead: lista("acoes_lead"), acoes_compra: lista("acoes_compra") });
  if (!v.success) return { erro: v.error.issues[0].message };
  try {
    const { supabase } = await acessoOrganizacao(v.data.organizacao_id, "gestor");
    const { error } = await supabase
      .from("config_metricas")
      .update({ acoes_lead: [...new Set(v.data.acoes_lead)], acoes_compra: [...new Set(v.data.acoes_compra)], atualizado_em: new Date().toISOString() })
      .eq("organizacao_id", v.data.organizacao_id);
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Salvo. Rode “Sincronizar agora” com recarga do histórico para recalcular os números já gravados." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
