import type { Metadata } from "next";
import Link from "next/link";
import { GraficoAcumulado, type PontoComparacao } from "@/components/GraficoAcumulado";
import { IconeVoltar } from "@/components/Icones";
import { Aviso, Cartao, corAnuncio, Indicador, Indicadores, MiniaturaCriativo, Tabela, Titulo, Vazio } from "@/components/ui";
import { exigirOrganizacao } from "@/lib/auth/sessao";
import { decimal, inteiro, moeda, pct, razao } from "@/lib/formato";
import { rotaOrg } from "@/lib/rotas";

export const metadata: Metadata = { title: "Desempenho" };

interface Linha {
  account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  status: string | null;
  imagem_path: string | null;
  gasto: number;
  impressoes: number;
  frequencia: number;
  cliques_link: number;
  visualizacoes_pagina: number;
  leads_meta: number;
  leads: number;
  testes: number;
  vendas: number;
  receita: number;
}

type Soma = Pick<Linha, "gasto" | "impressoes" | "cliques_link" | "visualizacoes_pagina" | "leads_meta" | "leads" | "testes" | "vendas" | "receita"> & { freqPeso: number };
const zero = (): Soma => ({
  gasto: 0,
  impressoes: 0,
  cliques_link: 0,
  visualizacoes_pagina: 0,
  leads_meta: 0,
  leads: 0,
  testes: 0,
  vendas: 0,
  receita: 0,
  freqPeso: 0,
});
function somar(s: Soma, l: Linha) {
  for (const k of ["gasto", "impressoes", "cliques_link", "visualizacoes_pagina", "leads_meta", "leads", "testes", "vendas", "receita"] as const) s[k] += Number(l[k]);
  s.freqPeso += Number(l.frequencia) * Number(l.impressoes);
  return s;
}

const PERIODOS = [7, 14, 30, 90];
const dia = (offset: number, fuso: string) =>
  new Date(Date.now() - offset * 86_400_000).toLocaleDateString("sv-SE", {
    timeZone: fuso,
  });
const rotuloDia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    })
    .replace(".", "");

