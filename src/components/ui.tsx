/* eslint-disable @next/next/no-img-element -- miniaturas vêm de URL assinada do Storage, que expira */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { IdTermo } from "@/lib/glossario";
import { IconeCheck, IconeCirculo, IconeExclamacao, IconeInfo, IconeX } from "./Icones";
import { Termo } from "./Termo";

// Peças de interface compartilhadas (Server Components; sem estado). Visual Adverdad: tokens em
// src/app/tokens.css (bg, surface, ink, line, accent, lime, ok/warn/err).

const juntar = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

const BOTAO = {
  primario: "bg-accent text-on-accent hover:bg-accent-hover",
  // Ação de peso (criar, ativar, próximo passo): lime da marca com texto navy.
  peso: "bg-lime text-lime-ink hover:brightness-95",
  secundario: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  fantasma: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  perigo: "border border-err-line bg-surface text-err hover:bg-err-soft",
} as const;
type VarianteBotao = keyof typeof BOTAO;

const baseBotao =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-[550] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Botao({ variante = "primario", className, ...p }: ComponentProps<"button"> & { variante?: VarianteBotao }) {
  return <button {...p} className={juntar(baseBotao, BOTAO[variante], className)} />;
}

export function BotaoLink({ variante = "primario", className, ...p }: ComponentProps<typeof Link> & { variante?: VarianteBotao }) {
  return <Link {...p} className={juntar(baseBotao, "no-underline", BOTAO[variante], className)} />;
}

const baseCampo =
  "min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink outline-none transition-colors focus:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:bg-sunken disabled:text-ink-3";

