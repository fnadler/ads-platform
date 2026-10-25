"use client";

import { useState, useTransition } from "react";
import { Botao, Etiqueta } from "@/components/ui";
import { verificarLinks, type SituacaoLink } from "@/lib/rastreio/acoes";

export function VerificarLinks({ orgId }: { orgId: string }) {
  const [links, setLinks] = useState<SituacaoLink[] | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Botao
          variante="secundario"
          disabled={pendente}
          onClick={() =>
            iniciar(async () => {
              setErro("");
              try {
                setLinks(await verificarLinks(orgId));
              } catch (e) {
                setErro((e as Error).message);
              }
            })
          }
        >
          {pendente ? "Abrindo as páginas…" : "Verificar páginas de destino"}
        </Botao>
      </div>
      {erro && <p className="text-sm text-erro">{erro}</p>}
      {links && !links.length && <p className="text-sm text-suave">Nenhuma página de destino nos anúncios.</p>}
      {links?.map((l) => (
        <div key={l.url} className="flex items-center gap-2 text-sm">
          <Etiqueta tom={l.status && l.status < 400 ? "ok" : "erro"}>{l.status ?? "falhou"}</Etiqueta>
          <span className="truncate">{l.url}</span>
          {(!l.status || l.status >= 400) && <span className="text-xs text-erro">Link quebrado: corrija o destino do anúncio. {l.erro}</span>}
        </div>
      ))}
    </div>
  );
}
