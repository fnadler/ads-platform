import Link from "next/link";
import type { ReactNode } from "react";
import { IconeSeta } from "@/components/Icones";
import { GradeAchados } from "@/components/LeituraCampanha";
import { SeletorPeriodo } from "@/components/SeletorPeriodo";
import { Aviso, BotaoLink, Cartao, Indicador, Indicadores, Titulo, Vazio } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora, inteiro, moeda, pct } from "@/lib/formato";
import { campanhasAtivas, carregarLeitura } from "@/lib/leitura/carregar";
import type { Achado } from "@/lib/leitura/modelo";
import { lerFatos } from "@/lib/onboarding/fatos";
import { resumoEtapas, telaInicial, telas } from "@/lib/onboarding/modelo";
import { comDias, intervalo, lerDias } from "@/lib/periodo";
import { carregarRastreio } from "@/lib/rastreio/situacao";
import { custoPorCadastro, custoPorVenda, melhorEPior, retorno, somarPeriodo, variacao, type CampanhaResumo, type Criterio } from "@/lib/resumo/modelo";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import type { Linha } from "./desempenho/soma";

// Analisar › Resumo: a visão de quem decide. Em frases e poucos números: quanto foi investido, quanto voltou,
// como foi em relação ao período anterior, qual campanha vai melhor e qual pede atenção, e no máximo três
// pontos para agir. O detalhe fica no Desempenho; a configuração, enquanto não termina, num cartão só.

/** "▲ 12%" / "▼ 8%" contra o período anterior; a cor diz se foi bom (para custo, cair é bom). */
function Variacao({ v, menorEMelhor, neutro, dias }: { v: number | null; menorEMelhor?: boolean; neutro?: boolean; dias: number }) {
  if (v === null || !Number.isFinite(v)) return <>sem base para comparar</>;
  if (Math.abs(v) < 0.005) return <>igual aos {dias} dias anteriores</>;
  const bom = neutro ? null : menorEMelhor ? v < 0 : v > 0;
  return (
    <span className={bom === null ? "" : bom ? "text-ok" : "text-err"}>
      {v > 0 ? "▲" : "▼"} {pct(Math.abs(v), 0)} <span className="text-ink-3">vs. {dias} dias anteriores</span>
    </span>
  );
}

const sobe = (v: number | null) => (v === null ? null : v > 0.005 ? "subiu" : v < -0.005 ? "caiu" : "ficou igual");

function FraseCampanha({ c, criterio, moedaOrg }: { c: CampanhaResumo; criterio: Criterio; moedaOrg: string }) {
  return criterio === "retorno" ? (
    <>
      {moeda(retorno(c.soma) ?? 0, moedaOrg)} de volta para cada R$ 1 · {inteiro(c.soma.vendas)} venda(s) com {moeda(c.soma.gasto, moedaOrg)} investidos
    </>
  ) : (
    <>
      {c.soma.leads ? `${moeda(custoPorCadastro(c.soma), moedaOrg)} por cadastro` : "nenhum cadastro"} · {inteiro(c.soma.leads)} cadastro(s) com {moeda(c.soma.gasto, moedaOrg)}{" "}
      investidos
    </>
  );
}

