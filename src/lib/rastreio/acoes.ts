"use server";

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { conexaoComSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { sincronizarAnuncios } from "@/lib/meta/sincronizacao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { conferirLead, montarUrlTeste, statusDoResultado, type Esperado, type LeadRecebido } from "./regras";

// Ações da tela de Rastreio: reler os anúncios na Meta na hora (para ver uma correção sem esperar a
// sincronização), checar os links de destino e o teste de ponta a ponta.

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Relê na Meta os anúncios de todas as contas ativas (inclusive os que ainda não gastaram). */
export async function relerAnuncios(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  try {
    await acessoOrganizacao(orgId, "gestor");
    const admin = criarClienteAdmin();
    const credencial = await conexaoComSegredo<SegredoMeta>(admin, orgId, "meta");
    if (!credencial) return { erro: "Conecte a Meta primeiro (Configurações)." };
    const { data: contas } = await admin.from("contas_anuncio").select("account_id").eq("organizacao_id", orgId).eq("ativa", true);
    if (!contas?.length) return { erro: "Nenhuma conta de anúncio ligada (Configurações)." };
    const inicio = Date.now();
    let total = 0;
    for (const c of contas) total += (await sincronizarAnuncios(admin, credencial.segredo.token, orgId, c.account_id, () => Date.now() - inicio < 45_000)).anuncios;
    refresh();
    return { mensagem: `${total} anúncio(s) relido(s) na Meta.` };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export type SituacaoLink = { url: string; status: number | null; erro?: string };

/** Abre cada página de destino (GET, sem seguir para fora) e devolve o código HTTP. */
export async function verificarLinks(orgId: string): Promise<SituacaoLink[]> {
  const { supabase } = await acessoOrganizacao(orgId, "leitura");
  const { data } = await supabase.from("meta_anuncios").select("destinos").eq("organizacao_id", orgId).not("status", "in", "(ARCHIVED,DELETED,EXPIRED)");
  const urls = [...new Set((data ?? []).flatMap((a) => (a.destinos as string[]) ?? []))].slice(0, 30);
  return Promise.all(
    urls.map(async (url): Promise<SituacaoLink> => {
      try {
        const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (verificacao-rastreio)" } });
        return { url, status: r.status };
      } catch (e) {
        return { url, status: null, erro: mensagem(e) };
      }
    }),
  );
}

/**
 * Abre um teste de ponta a ponta: escolhe o anúncio (o informado ou o ativo de maior gasto com destino),
 * monta o link com os IDs reais e gera um código. A pessoa abre o link e se cadastra com o código no
 * e-mail (ex.: voce+rastreio-4f9a2c@gmail.com); o sistema procura o lead pelo código.
 */
export async function iniciarVerificacao(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const adEscolhido = String(dados.get("ad_id") ?? "");
  try {
    const { usuario, supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: anuncios } = await supabase
      .from("meta_anuncios")
      .select("account_id, ad_id, nome, campaign_id, campaign_name, adset_id, adset_name, status, url_tags, destinos")
      .eq("organizacao_id", orgId);
    const { data: gastos } = await supabase.from("meta_anuncio_dia").select("ad_id, gasto").eq("organizacao_id", orgId);
    const gasto = new Map<string, number>();
    for (const g of gastos ?? []) gasto.set(g.ad_id, (gasto.get(g.ad_id) ?? 0) + Number(g.gasto));
    const candidatos = (anuncios ?? [])
      .filter((a) => (a.destinos as string[])?.length && a.campaign_id && (!adEscolhido || a.ad_id === adEscolhido))
      .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || (gasto.get(b.ad_id) ?? 0) - (gasto.get(a.ad_id) ?? 0));
    const a = candidatos[0];
    if (!a) return { erro: "Nenhum anúncio com página de destino. Releia os anúncios na Meta e tente de novo." };

    const codigo = randomBytes(3).toString("hex");
    const url = montarUrlTeste((a.destinos as string[])[0], a.url_tags, {
      "campaign.id": a.campaign_id!,
      "adset.id": a.adset_id ?? "",
      "ad.id": a.ad_id,
      "campaign.name": a.campaign_name ?? "",
      "adset.name": a.adset_name ?? "",
      "ad.name": a.nome ?? "",
    });
    const u = new URL(url);
    const esperado: Esperado & { anuncio: string | null } = {
      utm_source: u.searchParams.get("utm_source") ?? undefined,
      utm_campaign_id: a.campaign_id!,
      utm_adset_id: a.adset_id ?? undefined,
      utm_ad_id: a.ad_id,
      anuncio: a.nome,
    };
    const { error } = await criarClienteAdmin()
      .from("verificacoes_rastreio")
      .insert({ organizacao_id: orgId, account_id: a.account_id, campaign_id: a.campaign_id, ad_id: a.ad_id, codigo, url_teste: url, esperado, criado_por: usuario.id });
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Teste criado. Siga os passos no cartão abaixo." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Procura o lead de teste pelo código e grava o resultado; sem lead ainda, continua aguardando. */
export async function verificarAgora(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const id = String(dados.get("id"));
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { data: v } = await supabase.from("verificacoes_rastreio").select("*").eq("id", id).eq("organizacao_id", orgId).maybeSingle();
    if (!v) return { erro: "Teste não encontrado." };
    const { data: lead } = await supabase
      .from("leads")
      .select("id, utm_source, utm_campaign_id, utm_adset_id, utm_ad_id, ftp_utm_ad_id, ad_id, atribuicao")
      .eq("organizacao_id", orgId)
      .eq("codigo_teste", v.codigo)
      .order("recebido_em", { ascending: false })
      .limit(1)
      .maybeSingle<LeadRecebido & { id: string }>();
    if (!lead) return { erro: `Nenhum lead com o código rastreio-${v.codigo} chegou ainda. Confira se o cadastro foi confirmado e se o e-mail tem o código.` };
    const resultado = conferirLead(lead, v.esperado as Esperado);
    const status = statusDoResultado(resultado);
    const { error } = await criarClienteAdmin()
      .from("verificacoes_rastreio")
      .update({ status, resultado, lead_id: lead.id, verificado_em: new Date().toISOString() })
      .eq("id", id)
      .eq("organizacao_id", orgId);
    if (error) return { erro: error.message };
    refresh();
    return status === "ok" ? { mensagem: "Ponta a ponta OK: o lead chegou com o anúncio certo." } : { erro: "O lead chegou, mas com problema. Veja os campos abaixo." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
