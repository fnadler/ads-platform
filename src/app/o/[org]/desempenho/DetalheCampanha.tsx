import Link from "next/link";
import type { ReactNode } from "react";
import { GraficoAcumulado, type PontoComparacao } from "@/components/GraficoAcumulado";
import { IconeChevron, IconeExclamacao, IconeExterno, IconeSeta, IconeX } from "@/components/Icones";
import { CarrosselAchados, type LinksArea } from "@/components/CarrosselAchados";
import { MapaRolagem, VisitasPorAparelho } from "@/components/MapaRolagem";
import { VisualizarAnuncio, type PecaAnuncio } from "@/components/VisualizarAnuncio";
import { APARELHOS } from "@/lib/clarity/campanha";
import { BotaoAcao } from "@/components/AcaoSugestao";
import type { ContextoAcoes, ExperienciaPagina } from "./carregar";
import { Aviso, BotaoLink, Cartao, corAnuncio, Indicador, Indicadores, Tabela, Vazio } from "@/components/ui";
import { decimal, inteiro, moeda, pct, razao } from "@/lib/formato";
import type { Achado, AreaAchado, Etapa, Leitura, TomAchado } from "@/lib/leitura/modelo";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";
import { somar, zero, type Linha, type Soma } from "./soma";
import { celulasFunil, colunasFunil, destaque, roas, rotuloCancelados } from "./tabelas";

// Detalhe de uma campanha em abas. Cada aba segue o mesmo roteiro, para quem não é do ramo: os 2–3 números
// que importam naquela parte, as sugestões da leitura num carrossel de cartões compactos e, fechado, todos
// os números para quem quer conferir. A visão geral junta o caminho inteiro e as sugestões de todas.

export type Aba = "geral" | Exclude<AreaAchado, "geral">;
export const ABAS: Aba[] = ["geral", "anuncios", "pagina", "vendas"];
const rotuloAba = (aba: Aba, funil: Funil) =>
  ({
    geral: "Visão geral",
    anuncios: "Anúncios",
    pagina: "Página",
    vendas: funil === "venda_direta" ? "Vendas" : "Cadastros e vendas",
  })[aba];