export default async function Resumo({ params, searchParams }: PageProps<"/o/[org]">) {
  const { org: slug } = await params;
  const dias = lerDias((await searchParams).dias);
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const gestor = temPapel(papel, "gestor");
  const p = intervalo(dias, org.fuso);
  const [{ data: sinc }, rastreio, { data: atual }, { data: anterior }, fatos, ativas] = await Promise.all([
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
    supabase.rpc("desempenho_anuncios", { p_org: org.id, p_de: p.de, p_ate: p.ate }),
    supabase.rpc("desempenho_anuncios", { p_org: org.id, p_de: p.deAnterior, p_ate: p.ateAnterior }),
    lerFatos(supabase, org.id, org.onboarding ?? {}),
    campanhasAtivas(supabase, org),
  ]);
  const agora = somarPeriodo((atual as Linha[]) ?? []);
  const antes = somarPeriodo((anterior as Linha[]) ?? []);
  const t = agora.total;
  const direta = org.funil === "venda_direta";
  const comparacao = melhorEPior(agora.campanhas, org.funil);
  const linkCampanha = (id: string) => comDias(rotaDesempenho(slug, id), dias);

  // Configuração: só enquanto falta etapa.
  const etapas = resumoEtapas(fatos);
  const prontas = etapas.filter((e) => e.feita).length;
  const faltam = etapas.length - prontas;
  const retomar = telas(fatos).find((x) => x.id === telaInicial(fatos));

  // Rastreio: quanto dá para confiar nos números.
  const comProblema = rastreio.campanhas.filter((c) => c.semRastreio > 0);
  const semRastreio = comProblema.reduce((s, c) => s + c.semRastreio, 0);

  // Até três pontos para agir, das campanhas no ar: "agir" antes de "observar".
  const leituras = await Promise.all(ativas.map(async (c) => ({ ...c, leitura: await carregarLeitura(supabase, org, c.id) })));
  const campanhaDoAchado = new Map<Achado, { id: string; nome: string }>();
  const pontos = leituras
    .flatMap((c) =>
      c.leitura.achados
        .filter((a) => a.tom === "agir" || a.tom === "observar")
        .map((original) => {
          // O mesmo achado pode aparecer em duas campanhas: o id ganha a campanha para não repetir.
          const a = { ...original, id: `${c.id}:${original.id}` };
          campanhaDoAchado.set(a, { id: c.id, nome: c.nome });
          return a;
        }),
    )
    .sort((a, b) => Number(b.tom === "agir") - Number(a.tom === "agir"))
    .slice(0, 3);

  // A frase principal e a comparação, em português simples.
  const r = retorno(t);
  let principal: ReactNode;
  if (!t.gasto) principal = <>Nenhum gasto em anúncios nos últimos {dias} dias.</>;
  else if (t.vendas)
    principal = (
      <>
        Você investiu <strong>{moeda(t.gasto, org.moeda)}</strong> e recebeu <strong>{moeda(t.receita, org.moeda)}</strong> em vendas vindas dos anúncios:{" "}
        <strong>{moeda(r ?? 0, org.moeda)}</strong> de volta para cada R$ 1.
      </>
    );
  else if (!direta && t.leads)
    principal = (
      <>
        Você investiu <strong>{moeda(t.gasto, org.moeda)}</strong> e recebeu <strong>{inteiro(t.leads)} cadastro(s)</strong>, a{" "}
        <strong>{moeda(custoPorCadastro(t), org.moeda)}</strong> cada. Nenhuma venda confirmada ainda.
      </>
    );
  else
    principal = (
      <>
        Você investiu <strong>{moeda(t.gasto, org.moeda)}</strong> e ainda não há {direta ? "venda" : "cadastro"} que tenha chegado com o anúncio de origem.
      </>
    );
  const vRetorno = variacao(r, retorno(antes.total));
  const vCusto = variacao(t.vendas ? custoPorVenda(t) : custoPorCadastro(t), antes.total.vendas ? custoPorVenda(antes.total) : custoPorCadastro(antes.total));
  const comparativo =
    t.gasto && antes.total.gasto ? (
      t.vendas && antes.total.vendas ? (
        <>
          Comparado aos {dias} dias anteriores, o retorno {sobe(vRetorno)}
          {vRetorno !== null && Math.abs(vRetorno) >= 0.005 ? ` ${pct(Math.abs(vRetorno), 0)}` : ""} e o custo por venda {sobe(vCusto)}
          {vCusto !== null && Math.abs(vCusto) >= 0.005 ? ` ${pct(Math.abs(vCusto), 0)}` : ""}.
        </>
      ) : !direta && t.leads && antes.total.leads ? (
        <>
          Comparado aos {dias} dias anteriores, o custo por cadastro {sobe(vCusto)}
          {vCusto !== null && Math.abs(vCusto) >= 0.005 ? ` ${pct(Math.abs(vCusto), 0)}` : ""}.
        </>
      ) : null
    ) : null;

  return (
    <>
      <Titulo sobrancelha="Resumo" descricao={`Últimos ${dias} dias, comparados aos ${dias} dias anteriores.`} acoes={<SeletorPeriodo dias={dias} href={(d) => comDias(rotaOrg(slug), d)} />}>
        Como estão os anúncios
      </Titulo>
      <div className="grid gap-5">
        {faltam > 0 &&
          (gestor ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg bg-chrome p-5 text-chrome-ink">
              <div className="min-w-0 flex-1 basis-64">
                <span className="sobrancelha !text-chrome-ink-2">
                  Configuração · {prontas} de {etapas.length} etapas prontas
                </span>
                <p className="mt-1 font-semibold">
                  {faltam === 1 ? "Falta 1 etapa" : `Faltam ${faltam} etapas`} para os anúncios ficarem ligados às vendas.
                  {retomar && <span className="font-normal text-chrome-ink-2"> Próximo: {retomar.titulo}.</span>}
                </p>
              </div>
              <BotaoLink href={rotaOrg(slug, "/configurar")} variante="peso">
                Continuar a configuração
                <IconeSeta tamanho={16} />
              </BotaoLink>
            </div>
          ) : (
            <Aviso>A configuração ainda não terminou: os números abaixo podem estar incompletos.</Aviso>
          ))}

        {semRastreio > 0 && (
          <Aviso tom="erro">
            <strong>{inteiro(semRastreio)} anúncio(s) no ar ou em análise sem rastreio.</strong> Os cadastros e vendas deles chegam sem o anúncio de origem, e os números dessas
            campanhas ficam abaixo do real:
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {comProblema.map((c) => (
                <li key={c.campaignId}>
                  <Link href={gestor ? rotaOrg(slug, `/rastreio/${c.campaignId}`) : linkCampanha(c.campaignId)} className="font-medium">
                    {c.nome}
                  </Link>{" "}
                  · {c.semRastreio} anúncio(s)
                </li>
              ))}
            </ul>
            {!gestor && <span className="mt-1.5 block">Avise quem gerencia as campanhas.</span>}
          </Aviso>
        )}

        <section className="flex flex-col gap-2 rounded-lg bg-chrome p-6 text-chrome-ink" aria-label="Em uma frase">
          <p className="text-xl leading-snug tracking-[-0.01em] sm:text-2xl [&_strong]:font-bold">{principal}</p>
          {comparativo && <p className="text-chrome-ink-2">{comparativo}</p>}
        </section>

        {t.gasto > 0 && (
          <Indicadores className={`grid-cols-2 ${direta ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}>
            <Indicador rotulo="Investido" valor={moeda(t.gasto, org.moeda)} detalhe={<Variacao v={variacao(t.gasto, antes.total.gasto)} neutro dias={dias} />} />
            {!direta && <Indicador rotulo="Cadastros" valor={inteiro(t.leads)} detalhe={<Variacao v={variacao(t.leads, antes.total.leads)} dias={dias} />} />}
            <Indicador rotulo="Vendas" valor={inteiro(t.vendas)} detalhe={<Variacao v={variacao(t.vendas, antes.total.vendas)} dias={dias} />} />
            <Indicador rotulo="Recebido em vendas" valor={moeda(t.receita, org.moeda)} detalhe={<Variacao v={variacao(t.receita, antes.total.receita)} dias={dias} />} />
            <Indicador
              rotulo="Custo por venda"
              valor={moeda(custoPorVenda(t), org.moeda)}
              detalhe={<Variacao v={variacao(custoPorVenda(t), custoPorVenda(antes.total))} menorEMelhor dias={dias} />}
              destaque
            />
            <Indicador
              rotulo="De volta para cada R$ 1"
              valor={r === null ? "—" : moeda(r, org.moeda)}
              detalhe={r === null ? undefined : <Variacao v={vRetorno} dias={dias} />}
              destaque
            />
          </Indicadores>
        )}

        {comparacao && (
          <div className={`grid gap-5 ${comparacao.pior ? "md:grid-cols-2" : ""}`}>
            <Cartao titulo="Vai melhor" descricao={comparacao.criterio === "retorno" ? "A campanha com mais retorno no período." : "A campanha com o cadastro mais barato no período."}>
              <Link href={linkCampanha(comparacao.melhor.id)} className="text-lg font-semibold text-ink hover:text-accent-text [overflow-wrap:anywhere]">
                {comparacao.melhor.nome}
              </Link>
              <p className="mt-1 text-sm text-ink-2">
                <FraseCampanha c={comparacao.melhor} criterio={comparacao.criterio} moedaOrg={org.moeda} />
              </p>
            </Cartao>
            {comparacao.pior && (
              <Cartao
                titulo="Pede atenção"
                descricao={comparacao.criterio === "retorno" ? "A campanha com menos retorno no período." : "A campanha com o cadastro mais caro no período."}
              >
                <Link href={linkCampanha(comparacao.pior.id)} className="text-lg font-semibold text-ink hover:text-accent-text [overflow-wrap:anywhere]">
                  {comparacao.pior.nome}
                </Link>
                <p className="mt-1 text-sm text-ink-2">
                  <FraseCampanha c={comparacao.pior} criterio={comparacao.criterio} moedaOrg={org.moeda} />
                </p>
              </Cartao>
            )}
          </div>
        )}

        {pontos.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="O que fazer agora">
            <div>
              <span className="sobrancelha">O que fazer agora</span>
              <p className="mt-1 text-sm text-ink-3">Os pontos mais importantes das campanhas no ar. Os demais estão no Desempenho de cada campanha.</p>
            </div>
            <GradeAchados
              achados={pontos}
              extra={(a) => {
                const c = campanhaDoAchado.get(a);
                return c ? (
                  <Link href={linkCampanha(c.id)} className="text-sm font-medium text-accent-text [overflow-wrap:anywhere]">
                    {c.nome} →
                  </Link>
                ) : null;
              }}
            />
          </section>
        )}

        {!t.gasto && !faltam && (
          <Vazio titulo="Nada para resumir neste período" acao={<BotaoLink href={comDias(rotaOrg(slug), 30)} variante="secundario">Ver os últimos 30 dias</BotaoLink>}>
            Escolha um período maior, ou confira se a Meta já foi lida.
          </Vazio>
        )}

        <p className="text-xs text-ink-3">
          Números dos anúncios: cadastros e vendas que chegaram com o anúncio de origem.{" "}
          {sinc ? `Meta lida pela última vez em ${dataHora(sinc.terminado_em, org.fuso)}.` : "A Meta ainda não foi lida."}
        </p>
      </div>
    </>
  );
}
