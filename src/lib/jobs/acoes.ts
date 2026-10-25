"use server";

import { refresh } from "next/cache";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";

/** "Sincronizar agora" (últimos 7 dias) ou "Recarregar histórico" (desde a data da conta). */
export async function sincronizarConta(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const modo = dados.get("modo") === "carga" ? "carga" : "manual";
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const { error } = await supabase.rpc("enfileirar_sincronizacao", { p_org: orgId, p_tipo: "meta", p_alvo: String(dados.get("account_id")), p_modo: modo });
    if (error) return { erro: error.message };
    refresh();
    return { mensagem: "Na fila. O worker começa em até 1 minuto." };
  } catch (e) {
    return { erro: (e as Error).message };
  }
}
