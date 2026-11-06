"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { novoToken, sha256 } from "@/lib/cifra";
import { gravarColetaClarity, type SegredoClarity } from "@/lib/clarity/coleta";
import { buscarInsightsClarity, normalizarProjetoClarity } from "@/lib/integracoes/clarity";
import { normalizarContaMeta, validarTokenMeta } from "@/lib/integracoes/meta";
import { validarChaveStripe } from "@/lib/integracoes/stripe";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { urlSistema } from "@/lib/url";
import { ehPlataforma, FUNIS, PLATAFORMAS_VENDA, type TipoPlataforma } from "@/lib/vendas/plataformas/catalogo";
import { lerSegredo, salvarSegredo, type SegredoStripe } from "./segredos";

// Conexões da organização. Credenciais só passam por aqui: validadas na hora com uma chamada de leitura,
// cifradas e gravadas com a service role (o navegador nunca as recebe de volta).

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function gravarConexao(orgId: string, usuarioId: string, tipo: "meta" | "stripe" | "webhook" | "clarity" | TipoPlataforma, nome: string, campos: Record<string, unknown>) {
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
    const textoContas = String(dados.get("contas") ?? "").trim();
    const informadas = textoContas ? textoContas.split(/[\s,;]+/).filter(Boolean).map(normalizarContaMeta) : [];
    if (informadas.some((c) => !c)) return { erro: "ID de conta inválido. Use o número da conta (ex.: act_1234567890 ou 1234567890)." };
    const { usuario: usuarioMeta, contas, permissoes } = await validarTokenMeta(token, informadas as string[]);
    if (!contas.length) {
      const semAdsRead = !permissoes.includes("ads_read");
      return {
        erro: semAdsRead
          ? `O token é válido, mas não tem a permissão ads_read (tem: ${permissoes.join(", ") || "nenhuma"}). Gere um token novo marcando ads_read.`
          : "O token é válido e tem ads_read, mas a Meta não lista nenhuma conta para ele. Confira em Atribuir ativos → Contas de anúncios se a conta foi atribuída a este usuário do sistema, ou informe o ID da conta abaixo.",
      };
    }

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

// ───────────────────────────── Microsoft Clarity ─────────────────────────────

/**
 * ID do projeto + token da Data Export API. Token novo é validado com uma consulta (uma das 10 do dia),
 * e a resposta já fica guardada como a primeira coleta. Sem token novo, só troca o ID do projeto.
 */
export async function conectarClarity(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const projeto = normalizarProjetoClarity(String(dados.get("projeto") ?? ""));
  const token = String(dados.get("token") ?? "").trim();
  if (!projeto) return { erro: "Informe o ID do projeto do Clarity (o código de 10 caracteres no fim do script, ex.: z9fvwq0b1n)." };
  if (token && token.length < 20) return { erro: "Cole o token completo gerado em Settings → Data Export." };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const { data: atual } = await admin.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "clarity").eq("nome", "Clarity").maybeSingle();
    const anterior = atual ? await lerSegredo<SegredoClarity>(admin, orgId, atual.id) : null;
    if (!token && !anterior?.token) return { erro: "Cole o token do Clarity." };

    const resposta = token ? await buscarInsightsClarity(token, 1) : null;
    const { conexao } = await gravarConexao(orgId, usuario.id, "clarity", "Clarity", {
      status: "ativa",
      ultimo_erro: null,
      ...(token ? { validado_em: new Date().toISOString() } : {}),
      config: { projeto_id: projeto },
    });
    if (token) await salvarSegredo(admin, conexao, { token } satisfies SegredoClarity);
    if (resposta) await gravarColetaClarity(admin, { organizacao_id: orgId, conexao_id: conexao.id, projeto_id: projeto, dia: null, dimensoes: [] }, resposta);
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.clarity", p_detalhes: { projeto_id: projeto, token_novo: !!token } });
    refresh();
    return {
      mensagem: token
        ? "Clarity conectado. A coleta automática roda toda madrugada e guarda o dia anterior."
        : "ID do projeto atualizado.",
    };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Coleta avulsa das últimas 24 h (3 consultas das 10 do dia). Não fecha um dia: a diária continua. */
export async function coletarClarityAgora(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: conexao } = await supabase.from("conexoes").select("id").eq("organizacao_id", orgId).eq("tipo", "clarity").maybeSingle();
    if (!conexao) return { erro: "Conecte o Clarity primeiro." };
    const { error } = await supabase.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "clarity", p_alvo: conexao.id, p_modo: "manual" });
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Coleta na fila. Acompanhe em Sincronizações." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

