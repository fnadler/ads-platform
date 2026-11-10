import "server-only";

// Google PageSpeed Insights API v5: roda o Lighthouse num celular simulado e devolve, quando o site tem
// tráfego suficiente, os dados de campo do Chrome (CrUX). Grátis, com chave (PAGESPEED_API_KEY): 25 mil
// consultas por dia. Cada teste leva de 15 a 60 s.
// https://developers.google.com/speed/docs/insights/v5/get-started

const URL_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export class ErroPageSpeed extends Error {
  constructor(
    mensagem: string,
    readonly status?: number,
  ) {
    super(mensagem);
  }
  /** Repetir não adianta (chave, endereço inválido, página que não abre para o Google). */
  get definitivo() {
    return this.status !== undefined && this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export const pageSpeedDisponivel = () => !!process.env.PAGESPEED_API_KEY;

export async function buscarPageSpeed(url: string, estrategia: "mobile" | "desktop" = "mobile"): Promise<Record<string, unknown>> {
  const chave = process.env.PAGESPEED_API_KEY;
  if (!chave) throw new ErroPageSpeed("Falta a chave do PageSpeed (PAGESPEED_API_KEY).", 400);
  const params = new URLSearchParams({ url, strategy: estrategia, category: "performance", locale: "pt-BR", key: chave });
  let resposta: Response;
  try {
    resposta = await fetch(`${URL_API}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
  } catch {
    throw new ErroPageSpeed("Não foi possível falar com o PageSpeed (rede ou demora). Tente de novo.");
  }
  const json = (await resposta.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (resposta.ok && json) return json as Record<string, unknown>;
  const detalhe = json?.error?.message?.slice(0, 240) ?? "";
  if (resposta.status === 400 && /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|NOT_HTML/i.test(detalhe))
    throw new ErroPageSpeed(`O Google não conseguiu abrir a página para testar: ${detalhe}`, 400);
  if (resposta.status === 429) throw new ErroPageSpeed("O PageSpeed pediu para esperar (limite de consultas). Tentamos de novo em seguida.", 429);
  if (resposta.status === 400 || resposta.status === 403) throw new ErroPageSpeed(`O PageSpeed recusou a consulta${detalhe ? `: ${detalhe}` : "."}`, resposta.status);
  throw new ErroPageSpeed(`Erro do PageSpeed (${resposta.status})${detalhe ? `: ${detalhe}` : "."}`, resposta.status);
}
