import type { Tom } from "@/components/ui";

/** Situação de um teste de ponta a ponta (verificacoes_rastreio.status). */
export const ROTULO_TESTE: Record<string, { rotulo: string; tom: Tom }> = {
  ok: { rotulo: "Ponta a ponta OK", tom: "ok" },
  problema: { rotulo: "Com problema", tom: "erro" },
  aguardando: { rotulo: "Aguardando o cadastro de teste", tom: "alerta" },
};
