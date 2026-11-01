/* eslint-disable @next/next/no-img-element -- logos estáticos de public/marca */
import Link from "next/link";
import { AlternarTema } from "@/components/AlternarTema";
import { IconeSair } from "@/components/Icones";
import { Navegacao, type ItemNavegacao } from "@/components/Navegacao";
import { ehAdminPlataforma, exigirOrganizacao, ROTULO_PAPEL } from "@/lib/auth/sessao";
import { rotaOrg } from "@/lib/rotas";

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

export default async function LayoutOrganizacao({ children, params }: LayoutProps<"/o/[org]">) {
  const { org: slug } = await params;
  const [{ org, papel, usuario }, admin] = await Promise.all([exigirOrganizacao(slug), ehAdminPlataforma()]);
  const r = (resto: string) => rotaOrg(org.slug, resto);
  const itens: ItemNavegacao[] = [
    { href: r(""), rotulo: "Início", icone: "inicio", exato: true },
    { href: r("/desempenho"), rotulo: "Desempenho", icone: "desempenho" },
    { href: r("/campanhas"), rotulo: "Campanhas", icone: "campanhas" },
    { href: r("/publicos"), rotulo: "Públicos", icone: "publicos" },
    { href: r("/rastreio"), rotulo: "Rastreio", icone: "rastreio" },
    { href: r("/vendas"), rotulo: "Leads e vendas", icone: "leads" },
    { href: r("/sincronizacoes"), rotulo: "Sincronizações", icone: "sincronizacoes" },
    { href: r("/configuracoes"), rotulo: "Configurações", icone: "configuracoes" },
    ...(admin ? [{ href: "/admin", rotulo: "Administração", icone: "admin" as const }] : []),
  ];
  // O cartão da organização leva à lista de organizações (troca de organização).
  const cartaoOrg = (compacto: boolean) => (
    <Link
      href="/"
      title="Trocar de organização"
      className={`flex items-center gap-2.5 bg-chrome-2 text-chrome-ink no-underline transition-colors hover:bg-[#1C3A94] hover:text-chrome-ink hover:no-underline ${
        compacto ? "min-h-11 min-w-0 flex-1 rounded-[14px] px-2.5 py-1" : "min-h-[52px] rounded-[18px] px-2.5 py-2"
      }`}
    >
      {!compacto && <span className="grid size-[34px] flex-none place-items-center rounded-[9px] bg-white text-xs font-bold text-navy">{iniciais(org.nome)}</span>}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-base font-semibold">{org.nome}</span>
        <span className="text-xs text-chrome-ink-2">{ROTULO_PAPEL[papel]}</span>
      </span>
      <span className="text-[11px] text-chrome-ink-2">▾</span>
    </Link>
  );

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-[22px] bg-chrome px-3.5 pb-4 pt-[22px] text-chrome-ink min-[960px]:flex">
        <img src="/marca/adverdad-logo-dark.png" alt="Adverdad" className="ml-2 h-[30px] w-auto self-start" />
        {cartaoOrg(false)}
        <Navegacao itens={itens} />
        <div className="flex flex-col gap-2 border-t border-chrome-2 pt-3.5">
          <span className="truncate px-1 text-xs text-chrome-ink-2">{usuario.email}</span>
          <div className="flex gap-1.5">
            <AlternarTema comRotulo className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[14px] bg-chrome-2 text-sm font-medium text-chrome-ink [&_svg]:size-4" />
            <form action="/sair" method="post" className="flex flex-1">
              <button className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[14px] text-sm font-medium text-chrome-ink hover:bg-chrome-2">
                <IconeSair tamanho={16} />
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 bg-chrome text-chrome-ink min-[960px]:hidden">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <img src="/marca/adverdad-mark-dark.png" alt="Adverdad" className="h-[26px] w-auto flex-none" />
            {cartaoOrg(true)}
            <AlternarTema className="grid size-11 flex-none place-items-center rounded-[14px] text-chrome-ink hover:bg-chrome-2" />
            <form action="/sair" method="post">
              <button className="min-h-11 px-2 font-medium text-chrome-ink">Sair</button>
            </form>
          </div>
          <Navegacao itens={itens} modo="abas" />
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-[clamp(16px,3vw,36px)] py-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
