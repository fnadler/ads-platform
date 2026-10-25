"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  exato?: boolean;
}

export function Navegacao({ itens }: { itens: ItemNavegacao[] }) {
  const atual = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto text-sm">
      {itens.map((i) => {
        const ativo = i.exato ? atual === i.href : atual === i.href || atual.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${ativo ? "bg-fundo font-medium text-texto" : "text-suave hover:text-texto"}`}
          >
            {i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
