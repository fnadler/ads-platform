import type { Metadata } from "next";
import { Formulario } from "@/components/Formulario";
import { Cartao, Etiqueta, Tabela, Titulo, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora, inteiro } from "@/lib/formato";
import { sincronizarConta } from "@/lib/jobs/acoes";

export const metadata: Metadata = { title: "Sincronizações" };

const STATUS: Record<string, { rotulo: string; tom: Tom }> = {
  na_fila: { rotulo: "Na fila", tom: "info" },
  rodando: { rotulo: "Rodando", tom: "alerta" },
  ok: { rotulo: "OK", tom: "ok" },
  erro: { rotulo: "Erro", tom: "erro" },
};
const MODO: Record<string, string> = { carga: "Histórico", incremental: "Automática", manual: "Manual" };

export default async function Sincronizacoes({ params }: PageProps<"/o/[org]/sincronizacoes">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const [{ data: contas }, { data: execucoes }] = await Promise.all([
    supabase.from("contas_anuncio").select("account_id, nome").eq("organizacao_id", org.id).eq("ativa", true),
    supabase.from("sincronizacoes").select("*").eq("organizacao_id", org.id).order("criado_em", { ascending: false }).limit(50),
  ]);
  const nomeConta = new Map((contas ?? []).map((c) => [c.account_id, c.nome]));

  return (
    <>
      <Titulo descricao="A Meta é atualizada sozinha às 6h, 12h e 18h (reescreve os últimos 7 dias, porque a Meta revisa conversões). As vendas do Stripe chegam na hora, pelo webhook.">
        Sincronizações
      </Titulo>
      <div className="grid gap-6">
        {temPapel(papel, "gestor") && !!contas?.length && (
          <Cartao titulo="Contas de anúncio">
            <div className="flex flex-col gap-3">
              {contas.map((c) => (
                <div key={c.account_id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{c.nome}</div>
                    <div className="font-mono text-xs text-suave">{c.account_id}</div>
                  </div>
                  <div className="flex gap-2">
                    {(["manual", "carga"] as const).map((modo) => (
                      <Formulario key={modo} acao={sincronizarConta} rotulo={modo === "manual" ? "Sincronizar agora" : "Recarregar histórico"} variante={modo === "manual" ? "primario" : "secundario"}>
                        <input type="hidden" name="organizacao_id" value={org.id} />
                        <input type="hidden" name="account_id" value={c.account_id} />
                        <input type="hidden" name="modo" value={modo} />
                      </Formulario>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Cartao>
        )}
        <Cartao titulo="Execuções">
          <Tabela>
            <thead>
              <tr>
                <th>Quando</th>
                <th>O quê</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Linhas</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {(execucoes ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{dataHora(e.criado_em, org.fuso)}</td>
                  <td>{e.tipo === "meta" ? `Meta · ${nomeConta.get(e.alvo) ?? e.alvo}` : "Stripe · histórico"}</td>
                  <td>{MODO[e.modo]}</td>
                  <td>
                    <Etiqueta tom={STATUS[e.status].tom}>{STATUS[e.status].rotulo}</Etiqueta>
                  </td>
                  <td>{inteiro(e.linhas)}</td>
                  <td className="max-w-md text-xs text-suave">
                    {e.erro ?? (e.terminado_em ? `terminou ${dataHora(e.terminado_em, org.fuso)}` : e.cursor?.campanha ? `até ${e.cursor.anuncio ?? e.cursor.campanha}` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          {!execucoes?.length && <p className="text-sm text-suave">Nenhuma sincronização ainda.</p>}
        </Cartao>
      </div>
    </>
  );
}
