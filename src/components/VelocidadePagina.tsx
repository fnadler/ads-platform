import type { ReactNode } from "react";
import { AbasAparelho } from "@/components/AbasAparelho";
import { AcoesVelocidade } from "@/components/AcoesVelocidade";
import { CarrosselVelocidade } from "@/components/CarrosselVelocidade";
import { IconeExterno } from "@/components/Icones";
import { Aviso, Etiqueta, Vazio } from "@/components/ui";
import { lerVelocidade, tempo } from "@/lib/pagespeed/diagnostico";
import type { Categoria, MetricaCampo, ResumoVelocidade } from "@/lib/pagespeed/resumo";
import { pct } from "@/lib/formato";

// Velocidade da página de destino, no celular e no computador (abas): as três medidas que importam (com a
// faixa do Google) e, em carrossel, o que está atrasando e o que fazer. Os números vêm de um teste de
// laboratório; quando o Google tem visitas reais suficientes (Chrome), elas aparecem também, na mesma barra
// bom / precisa melhorar / ruim que o painel do Clarity usa.

export interface TesteVersao {
  teste: ResumoVelocidade | null;
  historico: Array<{ testadoEm: string; nota: number | null; lcp: number | null }>;
}

export interface DadosVelocidade {
  pagina: string;
  outras: number;
  celular: TesteVersao;
  computador: TesteVersao;
  disponivel: boolean;
}

const TOM_CATEGORIA: Record<Categoria, { tom: "ok" | "alerta" | "erro"; rotulo: string }> = {
  bom: { tom: "ok", rotulo: "Bom" },
  melhorar: { tom: "alerta", rotulo: "Precisa melhorar" },
  ruim: { tom: "erro", rotulo: "Ruim" },
};