export function Campo({ rotulo, ajuda, className, ...p }: ComponentProps<"input"> & { rotulo: string; ajuda?: ReactNode }) {
  return (
    <label className={juntar("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-[550] text-ink">{rotulo}</span>
      <input {...p} className={juntar(baseCampo, p.type === "file" && "py-2")} />
      {ajuda && <span className="text-xs text-ink-3">{ajuda}</span>}
    </label>
  );
}

export function Selecao({ rotulo, className, children, ...p }: ComponentProps<"select"> & { rotulo: string }) {
  return (
    <label className={juntar("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-[550] text-ink">{rotulo}</span>
      <select {...p} className={baseCampo}>
        {children}
      </select>
    </label>
  );
}

/** Classes do textarea no padrão dos campos (o textarea fica no lugar de uso). */
export const classeAreaTexto = juntar(baseCampo, "py-2.5 leading-normal");

export function Cartao({
  titulo,
  descricao,
  acoes,
  children,
  className,
  rente,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Conteúdo encostado nas bordas (tabelas). */
  rente?: boolean;
}) {
  return (
    <section className={juntar("overflow-hidden rounded-lg border border-line bg-surface shadow-card", className)}>
      {(titulo || acoes) && (
        <header className={juntar("flex flex-wrap items-start justify-between gap-3 px-5 pt-5", rente ? "pb-4" : "pb-0")}>
          <div className="min-w-0">
            {titulo && <h2 className="text-lg font-[550] text-ink">{titulo}</h2>}
            {descricao && <p className="mt-1 max-w-3xl text-sm text-ink-2">{descricao}</p>}
          </div>
          {acoes}
        </header>
      )}
      <div className={rente ? "" : juntar("p-5", !!(titulo || acoes) && "pt-4")}>{children}</div>
    </section>
  );
}

const TOM = {
  ok: { caixa: "border-ok-line bg-ok-soft", cor: "text-ok", Icone: IconeCheck },
  alerta: { caixa: "border-warn-line bg-warn-soft", cor: "text-warn", Icone: IconeExclamacao },
  erro: { caixa: "border-err-line bg-err-soft", cor: "text-err", Icone: IconeX },
  info: { caixa: "border-line bg-surface-2", cor: "text-ink-2", Icone: IconeCirculo },
} as const;
export type Tom = keyof typeof TOM;

/** Bloco de mensagem: sempre com ícone (a cor nunca é o único sinal). */
export function Aviso({ tom = "info", children, className }: { tom?: Tom; children: ReactNode; className?: string }) {
  const t = TOM[tom];
  const Icone = tom === "info" ? IconeInfo : t.Icone;
  return (
    <div role={tom === "erro" ? "alert" : undefined} className={juntar("flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm text-ink", t.caixa, className)}>
      <Icone tamanho={16} className={juntar("mt-0.5 shrink-0", t.cor)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Etiqueta de estado: ícone + rótulo, na cor do estado. */
export function Etiqueta({ tom = "info", children }: { tom?: Tom; children: ReactNode }) {
  const t = TOM[tom];
  return (
    <span className={juntar("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium", t.caixa, t.cor)}>
      <t.Icone tamanho={12} strokeWidth={2.4} />
      {children}
    </span>
  );
}

export function Titulo({ children, descricao, acoes, sobrancelha }: { children: ReactNode; descricao?: ReactNode; acoes?: ReactNode; sobrancelha?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {sobrancelha && <div className="sobrancelha mb-1.5">{sobrancelha}</div>}
        <h1 className="title-page text-2xl text-ink sm:text-3xl">{children}</h1>
        {descricao && <p className="mt-2 max-w-3xl text-base text-ink-2">{descricao}</p>}
      </div>
      {acoes}
    </div>
  );
}

/** Tabela: cabeçalho surface-2, números à direita (classe num), linha com hover. */
export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_td]:align-middle [&_th]:bg-surface-2 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-ink-3 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-2">
        {children}
      </table>
    </div>
  );
}

/** Grade de indicadores (KPIs): células separadas por 1px de linha. */
export function Indicadores({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={juntar("grid gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card", className)}>
      {children}
    </div>
  );
}

export function Indicador({
  rotulo,
  valor,
  detalhe,
  destaque,
  explica,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  detalhe?: ReactNode;
  destaque?: boolean;
  /** Termo do glossário: mostra o "?" com a explicação ao lado do nome. */
  explica?: IdTermo;
}) {
  return (
    <div className={juntar("flex min-w-0 flex-col gap-1 p-4 sm:p-5", destaque ? "bg-accent-soft" : "bg-surface")}>
      <div className="text-sm text-ink-2">{explica ? <Termo id={explica}>{rotulo}</Termo> : rotulo}</div>
      <span className="num-display text-2xl text-ink sm:text-[28px] sm:leading-9">{valor}</span>
      {detalhe && <span className="text-xs text-ink-3">{detalhe}</span>}
    </div>
  );
}

/** Estado vazio: borda tracejada, título, texto e a próxima ação. */
export function Vazio({ titulo, children, acao }: { titulo: ReactNode; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong px-5 py-6">
      <p className="text-base font-[550] text-ink">{titulo}</p>
      {children && <div className="max-w-2xl text-sm text-ink-2">{children}</div>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden="true" className={juntar("shimmer rounded-md", className)} />;
}

/** Cor fixa do anúncio (ad-1…ad-6) pela posição estável dele na lista. */
export const corAnuncio = (indice: number) => `var(--color-ad-${(indice % 6) + 1})`;

/** Miniatura vertical 9:16 do criativo, com a faixa da cor do anúncio no topo. */
export function MiniaturaCriativo({ src, tipo = "imagem", cor, className, controles }: { src?: string | null; tipo?: "video" | "imagem"; cor?: string; className?: string; controles?: boolean }) {
  return (
    <div className={juntar("relative aspect-[9/16] shrink-0 overflow-hidden rounded-md border border-line bg-sunken", className)}>
      {src ? (
        tipo === "video" ? (
          <video src={src} className="h-full w-full object-cover" muted controls={controles} preload="metadata" />
        ) : (
          <img src={src} alt="" className="h-full w-full object-cover" />
        )
      ) : null}
      {cor && <span className="absolute inset-x-0 top-0 h-1" style={{ background: cor }} />}
    </div>
  );
}
