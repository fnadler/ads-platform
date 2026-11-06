import "server-only";

// Microsoft Clarity — Data Export API (só leitura, números agregados do painel).
// https://learn.microsoft.com/en-us/clarity/clarity-data-export-api
//
// Limites que moldam o uso: só as últimas 24, 48 ou 72 horas (numOfDays 1–3, janela móvel a partir da
// chamada, em UTC); no máximo 10 chamadas por projeto por dia; até 3 dimensões por chamada; até 1.000
// linhas, sem paginação. Por isso a coleta é diária e guarda a resposta bruta: o que não for coletado
// em 3 dias não volta mais, e o formato documentado é só um exemplo.

const URL_API = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export const DIMENSOES_CLARITY = ["Browser", "Device", "Country/Region", "OS", "Source", "Medium", "Campaign", "Channel", "URL"] as const;
export type DimensaoClarity = (typeof DIMENSOES_CLARITY)[number];

/** Limite de linhas da resposta: se vier exatamente isso, a resposta foi cortada. */
export const LIMITE_LINHAS_CLARITY = 1000;

export class ErroClarity extends Error {
  constructor(
    mensagem: string,
    readonly status?: number,
  ) {
    super(mensagem);
  }
  /** Repetir não adianta (token, permissão, parâmetro ou cota do dia) — e cada tentativa gasta cota. */
  get definitivo() {
    return this.status !== undefined && this.status >= 400 && this.status < 500;
  }
  /** O problema é a credencial: a conexão vai para "com erro". */
  get deCredencial() {
    return this.status === 401 || this.status === 403;
  }
}

export interface MetricaClarity {
  metricName: string;
  information: Array<Record<string, unknown>>;
}

/** Uma chamada à API. Devolve a resposta como veio (lista de métricas). */
export async function buscarInsightsClarity(token: string, numOfDays: 1 | 2 | 3, dimensoes: readonly DimensaoClarity[] = []): Promise<MetricaClarity[]> {
  if (dimensoes.length > 3) throw new ErroClarity("O Clarity aceita no máximo 3 dimensões por consulta.");
  const params = new URLSearchParams({ numOfDays: String(numOfDays) });
  dimensoes.forEach((d, i) => params.set(`dimension${i + 1}`, d));
  let resposta: Response;
  try {
    resposta = await fetch(`${URL_API}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ErroClarity("Não foi possível falar com o Clarity (rede). Tente de novo.");
  }
  if (resposta.ok) {
    const json = await resposta.json().catch(() => null);
    if (!Array.isArray(json)) throw new ErroClarity("O Clarity respondeu num formato inesperado.");
    return json as MetricaClarity[];
  }
  const texto = (await resposta.text().catch(() => "")).slice(0, 200);
  const status = resposta.status;
  if (status === 401) throw new ErroClarity("O token do Clarity é inválido ou expirou. Gere um novo em Settings → Data Export e cole em Configurações.", status);
  if (status === 403) throw new ErroClarity("O token do Clarity não tem permissão para exportar dados deste projeto.", status);
  if (status === 429) throw new ErroClarity("O Clarity já atendeu as 10 consultas de hoje deste projeto. A próxima coleta automática acontece amanhã.", status);
  if (status === 400) throw new ErroClarity(`O Clarity recusou a consulta (parâmetros inválidos)${texto ? `: ${texto}` : "."}`, status);
  throw new ErroClarity(`Erro do Clarity (${status})${texto ? `: ${texto}` : "."}`, status);
}

export interface LinhaClarity {
  metrica: string;
  dimensoes: Record<string, string>;
  valores: Record<string, number | string | null>;
}

const numero = (v: unknown): number | string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return typeof v === "string" ? v : JSON.stringify(v);
};

/**
 * Achata a resposta em linhas (métrica × combinação de dimensões). As chaves que são dimensões pedidas
 * viram `dimensoes`; o resto vira `valores`, com números em texto ("9554") convertidos.
 */
export function normalizarInsightsClarity(resposta: MetricaClarity[], dimensoes: readonly string[]): LinhaClarity[] {
  const linhas: LinhaClarity[] = [];
  const ehDimensao = new Set(dimensoes);
  for (const m of resposta) {
    if (!m || typeof m.metricName !== "string" || !Array.isArray(m.information)) continue;
    for (const item of m.information) {
      if (!item || typeof item !== "object") continue;
      const linha: LinhaClarity = { metrica: m.metricName, dimensoes: {}, valores: {} };
      for (const [k, v] of Object.entries(item)) {
        if (ehDimensao.has(k)) linha.dimensoes[k] = v === null || v === undefined ? "" : String(v);
        else linha.valores[k] = numero(v);
      }
      linhas.push(linha);
    }
  }
  return linhas;
}

/** Project ID do Clarity: o código no fim do script (clarity.ms/tag/<id>) ou do endereço do painel. */
export function normalizarProjetoClarity(texto: string): string | null {
  const t = texto.trim();
  const m = t.match(/clarity\.ms\/tag\/([a-z0-9]+)/i) ?? t.match(/projects\/view\/([a-z0-9]+)/i) ?? t.match(/"([a-z0-9]{6,20})"\s*\)\s*;?\s*(?:<\/script>)?\s*$/i);
  const id = (m?.[1] ?? t).toLowerCase();
  return /^[a-z0-9]{6,20}$/.test(id) ? id : null;
}
