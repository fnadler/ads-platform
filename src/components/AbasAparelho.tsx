"use client";

import { useSyncExternalStore, type ReactNode } from "react";

// Alternância Celular / Computador. Os painéis já vêm prontos do servidor; a aba só esconde os outros.
// Abas do mesmo `grupo` andam juntas: trocar para Computador na velocidade troca também na rolagem.

const escolhas = new Map<string, string>();
const ouvintes = new Set<() => void>();
const inscrever = (f: () => void) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};
const escolher = (grupo: string, chave: string) => {
  escolhas.set(grupo, chave);
  ouvintes.forEach((f) => f());
};

export function AbasAparelho({ abas, grupo = "aparelho" }: { abas: Array<{ chave: string; rotulo: string; detalhe?: string; conteudo: ReactNode }>; grupo?: string }) {
  const inicial = abas[0]?.chave ?? "";
  const escolhida = useSyncExternalStore(
    inscrever,
    () => escolhas.get(grupo) ?? inicial,
    () => inicial,
  );
  const ativa = abas.some((a) => a.chave === escolhida) ? escolhida : inicial;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" aria-label="Aparelho" className="inline-flex self-start rounded-md border border-line-strong bg-surface-2 p-1">
        {abas.map((a) => (
          <button
            key={a.chave}
            type="button"
            role="tab"
            aria-selected={a.chave === ativa}
            onClick={() => escolher(grupo, a.chave)}
            className={`flex min-h-10 items-center gap-2 rounded px-4 text-sm font-[550] transition-colors ${a.chave === ativa ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {a.rotulo}
            {a.detalhe && <span className="text-xs font-normal text-ink-3">{a.detalhe}</span>}
          </button>
        ))}
      </div>
      {abas.map((a) => (
        <div key={a.chave} role="tabpanel" aria-label={a.rotulo} hidden={a.chave !== ativa} className="min-w-0">
          {a.conteudo}
        </div>
      ))}
    </div>
  );
}
