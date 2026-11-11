import type { Tom } from "@/components/ui";

// A Meta não devolve o status da campanha na leitura de anúncios, mas o effective_status de cada anúncio
// já carrega o motivo: CAMPAIGN_PAUSED quando a campanha está pausada, ADSET_PAUSED pelo conjunto, PAUSED
// pelo próprio anúncio. Daí sai o que a campanha está fazendo e o que dá para fazer com ela.

const NO_AR = ["ACTIVE"];
const EM_ANALISE = ["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"];
const COM_PROBLEMA = ["WITH_ISSUES", "DISAPPROVED"];
const PAUSADA_NOS_ITENS = ["PAUSED", "ADSET_PAUSED"];

/**
 * ligada: a campanha está ligada e algo veicula, está em análise ou com problema (dá para pausar);
 * pausada: a campanha inteira foi pausada (dá para reativar);
 * parada: a campanha está ligada, mas todos os conjuntos ou anúncios foram pausados um a um;
 * encerrada: terminou, foi arquivada ou não tem anúncio lido.
 */
export type Veiculacao = "ligada" | "pausada" | "parada" | "encerrada";

const tem = (status: Array<string | null>, lista: string[]) => status.some((s) => !!s && lista.includes(s));

export function veiculacaoPelosAnuncios(status: Array<string | null>): Veiculacao {
  if (tem(status, [...NO_AR, ...EM_ANALISE, ...COM_PROBLEMA])) return "ligada";
  if (tem(status, ["CAMPAIGN_PAUSED"])) return "pausada";
  if (tem(status, PAUSADA_NOS_ITENS)) return "parada";
  return "encerrada";
}

/** Situação para mostrar (etiqueta), a partir da veiculação dos anúncios. */
export function situacaoPelosAnuncios(status: Array<string | null>): { rotulo: string; tom: Tom } {
  if (tem(status, NO_AR)) return { rotulo: "No ar", tom: "ok" };
  if (tem(status, EM_ANALISE)) return { rotulo: "Em análise", tom: "alerta" };
  if (tem(status, COM_PROBLEMA)) return { rotulo: "Com problemas", tom: "erro" };
  if (tem(status, ["CAMPAIGN_PAUSED", ...PAUSADA_NOS_ITENS])) return { rotulo: "Pausada", tom: "info" };
  return { rotulo: "Encerrada", tom: "info" };
}

/**
 * Depois de pausar ou reativar, o effective_status lido fica velho até a próxima leitura da Meta (que a ação
 * agenda para logo em seguida). Enquanto isso: pausar segura tudo o que estava vivo pelo motivo "campanha";
 * reativar solta o que a campanha segurava. Pausas próprias de conjunto ou anúncio ficam como estão.
 */
export function statusDepoisDe(acao: "pausar" | "reativar", status: string | null): string | null {
  if (acao === "pausar") return status && [...NO_AR, ...EM_ANALISE, ...COM_PROBLEMA].includes(status) ? "CAMPAIGN_PAUSED" : status;
  return status === "CAMPAIGN_PAUSED" ? "ACTIVE" : status;
}

/** Rótulo do effective_status de um anúncio. */
export const ROTULO_VEICULACAO: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  PENDING_REVIEW: "Em análise",
  IN_PROCESS: "Processando",
  WITH_ISSUES: "Com problemas",
  DISAPPROVED: "Reprovado",
  PREAPPROVED: "Pré-aprovado",
  EXPIRED: "Concluído",
  ARCHIVED: "Arquivado",
  DELETED: "Excluído",
};
