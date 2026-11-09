"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ContextoAcoes } from "@/app/o/[org]/desempenho/carregar";
import { conferirRastreio, testarPagina, type ResultadoConferencia } from "@/lib/leitura/conferencias";
import type { Atalho } from "@/lib/leitura/modelo";
import { IconeCheck, IconeExclamacao, IconeExterno, IconeSeta, IconeX } from "./Icones";
import { Modal } from "./Modal";
import { Aviso, Botao, Esqueleto } from "./ui";

// Atalhos de uma sugestão: conferir na hora (a página do anúncio, o rastreio), ou ir direto ao lugar certo
// (gravações do Clarity, conectar o Clarity, criar anúncios novos, ver os cadastros). As conferências só leem.

const TITULO_CONFERENCIA = { testar_pagina: "Testar a página", conferir_rastreio: "Conferir o rastreio" } as const;
const classeLink =
  "inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-[550] text-ink no-underline hover:bg-surface-2 hover:no-underline";

function Conferencia({ tipo, ctx }: { tipo: keyof typeof TITULO_CONFERENCIA; ctx: ContextoAcoes }) {
  const [aberto, setAberto] = useState(false);
  const [resultado, setResultado] = useState<ResultadoConferencia | null>(null);
  const [rodando, iniciar] = useTransition();
  const rodar = () => {
    setResultado(null);
    iniciar(async () => setResultado(await (tipo === "testar_pagina" ? testarPagina : conferirRastreio)(ctx.orgId, ctx.campanha)));
  };
  return (
    <>
      <Botao
        type="button"
        variante="secundario"
        className="min-h-10 w-full"
        onClick={() => {
          setAberto(true);
          rodar();
        }}
      >
        {TITULO_CONFERENCIA[tipo]}
      </Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo={TITULO_CONFERENCIA[tipo]}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2">
            {tipo === "testar_pagina"
              ? "Abrimos a página como quem clica no anúncio, com os parâmetros reais, e conferimos se ela abre, quanto demora e se o pixel está lá."
              : "Conferimos se cada anúncio manda a origem no link e quantos cadastros recentes chegaram ao seu sistema com o anúncio."}
          </p>
          {rodando || !resultado ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Conferindo">
              <Esqueleto className="h-14" />
              <Esqueleto className="h-14" />
              <Esqueleto className="h-14" />
            </div>
          ) : "erro" in resultado ? (
            <Aviso tom="erro">{resultado.erro}</Aviso>
          ) : (
            <ul className="flex flex-col gap-2">
              {resultado.itens.map((i) => {
                const Icone = i.tom === "ok" ? IconeCheck : i.tom === "alerta" ? IconeExclamacao : IconeX;
                const cor = i.tom === "ok" ? "text-ok" : i.tom === "alerta" ? "text-warn" : "text-err";
                const caixa = i.tom === "ok" ? "border-ok-line bg-ok-soft" : i.tom === "alerta" ? "border-warn-line bg-warn-soft" : "border-err-line bg-err-soft";
                return (
                  <li key={i.titulo} className={`flex gap-2.5 rounded-md border px-3.5 py-3 ${caixa}`}>
                    <Icone tamanho={16} strokeWidth={2.4} className={`mt-0.5 shrink-0 ${cor}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-[600] text-ink">{i.titulo}</p>
                      {i.detalhe && <p className="mt-0.5 break-words text-sm text-ink-2">{i.detalhe}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Botao type="button" variante="secundario" onClick={rodar} disabled={rodando}>
              {rodando ? "Conferindo…" : "Conferir de novo"}
            </Botao>
            {tipo === "conferir_rastreio" && (
              <Link href={ctx.rotas.rastreio} className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-[550] text-accent-text">
                Teste completo em Rastreio <IconeSeta tamanho={14} />
              </Link>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

export function AtalhosSugestao({ atalhos, ctx }: { atalhos?: Atalho[]; ctx?: ContextoAcoes }) {
  if (!atalhos?.length || !ctx) return null;
  const clarity = ctx.projetoClarity ? `https://clarity.microsoft.com/projects/view/${ctx.projetoClarity}` : null;
  return (
    <div className="flex flex-col gap-2">
      {atalhos.map((a) => {
        if (a === "testar_pagina" || a === "conferir_rastreio") return <Conferencia key={a} tipo={a} ctx={ctx} />;
        if (a === "gravacoes_clarity")
          return clarity ? (
            <a key={a} href={`${clarity}/impressions`} target="_blank" rel="noreferrer" className={classeLink}>
              Ver gravações no Clarity <IconeExterno tamanho={14} />
            </a>
          ) : null;
        const interno = {
          conectar_clarity: { href: ctx.rotas.configuracoes, rotulo: "Conectar o Clarity" },
          nova_campanha: { href: ctx.rotas.campanhas, rotulo: "Criar anúncios novos" },
          ver_cadastros: { href: ctx.rotas.vendas, rotulo: "Ver os cadastros recentes" },
        }[a];
        return (
          <Link key={a} href={interno.href} className={classeLink}>
            {interno.rotulo} <IconeSeta tamanho={14} />
          </Link>
        );
      })}
    </div>
  );
}
