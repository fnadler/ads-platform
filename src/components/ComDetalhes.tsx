import type { ReactNode } from "react";

// Bloco com o interruptor "Ver detalhes": o essencial fica sempre visível, e o que é técnico (classe TECNICA nas
// colunas, ou o conteúdo de <SoComDetalhes>) aparece quando a pessoa liga. Sem JavaScript e sem guardar nada:
// ao voltar à tela, começa no essencial de novo.

export function ComDetalhes({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`group/detalhes ${className ?? ""}`}>{children}</div>;
}

export function InterruptorDetalhes({ rotulo = "Ver detalhes" }: { rotulo?: string }) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
      <input type="checkbox" data-detalhes className="peer sr-only" />
      <span aria-hidden="true" className="relative h-4 w-7 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-3 after:rounded-full after:bg-surface after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-3" />
      {rotulo}
    </label>
  );
}

/** Conteúdo que só aparece com "Ver detalhes" ligado. */
export function SoComDetalhes({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`hidden group-has-[[data-detalhes]:checked]/detalhes:block ${className ?? ""}`}>{children}</div>;
}
