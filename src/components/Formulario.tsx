"use client";

import { useActionState, useState, type ReactNode } from "react";
import { IconeCheck, IconeCopiar, IconeExclamacao } from "./Icones";
import { Aviso, Botao } from "./ui";

// Formulário ligado a uma server action que devolve { erro } ou { mensagem }. Mostra o resultado e
// trava o botão enquanto envia.
export type Resultado = { erro?: string; mensagem?: string; segredo?: string } | null;

export function Formulario({
  acao,
  children,
  rotulo,
  variante = "primario",
  className,
  confirmar,
  id,
}: {
  acao: (anterior: Resultado, dados: FormData) => Promise<Resultado>;
  children?: ReactNode;
  rotulo: string;
  variante?: "primario" | "secundario" | "perigo" | "peso" | "fantasma";
  className?: string;
  confirmar?: string;
  /** Para campos que ficam fora do formulário (atributo form), como numa linha de tabela. */
  id?: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, null);
  return (
    <form
      id={id}
      action={enviar}
      className={className ?? "flex flex-col gap-3"}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      {children}
      <div>
        <Botao type="submit" variante={variante} disabled={enviando}>
          {enviando ? "Enviando…" : rotulo}
        </Botao>
      </div>
      {estado?.erro && <Aviso tom="erro">{estado.erro}</Aviso>}
      {estado?.mensagem && <Aviso tom="ok">{estado.mensagem}</Aviso>}
      {estado?.segredo && <Segredo valor={estado.segredo} />}
    </form>
  );
}

/** Valor mostrado uma vez só (link de convite, token do webhook), com botão de copiar. */
export function Segredo({ valor, aviso = "Copie agora: não aparece de novo." }: { valor: string; aviso?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-warn-line bg-warn-soft p-3.5">
      <span className="flex items-center gap-1.5 text-sm font-[550] text-warn">
        <IconeExclamacao tamanho={15} strokeWidth={2.4} />
        {aviso}
      </span>
      <Copiavel valor={valor} />
    </div>
  );
}

export function Copiavel({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex min-h-11 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-line bg-sunken px-3 font-mono text-xs text-ink">{valor}</code>
      <Botao
        type="button"
        variante="secundario"
        className="shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1800);
        }}
      >
        {copiado ? <IconeCheck tamanho={16} className="text-ok" /> : <IconeCopiar tamanho={16} />}
        {copiado ? "Copiado" : "Copiar"}
      </Botao>
    </div>
  );
}
