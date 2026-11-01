"use client";

import { useState, type FormEvent } from "react";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { destinoSeguro } from "@/lib/rotas";
import { Aviso, Botao, Campo } from "@/components/ui";

// Entrar com e-mail e senha, ou receber um link de acesso por e-mail. Não há cadastro aberto: contas
// novas nascem de um convite.
export function FormEntrar({ next, erroInicial }: { next?: string; erroInicial?: string }) {
  const [modo, setModo] = useState<"senha" | "link">("senha");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(erroInicial ?? "");
  const [mensagem, setMensagem] = useState("");

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    const email = String(dados.get("email") ?? "").trim().toLowerCase();
    setEnviando(true);
    setErro("");
    setMensagem("");
    const supabase = criarClienteNavegador();
    const destino = destinoSeguro(next);
    if (modo === "senha") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: String(dados.get("senha") ?? "") });
      if (error) {
        setErro(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
        setEnviando(false);
        return;
      }
      window.location.assign(destino);
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destino)}` },
    });
    setEnviando(false);
    if (error) setErro("Não foi possível enviar o link. Confira o e-mail (ele precisa já ter uma conta).");
    else setMensagem("Enviamos um link de acesso para o seu e-mail.");
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div role="tablist" aria-label="Forma de entrar" className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
        {(["senha", "link"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`min-h-10 rounded-md text-sm font-medium transition-colors ${modo === m ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {m === "senha" ? "E-mail e senha" : "Link por e-mail"}
          </button>
        ))}
      </div>
      <Campo rotulo="E-mail" name="email" type="email" autoComplete="email" required />
      {modo === "senha" && <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />}
      <Botao type="submit" disabled={enviando} className="min-h-12">
        {enviando ? "Entrando…" : modo === "senha" ? "Entrar" : "Enviar link de acesso"}
      </Botao>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {mensagem && <Aviso tom="ok">{mensagem}</Aviso>}
    </form>
  );
}
