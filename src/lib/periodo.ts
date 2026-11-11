// Período único de Analisar (Resumo, Desempenho, Leads e vendas): vai no endereço (?dias=), e o menu e os
// links entre essas telas o levam junto. 7 dias é o padrão e não aparece no endereço.

export const PERIODOS = [7, 14, 30, 90] as const;
export const PERIODO_PADRAO = 7;

export function lerDias(valor: unknown): number {
  const n = Number(valor);
  return (PERIODOS as readonly number[]).includes(n) ? n : PERIODO_PADRAO;
}

/** Dia (AAAA-MM-DD) no fuso da organização, `offset` dias atrás. */
export const diaNoFuso = (offset: number, fuso: string, agora = Date.now()) => new Date(agora - offset * 86_400_000).toLocaleDateString("sv-SE", { timeZone: fuso });

/** O período escolhido (terminando hoje) e o anterior, do mesmo tamanho, para comparar. */
export function intervalo(dias: number, fuso: string, agora = Date.now()) {
  return {
    de: diaNoFuso(dias - 1, fuso, agora),
    ate: diaNoFuso(0, fuso, agora),
    deAnterior: diaNoFuso(2 * dias - 1, fuso, agora),
    ateAnterior: diaNoFuso(dias, fuso, agora),
  };
}

/** Acrescenta ?dias= a um endereço (respeitando a busca que ele já tiver). */
export function comDias(href: string, dias: number | null | undefined) {
  if (!dias || dias === PERIODO_PADRAO) return href;
  const [caminho, busca = ""] = href.split("?");
  const q = new URLSearchParams(busca);
  q.set("dias", String(dias));
  return `${caminho}?${q}`;
}
