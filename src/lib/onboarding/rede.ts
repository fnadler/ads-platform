import { lookup } from "node:dns/promises";
import { ipPrivado, scriptsDaPagina, validarUrlPagina } from "./pagina";

// Abre a página e os scripts dela sem seguir para endereços internos: cada salto é conferido antes de abrir.

const LIMITE_PAGINA = 2_000_000;
const LIMITE_SCRIPT = 3_000_000;

async function baixar(inicial: URL, limite: number, tempo: number) {
  let url = inicial;
  for (let saltos = 0; saltos < 4; saltos++) {
    const enderecos = await lookup(url.hostname, { all: true });
    if (enderecos.some((e) => ipPrivado(e.address))) throw new Error("Esse endereço não é público.");
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(tempo), headers: { "User-Agent": "Mozilla/5.0 (verificacao-adverdad)" } });
    const destino = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!destino) {
      // Só o começo interessa, e um arquivo enorme não pode travar o servidor.
      const leitor = r.body?.getReader();
      let texto = "";
      const decodificador = new TextDecoder();
      while (leitor && texto.length < limite) {
        const { done, value } = await leitor.read();
        if (done) break;
        texto += decodificador.decode(value, { stream: true });
      }
      await leitor?.cancel().catch(() => {});
      return { status: r.status, texto };
    }
    const proxima = validarUrlPagina(new URL(destino, url).toString());
    if ("erro" in proxima) throw new Error(proxima.erro);
    url = proxima.url;
  }
  throw new Error("A página redireciona demais.");
}

export async function abrirPagina(url: URL) {
  const { status, texto } = await baixar(url, LIMITE_PAGINA, 10_000);
  return { status, html: texto };
}

/** Lê os scripts da página. Um script que falha não atrapalha a conferência: só deixa de ser lido. */
export async function lerScripts(html: string, base: string) {
  const lidos = await Promise.all(
    scriptsDaPagina(html, base).map((u) =>
      baixar(u, LIMITE_SCRIPT, 6_000)
        .then((r) => (r.status < 400 ? r.texto : ""))
        .catch(() => ""),
    ),
  );
  return lidos.filter(Boolean);
}
