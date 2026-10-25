// Regras do rastreio, puras (servidor e tela). A atribuição usa os IDs que a Meta preenche nos
// "Parâmetros de URL" do anúncio; os nomes (utm_campaign, utm_content) vão junto só para leitura humana.

/** "Parâmetros de URL" a colar em cada anúncio da Meta. */
export const PARAMETROS_META =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_campaign_id={{campaign.id}}&utm_adset_id={{adset.id}}&utm_ad_id={{ad.id}}";

export type StatusRastreio = "ok" | "alerta" | "erro";
export interface Problema {
  gravidade: "erro" | "alerta";
  texto: string;
}

/** Valor de um parâmetro em "a=1&b=2" (sem decodificar as macros {{…}}). */
export function parametro(tags: string, nome: string) {
  const par = tags
    .replace(/^\?/, "")
    .split("&")
    .map((p) => p.split("="))
    .find(([k]) => k?.trim().toLowerCase() === nome);
  return par ? (par[1] ?? "").trim() : null;
}

const ehMacroOuId = (v: string | null, macro: string) => !!v && (v.replace(/\s/g, "").includes(`{{${macro}}}`) || /^\d{6,}$/.test(v));

/** Avalia os "Parâmetros de URL" de um anúncio. Erro: o lead não seria atribuído ao anúncio. */
export function avaliarParametros(urlTags: string | null): { status: StatusRastreio; problemas: Problema[] } {
  if (!urlTags?.trim())
    return { status: "erro", problemas: [{ gravidade: "erro", texto: "Anúncio sem “Parâmetros de URL”: nenhum lead dele chega com o anúncio de origem." }] };
  if (/%7B%7B/i.test(urlTags))
    return { status: "erro", problemas: [{ gravidade: "erro", texto: "As macros estão codificadas (%7B%7B…). Cole os parâmetros como texto puro: {{ad.id}}." }] };
  const p = (n: string) => parametro(urlTags, n);
  const problemas: Problema[] = [];
  if (!ehMacroOuId(p("utm_ad_id"), "ad.id")) problemas.push({ gravidade: "erro", texto: "Falta o ID do anúncio: utm_ad_id={{ad.id}}. Sem ele a venda não chega ao criativo." });
  if (!ehMacroOuId(p("utm_campaign_id"), "campaign.id")) problemas.push({ gravidade: "erro", texto: "Falta o ID da campanha: utm_campaign_id={{campaign.id}}." });
  if (!ehMacroOuId(p("utm_adset_id"), "adset.id")) problemas.push({ gravidade: "alerta", texto: "Falta o ID do conjunto: utm_adset_id={{adset.id}}." });
  if (!p("utm_source")) problemas.push({ gravidade: "alerta", texto: "Falta utm_source=meta (a origem aparece como desconhecida nos relatórios)." });
  return { status: problemas.some((x) => x.gravidade === "erro") ? "erro" : problemas.length ? "alerta" : "ok", problemas };
}

/** Avalia o destino do anúncio (sem destino = anúncio de mensagem/formulário, que não usa UTM). */
export function avaliarDestino(destinos: string[]): Problema | null {
  if (!destinos.length) return { gravidade: "alerta", texto: "Sem link de destino (anúncio de mensagem ou formulário instantâneo): o rastreio por UTM não se aplica." };
  return null;
}

export interface Macros {
  "campaign.id": string;
  "adset.id": string;
  "ad.id": string;
  "campaign.name": string;
  "adset.name": string;
  "ad.name": string;
}

/** Link de teste: o destino real com os "Parâmetros de URL" do anúncio, macros trocadas pelos valores. */
export function montarUrlTeste(destino: string, urlTags: string | null, macros: Macros) {
  const tags = urlTags?.trim() || PARAMETROS_META;
  const url = new URL(destino);
  const valores: Record<string, string> = { ...macros, site_source_name: "fb", placement: "Facebook_Mobile_Feed" };
  for (const par of tags.replace(/^\?/, "").split("&")) {
    const [k, v = ""] = par.split("=");
    if (!k?.trim()) continue;
    url.searchParams.set(k.trim(), decodeURIComponent(v).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, m: string) => valores[m] ?? "").trim());
  }
  url.searchParams.set("fbclid", `teste_rastreio_${Date.now()}`);
  return url.toString();
}

export interface Esperado {
  utm_source?: string;
  utm_campaign_id: string;
  utm_adset_id?: string;
  utm_ad_id: string;
}

export interface LeadRecebido {
  utm_source: string | null;
  utm_campaign_id: string | null;
  utm_adset_id: string | null;
  utm_ad_id: string | null;
  ftp_utm_ad_id: string | null;
  ad_id: string | null;
  atribuicao: string;
}

export interface ResultadoCampo {
  campo: string;
  esperado: string;
  recebido: string | null;
  ok: boolean;
  alerta?: boolean;
  correcao?: string;
}

const CORRECAO_CAPTURA =
  "O valor não chegou ao sistema: confira se a página guarda este parâmetro da URL (inclusive depois de navegar entre páginas e no cadastro) e se o envio ao webhook o inclui em `atribuicao`.";

/** Confere o lead de teste contra o que o link levava. Primeiro toque diferente é só alerta (cookie antigo). */
export function conferirLead(lead: LeadRecebido, esperado: Esperado): ResultadoCampo[] {
  const campos: Array<[keyof Esperado, string | undefined]> = [
    ["utm_source", esperado.utm_source],
    ["utm_campaign_id", esperado.utm_campaign_id],
    ["utm_adset_id", esperado.utm_adset_id],
    ["utm_ad_id", esperado.utm_ad_id],
  ];
  const r: ResultadoCampo[] = campos
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([campo, v]) => {
      const recebido = lead[campo]?.trim() || null;
      const ok = recebido !== null && recebido.toLowerCase() === v!.toLowerCase();
      return { campo, esperado: v!, recebido, ok, correcao: ok ? undefined : CORRECAO_CAPTURA };
    });
  r.push({
    campo: "anúncio atribuído",
    esperado: esperado.utm_ad_id,
    recebido: lead.ad_id,
    ok: lead.ad_id === esperado.utm_ad_id,
    alerta: lead.ad_id !== esperado.utm_ad_id && lead.atribuicao === "primeiro_toque",
    correcao:
      lead.ad_id === esperado.utm_ad_id
        ? undefined
        : lead.atribuicao === "primeiro_toque"
          ? "O sistema atribuiu pelo primeiro toque porque o último não trouxe o ID do anúncio."
          : "Sem o ID do anúncio no lead, a venda não chega ao criativo.",
  });
  if (lead.ftp_utm_ad_id && lead.ftp_utm_ad_id !== esperado.utm_ad_id)
    r.push({
      campo: "primeiro toque",
      esperado: esperado.utm_ad_id,
      recebido: lead.ftp_utm_ad_id,
      ok: false,
      alerta: true,
      correcao: "O primeiro toque é de outro anúncio: provavelmente um cookie anterior neste navegador. Repita numa janela anônima para confirmar.",
    });
  return r;
}

export const statusDoResultado = (r: ResultadoCampo[]): "ok" | "problema" => (r.some((c) => !c.ok && !c.alerta) ? "problema" : "ok");
