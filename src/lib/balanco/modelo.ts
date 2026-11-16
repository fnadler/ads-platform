// Balanço da campanha: a análise que antes era feita à mão, montada a partir dos números da campanha inteira,
// dos achados da leitura e das mudanças feitas (marcos). Para quem não é do ramo: o resultado em frases, o
// caminho do anúncio à venda com onde vazou, o que funcionou e o que não, o que ainda está em aberto e de 3 a
// 5 recomendações para a próxima etapa. Sem banco nem rede (os dados chegam prontos de carregar.ts).
//
// Caso de referência: GN Coleciona, "GN | Cadastro Loja | A1 ganchos" (01 a 16/11/2026).

import { decimal, inteiro, moeda, pct } from "@/lib/formato";
import type { Achado, MarcoComEfeito } from "@/lib/leitura/modelo";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";

export interface AnuncioBalanco {
  adId: string;
  nome: string;
  gasto: number;
  leadsMeta: number;
  leads: number;
  testes: number;
  vendas: number;
}

export interface EntradaBalanco {
  funil: Funil;
  moeda: string;
  hoje: string;
  /** Primeiro e último dia com gasto. */
  de: string | null;
  ate: string | null;
  situacao: "no_ar" | "pausada" | "encerrada";
  total: {
    gasto: number;
    impressoes: number;
    cliques: number;
    visitas: number;
    leadsMeta: number;
    comprasMeta: number;
    leads: number;
    testes: number;
    vendas: number;
    receita: number;
  };
  anuncios: AnuncioBalanco[];
  /** Testes já resolvidos (pagou, cancelou ou venceu) e quantos pagaram. */
  testesResolvidos: number;
  testesPagos: number;
  /** Fim do teste de cada um ainda em andamento (AAAA-MM-DD). */
  testesEmAberto: string[];
  achados: Achado[];
  marcos: MarcoComEfeito[];
}

export type TomItem = "bom" | "ruim" | "neutro";

export interface EtapaFunil {
  rotulo: string;
  /** "3,5% dos que viram clicaram" */
  taxa: string;
  valor: number | null;
  /** Abaixo da referência: onde a campanha vazou. */
  vazou: boolean;
  explicacao: string;
}

export interface ItemBalanco {
  texto: string;
  tom: TomItem;
}

export interface Recomendacao {
  titulo: string;
  texto: string;
  /** Para onde levar a pessoa na plataforma, quando há. */
  link?: "nova_campanha" | "publicos" | "rastreio" | "configuracoes";
}

export interface Balanco {
  titulo: string;
  periodo: string | null;
  situacao: string;
  frase: string;
  numeros: Array<{ rotulo: string; valor: string; detalhe?: string }>;
  funil: EtapaFunil[];
  funcionou: ItemBalanco[];
  naoFuncionou: ItemBalanco[];
  emAberto: string[];
  recomendacoes: Recomendacao[];
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000) + 1;
const div = (a: number, b: number) => (b ? a / b : null);
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

/**
 * Referências de um caminho saudável, por etapa (o que costuma ser bom em campanha de cadastro na Meta).
 * Abaixo disso, a etapa entra como "vazou". São réguas simples, para apontar onde olhar primeiro.
 */
const REFERENCIA = {
  cliques: 0.01, // taxa de cliques no link
  visitas: 0.75, // de quem clica, quantos abrem a página
  cadastroPagina: 0.15, // de quem visita, quantos se cadastram (pelo que a Meta conta)
  chegam: 0.8, // dos cadastros da Meta, quantos chegam ao sistema
  teste: 0.2, // dos cadastros, quantos começam o teste
  pagam: 0.3, // dos testes já resolvidos, quantos pagam
};

