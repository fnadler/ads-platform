// Resumo da resposta do PageSpeed Insights (Lighthouse 13): só o que a tela usa, num formato estável,
// para guardar (a resposta inteira tem ~700 KB, quase tudo captura de tela e rastros). Função pura.
//
// Os "achados" são os diagnósticos do Lighthouse que pedem atenção (nota < 0,9 ou economia estimada > 0),
// com os itens já achatados (arquivo, elemento, tamanho, desperdício, tempo, motivo). Quem os transforma
// em texto para leigo é diagnostico.ts.

export type MetricaCampo = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
export type Categoria = "bom" | "melhorar" | "ruim";

export interface ItemAchado {
  url?: string;
  /** Elemento da página ("p.mk-hero-sub") ou empresa ("Facebook"). */
  rotulo?: string;
  bytes?: number;
  desperdicio?: number;
  ms?: number;
  /** Pontuação de deslocamento (CLS) do elemento. */
  deslocamento?: number;
  motivo?: string;
}

export interface Achado {
  id: string;
  titulo: string;
  exibicao: string | null;
  nota: number | null;
  /** Economia estimada por métrica (ms; CLS sem unidade). */
  economia: Partial<Record<"LCP" | "FCP" | "TBT" | "CLS" | "INP", number>>;
  itens: ItemAchado[];
}

export interface ResumoVelocidade {
  url: string;
  testadoEm: string;
  lighthouse: string;
  /** 0–100. */
  nota: number | null;
  laboratorio: { lcp: number | null; fcp: number | null; tbt: number | null; cls: number | null; si: number | null };
  /** Dados de campo do Chrome (visitas reais de 28 dias), quando o Google tem tráfego suficiente. */
  campo: { fonte: "pagina" | "site"; metricas: Partial<Record<MetricaCampo, { p75: number; categoria: Categoria; distribuicao: [number, number, number] }>> } | null;
  /** O maior conteúdo da primeira tela e onde o tempo dele foi gasto (ms). */
  lcp: { elemento: string | null; seletor: string | null; fases: Partial<Record<"servidor" | "atrasoCarga" | "download" | "atrasoDesenho", number>> };
  achados: Achado[];
  terceiros: Array<{ nome: string; ms: number; bytes: number }>;
  /** Arquivos de fonte baixados no teste (endereço curto e tamanho). Ausente em testes antigos. */
  fontes?: Array<{ url: string; bytes: number }>;
  /** Altura e largura (px) da página inteira e da tela do aparelho simulado. */
  pagina: { largura: number; altura: number } | null;
  tela: { largura: number; altura: number };
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const lista = (v: unknown): J[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as J[]) : []);
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Endereço sem parâmetros (os do Facebook/Clarity são enormes) e curto. */
export function encurtarUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 140);
  } catch {
    return url.slice(0, 140);
  }
}

/** Linhas de uma tabela de detalhes; numa lista, as das tabelas de dentro. */
function linhas(detalhes: J): J[] {
  const todas = detalhes.type === "list" ? lista(detalhes.items).flatMap((i) => (i.type === "table" || i.type === "opportunity" ? lista(i.items) : [])) : lista(detalhes.items);
  // Linha de total ({node: {type: "text", value: "Total"}}) não é um item.
  return todas.filter((i) => obj(i.node).type !== "text");
}