export default async function Desempenho({ params, searchParams }: PageProps<"/o/[org]/desempenho">) {
  const { org: slug } = await params;
  const busca = await searchParams;
  const dias = PERIODOS.includes(Number(busca.dias)) ? Number(busca.dias) : 7;
  const campanha = typeof busca.campanha === "string" && /^\d+$/.test(busca.campanha) ? busca.campanha : null;
  const { org, supabase } = await exigirOrganizacao(slug);
  const de = dia(dias - 1, org.fuso);
  const ate = dia(0, org.fuso);

  const [{ data: dados, error }, { data: serie }] = await Promise.all([
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
  ]);
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
    const tudo = { dias, campanha, ...extra };
    for (const [k, v] of Object.entries(tudo)) if (v !== null && v !== undefined && !(k === "dias" && v === 7)) q.set(k, String(v));
    return `${rotaOrg(slug, "/desempenho")}${q.size ? `?${q}` : ""}`;
  };
  const nomeCampanha = campanha ? (campanhas.get(campanha)?.nome ?? campanha) : null;
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
  const roas = (receita: number, gasto: number) => (receita ? decimal(razao(receita, gasto)) : "—");
  const destaque = "bg-accent-soft font-semibold text-ink";

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
          <div role="tablist" aria-label="Período" className="flex gap-1 rounded-lg bg-sunken p-1">
            {PERIODOS.map((d) => (
              <Link
                key={d}
                href={link({ dias: d })}
                role="tab"
                aria-selected={d === dias}
                className={`flex min-h-10 items-center rounded-md px-3.5 text-sm font-medium no-underline ${d === dias ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink hover:no-underline"}`}
              >
                {d} dias
              </Link>
            ))}
          </div>
        }
      >
        {nomeCampanha ?? "Quais anúncios trazem venda"}
      </Titulo>

      {semDados ? (
        <Vazio titulo="Sem dados no período">Confira em Sincronizações se a Meta já foi carregada, ou escolha um período maior.</Vazio>
      ) : (
        <div className="grid gap-5">
          <Indicadores className="grid-cols-2 xl:grid-cols-4">
            <Indicador rotulo="Gasto" valor={moeda(total.gasto, org.moeda)} detalhe="na Meta, no período" />
            <Indicador rotulo="Leads (Meta)" valor={inteiro(total.leads_meta)} detalhe="o que o Gerenciador conta" />
            <Indicador rotulo="Custo por lead" valor={moeda(razao(total.gasto, total.leads_meta), org.moeda)} detalhe="gasto ÷ leads (Meta)" />
            <Indicador rotulo="Leads (sistema)" valor={inteiro(total.leads)} detalhe="chegaram com o anúncio" />
            <Indicador rotulo="Testes" valor={inteiro(total.testes)} detalhe={total.leads ? `${pct(razao(total.testes, total.leads), 0)} dos leads` : undefined} />
            <Indicador rotulo="Vendas" valor={inteiro(total.vendas)} detalhe={total.receita ? `${moeda(total.receita, org.moeda)} de receita` : undefined} />
            <Indicador rotulo="Custo por venda" valor={moeda(razao(total.gasto, total.vendas), org.moeda)} detalhe="gasto ÷ vendas" destaque />
            <Indicador
              rotulo="ROAS"
              valor={roas(total.receita, total.gasto)}
              detalhe={total.receita ? `${moeda(razao(total.receita, total.gasto), org.moeda)} de volta por R$ 1` : undefined}
              destaque
            />
          </Indicadores>

          <Aviso>
            <strong>Leads (Meta)</strong> é o que o Gerenciador conta pelo pixel. <strong>Leads (sistema)</strong> é o que chegou à sua fonte de venda com o anúncio de origem; é
            sobre ele que calculamos testes, vendas e ROAS.
          </Aviso>

          <Cartao>
            <GraficoAcumulado pontos={pontos} titulo={`${usarMeta ? "Leads (Meta)" : "Leads (sistema)"} acumulados${nomeCampanha ? ` · ${nomeCampanha}` : ""}`} />
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

          {!campanha ? (
            <Cartao titulo={`Campanhas · últimos ${dias} dias`} acoes={<span className="text-sm text-ink-3">Clique numa campanha para ver os anúncios</span>} rente>
              <Tabela>
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th className="text-right">Gasto</th>
                    <th className="text-right">Impressões</th>
                    <th className="text-right">Freq.</th>
                    <th className="text-right">CTR</th>
                    <th className="text-right">Leads (Meta)</th>
                    <th className="text-right">CPL</th>
                    <th className="text-right">Leads (sist.)</th>
                    <th className="text-right">Testes</th>
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
                        </td>
                        <td>{moeda(c.soma.gasto, org.moeda)}</td>
                        <td>{inteiro(c.soma.impressoes)}</td>
                        <td>{decimal(razao(c.soma.freqPeso, c.soma.impressoes))}</td>
                        <td>{pct(razao(c.soma.cliques_link, c.soma.impressoes), 2)}</td>
                        <td>{inteiro(c.soma.leads_meta)}</td>
                        <td>{moeda(razao(c.soma.gasto, c.soma.leads_meta), org.moeda)}</td>
                        <td>{inteiro(c.soma.leads)}</td>
                        <td>{inteiro(c.soma.testes)}</td>
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
                      <td>{inteiro(total.leads_meta)}</td>
                      <td>{moeda(razao(total.gasto, total.leads_meta), org.moeda)}</td>
                      <td>{inteiro(total.leads)}</td>
                      <td>{inteiro(total.testes)}</td>
                      <td>{inteiro(total.vendas)}</td>
                      <td className={destaque}>{moeda(razao(total.gasto, total.vendas), org.moeda)}</td>
                      <td className={destaque}>{roas(total.receita, total.gasto)}</td>
                    </tr>
                  )}
                </tbody>
              </Tabela>
            </Cartao>
          ) : (
            <>
              {porConjunto.size > 1 && (
                <Cartao titulo="Públicos (conjuntos)" acoes={<span className="text-sm text-ink-3">Qual público vende</span>} rente>
                  <Tabela>
                    <thead>
                      <tr>
                        <th>Conjunto</th>
                        <th className="text-right">Gasto</th>
                        <th className="text-right">Leads (Meta)</th>
                        <th className="text-right">CPL</th>
                        <th className="text-right">Leads (sist.)</th>
                        <th className="text-right">Testes</th>
                        <th className="text-right">Vendas</th>
                        <th className="!bg-accent-soft text-right !text-ink">Custo/venda</th>
                        <th className="!bg-accent-soft text-right !text-ink">ROAS</th>
                      </tr>
                    </thead>
                    <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
                      {[...porConjunto]
                        .sort(([, a], [, b]) => b.soma.gasto - a.soma.gasto)
                        .map(([k, cj]) => (
                          <tr key={k}>
                            <td className="font-medium text-ink">{cj.nome}</td>
                            <td>{moeda(cj.soma.gasto, org.moeda)}</td>
                            <td>{inteiro(cj.soma.leads_meta)}</td>
                            <td>{moeda(razao(cj.soma.gasto, cj.soma.leads_meta), org.moeda)}</td>
                            <td>{inteiro(cj.soma.leads)}</td>
                            <td>{inteiro(cj.soma.testes)}</td>
                            <td>{inteiro(cj.soma.vendas)}</td>
                            <td className={destaque}>{moeda(razao(cj.soma.gasto, cj.soma.vendas), org.moeda)}</td>
                            <td className={destaque}>{roas(cj.soma.receita, cj.soma.gasto)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </Tabela>
                </Cartao>
              )}
              <Cartao titulo="Anúncios" acoes={<span className="text-sm text-ink-3">Do cadastro à venda, por criativo</span>} rente>
                <Tabela>
                  <thead>
                    <tr>
                      <th>Anúncio</th>
                      <th className="text-right">Gasto</th>
                      <th className="text-right">Freq.</th>
                      <th className="text-right">CTR</th>
                      <th className="text-right">Leads (Meta)</th>
                      <th className="text-right">CPL</th>
                      <th className="text-right">Leads (sist.)</th>
                      <th className="text-right">Testes</th>
                      <th className="text-right">Vendas</th>
                      <th className="!bg-accent-soft text-right !text-ink">Custo/venda</th>
                      <th className="!bg-accent-soft text-right !text-ink">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap">
                    {[...linhas]
                      .sort((a, b) => Number(b.gasto) - Number(a.gasto))
                      .map((l) => (
                        <tr key={l.ad_id}>
                          <td>
                            <div className="flex items-center gap-3">
                              <MiniaturaCriativo src={l.imagem_path ? urls.get(l.imagem_path) : null} cor={corAnuncio(ordemCor.get(l.ad_id) ?? 0)} className="w-11" />
                              <div className="min-w-0">
                                <div className="font-medium text-ink">{l.ad_name ?? l.ad_id}</div>
                                <div className="text-xs text-ink-3">{l.adset_name}</div>
                              </div>
                            </div>
                          </td>
                          <td>{moeda(Number(l.gasto), org.moeda)}</td>
                          <td>{decimal(Number(l.frequencia))}</td>
                          <td>{pct(razao(Number(l.cliques_link), Number(l.impressoes)), 2)}</td>
                          <td>{inteiro(Number(l.leads_meta))}</td>
                          <td>{moeda(razao(Number(l.gasto), Number(l.leads_meta)), org.moeda)}</td>
                          <td>{inteiro(Number(l.leads))}</td>
                          <td>{inteiro(Number(l.testes))}</td>
                          <td>{inteiro(Number(l.vendas))}</td>
                          <td className={destaque}>{moeda(razao(Number(l.gasto), Number(l.vendas)), org.moeda)}</td>
                          <td className={destaque}>{roas(Number(l.receita), Number(l.gasto))}</td>
                        </tr>
                      ))}
                  </tbody>
                </Tabela>
              </Cartao>
            </>
          )}
        </div>
      )}
    </>
  );
}
