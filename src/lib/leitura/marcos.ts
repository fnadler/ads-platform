// Marcos da campanha: as mudanças feitas na Meta (pausas, retomadas, verba, teste de anúncios), lidas do
// registro de escrita (operacoes_meta), e o que mudou nos números de antes para depois de cada uma.
// Sem banco nem rede, para ser testável com casos reais (os dados chegam prontos de carregarMarcos).
//
// Por quê: no GN Coleciona, pausar um anúncio quase sem gasto (09/11) fez a Meta tirar a verba do único
// anúncio que vendia e dar ao que não vendia — e ninguém viu, porque a mudança não aparecia em lugar nenhum.

const SEM_CENTAVOS = new Set(["JPY", "KRW", "CLP", "PYG", "VND", "COP", "HUF", "ISK", "TWD", "UGX"]);

export interface OperacaoMeta {
  criado_em: string;
  caminho: string;
  parametros: Record<string, unknown> | null;
  status_http: number | null;
  resposta: { error?: unknown } | null;
  usuario_id: string | null;
}

export type TipoMarco = "criada" | "ativada" | "pausa_campanha" | "retomada_campanha" | "pausa_anuncio" | "retomada_anuncio" | "pausa_conjunto" | "retomada_conjunto" | "verba" | "teste_anuncios";

export interface Marco {
  /** Momento da operação (ISO). */
  em: string;
  /** Dia no fuso da organização (AAAA-MM-DD). */
  dia: string;
  tipo: TipoMarco;
  /** Em linguagem simples: "Pausou o anúncio “C Digitando”". */
  rotulo: string;
  /** Anúncio envolvido (pausa/retomada de anúncio). */
  adId?: string;
  usuarioId: string | null;
}

export interface NomesCampanha {
  campanhaId: string;
  anuncios: Map<string, string>;
  conjuntos: Map<string, string>;
}

const diaNoFuso = (iso: string, fuso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: fuso });
const ok = (o: OperacaoMeta) => !!o.status_http && o.status_http >= 200 && o.status_http < 300 && !o.resposta?.error;

function verba(p: Record<string, unknown>, moeda: string): string | null {
  const v = p.daily_budget ?? p.lifetime_budget;
  if (v === undefined || v === null) return null;
  const valor = Number(v) / (SEM_CENTAVOS.has(moeda.toUpperCase()) ? 1 : 100);
  const fmt = valor.toLocaleString("pt-BR", { style: "currency", currency: moeda });
  return p.daily_budget !== undefined ? `${fmt} por dia` : `${fmt} no total`;
}

/**
 * Marcos a partir das operações de escrita da campanha. Junta o que foi feito junto com a campanha como um gesto só
 * (ativar a campanha liga anúncios, conjunto e campanha juntos) e deixa de fora a criação peça por peça.
 */
export function marcosDeOperacoes(ops: OperacaoMeta[], nomes: NomesCampanha, fuso: string, moeda: string): Marco[] {
  const validas = ops.filter(ok).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  const marcos: Marco[] = [];
  let ativou = false;
  const gestosDaCampanha = validas.filter((o) => o.caminho === nomes.campanhaId && o.parametros?.status).map((o) => Date.parse(o.criado_em));
  const juntoDaCampanha = (o: OperacaoMeta) => gestosDaCampanha.some((t) => Math.abs(t - Date.parse(o.criado_em)) <= 90_000);
  const nomeAnuncio = (id: string) => `“${nomes.anuncios.get(id) ?? id}”`;
  const nomeConjunto = (id: string) => `“${nomes.conjuntos.get(id) ?? id}”`;
  const add = (o: OperacaoMeta, tipo: TipoMarco, rotulo: string, adId?: string) =>
    marcos.push({ em: o.criado_em, dia: diaNoFuso(o.criado_em, fuso), tipo, rotulo, adId, usuarioId: o.usuario_id });

  for (const o of validas) {
    const p = o.parametros ?? {};
    const status = typeof p.status === "string" ? p.status : null;
    if (/\/campaigns$/.test(o.caminho)) {
      add(o, "criada", "Criou a campanha na Meta (pausada)");
      continue;
    }
    if (/\/adsets$/.test(o.caminho)) {
      // Conjunto novo depois de a campanha existir: o teste de anúncios com verba própria.
      const nome = typeof p.name === "string" ? p.name : "";
      if (/\|\s*Teste\s*\|/.test(nome)) add(o, "teste_anuncios", `Criou um teste com verba própria: ${nome.replace(/^.*\|\s*Teste\s*\|\s*/, "")}`);
      continue;
    }
    if (o.caminho.includes("/")) continue; // vídeos, imagens, criativos e anúncios criados na montagem

    const v = verba(p, moeda);
    if (v) {
      const alvo = o.caminho === nomes.campanhaId ? "da campanha" : nomes.conjuntos.has(o.caminho) ? `do conjunto ${nomeConjunto(o.caminho)}` : "";
      add(o, "verba", `Mudou a verba ${alvo} para ${v}`.replace("  ", " "));
      continue;
    }
    if (!status) continue;
    const pausa = status === "PAUSED";
    if (o.caminho === nomes.campanhaId) {
      if (!pausa && !ativou) {
        ativou = true;
        add(o, "ativada", "Ativou a campanha");
      } else add(o, pausa ? "pausa_campanha" : "retomada_campanha", pausa ? "Pausou a campanha" : "Retomou a campanha");
      continue;
    }
    // Anúncio ou conjunto mexido junto com a campanha (até 90 s): parte do mesmo gesto (ativar tudo).
    if (juntoDaCampanha(o)) continue;
    if (nomes.anuncios.has(o.caminho)) {
      add(o, pausa ? "pausa_anuncio" : "retomada_anuncio", `${pausa ? "Pausou" : "Reativou"} o anúncio ${nomeAnuncio(o.caminho)}`, o.caminho);
    } else if (nomes.conjuntos.has(o.caminho)) {
      add(o, pausa ? "pausa_conjunto" : "retomada_conjunto", `${pausa ? "Pausou" : "Reativou"} o conjunto ${nomeConjunto(o.caminho)}`);
    }
  }
  return marcos;
}

