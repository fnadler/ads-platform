// Leitura da campanha: transforma os números diários em achados com o que fazer. Sem banco nem rede
// (os dados chegam prontos de carregar.ts), para ser testável com casos reais.
//
// Princípios:
//   • Só dias completos entram nas comparações: hoje ainda está em andamento.
//   • Toda mudança passa por um teste de ruído antes de virar "agir" (amostras de dezenas de leads).
//   • A queda de leads é decomposta pelas etapas do funil, para apontar onde agir — anúncio, leilão,
//     entrega ou página —, em vez de chamar tudo de "saturação".
//   • "Aguardar" é um resultado explícito, com a data em que haverá dado para decidir.
//
// Cada achado tem duas camadas, para quem não é do ramo: o essencial (título em linguagem simples,
// um número em destaque e uma ação curta) e o detalhe (a explicação, as etapas do funil e a ação
// completa), que a tela mostra só quando a pessoa pede.

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

/** A parte da campanha de que o achado fala (a aba em que ele aparece). "geral" fica só na visão geral. */
export type AreaAchado = "geral" | "anuncios" | "pagina" | "vendas";

/** O que a plataforma consegue fazer na Meta para resolver o achado (com confirmação, em campanha que ela criou). */
export type AcaoExecutavel = { tipo: "testar_anuncios"; anuncios: string[] } | { tipo: "pausar_anuncio"; anuncio: string } | { tipo: "ajustar_verba" };

/**
 * Atalho para investigar ou resolver dentro da plataforma (ou no Clarity): conferir a página ou o rastreio
 * na hora, ver as gravações, conectar o Clarity, criar anúncios novos, ver os cadastros recentes.
 */
export type Atalho = "testar_pagina" | "conferir_rastreio" | "gravacoes_clarity" | "conectar_clarity" | "nova_campanha" | "ver_cadastros";

/** O número que resume o achado. Com `de`, é uma mudança (antes → agora); com `fracao`, vira barra. */
export interface Destaque {
  de?: string;
  para: string;
  rotulo: string;
  sentido?: "pior" | "melhor" | "neutro";
  fracao?: number;
}

/** Uma etapa do caminho do anúncio ao cadastro, com quanto ela pesou na mudança. */
export interface Passo {
  rotulo: string;
  de: string;
  para: string;
  /** Fração da mudança total explicada por esta etapa (0 a 1). */
  parte: number;
  piorou: boolean;
}

export interface Achado {
  id: string;
  tom: TomAchado;
  area: AreaAchado;
  /** A etapa do caminho do anúncio ao cadastro que o achado aponta (para marcar no caminho). */
  etapa?: Etapa;
  /** Em linguagem simples, sem jargão. */
  titulo: string;
  destaque?: Destaque;
  /** Uma frase: o que fazer agora. */
  acao?: string;
  /** A explicação completa, com os números. */
  detalhe: string;
  passos?: Passo[];
  /** A orientação completa, quando a ação curta não basta. */
  acaoDetalhe?: string;
  acaoExecutavel?: AcaoExecutavel;
  atalhos?: Atalho[];
}

