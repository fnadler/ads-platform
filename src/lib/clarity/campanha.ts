// Experiência na página só de quem veio de uma campanha, a partir das coletas diárias do Clarity no recorte
// página × dispositivo (resposta bruta). Os links dos anúncios levam utm_campaign_id e o fbclid, que é único
// por clique: cada URL da resposta é, na prática, uma visita — o que permite montar a curva de rolagem
// (quantos chegam a cada altura da página), e não só a média. Função pura, testável com respostas reais.

export type Aparelho = "Mobile" | "PC" | "Tablet";
export const APARELHOS: Aparelho[] = ["Mobile", "PC", "Tablet"];

export interface ExperienciaAparelho {
  sessoes: number;
  /** Rolagem média (0–100), ponderada pelas visitas. */
  rolagem: number | null;
  /** curva[i] = fração das visitas que chegou a pelo menos i×10% da altura da página (i = 0…10). */
  curva: number[] | null;
  /** Visitas com dado de rolagem (base da curva). */
  baseCurva: number;
  tempoAtivo: number | null; // segundos, média por visita
  cliqueMorto: number | null; // fração das visitas
  cliqueRaiva: number | null;
  voltaRapida: number | null;
}

export interface ExperienciaCampanha {
  dias: string[];
  sessoes: number;
  porAparelho: Partial<Record<Aparelho, ExperienciaAparelho>>;
  /** Páginas de chegada (sem parâmetros), da mais visitada para a menos. */
  paginas: Array<{ url: string; sessoes: number }>;
}

type Info = Record<string, unknown>;
export interface ColetaBruta {
  dia: string;
  resposta: Array<{ metricName: string; information: Info[] }>;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function daCampanha(url: string, campanhaId: string) {
  try {
    const u = new URL(url);
    return u.searchParams.get("utm_campaign_id") === campanhaId || u.searchParams.get("utm_id") === campanhaId;
  } catch {
    return false;
  }
}
const semParametros = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
};
const aparelho = (v: unknown): Aparelho | null => (v === "Mobile" || v === "PC" || v === "Tablet" ? v : null);

export function experienciaDaCampanha(coletas: ColetaBruta[], campanhaId: string): ExperienciaCampanha {
  // Uma visita = Url × Device × dia. Junta as métricas de cada uma.
  interface Visita {
    aparelho: Aparelho;
    url: string;
    sessoes: number;
    rolagem?: number;
    tempo?: number;
    morto?: number;
    raiva?: number;
    volta?: number;
  }
  const visitas = new Map<string, Visita>();
  const dias = new Set<string>();
  for (const c of coletas) {
    for (const m of c.resposta ?? []) {
      const nome = String(m.metricName ?? "").replace(/\s/g, "");
      for (const i of m.information ?? []) {
        const url = typeof i.Url === "string" ? i.Url : typeof i.URL === "string" ? i.URL : null;
        const ap = aparelho(i.Device);
        if (!url || !ap || !daCampanha(url, campanhaId)) continue;
        dias.add(c.dia);
        const k = `${c.dia}|${ap}|${url}`;
        const v = visitas.get(k) ?? { aparelho: ap, url, sessoes: 0 };
        visitas.set(k, v);
        if (nome === "Traffic") v.sessoes = Math.max(v.sessoes, num(i.totalSessionCount) ?? 0);
        else if (nome === "ScrollDepth") v.rolagem = num(i.averageScrollDepth) ?? undefined;
        else if (nome === "EngagementTime") v.tempo = num(i.activeTime) ?? undefined;
        else {
          const pct = num(i.sessionsWithMetricPercentage);
          if (!v.sessoes) v.sessoes = num(i.sessionsCount) ?? 0;
          if (pct === null) continue;
          if (nome === "DeadClickCount") v.morto = pct / 100;
          else if (nome === "RageClickCount") v.raiva = pct / 100;
          else if (nome === "QuickbackClick") v.volta = pct / 100;
        }
      }
    }
  }

  const porAparelho: ExperienciaCampanha["porAparelho"] = {};
  const paginas = new Map<string, number>();
  let total = 0;
  for (const ap of APARELHOS) {
    const vs = [...visitas.values()].filter((v) => v.aparelho === ap).map((v) => ({ ...v, sessoes: v.sessoes || 1 }));
    if (!vs.length) continue;
    const media = (campo: "rolagem" | "tempo" | "morto" | "raiva" | "volta") => {
      const com = vs.filter((v) => typeof v[campo] === "number");
      const peso = com.reduce((s, v) => s + v.sessoes, 0);
      return peso ? com.reduce((s, v) => s + (v[campo] as number) * v.sessoes, 0) / peso : null;
    };
    const comRolagem = vs.filter((v) => typeof v.rolagem === "number");
    const base = comRolagem.reduce((s, v) => s + v.sessoes, 0);
    const curva = base ? Array.from({ length: 11 }, (_, i) => comRolagem.filter((v) => (v.rolagem as number) >= i * 10).reduce((s, v) => s + v.sessoes, 0) / base) : null;
    const sessoes = vs.reduce((s, v) => s + v.sessoes, 0);
    total += sessoes;
    for (const v of vs) paginas.set(semParametros(v.url), (paginas.get(semParametros(v.url)) ?? 0) + v.sessoes);
    porAparelho[ap] = {
      sessoes,
      rolagem: media("rolagem"),
      curva,
      baseCurva: base,
      tempoAtivo: media("tempo"),
      cliqueMorto: media("morto"),
      cliqueRaiva: media("raiva"),
      voltaRapida: media("volta"),
    };
  }
  return {
    dias: [...dias].sort(),
    sessoes: total,
    porAparelho,
    paginas: [...paginas].map(([url, sessoes]) => ({ url, sessoes })).sort((a, b) => b.sessoes - a.sessoes),
  };
}
