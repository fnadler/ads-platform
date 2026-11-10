"use client";

import { useState, useTransition } from "react";
import { IconeCheck, IconeCopiar, IconeSincronizar } from "@/components/Icones";
import { Botao } from "@/components/ui";
import { testarVelocidade } from "@/lib/leitura/conferencias";

/** "Testar de novo" (põe o teste na fila) e "Copiar para quem cuida do site" (o relatório técnico). */
export function AcoesVelocidade({ orgId, campanha, texto, podeTestar }: { orgId: string; campanha: string; texto?: string; podeTestar: boolean }) {
  const [pendente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<{ mensagem: string } | { erro: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        {texto && (
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
            {copiado ? "Copiado" : "Copiar para quem cuida do site"}
          </Botao>
        )}
        {podeTestar && (
          <Botao type="button" variante="secundario" disabled={pendente || (!!resultado && "mensagem" in resultado)} onClick={() => iniciar(async () => setResultado(await testarVelocidade(orgId, campanha)))}>
            <IconeSincronizar tamanho={16} className={pendente ? "animate-spin" : undefined} />
            {texto ? "Testar de novo" : "Testar agora"}
          </Botao>
        )}
      </div>
      {resultado && (
        <p role="status" className={`max-w-sm text-right text-xs ${"erro" in resultado ? "text-err" : "text-ink-2"}`}>
          {"erro" in resultado ? resultado.erro : resultado.mensagem}
        </p>
      )}
    </div>
  );
}
