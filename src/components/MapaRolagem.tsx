import type { Aparelho, ExperienciaAparelho } from "@/lib/clarity/campanha";
import { decimal, inteiro, pct } from "@/lib/formato";

// Mapa de rolagem: a página desenhada na moldura do aparelho, em 10 faixas de altura. A cor de cada faixa é
// a fração das visitas que chegou até ela (mais forte = mais gente viu). Ao lado, onde metade das pessoas
// já foi embora e quantas chegam ao fim.

const NOME: Record<Aparelho, string> = { Mobile: "Celular", PC: "Computador", Tablet: "Tablet" };
const MINIMO_CONFIAVEL = 10;

const segundos = (s: number | null) => (s === null ? "—" : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

export function MapaRolagem({ aparelho, e }: { aparelho: Aparelho; e: ExperienciaAparelho }) {
  const curva = e.curva;
  const pouco = e.baseCurva < MINIMO_CONFIAVEL;
  // Primeira faixa em que menos da metade das visitas chegou.
  const metade = curva ? curva.findIndex((f) => f < 0.5) : -1;
  const celular = aparelho !== "PC";
  const rotulos: Array<{ topo: number; texto: string; forte?: boolean }> = [];
  if (curva) {
    rotulos.push({ topo: 0, texto: "Topo: todos veem" });
    if (metade > 0) rotulos.push({ topo: metade * 10, texto: `Metade já saiu antes daqui (${metade * 10}% da página)`, forte: true });
    rotulos.push({ topo: 90, texto: `${pct(curva[9], 0)} chegam ao fim` });
  }

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-[600] text-ink">{NOME[aparelho]}</h3>
        <span className="text-sm text-ink-3">
          {inteiro(e.sessoes)} {e.sessoes === 1 ? "visita" : "visitas"}
        </span>
      </header>

      {curva ? (
        <div className={`flex gap-4 ${pouco ? "opacity-60" : ""}`}>
          <div
            className={`relative shrink-0 overflow-hidden border-line-strong bg-sunken ${celular ? "h-[300px] w-[140px] rounded-[22px] border-[5px]" : "h-[230px] w-[230px] rounded-md border-2 sm:w-[260px]"}`}
            role="img"
            aria-label={`Mapa de rolagem no ${NOME[aparelho].toLowerCase()}: ${curva.map((f, i) => `${i * 10}% da página, ${pct(f, 0)} das visitas`).join("; ")}`}
          >
            {!celular && <div className="h-4 border-b border-line bg-surface-2" aria-hidden="true" />}
            <div className={`relative flex flex-col ${celular ? "h-full" : "h-[calc(100%-16px)]"}`}>
              {metade > 0 && <div className="absolute inset-x-0 z-10 h-0.5 bg-err" style={{ top: `${metade * 10}%` }} aria-hidden="true" />}
              {curva.slice(0, 10).map((f, i) => (
                <div
                  key={i}
                  className="relative flex-1 border-b border-[rgb(255_255_255/0.08)] last:border-b-0"
                  style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round(12 + f * 80)}%, var(--color-sunken))` }}
                >
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-[600] tabular-nums ${f > 0.45 ? "text-on-accent" : "text-ink-2"}`}>
                    {pct(f, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <ul className="relative min-w-0 flex-1 text-xs" aria-hidden="true">
            {rotulos.map((r) => (
              <li
                key={r.texto}
                className={`absolute left-0 right-0 leading-snug ${r.forte ? "font-[600] text-err" : "text-ink-2"}`}
                style={{ top: celular ? `calc(${r.topo}% + 2px)` : `calc(18px + (100% - 16px) * ${r.topo / 100})` }}
              >
                {r.texto}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink-3">Sem dado de rolagem para este aparelho.</p>
      )}
      {pouco && <p className="text-xs text-ink-3">Poucas visitas ({inteiro(e.baseCurva)}): o mapa ainda não é confiável.</p>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
        <div>
          <dt className="text-xs text-ink-3">Até onde descem, em média</dt>
          <dd className="font-[600] tabular-nums text-ink">{e.rolagem === null ? "—" : `${decimal(e.rolagem, 0)}% da página`}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Tempo ativo por visita</dt>
          <dd className="font-[600] tabular-nums text-ink">{segundos(e.tempoAtivo)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Clicaram em algo que não respondeu</dt>
          <dd className="font-[600] tabular-nums text-ink">{pct(e.cliqueMorto, 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Voltaram logo para o anúncio</dt>
          <dd className="font-[600] tabular-nums text-ink">{pct(e.voltaRapida, 0)}</dd>
        </div>
      </dl>
    </article>
  );
}

const COR_APARELHO: Record<Aparelho, string> = { Mobile: "var(--color-accent)", PC: "var(--color-ad-3)", Tablet: "var(--color-ad-6)" };

/** Barra única com a divisão das visitas por aparelho. */
export function VisitasPorAparelho({ porAparelho }: { porAparelho: Partial<Record<Aparelho, ExperienciaAparelho>> }) {
  const itens = (Object.entries(porAparelho) as Array<[Aparelho, ExperienciaAparelho]>).filter(([, e]) => e.sessoes > 0).sort((a, b) => b[1].sessoes - a[1].sessoes);
  const total = itens.reduce((s, [, e]) => s + e.sessoes, 0);
  if (!total) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-card">
      <h3 className="text-sm font-[600] text-ink">Visitas por aparelho</h3>
      <div className="flex h-3 overflow-hidden rounded-full bg-sunken" role="img" aria-label={itens.map(([a, e]) => `${NOME[a]}: ${pct(e.sessoes / total, 0)}`).join(", ")}>
        {itens.map(([a, e]) => (
          <div key={a} style={{ width: `${(e.sessoes / total) * 100}%`, background: COR_APARELHO[a] }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {itens.map(([a, e]) => (
          <li key={a} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: COR_APARELHO[a] }} aria-hidden="true" />
            <span className="text-ink">{NOME[a]}</span>
            <span className="font-[650] tabular-nums text-ink">{pct(e.sessoes / total, 0)}</span>
            <span className="text-ink-3">({inteiro(e.sessoes)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
