// Experiência na página só de quem veio de uma campanha, a partir das coletas diárias do Clarity no recorte
// página × dispositivo × navegador (resposta bruta). Os links dos anúncios levam utm_campaign_id, utm_ad_id e
// o fbclid, que é único por clique: cada URL da resposta é, na prática, uma visita — o que permite montar a
// curva de rolagem (quantos chegam a cada altura da página), e não só a média, e separar as visitas por
// anúncio e por navegador sem gastar consultas a mais. Função pura, testável com respostas reais.
//
// Os parâmetros da campanha seguem para as páginas internas (/login, /vendas…) na mesma visita, então só
// contam como chegada as URLs cujo caminho é um destino dos anúncios; sem destino conhecido, as que trazem o
// fbclid; sem nenhum dos dois, todas. Sem isso a mesma pessoa contava duas vezes e as páginas curtas
// (rolagem 100%) inflavam a curva.

export type Aparelho = "Mobile" | "PC" | "Tablet";
export const APARELHOS: Aparelho[] = ["Mobile", "PC", "Tablet"];

/** Médias de um grupo de visitas, ponderadas pelas visitas. Nulo quando a métrica não veio. */
export interface SinaisVisitas {
  sessoes: number;
  /** Rolagem média (0–100). */
  rolagem: number | null;
  /** Segundos, média por visita. */
  tempoAtivo: number | null;
  /** Frações das visitas (0–1). */
  cliqueMorto: number | null;
  cliqueRaiva: number | null;
  voltaRapida: number | null;
  erroScript: number | null;
  cliqueErro: number | null;
  /** Páginas vistas por visita. */
  paginasPorVisita: number | null;
}

export interface ExperienciaAparelho extends SinaisVisitas {
  /** curva[i] = fração das visitas que chegou a pelo menos i×10% da altura da página (i = 0…10). */
  curva: number[] | null;
  /** Visitas com dado de rolagem (base da curva). */
  baseCurva: number;
}

export interface GrupoVisitas extends SinaisVisitas {
  chave: string;
  /** Nome que veio na própria URL (utm_content), quando há. */
  rotulo?: string;
}

export interface ExperienciaCampanha {
  dias: string[];
  sessoes: number;
  /** Todas as visitas da campanha juntas. */
  geral: SinaisVisitas | null;
  porAparelho: Partial<Record<Aparelho, ExperienciaAparelho>>;
  /** Por anúncio (utm_ad_id), do que mais trouxe visitas para o que menos. */
  porAnuncio: GrupoVisitas[];
  /** Por navegador, só nos dias coletados com essa dimensão (ver `diasComNavegador`). */
  porNavegador: GrupoVisitas[];
  diasComNavegador: string[];
  /** Páginas de chegada (sem parâmetros), da mais visitada para a menos. */
  paginas: Array<{ url: string; sessoes: number }>;
  /**
   * Na página de chegada principal, as visitas desta campanha × as que chegaram por outra campanha × as sem
   * anúncio (que incluem quem já navegava pelo site). Mesma página, mesma régua: dá para comparar.
   */
  comparacao: { pagina: string; estaCampanha: SinaisVisitas; outrasCampanhas: SinaisVisitas | null; semAnuncio: SinaisVisitas | null } | null;
}

