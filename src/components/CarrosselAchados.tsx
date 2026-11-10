"use client";

import Link from "next/link";
import { useState } from "react";
import type { ContextoAcoes } from "@/app/o/[org]/desempenho/carregar";
import { BotaoAcao } from "./AcaoSugestao";
import { AtalhosSugestao } from "./AtalhosSugestao";
import { IconeSeta } from "./Icones";
import { Caminho, Chip, NumeroDestaque, ResumoLeitura, TOM } from "./LeituraCampanha";
import { Modal } from "./Modal";
import { Trilho } from "./Trilho";
import type { Achado, AreaAchado } from "@/lib/leitura/modelo";

// Sugestões da leitura em carrossel: cartões compactos (estado, título, o número e o que fazer), do mais
// urgente ao que está em dia. A explicação completa abre numa janela, em "Ver detalhes".

export type LinksArea = Partial<Record<AreaAchado, { href: string; rotulo: string }>>;

const BORDA = { agir: "border-t-err", observar: "border-t-warn", aguardar: "border-t-accent", ok: "border-t-ok" } as const;

function CartaoCompacto({ a, link, abrir, acoes }: { a: Achado; link?: { href: string; rotulo: string }; abrir: () => void; acoes?: ContextoAcoes }) {
  const corPara = a.destaque?.sentido === "pior" ? "text-err" : a.destaque?.sentido === "melhor" ? "text-ok" : "text-ink";
  return (
    <article className={`flex w-[272px] shrink-0 snap-start flex-col gap-3 rounded-lg border border-t-[3px] border-line bg-surface p-4 shadow-card sm:w-[296px] ${BORDA[a.tom]}`}>
      <div className="flex flex-col items-start gap-2">
        <Chip tom={a.tom}>{TOM[a.tom].rotulo}</Chip>
        <h3 className="line-clamp-3 text-sm font-[600] leading-snug text-ink">{a.titulo}</h3>
      </div>
      {a.destaque && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            {a.destaque.de && <span className="text-sm tabular-nums text-ink-3">{a.destaque.de} →</span>}
            <span className={`text-2xl font-[650] leading-tight tracking-[-0.02em] tabular-nums ${corPara}`}>{a.destaque.para}</span>
          </div>
          <span className="line-clamp-2 text-xs text-ink-2">{a.destaque.rotulo}</span>
        </div>
      )}
      {a.acao && (
        <p className="line-clamp-3 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-snug text-ink">
          <span className="font-[600]">O que fazer: </span>
          {a.acao}
        </p>
      )}
      <AcaoDoAchado a={a} acoes={acoes} />
      <AtalhosSugestao atalhos={a.atalhos} ctx={acoes} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 border-t border-line pt-2">
        <button type="button" onClick={abrir} className="flex min-h-10 items-center text-sm font-[550] text-accent-text hover:underline">
          Ver detalhes
        </button>
        {link && (
          <Link href={link.href} className="flex min-h-10 items-center gap-1 text-sm font-[550] text-ink-2 no-underline hover:text-ink hover:no-underline">
            {link.rotulo} <IconeSeta tamanho={14} />
          </Link>
        )}
      </div>
    </article>
  );
}

/** O botão que resolve a sugestão na Meta; sem permissão (ou campanha de fora), o motivo em uma linha. */
function AcaoDoAchado({ a, acoes }: { a: Achado; acoes?: ContextoAcoes }) {
  if (!a.acaoExecutavel || !acoes) return null;
  if (!acoes.podeAgir) return acoes.motivo ? <p className="text-xs text-ink-3">{acoes.motivo}</p> : null;
  return <BotaoAcao acao={a.acaoExecutavel} ctx={acoes} className="w-full" />;
}

export function CarrosselAchados({
  achados,
  titulo = "Sugestões",
  nota,
  links,
  acoes,
}: {
  achados: Achado[];
  titulo?: string;
  nota?: string | null;
  links?: LinksArea;
  acoes?: ContextoAcoes;
}) {
  const [aberto, setAberto] = useState<Achado | null>(null);
  const linkDe = (a: Achado) => (a.area === "geral" ? undefined : links?.[a.area]);

  return (
    <>
      <Trilho titulo={titulo} nota={nota} extra={<ResumoLeitura achados={achados} />} rotulos={["Sugestões anteriores", "Próximas sugestões"]} quantidade={achados.length}>
        {achados.map((a) => (
          <CartaoCompacto key={a.id} a={a} link={linkDe(a)} abrir={() => setAberto(a)} acoes={acoes} />
        ))}
      </Trilho>

      <Modal aberto={!!aberto} aoFechar={() => setAberto(null)} titulo={aberto?.titulo}>
        {aberto && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-4">
              <Chip tom={aberto.tom}>{TOM[aberto.tom].rotulo}</Chip>
              {aberto.destaque && <NumeroDestaque d={aberto.destaque} />}
            </div>
            {aberto.acao && (
              <p className="rounded-md bg-surface-2 px-4 py-3 text-sm leading-snug text-ink">
                <span className="font-[600]">O que fazer: </span>
                {aberto.acao}
              </p>
            )}
            <p className="text-sm leading-relaxed text-ink-2">{aberto.detalhe}</p>
            {aberto.acaoDetalhe && (
              <p className="text-sm leading-relaxed text-ink">
                <span className="font-[600]">Como fazer: </span>
                {aberto.acaoDetalhe}
              </p>
            )}
            {!!aberto.passos?.length && <Caminho passos={aberto.passos} />}
            <div className="flex flex-col gap-2 sm:max-w-xs">
              <AcaoDoAchado a={aberto} acoes={acoes} />
              <AtalhosSugestao atalhos={aberto.atalhos} ctx={acoes} />
            </div>
            {linkDe(aberto) && (
              <Link href={linkDe(aberto)!.href} onClick={() => setAberto(null)} className="inline-flex min-h-10 items-center gap-1 self-start text-sm font-[550] text-accent-text">
                {linkDe(aberto)!.rotulo} <IconeSeta tamanho={14} />
              </Link>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
