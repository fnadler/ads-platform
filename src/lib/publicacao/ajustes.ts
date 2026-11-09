// Ajustes numa campanha que a plataforma criou, a partir das sugestões da leitura — funções puras: a verba
// sugerida para um teste, o nome e o payload do conjunto de teste e as checagens de orçamento. As chamadas
// à Meta ficam em acoesCampanha.ts.

import { menorUnidade } from "./modelo";

/** Exibições por anúncio que um teste precisa para dizer se o anúncio funciona (cliques e cadastros na casa das dezenas). */
export const EXIBICOES_POR_ANUNCIO = 3000;

/**
 * Verba sugerida para testar `n` anúncios: o custo de exibir cada um EXIBICOES_POR_ANUNCIO vezes ao custo
 * por mil atual, arredondado para cima de 5 em 5. No orçamento diário, isso se espalha por 7 dias.
 */
export function verbaSugeridaTeste(n: number, custoPorMil: number | null, tipo: "total" | "diario") {
  const cpm = custoPorMil && Number.isFinite(custoPorMil) && custoPorMil > 0 ? custoPorMil : 20;
  const total = (Math.max(n, 1) * EXIBICOES_POR_ANUNCIO * cpm) / 1000;
  const valor = tipo === "total" ? total : total / 7;
  return Math.max(Math.ceil(valor / 5) * 5, tipo === "total" ? 30 : 10);
}

export const nomeConjuntoTeste = (campanha: string, anuncios: string[]) => {
  const curtos = anuncios.map((a) => a.replace(/^.*\|\s*/, "").trim() || a);
  return `${campanha} | Teste | ${curtos.join(" + ")}`.slice(0, 250);
};

/** Campos do conjunto original que o teste copia (mesmo público, otimização e atribuição). */
export interface ConjuntoOriginal {
  targeting?: unknown;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  destination_type?: string;
  promoted_object?: unknown;
  attribution_spec?: unknown;
  end_time?: string;
  lifetime_budget?: string;
  daily_budget?: string;
}
export const CAMPOS_CONJUNTO = "targeting,optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,attribution_spec,end_time,lifetime_budget,daily_budget";

/** A Meta devolve "0" no tipo de orçamento que o objeto não usa: só conta valor positivo. */
export const temOrcamento = (v: unknown) => Number(v) > 0;

/** Fim do teste: o fim do conjunto original (orçamento total) ou 7 dias a partir de agora (diário). */
export function fimDoTeste(original: ConjuntoOriginal, agora: Date) {
  if (temOrcamento(original.lifetime_budget) && original.end_time) return new Date(original.end_time);
  return new Date(agora.getTime() + 7 * 86_400_000);
}

export function payloadConjuntoTeste(nome: string, campaignId: string, original: ConjuntoOriginal, verba: number, moeda: string, agora: Date) {
  const total = temOrcamento(original.lifetime_budget);
  return {
    name: nome,
    campaign_id: campaignId,
    status: "PAUSED",
    ...(total ? { lifetime_budget: menorUnidade(verba, moeda) } : { daily_budget: menorUnidade(verba, moeda) }),
    billing_event: original.billing_event ?? "IMPRESSIONS",
    optimization_goal: original.optimization_goal ?? "OFFSITE_CONVERSIONS",
    bid_strategy: original.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
    destination_type: original.destination_type ?? "WEBSITE",
    promoted_object: original.promoted_object,
    attribution_spec: original.attribution_spec,
    targeting: original.targeting,
    start_time: agora.toISOString(),
    end_time: fimDoTeste(original, agora).toISOString(),
  };
}

/** Verba por dia equivalente (para comparar com o teto diário da organização). */
export function verbaPorDia(verba: number, tipo: "total" | "diario", fim: Date, agora: Date) {
  if (tipo === "diario") return verba;
  const dias = Math.max((fim.getTime() - agora.getTime()) / 86_400_000, 1);
  return verba / dias;
}

export interface ChecagemOrcamento {
  ok: boolean;
  erro?: string;
}

/**
 * Tirar `valor` do orçamento total do conjunto original: o que sobra precisa cobrir o que já foi gasto, com
 * folga de 10% (a Meta recusa um orçamento total abaixo do gasto).
 */
export function podeTirarDoTotal(orcamentoTotal: number, gasto: number, valor: number): ChecagemOrcamento {
  const novo = orcamentoTotal - valor;
  if (novo <= 0) return { ok: false, erro: "O valor do teste é maior que o orçamento da campanha." };
  if (novo < gasto * 1.1) return { ok: false, erro: "O orçamento que sobra não cobre o que a campanha já gastou. Diminua o valor do teste ou some ao orçamento." };
  return { ok: true };
}
