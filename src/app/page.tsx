import Link from "next/link";
import { redirect } from "next/navigation";
import { BotaoLink, Cartao, Titulo } from "@/components/ui";
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
    <main className="mx-auto w-full max-w-3xl p-6">
      <Titulo acoes={admin && <BotaoLink href="/admin">Administração</BotaoLink>}>Suas organizações</Titulo>
      <Cartao>
        {orgs.length ? (
          <ul className="divide-y divide-borda">
            {orgs.map((o) => (
              <li key={o.slug}>
                <Link href={rotaOrg(o.slug)} className="flex items-center justify-between py-3 hover:text-marca">
                  <span className="font-medium">{o.nome}</span>
                  <span className="text-sm text-suave">{o.papel}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-suave">Você ainda não faz parte de nenhuma organização. Peça um convite a quem administra a conta.</p>
        )}
      </Cartao>
    </main>
  );
}
