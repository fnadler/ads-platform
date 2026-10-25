/** Destino interno seguro para ?next= (evita redirecionar para outro domínio). */
export function destinoSeguro(next: string | null | undefined, padrao = "/") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : padrao;
}

export const rotaOrg = (slug: string, resto = "") => `/o/${slug}${resto}`;
