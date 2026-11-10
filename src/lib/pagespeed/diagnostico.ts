import type { Achado, Categoria, ItemAchado, ResumoVelocidade } from "./resumo";

// Do resumo do PageSpeed para o que a tela mostra a quem não é do ramo: as três medidas que importam, com
// a faixa do Google, e uma lista de problemas — cada um com o que acontece, por que importa, o que fazer
// e os detalhes técnicos (arquivos, tamanhos) para encaminhar a quem cuida do site. Função pura.

export type Frente = "carregamento" | "resposta" | "estabilidade";

export interface Medida {
  chave: "lcp" | "tbt" | "cls";
  rotulo: string;
  valor: string;
  categoria: Categoria | null;
  explica: string;
}

export interface Diagnostico {
  id: string;
  tom: "agir" | "observar";
  frente: Frente;
  titulo: string;
  porque: string;
  acao: string;
  /** "até 0,4 s mais rápido", "166 KB a menos". */
  ganho?: string;
  detalhes: string[];
}

export interface LeituraVelocidade {
  medidas: Medida[];
  diagnosticos: Diagnostico[];
  /** Versão técnica, para copiar e mandar a quem cuida do site. */
  textoTecnico: string;
}

// Faixas do Google (Core Web Vitals; o TBT do laboratório é o substituto do INP).
const FAIXAS = { lcp: [2500, 4000], tbt: [200, 600], cls: [0.1, 0.25], inp: [200, 500], fcp: [1800, 3000] } as const;
export const categoria = (v: number | null, [bom, ruim]: readonly [number, number]): Categoria | null => (v === null ? null : v <= bom ? "bom" : v <= ruim ? "melhorar" : "ruim");

export const tempo = (ms: number | null) =>
  ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : `${Math.round(ms / 10) * 10} ms`;
