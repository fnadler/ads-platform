import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cadastros iniciados (evento opcional cadastro_iniciado) e quantos terminaram, por campanha. Sem o evento,
// devolve null: as telas seguem como antes.

export interface Iniciados {
  total: number;
  concluidos: number;
}

const PAGINA = 1000;

export async function contarIniciados(supabase: SupabaseClient, orgId: string, opcoes: { desde: string; ate?: string; campanha?: string }): Promise<Iniciados | null> {
  let total = 0;
  let concluidos = 0;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .rpc("cadastros_iniciados_resumo", { p_org: orgId, p_desde: opcoes.desde, p_campanha: opcoes.campanha ?? null })
      .range(de, de + PAGINA - 1);
    if (error) return null;
    const linhas = (data ?? []) as Array<{ iniciado_em: string; concluiu: boolean }>;
    for (const l of linhas) {
      if (opcoes.ate && l.iniciado_em >= opcoes.ate) continue;
      total++;
      if (l.concluiu) concluidos++;
    }
    if (linhas.length < PAGINA) break;
  }
  return total ? { total, concluidos } : null;
}
