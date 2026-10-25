/* eslint-disable @next/next/no-img-element -- miniaturas vêm de URL assinada do Storage, que expira */
import type { Metadata } from "next";
import Link from "next/link";
import { GraficoAcumulado, type PontoComparacao } from "@/components/GraficoAcumulado";
import { Aviso, Cartao, Tabela, Titulo } from "@/components/ui";
import { exigirOrganizacao } from "@/lib/auth/sessao";
import { decimal, inteiro, moeda, pct, razao } from "@/lib/formato";
import { rotaOrg } from "@/lib/rotas";

export const metadata: Metadata = { title: "Desempenho" };

interface Linha {
  account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
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
const zero = (): Soma => ({ gasto: 0, impressoes: 0, cliques_link: 0, visualizacoes_pagina: 0, leads_meta: 0, leads: 0, testes: 0, vendas: 0, receita: 0, freqPeso: 0 });
function somar(s: Soma, l: Linha) {
  for (const k of ["gasto", "impressoes", "cliques_link", "visualizacoes_pagina", "leads_meta", "leads", "testes", "vendas", "receita"] as const) s[k] += Number(l[k]);
  s.freqPeso += Number(l.frequencia) * Number(l.impressoes);
  return s;
}

const PERIODOS = [7, 14, 30, 90];
const dia = (offset: number, fuso: string) => new Date(Date.now() - offset * 86_400_000).toLocaleDateString("sv-SE", { timeZone: fuso });
const rotuloDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(".", "");

export default async function Desempenho({ params, searchParams }: PageProps<"/o/[org]/desempenho">) {
  const { org: slug } = await params;
  const busca = await searchParams;
  const dias = PERIODOS.includes(Number(busca.dias)) ? Number(busca.dias) : 7;
  const campanha = typeof busca.campanha === "string" && /^\d+$/.test(busca.campanha) ? busca.campanha : null;
  const { org, supabase } = await exigirOrganizacao(slug);
  const de = dia(dias - 1, org.fuso);
  const ate = dia(0, org.fuso);

  const [{ data: dados, error }, { data: serie }] = await Promise.all([
    supabase.rpc("desempenho_anuncios", { p_org: org.id, p_de: de, p_ate: ate }),
    supabase.rpc("leads_por_dia", { p_org: org.id, p_de: dia(13, org.fuso), p_ate: ate, p_campanha: campanha }),
  ]);
  if (error) return <Aviso tom="erro">Não foi possível carregar: {error.message}</Aviso>;
  const linhas = ((dados as Linha[]) ?? []).filter((l) => !campanha || l.campaign_id === campanha);

  // Campanhas (soma dos anúncios) e total.
  const campanhas = new Map<string, { nome: string; soma: Soma; anuncios: number }>();
  const total = zero();
  for (const l of linhas) {
    somar(total, l);
    const id = l.campaign_id ?? "—";
    const c = campanhas.get(id) ?? { nome: l.campaign_name ?? id, soma: zero(), anuncios: 0 };
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

  return (
    <>
      <Titulo
        descricao={
          campanha ? (
            <Link href={link({ campanha: null })} className="text-marca hover:underline">
              ← Todas as campanhas
            </Link>
          ) : (
            "Gasto e resultado por campanha e anúncio. Leads (Meta) é o que o Gerenciador conta; Leads (sistema), Testes e Vendas são o que chegou da sua fonte de venda com o anúncio de origem."
          )
        }
        acoes={
          <div className="flex gap-1 text-sm">
            {PERIODOS.map((d) => (
              <Link key={d} href={link({ dias: d })} className={`rounded-md px-3 py-1.5 ${d === dias ? "bg-superficie font-medium shadow-sm" : "text-suave hover:text-texto"}`}>
                {d} dias
              </Link>
            ))}
          </div>
        }
      >
        {nomeCampanha ?? "Desempenho"}
      </Titulo>

      {semDados ? (
        <Aviso>Sem dados no período. Confira em Sincronizações se a Meta já foi carregada.</Aviso>
      ) : (
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["Gasto", moeda(total.gasto, org.moeda)],
              ["Leads (Meta)", inteiro(total.leads_meta)],
              ["Custo por lead", moeda(razao(total.gasto, total.leads_meta), org.moeda)],
              ["Leads (sistema)", inteiro(total.leads)],
              ["Testes", inteiro(total.testes)],
              ["Vendas", inteiro(total.vendas)],
              ["Custo por venda", moeda(razao(total.gasto, total.vendas), org.moeda)],
              ["ROAS", total.receita ? decimal(razao(total.receita, total.gasto)) : "—"],
            ].map(([rotulo, v]) => (
              <div key={rotulo} className="rounded-lg border border-borda bg-superficie p-3">
                <div className="text-xs text-suave">{rotulo}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          <Cartao>
            <GraficoAcumulado pontos={pontos} titulo={`${usarMeta ? "Leads (Meta)" : "Leads (sistema)"} acumulados${nomeCampanha ? ` · ${nomeCampanha}` : ""}`} />
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-suave">Ver em tabela</summary>
              <Tabela>
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Acumulado</th>
                    <th>Dia anterior equivalente</th>
                    <th>Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {pontos.map((p) => (
                    <tr key={p.rotulo}>
                      <td>{p.rotulo}</td>
                      <td>{inteiro(p.atual)}</td>
                      <td>{p.rotuloAnterior}</td>
                      <td>{inteiro(p.anterior)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </details>
          </Cartao>

          {!campanha ? (
            <Cartao titulo="Campanhas">
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
                    <th className="text-right">Leads (sistema)</th>
                    <th className="text-right">Testes</th>
                    <th className="text-right">Vendas</th>
                    <th className="text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums [&_td:not(:first-child)]:text-right">
                  {[...campanhas].sort(([, a], [, b]) => b.soma.gasto - a.soma.gasto).map(([id, c]) => (
                    <tr key={id}>
                      <td>
                        <Link href={link({ campanha: id })} className="font-medium hover:text-marca">
                          {c.nome}
                        </Link>
                        <div className="text-xs text-suave">{c.anuncios} anúncio(s) com gasto</div>
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
                      <td>{c.soma.receita ? decimal(razao(c.soma.receita, c.soma.gasto)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </Cartao>
          ) : (
            <Cartao titulo="Anúncios">
              <Tabela>
                <thead>
                  <tr>
                    <th>Anúncio</th>
                    <th className="text-right">Gasto</th>
                    <th className="text-right">Freq.</th>
                    <th className="text-right">CTR</th>
                    <th className="text-right">Leads (Meta)</th>
                    <th className="text-right">CPL</th>
                    <th className="text-right">Leads (sistema)</th>
                    <th className="text-right">Testes</th>
                    <th className="text-right">Vendas</th>
                    <th className="text-right">Custo/venda</th>
                    <th className="text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums [&_td:not(:first-child)]:text-right">
                  {[...linhas].sort((a, b) => Number(b.gasto) - Number(a.gasto)).map((l) => (
                    <tr key={l.ad_id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {l.imagem_path && urls.get(l.imagem_path) ? (
                            <img src={urls.get(l.imagem_path)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                          ) : (
                            <div className="h-12 w-12 shrink-0 rounded bg-fundo" />
                          )}
                          <div>
                            <div className="font-medium">{l.ad_name ?? l.ad_id}</div>
                            <div className="text-xs text-suave">{l.adset_name}</div>
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
                      <td>{moeda(razao(Number(l.gasto), Number(l.vendas)), org.moeda)}</td>
                      <td>{Number(l.receita) ? decimal(razao(Number(l.receita), Number(l.gasto))) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </Cartao>
          )}
        </div>
      )}
    </>
  );
}
