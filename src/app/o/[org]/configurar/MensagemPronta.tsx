"use client";

import { useState } from "react";
import { IconeCheck, IconeCopiar, IconeEnviar } from "@/components/Icones";
import { Botao } from "@/components/ui";

/** Instrução pronta para quem pode fazer o passo. Nunca leva segredos: quem recebe entra no próprio painel. */
export function MensagemPronta({ para, texto }: { para: string; texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <details className="group">
      <summary className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-[550] text-accent-text">
        <IconeEnviar tamanho={15} /> Enviar para {para}
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-sunken p-4">
        <p className="text-xs text-ink-2">Mensagem pronta, sem nenhum segredo. Copie e envie pelo canal que preferir.</p>
        <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{texto}</pre>
        <div>
          <Botao
            type="button"
            variante="secundario"
            onClick={() => {
              navigator.clipboard.writeText(texto);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1800);
            }}
          >
            {copiado ? <IconeCheck tamanho={16} className="text-ok" /> : <IconeCopiar tamanho={16} />}
            {copiado ? "Copiado" : "Copiar mensagem"}
          </Botao>
        </div>
      </div>
    </details>
  );
}
