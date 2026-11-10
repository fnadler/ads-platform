"use client";

import { useState, type ReactNode } from "react";
import type { Diagnostico } from "@/lib/pagespeed/diagnostico";
import { Chip } from "./LeituraCampanha";
import { Modal } from "./Modal";
import { Trilho } from "./Trilho";

// O que deixa a página lenta, em cartões lado a lado (como as sugestões das outras abas): estado, título, o
// ganho estimado e o que fazer. O porquê e os detalhes técnicos abrem numa janela, em "Ver detalhes".

const FRENTE: Record<Diagnostico["frente"], string> = { carregamento: "Carregamento", resposta: "Resposta ao toque", estabilidade: "Estabilidade" };
// "Vale corrigir" usa o amarelo (não é urgência da campanha); "melhoria menor", o tom neutro de destaque.
const ESTILO = {
  agir: { chip: "observar", rotulo: "Vale corrigir", borda: "border-t-warn" },
  observar: { chip: "aguardar", rotulo: "Melhoria menor", borda: "border-t-accent" },
} as const;

function Selo({ d }: { d: Diagnostico }) {
  return <Chip tom={ESTILO[d.tom].chip}>{ESTILO[d.tom].rotulo}</Chip>;
}

function Ganho({ d, grande }: { d: Diagnostico; grande?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {d.ganho && <span className={`font-[650] leading-tight tracking-[-0.02em] tabular-nums text-ink ${grande ? "text-3xl" : "text-2xl"}`}>{d.ganho}</span>}
      <span className="text-xs text-ink-2">{FRENTE[d.frente]}</span>
    </div>
  );
}

export function CarrosselVelocidade({ diagnosticos, titulo, extra }: { diagnosticos: Diagnostico[]; titulo: string; extra?: ReactNode }) {
  const [aberto, setAberto] = useState<Diagnostico | null>(null);
  const corrigir = diagnosticos.filter((d) => d.tom === "agir").length;
  return (
    <>
      <Trilho
        titulo={titulo}
        nota={corrigir ? `${corrigir} ${corrigir === 1 ? "vale corrigir" : "valem corrigir"}, do maior ganho para o menor` : "Só melhorias menores, do maior ganho para o menor"}
        extra={extra}
        rotulos={["Itens anteriores", "Próximos itens"]}
        quantidade={diagnosticos.length}
      >
        {diagnosticos.map((d) => (
          <article key={d.id} className={`flex w-[272px] shrink-0 snap-start flex-col gap-3 rounded-lg border border-t-[3px] border-line bg-surface p-4 shadow-card sm:w-[296px] ${ESTILO[d.tom].borda}`}>
            <div className="flex flex-col items-start gap-2">
              <Selo d={d} />
              <h3 className="line-clamp-3 text-sm font-[600] leading-snug text-ink">{d.titulo}</h3>
            </div>
            <Ganho d={d} />
            <p className="line-clamp-4 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-snug text-ink">
              <span className="font-[600]">O que fazer: </span>
              {d.acao}
            </p>
            <div className="mt-auto border-t border-line pt-2">
              <button type="button" onClick={() => setAberto(d)} className="flex min-h-10 items-center text-sm font-[550] text-accent-text hover:underline">
                Ver detalhes
              </button>
            </div>
          </article>
        ))}
      </Trilho>

      <Modal aberto={!!aberto} aoFechar={() => setAberto(null)} titulo={aberto?.titulo}>
        {aberto && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-4">
              <Selo d={aberto} />
              <Ganho d={aberto} grande />
            </div>
            <p className="text-sm leading-relaxed text-ink-2">{aberto.porque}</p>
            <p className="rounded-md bg-surface-2 px-4 py-3 text-sm leading-snug text-ink">
              <span className="font-[600]">O que fazer: </span>
              {aberto.acao}
            </p>
            {aberto.detalhes.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-[600] text-ink">Detalhes técnicos</h3>
                <ul className="flex flex-col gap-1 rounded-md bg-sunken p-3 font-mono text-xs break-all text-ink-2">
                  {aberto.detalhes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
