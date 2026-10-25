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
        <p className="text-sm text-suave">
          Já tem conta com este e-mail?{" "}
          <Link className="text-marca hover:underline" href={`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`}>
            Entre
          </Link>{" "}
          e volte a este link.
        </p>
      </div>
    );

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-borda bg-superficie p-6">
        <h1 className="text-xl font-semibold">{convite ? `Convite para ${convite.organizacao}` : "Convite"}</h1>
        {convite && <p className="mb-5 mt-1 text-sm text-suave">Papel: {ROTULO_PAPEL[convite.papel]}</p>}
        {corpo}
      </div>
    </main>
  );
}
