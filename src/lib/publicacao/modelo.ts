// Modelo "Cadastro no site" do assistente de campanhas — funções puras: validam o rascunho e montam os
// objetos que vão para a Meta. O que é decisão técnica fica fixo aqui (objetivo, destino, otimização,
// atribuição 7d clique/1d visualização, Parâmetros de URL, nomes); a pessoa só decide verba, datas,
// público básico, destino e criativos. Mudou um campo obrigatório da Meta: é aqui que se ajusta.
import { z } from "zod";
import { PARAMETROS_META } from "@/lib/rastreio/regras";

export const EVENTOS = {
  COMPLETE_REGISTRATION: "Concluir inscrição (cadastro)",
  LEAD: "Lead",
  START_TRIAL: "Iniciar teste",
  SUBSCRIBE: "Assinar",
  PURCHASE: "Compra",
} as const;
export type Evento = keyof typeof EVENTOS;

export const CHAMADAS = {
  SIGN_UP: "Cadastre-se",
  LEARN_MORE: "Saiba mais",
  SUBSCRIBE: "Assinar",
  SHOP_NOW: "Comprar agora",
} as const;
export type Chamada = keyof typeof CHAMADAS;

export const LIMITE_CRIATIVOS = 10;

export const Rascunho = z.object({
  verba_diaria: z.coerce.number().positive("Informe a verba diária."),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe o início."),
  fim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  evento: z.enum(Object.keys(EVENTOS) as [Evento, ...Evento[]]).default("COMPLETE_REGISTRATION"),
  paises: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).default(["BR"]),
  idade_min: z.coerce.number().int().min(18).max(65).default(18),
  idade_max: z.coerce.number().int().min(18).max(65).default(65),
  publico_advantage: z.boolean().default(true),
  url_destino: z.url("Informe a página de destino (https://…)."),
});
export type Rascunho = z.infer<typeof Rascunho>;

export interface CriativoRascunho {
  id: string;
  nome: string;
  tipo: "video" | "imagem";
  texto: string;
  titulo: string;
  chamada: string;
}

export interface ConfigPublicacao {
  account_id: string | null;
  page_id: string | null;
  instagram_user_id: string | null;
  pixel_id: string | null;
  teto_verba_diaria: number;
}

export interface Problema {
  campo: string;
  texto: string;
}

/** "2026-11-03T00:00" no fuso dado → "2026-11-03T00:00:00-03:00" (o deslocamento do fuso naquela data). */
export function horarioComFuso(local: string, fuso: string) {
  const [d, h] = local.split("T");
  const utcSuposto = new Date(`${d}T${h}:00Z`);
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "longOffset" }).formatToParts(utcSuposto);
  const gmt = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = gmt === "GMT" ? "+00:00" : gmt.replace("GMT", "");
  return `${d}T${h}:00${offset}`;
}

/** Valor na menor unidade da moeda (a Meta recebe orçamento em centavos para BRL, USD, EUR…). */
const SEM_CENTAVOS = new Set(["JPY", "KRW", "CLP", "COP", "HUF", "ISK", "PYG", "TWD", "VND", "IDR"]);
export const menorUnidade = (valor: number, moeda: string) => Math.round(SEM_CENTAVOS.has(moeda.toUpperCase()) ? valor : valor * 100);

