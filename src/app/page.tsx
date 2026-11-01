import Link from "next/link";
import { redirect } from "next/navigation";
import { BarraSimples } from "@/components/BarraSimples";
import { BotaoLink, Cartao, Titulo, Vazio } from "@/components/ui";
import { ehAdminPlataforma, exigirUsuario } from "@/lib/auth/sessao";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Início: com uma organização só, vai direto para ela; com várias, lista.
export default async function Inicio() {
  await exigirUsuario();
  const supabase = await criarClienteServidor();
  const [{ data: membros }, admin] = await Promise.all([
    supabase.from("membros").select("papel, organizacoes(nome, slug)").order("criado_em"),
    ehAdminPlataforma(),
  ]);
  const orgs = (membros ?? []).flatMap((m) => {
    const o = m.organizacoes as unknown as { nome: string; slug: string } | null;
    return o ? [{ ...o, papel: m.papel as string }] : [];
  });
  if (orgs.length === 1 && !admin) redirect(rotaOrg(orgs[0].slug));

  return (
    <>
      <BarraSimples />
      <main className="mx-auto w-full max-w-3xl px-[clamp(16px,3vw,36px)] py-8">
      <Titulo sobrancelha="Organizações" acoes={admin && <BotaoLink href="/admin" variante="secundario">Administração</BotaoLink>}>
        Suas organizações
      </Titulo>
      <Cartao rente>
        {orgs.length ? (
          <ul>
            {orgs.map((o) => (
              <li key={o.slug} className="border-t border-line first:border-t-0">
                <Link href={rotaOrg(o.slug)} className="flex min-h-14 items-center gap-3 px-5 py-3 text-ink no-underline hover:bg-surface-2 hover:no-underline">
                  <span className="grid size-9 place-items-center rounded-md bg-sunken text-xs font-bold">{o.nome.slice(0, 2).toUpperCase()}</span>
                  <span className="flex-1 font-semibold">{o.nome}</span>
                  <span className="text-sm capitalize text-ink-3">{o.papel}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <Vazio titulo="Nenhuma organização ainda">Peça um convite a quem administra a conta.</Vazio>
          </div>
        )}
      </Cartao>
      </main>
    </>
  );
}
