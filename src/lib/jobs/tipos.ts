export interface Sincronizacao {
  id: string;
  organizacao_id: string;
  tipo: "meta" | "stripe_historico";
  alvo: string;
  modo: "carga" | "incremental" | "manual";
  status: string;
  cursor: Record<string, unknown>;
  linhas: number;
  tentativas: number;
}

/** pronto: terminou; continuar: falta fatia (reenfileira já, com o cursor gravado). */
export type ResultadoJob = { status: "pronto"; linhas: number } | { status: "continuar"; cursor: Record<string, unknown>; linhas: number };
