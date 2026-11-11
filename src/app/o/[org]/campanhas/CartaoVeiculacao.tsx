import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta } from "@/components/ui";
import { pausarCampanha, reativarCampanha } from "@/lib/campanhas/acoes";
import type { Veiculacao } from "@/lib/campanhas/veiculacao";
import { dataHora } from "@/lib/formato";

// Pausar e reativar a campanha inteira, com o histórico de quem fez e quando. Serve às duas origens: a
// montada aqui (depois da primeira ativação) e a criada no Gerenciador.

const EXPLICACAO: Record<Veiculacao, string> = {
  ligada: "A campanha está ligada. Pausar para o gasto em alguns minutos; conjuntos e anúncios ficam como estão, e dá para reativar depois.",
  pausada: "A campanha está pausada e não gasta. Reativar volta a veicular os conjuntos e anúncios que estavam no ar antes da pausa.",
  parada: "A campanha está ligada, mas todos os conjuntos ou anúncios foram pausados um a um. Para voltar a veicular, reative os anúncios no Gerenciador de Anúncios.",
  encerrada: "A campanha terminou ou foi arquivada. Não há o que pausar ou reativar.",
};

interface Operacao {
  criado_em: string;
  usuario_id: string | null;
  parametros: { status?: string } | null;
  status_http: number | null;
  resposta: { error?: { message?: string } } | null;
}

async function carregarHistorico(supabase: SupabaseClient, orgId: string, metaCampaignId: string) {
  const [{ data: operacoes }, { data: membros }] = await Promise.all([
    supabase
      .from("operacoes_meta")
      .select("criado_em, usuario_id, parametros, status_http, resposta")
      .eq("organizacao_id", orgId)
      .eq("meta_campaign_id", metaCampaignId)
      .eq("caminho", metaCampaignId)
      .eq("validacao", false)
      .order("criado_em", { ascending: false })
      .limit(10),
    supabase.rpc("membros_da_organizacao", { p_org: orgId }),
  ]);
  const email = new Map(((membros as Array<{ usuario_id: string; email: string }>) ?? []).map((m) => [m.usuario_id, m.email]));
  return ((operacoes as Operacao[]) ?? [])
    .filter((o) => o.parametros?.status === "ACTIVE" || o.parametros?.status === "PAUSED")
    .map((o) => ({
      quando: o.criado_em,
      acao: o.parametros?.status === "PAUSED" ? "Pausou" : "Ativou",
      quem: (o.usuario_id && email.get(o.usuario_id)) || "Sistema",
      ok: !!o.status_http && o.status_http < 300 && !o.resposta?.error,
      erro: o.resposta?.error?.message ?? null,
    }));
}

export async function CartaoVeiculacao({
  supabase,
  orgId,
  fuso,
  metaCampaignId,
  veiculacao,
  publicacaoAtiva,
  rotaConfiguracoes,
}: {
  supabase: SupabaseClient;
  orgId: string;
  fuso: string;
  metaCampaignId: string;
  veiculacao: Veiculacao;
  /** Conexão de publicação (ads_management) ligada: sem ela, não dá para escrever na Meta. */
  publicacaoAtiva: boolean;
  rotaConfiguracoes: string;
}) {
  const historico = await carregarHistorico(supabase, orgId, metaCampaignId);
  const campos = (
    <>
      <input type="hidden" name="organizacao_id" value={orgId} />
      <input type="hidden" name="campanha" value={metaCampaignId} />
    </>
  );

  return (
    <Cartao titulo="Veiculação" descricao={EXPLICACAO[veiculacao]}>
      <div className="flex flex-col gap-4 text-sm">
        {!publicacaoAtiva && (veiculacao === "ligada" || veiculacao === "pausada") ? (
          <Aviso tom="alerta">
            Para pausar ou reativar por aqui, conecte a <strong>Meta (publicação)</strong>, com permissão de edição na conta, em{" "}
            <Link href={rotaConfiguracoes} className="underline">
              Configurações
            </Link>
            .
          </Aviso>
        ) : veiculacao === "ligada" ? (
          <Formulario
            acao={pausarCampanha}
            rotulo="Pausar campanha"
            variante="perigo"
            confirmar="Pausar a campanha inteira? Ela para de gastar em alguns minutos."
            className="flex flex-col gap-3"
          >
            {campos}
          </Formulario>
        ) : veiculacao === "pausada" ? (
          <Formulario acao={reativarCampanha} rotulo="Reativar campanha" variante="peso" className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
            {campos}
            <p>Reativar volta a gastar a verba da campanha a partir de agora.</p>
            <Campo rotulo="Digite ATIVAR para confirmar" name="confirmacao" autoComplete="off" required />
          </Formulario>
        ) : null}

        {historico.length > 0 && (
          <div>
            <div className="sobrancelha mb-1.5">Histórico</div>
            <ul className="flex flex-col gap-1.5">
              {historico.map((h, i) => (
                <li key={`${h.quando}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Etiqueta tom={h.ok ? (h.acao === "Pausou" ? "info" : "ok") : "erro"}>{h.ok ? h.acao : `${h.acao} (falhou)`}</Etiqueta>
                  <span className="text-ink-2">
                    {dataHora(h.quando, fuso)} · {h.quem}
                  </span>
                  {!h.ok && h.erro && <span className="text-xs text-err">{h.erro}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-ink-3">Depois de pausar ou reativar, a Meta é relida em alguns minutos para confirmar a situação de cada anúncio.</p>
      </div>
    </Cartao>
  );
}
