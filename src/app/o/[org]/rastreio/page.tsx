import type { Metadata } from "next";
import { Copiavel, Formulario } from "@/components/Formulario";
import { Aviso, Cartao, Etiqueta, Tabela, Titulo, Vazio, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { iniciarVerificacao, relerAnuncios, verificarAgora } from "@/lib/rastreio/acoes";
import { avaliarDestino, avaliarParametros, PARAMETROS_META, type ResultadoCampo } from "@/lib/rastreio/regras";
import { VerificarLinks } from "./VerificarLinks";

export const metadata: Metadata = { title: "Rastreio" };

const TOM_STATUS: Record<string, Tom> = { ok: "ok", alerta: "alerta", erro: "erro" };
const ROTULO_STATUS: Record<string, string> = { ok: "OK", alerta: "Atenção", erro: "Sem rastreio" };
const VEICULACAO: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  PENDING_REVIEW: "Em análise",
  IN_PROCESS: "Processando",
  WITH_ISSUES: "Com problemas",
  DISAPPROVED: "Reprovado",
  PREAPPROVED: "Pré-aprovado",
  EXPIRED: "Concluído",
};

export default async function Rastreio({ params }: PageProps<"/o/[org]/rastreio">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const gestor = temPapel(papel, "gestor");
  const [{ data: anuncios }, { data: verificacoes }, { data: checkout }] = await Promise.all([
    supabase
      .from("meta_anuncios")
      .select("ad_id, nome, campaign_name, adset_name, status, url_tags, destinos, atualizado_em")
      .eq("organizacao_id", org.id)
      .not("status", "in", "(ARCHIVED,DELETED,EXPIRED)")
      .order("campaign_name")
      .order("nome"),
    supabase.from("verificacoes_rastreio").select("*").eq("organizacao_id", org.id).order("criado_em", { ascending: false }).limit(5),
    supabase.from("conexoes").select("id").eq("organizacao_id", org.id).in("tipo", ["hotmart", "kiwify"]).limit(1),
  ]);
  const avaliados = (anuncios ?? []).map((a) => {
    const p = avaliarParametros(a.url_tags, { checkout: !!checkout?.length });
    const destino = avaliarDestino((a.destinos as string[]) ?? []);
    const problemas = destino ? [...p.problemas, destino] : p.problemas;
    const status = destino && p.status === "ok" ? "alerta" : p.status;
    return { ...a, status_rastreio: status, problemas };
  });
  const comErro = avaliados.filter((a) => a.status_rastreio === "erro" && ["ACTIVE", "PENDING_REVIEW", "PREAPPROVED", "IN_PROCESS"].includes(a.status ?? ""));
  const atual = verificacoes?.[0];
  const hidden = <input type="hidden" name="organizacao_id" value={org.id} />;

  return (
    <>
      <Titulo sobrancelha="Rastreio" descricao="A campanha precisa nascer rastreada: o lead que não chega com o anúncio de origem não tem como ser recuperado depois.">
        Cada clique precisa chegar com a origem
      </Titulo>
      <div className="grid gap-6">
        <Cartao titulo="1. Parâmetros de URL" descricao="Cole em cada anúncio, no campo “Parâmetros de URL” (seção Destino → Rastreamento). A Meta preenche os valores sozinha.">
          <Copiavel valor={PARAMETROS_META} />
          <p className="mt-3 text-sm text-ink-2">
            O sistema atribui pelos IDs (<code>utm_ad_id</code>, <code>utm_campaign_id</code>), nunca pelos nomes, que mudam e se repetem. Dica: configure no nível do anúncio e
            duplique a partir dele.
          </p>
        </Cartao>

        <Cartao
          titulo="2. Anúncios"
          rente
          descricao="Todos os anúncios fora de arquivados e concluídos, inclusive os que ainda não gastaram."
          acoes={
            gestor && (
              <Formulario acao={relerAnuncios} rotulo="Reler na Meta agora" variante="secundario">
                {hidden}
              </Formulario>
            )
          }
        >
          {comErro.length > 0 && (
            <Aviso tom="erro" className="mx-5 mb-4">
              {comErro.length} anúncio(s) ativo(s) ou em análise sem rastreio. Corrija antes de a campanha rodar.
            </Aviso>
          )}
          {avaliados.length ? (
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
                {avaliados.map((a) => (
                  <tr key={a.ad_id}>
                    <td>
                      <div className="font-medium text-ink">{a.nome}</div>
                      <div className="text-xs text-ink-3">
                        {a.campaign_name} › {a.adset_name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{VEICULACAO[a.status ?? ""] ?? a.status}</td>
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
              <Vazio titulo="Nenhum anúncio lido ainda">Conecte a Meta em Configurações e clique em “Reler na Meta agora”.</Vazio>
            </div>
          )}
          <div className="border-t border-line p-5">
            <VerificarLinks orgId={org.id} />
          </div>
        </Cartao>

        {org.funil === "venda_direta" ? (
          <Cartao titulo="3. Conferir de ponta a ponta" descricao="Na venda direta não há cadastro antes da compra: a conferência é feita pela própria compra.">
            <p className="text-sm text-ink-2">
              Com a plataforma em modo de teste (Configurações), abra o checkout com <code>?sck=</code> e o ID de um anúncio e faça uma compra. O evento aparece em Configurações
              com o anúncio que foi entendido.
            </p>
          </Cartao>
        ) : (
          <Cartao
            titulo="3. Teste de ponta a ponta"
            descricao="Simula um clique no anúncio e confere se o lead chega ao sistema com os IDs certos."
            acoes={
              gestor && (
                <Formulario acao={iniciarVerificacao} rotulo="Novo teste" variante={atual ? "secundario" : "primario"}>
                  {hidden}
                </Formulario>
              )
            }
          >
            {atual ? (
              <div className="flex flex-col gap-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta tom={atual.status === "ok" ? "ok" : atual.status === "problema" ? "erro" : "alerta"}>
                    {atual.status === "ok" ? "Ponta a ponta OK" : atual.status === "problema" ? "Com problema" : "Aguardando o lead de teste"}
                  </Etiqueta>
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
                {gestor && (
                  <Formulario acao={verificarAgora} rotulo="Verificar agora">
                    {hidden}
                    <input type="hidden" name="id" value={atual.id} />
                  </Formulario>
                )}
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
              <Vazio titulo="Nenhum teste ainda">Depois de configurar os anúncios, crie um teste: leva uns 3 minutos.</Vazio>
            )}
          </Cartao>
        )}
      </div>
    </>
  );
}