// ───────────────────────────── Plataformas de venda ─────────────────────────────

/**
 * Sem token, só cria a conexão para mostrar o endereço (a Hotmart e a Kiwify pedem o endereço ao criar o
 * webhook). Ela nasce em modo de teste, porque os botões de teste das plataformas mandam compras fictícias.
 */
export async function conectarPlataforma(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const tipo = String(dados.get("tipo"));
  const segredo = String(dados.get("segredo") ?? "").trim();
  if (!ehPlataforma(tipo)) return { erro: "Plataforma desconhecida." };
  if (dados.has("segredo") && segredo.length < 8) return { erro: `Cole o ${PLATAFORMAS_VENDA[tipo].campoSegredo} completo.` };
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const nome = PLATAFORMAS_VENDA[tipo].rotulo;
    const { data: atual } = await admin.from("conexoes").select("id, status, config").eq("organizacao_id", orgId).eq("tipo", tipo).eq("nome", nome).maybeSingle();
    const { conexao } = await gravarConexao(orgId, usuario.id, tipo, nome, {
      status: segredo || atual?.status === "ativa" ? "ativa" : "pendente",
      ultimo_erro: null,
      ...(segredo ? { validado_em: new Date().toISOString() } : {}),
      config: atual?.config ?? { modo_teste: true },
    });
    if (segredo) await salvarSegredo(admin, conexao, { segredo });
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: `conexao.${tipo}`, p_detalhes: { com_token: !!segredo } });
    refresh();
    return { mensagem: segredo ? "Token salvo. Envie um evento de teste e confira abaixo." : "Conexão criada. Siga os passos para configurar." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function alterarModoPlataforma(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  const modoTeste = dados.get("modo_teste") === "sim";
  try {
    const { supabase } = await acessoOrganizacao(orgId, "dono");
    const admin = criarClienteAdmin();
    const { data: atual } = await admin.from("conexoes").select("tipo, config").eq("id", id).eq("organizacao_id", orgId).maybeSingle();
    if (!atual || !ehPlataforma(atual.tipo)) return { erro: "Conexão não encontrada." };
    const { error } = await admin.from("conexoes").update({ config: { ...(atual.config as object), modo_teste: modoTeste }, atualizado_em: new Date().toISOString() }).eq("id", id);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "conexao.modo_teste", p_detalhes: { id, modo_teste: modoTeste } });
    refresh();
    return { mensagem: modoTeste ? "Modo de teste ligado: as próximas vendas não entram nos números." : "Pronto: as próximas vendas entram nos números." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Tipo de funil da organização: decide o que o Desempenho e o Início mostram. */
export async function salvarFunil(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const funil = String(dados.get("funil"));
  if (!(funil in FUNIS)) return { erro: "Escolha um funil." };
  const diasTeste = dados.has("dias_teste") ? Number(dados.get("dias_teste")) : null;
  if (diasTeste !== null && !(Number.isInteger(diasTeste) && diasTeste >= 1 && diasTeste <= 90)) return { erro: "Informe a duração do teste grátis em dias (1 a 90)." };
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { error } = await criarClienteAdmin()
      .from("organizacoes")
      .update({ funil, ...(diasTeste !== null ? { dias_teste: diasTeste } : {}) })
      .eq("id", orgId);
    if (error) return { erro: error.message };
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "organizacao.funil", p_detalhes: { funil, dias_teste: diasTeste } });
    refresh();
    return { mensagem: "Funil salvo." };
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