type Info = Record<string, unknown>;
export interface ColetaBruta {
  dia: string;
  resposta: Array<{ metricName: string; information: Info[] }>;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const texto = (v: unknown) => (typeof v === "string" ? v : null);

/** Métricas de uma linha da resposta (uma combinação de dimensões num dia), juntadas entre as métricas. */
interface Acumulado {
  dia: string;
  info: Info;
  sessoes: number;
  rolagem?: number;
  tempo?: number;
  morto?: number;
  raiva?: number;
  volta?: number;
  erro?: number;
  cliqueErro?: number;
  paginas?: number;
}

const PERCENTUAIS: Record<string, keyof Acumulado> = {
  DeadClickCount: "morto",
  RageClickCount: "raiva",
  QuickbackClick: "volta",
  ScriptErrorCount: "erro",
  ErrorClickCount: "cliqueErro",
};

/** Junta as métricas por chave (nulo = linha ignorada). A chave deve incluir o dia. */
function acumular(coletas: ColetaBruta[], chave: (i: Info, dia: string) => string | null) {
  const linhas = new Map<string, Acumulado>();
  for (const c of coletas) {
    for (const m of c.resposta ?? []) {
      const nome = String(m.metricName ?? "").replace(/\s/g, "");
      for (const i of m.information ?? []) {
        const k = chave(i, c.dia);
        if (k === null) continue;
        const v = linhas.get(k) ?? { dia: c.dia, info: i, sessoes: 0 };
        linhas.set(k, v);
        if (nome === "Traffic") {
          v.sessoes = Math.max(v.sessoes, num(i.totalSessionCount) ?? 0);
          v.paginas = num(i.pagesPerSessionPercentage) ?? undefined;
        } else if (nome === "ScrollDepth") v.rolagem = num(i.averageScrollDepth) ?? undefined;
        else if (nome === "EngagementTime") v.tempo = num(i.activeTime) ?? undefined;
        else if (PERCENTUAIS[nome]) {
          const pct = num(i.sessionsWithMetricPercentage);
          if (!v.sessoes) v.sessoes = num(i.sessionsCount) ?? 0;
          if (pct !== null) (v[PERCENTUAIS[nome]] as number) = pct / 100;
        }
      }
    }
  }
  // Linha sem contagem de visitas (o Clarity às vezes manda 0): conta como uma.
  return [...linhas.values()].map((v) => ({ ...v, sessoes: v.sessoes || 1 }));
}

function sinais(vs: Acumulado[]): SinaisVisitas {
  const media = (campo: "rolagem" | "tempo" | "morto" | "raiva" | "volta" | "erro" | "cliqueErro" | "paginas") => {
    const com = vs.filter((v) => typeof v[campo] === "number");
    const peso = com.reduce((s, v) => s + v.sessoes, 0);
    return peso ? com.reduce((s, v) => s + (v[campo] as number) * v.sessoes, 0) / peso : null;
  };
  return {
    sessoes: vs.reduce((s, v) => s + v.sessoes, 0),
    rolagem: media("rolagem"),
    tempoAtivo: media("tempo"),
    cliqueMorto: media("morto"),
    cliqueRaiva: media("raiva"),
    voltaRapida: media("volta"),
    erroScript: media("erro"),
    cliqueErro: media("cliqueErro"),
    paginasPorVisita: media("paginas"),
  };
}

function curvaRolagem(vs: Acumulado[]) {
  const com = vs.filter((v) => typeof v.rolagem === "number");
  const base = com.reduce((s, v) => s + v.sessoes, 0);
  const curva = base ? Array.from({ length: 11 }, (_, i) => com.filter((v) => (v.rolagem as number) >= i * 10).reduce((s, v) => s + v.sessoes, 0) / base) : null;
  return { curva, baseCurva: base };
}

function agrupar(vs: Acumulado[], chave: (v: Acumulado) => string | null, rotulo?: (v: Acumulado) => string | null): GrupoVisitas[] {
  const grupos = new Map<string, Acumulado[]>();
  for (const v of vs) {
    const k = chave(v);
    if (k === null) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), v]);
  }
  return [...grupos]
    .map(([k, g]) => {
      const r = rotulo ? g.map(rotulo).find((x) => !!x) : undefined;
      return { chave: k, ...(r ? { rotulo: r } : {}), ...sinais(g) };
    })
    .sort((a, b) => b.sessoes - a.sessoes);
}

