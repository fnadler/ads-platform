"use client";

import { useState, type ReactNode } from "react";

// Alternância Celular / Computador. Os dois painéis já vêm prontos do servidor; a aba só esconde o outro.

export function AbasAparelho({ abas }: { abas: Array<{ chave: string; rotulo: string; detalhe?: string; conteudo: ReactNode }> }) {
  const [ativa, setAtiva] = useState(abas[0]?.chave);
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Aparelho" className="inline-flex self-start rounded-md border border-line-strong bg-surface-2 p-1">
        {abas.map((a) => (
          <button
            key={a.chave}
            type="button"
            role="tab"
            id={`aba-${a.chave}`}
            aria-selected={a.chave === ativa}
            aria-controls={`painel-${a.chave}`}
            onClick={() => setAtiva(a.chave)}
            className={`flex min-h-10 items-center gap-2 rounded px-4 text-sm font-[550] transition-colors ${a.chave === ativa ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {a.rotulo}
            {a.detalhe && <span className="text-xs font-normal text-ink-3">{a.detalhe}</span>}
          </button>
        ))}
      </div>
      {abas.map((a) => (
        <div key={a.chave} role="tabpanel" id={`painel-${a.chave}`} aria-labelledby={`aba-${a.chave}`} hidden={a.chave !== ativa}>
          {a.conteudo}
        </div>
      ))}
    </div>
  );
}
