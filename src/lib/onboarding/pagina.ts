// Conferência da página de destino, sem acesso à rede: o que pode ser aberto e o que o HTML mostra.
import { isIP } from "node:net";
import type { ResultadoPagina } from "./modelo";

/** Endereço privado ou local: o servidor não abre esses, mesmo que a pessoa informe. */
export function ipPrivado(ip: string) {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/** URL que pode ser aberta: http(s), sem credenciais, em porta padrão e sem host interno. Devolve o motivo quando não. */
export function validarUrlPagina(texto: string): { url: URL } | { erro: string } {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(texto.trim()) ? texto.trim() : `https://${texto.trim()}`);
  } catch {
    return { erro: "Esse endereço não parece válido. Exemplo: https://www.sualoja.com.br/pagina" };
  }
  const interno = url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || !url.hostname.includes(".");
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    interno ||
    (isIP(url.hostname.replace(/^\[|\]$/g, "")) && ipPrivado(url.hostname.replace(/^\[|\]$/g, "")))
  )
    return { erro: "Informe o endereço público da página, o mesmo que aparece para quem clica no anúncio." };
  return { url };
}

export const pixelsNaPagina = (html: string) => [
  ...new Set([...html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,})['"]/g), ...html.matchAll(/facebook\.com\/tr\/?\?id=(\d{6,})/g)].map((m) => m[1])),
];
export const temGerenciadorDeTags = (html: string) => /googletagmanager\.com\/gtm\.js/.test(html);
export const temScriptCheckout = (html: string) => /a\[href\*=\\?["']hotmart\.com/.test(html) && /["']sck["']/.test(html);

/** Scripts da página, os do próprio site primeiro. Inclui os pré-carregados e os caminhos do Next.js citados no HTML. */
export function scriptsDaPagina(html: string, base: string, limite = 20) {
  const achados = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
    ...html.matchAll(/<link[^>]+href=["']([^"']+\.js[^"']*)["']/gi),
    ...html.matchAll(/["'\s](\/_next\/static\/[^"'\\\s]+\.js)/g),
  ].map((m) => m[1].replace(/&amp;/g, "&"));
  const host = new URL(base).hostname;
  const urls = new Map<string, URL>();
  for (const a of achados) {
    try {
      const v = validarUrlPagina(new URL(a, base).toString());
      if ("url" in v) urls.set(v.url.toString(), v.url);
    } catch {
      /* endereço malformado: ignora */
    }
  }
  return [...urls.values()].sort((a, b) => Number(b.hostname === host) - Number(a.hostname === host)).slice(0, limite);
}

const carregaPixel = (js: string) => /connect\.facebook\.net\/[^"']*fbevents|\bfbq\(/.test(js);

/**
 * Monta o resultado da conferência. Sites modernos carregam o pixel por JavaScript, então os scripts contam tanto quanto
 * o HTML. Só é erro o que é certeza: outro pixel escrito de forma explícita. Não ver o pixel é aviso, com o motivo.
 */
export function analisarPagina(entrada: {
  url: string;
  status: number;
  html: string;
  scripts?: string[];
  pixelEsperado: string | null;
  exigeScript: boolean;
  em: string;
}): ResultadoPagina {
  const { url, status, html, scripts = [], pixelEsperado, exigeScript, em } = entrada;
  const itens: ResultadoPagina["itens"] = [];
  if (status < 200 || status >= 400) {
    itens.push({ tom: "erro", titulo: "A página não abriu", detalhe: `Ela respondeu com o código ${status}. Confira o endereço e se a página está publicada.` });
    return { url, status: "erro", itens, em };
  }
  itens.push({ tom: "ok", titulo: "A página abre", detalhe: url });
  if (exigeScript)
    itens.push(
      temScriptCheckout(html) || scripts.some(temScriptCheckout)
        ? { tom: "ok", titulo: "Linha de rastreio instalada", detalhe: "Os parâmetros do anúncio chegam ao link de compra." }
        : {
            tom: "erro",
            titulo: "A linha de rastreio não está nesta página",
            detalhe: "Sem ela, a venda chega sem o anúncio de origem. Cole a linha e, se usar plugin de cache, limpe o cache do site.",
          },
    );
  if (pixelEsperado) {
    const tudo = [html, ...scripts];
    const declarados = [...new Set(tudo.flatMap(pixelsNaPagina))];
    if (tudo.some((t) => t.includes(pixelEsperado))) itens.push({ tom: "ok", titulo: "Pixel certo na página", detalhe: pixelEsperado });
    else if (declarados.length)
      itens.push({
        tom: "erro",
        titulo: "Esta página usa outro pixel",
        detalhe: `Na página está o ${declarados.join(", ")}, mas você escolheu o ${pixelEsperado}. Os eventos estão indo para o lugar errado: troque o ID na página ou escolha o outro pixel.`,
      });
    else if (tudo.some(carregaPixel))
      itens.push({
        tom: "alerta",
        titulo: "A página carrega um pixel, mas não consegui ler o ID",
        detalhe: `Confira no Gerenciador de Eventos da Meta se o pixel ${pixelEsperado} está recebendo eventos deste site.`,
      });
    else if (tudo.some(temGerenciadorDeTags))
      itens.push({
        tom: "alerta",
        titulo: "O pixel deve estar no Google Tag Manager",
        detalhe: `Não dá para ler o ID por aqui. Confira no Gerenciador de Eventos da Meta se o pixel ${pixelEsperado} está recebendo eventos deste site.`,
      });
    else
      itens.push({
        tom: "alerta",
        titulo: "Não encontrei o pixel nesta página",
        detalhe: `Se a plataforma da página instala o pixel de outro jeito, confira no Gerenciador de Eventos da Meta se o ${pixelEsperado} recebe eventos. Se o pixel ainda não foi instalado, instale antes de ativar a campanha.`,
      });
  }
  return { url, status: itens.some((i) => i.tom === "erro") ? "erro" : itens.some((i) => i.tom === "alerta") ? "aviso" : "ok", itens, em };
}
