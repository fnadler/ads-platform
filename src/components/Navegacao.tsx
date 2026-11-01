"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  IconeAdmin,
  IconeCampanhas,
  IconeConfiguracoes,
  IconeDesempenho,
  IconeInicio,
  IconeLeads,
  IconeRastreio,
  IconeSincronizar,
} from "./Icones";

const ICONES: Record<string, ComponentType<{ tamanho?: number }>> = {
  inicio: IconeInicio,
  desempenho: IconeDesempenho,
  campanhas: IconeCampanhas,
  rastreio: IconeRastreio,
  leads: IconeLeads,
  sincronizacoes: IconeSincronizar,
  configuracoes: IconeConfiguracoes,
  admin: IconeAdmin,
};

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone?: keyof typeof ICONES;
  exato?: boolean;
}

const ativoEm = (atual: string, i: ItemNavegacao) => (i.exato ? atual === i.href : atual === i.href || atual.startsWith(`${i.href}/`));

/** Menu lateral (desktop) ou abas em pílula que rolam na horizontal (mobile). */
export function Navegacao({ itens, modo = "lateral" }: { itens: ItemNavegacao[]; modo?: "lateral" | "abas" }) {
  const atual = usePathname();
  if (modo === "abas")
    return (
      <nav aria-label="Áreas da organização" className="flex gap-1 overflow-x-auto px-2 pb-2.5 [scrollbar-width:none]">
        {itens.map((i) => {
          const ativo = ativoEm(atual, i);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={ativo ? "page" : undefined}
              className={`flex min-h-10 flex-none items-center whitespace-nowrap rounded-[14px] px-3.5 text-[13.5px] no-underline ${
                ativo ? "bg-accent font-semibold text-on-accent" : "text-chrome-ink-2 hover:bg-chrome-2 hover:text-chrome-ink"
              }`}
            >
              {i.rotulo}
            </Link>
          );
        })}
      </nav>
    );
  return (
    <nav aria-label="Áreas da organização" className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {itens.map((i) => {
        const ativo = ativoEm(atual, i);
        const Icone = i.icone ? ICONES[i.icone] : null;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={ativo ? "page" : undefined}
            className={`flex min-h-[42px] items-center gap-3 rounded-[10px] px-3 text-base no-underline transition-colors ${
              ativo ? "bg-accent font-semibold text-on-accent" : "text-chrome-ink-2 hover:bg-chrome-2 hover:text-chrome-ink"
            }`}
          >
            {Icone && <Icone tamanho={18} />}
            {i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
