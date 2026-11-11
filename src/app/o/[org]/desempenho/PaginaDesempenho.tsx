import Link from "next/link";
import { GraficoAcumulado, type PontoComparacao } from "@/components/GraficoAcumulado";
import { SeletorPeriodo } from "@/components/SeletorPeriodo";
import { IconeSeta, IconeVoltar } from "@/components/Icones";
import { Aviso, BotaoLink, Cartao, Etiqueta, Indicador, Indicadores, Tabela, Titulo, Vazio } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { campanhaMontada } from "@/lib/campanhas/lista";
import { decimal, inicioDoDia, inteiro, moeda, pct, razao } from "@/lib/formato";
import { carregarLeitura } from "@/lib/leitura/carregar";
import { carregarRastreio } from "@/lib/rastreio/situacao";
import { comDias, diaNoFuso, lerDias } from "@/lib/periodo";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import { carregarLeadsVendas } from "@/lib/vendas/lista";
import { carregarContextoAcoes, carregarExperiencia, carregarPecas, carregarVelocidade } from "./carregar";
import { ABAS, DetalheCampanha, type Aba } from "./DetalheCampanha";
import { somar, zero, type Linha, type Soma } from "./soma";
import { celulasFunil as celulas, colunasFunil as colunas, destaque, roas, rotuloCancelados } from "./tabelas";

const dia = diaNoFuso;
const rotuloDia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    })
    .replace(".", "");

export type Busca = Record<string, string | string[] | undefined>;

