import type { ComponentType, ReactNode } from "react";
import { IconeCheck, IconeChevron, IconeExclamacao, IconeRelogio, IconeSeta, IconeX } from "@/components/Icones";
import type { Achado, Destaque, Leitura, Passo, TomAchado } from "@/lib/leitura/modelo";

// Leitura da campanha para quem não é do ramo. Cada cartão mostra só o essencial — o estado, um título
// simples, um número em destaque e o que fazer — e guarda a explicação em "Ver detalhes".

export const TOM: Record<TomAchado, { rotulo: string; resumo: (n: number) => string; faixa: string; chip: string; Icone: ComponentType<{ tamanho?: number; strokeWidth?: number }> }> = {
  agir: { rotulo: "Agir agora", resumo: (n) => `${n} para agir`, faixa: "bg-err", chip: "border-err-line bg-err-soft text-err", Icone: IconeX },
  observar: { rotulo: "Acompanhar", resumo: (n) => `${n} para acompanhar`, faixa: "bg-warn", chip: "border-warn-line bg-warn-soft text-warn", Icone: IconeExclamacao },
  aguardar: { rotulo: "Aguardar", resumo: (n) => `${n} aguardando dados`, faixa: "bg-accent", chip: "border-line bg-accent-soft text-accent-text", Icone: IconeRelogio },
  ok: { rotulo: "Tudo certo", resumo: (n) => `${n} tudo certo`, faixa: "bg-ok", chip: "border-ok-line bg-ok-soft text-ok", Icone: IconeCheck },
};

export function Chip({ tom, children }: { tom: TomAchado; children: ReactNode }) {
  const t = TOM[tom];
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-[600] ${t.chip}`}>
      <t.Icone tamanho={13} strokeWidth={2.4} />
      {children}
    </span>
  );
}

const corSentido = { pior: "text-err", melhor: "text-ok", neutro: "text-ink" } as const;

export function NumeroDestaque({ d }: { d: Destaque }) {
  const cor = corSentido[d.sentido ?? "neutro"];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {d.de && (
          <>
            <span className="text-xl font-[550] tabular-nums text-ink-3">{d.de}</span>
            <IconeSeta tamanho={18} className="translate-y-0.5 self-center text-ink-3" />
          </>
        )}
        <span className={`text-[32px] font-[650] leading-none tracking-[-0.025em] tabular-nums ${cor}`}>{d.para}</span>
      </div>
      {d.fracao !== undefined && (
        <div className="h-2 overflow-hidden rounded-full bg-sunken" role="presentation">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(d.fracao * 100)}%` }} />
        </div>
      )}
      <p className="text-sm leading-snug text-ink-2">{d.rotulo}</p>
    </div>
  );
}

