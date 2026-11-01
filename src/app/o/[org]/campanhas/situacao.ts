import type { Tom } from "@/components/ui";

export const SITUACAO_CAMPANHA: Record<string, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  criando: { rotulo: "Criando na Meta…", tom: "alerta" },
  criada: { rotulo: "Criada (pausada)", tom: "ok" },
  ativando: { rotulo: "Ativando…", tom: "alerta" },
  ativa: { rotulo: "Ativa", tom: "ok" },
  erro: { rotulo: "Com erro", tom: "erro" },
};
