import type { SupabaseClient } from "@supabase/supabase-js";

// Payback de assinatura: em quantos meses de mensalidade cada assinante paga o que custou no anúncio. Em
// assinatura, o retorno do primeiro pagamento engana (no GN, "R$ 0,17 de volta para cada R$ 1"); o que decide
// é se o assinante fica tempo bastante para pagar o custo dele. A mensalidade sai das próprias vendas recebidas
// (a mediana dos pagamentos), sem pedir nada a quem usa.

export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Meses de mensalidade para pagar o custo de cada assinante. */
export function mesesParaPagar(gasto: number, assinantes: number, mensalidade: number | null): number | null {
  return assinantes > 0 && mensalidade ? gasto / assinantes / mensalidade : null;
}

/** "cerca de 6 meses", "menos de 1 mês". */
export function textoMeses(meses: number): string {
  if (meses < 1) return "menos de 1 mês";
  const n = Math.round(meses);
  return `cerca de ${n} ${n === 1 ? "mês" : "meses"}`;
}

/** Mensalidade: a mediana dos pagamentos dos últimos 120 dias. */
export async function carregarMensalidade(supabase: SupabaseClient, orgId: string): Promise<number | null> {
  const desde = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data } = await supabase.from("vendas").select("valor").eq("organizacao_id", orgId).eq("tipo", "pagamento").gte("ocorrida_em", desde).limit(1000);
  return mediana((data ?? []).map((v) => Number(v.valor)));
}
