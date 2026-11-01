/* eslint-disable @next/next/no-img-element -- logos estáticos de public/marca */
import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { Aviso, Campo } from "@/components/ui";
import { ROTULO_PAPEL, usuarioAtual, type Papel } from "@/lib/auth/sessao";
import { aceitarConvite, criarContaPorConvite } from "@/lib/organizacoes/acoes";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Convite" };

export default async function Convite({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const supabase = await criarClienteServidor();
  const [{ data: convite }, usuario] = await Promise.all([
    supabase.rpc("ver_convite", { p_token: token }).maybeSingle<{ organizacao: string; email: string; papel: Papel; situacao: string }>(),
    usuarioAtual(),
  ]);

  let corpo: React.ReactNode;
  if (!convite) corpo = <Aviso tom="erro">Convite não encontrado. Confira o link.</Aviso>;
  else if (convite.situacao !== "valido")
    corpo = <Aviso tom="erro">Este convite {convite.situacao === "usado" ? "já foi usado" : "expirou"}. Peça um novo a quem convidou você.</Aviso>;
  else if (usuario && usuario.email.toLowerCase() === convite.email)
    corpo = (
      <Formulario acao={aceitarConvite} rotulo={`Entrar em ${convite.organizacao}`}>
        <input type="hidden" name="token" value={token} />
      </Formulario>
    );
  else if (usuario)
    corpo = (
      <Aviso tom="alerta">
        Você está conectado como {usuario.email}, mas o convite é para {convite.email}.{" "}
        <form action="/sair" method="post" className="inline">
          <button className="underline">Sair</button>
        </form>{" "}
        e abra o link de novo.
      </Aviso>
    );
  else
    corpo = (
      <div className="flex flex-col gap-4">
        <Formulario acao={criarContaPorConvite} rotulo="Criar conta e entrar">
          <input type="hidden" name="token" value={token} />
          <Campo rotulo="E-mail" value={convite.email} disabled readOnly />
          <Campo rotulo="Crie uma senha" name="senha" type="password" minLength={10} autoComplete="new-password" required ajuda="Pelo menos 10 caracteres." />
          <Campo rotulo="Repita a senha" name="confirmacao" type="password" minLength={10} autoComplete="new-password" required />
        </Formulario>
        <p className="text-sm text-ink-2">
          Já tem conta com este e-mail?{" "}
          <Link className="text-accent-text hover:underline" href={`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`}>
            Entre
          </Link>{" "}
          e volte a este link.
        </p>
      </div>
    );

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-bg p-6">
      <img src="/marca/adverdad-logo.png" alt="Adverdad" className="h-8 w-auto dark:hidden" />
      <img src="/marca/adverdad-logo-dark.png" alt="Adverdad" className="hidden h-8 w-auto dark:block" />
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7 shadow-card">
        <div className="sobrancelha mb-1.5">Convite</div>
        <h1 className="title-page text-2xl text-ink">{convite ? convite.organizacao : "Convite"}</h1>
        {convite && <p className="mb-6 mt-1.5 text-ink-2">Papel: {ROTULO_PAPEL[convite.papel]}</p>}
        {!convite && <div className="mb-4" />}
        {corpo}
      </div>
    </main>
  );
}
