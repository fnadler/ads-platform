import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, Tabela, Titulo } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { criarRascunho } from "@/lib/publicacao/acoes";
import { rotaOrg } from "@/lib/rotas";
import { SITUACAO_CAMPANHA } from "./situacao";

export const metadata: Metadata = { title: "Campanhas" };

export default async function Campanhas({ params }: PageProps<"/o/[org]/campanhas">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const [{ data: campanhas }, { data: config }, { data: conexao }] = await Promise.all([
    supabase.from("campanhas_assistente").select("id, nome, status, criado_em, ativada_em").eq("organizacao_id", org.id).order("criado_em", { ascending: false }),
    supabase.from("config_publicacao").select("page_id, pixel_id").eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("conexoes").select("status").eq("organizacao_id", org.id).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  const pronto = conexao?.status === "ativa" && !!config?.page_id && !!config.pixel_id;

  return (
    <>
      <Titulo descricao="Monte a campanha aqui e o sistema cria tudo na Meta, já com o rastreio certo. Tudo nasce pausado: você confere no Gerenciador e ativa quando quiser.">
        Campanhas
      </Titulo>
      <div className="grid gap-6">
        {!pronto && (
          <Aviso tom="alerta">
            Antes da primeira campanha, conecte a <strong>Meta (publicação)</strong> e escolha Página e conjunto de dados em{" "}
            <Link href={rotaOrg(slug, "/configuracoes")} className="underline">
              Configurações
            </Link>
            .
          </Aviso>
        )}
        {temPapel(papel, "gestor") && (
          <Cartao titulo="Nova campanha" descricao="Modelo: Cadastro no site. O sistema fixa objetivo, destino, otimização, atribuição e Parâmetros de URL; você escolhe verba, datas, público e criativos.">
            <Formulario acao={criarRascunho} rotulo="Começar" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="organizacao_id" value={org.id} />
              <input type="hidden" name="slug" value={slug} />
              <Campo rotulo="Nome da campanha" name="nome" placeholder="Ex.: Cadastro Loja | Ganchos A1 | Nov26" required />
            </Formulario>
          </Cartao>
        )}
        <Cartao titulo="Campanhas do assistente">
          {campanhas?.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Situação</th>
                  <th>Criada em</th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={rotaOrg(slug, `/campanhas/${c.id}`)} className="font-medium hover:text-marca">
                        {c.nome}
                      </Link>
                    </td>
                    <td>
                      <Etiqueta tom={SITUACAO_CAMPANHA[c.status].tom}>{SITUACAO_CAMPANHA[c.status].rotulo}</Etiqueta>
                    </td>
                    <td>{dataHora(c.criado_em, org.fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          ) : (
            <p className="text-sm text-suave">Nenhuma campanha ainda.</p>
          )}
        </Cartao>
      </div>
    </>
  );
}
