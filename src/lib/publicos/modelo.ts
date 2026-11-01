// Públicos — funções puras: definição validada de cada tipo e o direcionamento (targeting) que vai para a
// Meta. A regra de fundo: interesses e públicos personalizados entram como SUGESTÃO ao Advantage+ (padrão,
// costuma dar custo melhor) ou como RESTRIÇÃO (Advantage+ desligado), à escolha da pessoa.
import { z } from "zod";

export const TIPOS_PUBLICO = {
  detalhado: "Interesses",
  funil: "Clientes do funil",
  site: "Visitantes do site",
  semelhante: "Semelhante",
} as const;
export type TipoPublico = keyof typeof TIPOS_PUBLICO;

export const SEGMENTOS = {
  pagantes: "Pagantes (já assinaram ou compraram)",
  teste_sem_pagamento: "Iniciaram teste e ainda não pagaram",
  cadastrados_sem_teste: "Cadastraram e não iniciaram teste nem pagaram",
  todos: "Todos os leads",
} as const;
export type Segmento = keyof typeof SEGMENTOS;

export const GENEROS = { todos: "Todos", mulheres: "Mulheres", homens: "Homens" } as const;

const Item = z.object({ id: z.string().regex(/^\d+$/), nome: z.string().max(200), caminho: z.string().max(300).optional(), tamanho: z.number().optional() });
const Regiao = z.object({ key: z.string().regex(/^\d+$/), nome: z.string().max(120) });

export const DefinicaoDetalhado = z.object({
  paises: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).default(["BR"]),
  regioes: z.array(Regiao).max(27).default([]),
  idade_min: z.coerce.number().int().min(18).max(65).default(18),
  idade_max: z.coerce.number().int().min(18).max(65).default(65),
  genero: z.enum(["todos", "mulheres", "homens"]).default("todos"),
  interesses: z.array(Item).max(30).default([]),
  advantage: z.boolean().default(true),
});
export const DefinicaoFunil = z.object({
  segmento: z.enum(Object.keys(SEGMENTOS) as [Segmento, ...Segmento[]]),
  dias: z.coerce.number().int().min(1).max(730).nullable().default(null),
});
export const DefinicaoSite = z.object({ dias: z.coerce.number().int().min(1).max(180).default(30) });
export const DefinicaoSemelhante = z.object({
  origem_publico_id: z.uuid("Escolha o público de origem."),
  pais: z.string().regex(/^[A-Z]{2}$/).default("BR"),
  percentual: z.coerce.number().int().min(1).max(10).default(1),
});
export type DefinicaoDetalhado = z.infer<typeof DefinicaoDetalhado>;

export const DEFINICOES = { detalhado: DefinicaoDetalhado, funil: DefinicaoFunil, site: DefinicaoSite, semelhante: DefinicaoSemelhante } as const;

export interface Publico {
  id: string;
  nome: string;
  tipo: TipoPublico;
  definicao: Record<string, unknown>;
  meta_audience_id: string | null;
  meta_tamanho?: { min?: number; max?: number } | null;
  situacao: string;
}

/** Abaixo disto a Meta não entrega (público personalizado) ou não cria semelhante (origem). */
export const MINIMO_PERSONALIZADO = 100;

/** O público pode entrar numa campanha? (devolve o motivo quando não) */
export function prontoParaUsar(p: Publico): string | null {
  if (p.tipo === "detalhado") {
    const v = DefinicaoDetalhado.safeParse(p.definicao);
    if (!v.success) return `“${p.nome}”: definição incompleta.`;
    if (v.data.idade_min > v.data.idade_max) return `“${p.nome}”: idade mínima maior que a máxima.`;
    return null;
  }
  if (!p.meta_audience_id) return `“${p.nome}” ainda não foi criado na Meta (abra o público e clique em “Enviar à Meta”).`;
  if (p.situacao === "erro") return `“${p.nome}” está com erro na Meta.`;
  return null;
}

