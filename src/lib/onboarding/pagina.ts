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

/** Monta o resultado da conferência. Pixel invisível no HTML é só aviso: pode estar no gerenciador de tags. */
export function analisarPagina(entrada: { url: string; status: number; html: string; pixelEsperado: string | null; exigeScript: boolean; em: string }): ResultadoPagina {
  const { url, status, html, pixelEsperado, exigeScript, em } = entrada;
  const itens: ResultadoPagina["itens"] = [];
  if (status < 200 || status >= 400) {
    itens.push({ tom: "erro", titulo: "A página não abriu", detalhe: `Ela respondeu com o código ${status}. Confira o endereço e se a página está publicada.` });
    return { url, status: "erro", itens, em };
  }
  itens.push({ tom: "ok", titulo: "A página abre", detalhe: url });
  if (exigeScript)
    itens.push(
      temScriptCheckout(html)
        ? { tom: "ok", titulo: "Linha de rastreio instalada", detalhe: "Os parâmetros do anúncio chegam ao link de compra." }
        : {
            tom: "erro",
            titulo: "A linha de rastreio não está nesta página",
            detalhe: "Sem ela, a venda chega sem o anúncio de origem. Cole a linha e, se usar plugin de cache, limpe o cache do site.",
          },
    );
  const pixels = pixelsNaPagina(html);
  if (pixelEsperado) {
    if (pixels.includes(pixelEsperado)) itens.push({ tom: "ok", titulo: "Pixel certo na página", detalhe: pixelEsperado });
    else if (pixels.length)
      itens.push({
        tom: "erro",
        titulo: "Esta página usa outro pixel",
        detalhe: `Na página está o ${pixels.join(", ")}, mas você escolheu o ${pixelEsperado}. Os eventos estão indo para o lugar errado: troque o ID na página ou escolha o outro pixel.`,
      });
    else
      itens.push({
        tom: "alerta",
        titulo: "Não encontrei o pixel no código da página",
        detalhe: temGerenciadorDeTags(html)
          ? "A página usa o Google Tag Manager, então ele pode aparecer só no navegador. Confira no Gerenciador de Eventos da Meta."
          : "Se ele for carregado por um gerenciador de tags, isso é normal. Confira no Gerenciador de Eventos da Meta.",
      });
  }
  return { url, status: itens.some((i) => i.tom === "erro") ? "erro" : itens.some((i) => i.tom === "alerta") ? "aviso" : "ok", itens, em };
}