/** Desempenho: a lista de campanhas (campanha = null) ou o detalhe de uma campanha da Meta. */
export async function PaginaDesempenho({ slug, busca, campanha }: { slug: string; busca: Busca; campanha: string | null }) {
  const dias = lerDias(busca.dias);
  const aba: Aba = ABAS.includes(busca.aba as Aba) ? (busca.aba as Aba) : "geral";
  const { org, supabase, papel } = await exigirOrganizacao(slug);
  const de = dia(dias - 1, org.fuso);
  const ate = dia(0, org.fuso);

  const [{ data: dados, error }, { data: serie }, leitura, rastreio] = await Promise.all([
    supabase.rpc("desempenho_anuncios", {
      p_org: org.id,
      p_de: de,
      p_ate: ate,
    }),
    supabase.rpc("leads_por_dia", {
      p_org: org.id,
      p_de: dia(13, org.fuso),
      p_ate: ate,
      p_campanha: campanha,
    }),
    campanha ? carregarLeitura(supabase, org, campanha) : null,
    carregarRastreio(supabase, org.id, campanha),
  ]);
  // Confiança dos números: anúncios no ar sem rastreio deixam cadastros e vendas de fora.
  const saudeRastreio = new Map(rastreio.campanhas.map((c) => [c.campaignId, c]));
  const gestor = temPapel(papel, "gestor");
  if (error) return <Aviso tom="erro">Não foi possível carregar: {error.message}</Aviso>;
  const linhas = ((dados as Linha[]) ?? []).filter((l) => !campanha || l.campaign_id === campanha);

  // Campanhas (soma dos anúncios) e total.
  const campanhas = new Map<string, { nome: string; soma: Soma; anuncios: number }>();
  const total = zero();
  for (const l of linhas) {
    somar(total, l);
    const id = l.campaign_id ?? "—";
    const c = campanhas.get(id) ?? {
      nome: l.campaign_name ?? id,
      soma: zero(),
      anuncios: 0,
    };
    somar(c.soma, l);
    c.anuncios += Number(l.gasto) > 0 ? 1 : 0;
    campanhas.set(id, c);
  }

  // Série de 14 dias → acumulado dos últimos 7 contra os 7 anteriores (leads que a Meta conta).
  const s = (serie as Array<{ dia: string; leads_meta: number; leads: number }>) ?? [];
  const usarMeta = s.some((x) => Number(x.leads_meta) > 0);
  const valor = (x: { leads_meta: number; leads: number }) => Number(usarMeta ? x.leads_meta : x.leads);
  const anteriores = s.slice(0, 7);
  const atuais = s.slice(7);
  const acumulado = (xs: typeof s) => xs.map((_, i) => xs.slice(0, i + 1).reduce((t, x) => t + valor(x), 0));
  const acAtual = acumulado(atuais);
  const acAnterior = acumulado(anteriores);
  const pontos: PontoComparacao[] = atuais.map((x, i) => ({
    rotulo: rotuloDia(x.dia),
    atual: acAtual[i],
    anterior: acAnterior[i] ?? 0,
    rotuloAnterior: anteriores[i] ? rotuloDia(anteriores[i].dia) : "",
  }));

  // Miniaturas (URL assinada de 1 h; o Storage confere o RLS de membro).
  const caminhos = [...new Set(linhas.map((l) => l.imagem_path).filter((p): p is string => !!p))];
  const urls = new Map<string, string>();
  if (campanha && caminhos.length) {
    const { data: assinadas } = await supabase.storage.from("criativos").createSignedUrls(caminhos, 3600);
    for (const a of assinadas ?? []) if (a.path && a.signedUrl) urls.set(a.path, a.signedUrl);
  }

  const link = (extra: Record<string, string | number | null>) => {
    const q = new URLSearchParams();
    const tudo = { dias, campanha, aba: campanha && aba !== "geral" ? aba : null, ...extra };
    // A campanha vai no caminho (/desempenho/<id>); período e aba ficam na busca.
    for (const [k, v] of Object.entries(tudo))
      if (k !== "campanha" && v !== null && v !== undefined && !(k === "dias" && v === 7) && !(k === "aba" && !tudo.campanha)) q.set(k, String(v));
    return `${rotaDesempenho(slug, tudo.campanha ? String(tudo.campanha) : null)}${q.size ? `?${q}` : ""}`;
  };
  // Só a aba aberta carrega o que é dela: as peças dos anúncios ou o Clarity das visitas da campanha.
  const [pecas, experiencia, velocidade, acoes, leadsVendas] = await Promise.all([
    campanha && aba === "anuncios"
      ? carregarPecas(
          supabase,
          org.id,
          linhas.map((l) => l.ad_id),
          new Map(linhas.map((l) => [l.ad_id, l.imagem_path ? (urls.get(l.imagem_path) ?? null) : null])),
        )
      : undefined,
    campanha && aba === "pagina" ? carregarExperiencia(supabase, org.id, campanha, de) : null,
    campanha && aba === "pagina" ? carregarVelocidade(supabase, org.id, campanha) : null,
    campanha
      ? carregarContextoAcoes(supabase, org, campanha, temPapel(papel, "gestor"), linhas, {
          configuracoes: rotaOrg(slug, "/configuracoes"),
          campanhas: rotaOrg(slug, "/campanhas"),
          vendas: rotaOrg(slug, "/vendas"),
          rastreio: rotaOrg(slug, `/rastreio/${campanha}`),
        })
      : undefined,
    campanha && aba === "vendas" ? carregarLeadsVendas(supabase, org.id, { campanha, desde: inicioDoDia(de, org.fuso) }) : null,
  ]);
  // Sem dados no período, o nome vem da leitura dos anúncios; a ponte leva à montagem, se a campanha nasceu aqui.
  const [nomeLido, montadaId] = campanha
    ? await Promise.all([
        campanhas.has(campanha)
          ? null
          : supabase
              .from("meta_anuncios")
              .select("campaign_name")
              .eq("organizacao_id", org.id)
              .eq("campaign_id", campanha)
              .limit(1)
              .maybeSingle()
              .then(({ data }) => data?.campaign_name ?? null),
        temPapel(papel, "gestor") ? campanhaMontada(supabase, org.id, campanha) : null,
      ])
    : [null, null];
  const nomeCampanha = campanha ? (campanhas.get(campanha)?.nome ?? nomeLido ?? campanha) : null;
  const semDados = !linhas.length;

  // Públicos (conjuntos) da campanha aberta: a mesma soma, agrupada por conjunto.
  const porConjunto = new Map<string, { nome: string; soma: Soma }>();
  if (campanha)
    for (const l of linhas) {
      const k = l.adset_id ?? "—";
      const cj = porConjunto.get(k) ?? {
        nome: l.adset_name ?? k,
        soma: zero(),
      };
      somar(cj.soma, l);
      porConjunto.set(k, cj);
    }

  // Cor fixa por anúncio: posição estável (ordem do id) dentro da campanha, não a do ranking por gasto.
  const ordemCor = new Map([...linhas].sort((a, b) => a.ad_id.localeCompare(b.ad_id)).map((l, i) => [l.ad_id, i]));
  const direta = org.funil === "venda_direta";
  const comTeste = org.funil === "cadastro_teste_venda";
  const colunasFunil = colunas(org.funil);
  const celulasFunil = (x: Soma) => celulas(x, org.funil, org.moeda);
  const indicadorPendentes = (
    <Indicador
      rotulo="Pagamento pendente"
      valor={inteiro(total.vendas_pendentes)}
      detalhe={total.vendas_pendentes ? `${moeda(total.valor_pendente, org.moeda)} em Pix ou boleto` : "Pix ou boleto gerados"}
    />
  );

  return (
    <>
      <Titulo
        sobrancelha={
          campanha ? (
            <Link href={link({ campanha: null })} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-text">
              <IconeVoltar tamanho={14} /> Todas as campanhas
            </Link>
          ) : (
            "Desempenho"
          )
        }
        acoes={
          <div className="flex flex-wrap items-center gap-3">
          {montadaId && (
            <BotaoLink variante="secundario" href={rotaOrg(slug, `/campanhas/${montadaId}`)}>
              Gerenciar esta campanha
              <IconeSeta tamanho={16} />
            </BotaoLink>
          )}
          <SeletorPeriodo dias={dias} href={(d) => link({ dias: d })} />
          </div>
        }
      >
        {nomeCampanha ?? "Quais anúncios trazem venda"}
      </Titulo>

      {semDados ? (
        <Vazio titulo="Sem dados no período">Escolha um período maior ou confira em Configurações › Sincronizações se a Meta já foi lida.</Vazio>
      ) : campanha && leitura ? (
        <>
        {!!saudeRastreio.get(campanha)?.semRastreio && (
          <Aviso tom="alerta" className="mb-5">
            <strong>Os números desta campanha estão incompletos.</strong> {saudeRastreio.get(campanha)!.semRastreio} anúncio(s) no ar estão sem rastreio: os cadastros e vendas
            que vierem deles não aparecem aqui.{" "}
            {gestor ? <Link href={rotaOrg(slug, `/rastreio/${campanha}`)}>Corrigir em Gerenciar › Rastreio</Link> : "Avise quem gerencia as campanhas."}
          </Aviso>
        )}
        <DetalheCampanha
          aba={aba}
          link={link}
          rotaConfiguracoes={rotaOrg(slug, "/configuracoes")}
          funil={org.funil}
          moeda={org.moeda}
          de={de}
          linhas={linhas}
          total={total}
          porConjunto={porConjunto}
          urls={urls}
          ordemCor={ordemCor}
          leitura={leitura}
          pontos={pontos}
          usarMeta={usarMeta}
          ultimoPontoEmAndamento={atuais.at(-1)?.dia === ate}
          pecas={pecas}
          experiencia={experiencia}
          velocidade={velocidade}
          acoes={acoes}
          leadsVendas={leadsVendas}
          fuso={org.fuso}
          rotaVendas={comDias(`${rotaOrg(slug, "/vendas")}?campanha=${campanha}`, dias)}
        />
        </>
      ) : (
        <div className="grid gap-5">
          <Indicadores className={`grid-cols-2 ${direta ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
            <Indicador rotulo="Gasto" valor={moeda(total.gasto, org.moeda)} detalhe="na Meta, no período" />
            {direta ? (
              <Indicador rotulo="Compras (Meta)" valor={inteiro(total.compras_meta)} detalhe="o que o Gerenciador conta" />
            ) : (
              <>
                <Indicador rotulo="Leads (Meta)" valor={inteiro(total.leads_meta)} detalhe="o que o Gerenciador conta" />
                <Indicador rotulo="Custo por lead" valor={moeda(razao(total.gasto, total.leads_meta), org.moeda)} detalhe="gasto ÷ leads (Meta)" />
                <Indicador rotulo="Leads (sistema)" valor={inteiro(total.leads)} detalhe="chegaram com o anúncio" />
              </>
            )}
            {comTeste ? (
              <Indicador
                rotulo="Testes"
                valor={inteiro(total.testes)}
                detalhe={
                  total.leads
                    ? `${pct(razao(total.testes, total.leads), 0)} dos leads${total.testes_cancelados ? ` · ${rotuloCancelados(total.testes_cancelados)}` : ""}`
                    : undefined
                }
              />
            ) : (
              indicadorPendentes
            )}
            <Indicador rotulo="Vendas" valor={inteiro(total.vendas)} detalhe={total.receita ? `${moeda(total.receita, org.moeda)} de receita` : undefined} />
            <Indicador rotulo="Custo por venda" valor={moeda(razao(total.gasto, total.vendas), org.moeda)} detalhe="gasto ÷ vendas" destaque />
            <Indicador
              rotulo="ROAS"
              valor={roas(total.receita, total.gasto)}
              detalhe={total.receita ? `${moeda(razao(total.receita, total.gasto), org.moeda)} de volta por R$ 1` : undefined}
              destaque
            />
          </Indicadores>

          {direta ? (
            <Aviso>
              <strong>Compras (Meta)</strong> é o que o Gerenciador conta pelo pixel. <strong>Vendas</strong> é o que a sua plataforma confirmou, com o anúncio de origem; Pix e
              boleto só contam depois de pagos, e reembolso e chargeback descontam da receita.
            </Aviso>
          ) : (
            <>
              <Aviso>
                <strong>Leads (Meta)</strong> é o que o Gerenciador conta pelo pixel. <strong>Leads (sistema)</strong> é o que chegou à sua fonte de venda com o anúncio de origem;
                é sobre ele que calculamos {comTeste ? "testes, vendas" : "vendas"} e ROAS.
                {comTeste && " Testes conta quem iniciou; cancelados são os que desistiram antes da cobrança, e a venda só entra quando o pagamento acontece."}
              </Aviso>

              <Cartao>
                <GraficoAcumulado pontos={pontos} titulo={`${usarMeta ? "Leads (Meta)" : "Leads (sistema)"} acumulados${nomeCampanha ? ` · ${nomeCampanha}` : ""}`} />
                {atuais.at(-1)?.dia === ate && (
                  <p className="mt-2 text-xs text-ink-3">O último ponto é hoje, ainda em andamento: a curva achata até o dia terminar e a Meta ser lida de novo.</p>
                )}
                <details className="mt-3 text-sm">
                  <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-line-strong px-3.5 font-medium text-ink hover:bg-surface-2">
                    Ver em tabela
                  </summary>
                  <div className="mt-3 overflow-hidden rounded-md border border-line">
                    <Tabela>
                      <thead>
                        <tr>
                          <th>Dia</th>
                          <th className="text-right">Acumulado</th>
                          <th>Dia anterior equivalente</th>
                          <th className="text-right">Acumulado</th>
                        </tr>
                      </thead>
                      <tbody className="[&_.num]:tabular-nums">
                        {pontos.map((p) => (
                          <tr key={p.rotulo}>
                            <td>{p.rotulo}</td>
                            <td className="num">{inteiro(p.atual)}</td>
                            <td className="text-ink-2">{p.rotuloAnterior}</td>
                            <td className="num">{inteiro(p.anterior)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Tabela>
                  </div>
                </details>
              </Cartao>
            </>
          )}

          <Cartao titulo={`Campanhas · últimos ${dias} dias`} acoes={<span className="text-sm text-ink-3">Clique numa campanha para ver os anúncios</span>} rente>
            <Tabela>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th className="text-right">Gasto</th>
                  <th className="text-right">Impressões</th>
                  <th className="text-right">Freq.</th>
                  <th className="text-right">CTR</th>
                  {colunasFunil}
                  <th className="text-right">Vendas</th>
                  <th className="!bg-accent-soft text-right !text-ink">Custo/venda</th>
                  <th className="!bg-accent-soft text-right !text-ink">ROAS</th>
                </tr>
              </thead>
              <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
                {[...campanhas]
                  .sort(([, a], [, b]) => b.soma.gasto - a.soma.gasto)
                  .map(([id, c]) => (
                    <tr key={id}>
                      <td>
                        <Link href={link({ campanha: id })} className="font-medium text-ink hover:text-accent-text">
                          {c.nome}
                        </Link>
                        <div className="text-xs text-ink-3">{c.anuncios} anúncio(s) com gasto</div>
                        {!!saudeRastreio.get(id)?.semRastreio && (
                          <div className="mt-1">
                            <Etiqueta tom="alerta">Números incompletos: rastreio faltando</Etiqueta>
                          </div>
                        )}
                      </td>
                      <td>{moeda(c.soma.gasto, org.moeda)}</td>
                      <td>{inteiro(c.soma.impressoes)}</td>
                      <td>{decimal(razao(c.soma.freqPeso, c.soma.impressoes))}</td>
                      <td>{pct(razao(c.soma.cliques_link, c.soma.impressoes), 2)}</td>
                      {celulasFunil(c.soma)}
                      <td>{inteiro(c.soma.vendas)}</td>
                      <td className={destaque}>{moeda(razao(c.soma.gasto, c.soma.vendas), org.moeda)}</td>
                      <td className={destaque}>{roas(c.soma.receita, c.soma.gasto)}</td>
                    </tr>
                  ))}
                {campanhas.size > 1 && (
                  <tr className="font-semibold [&>td]:border-t-2 [&>td]:border-line-strong">
                    <td>Total</td>
                    <td>{moeda(total.gasto, org.moeda)}</td>
                    <td>{inteiro(total.impressoes)}</td>
                    <td>—</td>
                    <td>{pct(razao(total.cliques_link, total.impressoes), 2)}</td>
                    {celulasFunil(total)}
                    <td>{inteiro(total.vendas)}</td>
                    <td className={destaque}>{moeda(razao(total.gasto, total.vendas), org.moeda)}</td>
                    <td className={destaque}>{roas(total.receita, total.gasto)}</td>
                  </tr>
                )}
              </tbody>
            </Tabela>
          </Cartao>
        </div>
      )}
    </>
  );
}
