// Leitura da campanha: transforma os números diários em achados com o que fazer. Sem banco nem rede
// (os dados chegam prontos de carregar.ts), para ser testável com casos reais.
//
// Princípios:
//   • Só dias completos entram nas comparações: hoje ainda está em andamento.
//   • Toda mudança passa por um teste de ruído antes de virar "agir" (amostras de dezenas de leads).
//   • A queda de leads é decomposta pelas etapas do funil, para apontar onde agir — anúncio, leilão,
//     entrega ou página —, em vez de chamar tudo de "saturação".
//   • "Aguardar" é um resultado explícito, com a data em que haverá dado para decidir.

import { zProporcoes, zTaxas, probNenhum, significativo } from "./estatistica";
import { moeda, pct, decimal, inteiro } from "@/lib/formato";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";

export interface DiaCampanha {
  dia: string; // AAAA-MM-DD no fuso da organização
  gasto: number;
  impressoes: number;
  frequencia: number;
  cliques_link: number;
  visualizacoes_pagina: number;
  leads_meta: number;
  leads: number; // que chegaram ao sistema, pelo dia do cadastro
  testes: number; // desses leads, quantos iniciaram teste
}

export interface AnuncioResumo {
  ad_id: string;
  nome: string;
  gasto: number;
  impressoes: number;
  leads_meta: number;
  leads: number;
  testes: number;
}

/** Experiência na página no dia (Clarity, total do site). Nulo quando a métrica não veio. */
export interface DiaClarity {
  dia: string;
  sessoes: number | null;
  rolagem: number | null; // profundidade média de rolagem, em %
  tempoAtivo: number | null; // segundos
  voltaRapida: number | null; // % das sessões com volta rápida
  cliqueMorto: number | null; // % das sessões com clique sem resposta
  cliqueRaiva: number | null; // % das sessões com cliques repetidos de irritação
  erroScript: number | null; // % das sessões com erro de JavaScript
}

export interface EntradaLeitura {
  hoje: string;
  /** Hora local da última sincronização da Meta (para dizer até quando vai o dia de hoje). */
  sincronizadoAs?: string | null;
  funil: Funil;
  diasTeste: number;
  moeda: string;
  dias: DiaCampanha[];
  anuncios: AnuncioResumo[];
  /** Início (ISO) dos testes que ainda não foram cobrados nem cancelados. */
  testesAtivos: string[];
  vendas: number;
  /** O Clarity está conectado (mesmo que ainda sem dias coletados). */
  clarityConectado?: boolean;
  clarity: DiaClarity[];
}

export type TomAchado = "agir" | "observar" | "aguardar" | "ok";

export interface Achado {
  id: string;
  tom: TomAchado;
  titulo: string;
  texto: string;
  acao?: string;
}

export interface Leitura {
  achados: Achado[];
  /** Dias completos considerados (o último é a referência da leitura). */
  diasCompletos: number;
  ultimoDiaCompleto: string | null;
  nota: string | null;
}

