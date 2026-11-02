/* eslint-disable @next/next/no-img-element -- logos estáticos de public/marca */
import Link from "next/link";
import { AlternarTema } from "./AlternarTema";

/** Barra navy das páginas fora de uma organização (lista de organizações, administração). */
export function BarraSimples() {
  return (
    <header className="bg-chrome text-chrome-ink">
      <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-3 px-[clamp(16px,3vw,36px)] py-3">
        <Link href="/" aria-label="Adverdad: suas organizações">
          <img src="/marca/adverdad-logo-dark.png" alt="Adverdad" className="h-7 w-auto" />
        </Link>
        <div className="flex items-center gap-1">
          <AlternarTema />
          <form action="/sair" method="post">
            <button className="min-h-11 rounded-[14px] px-3 font-medium hover:bg-chrome-2">Sair</button>
          </form>
        </div>
      </div>
    </header>
  );
}
