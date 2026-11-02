"use client";

import { useSyncExternalStore } from "react";
import { IconeLua, IconeSol } from "./Icones";

// Chave de tema: sol (claro) à esquerda, lua (escuro) à direita; o marcador fica sobre o tema ativo.
// Muda <html data-theme> e guarda em localStorage ("tema"). O script do layout raiz aplica o tema salvo antes
// da primeira pintura, e o visual segue o atributo só por CSS, então a chave já nasce na posição certa.
function observarTema(aviso: () => void) {
  const observador = new MutationObserver(aviso);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observador.disconnect();
}
const temaEscuro = () => document.documentElement.getAttribute("data-theme") === "dark";

export function AlternarTema({ className = "" }: { className?: string }) {
  const escuro = useSyncExternalStore(observarTema, temaEscuro, () => false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={escuro}
      aria-label="Tema escuro"
      title={escuro ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
      className={`group inline-flex min-h-11 flex-none items-center justify-center rounded-full ${className}`}
      onClick={() => {
        const novoEscuro = !temaEscuro();
        document.documentElement.setAttribute("data-theme", novoEscuro ? "dark" : "light");
        try {
          localStorage.setItem("tema", novoEscuro ? "escuro" : "claro");
        } catch {
          /* sem localStorage: vale só nesta página */
        }
      }}
    >
      <span className="relative grid h-8 w-[60px] grid-cols-2 items-center gap-1 rounded-full bg-chrome-2 p-1 ring-1 ring-chrome-ink/10 transition-shadow group-hover:ring-chrome-ink/30">
        <span className="absolute top-1 left-1 size-6 rounded-full bg-chrome-ink shadow-sm transition-transform duration-150 motion-reduce:transition-none dark:translate-x-7" />
        <IconeSol tamanho={14} className="relative justify-self-center text-chrome transition-colors dark:text-chrome-ink-2" />
        <IconeLua tamanho={14} className="relative justify-self-center text-chrome-ink-2 transition-colors dark:text-chrome" />
      </span>
    </button>
  );
}