const NOME_APARELHO = { Mobile: "Celular", PC: "Computador", Tablet: "Tablet" } as const;
const juntarNomes = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}` : (xs[0] ?? ""));

const precisaAtencao = (a: Achado) => a.tom === "agir" || a.tom === "observar";
const PIOR: TomAchado[] = ["agir", "observar", "aguardar", "ok"];

export interface DadosDetalhe {
  aba: Aba;
  link: (extra: Record<string, string | number | null>) => string;
  rotaConfiguracoes: string;
  funil: Funil;
  moeda: string;
  /** Primeiro dia do período escolhido (AAAA-MM-DD). */
  de: string;
  linhas: Linha[];
  total: Soma;
  porConjunto: Map<string, { nome: string; soma: Soma }>;
  urls: Map<string, string>;
  ordemCor: Map<string, number>;
  leitura: Leitura;
  pontos: PontoComparacao[];
  usarMeta: boolean;
  ultimoPontoEmAndamento: boolean;
  /** Peça de cada anúncio (só na aba Anúncios). */
  pecas?: Map<string, PecaAnuncio>;
  /** Clarity das visitas da campanha (só na aba Página). */
  experiencia?: ExperienciaPagina | null;
  /** O que as sugestões e os anúncios podem fazer na Meta. */
  acoes?: ContextoAcoes;
}

export function DetalheCampanha(d: DadosDetalhe) {
  const achados = d.leitura.achados;
  return (
    <div className="grid gap-5">
      <nav aria-label="Partes da campanha" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {ABAS.map((aba) => {
          const daAba = aba === "geral" ? [] : achados.filter((a) => a.area === aba && precisaAtencao(a));
          const ativa = aba === d.aba;
          return (
            <Link
              key={aba}
              href={d.link({ aba: aba === "geral" ? null : aba })}
              aria-current={ativa ? "page" : undefined}
              className={`-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-sm no-underline hover:no-underline ${ativa ? "border-accent font-[600] text-ink" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}
            >
              {rotuloAba(aba, d.funil)}
              {daAba.length > 0 && (
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-[650] ${daAba.some((a) => a.tom === "agir") ? "bg-err-soft text-err" : "bg-warn-soft text-warn"}`}
                  aria-label={`${daAba.length} ${daAba.length === 1 ? "ponto pede" : "pontos pedem"} atenção`}
                >
                  {daAba.length}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {d.aba === "geral" && <AbaGeral {...d} />}
      {d.aba === "anuncios" && <AbaAnuncios {...d} />}
      {d.aba === "pagina" && <AbaPagina {...d} />}
      {d.aba === "vendas" && <AbaVendas {...d} />}
    </div>
  );
}

/** Seção dentro de uma aba: título curto e o conteúdo. */
function Secao({ titulo, children, acoes }: { titulo: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-base font-[600] text-ink">{titulo}</h2>
        {acoes}
      </div>
      {children}
    </section>
  );
}

/** "Ver todos os números": fechado por padrão. */
function TodosNumeros({ titulo = "Ver todos os números", children }: { titulo?: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-line bg-surface shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-sm font-[550] text-ink [&::-webkit-details-marker]:hidden">
        <IconeChevron tamanho={16} className="-rotate-90 text-ink-3 transition-transform group-open:rotate-0" />
        {titulo}
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

const achadosDaArea = (d: DadosDetalhe, area: AreaAchado) => d.leitura.achados.filter((a) => a.area === area);

/** Sugestões da aba, logo abaixo dos números; sem nenhuma, uma linha dizendo que está tudo em dia. */
function SugestoesDaArea({ achados, padrao, acoes }: { achados: Achado[]; padrao: string; acoes?: ContextoAcoes }) {
  return achados.length ? <CarrosselAchados achados={achados} acoes={acoes} /> : <Aviso tom="ok">{padrao}</Aviso>;
}

// ───────────────────────────── Visão geral ─────────────────────────────

/** Etapa do caminho ↔ o que a leitura aponta. */
const PASSO_DA_ETAPA: Record<Etapa, string> = {
  entrega: "gasto",
  leilao: "exibicoes",
  anuncio: "cliques",
  carregamento: "visitas",
  pagina: "cadastros",
};
const PASSO_DO_ACHADO: Record<string, string> = {
  saturacao: "cliques",
  "testes-recentes": "testes",
};

interface PassoCaminho {
  id: string;
  rotulo: string;
  valor: string;
  /** A passagem do passo anterior para este (ex.: "3,1% clicam"). */
  taxa?: string;
  aba: Aba;
}

function CaminhoCampanha({ d }: { d: DadosDetalhe }) {
  const t = d.total;
  const direta = d.funil === "venda_direta";
  const cadastros = d.usarMeta ? t.leads_meta : t.leads;
  const passos: PassoCaminho[] = [
    {
      id: "gasto",
      rotulo: "Investido",
      valor: moeda(t.gasto, d.moeda),
      aba: "anuncios",
    },
    {
      id: "exibicoes",
      rotulo: "Vezes que o anúncio apareceu",
      valor: inteiro(t.impressoes),
      taxa: `${moeda(razao(t.gasto * 1000, t.impressoes), d.moeda)} a cada mil`,
      aba: "anuncios",
    },
    {
      id: "cliques",
      rotulo: "Cliques no anúncio",
      valor: inteiro(t.cliques_link),
      taxa: `${pct(razao(t.cliques_link, t.impressoes), 1)} de quem vê clica`,
      aba: "anuncios",
    },
    {
      id: "visitas",
      rotulo: "Visitas à página",
      valor: inteiro(t.visualizacoes_pagina),
      taxa: `${pct(razao(t.visualizacoes_pagina, t.cliques_link), 0)} dos cliques abrem`,
      aba: "pagina",
    },
  ];
  if (direta)
    passos.push({
      id: "vendas",
      rotulo: "Vendas",
      valor: inteiro(t.vendas),
      taxa: `${pct(razao(t.vendas, t.visualizacoes_pagina), 1)} das visitas compram`,
      aba: "vendas",
    });
  else {
    passos.push({
      id: "cadastros",
      rotulo: "Cadastros",
      valor: inteiro(cadastros),
      taxa: `${pct(razao(cadastros, t.visualizacoes_pagina), 0)} das visitas`,
      aba: "pagina",
    });
    if (d.funil === "cadastro_teste_venda")
      passos.push({
        id: "testes",
        rotulo: "Testes grátis",
        valor: inteiro(t.testes),
        taxa: `${pct(razao(t.testes, t.leads), 0)} dos cadastros`,
        aba: "vendas",
      });
    passos.push({
      id: "vendas",
      rotulo: "Vendas",
      valor: inteiro(t.vendas),
      taxa: `${pct(razao(t.vendas, d.funil === "cadastro_teste_venda" ? t.testes : t.leads), 0)} ${d.funil === "cadastro_teste_venda" ? "dos testes" : "dos cadastros"}`,
      aba: "vendas",
    });
  }

  // O pior estado apontado para cada passo.
  const alerta = new Map<string, TomAchado>();
  for (const a of d.leitura.achados.filter(precisaAtencao)) {
    const passo = a.etapa ? PASSO_DA_ETAPA[a.etapa] : PASSO_DO_ACHADO[a.id];
    if (passo && (!alerta.has(passo) || PIOR.indexOf(a.tom) < PIOR.indexOf(alerta.get(passo)!))) alerta.set(passo, a.tom);
  }

  return (
    <div className="flex flex-col gap-2">
      <ol
        className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card sm:grid-cols-3 ${passos.length === 7 ? "lg:grid-cols-7" : passos.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}
      >
        {passos.map((p, i) => {
          const tom = alerta.get(p.id);
          // O último passo ocupa o que sobra da linha, para a grade não ficar com buraco (2 colunas no celular, 3 no tablet).
          const ultimo = i === passos.length - 1;
          const sobra = ultimo ? [passos.length % 2 === 1 ? "max-sm:col-span-2" : "", ["", "sm:max-lg:col-span-3", "sm:max-lg:col-span-2"][passos.length % 3]].join(" ") : "";
          const fundo = tom === "agir" ? "bg-err-soft" : tom === "observar" ? "bg-warn-soft" : "bg-surface";
          return (
            <li key={p.id} className={`relative ${fundo} ${sobra}`}>
              <Link href={d.link({ aba: p.aba })} className="flex h-full min-w-0 flex-col gap-1 p-4 text-ink no-underline transition-colors hover:bg-surface-2 hover:no-underline">
                <span className="flex items-center gap-1 text-xs text-ink-3">
                  {i > 0 && <IconeSeta tamanho={12} className="shrink-0" />}
                  {p.rotulo}
                </span>
                <span className="num-display text-xl text-ink sm:text-2xl">{p.valor}</span>
                {p.taxa && <span className={`text-xs ${tom === "agir" ? "font-[600] text-err" : tom === "observar" ? "font-[600] text-warn" : "text-ink-2"}`}>{p.taxa}</span>}
                {tom && (
                  <span className={`mt-1 inline-flex items-center gap-1 text-xs font-[600] ${tom === "agir" ? "text-err" : "text-warn"}`}>
                    {tom === "agir" ? <IconeX tamanho={12} strokeWidth={2.4} /> : <IconeExclamacao tamanho={12} strokeWidth={2.4} />}
                    {tom === "agir" ? "Travando aqui" : "De olho aqui"}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      {!direta && d.usarMeta && (
        <p className="text-xs text-ink-3">
          Cadastros: o que a Meta conta. Desses, {inteiro(t.leads)} chegaram ao seu sistema com o anúncio de origem, e é sobre eles que contamos testes e vendas.
        </p>
      )}
    </div>
  );
}

function AbaGeral(d: DadosDetalhe) {
  const { achados, nota } = d.leitura;
  const t = d.total;
  const direta = d.funil === "venda_direta";
  const cadastros = d.usarMeta ? t.leads_meta : t.leads;
  const maturidade = achados.find((a) => a.id === "maturidade");

  const links: LinksArea = Object.fromEntries((["anuncios", "pagina", "vendas"] as const).map((a) => [a, { href: d.link({ aba: a }), rotulo: `Ver em ${rotuloAba(a, d.funil)}` }]));

  return (
    <>
      <Secao titulo="Do anúncio à venda">
        <CaminhoCampanha d={d} />
      </Secao>

      <Indicadores className={`grid-cols-1 sm:grid-cols-3`}>
        {direta ? (
          <Indicador rotulo="Investido" valor={moeda(t.gasto, d.moeda)} detalhe="na Meta, no período" />
        ) : (
          <Indicador
            rotulo="Custo por cadastro"
            valor={moeda(razao(t.gasto, cadastros), d.moeda)}
            detalhe={`${moeda(t.gasto, d.moeda)} investidos ÷ ${inteiro(cadastros)} cadastros`}
          />
        )}
        <Indicador
          rotulo="Custo por venda"
          valor={moeda(razao(t.gasto, t.vendas), d.moeda)}
          detalhe={
            !maturidade
              ? "investido ÷ vendas"
              : /^\d{2}\/\d{2}$/.test(maturidade.destaque?.para ?? "")
                ? `Ainda cedo: a primeira cobrança é em ${maturidade.destaque!.para}`
                : "Poucas vendas ainda: use como direção"
          }
          destaque
        />
        <Indicador
          rotulo="Retorno (ROAS)"
          valor={roas(t.receita, t.gasto)}
          detalhe={t.receita ? `${moeda(razao(t.receita, t.gasto), d.moeda)} de volta para cada R$ 1` : "quanto volta em vendas para cada R$ 1"}
          destaque
        />
      </Indicadores>

      {achados.length ? (
        <CarrosselAchados achados={achados} titulo="Sugestões" nota={nota} links={links} acoes={d.acoes} />
      ) : (
        <Aviso tom="ok">A campanha está rodando sem nada fora do normal.</Aviso>
      )}
    </>
  );
}

// ───────────────────────────── Anúncios ─────────────────────────────

type Selo = { texto: string; tom: "ok" | "alerta" | "info" | "erro" };

function selosDosAnuncios(linhas: Linha[], funil: Funil): Map<string, Selo> {
  const resultado = (l: Linha) => Number(funil === "venda_direta" ? l.compras_meta : l.leads_meta);
  const gastoTotal = linhas.reduce((s, l) => s + Number(l.gasto), 0);
  const resTotal = linhas.reduce((s, l) => s + resultado(l), 0);
  const custoMedio = resTotal ? gastoTotal / resTotal : null;
  const selos = new Map<string, Selo>();
  const comAmostra = linhas.filter((l) => resultado(l) >= 5);
  const melhor = comAmostra.sort((a, b) => Number(a.gasto) / resultado(a) - Number(b.gasto) / resultado(b))[0];
  for (const l of linhas) {
    const r = resultado(l);
    const custo = r ? Number(l.gasto) / r : null;
    if (Number(l.impressoes) < 1000)
      selos.set(l.ad_id, {
        texto: "Pouco exibido: ainda sem veredito",
        tom: "info",
      });
    else if (custoMedio && ((custo !== null && r >= 5 && custo >= custoMedio * 1.5) || (r === 0 && Number(l.gasto) >= custoMedio * 2)))
      selos.set(l.ad_id, { texto: "Mais caro que os outros", tom: "alerta" });
    else if (melhor && l.ad_id === melhor.ad_id && comAmostra.length > 1)
      selos.set(l.ad_id, {
        texto: funil === "venda_direta" ? "Menor custo por compra" : "Menor custo por cadastro",
        tom: "ok",
      });
  }
  return selos;
}

const TOM_SELO = {
  ok: "border-ok-line bg-ok-soft text-ok",
  alerta: "border-warn-line bg-warn-soft text-warn",
  info: "border-line bg-surface-2 text-ink-2",
  erro: "border-err-line bg-err-soft text-err",
};

/** Estados da Meta em que o anúncio não está veiculando (ele, o conjunto ou a campanha parados, ou já terminado). */
const PARADO: Record<string, string> = {
  PAUSED: "Pausado",
  ADSET_PAUSED: "Pausado (conjunto pausado)",
  CAMPAIGN_PAUSED: "Pausado (campanha pausada)",
  EXPIRED: "Encerrado",
  ARCHIVED: "Arquivado",
  DELETED: "Excluído",
};
/** Estados em que o anúncio ainda não veicula, mas não está parado. */
const OUTRO_STATUS: Record<string, string> = { IN_PROCESS: "Em análise", PENDING_REVIEW: "Em análise", DISAPPROVED: "Reprovado", WITH_ISSUES: "Com problema" };

/** Situação do anúncio no rodapé do cartão: "No ar" com o ponto pulsando, ou o motivo de não estar. */
function SituacaoAnuncio({ status }: { status: string | null }) {
  if (status === "ACTIVE")
    return (
      <span className="inline-flex h-6 items-center gap-2 rounded-full border border-ok-line bg-ok-soft px-2.5 text-xs font-[600] text-ok">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full rounded-full bg-ok opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-ok" />
        </span>
        No ar
      </span>
    );
  const parado = status ? PARADO[status] : undefined;
  const outro = status ? OUTRO_STATUS[status] : undefined;
  if (!parado && !outro) return <span />;
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-[600] ${parado ? "border-line-strong bg-sunken text-ink-2" : status === "DISAPPROVED" || status === "WITH_ISSUES" ? "border-err-line bg-err-soft text-err" : "border-warn-line bg-warn-soft text-warn"}`}
    >
      {parado && <span className="text-[10px] leading-none">Ⅱ</span>}
      {parado ?? outro}
    </span>
  );
}