function item(i: J): ItemAchado {
  const no = obj(i.node);
  const sub = lista(obj(i.subItems).items);
  const motivo = texto(sub[0]?.reason) ?? texto(sub[0]?.cause) ?? texto(obj(sub[0]?.extra).value) ?? undefined;
  const url = texto(i.url) ?? texto(i.source && obj(i.source).url);
  const r: ItemAchado = {};
  if (url) r.url = encurtarUrl(url);
  // Rótulo de várias linhas (um bloco inteiro de texto) não ajuda: vale o seletor.
  const label = texto(no.nodeLabel);
  const rotulo = texto(i.entity) ?? texto(obj(i.entity).text) ?? (label && !label.includes("\n") ? label : null) ?? texto(no.selector) ?? label;
  if (rotulo) r.rotulo = rotulo.slice(0, 160);
  const bytes = numero(i.totalBytes) ?? numero(i.transferSize);
  if (bytes !== null) r.bytes = Math.round(bytes);
  const desperdicio = numero(i.wastedBytes);
  if (desperdicio !== null) r.desperdicio = Math.round(desperdicio);
  const ms = numero(i.wastedMs) ?? numero(i.duration) ?? numero(i.mainThreadTime) ?? numero(i.reflowTime) ?? numero(i.total);
  if (ms !== null) r.ms = Math.round(ms);
  const deslocamento = numero(i.score);
  if (deslocamento !== null) r.deslocamento = Math.round(deslocamento * 1000) / 1000;
  if (motivo) r.motivo = motivo.slice(0, 300);
  return r;
}

const ATRASO_FASE: Record<string, keyof ResumoVelocidade["lcp"]["fases"]> = {
  timeToFirstByte: "servidor",
  resourceLoadDelay: "atrasoCarga",
  resourceLoadDuration: "download",
  elementRenderDelay: "atrasoDesenho",
};

const CRUX: Record<string, MetricaCampo> = {
  LARGEST_CONTENTFUL_PAINT_MS: "LCP",
  INTERACTION_TO_NEXT_PAINT: "INP",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "CLS",
  FIRST_CONTENTFUL_PAINT_MS: "FCP",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "TTFB",
};
const CATEGORIA_CRUX: Record<string, Categoria> = { FAST: "bom", AVERAGE: "melhorar", SLOW: "ruim" };

function campo(json: J): ResumoVelocidade["campo"] {
  for (const [chave, fonte] of [
    ["loadingExperience", "pagina"],
    ["originLoadingExperience", "site"],
  ] as const) {
    const le = obj(json[chave]);
    const metricas: NonNullable<ResumoVelocidade["campo"]>["metricas"] = {};
    for (const [nome, m] of Object.entries(obj(le.metrics))) {
      const k = CRUX[nome];
      const v = obj(m);
      const p75 = numero(v.percentile);
      const dist = lista(v.distributions).map((d) => numero(d.proportion) ?? 0);
      if (!k || p75 === null || dist.length !== 3) continue;
      metricas[k] = { p75: k === "CLS" ? p75 / 100 : p75, categoria: CATEGORIA_CRUX[String(v.category)] ?? "melhorar", distribuicao: [dist[0], dist[1], dist[2]] };
    }
    // A página sem dado próprio herda o do site (origin_fallback): conta como do site.
    if (Object.keys(metricas).length) return { fonte: fonte === "pagina" && le.origin_fallback ? "site" : fonte, metricas };
  }
  return null;
}

/** Diagnósticos que não viram achado (métricas, resumos, capturas, informativos sem ação). */
const IGNORAR = new Set([
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "interactive",
  "max-potential-fid",
  "metrics",
  "diagnostics",
  "network-requests",
  "network-rtt",
  "main-thread-tasks",
  "screenshot-thumbnails",
  "final-screenshot",
  "script-treemap-data",
  "resource-summary",
  "lcp-breakdown-insight",
  "third-parties-insight",
  "network-dependency-tree-insight",
  "total-byte-weight",
  "mainthread-work-breakdown",
  "layout-shifts", // o mesmo que cls-culprits-insight
]);