export const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString("pt-BR")} KB`;
const soma = (xs: Array<number | undefined>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Motivos do Lighthouse (em inglês) em português curto. */
export function traduzirMotivo(m: string | undefined) {
  if (!m) return null;
  const tamanho = m.match(/\((\d+x\d+)\) for its displayed dimensions \((\d+x\d+)\)/);
  if (tamanho) return `o arquivo tem ${tamanho[1]} px e aparece em ${tamanho[2]} px`;
  if (/compression factor/i.test(m)) return "dá para comprimir mais";
  if (/modern image format/i.test(m)) return "usar formato moderno (WebP ou AVIF)";
  if (/animated content|video formats/i.test(m)) return "GIF animado: trocar por vídeo";
  if (/unsized|explicit width and height/i.test(m)) return "imagem sem largura e altura definidas";
  if (/web font/i.test(m)) return "troca de fonte durante o carregamento";
  if (/injected|dynamic content/i.test(m)) return "conteúdo inserido depois de a página aparecer";
  return m.length > 140 ? `${m.slice(0, 137)}…` : m;
}

function linhaItem(i: ItemAchado) {
  const partes = [i.url ?? i.rotulo ?? "?"];
  if (i.url && i.rotulo) partes.push(`(${i.rotulo})`);
  const numeros = [i.bytes ? kb(i.bytes) : null, i.desperdicio ? `${kb(i.desperdicio)} a mais` : null, i.ms ? tempo(i.ms) : null, i.deslocamento ? `deslocamento ${i.deslocamento}` : null].filter(Boolean);
  if (numeros.length) partes.push(`— ${numeros.join(", ")}`);
  const motivo = traduzirMotivo(i.motivo);
  if (motivo) partes.push(`· ${motivo}`);
  return partes.join(" ");
}

/** O teste foi no celular (tela estreita) ou no computador. */
export const noCelular = (r: ResumoVelocidade) => r.tela.largura < 800;
const ehDoSite = (url: string | undefined, host: string) => !!url && url.replace(/^www\./, "").startsWith(host);
const economiaMs = (a: Achado) => Math.max(a.economia.LCP ?? 0, a.economia.FCP ?? 0);

/** Cada diagnóstico conhecido do Lighthouse em texto simples. Nulo = não vale mostrar (pequeno ou de terceiros). */
type Tradutor = (a: Achado, ctx: { host: string; r: ResumoVelocidade; celular: boolean }) => Omit<Diagnostico, "id" | "tom"> & { tom?: Diagnostico["tom"] } | null;

const TRADUTORES: Record<string, Tradutor> = {
  "render-blocking-insight": (a) => {
    const ms = economiaMs(a);
    if (ms < 100) return null;
    const css = a.itens.filter((i) => /\.css/.test(i.url ?? "")).length;
    return {
      frente: "carregamento",
      titulo: css === a.itens.length ? "Arquivos de estilo seguram a primeira tela" : "Arquivos seguram a primeira tela",
      porque: `Antes de mostrar qualquer coisa, o navegador espera baixar ${plural(a.itens.length, "arquivo", "arquivos")}${css === a.itens.length ? " de estilo (CSS)" : ""}. No teste, isso atrasa a primeira tela em cerca de ${tempo(ms)}.`,
      acao: "Embutir no HTML só o estilo necessário para a primeira tela e carregar o resto depois (CSS crítico); scripts no topo da página com defer ou async.",
      ganho: `até ${tempo(ms)} mais rápido`,
      detalhes: a.itens.map(linhaItem),
    };
  },
  "image-delivery-insight": (a, { celular }) => {
    const economia = soma(a.itens.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    return {
      tom: economia >= 100 * 1024 ? "agir" : "observar",
      frente: "carregamento",
      titulo: "Imagens mais pesadas do que precisam",
      porque: `${plural(a.itens.length, "imagem tem", "imagens somam")} ${kb(economia)} que não precisariam ser baixados: ${celular ? "na internet do celular, isso é tempo de espera" : "é tempo de espera e dados gastos à toa"}.`,
      acao: "Exportar as imagens no tamanho em que aparecem na tela (ou em versões por tamanho de tela, com srcset e sizes) e com mais compressão (WebP ou AVIF).",
      ganho: `${kb(economia)} a menos`,
      detalhes: a.itens.map(linhaItem),
    };
  },
  "unused-javascript": (a, { host }) => {
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    const deFora = soma(a.itens.filter((i) => !ehDoSite(i.url, host)).map((i) => i.desperdicio));
    return {
      tom: economia >= 100 * 1024 ? "agir" : "observar",
      frente: "carregamento",
      titulo: "Código baixado que a página não usa",
      porque: `${kb(economia)} de JavaScript do próprio site chegam ao navegador sem serem usados nesta página.${deFora >= 10 * 1024 ? ` Outros ${kb(deFora)} são do pixel da Meta e de ferramentas de fora, que não dá para mudar.` : ""}`,
      acao: "Carregar sob demanda o que não aparece na primeira tela (import dinâmico) e tirar bibliotecas que a página não usa.",
      ganho: `${kb(economia)} a menos`,
      detalhes: doSite.map(linhaItem),
    };
  },
  "legacy-javascript-insight": (a, { host }) => {
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 10 * 1024) return null;
    return {
      tom: "observar",
      frente: "carregamento",
      titulo: "Código adaptado para navegadores antigos",
      porque: `${kb(economia)} do código do site existem só para funcionar em navegadores muito antigos, que quase ninguém usa.`,
      acao: "Atualizar a lista de navegadores atendidos (browserslist) para não gerar essas adaptações.",
      ganho: `${kb(economia)} a menos`,
      detalhes: doSite.map(linhaItem),
    };
  },
  "unused-css-rules": (a) => {
    const economia = soma(a.itens.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    return {
      tom: "observar",
      frente: "carregamento",
      titulo: "Estilos que a página não usa",
      porque: `${kb(economia)} de CSS são baixados e não servem para nada nesta página.`,
      acao: "Remover o CSS que não é usado ou separar por página.",
      ganho: `${kb(economia)} a menos`,
      detalhes: a.itens.map(linhaItem),
    };
  },
  "cache-insight": (a, { host }) => {
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 50 * 1024) return null;
    return {
      tom: "observar",
      frente: "carregamento",
      titulo: "Arquivos do site sem cache longo",
      porque: `Quem volta à página baixa de novo ${kb(economia)} que poderiam ficar guardados no aparelho.`,
      acao: "Configurar cache de longo prazo (Cache-Control) para imagens, fontes e arquivos estáticos.",
      detalhes: doSite.map(linhaItem),
    };
  },
  "document-latency-insight": (a) => ({
    frente: "carregamento",
    titulo: "O servidor demora para responder",
    porque: "Antes de qualquer coisa, a página espera o servidor mandar o HTML — e essa espera já está acima do ideal.",
    acao: "Servir a página em cache (CDN) ou gerar a página de antemão, em vez de montá-la a cada visita; conferir compressão (gzip/brotli).",
    ganho: economiaMs(a) ? `até ${tempo(economiaMs(a))} mais rápido` : undefined,
    detalhes: a.itens.map(linhaItem),
  }),
  redirects: (a) => ({
    frente: "carregamento",
    titulo: "A página passa por redirecionamentos",
    porque: "O link leva a um endereço que manda para outro antes de abrir: cada salto custa tempo, principalmente no celular.",
    acao: "Usar no anúncio o endereço final (com ou sem www, com ou sem barra no fim, exatamente como a página abre).",
    ganho: economiaMs(a) ? `até ${tempo(economiaMs(a))} mais rápido` : undefined,
    detalhes: a.itens.map(linhaItem),
  }),
  "cls-culprits-insight": (a, { r }) => {
    const cls = r.laboratorio.cls ?? 0;
    if (cls <= FAIXAS.cls[0]) return null;
    const fonte = a.itens.some((i) => /web font/i.test(i.motivo ?? ""));
    return {
      tom: cls > FAIXAS.cls[1] ? "agir" : "observar",
      frente: "estabilidade",
      titulo: "Coisas mudam de lugar enquanto a página carrega",
      porque: `Textos e botões pulam quando algo carrega depois: a pessoa perde onde estava lendo ou toca no lugar errado.${fonte ? " Aqui, o que empurra a página é a fonte do site chegando depois do texto." : ""}`,
      acao: fonte
        ? "Pré-carregar a fonte usada no topo (preload) e usar uma fonte de reserva com o mesmo tamanho (size-adjust, ou font-display: optional), para o texto não mudar de tamanho quando ela chega."
        : "Definir largura e altura de imagens e vídeos, reservar espaço para o que entra depois (banners, avisos) e carregar as fontes sem trocar o tamanho do texto.",
      detalhes: a.itens.map(linhaItem),
    };
  },
  "unsized-images": (a) => ({
    tom: "observar",
    frente: "estabilidade",
    titulo: "Imagens sem tamanho definido",
    porque: "Sem largura e altura, a página não reserva o espaço da imagem e o conteúdo pula quando ela chega.",
    acao: "Colocar width e height em todas as imagens.",
    detalhes: a.itens.map(linhaItem),
  }),
  "font-display-insight": (a) => ({
    tom: "observar",
    frente: "carregamento",
    titulo: "O texto espera a fonte para aparecer",
    porque: "Enquanto a fonte personalizada não chega, o texto fica invisível.",
    acao: "Usar font-display: swap (ou optional) nas fontes.",
    detalhes: a.itens.map(linhaItem),
  }),
  "dom-size-insight": () => ({
    tom: "observar",
    frente: "resposta",
    titulo: "Página com elementos demais",
    porque: "Uma página muito grande deixa cada toque e cada rolagem mais pesados para o aparelho.",
    acao: "Carregar listas longas aos poucos e simplificar trechos com muitos elementos aninhados.",
    detalhes: [],
  }),
  "viewport-insight": () => ({
    frente: "resposta",
    titulo: "A página não está ajustada para celular",
    porque: "Sem a configuração de tela para celular, os toques podem demorar até 300 ms para responder.",
    acao: 'Incluir <meta name="viewport" content="width=device-width, initial-scale=1"> no cabeçalho.',
    detalhes: [],
  }),
};

/** O que segura a resposta a toques: tempo travado (TBT) e quem causa (scripts do site e de fora). */
function travamento(r: ResumoVelocidade, host: string): Omit<Diagnostico, "id"> | null {
  const tbt = r.laboratorio.tbt;
  const cat = categoria(tbt, FAIXAS.tbt);
  if (tbt === null || cat === "bom") return null;
  const longas = r.achados.find((a) => a.id === "long-tasks")?.itens ?? [];
  const porOrigem = new Map<string, number>();
  for (const t of longas) {
    const quem = ehDoSite(t.url, host) ? "código do próprio site" : /facebook|fbevents/.test(t.url ?? "") ? "pixel da Meta" : /clarity/.test(t.url ?? "") ? "Clarity" : (t.url?.split("/")[0] ?? "outros");
    porOrigem.set(quem, (porOrigem.get(quem) ?? 0) + (t.ms ?? 0));
  }
  const ordem = [...porOrigem].sort((a, b) => b[1] - a[1]);
  const culpados = ordem.map(([q, ms]) => `${q} (${tempo(ms)})`);
  const metaPrimeiro = ordem[0]?.[0] === "pixel da Meta";
  return {
    tom: cat === "ruim" ? "agir" : "observar",
    frente: "resposta",
    titulo: "A página fica travada enquanto carrega",
    porque: `Durante o carregamento, o navegador passa ${tempo(tbt)} ocupado sem conseguir responder: quem toca num botão nesse momento sente a página travada.${culpados.length ? ` Quem mais ocupa o navegador nesse período: ${culpados.join(", ")}.` : ""}`,
    acao: `Adiar para depois que a página aparece os scripts que não são essenciais (chat, mapas, vídeos, pixels extras) e quebrar as tarefas longas do código do site.${metaPrimeiro ? " O pixel da Meta pesa, mas é ele que mede os resultados da campanha: não remova." : ""}`,
    detalhes: longas.map(linhaItem),
  };
}

const FASES: Record<string, { texto: string; acao: string }> = {
  servidor: { texto: "a maior parte é a espera pelo servidor", acao: "Deixar a página em cache (CDN) para o servidor responder mais rápido." },
  atrasoCarga: {
    texto: "o navegador demora para começar a baixar esse conteúdo",
    acao: 'Avisar o navegador logo no começo da página (preload ou fetchpriority="high") e não usar carregamento preguiçoso (lazy) nesse elemento.',
  },
  download: { texto: "o arquivo demora para baixar", acao: "Deixar esse arquivo menor (compressão, tamanho certo, formato WebP ou AVIF)." },
  atrasoDesenho: {
    texto: "o conteúdo já chegou, mas espera estilos e scripts para ser desenhado",
    acao: "Tirar o que bloqueia a primeira tela (CSS e scripts no topo da página) — veja o item dos arquivos que seguram a primeira tela.",
  },
};

/** O maior conteúdo da primeira tela: o que é e onde o tempo dele vai. */
function conteudoPrincipal(r: ResumoVelocidade): Omit<Diagnostico, "id"> | null {
  const lcp = r.laboratorio.lcp;
  const fases = Object.entries(r.lcp.fases).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const [fase, ms] = fases[0] ?? [];
  const cat = categoria(lcp, FAIXAS.lcp);
  if (lcp === null || !fase || cat === "bom") return null;
  const f = FASES[fase];
  // As fases são medidas e o LCP da nota é simulado (internet lenta): os dois não somam, então a fase
  // entra como parte do tempo, não em milissegundos.
  const parte = (ms ?? 0) / (soma(fases.map(([, v]) => v)) || 1);
  return {
    tom: cat === "ruim" ? "agir" : "observar",
    frente: "carregamento",
    titulo: "O conteúdo principal da primeira tela demora a aparecer",
    porque: `O maior conteúdo da primeira tela é ${r.lcp.elemento ? `“${r.lcp.elemento}”` : "um elemento do topo"} e fica pronto em ${tempo(lcp)} no teste. ${parte >= 0.5 ? "A maior parte desse tempo é porque" : "Boa parte desse tempo é porque"} ${f?.texto ?? fase}.`,
    acao: f?.acao ?? "Revisar o carregamento desse elemento.",
    detalhes: [
      ...(r.lcp.seletor ? [`Elemento: ${r.lcp.seletor}`] : []),
      ...fases.map(([k, v]) => `${{ servidor: "Resposta do servidor", atrasoCarga: "Atraso para começar a baixar", download: "Download", atrasoDesenho: "Espera para desenhar" }[k] ?? k}: ${tempo(v ?? 0)}`),
    ],
  };
}

export function lerVelocidade(r: ResumoVelocidade): LeituraVelocidade {
  let host = "";
  try {
    host = new URL(r.url).host.replace(/^www\./, "");
  } catch {}

  const lab = r.laboratorio;
  const medidas: Medida[] = [
    { chave: "lcp", rotulo: "Conteúdo principal aparece em", valor: tempo(lab.lcp), categoria: categoria(lab.lcp, FAIXAS.lcp), explica: "bom até 2,5 s; ruim acima de 4 s" },
    { chave: "tbt", rotulo: "Tempo travada enquanto carrega", valor: tempo(lab.tbt), categoria: categoria(lab.tbt, FAIXAS.tbt), explica: "bom até 200 ms; ruim acima de 600 ms" },
    {
      chave: "cls",
      rotulo: "Coisas mudando de lugar",
      valor: lab.cls === null ? "—" : lab.cls.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
      categoria: categoria(lab.cls, FAIXAS.cls),
      explica: "bom até 0,1; ruim acima de 0,25",
    },
  ];

  const diagnosticos: Diagnostico[] = [];
  const principal = conteudoPrincipal(r);
  if (principal) diagnosticos.push({ id: "conteudo-principal", ...principal });
  const travada = travamento(r, host);
  if (travada) diagnosticos.push({ id: "travamento", ...travada });
  for (const a of r.achados) {
    const t = TRADUTORES[a.id]?.(a, { host, r, celular: noCelular(r) });
    if (!t) continue;
    const ms = economiaMs(a);
    const bytes = soma(a.itens.map((i) => i.desperdicio));
    diagnosticos.push({ id: a.id, tom: t.tom ?? (ms >= 300 || bytes >= 100 * 1024 ? "agir" : "observar"), ...t });
  }
  const peso = (d: Diagnostico) => {
    const a = r.achados.find((x) => x.id === d.id);
    return (d.tom === "agir" ? 1e9 : 0) + (a ? economiaMs(a) * 1000 + soma(a.itens.map((i) => i.desperdicio)) : 5e5);
  };
  diagnosticos.sort((a, b) => peso(b) - peso(a));

  return { medidas, diagnosticos, textoTecnico: textoTecnico(r) };
}

/** Relatório técnico (para colar numa mensagem): medidas, o LCP e todos os achados com os arquivos. */
export function textoTecnico(r: ResumoVelocidade) {
  const lab = r.laboratorio;
  const linhas = [
    `PageSpeed Insights (Lighthouse ${r.lighthouse}, ${noCelular(r) ? "celular" : "computador"}) — ${r.url}`,
    `Testado em ${new Date(r.testadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · nota ${r.nota ?? "—"}/100`,
    `LCP ${tempo(lab.lcp)} · FCP ${tempo(lab.fcp)} · TBT ${tempo(lab.tbt)} · CLS ${lab.cls === null ? "—" : Math.round(lab.cls * 1000) / 1000} · Speed Index ${tempo(lab.si)}`,
  ];
  if (r.campo)
    linhas.push(
      `Dados de campo (Chrome, ${r.campo.fonte === "pagina" ? "esta página" : "site todo"}): ${Object.entries(r.campo.metricas)
        .map(([k, v]) => `${k} p75 ${k === "CLS" ? v.p75 : tempo(v.p75)}`)
        .join(" · ")}`,
    );
  if (r.lcp.seletor)
    linhas.push(
      "",
      `Elemento LCP: ${r.lcp.seletor}${r.lcp.elemento ? ` ("${r.lcp.elemento}")` : ""}`,
      ...Object.entries(r.lcp.fases).map(([k, v]) => `  ${k}: ${tempo(v ?? 0)}`),
    );
  for (const a of [...r.achados].sort((x, y) => economiaMs(y) - economiaMs(x))) {
    const eco = Object.entries(a.economia)
      .map(([k, v]) => `${k} -${k === "CLS" ? v : tempo(v ?? 0)}`)
      .join(", ");
    linhas.push("", `• ${a.titulo}${a.exibicao ? ` — ${a.exibicao}` : ""}${eco ? ` (${eco})` : ""}`);
    for (const i of a.itens) linhas.push(`    - ${linhaItem({ ...i, motivo: i.motivo })}`);
  }
  if (r.terceiros.length) linhas.push("", `Terceiros: ${r.terceiros.map((t) => `${t.nome} ${tempo(t.ms)} / ${kb(t.bytes)}`).join(" · ")}`);
  return linhas.join("\n");
}
