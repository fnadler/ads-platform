import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copiavel, Formulario } from "@/components/Formulario";
import { IconeSeta, IconeVoltar } from "@/components/Icones";
import { Aviso, BotaoLink, Cartao, Etiqueta, Tabela, Titulo, Vazio, type Tom } from "@/components/ui";
import { exigirGestao } from "@/lib/auth/sessao";
import { ROTULO_VEICULACAO } from "@/lib/campanhas/veiculacao";
import { dataHora } from "@/lib/formato";
import { iniciarVerificacao, relerAnuncios, verificarAgora } from "@/lib/rastreio/acoes";
import { PARAMETROS_META, type ResultadoCampo } from "@/lib/rastreio/regras";
import { carregarRastreio, rotuloSaude } from "@/lib/rastreio/situacao";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import { ROTULO_TESTE } from "../teste";
import { VerificarLinks } from "../VerificarLinks";

export const metadata: Metadata = { title: "Rastreio da campanha" };

const TOM_STATUS: Record<string, Tom> = { ok: "ok", alerta: "alerta", erro: "erro" };
const ROTULO_STATUS: Record<string, string> = { ok: "OK", alerta: "Atenção", erro: "Sem rastreio" };

// Gerenciar › Rastreio › uma campanha: os anúncios dela com o que corrigir, as páginas de destino e o teste
// de ponta a ponta feito com um anúncio desta campanha.