const NOME_CAMPO: Record<MetricaCampo, string> = {
  LCP: "Conteúdo principal aparece",
  INP: "Resposta aos toques",
  CLS: "Coisas mudando de lugar",
  FCP: "Primeira coisa aparece",
  TTFB: "Resposta do servidor",
};

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const semProtocolo = (u: string) => u.replace(/^https?:\/\//, "");

export function VelocidadePagina({
  v,
  acoes,
  projetoClarity,
  participacao,
}: {
  v: DadosVelocidade;
  acoes?: { orgId: string; campanha: string };
  projetoClarity?: string | null;
  /** Fração das visitas da campanha em cada aparelho (Clarity), para mostrar nas abas. */
  participacao?: { celular: number; computador: number } | null;
}) {
  if (!v.celular.teste && !v.computador.teste)
    return (
      <Vazio titulo="A velocidade desta página ainda não foi testada" acao={acoes ? <AcoesVelocidade orgId={acoes.orgId} campanha={acoes.campanha} podeTestar={v.disponivel} /> : null}>
        {v.disponivel
          ? `O teste abre ${semProtocolo(v.pagina)} num celular e num computador simulados e aponta o que deixa a página lenta, com o que fazer. Ele roda sozinho todo dia às 6h para as páginas dos anúncios ativos.`
          : "Falta configurar a chave do PageSpeed (PAGESPEED_API_KEY) no servidor."}
      </Vazio>
    );

  const visitas = (f: number | undefined) => (f === undefined ? undefined : `${pct(f, 0)} das visitas`);
  return (
    <AbasAparelho
      abas={[
        {
          chave: "celular",
          rotulo: "Celular",
          detalhe: visitas(participacao?.celular),
          conteudo: <PainelVersao versao={v.celular} aparelho="celular" v={v} acoes={acoes} projetoClarity={projetoClarity} />,
        },
        {
          chave: "computador",
          rotulo: "Computador",
          detalhe: visitas(participacao?.computador),
          conteudo: <PainelVersao versao={v.computador} aparelho="computador" v={v} acoes={acoes} projetoClarity={projetoClarity} />,
        },
      ]}
    />
  );
}

function PainelVersao({
  versao,
  aparelho,
  v,
  acoes,
  projetoClarity,
}: {
  versao: TesteVersao;
  aparelho: "celular" | "computador";
  v: DadosVelocidade;
  acoes?: { orgId: string; campanha: string };
  projetoClarity?: string | null;
}) {
  const teste = versao.teste;
  const leitura = teste ? lerVelocidade(teste) : null;
  const botoes = acoes ? <AcoesVelocidade orgId={acoes.orgId} campanha={acoes.campanha} texto={leitura?.textoTecnico} podeTestar={v.disponivel} /> : null;

  if (!teste || !leitura)
    return (
      <Vazio titulo={`Ainda não há teste no ${aparelho}`} acao={botoes}>
        O próximo teste (todo dia às 6h, ou agora pelo botão) mede a página no celular e no computador.
      </Vazio>
    );

  const anteriores = versao.historico.filter((h) => h.nota !== null).slice(-6);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">
          Teste de {semProtocolo(teste.url)} no {aparelho} em {dataHora(teste.testadoEm)}
          {teste.nota !== null && (
            <>
              {" "}
              · nota <strong className="font-[600] text-ink">{teste.nota}/100</strong>
            </>
          )}
          {anteriores.length > 1 && <> (últimos testes: {anteriores.map((h) => h.nota).join(" → ")})</>}
          {v.outras > 0 && <>. A campanha leva a mais {v.outras === 1 ? "uma página" : `${v.outras} páginas`}; aqui está a dos anúncios ativos.</>}
        </p>
        {botoes}
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card sm:grid-cols-3">
        {leitura.medidas.map((m) => (
          <div key={m.chave} className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="text-sm text-ink-2">{m.rotulo}</span>
            <span className="num-display text-2xl text-ink sm:text-[28px] sm:leading-9">{m.valor}</span>
            <span className="flex flex-wrap items-center gap-2">
              {m.categoria && <Etiqueta tom={TOM_CATEGORIA[m.categoria].tom}>{TOM_CATEGORIA[m.categoria].rotulo}</Etiqueta>}
              <span className="text-xs text-ink-3">{m.explica}</span>
            </span>
          </div>
        ))}
      </div>

      {teste.campo && <VisitasReais campo={teste.campo} />}

      <Aviso>
        <span>
          {teste.campo
            ? "Os números de cima são de um teste de laboratório; a barra de visitas reais vem do Chrome (últimos 28 dias). "
            : aparelho === "celular"
              ? "Teste de laboratório: um celular simulado, com internet 4G e nada guardado em cache. O Google ainda não tem visitas reais suficientes desta página para medir. "
              : "Teste de laboratório: um computador simulado, com internet de banda larga e nada guardado em cache. O Google ainda não tem visitas reais suficientes desta página para medir. "}
          {aparelho === "celular" && "Quem abre pelo Instagram ou pelo Facebook costuma ver a página mais devagar: o navegador desses apps é mais pesado e a rede do celular varia."}
          {projetoClarity && (
            <>
              {" "}
              A velocidade nas visitas reais aparece no painel do Clarity, em Desempenho.{" "}
              <a href={`https://clarity.microsoft.com/projects/view/${projetoClarity}/dashboard`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-[550] text-accent-text">
                Abrir o Clarity <IconeExterno tamanho={13} />
              </a>
            </>
          )}
        </span>
      </Aviso>

      {leitura.diagnosticos.length ? (
        <CarrosselVelocidade diagnosticos={leitura.diagnosticos} titulo="O que deixa a página mais lenta e o que fazer" />
      ) : (
        <Aviso tom="ok">Nada importante a corrigir na velocidade desta página no {aparelho}.</Aviso>
      )}
    </div>
  );
}

const COR_FAIXA = ["var(--color-ok)", "var(--color-warn)", "var(--color-err)"];
const NOME_FAIXA = ["bom", "precisa melhorar", "ruim"];

/** Dados de campo do Chrome: a barra bom / precisa melhorar / ruim de cada medida, com o valor do percentil 75. */
function VisitasReais({ campo }: { campo: NonNullable<ResumoVelocidade["campo"]> }) {
  const ordem: MetricaCampo[] = ["LCP", "INP", "CLS"];
  const itens = ordem.flatMap((k) => (campo.metricas[k] ? [[k, campo.metricas[k]!] as const] : []));
  if (!itens.length) return null;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card">
      <h3 className="text-base font-[600] text-ink">
        Visitas reais no Chrome {campo.fonte === "site" ? "(site todo: esta página ainda tem poucas visitas)" : "(esta página)"}
      </h3>
      {itens.map(([k, m]) => (
        <Faixa key={k} rotulo={NOME_CAMPO[k]} valor={k === "CLS" ? m.p75.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : tempo(m.p75)} dist={m.distribuicao} categoria={m.categoria}>
          {k === "INP" ? "o toque mais lento de 3 em cada 4 visitas" : "3 em cada 4 visitas ficam abaixo disso"}
        </Faixa>
      ))}
    </section>
  );
}

function Faixa({ rotulo, valor, dist, categoria: cat, children }: { rotulo: string; valor: string; dist: [number, number, number]; categoria: Categoria; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-ink">
          {rotulo}: <strong className="font-[650] tabular-nums">{valor}</strong> <span className="text-xs text-ink-3">({children})</span>
        </span>
        <Etiqueta tom={TOM_CATEGORIA[cat].tom}>{TOM_CATEGORIA[cat].rotulo}</Etiqueta>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={dist.map((p, i) => `${pct(p, 0)} ${NOME_FAIXA[i]}`).join(", ")}>
        {dist.map((p, i) => (p > 0 ? <div key={i} style={{ width: `${p * 100}%`, background: COR_FAIXA[i] }} title={`${pct(p, 1)} ${NOME_FAIXA[i]}`} /> : null))}
      </div>
      <p className="text-xs text-ink-3">{dist.map((p, i) => `${pct(p, 0)} ${NOME_FAIXA[i]}`).join(" · ")}</p>
    </div>
  );
}
