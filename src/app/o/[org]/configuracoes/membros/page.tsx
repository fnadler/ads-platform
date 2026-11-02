import type { Metadata } from "next";
import { Formulario } from "@/components/Formulario";
import { Campo, Cartao, Selecao, Tabela, Titulo } from "@/components/ui";
import { exigirOrganizacao, ROTULO_PAPEL, type Papel } from "@/lib/auth/sessao";
import { alterarPapel, convidar, removerMembro, revogarConvite } from "@/lib/organizacoes/acoes";

export const metadata: Metadata = { title: "Membros" };

const DESCRICAO_PAPEL: Record<Papel, string> = {
  dono: "gerencia pessoas e conexões",
  gestor: "configura rastreio, sincroniza e importa vendas",
  leitura: "só vê",
};

export default async function Membros({ params }: PageProps<"/o/[org]/configuracoes/membros">) {
  const { org: slug } = await params;
  const { org, papel, usuario, supabase } = await exigirOrganizacao(slug);
  const ehDono = papel === "dono";
  const [{ data: membros }, { data: convites }] = await Promise.all([
    supabase.rpc("membros_da_organizacao", { p_org: org.id }),
    ehDono
      ? supabase.from("convites").select("id, email, papel, expira_em").eq("organizacao_id", org.id).is("aceito_em", null).order("criado_em", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <Titulo sobrancelha="Configurações" descricao="Quem acessa esta organização e com que papel.">
        Membros e convites
      </Titulo>
      <div className="grid gap-6">
        <Cartao titulo="Membros" rente>
          <Tabela>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Papel</th>
                {ehDono && <th />}
              </tr>
            </thead>
            <tbody>
              {(membros as Array<{ usuario_id: string; email: string; papel: Papel }> | null)?.map((m) => (
                <tr key={m.usuario_id}>
                  <td>
                    {m.email}
                    {m.usuario_id === usuario.id && <span className="text-ink-2"> (você)</span>}
                  </td>
                  <td>
                    {ehDono ? (
                      <Formulario acao={alterarPapel} rotulo="Salvar" variante="secundario" className="flex items-center gap-2">
                        <input type="hidden" name="organizacao_id" value={org.id} />
                        <input type="hidden" name="usuario_id" value={m.usuario_id} />
                        <select name="papel" defaultValue={m.papel} className="min-h-11 rounded-md border border-line-strong bg-surface px-3">
                          {(["dono", "gestor", "leitura"] as const).map((p) => (
                            <option key={p} value={p}>
                              {ROTULO_PAPEL[p]}
                            </option>
                          ))}
                        </select>
                      </Formulario>
                    ) : (
                      ROTULO_PAPEL[m.papel]
                    )}
                  </td>
                  {ehDono && (
                    <td className="text-right">
                      <Formulario acao={removerMembro} rotulo="Remover" variante="perigo" confirmar={`Remover ${m.email} da organização?`}>
                        <input type="hidden" name="organizacao_id" value={org.id} />
                        <input type="hidden" name="usuario_id" value={m.usuario_id} />
                      </Formulario>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Cartao>

        {ehDono && (
          <Cartao titulo="Convidar" descricao="O sistema gera um link (vale 7 dias) para você mandar à pessoa. Ela cria a senha ao abrir.">
            <Formulario acao={convidar} rotulo="Gerar convite" className="flex flex-col gap-4">
              <input type="hidden" name="organizacao_id" value={org.id} />
              <div className="grid items-start gap-4 sm:grid-cols-[1fr_200px]">
                <Campo rotulo="E-mail" name="email" type="email" required />
                <Selecao rotulo="Papel" name="papel" defaultValue="gestor">
                  {(["dono", "gestor", "leitura"] as const).map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL[p]}: {DESCRICAO_PAPEL[p]}
                    </option>
                  ))}
                </Selecao>
              </div>
            </Formulario>
            {!!convites?.length && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-medium">Convites pendentes</h3>
                <Tabela>
                  <tbody>
                    {convites.map((c) => (
                      <tr key={c.id}>
                        <td>{c.email}</td>
                        <td>{ROTULO_PAPEL[c.papel as Papel]}</td>
                        <td className="text-ink-2">{new Date(c.expira_em) < new Date() ? "expirado" : `até ${new Date(c.expira_em).toLocaleDateString("pt-BR")}`}</td>
                        <td className="text-right">
                          <Formulario acao={revogarConvite} rotulo="Revogar" variante="perigo">
                            <input type="hidden" name="organizacao_id" value={org.id} />
                            <input type="hidden" name="id" value={c.id} />
                          </Formulario>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              </div>
            )}
          </Cartao>
        )}
      </div>
    </>
  );
}
