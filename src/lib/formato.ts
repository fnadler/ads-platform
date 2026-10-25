// Formatação pt-BR para a tela. Vazio ("—") quando não há valor (ex.: divisão por zero).
const vazio = "—";
export const moeda = (v: number | null | undefined, moedaIso = "BRL") =>
  v === null || v === undefined || !Number.isFinite(v) ? vazio : v.toLocaleString("pt-BR", { style: "currency", currency: moedaIso });
export const inteiro = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? vazio : Math.round(v).toLocaleString("pt-BR"));
export const decimal = (v: number | null | undefined, casas = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? vazio : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? vazio : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
export const razao = (a: number, b: number) => (b ? a / b : null);
export const dataHora = (iso: string | null | undefined, fuso = "America/Sao_Paulo") =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" }) : vazio;
export const data = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR") : vazio);