/** O que impede de enviar à Meta (o que a própria Meta recusar aparece depois, em português). */
export function validarRascunho(
  bruto: unknown,
  criativos: CriativoRascunho[],
  config: ConfigPublicacao | null,
  fuso: string,
  agora = new Date(),
): { rascunho: Rascunho | null; problemas: Problema[] } {
  const problemas: Problema[] = [];
  const v = Rascunho.safeParse(bruto);
  if (!v.success) for (const i of v.error.issues) problemas.push({ campo: String(i.path[0] ?? "rascunho"), texto: i.message });
  const r = v.success ? v.data : null;

  if (!config?.account_id || !config.page_id || !config.pixel_id)
    problemas.push({ campo: "configuracao", texto: "Complete a configuração de publicação (conta, Página e conjunto de dados) em Configurações." });
  if (r && config && r.verba_diaria > config.teto_verba_diaria)
    problemas.push({ campo: "verba_diaria", texto: `A verba diária passa do teto da organização (${config.teto_verba_diaria.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).` });
  if (r) {
    const inicio = Date.parse(horarioComFuso(r.inicio, fuso));
    if (inicio < agora.getTime() - 5 * 60_000) problemas.push({ campo: "inicio", texto: "O início precisa ser no futuro." });
    if (r.fim && Date.parse(horarioComFuso(r.fim, fuso)) <= inicio + 24 * 3600_000)
      problemas.push({ campo: "fim", texto: "O fim precisa ser pelo menos 24 horas depois do início." });
    if (r.idade_min > r.idade_max) problemas.push({ campo: "idade_min", texto: "A idade mínima é maior que a máxima." });
    if (!r.url_destino.startsWith("https://")) problemas.push({ campo: "url_destino", texto: "A página de destino precisa começar com https://." });
    if (/[?&]utm_/.test(r.url_destino))
      problemas.push({ campo: "url_destino", texto: "Tire os utm_ da página de destino: o sistema acrescenta os Parâmetros de URL sozinho." });
  }
  if (!criativos.length) problemas.push({ campo: "criativos", texto: "Envie pelo menos um criativo (vídeo ou imagem)." });
  if (criativos.length > LIMITE_CRIATIVOS) problemas.push({ campo: "criativos", texto: `No máximo ${LIMITE_CRIATIVOS} criativos por campanha.` });
  const nomes = new Set<string>();
  for (const c of criativos) {
    if (!c.texto.trim()) problemas.push({ campo: `criativo:${c.id}`, texto: `“${c.nome}”: falta o texto principal.` });
    if (!c.titulo.trim()) problemas.push({ campo: `criativo:${c.id}`, texto: `“${c.nome}”: falta o título.` });
    if (!(c.chamada in CHAMADAS)) problemas.push({ campo: `criativo:${c.id}`, texto: `“${c.nome}”: escolha o botão.` });
    if (nomes.has(c.nome.trim().toLowerCase())) problemas.push({ campo: `criativo:${c.id}`, texto: `Dois criativos com o nome “${c.nome}”: o painel separa os anúncios pelo nome.` });
    nomes.add(c.nome.trim().toLowerCase());
  }
  return { rascunho: r, problemas };
}

// ───────────────────────────── Objetos da Meta ─────────────────────────────

export function payloadCampanha(nome: string) {
  return {
    name: nome,
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    special_ad_categories: [] as string[],
    is_adset_budget_sharing_enabled: false,
    status: "PAUSED",
  };
}

export const nomeConjunto = (nome: string, r: Rascunho) =>
  `${nome} | ${r.paises.join("+")} ${r.idade_min}-${r.idade_max}${r.publico_advantage ? " | Advantage+" : ""}`;

export function payloadConjunto(nome: string, campaignId: string, r: Rascunho, config: ConfigPublicacao, moeda: string, fuso: string) {
  return {
    name: nomeConjunto(nome, r),
    campaign_id: campaignId,
    status: "PAUSED",
    daily_budget: menorUnidade(r.verba_diaria, moeda),
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WEBSITE",
    promoted_object: { pixel_id: config.pixel_id, custom_event_type: r.evento },
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ],
    targeting: {
      geo_locations: { countries: r.paises },
      age_min: r.idade_min,
      // Com o público Advantage+, a idade vira sugestão e a Meta exige o máximo em 65.
      age_max: r.publico_advantage ? 65 : r.idade_max,
      targeting_automation: { advantage_audience: r.publico_advantage ? 1 : 0 },
    },
    start_time: horarioComFuso(r.inicio, fuso),
    ...(r.fim ? { end_time: horarioComFuso(r.fim, fuso) } : {}),
  };
}

export interface MidiaMeta {
  video_id?: string | null;
  thumb_url?: string | null;
  image_hash?: string | null;
}

export function payloadCriativo(c: CriativoRascunho, r: Rascunho, config: ConfigPublicacao, midia: MidiaMeta) {
  const chamada = { type: c.chamada, value: { link: r.url_destino } };
  const identidade = { page_id: config.page_id, ...(config.instagram_user_id ? { instagram_user_id: config.instagram_user_id } : {}) };
  const objectStorySpec =
    c.tipo === "video"
      ? { ...identidade, video_data: { video_id: midia.video_id, image_url: midia.thumb_url, message: c.texto, title: c.titulo, call_to_action: chamada } }
      : { ...identidade, link_data: { image_hash: midia.image_hash, link: r.url_destino, message: c.texto, name: c.titulo, call_to_action: chamada } };
  return {
    name: c.nome,
    object_story_spec: objectStorySpec,
    // Rastreio por construção: os mesmos Parâmetros de URL que a tela Rastreio confere.
    url_tags: PARAMETROS_META,
  };
}

export const payloadAnuncio = (c: CriativoRascunho, adsetId: string, creativeId: string) => ({
  name: c.nome,
  adset_id: adsetId,
  creative: { creative_id: creativeId },
  status: "PAUSED",
});
