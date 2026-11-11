import type { ReactNode } from "react";
import { GLOSSARIO, type IdTermo } from "@/lib/glossario";

// Nome de um indicador com o "?" ao lado: tocar ou clicar abre a explicação logo abaixo, no próprio lugar
// (details/summary, sem JavaScript). No lugar, e não num balão, porque as grades de números e as tabelas
// cortam o que passa da borda.

export function Termo({ id, children }: { id: IdTermo; children: ReactNode }) {
  return (
    <details className="group/termo normal-case tracking-normal">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
        {children}
        <span
          aria-hidden="true"
          className="grid size-4 flex-none place-items-center rounded-full border border-line-strong text-[10px] font-semibold leading-none text-ink-3 group-open/termo:border-accent group-open/termo:text-accent-text"
        >
          ?
        </span>
        <span className="sr-only">(o que é)</span>
      </summary>
      <p className="mt-1.5 max-w-72 whitespace-normal text-xs font-normal leading-snug text-ink-2">{GLOSSARIO[id]}</p>
    </details>
  );
}
