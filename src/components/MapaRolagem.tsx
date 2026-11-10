import type { Aparelho, ExperienciaAparelho } from "@/lib/clarity/campanha";
import { decimal, inteiro, pct } from "@/lib/formato";

// Até onde as visitas descem: a página inteira como uma régua, do topo ao fim, e para cada altura uma barra
// com a fração das visitas que chegou até ali. Sem moldura de aparelho de propósito — a moldura fazia parecer
// que a porcentagem era da tela, e é da altura da página inteira (numa página longa, a primeira tela do
// celular é só o começo da régua).

export const NOME_APARELHO: Record<Aparelho, string> = { Mobile: "Celular", PC: "Computador", Tablet: "Tablet" };
const MINIMO_CONFIAVEL = 10;

export const segundos = (s: number | null) => (s === null ? "—" : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const altura = (i: number) => (i === 0 ? "Topo" : i === 10 ? "Fim" : `${i * 10}%`);

/** Captura da página inteira (teste de velocidade) e a altura da tela do celular, para situar a rolagem. */
export interface CapturaPagina {
  url: string;
  /** Altura da página inteira e da tela, em px (mesma largura). */
  altura: number;
  tela: number;
}

export function MapaRolagem({ aparelho, e, captura }: { aparelho: Aparelho; e: ExperienciaAparelho; captura?: CapturaPagina | null }) {
  const curva = e.curva;
  const pouco = e.baseCurva < MINIMO_CONFIAVEL;
  // Primeira altura em que menos da metade das visitas chegou.
  const metade = curva ? curva.findIndex((f) => f < 0.5) : -1;
  // Fração da página que a primeira tela do celular mostra (sem rolar).
  const primeiraTela = captura && captura.altura > captura.tela ? captura.tela / captura.altura : null;
  const linhaPrimeiraTela = primeiraTela ? Math.min(10, Math.max(1, Math.ceil(primeiraTela * 10))) : -1;

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-[600] text-ink">{NOME_APARELHO[aparelho]}</h3>
          <span className="text-sm text-ink-3">
            {inteiro(e.sessoes)} {e.sessoes === 1 ? "visita" : "visitas"}
          </span>
        </div>
        <p className="text-sm text-ink-2">Quantas visitas chegam a cada altura da página, do topo ao fim.</p>
      </header>

      {curva ? (
        <>
          <div className={captura ? `grid gap-5 ${aparelho === "PC" ? "sm:grid-cols-[minmax(0,1fr)_280px]" : "sm:grid-cols-[minmax(0,1fr)_168px]"}` : ""}>
          <ol className={`flex flex-col ${pouco ? "opacity-60" : ""}`} aria-label={`Rolagem no ${NOME_APARELHO[aparelho].toLowerCase()}`}>
            {curva.map((f, i) => (
              <li key={i} className="flex flex-col">
                {i === linhaPrimeiraTela && (
                  <div className="my-1 flex items-center gap-2" aria-hidden="true">
                    <span className="h-0 flex-1 border-t-2 border-dashed border-ink-3" />
                    <span className="text-xs font-[550] text-ink-2">fim da primeira tela ({pct(primeiraTela, 0)} da página)</span>
                  </div>
                )}
                {i === metade && i > 0 && (
                  <div className="my-1 flex items-center gap-2" aria-hidden="true">
                    <span className="h-0.5 flex-1 bg-err" />
                    <span className="text-xs font-[600] text-err">metade já saiu</span>
                  </div>
                )}
                <div
                  className="grid grid-cols-[3rem_1fr_2.75rem] items-center gap-3 py-[3px] text-xs"
                  title={`${i === 0 ? "Topo da página" : i === 10 ? "Fim da página" : `${i * 10}% da página`}: ${pct(f, 0)} das visitas chegaram (${inteiro(f * e.baseCurva)})`}
                >
                  <span className={`tabular-nums ${i === 0 || i === 10 ? "font-[550] text-ink-2" : "text-ink-3"}`}>{altura(i)}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(f * 100, f > 0 ? 1.5 : 0)}%` }} />
                  </span>
                  <span className="text-right font-[600] tabular-nums text-ink">{pct(f, 0)}</span>
                </div>
              </li>
            ))}
          </ol>
          {captura && <PaginaRolavel captura={captura} curva={curva} metade={metade} primeiraTela={primeiraTela} aparelho={NOME_APARELHO[aparelho].toLowerCase()} />}
          </div>
          <p className="text-sm text-ink-2">
            {metade > 0 ? (
              <>
                Metade das visitas foi embora antes de passar de <strong className="font-[600] text-ink">{metade * 10}% da altura da página</strong>
              </>
            ) : metade === -1 ? (
              <>Mais da metade das visitas chega ao fim da página</>
            ) : (
              <>Menos da metade passa do topo</>
            )}
            ; {pct(curva[9], 0)} chegam ao trecho final.{" "}
            {primeiraTela ? (
              <>
                A primeira tela do {NOME_APARELHO[aparelho].toLowerCase()} mostra só <strong className="font-[600] text-ink">{pct(primeiraTela, 0)} desta página</strong>: o que está abaixo disso, só vê quem rola.
              </>
            ) : (
              "As porcentagens são da página inteira, não da tela: numa página longa, a primeira tela do celular é só o começo da régua."
            )}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-3">Sem dado de rolagem para este aparelho.</p>
      )}
      {pouco && <p className="text-xs text-ink-3">Poucas visitas ({inteiro(e.baseCurva)}): ainda não dá para confiar no desenho.</p>}

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
          <dt className="text-xs text-ink-3">Voltaram logo para o anúncio</dt>
          <dd className="font-[600] tabular-nums text-ink">{pct(e.voltaRapida, 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Páginas vistas por visita</dt>
          <dd className="font-[600] tabular-nums text-ink">{e.paginasPorVisita === null ? "—" : decimal(e.paginasPorVisita, 1)}</dd>
        </div>
      </dl>
    </article>
  );
}

/**
 * A página inteira (captura do teste de velocidade) numa janela rolável, escurecida onde menos gente chega,
 * com a porcentagem de visitas a cada 10% da altura, o fim da primeira tela e onde metade já saiu.
 */
function PaginaRolavel({ captura, curva, metade, primeiraTela, aparelho }: { captura: CapturaPagina; curva: number[]; metade: number; primeiraTela: number | null; aparelho: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-xs text-ink-3">A página no {aparelho} (role para ver)</figcaption>
      <div className="relative h-[440px] overflow-y-auto overscroll-contain rounded-md border border-line-strong bg-sunken" tabIndex={0} aria-label="Captura da página inteira com a rolagem das visitas">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, com validade de 1 h */}
          <img src={captura.url} alt={`Página de destino inteira, como aparece no ${aparelho}`} className="block h-auto w-full" loading="lazy" />
          {curva.slice(0, 10).map((f, i) => (
            <div key={`sombra-${i}`} className="absolute inset-x-0" style={{ top: `${i * 10}%`, height: "10%", background: `rgb(15 23 42 / ${((1 - f) * 0.62).toFixed(2)})` }} aria-hidden="true" />
          ))}
          {curva.slice(1, 10).map((f, j) => (
            <div key={`faixa-${j}`} className="absolute inset-x-0 border-t border-white/60" style={{ top: `${(j + 1) * 10}%` }} aria-hidden="true">
              <span className="absolute right-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-[600] tabular-nums text-white">{pct(f, 0)} chegam</span>
            </div>
          ))}
          {primeiraTela && (
            <div className="absolute inset-x-0 border-t-2 border-dashed border-white" style={{ top: `${primeiraTela * 100}%` }} aria-hidden="true">
              <span className="absolute left-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-[600] text-white">fim da 1ª tela</span>
            </div>
          )}
          {metade > 0 && <div className="absolute inset-x-0 h-0.5 bg-err" style={{ top: `${metade * 10}%` }} aria-hidden="true" />}
        </div>
      </div>
    </figure>
  );
}

const COR_APARELHO: Record<Aparelho, string> = { Mobile: "var(--color-accent)", PC: "var(--color-ad-3)", Tablet: "var(--color-ad-6)" };

/** Barra única com a divisão das visitas por aparelho. */
export function VisitasPorAparelho({ porAparelho, empilhado }: { porAparelho: Partial<Record<Aparelho, ExperienciaAparelho>>; empilhado?: boolean }) {
  const itens = (Object.entries(porAparelho) as Array<[Aparelho, ExperienciaAparelho]>).filter(([, e]) => e.sessoes > 0).sort((a, b) => b[1].sessoes - a[1].sessoes);
  const total = itens.reduce((s, [, e]) => s + e.sessoes, 0);
  if (!total) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-card">
      <h3 className="text-sm font-[600] text-ink">Visitas por aparelho</h3>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={itens.map(([a, e]) => `${NOME_APARELHO[a]}: ${pct(e.sessoes / total, 0)}`).join(", ")}>
        {itens.map(([a, e]) => (
          <div key={a} style={{ width: `${(e.sessoes / total) * 100}%`, background: COR_APARELHO[a] }} title={`${NOME_APARELHO[a]}: ${inteiro(e.sessoes)} visitas`} />
        ))}
      </div>
      <ul className={empilhado ? "flex flex-col gap-2 text-sm" : "flex flex-wrap gap-x-6 gap-y-2 text-sm"}>
        {itens.map(([a, e]) => (
          <li key={a} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: COR_APARELHO[a] }} aria-hidden="true" />
            <span className="text-ink">{NOME_APARELHO[a]}</span>
            <span className="font-[650] tabular-nums text-ink">{pct(e.sessoes / total, 0)}</span>
            <span className="text-ink-3">({inteiro(e.sessoes)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
