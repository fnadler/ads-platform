import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { IconeExterno } from "@/components/Icones";
import { Aviso, Campo, Cartao, Etiqueta, Tabela, Titulo, Vazio } from "@/components/ui";
import { exigirGestao, temPapel } from "@/lib/auth/sessao";
import { linkGerenciador, listarCampanhas } from "@/lib/campanhas/lista";
import { dataHora } from "@/lib/formato";
import { criarRascunho } from "@/lib/publicacao/acoes";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";

export const metadata: Metadata = { title: "Campanhas" };

export default async function Campanhas({ params }: PageProps<"/o/[org]/campanhas">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirGestao(slug);
  const [campanhas, { data: config }, { data: conexao }] = await Promise.all([
    listarCampanhas(supabase, org.id),
    supabase.from("config_publicacao").select("page_id, pixel_id").eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("conexoes").select("status").eq("organizacao_id", org.id).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  const pronto = conexao?.status === "ativa" && !!config?.page_id && !!config.pixel_id;

  return (
    <>
      <Titulo sobrancelha="Campanhas" descricao="Todas as campanhas da conta: as montadas aqui e as criadas direto no Gerenciador da Meta. Ao montar aqui, o sistema cria tudo na Meta já com o rastreio certo, e tudo nasce pausado.">
        Monte aqui, nós criamos na Meta
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
            <Formulario acao={criarRascunho} rotulo="Nova campanha" variante="peso" className="flex flex-col gap-4">
              <input type="hidden" name="organizacao_id" value={org.id} />
              <input type="hidden" name="slug" value={slug} />
              <Campo rotulo="Nome da campanha" name="nome" placeholder="Ex.: Cadastro Loja | Ganchos A1 | Nov26" required />
            </Formulario>
          </Cartao>
        )}
        <Cartao titulo="Campanhas" rente>
          {campanhas.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Situação</th>
                  <th>Origem</th>
                  <th>
                    <span className="sr-only">Atalhos</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => {
                  const gerenciador = linkGerenciador(c.accountId, c.metaId);
                  return (
                    <tr key={c.assistenteId ?? c.metaId}>
                      <td>
                        <Link href={rotaOrg(slug, `/campanhas/${c.assistenteId ?? c.metaId}`)} className="font-medium text-ink hover:text-accent-text">
                          {c.nome}
                        </Link>
                        {c.criadaEm && <div className="text-xs text-ink-3">Criada em {dataHora(c.criadaEm, org.fuso)}</div>}
                      </td>
                      <td>
                        <Etiqueta tom={c.situacao.tom}>{c.situacao.rotulo}</Etiqueta>
                      </td>
                      <td className="whitespace-nowrap text-sm text-ink-2">{c.origem === "plataforma" ? "Montada aqui" : "Criada no Gerenciador"}</td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
                          {c.metaId && (
                            <Link href={rotaDesempenho(slug, c.metaId)} className="whitespace-nowrap font-medium text-accent-text">
                              Ver desempenho
                            </Link>
                          )}
                          {gerenciador && (
                            <a href={gerenciador} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-ink-2 hover:text-ink">
                              Gerenciador <IconeExterno tamanho={14} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          ) : (
            <div className="p-5">
              <Vazio titulo="Nenhuma campanha ainda">Dê um nome acima e clique em “Nova campanha”: o modelo Cadastro no site já vem preenchido.</Vazio>
            </div>
          )}
        </Cartao>
      </div>
    </>
  );
}
