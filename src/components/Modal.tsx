"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconeX } from "./Icones";

// Janela sobre a tela com o <dialog> nativo: foco preso, Esc fecha, o fundo escurece. Fecha também com um
// clique fora do conteúdo.

export function Modal({
  aberto,
  aoFechar,
  titulo,
  children,
  className = "max-w-xl",
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
      className={`m-auto w-[calc(100%-32px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-[rgb(6_13_43/0.6)] ${className}`}
    >
      {aberto && (
        <div className="flex max-h-[calc(100dvh-48px)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 text-base font-[600] leading-snug text-ink">{titulo}</div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <IconeX tamanho={18} />
            </button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
