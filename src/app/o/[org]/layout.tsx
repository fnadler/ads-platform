import Link from "next/link";
import { Navegacao } from "@/components/Navegacao";
import { exigirOrganizacao, ROTULO_PAPEL } from "@/lib/auth/sessao";
import { rotaOrg } from "@/lib/rotas";

export default async function LayoutOrganizacao({ children, params }: LayoutProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, papel, usuario } = await exigirOrganizacao(slug);
  const r = (resto: string) => rotaOrg(org.slug, resto);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6">
          <Link href="/" className="font-semibold">
            {org.nome}
          </Link>
          <div className="flex items-center gap-3 text-sm text-suave">
            <span>
              {usuario.email} · {ROTULO_PAPEL[papel]}
            </span>
            <form action="/sair" method="post">
              <button className="hover:text-texto">Sair</button>
            </form>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-2 py-2 sm:px-4">
          <Navegacao
            itens={[
              { href: r(""), rotulo: "Início", exato: true },
              { href: r("/desempenho"), rotulo: "Desempenho" },
              { href: r("/rastreio"), rotulo: "Rastreio" },
              { href: r("/vendas"), rotulo: "Leads e vendas" },
              { href: r("/sincronizacoes"), rotulo: "Sincronizações" },
              { href: r("/configuracoes"), rotulo: "Configurações" },
            ]}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
