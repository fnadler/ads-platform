import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { somar, zero, type Linha } from "@/app/o/[org]/desempenho/soma";
import { veiculacaoPelosAnuncios } from "@/lib/campanhas/veiculacao";
import { carregarMensalidade } from "@/lib/payback";
import type { Leitura } from "@/lib/leitura/modelo";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";
import { montarBalanco, type Balanco } from "./modelo";

// Junta os números da campanha inteira (do primeiro dia com gasto até hoje) para o balanço: totais e
// resultado por anúncio, testes resolvidos e em aberto, a situação na Meta e a leitura (achados e marcos).

interface Org {
  id: string;
  fuso: string;
  moeda: string;
  funil: Funil;
  dias_teste?: number | null;
}

const diaNoFuso = (iso: string, fuso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: fuso });

export async function carregarBalanco(supabase: SupabaseClient, org: Org, campanhaId: string, leitura: Leitura): Promise<Balanco> {
  const hoje = diaNoFuso(new Date().toISOString(), org.fuso);
  const [{ data: diasGasto }, { data: anuncios }, { data: leads }, mensalidade] = await Promise.all([
    supabase.from("meta_campanha_dia").select("dia").eq("organizacao_id", org.id).eq("campaign_id", campanhaId).gt("gasto", 0).order("dia"),
    supabase.from("meta_anuncios").select("status").eq("organizacao_id", org.id).eq("campaign_id", campanhaId),
    supabase
      .from("leads")
      .select("teste_iniciado_em, teste_cancelado_em, primeiro_pagamento_em")
      .eq("organizacao_id", org.id)
      .eq("campaign_id", campanhaId)
      .is("codigo_teste", null)
      .not("teste_iniciado_em", "is", null),
    org.funil === "cadastro_teste_venda" ? carregarMensalidade(supabase, org.id) : null,
  ]);
  const de = diasGasto?.[0]?.dia ?? null;
  const ate = diasGasto?.at(-1)?.dia ?? null;
  const { data: linhas } = de
    ? await supabase.rpc("desempenho_anuncios", { p_org: org.id, p_de: de, p_ate: hoje })
    : { data: [] as Linha[] };
  const daCampanha = ((linhas as Linha[]) ?? []).filter((l) => l.campaign_id === campanhaId);
  const total = zero();
  for (const l of daCampanha) somar(total, l);

  // Testes: resolvido = pagou, cancelou ou o teste já acabou; em aberto = ainda dentro dos dias de teste.
  const diasTeste = org.dias_teste ?? 7;
  const fim = (inicio: string) => diaNoFuso(new Date(Date.parse(inicio) + diasTeste * 86_400_000).toISOString(), org.fuso);
  let testesResolvidos = 0;
  let testesPagos = 0;
  const testesEmAberto: string[] = [];
  for (const l of leads ?? []) {
    const termina = fim(l.teste_iniciado_em as string);
    if (l.primeiro_pagamento_em) {
      testesResolvidos++;
      testesPagos++;
    } else if (l.teste_cancelado_em || termina < hoje) testesResolvidos++;
    else testesEmAberto.push(termina);
  }

  const veiculacao = veiculacaoPelosAnuncios((anuncios ?? []).map((a) => a.status as string | null));
  return montarBalanco({
    funil: org.funil,
    moeda: org.moeda,
    hoje,
    de,
    ate,
    situacao: veiculacao === "ligada" ? "no_ar" : veiculacao === "encerrada" ? "encerrada" : "pausada",
    total: {
      gasto: total.gasto,
      impressoes: total.impressoes,
      cliques: total.cliques_link,
      visitas: total.visualizacoes_pagina,
      leadsMeta: total.leads_meta,
      comprasMeta: total.compras_meta,
      leads: total.leads,
      testes: total.testes,
      vendas: total.vendas,
      receita: total.receita,
    },
    anuncios: daCampanha.map((l) => ({
      adId: l.ad_id,
      nome: l.ad_name ?? l.ad_id,
      gasto: Number(l.gasto),
      leadsMeta: Number(l.leads_meta),
      leads: Number(l.leads),
      testes: Number(l.testes),
      vendas: Number(l.vendas),
    })),
    testesResolvidos,
    testesPagos,
    testesEmAberto,
    achados: leitura.achados,
    marcos: leitura.marcos,
    mensalidade,
  });
}
