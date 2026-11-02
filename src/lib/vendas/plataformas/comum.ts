import { createHash, timingSafeEqual } from "node:crypto";

// Partes comuns dos tradutores: cada plataforma transforma o webhook dela em eventos da ingestão comum.

export interface Requisicao {
  corpo: string;
  cabecalhos: Headers;
  url: URL;
}
export interface Traducao {
  /** Nome do evento na plataforma, para a tela de teste e o diagnóstico. */
  evento: string;
  /** Identifica a entrega (para registrar o que foi ignorado ou recusado). */
  id: string;
  /** Eventos crus: a validação é a mesma de todas as fontes. Vazio: evento que não interessa. */
  eventos: unknown[];
}
export interface Plataforma {
  autenticar(r: Requisicao, segredo: string): boolean;
  traduzir(json: unknown): Traducao;
}

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

/** Comparação em tempo constante, sem revelar o tamanho do segredo. */
export function iguais(a: string, b: string) {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/** ID da Meta (as plataformas devolvem o que veio na URL: só vale se for mesmo um ID). */
export const idMeta = (v: unknown) => {
  const t = txt(v);
  return t && /^\d{6,}$/.test(t) ? t : undefined;
};

/** Data da plataforma (milissegundos, ISO ou "aaaa-mm-dd hh:mm", em horário de Brasília) → ISO. */
export function dataIso(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  const t = txt(v);
  if (!t) return undefined;
  const semFuso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t);
  const d = new Date(semFuso ? `${t.replace(" ", "T")}-03:00` : t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
