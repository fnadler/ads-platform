import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSegredo } from "@/lib/conexoes/segredos";
import {
  buscarInsightsClarity,
  ErroClarity,
  LIMITE_LINHAS_CLARITY,
  normalizarInsightsClarity,
  type DimensaoClarity,
  type MetricaClarity,
} from "@/lib/integracoes/clarity";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";

// Coleta do Clarity: uma consulta por recorte, cada uma com a janela das últimas 24 h. Uma fatia por
// consulta (o cursor guarda quantas já foram), para que uma nova tentativa não repita — e não gaste de
// novo — as que deram certo: são só 10 consultas por projeto por dia.

export interface SegredoClarity {
  token: string;
}

/** Recortes coletados todo dia: total, origem da visita e página × dispositivo. */
export const RECORTES_CLARITY: ReadonlyArray<readonly DimensaoClarity[]> = [[], ["Source", "Medium", "Campaign"], ["URL", "Device"]];

/** Dia (no fuso) imediatamente anterior a `agora`: o que a janela de 24 h da coleta diária cobre. */
export function diaAnterior(agora: Date, fuso: string): string {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Grava a resposta inteira e as linhas achatadas. Devolve quantas linhas. */
export async function gravarColetaClarity(
  admin: SupabaseClient,
  c: { organizacao_id: string; conexao_id: string; projeto_id: string; dia: string | null; dimensoes: readonly string[] },
  resposta: MetricaClarity[],
) {
  const linhas = normalizarInsightsClarity(resposta, c.dimensoes);
  const cortada = resposta.some((m) => Array.isArray(m?.information) && m.information.length >= LIMITE_LINHAS_CLARITY);
  const registro = { organizacao_id: c.organizacao_id, conexao_id: c.conexao_id, projeto_id: c.projeto_id, num_dias: 1, dimensoes: [...c.dimensoes], dia: c.dia, linhas: linhas.length, cortada, resposta };
  // Coleta diária refeita (nova tentativa no mesmo dia): substitui a anterior do mesmo recorte.
  if (c.dia)
    await admin.from("clarity_coletas").delete().eq("organizacao_id", c.organizacao_id).eq("projeto_id", c.projeto_id).eq("dia", c.dia).eq("dimensoes", `{${c.dimensoes.map((d) => `"${d}"`).join(",")}}`);
  const { data, error } = await admin.from("clarity_coletas").insert(registro).select("id").single();
  if (error || !data) throw new Error(`Não foi possível gravar a coleta do Clarity: ${error?.message}`);
  if (linhas.length) {
    const { error: e2 } = await admin
      .from("clarity_metricas")
      .insert(linhas.map((l) => ({ coleta_id: data.id, organizacao_id: c.organizacao_id, metrica: l.metrica, dimensoes: l.dimensoes, valores: l.valores })));
    if (e2) throw new Error(`Não foi possível gravar as métricas do Clarity: ${e2.message}`);
  }
  return linhas.length;
}

export async function executarColetaClarity(admin: SupabaseClient, s: Sincronizacao): Promise<ResultadoJob> {
  const { data: conexao } = await admin.from("conexoes").select("id, config").eq("id", s.alvo).eq("organizacao_id", s.organizacao_id).eq("tipo", "clarity").maybeSingle();
  if (!conexao) throw new ErroClarity("A conexão com o Clarity foi removida.", 404);
  const projeto = (conexao.config as { projeto_id?: string }).projeto_id;
  const segredo = await lerSegredo<SegredoClarity>(admin, s.organizacao_id, conexao.id);
  if (!projeto || !segredo?.token) throw new ErroClarity("Falta o ID do projeto ou o token do Clarity em Configurações.", 400);

  const { data: org } = await admin.from("organizacoes").select("fuso").eq("id", s.organizacao_id).single();
  // Só a coleta automática (de madrugada) fecha um dia; a avulsa fica sem dia.
  const dia = s.modo === "incremental" ? ((s.cursor.dia as string | undefined) ?? diaAnterior(new Date(), org?.fuso ?? "America/Sao_Paulo")) : null;

  const feitos = Number(s.cursor.feitos ?? 0);
  const recorte = RECORTES_CLARITY[feitos];
  const linhasAntes = s.linhas ?? 0;
  if (!recorte) return { status: "pronto", linhas: linhasAntes };

  const resposta = await buscarInsightsClarity(segredo.token, 1, recorte);
  const n = await gravarColetaClarity(admin, { organizacao_id: s.organizacao_id, conexao_id: conexao.id, projeto_id: projeto, dia, dimensoes: recorte }, resposta);
  const linhas = linhasAntes + n;
  if (feitos + 1 >= RECORTES_CLARITY.length) return { status: "pronto", linhas };
  return { status: "continuar", cursor: { feitos: feitos + 1, ...(dia ? { dia } : {}) }, linhas };
}
