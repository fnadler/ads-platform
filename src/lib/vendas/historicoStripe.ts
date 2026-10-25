import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSegredo, type SegredoStripe } from "@/lib/conexoes/segredos";
import { clienteStripe } from "@/lib/integracoes/stripe";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";
import { processarEvento } from "./ingestao";
import { testeDaAssinatura, vendaDaFatura } from "./stripe";

// Importação do histórico do Stripe (job da fila): faturas pagas e assinaturas com teste grátis dos
// últimos 365 dias, página a página (100), com o cursor do Stripe gravado entre as fatias.
const DIAS = 365;

interface Cursor {
  fase?: "faturas" | "assinaturas";
  depois?: string;
}

export async function executarHistoricoStripe(admin: SupabaseClient, s: Sincronizacao, temTempo: () => boolean): Promise<ResultadoJob> {
  const { data: conexao } = await admin.from("conexoes").select("id, config").eq("id", s.alvo).eq("organizacao_id", s.organizacao_id).maybeSingle();
  if (!conexao) throw new Error("Conexão do Stripe não encontrada.");
  const segredo = await lerSegredo<SegredoStripe>(admin, s.organizacao_id, conexao.id);
  if (!segredo) throw new Error("Credencial do Stripe ausente.");
  const stripe = clienteStripe(segredo.chave);
  const campo = (conexao.config as { campo_lead?: string })?.campo_lead || "user_id";
  const ctx = { admin, organizacaoId: s.organizacao_id, conexaoId: conexao.id, origem: "stripe" as const };
  const desde = Math.floor(Date.now() / 1000) - DIAS * 86_400;

  let { fase = "faturas", depois } = s.cursor as Cursor;
  let linhas = s.linhas;
  while (temTempo()) {
    if (fase === "faturas") {
      const pagina = await stripe.invoices.list({ status: "paid", created: { gte: desde }, limit: 100, ...(depois ? { starting_after: depois } : {}) });
      for (const f of pagina.data) {
        const e = await vendaDaFatura(stripe, f, campo);
        if (e) {
          await processarEvento(ctx, e);
          linhas++;
        }
      }
      depois = pagina.data.at(-1)?.id;
      if (!pagina.has_more) {
        fase = "assinaturas";
        depois = undefined;
      }
    } else {
      const pagina = await stripe.subscriptions.list({ status: "all", created: { gte: desde }, limit: 100, ...(depois ? { starting_after: depois } : {}) });
      for (const a of pagina.data) {
        const e = testeDaAssinatura(a, campo);
        if (e) {
          await processarEvento(ctx, e);
          linhas++;
        }
      }
      depois = pagina.data.at(-1)?.id;
      if (!pagina.has_more) return { status: "pronto", linhas };
    }
    await admin.from("sincronizacoes").update({ cursor: { fase, depois }, linhas, atualizado_em: new Date().toISOString() }).eq("id", s.id);
  }
  return { status: "continuar", cursor: { fase, depois }, linhas };
}
