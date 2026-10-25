import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Peças de interface compartilhadas (Server Components; sem estado).

const juntar = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

const BOTAO = {
  primario: "bg-marca text-marca-texto hover:opacity-90",
  secundario: "border border-borda bg-superficie hover:bg-fundo",
  perigo: "border border-erro/40 text-erro hover:bg-erro/10",
} as const;

export function Botao({ variante = "primario", className, ...p }: ComponentProps<"button"> & { variante?: keyof typeof BOTAO }) {
  return (
    <button
      {...p}
      className={juntar(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        BOTAO[variante],
        className,
      )}
    />
  );
}

export function BotaoLink({ variante = "primario", className, ...p }: ComponentProps<typeof Link> & { variante?: keyof typeof BOTAO }) {
  return (
    <Link
      {...p}
      className={juntar("inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition", BOTAO[variante], className)}
    />
  );
}

export function Campo({ rotulo, ajuda, className, ...p }: ComponentProps<"input"> & { rotulo: string; ajuda?: ReactNode }) {
  return (
    <label className={juntar("flex flex-col gap-1 text-sm", className)}>
      <span className="font-medium">{rotulo}</span>
      <input {...p} className="rounded-md border border-borda bg-superficie px-3 py-2 outline-none focus:border-marca" />
      {ajuda && <span className="text-xs text-suave">{ajuda}</span>}
    </label>
  );
}

export function Selecao({ rotulo, className, children, ...p }: ComponentProps<"select"> & { rotulo: string }) {
  return (
    <label className={juntar("flex flex-col gap-1 text-sm", className)}>
      <span className="font-medium">{rotulo}</span>
      <select {...p} className="rounded-md border border-borda bg-superficie px-3 py-2 outline-none focus:border-marca">
        {children}
      </select>
    </label>
  );
}

export function Cartao({ titulo, descricao, acoes, children, className }: { titulo?: ReactNode; descricao?: ReactNode; acoes?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={juntar("rounded-lg border border-borda bg-superficie p-5", className)}>
      {(titulo || acoes) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="text-base font-semibold">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-sm text-suave">{descricao}</p>}
          </div>
          {acoes}
        </header>
      )}
      {children}
    </section>
  );
}

const TOM = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  alerta: "border-alerta/30 bg-alerta/10 text-alerta",
  erro: "border-erro/30 bg-erro/10 text-erro",
  info: "border-borda bg-fundo text-texto",
} as const;
export type Tom = keyof typeof TOM;

export function Aviso({ tom = "info", children, className }: { tom?: Tom; children: ReactNode; className?: string }) {
  return <div className={juntar("rounded-md border px-3 py-2 text-sm", TOM[tom], className)}>{children}</div>;
}

export function Etiqueta({ tom = "info", children }: { tom?: Tom; children: ReactNode }) {
  return <span className={juntar("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TOM[tom])}>{children}</span>;
}

export function Titulo({ children, descricao, acoes }: { children: ReactNode; descricao?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-suave">{descricao}</p>}
      </div>
      {acoes}
    </div>
  );
}

export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm [&_td]:border-t [&_td]:border-borda [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-suave">
        {children}
      </table>
    </div>
  );
}