const parametros = (url: string) => {
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
};
const semParametros = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
};
/** host + caminho, sem "www." e sem barra no fim: para casar a URL da visita com o destino do anúncio. */
export function caminho(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}
const aparelho = (v: unknown): Aparelho | null => (v === "Mobile" || v === "PC" || v === "Tablet" ? v : null);
const urlDe = (i: Info) => texto(i.Url) ?? texto(i.URL);

export function experienciaDaCampanha(coletas: ColetaBruta[], campanhaId: string, destinos: string[] = []): ExperienciaCampanha {
  // Toda linha com aparelho, de qualquer origem: a comparação na mesma página usa as que não são da campanha.
  const todas = acumular(coletas, (i, dia) => {
    const url = urlDe(i);
    const ap = aparelho(i.Device);
    return url && ap ? `${dia}|${ap}|${texto(i.Browser) ?? ""}|${url}` : null;
  });
  const q = (v: Acumulado) => parametros(urlDe(v.info)!);
  const daCampanha = todas.filter((v) => {
    const p = q(v);
    return p?.get("utm_campaign_id") === campanhaId || p?.get("utm_id") === campanhaId;
  });
  const deDestino = new Set(destinos.map(caminho).filter((c): c is string => !!c));
  const porDestino = daCampanha.filter((v) => deDestino.has(caminho(urlDe(v.info)!) ?? ""));
  const comClique = daCampanha.filter((v) => q(v)?.has("fbclid"));
  // Uma visita = Url × Device (× Browser) × dia, só as chegadas.
  const visitas = porDestino.length ? porDestino : comClique.length ? comClique : daCampanha;

  const porAparelho: ExperienciaCampanha["porAparelho"] = {};
  for (const ap of APARELHOS) {
    const vs = visitas.filter((v) => v.info.Device === ap);
    if (vs.length) porAparelho[ap] = { ...sinais(vs), ...curvaRolagem(vs) };
  }

  const paginas = new Map<string, number>();
  for (const v of visitas) paginas.set(semParametros(urlDe(v.info)!), (paginas.get(semParametros(urlDe(v.info)!)) ?? 0) + v.sessoes);
  const ordenadas = [...paginas].map(([url, sessoes]) => ({ url, sessoes })).sort((a, b) => b.sessoes - a.sessoes);

  let comparacao: ExperienciaCampanha["comparacao"] = null;
  if (ordenadas[0]) {
    const principal = caminho(ordenadas[0].url);
    const naPagina = (vs: Acumulado[]) => vs.filter((v) => caminho(urlDe(v.info)!) === principal);
    const daqui = new Set(daCampanha);
    const outras = naPagina(todas).filter((v) => !daqui.has(v));
    const anuncio = (v: Acumulado) => {
      const p = q(v);
      return !!p && (p.has("utm_campaign_id") || p.has("utm_id") || p.has("fbclid") || /^(paid|cpc|ppc)$/i.test(p.get("utm_medium") ?? ""));
    };
    const outrasCampanhas = outras.filter(anuncio);
    const semAnuncio = outras.filter((v) => !anuncio(v));
    comparacao = {
      pagina: ordenadas[0].url,
      estaCampanha: sinais(naPagina(visitas)),
      outrasCampanhas: outrasCampanhas.length ? sinais(outrasCampanhas) : null,
      semAnuncio: semAnuncio.length ? sinais(semAnuncio) : null,
    };
  }

  const comNavegador = visitas.filter((v) => !!texto(v.info.Browser));
  const geral = visitas.length ? sinais(visitas) : null;
  return {
    dias: [...new Set(visitas.map((v) => v.dia))].sort(),
    sessoes: geral?.sessoes ?? 0,
    geral,
    porAparelho,
    porAnuncio: agrupar(
      visitas,
      (v) => q(v)?.get("utm_ad_id") || null,
      (v) => q(v)?.get("utm_content") || null,
    ),
    porNavegador: agrupar(comNavegador, (v) => texto(v.info.Browser)),
    diasComNavegador: [...new Set(comNavegador.map((v) => v.dia))].sort(),
    paginas: ordenadas,
    comparacao,
  };
}