const ORDEM: Record<TomAchado, number> = { agir: 0, observar: 1, aguardar: 2, ok: 3 };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const variacao = (de: number, para: number) => (de ? para / de - 1 : 0);
const sinal = (v: number) => `${v > 0 ? "+" : ""}${pct(v, 0)}`;
const juntarE = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}` : (xs[0] ?? ""));
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

interface Janela {
  dias: number;
  de: string;
  ate: string;
  gasto: number;
  impressoes: number;
  freqPeso: number;
  cliques: number;
  lpv: number;
  leadsMeta: number;
  leads: number;
  testes: number;
}

function janela(ds: DiaCampanha[]): Janela {
  const j: Janela = { dias: ds.length, de: ds[0]?.dia ?? "", ate: ds.at(-1)?.dia ?? "", gasto: 0, impressoes: 0, freqPeso: 0, cliques: 0, lpv: 0, leadsMeta: 0, leads: 0, testes: 0 };
  for (const d of ds) {
    j.gasto += d.gasto;
    j.impressoes += d.impressoes;
    j.freqPeso += d.frequencia * d.impressoes;
    j.cliques += d.cliques_link;
    j.lpv += d.visualizacoes_pagina;
    j.leadsMeta += d.leads_meta;
    j.leads += d.leads;
    j.testes += d.testes;
  }
  return j;
}
const periodo = (j: Janela) => (j.de === j.ate ? ddmm(j.de) : `${ddmm(j.de)}–${ddmm(j.ate)}`);

// ───────────────────────────── Regras ─────────────────────────────

/** Etapas do funil: leads/dia = gasto/dia × impressões/real × CTR × visitas/clique × leads/visita. */
type Etapa = "entrega" | "leilao" | "anuncio" | "carregamento" | "pagina";

function decompor(base: Janela, rec: Janela, usarMeta: boolean) {
  const leads = (j: Janela) => (usarMeta ? j.leadsMeta : j.leads);
  const fatores: Record<Etapa, [number, number]> = {
    entrega: [base.gasto / base.dias, rec.gasto / rec.dias],
    leilao: [base.impressoes / base.gasto, rec.impressoes / rec.gasto],
    anuncio: [base.cliques / base.impressoes, rec.cliques / rec.impressoes],
    carregamento: [base.lpv / base.cliques, rec.lpv / rec.cliques],
    pagina: [leads(base) / base.lpv, leads(rec) / rec.lpv],
  };
  const contrib = Object.fromEntries(Object.entries(fatores).map(([k, [a, b]]) => [k, a > 0 && b > 0 ? Math.log(b / a) : 0])) as Record<Etapa, number>;
  return { fatores, contrib };
}

function experienciaPagina(clarity: DiaClarity[], base: Janela, rec: Janela) {
  const media = (ds: DiaClarity[], k: keyof Omit<DiaClarity, "dia">) => {
    const vs = ds.map((d) => d[k]).filter((v): v is number => typeof v === "number");
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const em = (j: Janela) => clarity.filter((d) => d.dia >= j.de && d.dia <= j.ate);
  const b = em(base);
  const r = em(rec);
  if (!b.length || !r.length) return null;
  const sinais: string[] = [];
  const rolB = media(b, "rolagem");
  const rolR = media(r, "rolagem");
  if (rolB !== null && rolR !== null && rolR < rolB * 0.85) sinais.push(`a rolagem média caiu de ${decimal(rolB, 0)}% para ${decimal(rolR, 0)}% da página`);
  for (const [k, nome, limite] of [
    ["voltaRapida", "sessões com volta rápida", 5],
    ["cliqueMorto", "sessões com clique sem resposta", 5],
    ["cliqueRaiva", "sessões com cliques de irritação", 3],
    ["erroScript", "sessões com erro de script", 2],
  ] as const) {
    const vb = media(b, k);
    const vr = media(r, k);
    if (vb !== null && vr !== null && vr - vb >= limite) sinais.push(`${nome} subiram de ${decimal(vb, 1)}% para ${decimal(vr, 1)}%`);
  }
  return sinais;
}

function regraTendencia(e: EntradaLeitura, completos: DiaCampanha[]): Achado[] {
  if (e.funil === "venda_direta") return []; // sem lead no meio: a leitura por etapa fica para a venda
  if (completos.length < 4)
    return [
      {
        id: "tendencia-amostra",
        tom: "aguardar",
        titulo: "Ainda cedo para ler tendência",
        texto: `Há ${plural(completos.length, "dia completo", "dias completos")} de veiculação. A comparação entre os últimos dias e os anteriores começa com 4.`,
      },
    ];
  const rec = janela(completos.slice(-2));
  const base = janela(completos.slice(-5, -2));
  const usarMeta = base.leadsMeta + rec.leadsMeta > 0;
  const lb = usarMeta ? base.leadsMeta : base.leads;
  const lr = usarMeta ? rec.leadsMeta : rec.leads;
  const rotulo = usarMeta ? "leads (Meta)" : "leads";
  const porDiaB = lb / base.dias;
  const porDiaR = lr / rec.dias;
  const v = variacao(porDiaB, porDiaR);
  const z = zTaxas(lb, base.dias, lr, rec.dias);
  const comparacao = `${decimal(porDiaB, 0)} ${rotulo} por dia em ${periodo(base)} → ${decimal(porDiaR, 0)} em ${periodo(rec)} (${sinal(v)})`;

  if (!significativo(z) || Math.abs(v) < 0.2)
    return [{ id: "tendencia", tom: "ok", titulo: "Ritmo de leads estável", texto: `${comparacao}. A diferença está dentro da variação normal de poucos dias.` }];

  const { fatores, contrib } = decompor(base, rec, usarMeta);
  const queda = v < 0;
  const etapas = (Object.keys(contrib) as Etapa[]).filter((k) => (queda ? contrib[k] < -0.05 : contrib[k] > 0.05)).sort((a, b) => Math.abs(contrib[b]) - Math.abs(contrib[a]));
  const total = Math.abs(Math.log(porDiaR / porDiaB)) || 1;
  const parte = (k: Etapa) => pct(Math.min(Math.abs(contrib[k]) / total, 1), 0);
  const descreve: Record<Etapa, (k: Etapa) => string> = {
    entrega: (k) => `gasto por dia ${moeda(fatores[k][0], e.moeda)} → ${moeda(fatores[k][1], e.moeda)}`,
    leilao: (k) => `CPM ${moeda(1000 / fatores[k][0], e.moeda)} → ${moeda(1000 / fatores[k][1], e.moeda)}`,
    anuncio: (k) => `CTR ${pct(fatores[k][0], 2)} → ${pct(fatores[k][1], 2)}`,
    carregamento: (k) => `visitas à página por clique ${pct(fatores[k][0], 0)} → ${pct(fatores[k][1], 0)}`,
    pagina: (k) => `visitas que viram lead ${pct(fatores[k][0], 0)} → ${pct(fatores[k][1], 0)}`,
  };
  const nomes: Record<Etapa, string> = { entrega: "a entrega", leilao: "o leilão", anuncio: "o anúncio", carregamento: "o carregamento da página", pagina: "a página" };

  if (!queda)
    return [
      {
        id: "tendencia",
        tom: "ok",
        titulo: "Leads em alta",
        texto: `${comparacao}. ${etapas.length ? `Puxado por ${etapas.map((k) => `${nomes[k]} (${descreve[k](k)})`).join(" e ")}.` : ""}`,
      },
    ];

  const principal = etapas[0];
  const detalhes = etapas.map((k) => `${descreve[k](k)} — ${parte(k)} da queda`).join("; ");
  const leadsDe = (j: Janela) => (usarMeta ? j.leadsMeta : j.leads);
  const zEtapa: Partial<Record<Etapa, number>> = {
    pagina: zProporcoes(leadsDe(base), base.lpv, leadsDe(rec), rec.lpv),
    anuncio: zProporcoes(base.cliques, base.impressoes, rec.cliques, rec.impressoes),
    carregamento: zProporcoes(base.lpv, base.cliques, rec.lpv, rec.cliques),
  };
  const firme = principal && (zEtapa[principal] === undefined || significativo(zEtapa[principal]!));

  const acoes: Record<Etapa, { titulo: string; acao: string; tom: TomAchado }> = {
    pagina: {
      titulo: "Queda de leads vem da página, não do anúncio",
      tom: "agir",
      acao: "Revise a página de destino e o cadastro antes de mexer na campanha: faça o caminho do anúncio ao cadastro no celular e confira o que mudou no site nesses dias. Editar a campanha agora reinicia o aprendizado da Meta sem resolver a causa.",
    },
    carregamento: {
      titulo: "Cliques não estão chegando à página",
      tom: "agir",
      acao: "Confira se a página está no ar e rápida no celular, e se o link do anúncio não passa por redirecionamentos.",
    },
    anuncio: {
      titulo: "Anúncios atraindo menos cliques",
      tom: "observar",
      acao: "Se a queda de CTR continuar, prepare criativos novos e teste-os em campanha ou conjunto separado, sem editar os que estão no ar.",
    },
    leilao: {
      titulo: "Leilão mais caro",
      tom: "observar",
      acao: "CPM varia com a concorrência e o dia da semana. Acompanhe; se persistir por uma semana, teste públicos ou criativos novos.",
    },
    entrega: {
      titulo: "A Meta está gastando menos por dia",
      tom: "observar",
      acao: "Com orçamento total, a Meta redistribui o ritmo ao longo do período. Confira o orçamento restante e a data de término.",
    },
  };

  const achados: Achado[] = [];
  if (principal) {
    const a = acoes[principal];
    let texto = `${comparacao}. Onde a queda aconteceu: ${detalhes}.`;
    if (principal === "pagina") {
      const sinais = experienciaPagina(e.clarity, base, rec);
      if (sinais === null)
        texto +=
          e.clarityConectado || e.clarity.length
            ? " O Clarity ainda não cobre esse período; a partir das próximas coletas, a experiência na página entra nesta leitura."
            : " Conecte o Microsoft Clarity em Configurações para ver rolagem, cliques e erros na página.";
      else if (sinais.length) texto += ` No Clarity, no mesmo período: ${sinais.join("; ")}.`;
      else texto += " No Clarity, rolagem, cliques e erros não mudaram: a causa provável é a mensagem ou a oferta, não um problema técnico.";
    }
    if (principal === "pagina" && contrib.anuncio > -0.05) texto += ` O anúncio continua atraindo: ${descreve.anuncio("anuncio")}.`;
    achados.push({ id: "tendencia", tom: firme ? a.tom : "observar", titulo: a.titulo, texto: firme ? texto : `${texto} A diferença nessa etapa ainda pode ser ruído; confirme nos próximos dias.`, acao: a.acao });
    for (const k of etapas.slice(1)) if (Math.abs(contrib[k]) / total >= 0.3) achados.push({ id: `tendencia-${k}`, tom: "observar", titulo: acoes[k].titulo, texto: `${descreve[k](k)} — ${parte(k)} da queda de leads.`, acao: acoes[k].acao });
  } else {
    achados.push({ id: "tendencia", tom: "observar", titulo: "Leads em queda", texto: `${comparacao}, sem uma etapa que explique sozinha.` });
  }
  return achados;
}

function regraSaturacao(completos: DiaCampanha[]): Achado | null {
  if (completos.length < 4) return null;
  const rec = janela(completos.slice(-2));
  const base = janela(completos.slice(0, -2).slice(-5));
  const freq = rec.impressoes ? rec.freqPeso / rec.impressoes : 0;
  const ctrB = base.impressoes ? base.cliques / base.impressoes : 0;
  const ctrR = rec.impressoes ? rec.cliques / rec.impressoes : 0;
  const z = zProporcoes(base.cliques, base.impressoes, rec.cliques, rec.impressoes);
  const caiu = ctrR < ctrB * 0.8 && significativo(z);
  if (freq >= 2.5 && caiu)
    return {
      id: "saturacao",
      tom: "agir",
      titulo: "Sinais de saturação do público",
      texto: `Frequência diária de ${decimal(freq, 1)} e CTR caindo de ${pct(ctrB, 2)} para ${pct(ctrR, 2)}: as mesmas pessoas estão vendo o anúncio e clicando menos.`,
      acao: "Amplie o público ou renove os criativos (em campanha ou conjunto separado, para não reiniciar o aprendizado).",
    };
  if (caiu)
    return {
      id: "saturacao",
      tom: "observar",
      titulo: "CTR caindo com frequência baixa",
      texto: `CTR ${pct(ctrB, 2)} → ${pct(ctrR, 2)} com frequência diária de ${decimal(freq, 1)}: não é repetição para as mesmas pessoas; o criativo pode estar perdendo força.`,
      acao: "Prepare variações de criativo para testar se a queda continuar.",
    };
  return {
    id: "saturacao",
    tom: "ok",
    titulo: "Sem sinal de saturação",
    texto: `Frequência diária de ${decimal(freq, 1)} e CTR ${ctrR >= ctrB ? "estável ou em alta" : "estável"} (${pct(ctrB, 2)} → ${pct(ctrR, 2)}). O público ainda não se esgotou.`,
  };
}

function regraConcentracao(e: EntradaLeitura, completos: DiaCampanha[]): Achado | null {
  const comGasto = e.anuncios.filter((a) => a.gasto > 0).sort((a, b) => b.gasto - a.gasto);
  const total = comGasto.reduce((s, a) => s + a.gasto, 0);
  if (completos.length < 3 || comGasto.length < 2 || !total) return null;
  const lider = comGasto[0];
  const fatia = lider.gasto / total;
  if (fatia < 0.7) return null;
  const poucos = comGasto.slice(1).filter((a) => a.impressoes < 1000);
  return {
    id: "concentracao",
    tom: "observar",
    titulo: `A Meta escolheu “${lider.nome}”`,
    texto: `${pct(fatia, 0)} da verba foi para esse anúncio.${poucos.length ? ` ${juntarE(poucos.map((a) => `“${a.nome}”`))} ${poucos.length === 1 ? "teve" : "tiveram"} menos de 1.000 impressões: não dá para dizer se ${poucos.length === 1 ? "funciona" : "funcionam"}.` : ""}`,
    acao: "Para testar de verdade outros ganchos, coloque-os numa campanha ou conjunto separado, com verba própria.",
  };
}

function regraQualidade(e: EntradaLeitura): Achado[] {
  if (e.funil !== "cadastro_teste_venda") return [];
  const leads = e.anuncios.reduce((s, a) => s + a.leads, 0);
  const testes = e.anuncios.reduce((s, a) => s + a.testes, 0);
  if (!testes || leads < 20) return [];
  const p = testes / leads;
  return e.anuncios
    .filter((a) => a.leads >= 15 && a.testes === 0)
    .flatMap((a) => {
      const chance = probNenhum(a.leads, p);
      if (chance >= 0.15) return [];
      return [
        {
          id: `qualidade-${a.ad_id}`,
          tom: chance < 0.05 ? "agir" : "observar",
          titulo: `“${a.nome}” traz leads que não testam`,
          texto: `${plural(a.leads, "lead", "leads")} e nenhum teste; pela média da campanha (${pct(p, 0)}), o esperado seria ${decimal(a.leads * p, 1)}. A chance de ser só acaso é de ${pct(chance, 0)}.`,
          acao: chance < 0.05 ? "Reduza a verba desse anúncio ou troque a promessa: ele atrai cadastro sem intenção de usar." : "Acompanhe: mais alguns leads sem teste confirmam o padrão.",
        } satisfies Achado,
      ];
    });
}

function regraTestesRecentes(e: EntradaLeitura): Achado | null {
  if (e.funil !== "cadastro_teste_venda") return null;
  const ds = e.dias.filter((d) => d.leads > 0);
  let n = 0;
  let desde = "";
  let i = ds.length - 1;
  for (; i >= 0 && ds[i].testes === 0; i--) {
    n += ds[i].leads;
    desde = ds[i].dia;
  }
  const antes = ds.slice(0, i + 1);
  const leadsAntes = antes.reduce((s, d) => s + d.leads, 0);
  const testesAntes = antes.reduce((s, d) => s + d.testes, 0);
  if (!n || !testesAntes || leadsAntes < 20) return null;
  const p = testesAntes / leadsAntes;
  const chance = probNenhum(n, p);
  if (chance >= 0.15) return null;
  return {
    id: "testes-recentes",
    tom: chance < 0.05 ? "agir" : "observar",
    titulo: `Nenhum lead iniciou teste desde ${ddmm(desde)}`,
    texto: `${plural(n, "lead chegou", "leads chegaram")} desde ${ddmm(desde)} e nenhum começou o teste grátis; antes, ${pct(p, 0)} começavam (esperado agora: ${decimal(n * p, 1)}). A chance de ser só acaso é de ${pct(chance, 0)}.`,
    acao:
      chance < 0.05
        ? "Confira o caminho do cadastro até o checkout: botão de assinatura, página do Stripe e e-mails. Algo pode ter quebrado depois do cadastro."
        : "Acompanhe nos próximos dias e confira o caminho do cadastro até o checkout.",
  };
}

function regraRastreio(completos: DiaCampanha[]): Achado | null {
  if (completos.length < 4) return null;
  const rec = janela(completos.slice(-2));
  const base = janela(completos.slice(-5, -2));
  if (base.leadsMeta < 20 || rec.leadsMeta < 10) return null;
  const rb = base.leads / base.leadsMeta;
  const rr = rec.leads / rec.leadsMeta;
  const z = zProporcoes(Math.min(base.leads, base.leadsMeta), base.leadsMeta, Math.min(rec.leads, rec.leadsMeta), rec.leadsMeta);
  if (!(rr < rb * 0.6 && significativo(z))) return null;
  return {
    id: "rastreio",
    tom: "agir",
    titulo: "Leads deixando de chegar ao sistema",
    texto: `Antes, ${pct(rb, 0)} dos leads que a Meta conta chegavam ao sistema com o anúncio; em ${periodo(rec)}, ${pct(rr, 0)}.`,
    acao: "Confira em Rastreio se os anúncios mantêm os parâmetros de URL e se o site continua enviando os leads.",
  };
}

function regraMaturidade(e: EntradaLeitura): Achado | null {
  if (e.funil === "cadastro_teste_venda") {
    const cobrancas = e.testesAtivos.map((t) => somaDias(t, e.diasTeste)).filter((d) => d >= e.hoje).sort();
    if (cobrancas.length && e.vendas < 5)
      return {
        id: "maturidade",
        tom: "aguardar",
        titulo: `Custo por venda só a partir de ${ddmm(cobrancas[0])}`,
        texto: `${plural(e.testesAtivos.length, "teste em andamento", "testes em andamento")}; as cobranças acontecem entre ${ddmm(cobrancas[0])} e ${ddmm(cobrancas.at(-1)!)} (teste de ${e.diasTeste} dias). ${e.vendas ? `Até agora, ${plural(e.vendas, "venda", "vendas")}.` : "Até lá, não há venda para medir."}`,
        acao: "Não julgue a campanha por custo por venda ou ROAS antes disso. Até lá, acompanhe leads e quantos iniciam o teste.",
      };
  }
  if (e.vendas > 0 && e.vendas < 5)
    return {
      id: "maturidade",
      tom: "aguardar",
      titulo: "Poucas vendas para medir custo por venda",
      texto: `${plural(e.vendas, "venda", "vendas")} até agora: o custo por venda ainda muda muito a cada venda nova.`,
      acao: "Use o custo por venda como direção, não como veredito, até umas 5 vendas.",
    };
  return null;
}

function regraClarity(e: EntradaLeitura): Achado | null {
  if (!e.clarity.length)
    return e.clarityConectado
      ? {
          id: "clarity",
          tom: "aguardar",
          titulo: "Clarity conectado, primeira coleta à meia-noite",
          texto: "A coleta diária da experiência na página roda às 0h10 e guarda o dia anterior. A comparação de rolagem, cliques e erros começa com 4 dias coletados.",
        }
      : null;
  const comSessao = e.clarity.filter((d) => (d.sessoes ?? 0) > 0);
  if (comSessao.length < 4)
    return {
      id: "clarity",
      tom: "aguardar",
      titulo: "Clarity coletando",
      texto: `${plural(comSessao.length, "dia", "dias")} de experiência na página registrados${comSessao.length ? ` desde ${ddmm(comSessao[0].dia)}` : ""}. A comparação de rolagem, cliques e erros começa com 4 dias.`,
    };
  const rec = comSessao.slice(-2);
  const base = comSessao.slice(-5, -2);
  const jb = { de: base[0].dia, ate: base.at(-1)!.dia } as Janela;
  const jr = { de: rec[0].dia, ate: rec.at(-1)!.dia } as Janela;
  const sinais = experienciaPagina(e.clarity, jb, jr);
  if (!sinais?.length) return null;
  return {
    id: "clarity",
    tom: "observar",
    titulo: "Experiência na página piorou",
    texto: `Entre ${periodo(jb)} e ${periodo(jr)}: ${sinais.join("; ")}.`,
    acao: "Abra as gravações do Clarity desses dias filtrando por origem = anuncio_meta e veja onde as pessoas travam.",
  };
}

// ───────────────────────────── Leitura ─────────────────────────────

export function lerCampanha(e: EntradaLeitura): Leitura {
  const completos = e.dias.filter((d) => d.dia < e.hoje && (d.gasto > 0 || d.leads > 0));
  const temHoje = e.dias.some((d) => d.dia === e.hoje && d.gasto > 0);
  const ultimo = completos.at(-1)?.dia ?? null;
  const nota = ultimo
    ? `Leitura até ${ddmm(ultimo)}, o último dia completo.${temHoje ? ` Hoje fica de fora: os dados da Meta vão até ${e.sincronizadoAs ?? "a última sincronização"} e o dia ainda não terminou.` : ""}`
    : null;
  const achados = [
    ...regraTendencia(e, completos),
    regraSaturacao(completos),
    regraRastreio(completos),
    regraTestesRecentes(e),
    ...regraQualidade(e),
    regraConcentracao(e, completos),
    regraMaturidade(e),
    regraClarity(e),
  ]
    .filter((a): a is Achado => !!a)
    .sort((a, b) => ORDEM[a.tom] - ORDEM[b.tom]);
  return { achados, diasCompletos: completos.length, ultimoDiaCompleto: ultimo, nota };
}
