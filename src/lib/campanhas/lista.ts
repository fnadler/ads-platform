import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tom } from "@/components/ui";
import { SITUACAO_CAMPANHA } from "@/app/o/[org]/campanhas/situacao";
import { situacaoPelosAnuncios, veiculacaoPelosAnuncios, type Veiculacao } from "./veiculacao";

// Uma campanha, uma identidade: a montada aqui (campanhas_assistente) e a que a Meta devolve na leitura
// (meta_anuncios) são a mesma quando meta_campaign_id bate. As criadas direto no Gerenciador só existem na Meta.

export type OrigemCampanha = "plataforma" | "gerenciador";

export interface CampanhaUnificada {
  /** Id interno (campanhas_assistente), se foi montada aqui. */
  assistenteId: string | null;
  /** Id da Meta, se já existe lá. */
  metaId: string | null;
  accountId: string | null;
  nome: string;
  origem: OrigemCampanha;
  situacao: { rotulo: string; tom: Tom };
  /** O que a campanha está fazendo na Meta (null enquanto não existe lá). */
  veiculacao: Veiculacao | null;
  criadaEm: string | null;
}

export const linkGerenciador = (accountId: string | null, metaId: string | null) =>
  accountId && metaId
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace("act_", "")}&selected_campaign_ids=${metaId}`
    : null;

export async function listarCampanhas(supabase: SupabaseClient, orgId: string): Promise<CampanhaUnificada[]> {
  const [{ data: assistente }, { data: anuncios }] = await Promise.all([
    supabase.from("campanhas_assistente").select("id, nome, status, account_id, meta_campaign_id, criado_em").eq("organizacao_id", orgId).order("criado_em", { ascending: false }),
    supabase.from("meta_anuncios").select("campaign_id, campaign_name, account_id, status").eq("organizacao_id", orgId).not("campaign_id", "is", null),
  ]);

  const daMeta = new Map<string, { nome: string; accountId: string; status: Array<string | null> }>();
  for (const a of anuncios ?? []) {
    const c = daMeta.get(a.campaign_id!) ?? { nome: a.campaign_name ?? a.campaign_id!, accountId: a.account_id, status: [] as Array<string | null> };
    c.status.push(a.status);
    daMeta.set(a.campaign_id!, c);
  }

  const montadas: CampanhaUnificada[] = (assistente ?? []).map((c) => {
    const meta = c.meta_campaign_id ? daMeta.get(c.meta_campaign_id) : undefined;
    // Depois de ativada, a veiculação real (pausada no Gerenciador, encerrada) vale mais que o status do assistente.
    const situacao = c.status === "ativa" && meta ? situacaoPelosAnuncios(meta.status) : SITUACAO_CAMPANHA[c.status];
    return {
      assistenteId: c.id,
      metaId: c.meta_campaign_id,
      accountId: c.account_id,
      nome: c.nome,
      origem: "plataforma",
      situacao,
      veiculacao: meta ? veiculacaoPelosAnuncios(meta.status) : null,
      criadaEm: c.criado_em,
    };
  });
  const ligadas = new Set(montadas.map((c) => c.metaId).filter(Boolean));
  const externas: CampanhaUnificada[] = [...daMeta]
    .filter(([id]) => !ligadas.has(id))
    .map(([id, c]) => ({
      assistenteId: null,
      metaId: id,
      accountId: c.accountId,
      nome: c.nome,
      origem: "gerenciador",
      situacao: situacaoPelosAnuncios(c.status),
      veiculacao: veiculacaoPelosAnuncios(c.status),
      criadaEm: null,
    }));

  // No ar primeiro; depois em análise, pausadas, rascunhos; encerradas no fim.
  const peso = (c: CampanhaUnificada) =>
    ({ "No ar": 0, Ativa: 0, "Em análise": 1, "Com problemas": 1, "Com erro": 1, "Criando na Meta…": 1, "Ativando…": 1, "Criada (pausada)": 2, Pausada: 2, Rascunho: 3 })[
      c.situacao.rotulo
    ] ?? 4;
  return [...montadas, ...externas].sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A campanha montada aqui que corresponde a um id da Meta (para a ponte Desempenho → Gerenciar). */
export async function campanhaMontada(supabase: SupabaseClient, orgId: string, metaId: string) {
  const { data } = await supabase.from("campanhas_assistente").select("id").eq("organizacao_id", orgId).eq("meta_campaign_id", metaId).maybeSingle();
  return data?.id ?? null;
}