export function resumirPageSpeed(json: J): ResumoVelocidade {
  const lr = obj(json.lighthouseResult);
  const audits = obj(lr.audits);
  const a = (id: string) => obj(audits[id]);
  const valor = (id: string) => numero(a(id).numericValue);
  const nota = numero(obj(obj(lr.categories).performance).score);

  // LCP: fases (primeira tabela) e o elemento (primeiro nó).
  const lcpDet = obj(a("lcp-breakdown-insight").details);
  const fases: ResumoVelocidade["lcp"]["fases"] = {};
  for (const f of linhas(lcpDet)) {
    const k = ATRASO_FASE[String(f.subpart)];
    const d = numero(f.duration);
    if (k && d !== null) fases[k] = Math.round(d);
  }
  const noLcp = lista(lcpDet.items).find((i) => i.type === "node") ?? {};

  // Achados: tudo que tem nota abaixo de 0,9 ou economia estimada, menos o que é métrica ou resumo.
  const achados: Achado[] = [];
  for (const [id, bruto] of Object.entries(audits)) {
    const au = obj(bruto);
    if (IGNORAR.has(id) || ["notApplicable", "manual", "error"].includes(String(au.scoreDisplayMode))) continue;
    const economia = Object.fromEntries(Object.entries(obj(au.metricSavings)).filter(([, v]) => (numero(v) ?? 0) > 0)) as Achado["economia"];
    const n = numero(au.score);
    if (!Object.keys(economia).length && (n === null || n >= 0.9)) continue;
    achados.push({
      id,
      titulo: texto(au.title) ?? id,
      exibicao: texto(au.displayValue)?.replace(/ /g, " ") ?? null,
      nota: n,
      economia,
      itens: linhas(obj(au.details)).slice(0, 8).map(item),
    });
  }

  const terceiros = lista(obj(a("third-parties-insight").details).items)
    .map((i) => ({ nome: texto(i.entity) ?? texto(obj(i.entity).text) ?? "?", ms: Math.round(numero(i.mainThreadTime) ?? 0), bytes: Math.round(numero(i.transferSize) ?? 0) }))
    .filter((t) => t.ms > 0 || t.bytes > 0)
    .sort((x, y) => y.ms - x.ms);

  // Fontes: o Lighthouse não tem um diagnóstico para "fontes demais"; a lista de requisições tem.
  const fontes = lista(obj(a("network-requests").details).items)
    .filter((i) => i.resourceType === "Font" && texto(i.url))
    .map((i) => ({ url: encurtarUrl(String(i.url)), bytes: Math.round(numero(i.transferSize) ?? 0) }));

  const captura = obj(obj(lr.fullPageScreenshot).screenshot);
  const largura = numero(captura.width);
  const altura = numero(captura.height);
  const celular = obj(lr.configSettings).formFactor !== "desktop";

  return {
    url: texto(lr.finalDisplayedUrl) ?? texto(lr.finalUrl) ?? texto(lr.requestedUrl) ?? "",
    testadoEm: texto(lr.fetchTime) ?? texto(json.analysisUTCTimestamp) ?? new Date().toISOString(),
    lighthouse: texto(lr.lighthouseVersion) ?? "?",
    nota: nota === null ? null : Math.round(nota * 100),
    laboratorio: {
      lcp: valor("largest-contentful-paint"),
      fcp: valor("first-contentful-paint"),
      tbt: valor("total-blocking-time"),
      cls: valor("cumulative-layout-shift"),
      si: valor("speed-index"),
    },
    campo: campo(json),
    lcp: { elemento: texto(obj(noLcp).nodeLabel), seletor: texto(obj(noLcp).selector), fases },
    achados,
    terceiros,
    fontes,
    pagina: largura && altura ? { largura, altura } : null,
    // Celular do PageSpeed: Moto G Power emulado, 412 × 823.
    tela: celular ? { largura: 412, altura: 823 } : { largura: 1350, altura: 940 },
  };
}

/** A captura da página inteira (data URI JPEG), à parte: vai para o Storage, não para o banco. */
export function capturaDaPagina(json: J): { dados: Uint8Array; tipo: string } | null {
  const data = texto(obj(obj(obj(json.lighthouseResult).fullPageScreenshot).screenshot).data);
  const m = data?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return null;
  return { tipo: m[1], dados: Uint8Array.from(Buffer.from(m[2], "base64")) };
}
