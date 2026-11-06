// Testes simples para separar mudança de ruído com as amostras pequenas de uma campanha (dezenas de
// leads por dia). Aproximação normal: suficiente para decidir entre "agir", "observar" e "aguardar".

/** z da diferença entre duas proporções (x1/n1 → x2/n2). 0 se faltar amostra. */
export function zProporcoes(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const ep = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return ep > 0 ? (x2 / n2 - x1 / n1) / ep : 0;
}

/** z da diferença entre duas taxas de contagem (c1 em t1 dias → c2 em t2 dias), Poisson. */
export function zTaxas(c1: number, t1: number, c2: number, t2: number): number {
  if (t1 <= 0 || t2 <= 0) return 0;
  const ep = Math.sqrt(c1 / (t1 * t1) + c2 / (t2 * t2));
  return ep > 0 ? (c2 / t2 - c1 / t1) / ep : 0;
}

/** Probabilidade de nenhum sucesso em n tentativas com taxa p: (1 − p)^n. */
export const probNenhum = (n: number, p: number) => (p <= 0 ? 1 : Math.pow(1 - Math.min(p, 1), n));

/** |z| ≥ 1,96: diferença improvável de ser só ruído (≈95%). */
export const significativo = (z: number) => Math.abs(z) >= 1.96;