function funil(e: EntradaBalanco): EtapaFunil[] {
  const t = e.total;
  const etapa = (rotulo: string, valor: number | null, ref: number, taxa: (v: number) => string, explicacao: string): EtapaFunil => ({
    rotulo,
    valor,
    taxa: valor === null ? "sem dados" : taxa(valor),
    vazou: valor !== null && valor < ref,
    explicacao,
  });
  const etapas = [
    etapa("Viram → clicaram", div(t.cliques, t.impressoes), REFERENCIA.cliques, (v) => `${pct(v, 1)} dos que viram clicaram`, "O anúncio chama atenção e faz clicar."),
    etapa("Clicaram → abriram a página", div(t.visitas, t.cliques), REFERENCIA.visitas, (v) => `${pct(v, 0)} dos cliques abriram a página`, "A página carrega rápido o bastante."),
  ];
  if (e.funil === "venda_direta") {
    etapas.push(etapa("Visitaram → compraram", div(t.comprasMeta, t.visitas), 0.01, (v) => `${pct(v, 1)} das visitas compraram`, "A página e o checkout convencem a comprar."));
    return etapas;
  }
  etapas.push(
    etapa("Visitaram → se cadastraram", div(t.leadsMeta, t.visitas), REFERENCIA.cadastroPagina, (v) => `${pct(v, 0)} das visitas se cadastraram`, "A página convence a deixar o contato."),
    etapa(
      "Cadastros da Meta → chegaram ao sistema",
      t.leadsMeta ? Math.min(t.leads / t.leadsMeta, 1) : null,
      REFERENCIA.chegam,
      (v) => `${pct(v, 0)} chegaram`,
      "O cadastro termina de fato e chega com o anúncio de origem.",
    ),
  );
  if (e.funil === "cadastro_teste_venda") {
    etapas.push(
      etapa("Cadastraram → começaram o teste", div(t.testes, t.leads), REFERENCIA.teste, (v) => `${pct(v, 0)} dos cadastros começaram o teste`, "Quem se cadastra segue até o teste grátis."),
      etapa(
        "Teste terminou → pagou",
        e.testesResolvidos >= 3 ? e.testesPagos / e.testesResolvidos : null,
        REFERENCIA.pagam,
        (v) => `${pct(v, 0)} dos testes já terminados viraram pagamento`,
        "O produto convence durante o teste.",
      ),
    );
  } else {
    etapas.push(etapa("Cadastraram → compraram", div(t.vendas, t.leads), 0.02, (v) => `${pct(v, 1)} dos cadastros compraram`, "Quem se cadastra chega a comprar."));
  }
  return etapas;
}

/** Por qual resultado julgar os anúncios: venda, se já houver; senão teste; senão cadastro. */
function medida(e: EntradaBalanco): { chave: "vendas" | "testes" | "leads"; nome: string; nomes: string } {
  if (e.anuncios.some((a) => a.vendas > 0)) return { chave: "vendas", nome: "venda", nomes: "vendas" };
  if (e.funil === "cadastro_teste_venda" && e.anuncios.some((a) => a.testes > 0)) return { chave: "testes", nome: "teste", nomes: "testes" };
  return { chave: "leads", nome: "cadastro", nomes: "cadastros" };
}

