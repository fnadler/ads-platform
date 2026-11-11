import { somar, zero, type Linha, type Soma } from "@/app/o/[org]/desempenho/soma";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";

// Resumo gerencial: o período somado, comparado ao anterior do mesmo tamanho, e qual campanha vai melhor e qual
// pede atenção. Tudo sobre o que veio dos anúncios (cadastros e vendas que chegaram com o anúncio de origem).

export interface CampanhaResumo {
  id: string;
  nome: string;
  soma: Soma;
}

export function somarPeriodo(linhas: Linha[]) {
  const total = zero();
  const porCampanha = new Map<string, CampanhaResumo>();
  for (const l of linhas) {
    somar(total, l);
    if (!l.campaign_id) continue;
    const c = porCampanha.get(l.campaign_id) ?? { id: l.campaign_id, nome: l.campaign_name ?? l.campaign_id, soma: zero() };
    somar(c.soma, l);
    porCampanha.set(l.campaign_id, c);
  }
  return { total, campanhas: [...porCampanha.values()].filter((c) => c.soma.gasto > 0) };
}

export const retorno = (s: Soma) => (s.gasto ? s.receita / s.gasto : null);
export const custoPorVenda = (s: Soma) => (s.vendas ? s.gasto / s.vendas : null);
export const custoPorCadastro = (s: Soma) => (s.leads ? s.gasto / s.leads : null);

/** Variação relativa (0,12 = +12%). null quando não há base para comparar. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return (atual - anterior) / Math.abs(anterior);
}

/** Pelo que a campanha é julgada: retorno, quando já há venda; senão custo por cadastro (fora da venda direta). */
export type Criterio = "retorno" | "cadastro";

export interface Comparacao {
  criterio: Criterio;
  melhor: CampanhaResumo;
  pior: CampanhaResumo | null;
}

/**
 * Melhor e pior campanha do período. Só entram as que gastaram ao menos 10% do total (uma campanha que gastou
 * R$ 5 não é "a melhor" por acaso). Com uma campanha só, não há pior.
 */
export function melhorEPior(campanhas: CampanhaResumo[], funil: Funil): Comparacao | null {
  const gastoTotal = campanhas.reduce((t, c) => t + c.soma.gasto, 0);
  const relevantes = campanhas.filter((c) => c.soma.gasto >= gastoTotal * 0.1);
  if (!relevantes.length) return null;
  const comVenda = relevantes.some((c) => c.soma.vendas > 0);
  const criterio: Criterio | null = comVenda ? "retorno" : funil !== "venda_direta" && relevantes.some((c) => c.soma.leads > 0) ? "cadastro" : null;
  if (!criterio) return null;
  // Nota maior = melhor. Sem cadastro, o custo por cadastro é infinito: vai para o fim.
  const nota = (c: CampanhaResumo) => (criterio === "retorno" ? (retorno(c.soma) ?? 0) : -(custoPorCadastro(c.soma) ?? Number.POSITIVE_INFINITY));
  const ordem = [...relevantes].sort((a, b) => nota(b) - nota(a) || b.soma.gasto - a.soma.gasto);
  const pior = ordem.length > 1 ? ordem[ordem.length - 1] : null;
  return { criterio, melhor: ordem[0], pior: pior && nota(pior) < nota(ordem[0]) ? pior : null };
}
