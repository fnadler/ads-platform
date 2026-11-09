// Linha da RPC desempenho_anuncios (um anúncio no período) e a soma de várias delas.

export interface Linha {
  account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  status: string | null;
  imagem_path: string | null;
  gasto: number;
  impressoes: number;
  frequencia: number;
  cliques_link: number;
  visualizacoes_pagina: number;
  leads_meta: number;
  compras_meta: number;
  leads: number;
  testes: number;
  testes_cancelados: number;
  vendas: number;
  receita: number;
  vendas_pendentes: number;
  valor_pendente: number;
}

const CAMPOS = [
  "gasto",
  "impressoes",
  "cliques_link",
  "visualizacoes_pagina",
  "leads_meta",
  "compras_meta",
  "leads",
  "testes",
  "testes_cancelados",
  "vendas",
  "receita",
  "vendas_pendentes",
  "valor_pendente",
] as const;

export type Soma = Pick<Linha, (typeof CAMPOS)[number]> & { freqPeso: number };

export const zero = (): Soma => ({
  ...(Object.fromEntries(CAMPOS.map((k) => [k, 0])) as Pick<Linha, (typeof CAMPOS)[number]>),
  freqPeso: 0,
});

export function somar(s: Soma, l: Linha) {
  for (const k of CAMPOS) s[k] += Number(l[k]);
  s.freqPeso += Number(l.frequencia) * Number(l.impressoes);
  return s;
}