export function montarBalanco(e: EntradaBalanco): Balanco {
  const t = e.total;
  const m = medida(e);
  const r = (v: number) => moeda(v, e.moeda);
  const situacao = { no_ar: "No ar: balanço parcial", pausada: "Pausada", encerrada: "Encerrada" }[e.situacao];
  const periodo = e.de && e.ate ? `${ddmm(e.de)} a ${ddmm(e.ate)} · ${plural(dias(e.de, e.ate), "dia", "dias")}` : null;

  // Resultado em frases.
  // Em assinatura, o retorno do primeiro pagamento não representa o resultado (cada cliente paga todo mês).
  const retorno = e.funil === "cadastro_teste_venda" ? null : div(t.receita, t.gasto);
  const frase =
    t.vendas > 0
      ? `Foram investidos ${r(t.gasto)} e vieram ${plural(t.vendas, "venda", "vendas")} (${r(t.receita)}): ${r(t.gasto / t.vendas)} por venda${retorno !== null ? `, ${r(retorno)} de volta para cada R$ 1 no primeiro pagamento` : ""}.`
      : t.leads > 0
        ? `Foram investidos ${r(t.gasto)} e vieram ${plural(t.leads, "cadastro", "cadastros")}, a ${r(t.gasto / t.leads)} cada. Nenhuma venda confirmada ainda.`
        : `Foram investidos ${r(t.gasto)} e nenhum cadastro chegou ao sistema com o anúncio de origem.`;
  const numeros = [
    { rotulo: "Investido", valor: r(t.gasto) },
    ...(e.funil !== "venda_direta" ? [{ rotulo: "Cadastros", valor: inteiro(t.leads), detalhe: t.leads ? `${r(t.gasto / t.leads)} cada` : undefined }] : []),
    ...(e.funil === "cadastro_teste_venda" ? [{ rotulo: "Testes grátis", valor: inteiro(t.testes), detalhe: t.testes ? `${r(t.gasto / t.testes)} cada` : undefined }] : []),
    { rotulo: "Vendas", valor: inteiro(t.vendas), detalhe: t.vendas ? `${r(t.gasto / t.vendas)} cada` : undefined },
    { rotulo: "Recebido", valor: r(t.receita), detalhe: retorno !== null && t.receita ? `${decimal(retorno, 2)} de retorno` : undefined },
  ];

  const etapas = funil(e);
  const achado = (prefixo: string) => e.achados.find((a) => a.id.startsWith(prefixo));
  const vencedor = achado("vencedor-");
  const diferenca = achado("diferenca-meta");
  const navegador = achado("navegador-app");
  const redistribuicao = achado("redistribuicao-");
  const saturacao = e.achados.find((a) => a.id === "saturacao" && (a.tom === "agir" || a.tom === "observar"));

  // Anúncios pelo resultado: o melhor e os que gastaram sem trazer nada.
  const total = e.anuncios.reduce((s, a) => s + a.gasto, 0);
  const relevantes = e.anuncios.filter((a) => a.gasto >= total * 0.1);
  const comResultado = relevantes.filter((a) => a[m.chave] > 0).sort((a, b) => a.gasto / a[m.chave] - b.gasto / b[m.chave]);
  const melhor = comResultado[0];
  const semResultado = relevantes.filter((a) => a[m.chave] === 0);
  const piorComResultado = comResultado.length > 1 ? comResultado[comResultado.length - 1] : null;

  const funcionou: ItemBalanco[] = [];
  const naoFuncionou: ItemBalanco[] = [];
  if (melhor) funcionou.push({ tom: "bom", texto: `“${melhor.nome}” foi o melhor anúncio: ${plural(melhor[m.chave], m.nome, m.nomes)} a ${r(melhor.gasto / melhor[m.chave])} cada.` });
  for (const etapa of etapas.filter((x) => !x.vazou && x.valor !== null)) funcionou.push({ tom: "bom", texto: `${etapa.rotulo}: ${etapa.taxa}.` });
  for (const a of semResultado) naoFuncionou.push({ tom: "ruim", texto: `“${a.nome}” gastou ${r(a.gasto)} sem nenhum${m.nome === "venda" ? "a" : ""} ${m.nome}.` });
  if (piorComResultado && melhor && piorComResultado.gasto / piorComResultado[m.chave] >= (melhor.gasto / melhor[m.chave]) * 1.5)
    naoFuncionou.push({ tom: "ruim", texto: `“${piorComResultado.nome}” saiu a ${r(piorComResultado.gasto / piorComResultado[m.chave])} por ${m.nome}, bem acima do melhor.` });
  for (const etapa of etapas.filter((x) => x.vazou)) naoFuncionou.push({ tom: "ruim", texto: `${etapa.rotulo}: ${etapa.taxa}. ${etapa.explicacao.replace(/\.$/, "")}: aqui a campanha vazou.` });
  if (redistribuicao) naoFuncionou.push({ tom: "ruim", texto: `${redistribuicao.titulo}.` });
  if (saturacao) naoFuncionou.push({ tom: "ruim", texto: `${saturacao.titulo}.` });

  // Em aberto: testes que ainda vão pagar ou não.
  const emAberto: string[] = [];
  if (e.testesEmAberto.length) {
    const ultimo = [...e.testesEmAberto].sort().at(-1)!;
    const taxa = e.testesResolvidos >= 3 ? e.testesPagos / e.testesResolvidos : null;
    emAberto.push(
      `${plural(e.testesEmAberto.length, "teste grátis ainda está", "testes grátis ainda estão")} em andamento: o último termina em ${ddmm(ultimo)}. ${
        taxa !== null ? `Se pagarem como os anteriores (${pct(taxa, 0)}), ${inteiro(Math.round(e.testesEmAberto.length * taxa))} viram vendas.` : ""
      } O veredito da campanha sai em ${ddmm(ultimo)}: decida a verba da próxima etapa depois dele.`,
    );
  }

  // Recomendações para a próxima etapa (no máximo 5, na ordem de impacto).
  const recomendacoes: Recomendacao[] = [];
  if (vencedor && melhor)
    recomendacoes.push({
      titulo: `Concentre a próxima etapa no argumento de “${melhor.nome}”`,
      texto: `Faça 3 variações dele (outro gancho, outro formato, outra chamada) e deixe de fora ${semResultado.length ? semResultado.map((a) => `“${a.nome}”`).join(", ") : "os anúncios que não venderam"}.`,
      link: "nova_campanha",
    });
  else if (melhor && semResultado.length)
    recomendacoes.push({
      titulo: `Deixe de fora o que não trouxe ${m.nomes}`,
      texto: `${semResultado.map((a) => `“${a.nome}”`).join(", ")} gastaram sem resultado. Na próxima, use “${melhor.nome}” e variações dele.`,
      link: "nova_campanha",
    });
  if (diferenca)
    recomendacoes.push({
      titulo: "Corrija o momento em que o site avisa a Meta do cadastro",
      texto: `Só ${diferenca.destaque?.para ?? ""} dos cadastros que a Meta contou chegaram ao sistema. Faça o evento disparar só quando a conta existe de fato; se há confirmação de e-mail no cadastro, considere tirá-la.`,
      link: "rastreio",
    });
  const vazouTeste = etapas.find((x) => x.rotulo === "Cadastraram → começaram o teste" && x.vazou);
  if (vazouTeste)
    recomendacoes.push({
      titulo: "Leve quem se cadastra até o teste grátis",
      texto: `${vazouTeste.taxa}. Confira se a primeira tela depois do cadastro continua a promessa do anúncio, mande um lembrete no 1º e no 3º dia e crie o público “Cadastraram e não iniciaram teste” para um anúncio de retomada.`,
      link: "publicos",
    });
  if (navegador)
    recomendacoes.push({
      titulo: "Teste o seu cadastro dentro do Instagram",
      texto: `${navegador.destaque?.para ?? ""} das visitas abrem no navegador do app. Faça o caminho inteiro pelo anúncio no celular e tire do caminho o que leva a pessoa para outro app.`,
    });
  if (redistribuicao || e.marcos.some((x) => x.tipo === "pausa_campanha"))
    recomendacoes.push({
      titulo: "Monte a próxima campanha já com os anúncios finais",
      texto: "Pausar anúncios ou a campanha no meio faz a Meta redistribuir a verba e recomeçar o aprendizado. Se a verba apertar, reduza a verba diária em vez de pausar.",
    });

  return {
    titulo: "Balanço da campanha",
    periodo,
    situacao,
    frase,
    numeros,
    funil: etapas,
    funcionou,
    naoFuncionou,
    emAberto,
    recomendacoes: recomendacoes.slice(0, 5),
  };
}
