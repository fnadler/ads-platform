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
  IconePublicos,
  IconeRastreio,
  IconeSincronizar,
} from "./Icones";

const ICONES: Record<string, ComponentType<{ tamanho?: number }>> = {
  inicio: IconeInicio,
  desempenho: IconeDesempenho,
  campanhas: IconeCampanhas,
  publicos: IconePublicos,
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
  /** Outras rotas que contam como este item (ex.: Sincronizações dentro de Configurações). */
  tambem?: string[];
}

/** Bloco do menu: Analisar (resultados) ou Gerenciar (montar e manter). Sem título, fica solto no fim. */
export interface SecaoNavegacao {
  titulo?: string;
  itens: ItemNavegacao[];
}

const dentro = (atual: string, href: string) => atual === href || atual.startsWith(`${href}/`);
const ativoEm = (atual: string, i: ItemNavegacao) => (i.exato ? atual === i.href : dentro(atual, i.href)) || !!i.tambem?.some((t) => dentro(atual, t));

/** Menu lateral (desktop) ou abas em pílula que rolam na horizontal (mobile), separado em seções. */
export function Navegacao({ secoes, modo = "lateral" }: { secoes: SecaoNavegacao[]; modo?: "lateral" | "abas" }) {
  const atual = usePathname();
  if (modo === "abas")
    return (
      <nav aria-label="Áreas da organização" className="flex items-center gap-1 overflow-x-auto px-2 pb-2.5 [scrollbar-width:none]">
        {secoes.map((secao, n) => (
          <div key={secao.titulo ?? n} role="group" aria-label={secao.titulo} className={`flex flex-none items-center gap-1 ${n ? "ml-1.5 border-l border-chrome-2 pl-2" : ""}`}>
            {secao.titulo && <span className="px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-chrome-ink-2">{secao.titulo}</span>}
            {secao.itens.map((i) => {
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
          </div>
        ))}
      </nav>
    );
  return (
    <nav aria-label="Áreas da organização" className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {secoes.map((secao, n) => (
        <div key={secao.titulo ?? n} role="group" aria-labelledby={secao.titulo ? `secao-${n}` : undefined} className={`flex flex-col gap-0.5 ${secao.titulo ? "" : "mt-auto"}`}>
          {secao.titulo && (
            <span id={`secao-${n}`} className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-chrome-ink-2">
              {secao.titulo}
            </span>
          )}
          {secao.itens.map((i) => {
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
        </div>
      ))}
    </nav>
  );
}