// ───────────────────────────── Antes e depois ─────────────────────────────

export interface GastoAnuncioDia {
  dia: string;
  ad_id: string;
  gasto: number;
}

export interface DiaResultado {
  dia: string;
  gasto: number;
  /** Cadastros que chegaram ao sistema, pelo dia do cadastro. */
  leads: number;
}

export interface Lado {
  dias: number;
  gasto: number;
  leads: number;
  /** Fatia da verba de cada anúncio (0 a 1), maiores primeiro. */
  fatias: Array<{ adId: string; fatia: number }>;
}

export interface Efeito {
  antes: Lado;
  depois: Lado;
  /** Anúncio que mais ganhou verba, e quanto (pontos de fração). */
  ganhou: { adId: string; de: number; para: number } | null;
  /** Anúncio que mais perdeu verba (sem contar o pausado). */
  perdeu: { adId: string; de: number; para: number } | null;
}

const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function lado(dias: string[], gastos: GastoAnuncioDia[], resultados: DiaResultado[]): Lado {
  const conj = new Set(dias);
  const porAnuncio = new Map<string, number>();
  for (const g of gastos) if (conj.has(g.dia)) porAnuncio.set(g.ad_id, (porAnuncio.get(g.ad_id) ?? 0) + g.gasto);
  const r = resultados.filter((x) => conj.has(x.dia));
  const gasto = r.reduce((s, x) => s + x.gasto, 0);
  const totalAnuncios = [...porAnuncio.values()].reduce((s, v) => s + v, 0);
  return {
    dias: r.filter((x) => x.gasto > 0).length,
    gasto,
    leads: r.reduce((s, x) => s + x.leads, 0),
    fatias: [...porAnuncio]
      .map(([adId, v]) => ({ adId, fatia: totalAnuncios ? v / totalAnuncios : 0 }))
      .filter((f) => f.fatia > 0)
      .sort((a, b) => b.fatia - a.fatia),
  };
}

/**
 * Até 3 dias completos antes e depois do dia do marco (o próprio dia fica de fora: metade de cada lado).
 * `hoje` não conta como completo.
 */
export function efeitoDoMarco(marco: Marco, gastos: GastoAnuncioDia[], resultados: DiaResultado[], hoje: string, janela = 3): Efeito {
  const antesDias = Array.from({ length: janela }, (_, i) => somaDias(marco.dia, -(i + 1)));
  const depoisDias = Array.from({ length: janela }, (_, i) => somaDias(marco.dia, i + 1)).filter((d) => d < hoje);
  const antes = lado(antesDias, gastos, resultados);
  const depois = lado(depoisDias, gastos, resultados);
  const fatia = (l: Lado, id: string) => l.fatias.find((f) => f.adId === id)?.fatia ?? 0;
  const ids = new Set([...antes.fatias, ...depois.fatias].map((f) => f.adId).filter((id) => id !== marco.adId));
  const deltas = [...ids].map((id) => ({ adId: id, de: fatia(antes, id), para: fatia(depois, id) }));
  const ganhou = deltas.filter((d) => d.para > d.de).sort((a, b) => b.para - b.de - (a.para - a.de))[0] ?? null;
  const perdeu = deltas.filter((d) => d.para < d.de).sort((a, b) => a.para - a.de - (b.para - b.de))[0] ?? null;
  return { antes, depois, ganhou, perdeu };
}