export interface Leitura {
  achados: Achado[];
  /** Dias completos considerados (o último é a referência da leitura). */
  diasCompletos: number;
  ultimoDiaCompleto: string | null;
  nota: string | null;
  /** Os dias do Clarity da janela, para a aba da página. */
  clarity: DiaClarity[];
  clarityConectado: boolean;
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
const periodo = (j: Pick<Janela, "de" | "ate">) => (j.de === j.ate ? ddmm(j.de) : `${ddmm(j.de)} a ${ddmm(j.ate)}`);

// ───────────────────────────── Queda ou alta de cadastros, por etapa ─────────────────────────────

/** Etapas do funil: cadastros/dia = gasto/dia × exibições/real × cliques/exibição × visitas/clique × cadastros/visita. */
export type Etapa = "entrega" | "leilao" | "anuncio" | "carregamento" | "pagina";
const ETAPAS: Etapa[] = ["entrega", "leilao", "anuncio", "carregamento", "pagina"];
const areaDaEtapa = (k: Etapa): AreaAchado => (k === "pagina" || k === "carregamento" ? "pagina" : "anuncios");
const ATALHOS_ETAPA: Partial<Record<Etapa, (clarity: boolean) => Atalho[]>> = {
  pagina: (clarity) => ["testar_pagina", clarity ? "gravacoes_clarity" : "conectar_clarity"],
  carregamento: () => ["testar_pagina"],
  anuncio: () => ["nova_campanha"],
};
const atalhosDaEtapa = (k: Etapa, clarity: boolean) => ATALHOS_ETAPA[k]?.(clarity);

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

function experienciaPagina(clarity: DiaClarity[], base: Pick<Janela, "de" | "ate">, rec: Pick<Janela, "de" | "ate">) {
  const media = (ds: DiaClarity[], k: keyof Omit<DiaClarity, "dia">) => {
    const vs = ds.map((d) => d[k]).filter((v): v is number => typeof v === "number");
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const em = (j: Pick<Janela, "de" | "ate">) => clarity.filter((d) => d.dia >= j.de && d.dia <= j.ate);
  const b = em(base);
  const r = em(rec);
  if (!b.length || !r.length) return null;
  const sinais: string[] = [];
  const rolB = media(b, "rolagem");
  const rolR = media(r, "rolagem");
  if (rolB !== null && rolR !== null && rolR < rolB * 0.85) sinais.push(`as pessoas passaram a descer menos na página (de ${decimal(rolB, 0)}% para ${decimal(rolR, 0)}% da altura)`);
  for (const [k, nome, limite] of [
    ["voltaRapida", "visitas que voltam logo para o anúncio", 5],
    ["cliqueMorto", "visitas com clique em algo que não responde", 5],
    ["cliqueRaiva", "visitas com cliques repetidos de irritação", 3],
    ["erroScript", "visitas com erro técnico na página", 2],
  ] as const) {
    const vb = media(b, k);
    const vr = media(r, k);
    if (vb !== null && vr !== null && vr - vb >= limite) sinais.push(`${nome} subiram de ${decimal(vb, 1)}% para ${decimal(vr, 1)}%`);
  }
  return sinais;
}

const comClarity = (e: EntradaLeitura) => !!e.clarityConectado || e.clarity.length > 0;

function regraTendencia(e: EntradaLeitura, completos: DiaCampanha[]): Achado[] {
  if (e.funil === "venda_direta") return []; // sem cadastro no meio: a leitura por etapa fica para a venda
  if (completos.length < 4)
    return [
      {
        id: "tendencia-amostra",
        tom: "aguardar",
        area: "geral",
        titulo: "Ainda é cedo para comparar dias",
        destaque: { para: `${completos.length} de 4`, rotulo: "dias completos de campanha" },
        detalhe: `A comparação entre os últimos dias e os anteriores começa com 4 dias completos de veiculação. Antes disso, qualquer subida ou descida pode ser só acaso.`,
      },
    ];
  const rec = janela(completos.slice(-2));
  const base = janela(completos.slice(-5, -2));
  const usarMeta = base.leadsMeta + rec.leadsMeta > 0;
  const lb = usarMeta ? base.leadsMeta : base.leads;
  const lr = usarMeta ? rec.leadsMeta : rec.leads;
  const porDiaB = lb / base.dias;
  const porDiaR = lr / rec.dias;
  const v = variacao(porDiaB, porDiaR);
  const z = zTaxas(lb, base.dias, lr, rec.dias);
  const comparacao = `Eram ${decimal(porDiaB, 0)} cadastros por dia (${periodo(base)}); agora são ${decimal(porDiaR, 0)} (${periodo(rec)}), ${sinal(v)}.${usarMeta ? " Contamos os cadastros que a Meta registra, para comparar com o resto do caminho." : ""}`;
  const destaqueLeads = (sentido: Destaque["sentido"]): Destaque => ({ de: decimal(porDiaB, 0), para: decimal(porDiaR, 0), rotulo: "cadastros por dia", sentido });

  if (!significativo(z) || Math.abs(v) < 0.2)
    return [
      {
        id: "tendencia",
        tom: "ok",
        area: "geral",
        titulo: "Cadastros no ritmo de sempre",
        destaque: destaqueLeads("neutro"),
        detalhe: `${comparacao} A diferença está dentro da variação normal de poucos dias.`,
      },
    ];

  const { fatores, contrib } = decompor(base, rec, usarMeta);
  const queda = v < 0;
  const total = Math.abs(Math.log(porDiaR / porDiaB)) || 1;
  const pesa = (k: Etapa) => (queda ? contrib[k] < -0.05 : contrib[k] > 0.05);
  const etapas = ETAPAS.filter(pesa).sort((a, b) => Math.abs(contrib[b]) - Math.abs(contrib[a]));
  const valor: Record<Etapa, (x: number) => string> = {
    entrega: (x) => moeda(x, e.moeda),
    leilao: (x) => moeda(1000 / x, e.moeda),
    anuncio: (x) => pct(x, 1),
    carregamento: (x) => pct(x, 0),
    pagina: (x) => pct(x, 0),
  };
  const rotulos: Record<Etapa, string> = {
    entrega: "Verba gasta por dia",
    leilao: "Custo para exibir mil vezes",
    anuncio: "De quem vê, quantos clicam",
    carregamento: "De quem clica, quantos abrem a página",
    pagina: "De quem visita, quantos se cadastram",
  };
  const passos: Passo[] = ETAPAS.map((k) => ({
    rotulo: rotulos[k],
    de: valor[k](fatores[k][0]),
    para: valor[k](fatores[k][1]),
    parte: pesa(k) ? Math.min(Math.abs(contrib[k]) / total, 1) : 0,
    // No leilão, o fator é exibições por real: cair é ficar mais caro.
    piorou: contrib[k] < 0,
  }));
  const destaqueEtapa = (k: Etapa): Destaque => {
    const rotulo: Record<Etapa, string> = {
      entrega: "gastos por dia",
      leilao: "para exibir o anúncio mil vezes",
      anuncio: "das pessoas que veem o anúncio clicam",
      carregamento: "dos cliques chegam a abrir a página",
      pagina: "das visitas à página viram cadastro",
    };
    // Gastar menos por dia não é bom nem ruim em si: fica neutro.
    const sentido = k === "entrega" ? "neutro" : contrib[k] < 0 ? "pior" : "melhor";
    return { de: valor[k](fatores[k][0]), para: valor[k](fatores[k][1]), rotulo: rotulo[k], sentido };
  };

  if (!queda)
    return [
      {
        id: "tendencia",
        tom: "ok",
        area: "geral",
        titulo: "Cadastros em alta",
        destaque: destaqueLeads("melhor"),
        detalhe: `${comparacao}${etapas.length ? ` O que mais ajudou: ${juntarE(etapas.map((k) => rotulos[k].toLowerCase()))}.` : ""}`,
        passos,
      },
    ];

  const textos: Record<Etapa, { titulo: string; acao: string; acaoDetalhe: string; tom: TomAchado; porque: string }> = {
    pagina: {
      titulo: "Menos visitantes estão se cadastrando",
      tom: "agir",
      acao: "Revise a página e o cadastro antes de mexer na campanha.",
      acaoDetalhe:
        "Faça o caminho do anúncio até o cadastro no celular e confira o que mudou no site nesses dias. Mexer na campanha agora faz a Meta recomeçar o aprendizado e não resolve a causa.",
      porque: "As pessoas continuam chegando à página, mas menos delas se cadastram.",
    },
    carregamento: {
      titulo: "Cliques não estão abrindo a página",
      tom: "agir",
      acao: "Confira se a página está no ar e rápida no celular.",
      acaoDetalhe: "Veja também se o link do anúncio não passa por redirecionamentos que atrasam ou perdem a visita.",
      porque: "Muita gente clica no anúncio, mas a página não chega a abrir.",
    },
    anuncio: {
      titulo: "Menos gente está clicando nos anúncios",
      tom: "observar",
      acao: "Se continuar caindo, prepare anúncios novos.",
      acaoDetalhe: "Teste os anúncios novos numa campanha ou conjunto separado, sem editar os que estão no ar.",
      porque: "Das pessoas que veem o anúncio, uma parte menor clica.",
    },
    leilao: {
      titulo: "Ficou mais caro exibir os anúncios",
      tom: "observar",
      acao: "Acompanhe: isso varia com a concorrência e o dia da semana.",
      acaoDetalhe: "Se continuar por uma semana, teste públicos ou anúncios novos.",
      porque: "Com o mesmo dinheiro, os anúncios aparecem menos vezes.",
    },
    entrega: {
      titulo: "A Meta está gastando menos por dia",
      tom: "observar",
      acao: "Confira o orçamento restante e a data de término.",
      acaoDetalhe: "Com orçamento total para o período, a Meta distribui o gasto ao longo dos dias e pode gastar menos em alguns.",
      porque: "Com menos verba por dia, os anúncios aparecem menos.",
    },
  };

  const principal = etapas[0];
  if (!principal)
    return [
      {
        id: "tendencia",
        tom: "observar",
        area: "geral",
        titulo: "Cadastros em queda",
        destaque: destaqueLeads("pior"),
        detalhe: `${comparacao} Nenhuma etapa explica a queda sozinha.`,
        passos,
      },
    ];

  const leadsDe = (j: Janela) => (usarMeta ? j.leadsMeta : j.leads);
  const zEtapa: Partial<Record<Etapa, number>> = {
    pagina: zProporcoes(leadsDe(base), base.lpv, leadsDe(rec), rec.lpv),
    anuncio: zProporcoes(base.cliques, base.impressoes, rec.cliques, rec.impressoes),
    carregamento: zProporcoes(base.lpv, base.cliques, rec.lpv, rec.cliques),
  };
  const firme = zEtapa[principal] === undefined || significativo(zEtapa[principal]!);
  const t = textos[principal];

  let detalhe = `${t.porque} ${comparacao} Abaixo, quanto cada etapa pesou na queda.`;
  if (principal === "pagina") {
    if (contrib.anuncio > -0.05) detalhe += ` O anúncio continua atraindo: de quem vê, ${pct(fatores.anuncio[1], 1)} clicam (antes, ${pct(fatores.anuncio[0], 1)}).`;
    const sinais = experienciaPagina(e.clarity, base, rec);
    if (sinais === null)
      detalhe +=
        e.clarityConectado || e.clarity.length
          ? " O Clarity ainda não cobre esses dias; nas próximas coletas, o comportamento na página entra nesta leitura."
          : " Conecte o Microsoft Clarity em Configurações para ver como as pessoas usam a página.";
    else if (sinais.length) detalhe += ` No Clarity, nesses dias: ${juntarE(sinais)}.`;
    else detalhe += " No Clarity, o uso da página não mudou: a causa provável é a mensagem ou a oferta, não um problema técnico.";
  }
  if (!firme) detalhe += " A diferença ainda pode ser acaso; confirme nos próximos dias.";

  const achados: Achado[] = [
    { id: "tendencia", tom: firme ? t.tom : "observar", area: areaDaEtapa(principal), etapa: principal, atalhos: atalhosDaEtapa(principal, comClarity(e)), ...(principal === "entrega" ? { acaoExecutavel: { tipo: "ajustar_verba" as const } } : {}), titulo: t.titulo, destaque: destaqueEtapa(principal), acao: t.acao, detalhe, passos, acaoDetalhe: t.acaoDetalhe },
  ];
  for (const k of etapas.slice(1))
    if (Math.abs(contrib[k]) / total >= 0.3)
      achados.push({
        id: `tendencia-${k}`,
        tom: "observar",
        area: areaDaEtapa(k),
        etapa: k,
        atalhos: atalhosDaEtapa(k, comClarity(e)),
        ...(k === "entrega" ? { acaoExecutavel: { tipo: "ajustar_verba" as const } } : {}),
        titulo: textos[k].titulo,
        destaque: destaqueEtapa(k),
        acao: textos[k].acao,
        detalhe: `${textos[k].porque} Isso explica ${pct(Math.abs(contrib[k]) / total, 0)} da queda de cadastros.`,
        acaoDetalhe: textos[k].acaoDetalhe,
      });
  return achados;
}

// ───────────────────────────── Demais regras ─────────────────────────────

function regraSaturacao(completos: DiaCampanha[]): Achado | null {
  if (completos.length < 4) return null;
  const rec = janela(completos.slice(-2));
  const base = janela(completos.slice(0, -2).slice(-5));
  const freq = rec.impressoes ? rec.freqPeso / rec.impressoes : 0;
  const ctrB = base.impressoes ? base.cliques / base.impressoes : 0;
  const ctrR = rec.impressoes ? rec.cliques / rec.impressoes : 0;
  const z = zProporcoes(base.cliques, base.impressoes, rec.cliques, rec.impressoes);
  const caiu = ctrR < ctrB * 0.8 && significativo(z);
  const destaqueFreq: Destaque = { para: `${decimal(freq, 1)}×`, rotulo: "por dia: quantas vezes cada pessoa vê o anúncio" };
  const cliques = `De quem vê o anúncio, ${pct(ctrR, 1)} clicam (antes, ${pct(ctrB, 1)}).`;
  if (freq >= 2.5 && caiu)
    return {
      id: "saturacao",
      tom: "agir",
      area: "anuncios",
      titulo: "O público está cansando do anúncio",
      destaque: destaqueFreq,
      acao: "Amplie o público ou renove os anúncios.",
      atalhos: ["nova_campanha"],
      detalhe: `As mesmas pessoas estão vendo o anúncio várias vezes por dia e clicando cada vez menos. ${cliques}`,
      acaoDetalhe: "Faça isso numa campanha ou conjunto separado, para não fazer a Meta recomeçar o aprendizado da campanha atual.",
    };
  if (caiu)
    return {
      id: "saturacao",
      tom: "observar",
      area: "anuncios",
      titulo: "O anúncio pode estar perdendo força",
      destaque: { de: pct(ctrB, 1), para: pct(ctrR, 1), rotulo: "das pessoas que veem o anúncio clicam", sentido: "pior" },
      acao: "Prepare variações do anúncio, caso continue caindo.",
      atalhos: ["nova_campanha"],
      detalhe: `Menos gente clica, mas não é repetição: cada pessoa vê o anúncio ${decimal(freq, 1)} vez(es) por dia.`,
    };
  return {
    id: "saturacao",
    tom: "ok",
    area: "anuncios",
    titulo: "O público ainda não cansou",
    destaque: destaqueFreq,
    detalhe: `Cada pessoa vê o anúncio ${decimal(freq, 1)} vez(es) por dia, e os cliques ${ctrR >= ctrB ? "se mantêm ou sobem" : "se mantêm"}. ${cliques} Saturação aparece quando as mesmas pessoas veem o anúncio muitas vezes (2,5 ou mais por dia) e param de clicar.`,
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
    area: "anuncios",
    titulo: `A Meta apostou quase tudo em “${lider.nome}”`,
    destaque: { para: pct(fatia, 0), rotulo: "da verba foi para esse anúncio", fracao: fatia },
    acao: "Para testar outros anúncios, dê a eles verba própria.",
    detalhe: `A Meta coloca a verba no anúncio que parece melhor no começo.${poucos.length ? ` ${juntarE(poucos.map((a) => `“${a.nome}”`))} ${poucos.length === 1 ? "apareceu" : "apareceram"} menos de mil vezes: ainda não dá para saber se ${poucos.length === 1 ? "funciona" : "funcionam"}.` : ""}`,
    acaoDetalhe: "Coloque os anúncios que quer testar numa campanha ou conjunto separado, com verba própria.",
    // Testa os que quase não apareceram; se todos apareceram o bastante, os que não são o líder.
    acaoExecutavel: { tipo: "testar_anuncios", anuncios: (poucos.length ? poucos : comGasto.slice(1)).map((a) => a.ad_id) },
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
          area: "anuncios",
          titulo: `“${a.nome}” traz cadastros que não testam`,
          destaque: { para: `0 de ${inteiro(a.leads)}`, rotulo: "cadastros começaram o teste grátis", sentido: "pior" },
          acao: chance < 0.05 ? "Reduza a verba desse anúncio ou mude a promessa." : "Acompanhe mais alguns cadastros.",
          detalhe: `Na campanha, ${pct(p, 0)} dos cadastros começam o teste grátis; nesse anúncio, nenhum. O esperado seriam ${decimal(a.leads * p, 1)}. A chance de ser só acaso é de ${pct(chance, 0)}.`,
          acaoDetalhe: chance < 0.05 ? "Ele atrai gente que se cadastra sem intenção de usar." : undefined,
          acaoExecutavel: chance < 0.05 ? { tipo: "pausar_anuncio" as const, anuncio: a.ad_id } : undefined,
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
    area: "vendas",
    titulo: `Ninguém começou o teste grátis desde ${ddmm(desde)}`,
    destaque: { para: `0 de ${inteiro(n)}`, rotulo: `cadastros desde ${ddmm(desde)} começaram o teste`, sentido: "pior" },
    acao: chance < 0.05 ? "Confira o caminho do cadastro até o pagamento." : "Acompanhe e teste o caminho do cadastro até o pagamento.",
    atalhos: ["ver_cadastros"],
    detalhe: `Antes, ${pct(p, 0)} dos cadastros começavam o teste grátis. Com ${plural(n, "cadastro novo", "cadastros novos")}, o esperado seriam ${decimal(n * p, 1)}. A chance de ser só acaso é de ${pct(chance, 0)}${chance < 0.05 ? "" : ", então ainda pode ser coincidência"}.`,
    acaoDetalhe: "Teste o botão de assinatura, a página de pagamento e os e-mails depois do cadastro: algo pode ter quebrado depois do cadastro.",
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
    area: "vendas",
    titulo: "Cadastros chegando sem a origem do anúncio",
    destaque: { de: pct(rb, 0), para: pct(rr, 0), rotulo: "dos cadastros chegam com o anúncio de origem", sentido: "pior" },
    acao: "Confira o rastreio dos anúncios e do site.",
    atalhos: ["conferir_rastreio"],
    detalhe: `Dos cadastros que a Meta conta, ${pct(rr, 0)} chegaram ao sistema com o anúncio de origem em ${periodo(rec)}; antes, ${pct(rb, 0)}. Sem a origem, as vendas desses cadastros não aparecem no anúncio certo.`,
    acaoDetalhe: "Em Rastreio, veja se os anúncios mantêm os parâmetros de URL e se o site continua enviando os cadastros.",
  };
}

function regraMaturidade(e: EntradaLeitura): Achado | null {
  if (e.funil === "cadastro_teste_venda") {
    const cobrancas = e.testesAtivos.map((t) => somaDias(t, e.diasTeste)).filter((d) => d >= e.hoje).sort();
    if (cobrancas.length && e.vendas < 5)
      return {
        id: "maturidade",
        tom: "aguardar",
        area: "vendas",
        titulo: "Ainda não dá para medir as vendas",
        destaque: { para: ddmm(cobrancas[0]), rotulo: `primeira cobrança dos ${plural(e.testesAtivos.length, "teste", "testes")} em andamento` },
        acao: "Até lá, acompanhe cadastros e testes.",
        detalhe: `O teste grátis dura ${e.diasTeste} dias, então as cobranças dos testes em andamento caem entre ${ddmm(cobrancas[0])} e ${ddmm(cobrancas.at(-1)!)}. ${e.vendas ? `Até agora, ${plural(e.vendas, "venda", "vendas")}.` : "Até lá, não há venda para medir."}`,
        acaoDetalhe: "Não julgue a campanha pelo custo por venda ou pelo ROAS antes disso.",
      };
  }
  if (e.vendas > 0 && e.vendas < 5)
    return {
      id: "maturidade",
      tom: "aguardar",
      area: "vendas",
      titulo: "Poucas vendas para tirar conclusão",
      destaque: { para: `${e.vendas} de 5`, rotulo: "vendas para o custo por venda ficar confiável" },
      acao: "Use o custo por venda como direção, não como veredito.",
      detalhe: "Com poucas vendas, o custo por venda muda muito a cada venda nova.",
    };
  return null;
}

function regraClarity(e: EntradaLeitura): Achado | null {
  if (!e.clarity.length)
    return e.clarityConectado
      ? {
          id: "clarity",
          tom: "aguardar",
          area: "pagina",
          titulo: "Clarity começando a medir a página",
          destaque: { para: "0 de 4", rotulo: "dias medidos para comparar" },
          detalhe: "A coleta diária roda à meia-noite e guarda o dia anterior. Com 4 dias, a leitura passa a comparar como as pessoas usam a página: até onde descem, onde clicam e se aparecem erros.",
        }
      : null;
  const comSessao = e.clarity.filter((d) => (d.sessoes ?? 0) > 0);
  if (comSessao.length < 4)
    return {
      id: "clarity",
      tom: "aguardar",
      area: "pagina",
      titulo: "Clarity começando a medir a página",
      destaque: { para: `${comSessao.length} de 4`, rotulo: "dias medidos para comparar" },
      detalhe: `Com 4 dias de visitas registradas${comSessao.length ? ` (o primeiro foi ${ddmm(comSessao[0].dia)})` : ""}, a leitura passa a comparar como as pessoas usam a página: até onde descem, onde clicam e se aparecem erros.`,
    };
  const rec = comSessao.slice(-2);
  const base = comSessao.slice(-5, -2);
  const jb = { de: base[0].dia, ate: base.at(-1)!.dia };
  const jr = { de: rec[0].dia, ate: rec.at(-1)!.dia };
  const sinais = experienciaPagina(e.clarity, jb, jr);
  if (!sinais?.length) return null;
  return {
    id: "clarity",
    tom: "observar",
    area: "pagina",
    titulo: "Ficou mais difícil usar a página",
    acao: "Veja as gravações do Clarity desses dias.",
    atalhos: ["gravacoes_clarity"],
    detalhe: `Entre ${periodo(jb)} e ${periodo(jr)}, ${juntarE(sinais)}.`,
    acaoDetalhe: "No Clarity, filtre as gravações por origem = anuncio_meta e veja onde as pessoas travam.",
  };
}

// ───────────────────────────── Leitura ─────────────────────────────

export function lerCampanha(e: EntradaLeitura): Leitura {
  const completos = e.dias.filter((d) => d.dia < e.hoje && (d.gasto > 0 || d.leads > 0));
  const temHoje = e.dias.some((d) => d.dia === e.hoje && d.gasto > 0);
  const ultimo = completos.at(-1)?.dia ?? null;
  const nota = ultimo ? `Dados até ${ddmm(ultimo)}.${temHoje ? " Hoje fica de fora porque o dia ainda não terminou." : ""}` : null;
  // Ordem dentro de cada estado = importância: a causa principal da queda, o que afeta venda (testes,
  // rastreio, qualidade), depois as causas secundárias e a distribuição da verba.
  const [principal, ...secundarios] = regraTendencia(e, completos);
  const achados = [
    principal,
    regraSaturacao(completos),
    regraRastreio(completos),
    regraTestesRecentes(e),
    ...regraQualidade(e),
    ...secundarios,
    regraConcentracao(e, completos),
    regraMaturidade(e),
    regraClarity(e),
  ]
    .filter((a): a is Achado => !!a)
    .sort((a, b) => ORDEM[a.tom] - ORDEM[b.tom]);
  return { achados, diasCompletos: completos.length, ultimoDiaCompleto: ultimo, nota, clarity: e.clarity, clarityConectado: !!e.clarityConectado || e.clarity.length > 0 };
}
