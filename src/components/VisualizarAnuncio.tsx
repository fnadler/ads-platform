"use client";

/* eslint-disable @next/next/no-img-element -- mídias vêm de URL assinada do Storage, que expira */
import { useState } from "react";
import { IconeAmpliar, IconePlay } from "./Icones";
import { Modal } from "./Modal";
import { MiniaturaCriativo } from "./ui";

// Miniatura do anúncio que abre a peça ampliada: o vídeo com play (ou a imagem em tamanho grande) ao lado
// do texto, do título e do botão do anúncio. Sem o arquivo original (anúncio criado fora da plataforma),
// mostra a miniatura que a Meta fornece.

export interface PecaAnuncio {
  nome: string;
  tipo: "video" | "imagem";
  /** Arquivo original enviado pelo assistente (URL assinada). */
  original?: string | null;
  miniatura?: string | null;
  titulo?: string | null;
  texto?: string | null;
  chamada?: string | null;
}

export function VisualizarAnuncio({ peca, cor, className = "w-16" }: { peca: PecaAnuncio; cor?: string; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const video = peca.tipo === "video" && !!peca.original;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Ver o anúncio ${peca.nome} ampliado`}
        className={`group relative shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
      >
        <MiniaturaCriativo src={peca.miniatura} cor={cor} className="w-full" />
        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-[rgb(6_13_43/0.25)] opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
          <span className="flex size-8 items-center justify-center rounded-full bg-surface/90 text-ink shadow-card">
            {video ? <IconePlay tamanho={14} /> : <IconeAmpliar tamanho={14} />}
          </span>
        </span>
      </button>

      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo={peca.nome} className="max-w-3xl">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)] sm:items-start">
          <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-lg border border-line bg-sunken">
            {video ? (
              <video src={peca.original ?? undefined} preload="metadata" controls autoPlay playsInline className="aspect-[9/16] w-full bg-black object-contain" />
            ) : peca.original || peca.miniatura ? (
              <img src={peca.original ?? peca.miniatura ?? undefined} alt={`Anúncio ${peca.nome}`} className="w-full object-contain" />
            ) : (
              <div className="flex aspect-[9/16] items-center justify-center p-6 text-center text-sm text-ink-3">Sem imagem deste anúncio.</div>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {peca.tipo === "video" && !peca.original && (
              <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
                Este vídeo não foi enviado pela plataforma, então só temos a capa que a Meta fornece. Para assistir, abra o anúncio no Gerenciador.
              </p>
            )}
            {peca.texto && (
              <div className="flex flex-col gap-1">
                <span className="sobrancelha">Texto</span>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{peca.texto}</p>
              </div>
            )}
            {peca.titulo && (
              <div className="flex flex-col gap-1">
                <span className="sobrancelha">Título</span>
                <p className="text-sm font-[600] text-ink">{peca.titulo}</p>
              </div>
            )}
            {peca.chamada && (
              <div className="flex flex-col items-start gap-1.5">
                <span className="sobrancelha">Botão</span>
                <span className="inline-flex min-h-9 items-center rounded-md border border-line-strong bg-surface-2 px-3.5 text-sm font-[550] text-ink">{peca.chamada}</span>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
