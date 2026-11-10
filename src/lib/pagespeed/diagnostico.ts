import type { Achado, Categoria, ItemAchado, ResumoVelocidade } from "./resumo";

// Do resumo do PageSpeed para dois públicos. Para quem não é do ramo (a tela): as três medidas que
// importam, com a faixa do Google, e os problemas em texto simples — o que acontece e o que fazer. Para
// quem vai executar (o relatório copiado e "Ver detalhes"): como resolver, passo a passo, com dicas de
// Next.js quando o site é Next, como conferir depois e só os arquivos que dá para mexer; o que é de
// terceiros (pixel da Meta, Clarity) fica numa seção à parte, para ninguém perder tempo com isso.
// Função pura.

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
  /** O que fazer, em uma frase, para quem não é do ramo. */
  acao: string;
  /** Como resolver, passo a passo, para quem vai executar. */
  comoResolver: string[];
  /** Como confirmar que resolveu. */
  conferir?: string;
  /** "até 0,4 s mais rápido", "166 KB a menos". */
  ganho?: string;
  /** Arquivos e elementos do próprio site (sem os de terceiros). */
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
const CONFERIR_PADRAO = "Depois de publicar, rode o teste de novo (botão “Testar de novo” na plataforma): o item deve sumir ou o ganho estimado cair para perto de zero.";

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
/** O site é feito em Next.js (arquivos em /_next/static): as dicas ganham o caminho específico. */
const ehNext = (r: ResumoVelocidade) => r.achados.some((a) => a.itens.some((i) => /\/_next\/static\//.test(i.url ?? ""))) || (r.fontes ?? []).some((f) => /\/_next\/static\//.test(f.url));

interface Contexto {
  host: string;
  r: ResumoVelocidade;
  celular: boolean;
  next: boolean;
}
type Traducao = Omit<Diagnostico, "id" | "tom"> & { tom?: Diagnostico["tom"] };
/** Cada diagnóstico conhecido do Lighthouse em texto. Nulo = não vale mostrar (pequeno ou só de terceiros). */
type Tradutor = (a: Achado, ctx: Contexto) => Traducao | null;

const TRADUTORES: Record<string, Tradutor> = {
  "render-blocking-insight": (a, { host, next }) => {
    const ms = economiaMs(a);
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    if (ms < 100 || !doSite.length) return null;
    const css = doSite.filter((i) => /\.css/.test(i.url ?? "")).length;
    return {
      frente: "carregamento",
      titulo: css === doSite.length ? "Arquivos de estilo seguram a primeira tela" : "Arquivos seguram a primeira tela",
      porque: `Antes de mostrar qualquer coisa, o navegador espera baixar ${plural(doSite.length, "arquivo", "arquivos")}${css === doSite.length ? " de estilo (CSS)" : ""}. No teste, isso atrasa a primeira tela em cerca de ${tempo(ms)}.`,
      acao: "Deixar a página carregar só o estilo que ela usa e embutir no HTML o estilo da primeira tela.",
      comoResolver: [
        "Veja se a página carrega estilos de outras partes do site (páginas internas, área logada) e tire-os desta página.",
        ...(next
          ? [
              "Next.js (App Router): o CSS importado no layout raiz vai para todas as páginas. Importe o CSS da área logada só nos layouts dela (um grupo de rotas, por exemplo) e deixe no layout raiz só o comum (cores, reset).",
              "A opção experimental.inlineCss do next.config embute o CSS no HTML e acaba com essa espera, mas só compensa com CSS pequeno: ela repete todo o CSS em cada carregamento, inclusive na área logada.",
            ]
          : ["Embuta no <head> o CSS necessário para a primeira tela (CSS crítico) e carregue o restante sem bloquear (media=\"print\" trocado no onload, ou preload)."]),
        "Scripts no <head>: use defer ou async.",
      ],
      conferir: CONFERIR_PADRAO,
      ganho: `até ${tempo(ms)} mais rápido`,
      detalhes: doSite.map(linhaItem),
    };
  },
  "image-delivery-insight": (a, { celular, host, next }) => {
    const doSite = a.itens.filter((i) => !i.url || ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    return {
      tom: economia >= 100 * 1024 ? "agir" : "observar",
      frente: "carregamento",
      titulo: "Imagens mais pesadas do que precisam",
      porque: `${plural(doSite.length, "imagem tem", "imagens somam")} ${kb(economia)} que não precisariam ser baixados: ${celular ? "na internet do celular, isso é tempo de espera" : "é tempo de espera e dados gastos à toa"}.`,
      acao: "Exportar as imagens no tamanho em que aparecem na tela e com mais compressão.",
      comoResolver: [
        "“Dá para comprimir mais”: reexporte em WebP ou AVIF com qualidade por volta de 70–75 (a diferença não aparece a olho nu).",
        "“O arquivo tem X px e aparece em Y px”: gere uma versão com cerca de 2× a largura em que aparece (cobre telas de alta densidade) e use essa versão ali.",
        "Se a mesma imagem aparece em tamanhos diferentes, ofereça as versões com srcset e sizes.",
        ...(next
          ? ["Next.js: com next/image sem a opção unoptimized, o Next gera os tamanhos sozinho (usa a otimização de imagens da hospedagem, que pode ter limite ou custo). Com unoptimized, gere as versões à mão."]
          : []),
      ],
      conferir: CONFERIR_PADRAO,
      ganho: `${kb(economia)} a menos`,
      detalhes: doSite.map(linhaItem),
    };
  },
  "unused-javascript": (a, { host, next }) => {
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    const deFora = soma(a.itens.filter((i) => !ehDoSite(i.url, host)).map((i) => i.desperdicio));
    return {
      tom: economia >= 100 * 1024 ? "agir" : "observar",
      frente: "carregamento",
      titulo: "Código baixado que a página não usa",
      porque: `${kb(economia)} de JavaScript do próprio site chegam ao navegador sem serem usados nesta página.${deFora >= 10 * 1024 ? ` Outros ${kb(deFora)} são do pixel da Meta e de ferramentas de fora, que não dá para mudar.` : ""}`,
      acao: "Carregar sob demanda o que não é usado na primeira tela e tirar bibliotecas que a página não usa.",
      comoResolver: [
        `Descubra o que há em cada arquivo listado (o nome não diz): ${next ? "rode next build com o analisador de pacotes (next experimental-analyze ou @next/bundle-analyzer)" : "use o analisador de pacotes do seu build (por exemplo, source-map-explorer)"} ou procure no arquivo nomes de bibliotecas conhecidas.`,
        "Suspeitos comuns: cliente de banco de dados ou de login (Supabase, Firebase) usado só para trocar “Entrar” por “Meu painel”, bibliotecas de gráficos, datas ou animação, componentes de outras páginas.",
        `O que só é usado depois que a página aparece ou depois de um clique: importe sob demanda — import() dinâmico dentro do useEffect ou do evento${next ? ", ou next/dynamic para componentes" : ""}.`,
      ],
      conferir: CONFERIR_PADRAO,
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
      acao: "Ajustar a lista de navegadores atendidos para não gerar essas adaptações.",
      comoResolver: [
        "Confira o browserslist do projeto (package.json ou .browserslistrc) e limite a navegadores atuais.",
        "Se o browserslist já é atual, alguma dependência traz as adaptações (polyfills) dentro dela: o analisador de pacotes mostra qual.",
      ],
      conferir: CONFERIR_PADRAO,
      ganho: `${kb(economia)} a menos`,
      detalhes: doSite.map(linhaItem),
    };
  },
  "unused-css-rules": (a, { host, next }) => {
    const doSite = a.itens.filter((i) => ehDoSite(i.url, host));
    const economia = soma(doSite.map((i) => i.desperdicio));
    if (economia < 20 * 1024) return null;
    return {
      tom: "observar",
      frente: "carregamento",
      titulo: "Estilos que a página não usa",
      porque: `${kb(economia)} de CSS são baixados e não servem para nada nesta página.`,
      acao: "Separar o CSS por área do site, para cada página baixar só o seu.",
      comoResolver: [
        "Normalmente é o CSS de outras áreas do site vindo junto. Separe por área ou por página.",
        ...(next ? ["Next.js: CSS importado no layout raiz vai para todas as páginas — veja o item dos arquivos de estilo que seguram a primeira tela."] : []),
      ],
      conferir: CONFERIR_PADRAO,
      ganho: `${kb(economia)} a menos`,
      detalhes: doSite.map(linhaItem),
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
      acao: "Configurar cache de longo prazo para imagens, fontes e arquivos estáticos.",
      comoResolver: [
        "Arquivos com código no nome (que mudam de nome a cada versão): Cache-Control: public, max-age=31536000, immutable.",
        "Imagens e fontes fixas: max-age de pelo menos alguns dias.",
      ],
      conferir: CONFERIR_PADRAO,
      detalhes: doSite.map(linhaItem),
    };
  },
  "document-latency-insight": (a, { next }) => ({
    frente: "carregamento",
    titulo: "O servidor demora para responder",
    porque: "Antes de qualquer coisa, a página espera o servidor mandar o HTML — e essa espera já está acima do ideal.",
    acao: "Servir a página pronta (em cache) em vez de montá-la a cada visita.",
    comoResolver: [
      next ? "Next.js: deixe a página estática ou com revalidate (ISR) em vez de dinâmica; evite consultas lentas no carregamento da página." : "Gere a página de antemão ou sirva por uma CDN com cache.",
      "Confira se o HTML vai comprimido (gzip ou brotli).",
    ],
    conferir: CONFERIR_PADRAO,
    ganho: economiaMs(a) ? `até ${tempo(economiaMs(a))} mais rápido` : undefined,
    detalhes: a.itens.map(linhaItem),
  }),
  redirects: (a) => ({
    frente: "carregamento",
    titulo: "A página passa por redirecionamentos",
    porque: "O link leva a um endereço que manda para outro antes de abrir: cada salto custa tempo, principalmente no celular.",
    acao: "Usar no anúncio o endereço final, exatamente como a página abre.",
    comoResolver: ["Abra o link do anúncio e copie o endereço que aparece no fim (com ou sem www, com ou sem barra no fim). Use esse no anúncio."],
    conferir: CONFERIR_PADRAO,
    ganho: economiaMs(a) ? `até ${tempo(economiaMs(a))} mais rápido` : undefined,
    detalhes: a.itens.map(linhaItem),
  }),
  "cls-culprits-insight": (a, { r, next }) => {
    const cls = r.laboratorio.cls ?? 0;
    if (cls <= FAIXAS.cls[0]) return null;
    const fonte = a.itens.some((i) => /web font/i.test(i.motivo ?? ""));
    return {
      tom: cls > FAIXAS.cls[1] ? "agir" : "observar",
      frente: "estabilidade",
      titulo: "Coisas mudam de lugar enquanto a página carrega",
      porque: `Textos e botões pulam quando algo carrega depois: a pessoa perde onde estava lendo ou toca no lugar errado.${fonte ? " Aqui, o que empurra a página é a fonte do site chegando depois do texto." : ""}`,
      acao: fonte ? "Fazer a fonte do topo chegar antes e reservar o tamanho certo para o texto enquanto ela não chega." : "Reservar o espaço do que carrega depois (imagens, banners, avisos).",
      comoResolver: fonte
        ? [
            "Pré-carregue a fonte usada no elemento listado (preload) e use uma fonte de reserva com o mesmo tamanho (size-adjust) ou font-display: optional.",
            ...(next ? ["Next.js: next/font já cria a fonte de reserva ajustada; confira se a fonte desse elemento vem do next/font e se não há fontes demais disputando a pré-carga (veja o item das fontes)."] : []),
          ]
        : ["Coloque width e height em imagens e vídeos.", "Reserve altura fixa para o que entra depois (banners, avisos de cookies, conteúdo carregado por script)."],
      conferir: CONFERIR_PADRAO,
      detalhes: a.itens.map(linhaItem),
    };
  },
  "unsized-images": (a) => ({
    tom: "observar",
    frente: "estabilidade",
    titulo: "Imagens sem tamanho definido",
    porque: "Sem largura e altura, a página não reserva o espaço da imagem e o conteúdo pula quando ela chega.",
    acao: "Colocar largura e altura em todas as imagens.",
    comoResolver: ["Coloque width e height (ou aspect-ratio no CSS) em todas as imagens listadas."],
    conferir: CONFERIR_PADRAO,
    detalhes: a.itens.map(linhaItem),
  }),
  "font-display-insight": (a) => ({
    tom: "observar",
    frente: "carregamento",
    titulo: "O texto espera a fonte para aparecer",
    porque: "Enquanto a fonte personalizada não chega, o texto fica invisível.",
    acao: "Mostrar o texto com uma fonte de reserva enquanto a fonte do site carrega.",
    comoResolver: ["Use font-display: swap (ou optional) no @font-face das fontes listadas."],
    conferir: CONFERIR_PADRAO,
    detalhes: a.itens.map(linhaItem),
  }),
  "dom-size-insight": () => ({
    tom: "observar",
    frente: "resposta",
    titulo: "Página com elementos demais",
    porque: "Uma página muito grande deixa cada toque e cada rolagem mais pesados para o aparelho.",
    acao: "Carregar listas longas aos poucos e simplificar trechos com muitos elementos.",
    comoResolver: ["Listas longas: paginar ou carregar ao rolar.", "Simplifique trechos com muitos elementos aninhados (ícones, grades)."],
    detalhes: [],
  }),
  "viewport-insight": () => ({
    frente: "resposta",
    titulo: "A página não está ajustada para celular",
    porque: "Sem a configuração de tela para celular, os toques podem demorar até 300 ms para responder.",
    acao: "Incluir a configuração de tela para celular no cabeçalho.",
    comoResolver: ['Inclua <meta name="viewport" content="width=device-width, initial-scale=1"> no <head>.'],
    conferir: CONFERIR_PADRAO,
    detalhes: [],
  }),
};

/** Arquivos de fonte demais na primeira carga (o Lighthouse não aponta; vem da lista de requisições). */
function fontesDemais(r: ResumoVelocidade, { host, next }: Contexto): Omit<Diagnostico, "id"> | null {
  const fontes = (r.fontes ?? []).filter((f) => ehDoSite(f.url, host) || /fonts\.gstatic|typekit|fonts\.googleapis/.test(f.url));
  const total = soma(fontes.map((f) => f.bytes));
  if (fontes.length < 5 && total < 120 * 1024) return null;
  return {
    tom: fontes.length >= 8 || total >= 200 * 1024 ? "agir" : "observar",
    frente: "carregamento",
    titulo: "Arquivos de fonte demais na primeira carga",
    porque: `A página baixa ${plural(fontes.length, "arquivo de fonte", "arquivos de fonte")} (${kb(total)}) logo no começo. Eles disputam a internet com o que monta a primeira tela; normalmente a página usa só 2 ou 3.`,
    acao: "Carregar só as fontes (famílias e pesos) que esta página usa.",
    comoResolver: [
      "Confira quais famílias e pesos a página realmente usa e carregue só esses aqui.",
      ...(next
        ? [
            "Next.js (next/font): toda fonte declarada num layout é pré-carregada em todas as páginas abaixo dele. Fontes de outra área do site (por exemplo, da área logada) declaradas no layout raiz pesam aqui: use preload: false nelas ou declare-as no layout da área que as usa.",
          ]
        : ["Tire os <link rel=\"preload\" as=\"font\"> de fontes que não aparecem na primeira tela."]),
      "Prefira fontes variáveis (um arquivo cobre todos os pesos).",
    ],
    conferir: "Depois de publicar, rode o teste de novo: este item some quando a página baixar poucas fontes.",
    ganho: `${plural(fontes.length, "fonte", "fontes")}, ${kb(total)}`,
    detalhes: fontes.map((f) => `${f.url} — ${kb(f.bytes)}`),
  };
}

/** O que segura a resposta a toques: tempo travado (TBT) e quem causa (scripts do site e de fora). */
function travamento(r: ResumoVelocidade, { host, next }: Contexto): Omit<Diagnostico, "id"> | null {
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
  return {
    tom: cat === "ruim" ? "agir" : "observar",
    frente: "resposta",
    titulo: "A página fica travada enquanto carrega",
    porque: `Durante o carregamento, o navegador passa ${tempo(tbt)} ocupado sem conseguir responder: quem toca num botão nesse momento sente a página travada.${culpados.length ? ` Quem mais ocupa o navegador nesse período: ${culpados.join(", ")}.` : ""}`,
    acao: "Adiar o que não é essencial para depois que a página aparece e diminuir o JavaScript da primeira carga.",
    comoResolver: [
      `Scripts de fora que não são essenciais (chat, mapas, vídeos, pixels extras): carregue depois que a página aparece${next ? " (next/script com strategy=\"lazyOnload\")" : ""}.`,
      "Código do próprio site: menos JavaScript na primeira carga (veja o item do código não usado) e tarefas longas quebradas em partes.",
      "Não remova o pixel da Meta (mede os resultados da campanha) nem o Clarity (mede o comportamento na página): eles pesam, mas são necessários.",
    ],
    conferir: "Depois de publicar, rode o teste de novo: o tempo travada deve ficar abaixo de 200 ms.",
    detalhes: longas.filter((t) => ehDoSite(t.url, host)).map(linhaItem),
  };
}

const NOME_FASE: Record<string, string> = { servidor: "Resposta do servidor", atrasoCarga: "Atraso para começar a baixar", download: "Download", atrasoDesenho: "Espera para desenhar" };
const FASES: Record<string, { texto: string; acao: string; passos: string[] }> = {
  servidor: {
    texto: "a maior parte é a espera pelo servidor",
    acao: "Deixar a página pronta em cache para o servidor responder mais rápido.",
    passos: ["Sirva a página pronta (estática, com revalidação, ou por CDN) em vez de montá-la a cada visita."],
  },
  atrasoCarga: {
    texto: "o navegador demora para começar a baixar esse conteúdo",
    acao: "Avisar o navegador logo no começo da página que esse conteúdo é o mais importante.",
    passos: ['Use preload ou fetchpriority="high" nesse elemento e não use loading="lazy" nele.'],
  },
  download: {
    texto: "o arquivo demora para baixar",
    acao: "Deixar esse arquivo menor.",
    passos: ["Comprima, use o tamanho certo e formato WebP ou AVIF."],
  },
  atrasoDesenho: {
    texto: "o conteúdo já chegou, mas espera estilos, fontes e scripts para ser desenhado",
    acao: "Tirar o que segura a primeira tela: estilos de outras páginas, fontes demais e scripts no topo.",
    passos: ["Veja os itens dos arquivos de estilo, das fontes e do código não usado: é o que segura este elemento."],
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
    comoResolver: f?.passos ?? [],
    conferir: "Depois de publicar, rode o teste de novo: o conteúdo principal deve aparecer em até 2,5 s.",
    detalhes: [...(r.lcp.seletor ? [`Elemento: ${r.lcp.seletor}`] : []), ...fases.map(([k, v]) => `${NOME_FASE[k] ?? k}: ${tempo(v ?? 0)}`)],
  };
}

export function lerVelocidade(r: ResumoVelocidade): LeituraVelocidade {
  let host = "";
  try {
    host = new URL(r.url).host.replace(/^www\./, "");
  } catch {}
  const ctx: Contexto = { host, r, celular: noCelular(r), next: ehNext(r) };

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
  const travada = travamento(r, ctx);
  if (travada) diagnosticos.push({ id: "travamento", ...travada });
  const fontes = fontesDemais(r, ctx);
  if (fontes) diagnosticos.push({ id: "fontes", ...fontes });
  for (const a of r.achados) {
    const t = TRADUTORES[a.id]?.(a, ctx);
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

  return { medidas, diagnosticos, textoTecnico: textoTecnico(r, medidas, diagnosticos, ctx) };
}

const ROTULO_CATEGORIA: Record<Categoria, string> = { bom: "bom", melhorar: "precisa melhorar", ruim: "ruim" };

/**
 * Relatório para quem vai executar: o contexto do teste, o que fazer em ordem de ganho (cada item com o
 * problema, como resolver, como conferir e os arquivos do site) e, à parte, o que é de terceiros.
 */
function textoTecnico(r: ResumoVelocidade, medidas: Medida[], diagnosticos: Diagnostico[], { host }: Contexto) {
  const lab = r.laboratorio;
  const aparelho = noCelular(r) ? "celular" : "computador";
  const pagina = r.url.replace(/^https?:\/\//, "");
  const bons = medidas.every((m) => m.categoria === "bom");
  const linhas = [
    `RELATÓRIO DE VELOCIDADE — ${pagina} (${aparelho})`,
    `Teste de laboratório do PageSpeed Insights (Lighthouse ${r.lighthouse}) em ${new Date(r.testadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · nota ${r.nota ?? "—"}/100`,
    `Medidas: ${medidas.map((m) => `${{ lcp: "LCP (conteúdo principal)", tbt: "TBT (tempo travada)", cls: "CLS (coisas mudando de lugar)" }[m.chave]} ${m.valor}${m.categoria ? ` — ${ROTULO_CATEGORIA[m.categoria]}` : ""}`).join(" · ")}`,
    `Outras: FCP ${tempo(lab.fcp)} · Speed Index ${tempo(lab.si)}`,
  ];
  if (r.campo)
    linhas.push(
      `Visitas reais (Chrome, 28 dias, ${r.campo.fonte === "pagina" ? "esta página" : "site todo"}): ${Object.entries(r.campo.metricas)
        .map(([k, v]) => `${k} ${k === "CLS" ? v.p75 : tempo(v.p75)} (${ROTULO_CATEGORIA[v.categoria]})`)
        .join(" · ")}`,
    );
  linhas.push(
    "",
    bons
      ? `Situação: as três medidas estão na faixa boa neste teste. Os itens abaixo são para os visitantes reais, que abrem a página ${aparelho === "celular" ? "dentro do Instagram ou do Facebook, com internet móvel, e costumam vê-la mais devagar" : "com conexões e aparelhos variados"}.`
      : "Situação: há medidas fora da faixa boa. Comece pelos itens marcados como “vale corrigir”.",
  );

  if (diagnosticos.length) {
    linhas.push("", "O QUE FAZER — do maior ganho para o menor");
    diagnosticos.forEach((d, n) => {
      linhas.push("", `${n + 1}. ${d.titulo} [${d.tom === "agir" ? "vale corrigir" : "melhoria menor"}${d.ganho ? ` · ${d.ganho}` : ""}]`);
      linhas.push(`   O que acontece: ${d.porque}`);
      if (d.comoResolver.length) {
        linhas.push("   Como resolver:");
        for (const p of d.comoResolver) linhas.push(`   - ${p}`);
      } else linhas.push(`   Como resolver: ${d.acao}`);
      if (d.detalhes.length) {
        linhas.push("   Arquivos e elementos:");
        for (const x of d.detalhes) linhas.push(`   · ${x}`);
      }
      if (d.conferir) linhas.push(`   Como conferir: ${d.conferir}`);
    });
  } else linhas.push("", "Nada importante a corrigir na velocidade desta página.");

  // Terceiros: o que pesa e não depende do site. Junta o resumo de terceiros com os itens de fora.
  const deFora = new Map<string, number>();
  for (const a of r.achados) for (const i of a.itens) if (i.url && !ehDoSite(i.url, host)) deFora.set(i.url.split("/")[0], (deFora.get(i.url.split("/")[0]) ?? 0) + 1);
  if (r.terceiros.length || deFora.size) {
    linhas.push("", "FORA DO CONTROLE DO SITE — não precisa mexer");
    for (const t of r.terceiros) {
      const nome = /facebook|meta/i.test(t.nome) ? "Pixel da Meta" : /clarity/i.test(t.nome) ? "Microsoft Clarity" : t.nome;
      const nota = /Pixel da Meta/.test(nome) ? " Mede os resultados da campanha: não remova." : /Clarity/.test(nome) ? " Mede o comportamento na página: não remova." : "";
      linhas.push(`- ${nome}: ${kb(t.bytes)} e ${tempo(t.ms)} de processamento.${nota}`);
    }
    linhas.push("- Cache curto, código não usado e código antigo dos arquivos de connect.facebook.net e clarity.ms são desses serviços: o Lighthouse aponta, mas não há o que fazer no site.");
  }
  return linhas.join("\n");
}
