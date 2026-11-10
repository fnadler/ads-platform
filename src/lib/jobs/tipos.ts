export interface Sincronizacao {
  id: string;
  organizacao_id: string;
  tipo: "meta" | "stripe_historico" | "meta_publicacao" | "meta_publico" | "clarity" | "pagespeed";
  alvo: string;
  modo: "carga" | "incremental" | "manual";
  status: string;
  cursor: Record<string, unknown>;
  linhas: number;
  tentativas: number;
}

/** pronto: terminou; continuar: falta fatia (reenfileira com o cursor gravado, já ou depois de atrasoSegundos). */
export type ResultadoJob = { status: "pronto"; linhas: number } | { status: "continuar"; cursor: Record<string, unknown>; linhas: number; atrasoSegundos?: number };
