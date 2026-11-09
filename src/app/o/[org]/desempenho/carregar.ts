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

export interface ContextoAcoes {
  orgId: string;
  /** Id da campanha na Meta. */
  campanha: string;
  podeAgir: boolean;
  /** Por que não dá para agir pela plataforma (quando não dá). */
  motivo?: string;
  moeda: string;
  fuso: string;
  nomeCampanha: string;
  /** Teto de verba diária da organização (0 = sem teto). */
  teto: number;
  orcamento: { tipo: "total" | "diario"; valor: number; fim: string | null; gasto: number } | null;
  custoPorMil: number | null;
  anuncios: Array<{ id: string; nome: string; impressoes: number; ativo: boolean; daPlataforma: boolean }>;
  /** Para os atalhos das sugestões. */
  rotas: { configuracoes: string; campanhas: string; vendas: string; rastreio: string };
  projetoClarity: string | null;
}

/** O que as ações das sugestões precisam saber: se a campanha é da plataforma, quem pode agir, verba e teto. */
export async function carregarContextoAcoes(
  supabase: SupabaseClient,
  org: { id: string; moeda: string; fuso: string },
  campanhaId: string,
  podeEditar: boolean,
  linhas: Array<{ ad_id: string; ad_name: string | null; impressoes: number; gasto: number; status: string | null }>,
  rotas: ContextoAcoes["rotas"],
): Promise<ContextoAcoes> {
  const [{ data: campanha }, { data: config }, { data: gastos }, { data: clarity }] = await Promise.all([
    supabase.from("campanhas_assistente").select("id, nome, status, rascunho").eq("organizacao_id", org.id).eq("meta_campaign_id", campanhaId).maybeSingle(),
    supabase.from("config_publicacao").select("teto_verba_diaria").eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("meta_campanha_dia").select("gasto").eq("organizacao_id", org.id).eq("campaign_id", campanhaId),
    supabase.from("conexoes").select("config").eq("organizacao_id", org.id).eq("tipo", "clarity").eq("status", "ativa").maybeSingle(),
  ]);
  const { data: daPlataforma } = campanha
    ? await supabase
        .from("anuncios_assistente")
        .select("meta_ad_id")
        .eq("organizacao_id", org.id)
        .in(
          "meta_ad_id",
          linhas.map((l) => l.ad_id),
        )
    : { data: [] };
  const nossos = new Set((daPlataforma ?? []).map((a) => a.meta_ad_id as string));
  const r = (campanha?.rascunho ?? {}) as { tipo_orcamento?: "total" | "diario"; verba_total?: number; verba_diaria?: number; fim?: string };
  const impressoes = linhas.reduce((s, l) => s + Number(l.impressoes), 0);
  const gastoPeriodo = linhas.reduce((s, l) => s + Number(l.gasto), 0);
  const motivo = !campanha
    ? "Esta campanha foi criada fora da plataforma: o ajuste é feito no Gerenciador de Anúncios."
    : !podeEditar
      ? "Só quem é gestor ou dono pode mexer na campanha."
      : campanha.status !== "ativa" && campanha.status !== "criada"
        ? "A campanha ainda não terminou de ser criada na Meta."
        : undefined;
  return {
    orgId: org.id,
    campanha: campanhaId,
    podeAgir: !motivo,
    motivo,
    moeda: org.moeda,
    fuso: org.fuso,
    nomeCampanha: (campanha?.nome as string) ?? "",
    teto: Number(config?.teto_verba_diaria) || 0,
    orcamento: campanha
      ? {
          tipo: r.tipo_orcamento === "total" ? "total" : "diario",
          valor: Number(r.tipo_orcamento === "total" ? r.verba_total : r.verba_diaria) || 0,
          fim: r.fim ?? null,
          gasto: (gastos ?? []).reduce((s, g) => s + Number(g.gasto), 0),
        }
      : null,
    custoPorMil: impressoes ? (gastoPeriodo * 1000) / impressoes : null,
    rotas,
    projetoClarity: ((clarity?.config as { projeto_id?: string } | null)?.projeto_id as string) ?? null,
    anuncios: linhas.map((l) => ({ id: l.ad_id, nome: l.ad_name ?? l.ad_id, impressoes: Number(l.impressoes), ativo: l.status === "ACTIVE", daPlataforma: nossos.has(l.ad_id) })),
  };
}
