"use client";

import { useActionState, type ReactNode } from "react";
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
}: {
  acao: (anterior: Resultado, dados: FormData) => Promise<Resultado>;
  children?: ReactNode;
  rotulo: string;
  variante?: "primario" | "secundario" | "perigo";
  className?: string;
  confirmar?: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, null);
  return (
    <form
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
export function Segredo({ valor, aviso = "Copie agora: por segurança, ele não aparece de novo." }: { valor: string; aviso?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Copiavel valor={valor} />
      <span className="text-xs text-suave">{aviso}</span>
    </div>
  );
}

export function Copiavel({ valor }: { valor: string }) {
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-borda bg-fundo px-3 py-2 font-mono text-xs">{valor}</code>
      <Botao type="button" variante="secundario" onClick={() => navigator.clipboard.writeText(valor)}>
        Copiar
      </Botao>
    </div>
  );
}