export default async function RastreioCampanha({ params }: PageProps<"/o/[org]/rastreio/[campanha]">) {
  const { org: slug, campanha } = await params;
  if (!/^\d+$/.test(campanha)) notFound();
  const { org, supabase } = await exigirGestao(slug);
  const [{ anuncios, campanhas }, { data: verificacoes }] = await Promise.all([
    carregarRastreio(supabase, org.id, campanha),
    supabase.from("verificacoes_rastreio").select("*").eq("organizacao_id", org.id).eq("campaign_id", campanha).order("criado_em", { ascending: false }).limit(1),
  ]);
  const saude = campanhas[0];
  if (!saude) notFound();
  const comErro = anuncios.filter((a) => a.vivo && a.status_rastreio === "erro");
  const atual = verificacoes?.[0];
  const situacao = rotuloSaude(saude);
  const campos = (
    <>
      <input type="hidden" name="organizacao_id" value={org.id} />
      <input type="hidden" name="campanha" value={campanha} />
    </>
  );

  return (
    <>
      <Titulo
        sobrancelha={
          <Link href={rotaOrg(slug, "/rastreio")} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-text">
            <IconeVoltar tamanho={14} /> Rastreio
          </Link>
        }
        acoes={
          <div className="flex flex-wrap items-center gap-3">
            <Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>
            <BotaoLink variante="secundario" href={rotaOrg(slug, `/campanhas/${campanha}`)}>
              Gerenciar esta campanha
              <IconeSeta tamanho={16} />
            </BotaoLink>
            <BotaoLink variante="secundario" href={rotaDesempenho(slug, campanha)}>
              Ver desempenho
              <IconeSeta tamanho={16} />
            </BotaoLink>
          </div>
        }
      >
        {saude.nome}
      </Titulo>
      <div className="grid gap-6">
        <Cartao
          titulo="1. Anúncios"
          rente
          descricao="Os anúncios desta campanha fora de arquivados e concluídos, inclusive os que ainda não gastaram."
          acoes={
            <Formulario acao={relerAnuncios} rotulo="Reler na Meta agora" variante="secundario">
              <input type="hidden" name="organizacao_id" value={org.id} />
            </Formulario>
          }
        >
          {comErro.length > 0 && (
            <Aviso tom="erro" className="mx-5 mb-4">
              {comErro.length} anúncio(s) no ar ou em análise sem rastreio: os cadastros e vendas deles chegam sem o anúncio de origem. Corrija no Gerenciador de Anúncios,
              colando os parâmetros abaixo, e releia.
            </Aviso>
          )}
          {anuncios.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th>Veiculação</th>
                  <th>Rastreio</th>
                  <th>O que corrigir</th>
                </tr>
              </thead>
              <tbody>
                {anuncios.map((a) => (
                  <tr key={a.ad_id}>
                    <td>
                      <div className="font-medium text-ink">{a.nome}</div>
                      <div className="text-xs text-ink-3">{a.adset_name}</div>
                    </td>
                    <td className="whitespace-nowrap">{ROTULO_VEICULACAO[a.status ?? ""] ?? a.status}</td>
                    <td>
                      <Etiqueta tom={TOM_STATUS[a.status_rastreio]}>{ROTULO_STATUS[a.status_rastreio]}</Etiqueta>
                    </td>
                    <td className="text-xs">
                      {a.problemas.map((p) => (
                        <div key={p.texto} className={p.gravidade === "erro" ? "text-err" : "text-warn"}>
                          {p.texto}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          ) : (
            <div className="px-5 pb-5">
              <Vazio titulo="Nenhum anúncio ativo nesta campanha">Os arquivados e concluídos não aparecem aqui.</Vazio>
            </div>
          )}
          <div className="flex flex-col gap-4 border-t border-line p-5">
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-ink">Parâmetros de URL para colar nos anúncios</summary>
              <div className="mt-3 flex flex-col gap-2">
                <Copiavel valor={PARAMETROS_META} />
                <p className="text-ink-2">No anúncio, campo “Parâmetros de URL” (seção Destino → Rastreamento). A Meta preenche os valores sozinha.</p>
              </div>
            </details>
            <VerificarLinks orgId={org.id} campanha={campanha} />
          </div>
        </Cartao>

        {org.funil === "venda_direta" ? (
          <Cartao titulo="2. Conferir de ponta a ponta" descricao="Na venda direta não há cadastro antes da compra: a conferência é feita pela própria compra.">
            <p className="text-sm text-ink-2">
              Com a plataforma em modo de teste (Configurações), abra o checkout com <code>?sck=</code> e o ID de um anúncio desta campanha e faça uma compra. O evento aparece em
              Configurações com o anúncio que foi entendido.
            </p>
          </Cartao>
        ) : (
          <Cartao
            titulo="2. Teste de ponta a ponta"
            descricao="Simula um clique num anúncio desta campanha e confere se o cadastro chega ao sistema com os IDs certos."
            acoes={
              <Formulario acao={iniciarVerificacao} rotulo="Novo teste" variante={atual ? "secundario" : "primario"}>
                {campos}
              </Formulario>
            }
          >
            {atual ? (
              <div className="flex flex-col gap-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta tom={ROTULO_TESTE[atual.status]?.tom ?? "info"}>{ROTULO_TESTE[atual.status]?.rotulo ?? atual.status}</Etiqueta>
                  <span className="text-ink-2">
                    Anúncio “{(atual.esperado as { anuncio?: string }).anuncio}” · criado {dataHora(atual.criado_em, org.fuso)}
                    {atual.verificado_em && ` · verificado ${dataHora(atual.verificado_em, org.fuso)}`}
                  </span>
                </div>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Abra numa <strong>janela anônima</strong>:
                    <div className="mt-1">
                      <Copiavel valor={atual.url_teste} />
                    </div>
                  </li>
                  <li>
                    Faça o cadastro com um e-mail que tenha o código, por exemplo <code>seuemail+rastreio-{atual.codigo}@gmail.com</code> (ou o código no nome:{" "}
                    <code>Teste rastreio-{atual.codigo}</code>). Confirme o cadastro se o site pedir.
                  </li>
                  <li>Clique em “Verificar agora”.</li>
                </ol>
                <Formulario acao={verificarAgora} rotulo="Verificar agora">
                  <input type="hidden" name="organizacao_id" value={org.id} />
                  <input type="hidden" name="id" value={atual.id} />
                </Formulario>
                {atual.resultado && (
                  <Tabela>
                    <thead>
                      <tr>
                        <th>Campo</th>
                        <th>Esperado</th>
                        <th>Recebido</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(atual.resultado as ResultadoCampo[]).map((c) => (
                        <tr key={c.campo}>
                          <td className="font-mono text-xs">{c.campo}</td>
                          <td className="font-mono text-xs">{c.esperado}</td>
                          <td className="font-mono text-xs">{c.recebido ?? "—"}</td>
                          <td className="text-xs">{c.ok ? <Etiqueta tom="ok">OK</Etiqueta> : <span className={c.alerta ? "text-warn" : "text-err"}>{c.correcao}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabela>
                )}
              </div>
            ) : (
              <Vazio titulo="Nenhum teste nesta campanha ainda">Depois de configurar os anúncios, crie um teste: leva uns 3 minutos.</Vazio>
            )}
          </Cartao>
        )}
      </div>
    </>
  );
}
