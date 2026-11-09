"use server";

import { acessoOrganizacao } from "@/lib/auth/sessao";
import { inteiro, pct } from "@/lib/formato";
import { usaCheckoutExterno, type Onboarding } from "@/lib/onboarding/modelo";
import { analisarPagina, validarUrlPagina } from "@/lib/onboarding/pagina";
import { abrirPagina, lerScripts } from "@/lib/onboarding/rede";
import { avaliarDestino, avaliarParametros, montarUrlTeste } from "@/lib/rastreio/regras";

// Conferências que os atalhos das sugestões rodam na hora, só com leitura: abrir a página de destino como
// o anúncio abre (com os parâmetros) e conferir o rastreio dos anúncios da campanha. Não mudam nada.

export interface ItemConferencia {
  tom: "ok" | "alerta" | "erro";
  titulo: string;
  detalhe?: string;
}
export type ResultadoConferencia = { itens: ItemConferencia[]; url?: string } | { erro: string };

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const segundos = (ms: number) => `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;

interface AnuncioMeta {
  ad_id: string;
  nome: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  status: string | null;
  url_tags: string | null;
  destinos: string[] | null;
}

async function anunciosDaCampanha(orgId: string, campanhaId: string) {
  const { supabase } = await acessoOrganizacao(orgId, "leitura");
  const { data } = await supabase
    .from("meta_anuncios")
    .select("ad_id, nome, campaign_id, campaign_name, adset_id, adset_name, status, url_tags, destinos")
    .eq("organizacao_id", orgId)
    .eq("campaign_id", campanhaId)
    .not("status", "in", "(ARCHIVED,DELETED)");
  const anuncios = ((data ?? []) as AnuncioMeta[]).sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"));
  return { supabase, anuncios };
}

/** Abre a página do anúncio com os parâmetros reais, mede quanto demora e confere o pixel. */
export async function testarPagina(orgId: string, campanhaId: string): Promise<ResultadoConferencia> {
  try {
    const { supabase, anuncios } = await anunciosDaCampanha(orgId, campanhaId);
    const a = anuncios.find((x) => x.destinos?.length);
    if (!a) return { erro: "Não encontrei a página de destino dos anúncios desta campanha. Releia os anúncios em Rastreio e tente de novo." };
    const link = montarUrlTeste(a.destinos![0], a.url_tags, {
      "campaign.id": a.campaign_id ?? "",
      "adset.id": a.adset_id ?? "",
      "ad.id": a.ad_id,
      "campaign.name": a.campaign_name ?? "",
      "adset.name": a.adset_name ?? "",
      "ad.name": a.nome ?? "",
    });
    const v = validarUrlPagina(link);
    if ("erro" in v) return { erro: v.erro };
    const [{ data: config }, { data: org }] = await Promise.all([
      supabase.from("config_publicacao").select("pixel_id").eq("organizacao_id", orgId).maybeSingle(),
      supabase.from("organizacoes").select("onboarding").eq("id", orgId).single(),
    ]);

    const inicio = performance.now();
    let aberta;
    try {
      aberta = await abrirPagina(v.url);
    } catch (e) {
      return { url: link, itens: [{ tom: "erro", titulo: "A página não abriu", detalhe: `Quem clica no anúncio não chega a ver nada. Detalhe: ${mensagem(e)}` }] };
    }
    const tempo = performance.now() - inicio;
    const scripts = aberta.status < 400 ? await lerScripts(aberta.html, link) : [];
    const analise = analisarPagina({
      url: a.destinos![0],
      status: aberta.status,
      html: aberta.html,
      scripts,
      em: new Date().toISOString(),
      pixelEsperado: config?.pixel_id ?? null,
      exigeScript: usaCheckoutExterno((org?.onboarding ?? {}) as Onboarding),
    });
    const itens: ItemConferencia[] = analise.itens.map((i) => ({ tom: i.tom, titulo: i.titulo, detalhe: i.detalhe }));
    if (aberta.status < 400)
      itens.splice(1, 0, {
        tom: tempo < 1500 ? "ok" : tempo < 3500 ? "alerta" : "erro",
        titulo: tempo < 1500 ? `Respondeu rápido: ${segundos(tempo)}` : `Demorou ${segundos(tempo)} para responder`,
        detalhe:
          "Medido do nosso servidor, só o primeiro carregamento. No celular, com internet móvel, costuma ser mais lento" +
          (tempo < 1500 ? "." : ": cada segundo a mais faz parte das pessoas desistir antes de a página aparecer."),
      });
    return { url: link, itens };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

/** Confere os "Parâmetros de URL" e o destino de cada anúncio, e quantos cadastros recentes chegaram com a origem. */
export async function conferirRastreio(orgId: string, campanhaId: string): Promise<ResultadoConferencia> {
  try {
    const { supabase, anuncios } = await anunciosDaCampanha(orgId, campanhaId);
    if (!anuncios.length) return { erro: "Não encontrei os anúncios desta campanha. Releia os anúncios em Rastreio e tente de novo." };
    const { data: org } = await supabase.from("organizacoes").select("onboarding").eq("id", orgId).single();
    const checkout = usaCheckoutExterno((org?.onboarding ?? {}) as Onboarding);
    const itens: ItemConferencia[] = [];

    const comProblema = anuncios.map((a) => ({ a, p: avaliarParametros(a.url_tags, { checkout }), d: avaliarDestino(a.destinos ?? []) })).filter((x) => x.p.status !== "ok" || x.d);
    if (!comProblema.length)
      itens.push({
        tom: "ok",
        titulo: `${anuncios.length === 1 ? "O anúncio manda" : `Os ${anuncios.length} anúncios mandam`} a origem no link`,
        detalhe: "Os “Parâmetros de URL” levam os IDs da campanha, do conjunto e do anúncio.",
      });
    for (const { a, p, d } of comProblema)
      itens.push({
        tom: p.status === "erro" ? "erro" : "alerta",
        titulo: `“${a.nome ?? a.ad_id}”`,
        detalhe: [...p.problemas.map((x) => x.texto), ...(d ? [d.texto] : [])].join(" "),
      });

    // Cadastros dos últimos 3 dias: quantos chegaram com o anúncio, contra os que a Meta conta.
    const desde = new Date(Date.now() - 3 * 86_400_000);
    const [{ data: leads }, { data: midia }, { data: ultimo }] = await Promise.all([
      supabase.from("leads").select("id").eq("organizacao_id", orgId).eq("campaign_id", campanhaId).is("codigo_teste", null).gte("criado_em", desde.toISOString()),
      supabase.from("meta_campanha_dia").select("leads").eq("organizacao_id", orgId).eq("campaign_id", campanhaId).gte("dia", desde.toISOString().slice(0, 10)),
      supabase.from("leads").select("recebido_em").eq("organizacao_id", orgId).eq("campaign_id", campanhaId).order("recebido_em", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const chegaram = leads?.length ?? 0;
    const daMeta = (midia ?? []).reduce((s, m) => s + Number(m.leads), 0);
    if (daMeta >= 5) {
      const taxa = chegaram / daMeta;
      itens.push({
        tom: taxa >= 0.6 ? "ok" : taxa >= 0.35 ? "alerta" : "erro",
        titulo: `${pct(Math.min(taxa, 1), 0)} dos cadastros chegaram com o anúncio`,
        detalhe: `Nos últimos 3 dias, a Meta contou ${inteiro(daMeta)} cadastros e ${inteiro(chegaram)} chegaram ao seu sistema com a origem. Parte da diferença é normal (bloqueadores e quem troca de aparelho); abaixo de 60%, vale fazer o teste completo em Rastreio.`,
      });
    }
    if (ultimo?.recebido_em) {
      const horas = (Date.now() - Date.parse(ultimo.recebido_em)) / 3_600_000;
      if (horas > 24 && daMeta > 0)
        itens.push({
          tom: "erro",
          titulo: `Nenhum cadastro chega há ${Math.round(horas)} horas`,
          detalhe: "A Meta continua contando cadastros, mas o seu sistema parou de recebê-los. Confira a integração da fonte de venda em Configurações.",
        });
    }
    return { itens };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