function CartaoAnuncio({ l, d, selo, fatia }: { l: Linha; d: DadosDetalhe; selo?: Selo; fatia: number }) {
  const direta = d.funil === "venda_direta";
  const resultado = Number(direta ? l.compras_meta : l.leads_meta);
  const parado = l.status ? PARADO[l.status] : undefined;
  return (
    <article className={`relative flex flex-col gap-4 rounded-lg border p-4 ${parado ? "border-dashed border-line-strong bg-surface-2" : "border-line bg-surface shadow-card"}`}>
      {/* Em tons de cinza quando parado: os números continuam lá, mas sem a cor de quem está no ar. */}
      <div className={`flex flex-col gap-4 ${parado ? "opacity-60 grayscale" : ""}`}>
        <div className="flex gap-3">
          <VisualizarAnuncio
            peca={d.pecas?.get(l.ad_id) ?? { nome: l.ad_name ?? l.ad_id, tipo: "imagem", miniatura: l.imagem_path ? d.urls.get(l.imagem_path) : null }}
            cor={corAnuncio(d.ordemCor.get(l.ad_id) ?? 0)}
            className="w-16"
          />
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <h3 className="text-sm font-[600] leading-snug text-ink">{l.ad_name ?? l.ad_id}</h3>
            <span className="line-clamp-2 text-xs text-ink-3">{l.adset_name}</span>
            {selo && <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs font-medium ${TOM_SELO[selo.tom]}`}>{selo.texto}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink-2">Da verba</span>
            <span className="font-[600] tabular-nums text-ink">
              {pct(fatia, 0)} <span className="font-normal text-ink-3">· {moeda(Number(l.gasto), d.moeda)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="presentation">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(fatia * 100)}%`,
                background: corAnuncio(d.ordemCor.get(l.ad_id) ?? 0),
              }}
            />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-ink-3">{direta ? "Compras (Meta)" : "Cadastros"}</dt>
            <dd className="font-[600] tabular-nums text-ink">{inteiro(resultado)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">{direta ? "Custo por compra" : "Custo por cadastro"}</dt>
            <dd className="font-[600] tabular-nums text-ink">{moeda(razao(Number(l.gasto), resultado), d.moeda)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">De quem vê, clicam</dt>
            <dd className="font-[600] tabular-nums text-ink">{pct(razao(Number(l.cliques_link), Number(l.impressoes)), 1)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">{d.funil === "cadastro_teste_venda" ? "Testes · vendas" : "Vendas"}</dt>
            <dd className="font-[600] tabular-nums text-ink">
              {d.funil === "cadastro_teste_venda" ? `${inteiro(Number(l.testes))} · ${inteiro(Number(l.vendas))}` : inteiro(Number(l.vendas))}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-auto flex min-h-11 items-center justify-between gap-2 border-t border-line pt-2 -mb-1">
        <SituacaoAnuncio status={l.status} />
        {d.acoes?.podeAgir && d.acoes.anuncios.find((a) => a.id === l.ad_id)?.daPlataforma && (l.status === "ACTIVE" || l.status === "PAUSED") && (
          <BotaoAcao
            acao={l.status === "ACTIVE" ? { tipo: "pausar_anuncio", anuncio: l.ad_id } : { tipo: "reativar_anuncio", anuncio: l.ad_id }}
            ctx={d.acoes}
            variante={l.status === "ACTIVE" ? "fantasma" : "secundario"}
            className="min-h-10 px-3"
            rotulo={l.status === "ACTIVE" ? "Pausar" : "Reativar"}
          />
        )}
      </div>
    </article>
  );
}

function AbaAnuncios(d: DadosDetalhe) {
  const t = d.total;
  const ordenadas = [...d.linhas].sort((a, b) => Number(b.gasto) - Number(a.gasto));
  const selos = selosDosAnuncios(d.linhas, d.funil);
  const achados = achadosDaArea(d, "anuncios");
  return (
    <>
      <Indicadores className="grid-cols-1 sm:grid-cols-3">
        <Indicador
          rotulo="De quem vê o anúncio, quantos clicam"
          valor={pct(razao(t.cliques_link, t.impressoes), 2)}
          detalhe={`${inteiro(t.cliques_link)} cliques em ${inteiro(t.impressoes)} exibições`}
        />
        <Indicador rotulo="Custo para aparecer mil vezes" valor={moeda(razao(t.gasto * 1000, t.impressoes), d.moeda)} detalhe="sobe quando o leilão fica mais disputado" />
        <Indicador rotulo="Vezes que cada pessoa viu" valor={`${decimal(razao(t.freqPeso, t.impressoes), 1)}×`} detalhe="em média, no período" />
      </Indicadores>
      <SugestoesDaArea achados={achados} acoes={d.acoes} padrao="Os anúncios estão entregando e atraindo cliques normalmente" />

      <Secao titulo="Cada anúncio" acoes={<span className="text-sm text-ink-3">Do que levou mais verba ao que levou menos</span>}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ordenadas.map((l) => (
            <CartaoAnuncio key={l.ad_id} l={l} d={d} selo={selos.get(l.ad_id)} fatia={t.gasto ? Number(l.gasto) / t.gasto : 0} />
          ))}
        </div>
      </Secao>

      {d.porConjunto.size > 1 && (
        <Cartao titulo="Públicos (conjuntos)" acoes={<span className="text-sm text-ink-3">Qual público vende</span>} rente>
          <Tabela>
            <thead>
              <tr>
                <th>Conjunto</th>
                <th className="text-right">Gasto</th>
                {colunasFunil(d.funil)}
                <th className="text-right">Vendas</th>
                <th className="!bg-accent-soft text-right !text-ink">Custo/venda</th>
                <th className="!bg-accent-soft text-right !text-ink">ROAS</th>
              </tr>
            </thead>
            <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
              {[...d.porConjunto]
                .sort(([, a], [, b]) => b.soma.gasto - a.soma.gasto)
                .map(([k, cj]) => (
                  <tr key={k}>
                    <td className="font-medium text-ink">{cj.nome}</td>
                    <td>{moeda(cj.soma.gasto, d.moeda)}</td>
                    {celulasFunil(cj.soma, d.funil, d.moeda)}
                    <td>{inteiro(cj.soma.vendas)}</td>
                    <td className={destaque}>{moeda(razao(cj.soma.gasto, cj.soma.vendas), d.moeda)}</td>
                    <td className={destaque}>{roas(cj.soma.receita, cj.soma.gasto)}</td>
                  </tr>
                ))}
            </tbody>
          </Tabela>
        </Cartao>
      )}

      <TodosNumeros titulo="Ver todos os números dos anúncios">
        <Tabela>
          <thead>
            <tr>
              <th>Anúncio</th>
              <th className="text-right">Gasto</th>
              <th className="text-right">Freq.</th>
              <th className="text-right">CTR</th>
              {colunasFunil(d.funil)}
              <th className="text-right">Vendas</th>
              <th className="!bg-accent-soft text-right !text-ink">Custo/venda</th>
              <th className="!bg-accent-soft text-right !text-ink">ROAS</th>
            </tr>
          </thead>
          <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
            {ordenadas.map((l) => (
              <tr key={l.ad_id}>
                <td>
                  <div className="font-medium text-ink">{l.ad_name ?? l.ad_id}</div>
                  <div className="text-xs text-ink-3">{l.adset_name}</div>
                </td>
                <td>{moeda(Number(l.gasto), d.moeda)}</td>
                <td>{decimal(Number(l.frequencia))}</td>
                <td>{pct(razao(Number(l.cliques_link), Number(l.impressoes)), 2)}</td>
                {celulasFunil(somar(zero(), l), d.funil, d.moeda)}
                <td>{inteiro(Number(l.vendas))}</td>
                <td className={destaque}>{moeda(razao(Number(l.gasto), Number(l.vendas)), d.moeda)}</td>
                <td className={destaque}>{roas(Number(l.receita), Number(l.gasto))}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      </TodosNumeros>
    </>
  );
}

// ───────────────────────────── Página ─────────────────────────────

const media = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const segundos = (s: number | null) => (s === null ? "—" : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function AbaPagina(d: DadosDetalhe) {
  const t = d.total;
  const direta = d.funil === "venda_direta";
  const cadastros = d.usarMeta ? t.leads_meta : t.leads;
  const achados = achadosDaArea(d, "pagina");
  const dias = d.leitura.clarity.filter((c) => c.dia >= d.de && (c.sessoes ?? 0) > 0);
  const exp = d.experiencia?.sessoes ? d.experiencia : null;
  const projeto = d.experiencia?.projetoClarity;
  // Mapa só para aparelho com visitas suficientes (ou o mais visitado, se nenhum tiver).
  const comVisitas = exp ? APARELHOS.filter((a) => (exp.porAparelho[a]?.sessoes ?? 0) > 0).sort((a, b) => exp.porAparelho[b]!.sessoes - exp.porAparelho[a]!.sessoes) : [];
  const suficientes = comVisitas.filter((a) => exp!.porAparelho[a]!.sessoes >= 10);
  const comMapa = suficientes.length ? suficientes : comVisitas.slice(0, 1);
  const poucos = comVisitas.filter((a) => !comMapa.includes(a));
  return (
    <>
      <Indicadores className="grid-cols-1 sm:grid-cols-3">
        <Indicador rotulo="Visitas à página" valor={inteiro(t.visualizacoes_pagina)} detalhe="vindas dos anúncios, no período" />
        <Indicador rotulo="De quem clica, quantos abrem a página" valor={pct(razao(t.visualizacoes_pagina, t.cliques_link), 0)} detalhe="baixo indica página lenta ou fora do ar" />
        {direta ? (
          <Indicador rotulo="De quem visita, quantos compram" valor={pct(razao(t.compras_meta, t.visualizacoes_pagina), 1)} detalhe="compras que a Meta conta ÷ visitas" destaque />
        ) : (
          <Indicador
            rotulo="De quem visita, quantos se cadastram"
            valor={pct(razao(cadastros, t.visualizacoes_pagina), 0)}
            detalhe={`${inteiro(cadastros)} cadastros em ${inteiro(t.visualizacoes_pagina)} visitas`}
            destaque
          />
        )}
      </Indicadores>
      <SugestoesDaArea achados={achados} acoes={d.acoes} padrao="A página está abrindo e convertendo as visitas como antes" />

      <Secao titulo="Como as visitas da campanha usam a página">
        {!d.leitura.clarityConectado ? (
          <Vazio
            titulo="Conecte o Microsoft Clarity"
            acao={
              <BotaoLink href={d.rotaConfiguracoes} variante="secundario">
                Ir para Configurações
              </BotaoLink>
            }
          >
            O Clarity é grátis e mostra até onde as pessoas descem na página, onde clicam sem resposta e se aparecem erros. Com ele, a leitura passa a dizer se a queda de cadastros
            é problema técnico ou de mensagem.
          </Vazio>
        ) : !dias.length && !exp ? (
          <Aviso>O Clarity está conectado. A coleta roda todo dia à meia-noite; os primeiros dias aparecem aqui assim que chegarem.</Aviso>
        ) : (
          <>
            {exp ? (
              <>
                <p className="-mt-1 text-sm text-ink-2">
                  Medido pelo Clarity em {exp.dias.map(ddmm).join(", ")}, só nas visitas que chegaram pelo link dos anúncios
                  {exp.paginas[0] ? <> (página {exp.paginas[0].url.replace(/^https?:\/\//, "")})</> : null}.
                </p>
                <VisitasPorAparelho porAparelho={exp.porAparelho} />
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  {comMapa.map((a) => (
                    <MapaRolagem key={a} aparelho={a} e={exp.porAparelho[a]!} />
                  ))}
                  <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5 shadow-card">
                    <h3 className="text-base font-[600] text-ink">Mapa de cliques</h3>
                    <p className="max-w-3xl text-sm text-ink-2">
                      O Clarity não entrega o mapa de cliques para outros sistemas, só no painel dele. Lá, abra os mapas de calor, escolha a página e alterne entre Celular e
                      Computador para ver onde as pessoas clicam e até onde descem. As gravações mostram visitas inteiras; filtre por origem = anuncio_meta.
                    </p>
                    {projeto && (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`https://clarity.microsoft.com/projects/view/${projeto}/heatmaps`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-[550] text-ink no-underline hover:bg-surface-2 hover:no-underline"
                        >
                          Abrir mapas de calor <IconeExterno tamanho={15} />
                        </a>
                        <a
                          href={`https://clarity.microsoft.com/projects/view/${projeto}/impressions`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-[550] text-ink no-underline hover:bg-surface-2 hover:no-underline"
                        >
                          Ver gravações <IconeExterno tamanho={15} />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                {poucos.length > 0 && (
                  <p className="text-xs text-ink-3">
                    {juntarNomes(poucos.map((a) => `${NOME_APARELHO[a]} (${inteiro(exp.porAparelho[a]!.sessoes)})`))}: poucas visitas para desenhar o mapa de rolagem.
                  </p>
                )}
              </>
            ) : (
              <Aviso>Ainda não há visitas desta campanha nas coletas do Clarity do período. Abaixo, os números do site todo.</Aviso>
            )}
            {dias.length > 0 && (
              <TodosNumeros titulo="Ver os números do site todo, dia a dia">
                <div className="p-4">
                  <Indicadores className="grid-cols-2 lg:grid-cols-4">
                    <Indicador
                      rotulo="Visitas registradas"
                      valor={inteiro(dias.reduce((s, x) => s + (x.sessoes ?? 0), 0))}
                      detalhe={`${dias.length} ${dias.length === 1 ? "dia" : "dias"} no período`}
                    />
                    <Indicador rotulo="Até onde descem na página" valor={pct((media(dias.map((x) => x.rolagem)) ?? NaN) / 100, 0)} detalhe="da altura da página, em média" />
                    <Indicador rotulo="Tempo ativo por visita" valor={segundos(media(dias.map((x) => x.tempoAtivo)))} detalhe="em média" />
                    <Indicador
                      rotulo="Visitas com clique sem resposta"
                      valor={pct((media(dias.map((x) => x.cliqueMorto)) ?? NaN) / 100, 1)}
                      detalhe="clicaram em algo que não funcionou"
                    />
                  </Indicadores>
                </div>
                <Tabela>
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th className="text-right">Visitas</th>
                      <th className="text-right">Rolagem</th>
                      <th className="text-right">Tempo ativo</th>
                      <th className="text-right">Volta rápida</th>
                      <th className="text-right">Clique sem resposta</th>
                      <th className="text-right">Erro na página</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
                    {dias.map((x) => (
                      <tr key={x.dia}>
                        <td>{ddmm(x.dia)}</td>
                        <td>{inteiro(x.sessoes)}</td>
                        <td>{x.rolagem === null ? "—" : `${decimal(x.rolagem, 0)}%`}</td>
                        <td>{segundos(x.tempoAtivo)}</td>
                        <td>{x.voltaRapida === null ? "—" : `${decimal(x.voltaRapida, 1)}%`}</td>
                        <td>{x.cliqueMorto === null ? "—" : `${decimal(x.cliqueMorto, 1)}%`}</td>
                        <td>{x.erroScript === null ? "—" : `${decimal(x.erroScript, 1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              </TodosNumeros>
            )}
          </>
        )}
      </Secao>
    </>
  );
}

// ───────────────────────────── Cadastros e vendas ─────────────────────────────

function AbaVendas(d: DadosDetalhe) {
  const t = d.total;
  const direta = d.funil === "venda_direta";
  const comTeste = d.funil === "cadastro_teste_venda";
  const achados = achadosDaArea(d, "vendas");
  return (
    <>
      <Indicadores className={`grid-cols-2 ${comTeste || direta ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        {direta ? (
          <>
            <Indicador rotulo="Compras (Meta)" valor={inteiro(t.compras_meta)} detalhe="o que o Gerenciador conta" />
            <Indicador
              rotulo="Pagamento pendente"
              valor={inteiro(t.vendas_pendentes)}
              detalhe={t.vendas_pendentes ? `${moeda(t.valor_pendente, d.moeda)} em Pix ou boleto` : "Pix ou boleto gerados"}
            />
          </>
        ) : (
          <>
            <Indicador rotulo="Cadastros no sistema" valor={inteiro(t.leads)} detalhe="chegaram com o anúncio de origem" />
            {comTeste && (
              <Indicador
                rotulo="Testes grátis"
                valor={inteiro(t.testes)}
                detalhe={t.leads ? `${pct(razao(t.testes, t.leads), 0)} dos cadastros${t.testes_cancelados ? ` · ${rotuloCancelados(t.testes_cancelados)}` : ""}` : undefined}
              />
            )}
          </>
        )}
        <Indicador rotulo="Vendas" valor={inteiro(t.vendas)} detalhe={t.receita ? `${moeda(t.receita, d.moeda)} de receita` : "pagamentos confirmados"} />
        <Indicador rotulo="Custo por venda" valor={moeda(razao(t.gasto, t.vendas), d.moeda)} detalhe="investido ÷ vendas" destaque />
        <Indicador
          rotulo="Retorno (ROAS)"
          valor={roas(t.receita, t.gasto)}
          detalhe={t.receita ? `${moeda(razao(t.receita, t.gasto), d.moeda)} de volta para cada R$ 1` : undefined}
          destaque
        />
      </Indicadores>
      <SugestoesDaArea
        achados={achados}
        acoes={d.acoes}
        padrao={direta ? "As vendas estão chegando com o anúncio de origem" : "Cadastros, testes e vendas chegando como esperado"}
      />

      {!direta && (
        <Cartao>
          <GraficoAcumulado pontos={d.pontos} titulo={`${d.usarMeta ? "Cadastros (Meta)" : "Cadastros (sistema)"} acumulados: últimos 7 dias contra os 7 anteriores`} />
          {d.ultimoPontoEmAndamento && (
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
                  {d.pontos.map((p) => (
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
      )}

      <TodosNumeros titulo={direta ? "Por que as compras da Meta e as vendas são diferentes?" : "Por que os cadastros da Meta e do sistema são diferentes?"}>
        <p className="max-w-3xl px-5 py-4 text-sm leading-relaxed text-ink-2">
          {direta ? (
            <>
              <strong className="text-ink">Compras (Meta)</strong> é o que o Gerenciador conta pelo pixel. <strong className="text-ink">Vendas</strong> é o que a sua plataforma
              confirmou, com o anúncio de origem; Pix e boleto só contam depois de pagos, e reembolso e chargeback descontam da receita.
            </>
          ) : (
            <>
              <strong className="text-ink">Cadastros (Meta)</strong> é o que o Gerenciador conta pelo pixel. <strong className="text-ink">Cadastros no sistema</strong> é o que
              chegou à sua fonte de venda com o anúncio de origem; é sobre ele que calculamos {comTeste ? "testes, vendas" : "vendas"} e o retorno.
              {comTeste && " Testes conta quem iniciou; cancelados são os que desistiram antes da cobrança, e a venda só entra quando o pagamento acontece."} A diferença costuma
              vir de quem bloqueia o rastreio no navegador ou chega sem os parâmetros do anúncio.
            </>
          )}
        </p>
      </TodosNumeros>
    </>
  );
}
