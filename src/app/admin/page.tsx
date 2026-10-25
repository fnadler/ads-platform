import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/components/Formulario";
import { Campo, Cartao, Tabela, Titulo } from "@/components/ui";
import { ehAdminPlataforma, exigirUsuario } from "@/lib/auth/sessao";
import { criarOrganizacao } from "@/lib/organizacoes/acoes";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Administração" };

// Administração da plataforma: no piloto, só o administrador cria organizações (e entra como dono).
export default async function Admin() {
  await exigirUsuario();
  if (!(await ehAdminPlataforma())) notFound();
  const supabase = await criarClienteServidor();
  const { data: orgs } = await supabase.from("organizacoes").select("id, nome, slug, plano, criado_em").order("criado_em");

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <Titulo descricao="Crie a organização do cliente; você entra como dono e convida as pessoas dele.">Administração</Titulo>
      <div className="grid gap-6">
        <Cartao titulo="Nova organização">
          <Formulario acao={criarOrganizacao} rotulo="Criar organização" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Campo rotulo="Nome" name="nome" placeholder="GN Coleciona" required />
            <Campo rotulo="Endereço" name="slug" placeholder="gn-coleciona" pattern="[a-z0-9][a-z0-9\-]{1,39}" required ajuda="Aparece na URL: /o/gn-coleciona" />
          </Formulario>
        </Cartao>
        <Cartao titulo="Organizações">
          <Tabela>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Endereço</th>
                <th>Plano</th>
                <th>Criada em</th>
              </tr>
            </thead>
            <tbody>
              {(orgs ?? []).map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link className="font-medium hover:text-marca" href={rotaOrg(o.slug)}>
                      {o.nome}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{o.slug}</td>
                  <td>{o.plano}</td>
                  <td>{new Date(o.criado_em).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Cartao>
      </div>
    </main>
  );
}
