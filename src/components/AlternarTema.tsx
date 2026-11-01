"use client";

import { IconeLua, IconeSol } from "./Icones";

// Alterna claro/escuro no <html data-theme> e guarda em localStorage ("tema"). O script do layout raiz
// aplica o tema salvo antes da primeira pintura; o ícone segue o atributo só por CSS (sem estado React).
export function AlternarTema({ className, comRotulo }: { className?: string; comRotulo?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Alternar tema claro/escuro"
      title="Alternar tema"
      className={className}
      onClick={() => {
        const escuro = document.documentElement.getAttribute("data-theme") === "dark";
        document.documentElement.setAttribute("data-theme", escuro ? "light" : "dark");
        try {
          localStorage.setItem("tema", escuro ? "claro" : "escuro");
        } catch {
          /* sem localStorage: vale só nesta página */
        }
      }}
    >
      <IconeLua className="dark:hidden" />
      <IconeSol className="hidden dark:block" />
      {comRotulo && (
        <>
          <span className="dark:hidden">Tema escuro</span>
          <span className="hidden dark:inline">Tema claro</span>
        </>
      )}
    </button>
  );
}
