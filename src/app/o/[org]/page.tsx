import { IconeCheck, IconeSeta } from "@/components/Icones";
import { GradeAchados, ResumoLeitura } from "@/components/LeituraCampanha";
import { Aviso, BotaoLink, Etiqueta, Indicador, Indicadores, Titulo } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora, inteiro } from "@/lib/formato";
import { campanhasAtivas, carregarLeitura } from "@/lib/leitura/carregar";
import { lerFatos } from "@/lib/onboarding/fatos";
import { resumoEtapas, telaInicial, telas } from "@/lib/onboarding/modelo";
import { carregarRastreio } from "@/lib/rastreio/situacao";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";

// Início: a configuração é uma só, a do assistente. Cada etapa retoma onde parou; o que o sistema confere define o
// que falta. Abaixo, só o que muda depois de configurado: anúncios sem rastreio e o que está chegando.
export default async function InicioOrganizacao({ params }: PageProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const gestor = temPapel(papel, "gestor");
  const [{ data: sinc }, rastreio, { count: leads }, { count: vendas }] = await Promise.all([
    supabase
      .from("sincronizacoes")
      .select("terminado_em")
      .eq("organizacao_id", org.id)
      .eq("tipo", "meta")
      .eq("status", "ok")
      .order("terminado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    carregarRastreio(supabase, org.id),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).is("codigo_teste", null),
    supabase.from("vendas").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).eq("tipo", "pagamento"),
  ]);
  const fatos = await lerFatos(supabase, org.id, org.onboarding ?? {});
  const etapas = resumoEtapas(fatos);
  const prontas = etapas.filter((e) => e.feita).length;
  const faltam = etapas.length - prontas;
  const atual = etapas.find((e) => !e.feita);
  const comecou = !!org.onboarding?.plataforma;
  const retomar = telas(fatos).find((t) => t.id === telaInicial(fatos));
  const link = (tela: string) => rotaOrg(slug, `/configurar?tela=${tela}`);
  const comProblema = rastreio.campanhas.filter((c) => c.semRastreio > 0);
  const semRastreio = comProblema.reduce((t, c) => t + c.semRastreio, 0);
  // O que pede atenção nas campanhas no ar: os achados "agir" e "observar" da leitura de cada uma.
  const ativas = await campanhasAtivas(supabase, org);
  const leituras = await Promise.all(ativas.map(async (c) => ({ ...c, leitura: await carregarLeitura(supabase, org, c.id) })));
  const atencao = leituras
    .map((c) => ({ ...c, achados: c.leitura.achados.filter((a) => a.tom === "agir" || a.tom === "observar") }))
    .filter((c) => c.achados.length);

  return (
    <>
      <Titulo
        sobrancelha="Resumo"
        descricao={
          faltam
            ? `${faltam === 1 ? "Falta 1 etapa" : `Faltam ${faltam} etapas`}. O rastreio precisa estar certo antes de a campanha começar.`
            : "Tudo configurado: seus anúncios estão ligados às vendas."
        }
        acoes={
          <div className="flex flex-col items-end gap-2">
            <span className="text-sm font-semibold text-ink">
              <span className="num-display text-3xl">{prontas}</span> de {etapas.length} prontas
            </span>
            <div className="flex gap-1" aria-hidden="true">
              {etapas.map((e) => (
                <span key={e.etapa} className={`h-1.5 w-8 rounded-full ${e.feita ? "bg-ok" : "bg-line-strong"}`} />
              ))}
            </div>
          </div>
        }
      >
        {faltam ? "Pronto para a campanha?" : "Tudo pronto"}
      </Titulo>
      <div className="grid gap-5">
        {semRastreio > 0 && (
          <Aviso tom="erro">
            <strong>{inteiro(semRastreio)} anúncio(s) no ar ou em análise sem rastreio.</strong> Os cadastros e vendas deles chegam sem o anúncio de origem, e os números dessas
            campanhas ficam abaixo do real:
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {comProblema.map((c) => (
                <li key={c.campaignId}>
                  <a href={gestor ? rotaOrg(slug, `/rastreio/${c.campaignId}`) : rotaDesempenho(slug, c.campaignId)} className="font-medium">
                    {c.nome}
                  </a>{" "}
                  · {c.semRastreio} anúncio(s)
                </li>
              ))}
            </ul>
            {!gestor && <span className="mt-1.5 block">Avise quem gerencia as campanhas.</span>}
          </Aviso>
        )}
        {atencao.map((c) => (
          <section key={c.id} className="flex flex-col gap-4" aria-label={`O que pede atenção na campanha ${c.nome}`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <span className="sobrancelha">O que pede atenção</span>
                <h2 className="mt-1 text-lg font-[600] text-ink [overflow-wrap:anywhere]">{c.nome}</h2>
                {c.leitura.nota && <p className="mt-0.5 text-sm text-ink-3">{c.leitura.nota}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ResumoLeitura achados={c.leitura.achados} />
                <BotaoLink variante="secundario" href={rotaDesempenho(slug, c.id)}>
                  Ver a campanha
                  <IconeSeta tamanho={16} />
                </BotaoLink>
              </div>
            </div>
            <GradeAchados achados={c.achados} />
          </section>
        ))}
        {gestor && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <ol className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {etapas.map((e) => {
              const destaque = e === atual;
              return (
                <li key={e.etapa} className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4 first:border-t-0 ${destaque ? "bg-accent-soft" : ""}`}>
                  <span className={`num-display w-6 text-[28px] leading-none ${e.feita ? "text-line-strong" : "text-ink"}`}>{e.etapa}</span>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{e.nome}</span>
                      <Etiqueta tom={e.alerta ? "alerta" : e.feita ? "ok" : destaque ? "alerta" : "info"}>{e.alerta ? "Em teste" : e.feita ? "Feita" : "Falta"}</Etiqueta>
                    </div>
                    <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{e.alerta ?? e.detalhe}</p>
                  </div>
                  <BotaoLink href={link(e.tela)} variante={destaque ? "primario" : "secundario"} className="w-full sm:w-[140px]">
                    {e.feita ? "Rever" : destaque ? "Continuar" : "Abrir"}
                    <IconeSeta tamanho={16} />
                  </BotaoLink>
                </li>
              );
            })}
          </ol>
          <aside className="flex flex-col gap-4 rounded-lg bg-chrome p-6 text-chrome-ink">
            <span className="sobrancelha !text-chrome-ink-2">{atual ? (comecou ? "Continue de onde parou" : "Comece por aqui") : "Configuração"}</span>
            {atual ? (
              <>
                <p className="text-xl font-bold leading-tight tracking-[-0.01em]">Atribuição que não foi capturada não se recupera.</p>
                <p className="text-sm text-chrome-ink-2">
                  Se um anúncio roda sem parâmetros ou a venda não chega com a origem, aquele dinheiro fica sem resposta para sempre. Feche as etapas antes de ativar a campanha.
                </p>
                <p className="mt-2 text-sm text-chrome-ink-2">
                  Próximo: <strong className="font-semibold text-chrome-ink">{retomar?.titulo}</strong>
                </p>
                <BotaoLink href={rotaOrg(slug, "/configurar")} variante="peso">
                  {comecou ? "Continuar a configuração" : "Começar a configuração"}
                  <IconeSeta tamanho={16} />
                </BotaoLink>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-xl font-bold leading-tight tracking-[-0.01em]">
                  <IconeCheck tamanho={20} className="flex-none text-lime" /> Tudo conferido
                </p>
                <p className="text-sm text-chrome-ink-2">Se alguma conexão parar de funcionar, a etapa volta a aparecer aqui.</p>
                <BotaoLink href={rotaOrg(slug, "/desempenho")} variante="peso" className="mt-2">
                  Ver o Desempenho
                  <IconeSeta tamanho={16} />
                </BotaoLink>
              </>
            )}
          </aside>
        </div>
        )}
        <Indicadores className="grid-cols-1 sm:grid-cols-3">
          <Indicador rotulo="Leads" valor={inteiro(leads ?? 0)} detalhe="recebidos até agora" />
          <Indicador rotulo="Vendas" valor={inteiro(vendas ?? 0)} detalhe="pagas até agora" />
          <Indicador
            rotulo="Dados da Meta"
            valor={sinc ? "Em dia" : "—"}
            detalhe={sinc ? `Última leitura: ${dataHora(sinc.terminado_em, org.fuso)}` : "Primeira leitura ainda não feita"}
          />
        </Indicadores>
      </div>
    </>
  );
}
