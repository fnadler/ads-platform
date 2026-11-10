"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconeChevron } from "./Icones";

// Trilho de cartões lado a lado com rolagem lateral (encaixe por cartão) e, no desktop, setas para avançar e
// voltar. Usado pelos carrosséis das sugestões e da velocidade da página.

export function Trilho({
  titulo,
  nota,
  extra,
  rotulos = ["Anteriores", "Próximos"],
  quantidade,
  nivel = 2,
  children,
}: {
  titulo: ReactNode;
  /** 2: título de seção (como os das outras partes da aba); 3: dentro de uma seção. */
  nivel?: 2 | 3;
  nota?: ReactNode;
  /** À direita do título, antes das setas (resumo, botões). */
  extra?: ReactNode;
  rotulos?: [string, string];
  /** Quantos cartões há (para remedir quando muda). */
  quantidade: number;
  children: ReactNode;
}) {
  const trilho = useRef<HTMLDivElement>(null);
  const [pode, setPode] = useState({ voltar: false, avancar: false });

  useEffect(() => {
    const t = trilho.current;
    if (!t) return;
    const medir = () => setPode({ voltar: t.scrollLeft > 4, avancar: t.scrollLeft + t.clientWidth < t.scrollWidth - 4 });
    medir();
    t.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      t.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [quantidade]);

  const rolar = (sentido: 1 | -1) => trilho.current?.scrollBy({ left: sentido * Math.max(trilho.current.clientWidth * 0.8, 280), behavior: "smooth" });

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={typeof titulo === "string" ? titulo : undefined}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {nivel === 2 ? <h2 className="text-xl font-[650] tracking-[-0.01em] text-ink">{titulo}</h2> : <h3 className="text-base font-[600] text-ink">{titulo}</h3>}
          {nota && <p className="mt-0.5 text-xs text-ink-3">{nota}</p>}
        </div>
        <div className="flex items-center gap-3">
          {extra}
          {(pode.voltar || pode.avancar) && (
            <div className="hidden gap-1 sm:flex">
              {([-1, 1] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => rolar(s)}
                  disabled={s === -1 ? !pode.voltar : !pode.avancar}
                  aria-label={s === -1 ? rotulos[0] : rotulos[1]}
                  className="flex size-10 items-center justify-center rounded-md border border-line-strong bg-surface text-ink hover:bg-surface-2 disabled:opacity-40"
                >
                  <IconeChevron tamanho={18} className={s === -1 ? "rotate-90" : "-rotate-90"} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div ref={trilho} className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {children}
      </div>
    </section>
  );
}