/** Direcionamento de um conjunto: público (ou o “público rápido” Brasil/idade) + exclusões. */
export function targetingDoPublico(p: Publico | null, rapido: { paises: string[]; idade_min: number; idade_max: number; advantage: boolean }, excluir: string[]) {
  const exclusoes = excluir.length ? { excluded_custom_audiences: excluir.map((id) => ({ id })) } : {};
  if (!p) {
    return {
      geo_locations: { countries: rapido.paises },
      age_min: rapido.idade_min,
      age_max: rapido.advantage ? 65 : rapido.idade_max,
      targeting_automation: { advantage_audience: rapido.advantage ? 1 : 0 },
      ...exclusoes,
    };
  }
  if (p.tipo === "detalhado") {
    const d = DefinicaoDetalhado.parse(p.definicao);
    return {
      geo_locations: d.regioes.length ? { regions: d.regioes.map((r) => ({ key: r.key })) } : { countries: d.paises },
      age_min: d.idade_min,
      // Com Advantage+, idade e interesses viram sugestão e a Meta exige o máximo em 65.
      age_max: d.advantage ? 65 : d.idade_max,
      ...(d.genero === "todos" ? {} : { genders: [d.genero === "homens" ? 1 : 2] }),
      ...(d.interesses.length ? { flexible_spec: [{ interests: d.interesses.map((i) => ({ id: i.id, name: i.nome })) }] } : {}),
      targeting_automation: { advantage_audience: d.advantage ? 1 : 0 },
      ...exclusoes,
    };
  }
  // Público personalizado (funil, site, semelhante): mira exatamente nele (remarketing não deve expandir).
  return {
    geo_locations: { countries: ["BR"] },
    age_min: 18,
    age_max: 65,
    custom_audiences: [{ id: p.meta_audience_id }],
    targeting_automation: { advantage_audience: 0 },
    ...exclusoes,
  };
}

/** Objeto do público personalizado na Meta (criação). Funil: lista de clientes; site: regra do pixel. */
export function payloadPublicoPersonalizado(p: Publico, ctx: { pixelId: string | null; origemMetaId?: string | null }) {
  const descricao = "Criado pelo Adverdad";
  if (p.tipo === "funil")
    return { name: p.nome, subtype: "CUSTOM", description: `${descricao}: ${SEGMENTOS[(p.definicao as { segmento: Segmento }).segmento]}`, customer_file_source: "USER_PROVIDED_ONLY" };
  if (p.tipo === "site") {
    const d = DefinicaoSite.parse(p.definicao);
    if (!ctx.pixelId) throw new Error("Escolha o conjunto de dados (pixel) em Configurações → Meta (publicação).");
    return {
      name: p.nome,
      description: `${descricao}: visitantes do site nos últimos ${d.dias} dias`,
      prefill: true,
      rule: {
        inclusions: {
          operator: "or",
          rules: [{ event_sources: [{ id: ctx.pixelId, type: "pixel" }], retention_seconds: d.dias * 86_400, filter: { operator: "and", filters: [{ field: "url", operator: "i_contains", value: "" }] } }],
        },
      },
    };
  }
  if (p.tipo === "semelhante") {
    const d = DefinicaoSemelhante.parse(p.definicao);
    if (!ctx.origemMetaId) throw new Error("O público de origem ainda não foi criado na Meta.");
    return { name: p.nome, subtype: "LOOKALIKE", origin_audience_id: ctx.origemMetaId, lookalike_spec: { country: d.pais, ratio: d.percentual / 100 } };
  }
  throw new Error("Público de interesses não vira público personalizado.");
}

/** Lista de clientes no formato da Meta: hashes SHA-256 já normalizados (e-mail minúsculo; telefone com 55). */
export function lotesListaClientes(membros: Array<{ email_hash: string | null; telefone_hash: string | null }>, tamanho = 10_000) {
  const linhas = membros.map((m) => [m.email_hash ?? "", m.telefone_hash ?? ""]).filter(([e, t]) => e || t);
  const lotes: string[][][] = [];
  for (let i = 0; i < linhas.length; i += tamanho) lotes.push(linhas.slice(i, i + tamanho));
  return { schema: ["EMAIL", "PHONE"], lotes, total: linhas.length };
}

/** Piso que a Meta devolve para públicos pequenos: por privacidade, ela não informa nada abaixo disso. */
export const PISO_TAMANHO_META = 1000;

/** Texto do tamanho lido da Meta (“menos de 1 mil” quando ela devolve só o piso). */
export function textoTamanhoMeta(t: { min?: number | null; max?: number | null } | null | undefined) {
  if (t?.min == null) return null;
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));
  if ((t.max ?? t.min) <= PISO_TAMANHO_META) return "menos de 1 mil";
  return t.max && t.max !== t.min ? `${fmt(t.min)} – ${fmt(t.max)}` : fmt(t.min);
}
