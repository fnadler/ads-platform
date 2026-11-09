import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PecaAnuncio } from "@/components/VisualizarAnuncio";
import { experienciaDaCampanha, type ColetaBruta, type ExperienciaCampanha } from "@/lib/clarity/campanha";
import { CHAMADAS, type Chamada } from "@/lib/publicacao/modelo";
import { BUCKET_UPLOADS } from "@/lib/publicacao/job";

// Dados que só uma aba do detalhe usa, carregados só quando ela está aberta (com o cliente da sessão: RLS de
// membro, inclusive no Storage).

const rotuloChamada = (c: string | null | undefined) => (c ? (CHAMADAS[c as Chamada] ?? c.replace(/_/g, " ").toLowerCase()) : null);

/** A peça de cada anúncio: o arquivo original do assistente (vídeo ou imagem) e os textos. */
export async function carregarPecas(supabase: SupabaseClient, orgId: string, adIds: string[], miniaturas: Map<string, string | null>): Promise<Map<string, PecaAnuncio>> {
  const pecas = new Map<string, PecaAnuncio>();
  if (!adIds.length) return pecas;
  const [{ data: meta }, { data: doAssistente }] = await Promise.all([
    supabase.from("meta_anuncios").select("ad_id, nome, titulo, texto, chamada").eq("organizacao_id", orgId).in("ad_id", adIds),
    supabase
      .from("anuncios_assistente")
      .select("meta_ad_id, criativos_assistente(nome, tipo, arquivo_path, titulo, texto, chamada)")
      .eq("organizacao_id", orgId)
      .in("meta_ad_id", adIds),
  ]);
  type Criativo = { nome: string; tipo: "video" | "imagem"; arquivo_path: string; titulo: string; texto: string; chamada: string };
  const criativos = new Map<string, Criativo>();
  for (const a of doAssistente ?? []) {
    const c = (Array.isArray(a.criativos_assistente) ? a.criativos_assistente[0] : a.criativos_assistente) as Criativo | null;
    if (a.meta_ad_id && c) criativos.set(a.meta_ad_id, c);
  }
  const caminhos = [...new Set([...criativos.values()].map((c) => c.arquivo_path))];
  const urls = new Map<string, string>();
  if (caminhos.length) {
    const { data: assinadas } = await supabase.storage.from(BUCKET_UPLOADS).createSignedUrls(caminhos, 3600);
    for (const s of assinadas ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const daMeta = new Map((meta ?? []).map((m) => [m.ad_id as string, m]));
  for (const id of adIds) {
    const m = daMeta.get(id);
    const c = criativos.get(id);
    pecas.set(id, {
      nome: (m?.nome as string) ?? c?.nome ?? id,
      tipo: c?.tipo ?? "imagem",
      original: c ? (urls.get(c.arquivo_path) ?? null) : null,
      miniatura: miniaturas.get(id) ?? null,
      titulo: (m?.titulo as string) || c?.titulo || null,
      texto: (m?.texto as string) || c?.texto || null,
      chamada: rotuloChamada((m?.chamada as string) || c?.chamada),
    });
  }
  return pecas;
}

export interface ExperienciaPagina extends ExperienciaCampanha {
  projetoClarity: string | null;
}

/** Clarity só das visitas da campanha, nos dias coletados do período (recorte página × dispositivo). */
export async function carregarExperiencia(supabase: SupabaseClient, orgId: string, campanhaId: string, de: string): Promise<ExperienciaPagina> {
  const [{ data: coletas }, { data: conexao }] = await Promise.all([
    supabase.from("clarity_coletas").select("dia, resposta").eq("organizacao_id", orgId).eq("dimensoes", "{URL,Device}").not("dia", "is", null).gte("dia", de).order("dia"),
    supabase.from("conexoes").select("config").eq("organizacao_id", orgId).eq("tipo", "clarity").maybeSingle(),
  ]);
  return {
    ...experienciaDaCampanha((coletas ?? []) as ColetaBruta[], campanhaId),
    projetoClarity: ((conexao?.config as { projeto_id?: string } | null)?.projeto_id as string) ?? null,
  };
}