/** O caminho do anúncio ao cadastro, etapa por etapa, com o peso de cada uma na mudança. */
export function Caminho({ passos }: { passos: Passo[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="sobrancelha mb-1">Onde os cadastros mudaram</span>
      <ol className="flex flex-col">
        {passos.map((p) => (
          <li key={p.rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0">
            <span className="text-sm text-ink">{p.rotulo}</span>
            <span className="whitespace-nowrap text-sm tabular-nums text-ink-2">
              {p.de} → <strong className={p.parte > 0 ? (p.piorou ? "text-err" : "text-ok") : "text-ink"}>{p.para}</strong>
            </span>
            <div className="col-span-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" role="presentation">
                {p.parte > 0 && <div className={`h-full rounded-full ${p.piorou ? "bg-err" : "bg-ok"}`} style={{ width: `${Math.max(Math.round(p.parte * 100), 4)}%` }} />}
              </div>
              <span className="whitespace-nowrap text-right text-xs text-ink-3">{p.parte > 0 ? `${Math.round(p.parte * 100)}% da mudança` : "não pesou"}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Cartão de um achado. `largo`: ocupa a linha toda (o que pede ação), com o essencial lado a lado. */
export function CartaoAchado({ achado, largo, extra }: { achado: Achado; largo?: boolean; extra?: ReactNode }) {
  const t = TOM[achado.tom];
  const temDetalhe = achado.detalhe || achado.passos?.length || achado.acaoDetalhe;
  return (
    <article className={`flex flex-col overflow-hidden rounded-lg border bg-surface shadow-card ${largo ? "border-err-line" : "border-line"}`}>
      {largo && <div className={`h-1 ${t.faixa}`} aria-hidden="true" />}
      <div className={`flex flex-1 flex-col gap-4 ${largo ? "p-5 sm:p-6" : "p-5"}`}>
        <div className={largo ? "grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end" : "flex flex-col gap-4"}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start gap-2.5">
              <Chip tom={achado.tom}>{t.rotulo}</Chip>
              <h3 className={`font-[600] leading-snug text-ink [text-wrap:balance] ${largo ? "text-lg" : "text-base"}`}>{achado.titulo}</h3>
            </div>
            {achado.destaque && <NumeroDestaque d={achado.destaque} />}
          </div>
          {achado.acao && (
            <p className={`rounded-md bg-surface-2 text-sm leading-snug text-ink ${largo ? "px-4 py-3.5 sm:text-base" : "px-3.5 py-2.5"}`}>
              <span className="font-[600]">O que fazer: </span>
              {achado.acao}
            </p>
          )}
        </div>
        {extra}
        {temDetalhe && (
          <details className="group border-t border-line pt-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-[550] text-accent-text [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Ver detalhes</span>
              <span className="hidden group-open:inline">Esconder detalhes</span>
              <IconeChevron tamanho={16} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className={`mt-2 gap-x-8 gap-y-4 ${largo && achado.passos?.length ? "grid lg:grid-cols-2" : "flex flex-col"}`}>
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-ink-2">{achado.detalhe}</p>
                {achado.acaoDetalhe && (
                  <p className="text-sm leading-relaxed text-ink">
                    <span className="font-[600]">Como fazer: </span>
                    {achado.acaoDetalhe}
                  </p>
                )}
              </div>
              {!!achado.passos?.length && <Caminho passos={achado.passos} />}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

/** Contagem por estado, na ordem de urgência. */
export function ResumoLeitura({ achados }: { achados: Achado[] }) {
  const tons = (["agir", "observar", "aguardar", "ok"] as const).map((tom) => [tom, achados.filter((a) => a.tom === tom).length] as const).filter(([, n]) => n);
  return (
    <div className="flex flex-wrap gap-2">
      {tons.map(([tom, n]) => (
        <Chip key={tom} tom={tom}>
          {TOM[tom].resumo(n)}
        </Chip>
      ))}
    </div>
  );
}

/**
 * O que pede ação ocupa a linha toda; o resto vai em colunas que crescem para baixo, para que abrir os
 * detalhes de um cartão não abra buracos ao lado (como numa grade de linhas).
 */
export function GradeAchados({ achados, extra }: { achados: Achado[]; extra?: (a: Achado) => ReactNode }) {
  const agir = achados.filter((a) => a.tom === "agir");
  const resto = achados.filter((a) => a.tom !== "agir");
  return (
    <div className="flex flex-col gap-4">
      {agir.map((a) => (
        <CartaoAchado key={a.id} achado={a} largo extra={extra?.(a)} />
      ))}
      {!!resto.length && (
        <div className="gap-4 sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {resto.map((a) => (
            <CartaoAchado key={a.id} achado={a} extra={extra?.(a)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LeituraCampanha({ leitura }: { leitura: Leitura }) {
  if (!leitura.achados.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="leitura-titulo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="leitura-titulo" className="text-lg font-[600] text-ink">
            Como está a campanha
          </h2>
          {leitura.nota && <p className="mt-0.5 text-sm text-ink-3">{leitura.nota}</p>}
        </div>
        <ResumoLeitura achados={leitura.achados} />
      </div>
      <GradeAchados achados={leitura.achados} />
    </section>
  );
}

const VEREDITO: Record<TomAchado, string> = { agir: "Precisa de ação", observar: "Pede atenção", aguardar: "Ainda é cedo", ok: "Funcionando" };

/**
 * O veredito de uma parte da campanha numa frase: o estado mais urgente entre os achados e o título do
 * primeiro deles. Sem achados, vale o texto padrão (nada fora do normal).
 */
export function Veredito({ achados, padrao, nota }: { achados: Achado[]; padrao: string; nota?: string | null }) {
  const [primeiro] = achados; // já vêm em ordem de urgência
  const tom: TomAchado = primeiro?.tom ?? "ok";
  const t = TOM[tom];
  const mesmos = achados.filter((a) => a.tom === tom).length;
  const titulo = primeiro && (tom !== "ok" || achados.length === 1) ? primeiro.titulo : padrao;
  return (
    <section className="flex overflow-hidden rounded-lg border border-line bg-surface shadow-card" aria-label="Veredito">
      <div className={`w-1.5 shrink-0 ${t.faixa}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Chip tom={tom}>{VEREDITO[tom]}</Chip>
          {nota && <span className="text-xs text-ink-3">{nota}</span>}
        </div>
        <p className="text-lg font-[600] leading-snug text-ink [text-wrap:balance] sm:text-xl">{titulo}</p>
        {(tom === "agir" || tom === "observar") && (
          <p className="text-sm text-ink-2">
            {primeiro.acao}
            {mesmos > 1 && ` E mais ${mesmos - 1} ${mesmos - 1 === 1 ? "ponto" : "pontos"} abaixo.`}
          </p>
        )}
      </div>
    </section>
  );
}
