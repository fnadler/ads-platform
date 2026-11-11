"use server";

import { refresh } from "next/cache";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { ClienteMetaEscrita } from "@/lib/integracoes/metaEscrita";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { statusDepoisDe, veiculacaoPelosAnuncios } from "./veiculacao";

// Pausar e reativar a campanha inteira, inclusive as criadas direto no Gerenciador. Só gestor, só em campanha
// que a leitura da conta desta organização trouxe, sempre com confirmação na tela, com registro em
// operacoes_meta (o que foi enviado) e na auditoria (quem fez). Mexe só no status da campanha: conjuntos e
// anúncios ficam como estão, então reativar volta exatamente ao que estava no ar antes da pausa.

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function contexto(dados: FormData) {
  const orgId = String(dados.get("organizacao_id"));
  const metaCampaignId = String(dados.get("campanha"));
  if (!/^\d+$/.test(metaCampaignId)) throw new Error("Campanha inválida.");
  const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
  const admin = criarClienteAdmin();
  const [{ data: anuncios }, { data: montada }, { data: conexao }] = await Promise.all([
    admin.from("meta_anuncios").select("ad_id, account_id, status").eq("organizacao_id", orgId).eq("campaign_id", metaCampaignId),
    admin.from("campanhas_assistente").select("id, status").eq("organizacao_id", orgId).eq("meta_campaign_id", metaCampaignId).maybeSingle(),
    admin.from("conexoes").select("id, status").eq("organizacao_id", orgId).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  if (!anuncios?.length) throw new Error("Esta campanha não aparece na leitura da conta de anúncios desta organização.");
  if (!conexao || conexao.status !== "ativa") throw new Error("Falta a conexão de publicação na Meta, com permissão de edição (Configurações → Meta (publicação)).");
  const segredo = await lerSegredo<SegredoMeta>(admin, orgId, conexao.id);
  if (!segredo) throw new Error("Falta a conexão de publicação na Meta, com permissão de edição (Configurações → Meta (publicação)).");
  const meta = new ClienteMetaEscrita({ token: segredo.token, admin, organizacaoId: orgId, campanhaId: montada?.id ?? null, metaCampaignId, usuarioId: usuario.id });
  return { orgId, metaCampaignId, supabase, admin, meta, anuncios, montada };
}

type Contexto = Awaited<ReturnType<typeof contexto>>;

/**
 * Atualiza a leitura local na hora (a tela não fica mostrando o estado antigo) e agenda uma releitura da conta
 * para daqui a 2 minutos, quando a Meta já recalculou a veiculação de cada anúncio.
 */
async function refletir(ctx: Contexto, acao: "pausar" | "reativar") {
  for (const a of ctx.anuncios) {
    const novo = statusDepoisDe(acao, a.status);
    if (novo !== a.status) await ctx.admin.from("meta_anuncios").update({ status: novo }).eq("organizacao_id", ctx.orgId).eq("ad_id", a.ad_id);
  }
  await ctx.admin.rpc("enfileirar_sincronizacao", { p_org: ctx.orgId, p_tipo: "meta", p_alvo: ctx.anuncios[0].account_id, p_modo: "manual", p_atraso: 120 });
}

export async function pausarCampanha(_: Resultado, dados: FormData): Promise<Resultado> {
  try {
    const ctx = await contexto(dados);
    if (veiculacaoPelosAnuncios(ctx.anuncios.map((a) => a.status)) !== "ligada") return { erro: "Esta campanha não está no ar: não há o que pausar." };
    await ctx.meta.pausar(ctx.metaCampaignId);
    await refletir(ctx, "pausar");
    await ctx.supabase.rpc("registrar_auditoria", { p_org: ctx.orgId, p_acao: "campanha.pausada", p_detalhes: { meta_campaign_id: ctx.metaCampaignId, campanha: ctx.montada?.id ?? null } });
    refresh();
    return { mensagem: "Campanha pausada. Ela para de gastar em alguns minutos; conjuntos e anúncios ficam como estavam." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function reativarCampanha(_: Resultado, dados: FormData): Promise<Resultado> {
  if (dados.get("confirmacao") !== "ATIVAR") return { erro: "Digite ATIVAR para confirmar." };
  try {
    const ctx = await contexto(dados);
    // Campanha montada aqui e nunca ativada: a primeira ativação liga anúncios e conjuntos também (outro fluxo).
    if (ctx.montada?.status === "criada") return { erro: "Esta campanha ainda não foi ativada pela primeira vez. Use “Ativar campanha” na montagem." };
    if (veiculacaoPelosAnuncios(ctx.anuncios.map((a) => a.status)) !== "pausada") return { erro: "Esta campanha não está pausada." };
    await ctx.meta.ativar(ctx.metaCampaignId);
    await refletir(ctx, "reativar");
    await ctx.supabase.rpc("registrar_auditoria", { p_org: ctx.orgId, p_acao: "campanha.reativada", p_detalhes: { meta_campaign_id: ctx.metaCampaignId, campanha: ctx.montada?.id ?? null } });
    refresh();
    return { mensagem: "Campanha reativada. Ela volta a veicular em alguns minutos, com os conjuntos e anúncios que estavam no ar antes da pausa." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
