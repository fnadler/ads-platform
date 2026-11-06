import "server-only";
import { executarColetaClarity } from "@/lib/clarity/coleta";
import { marcarErroConexao } from "@/lib/conexoes/segredos";
import { ErroClarity } from "@/lib/integracoes/clarity";
import { ErroLimiteMeta, ErroMeta } from "@/lib/integracoes/meta";
import { executarSincronizacaoMeta } from "@/lib/meta/sincronizacao";
import { executarPublicacao } from "@/lib/publicacao/job";
import { executarPublico } from "@/lib/publicos/job";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { executarHistoricoStripe } from "@/lib/vendas/historicoStripe";
import type { ResultadoJob, Sincronizacao } from "./tipos";

// Worker da fila "jobs" (pgmq). Lê uma mensagem por vez com tempo de visibilidade maior que o prazo da
// função: se a função morrer, a mensagem reaparece sozinha. Cada mensagem aponta para uma linha de
// sincronizacoes, que guarda status e cursor. Fim de cada job:
//   pronto ............ status ok, apaga a mensagem
//   continuar ......... status na_fila, reenfileira já (próxima fatia)
//   limite da Meta .... status na_fila, reenfileira com atraso
//   erro .............. até 3 tentativas com espera crescente; depois status erro
// Uma organização não segura as outras: cada job é uma conta/conexão, e a fila intercala.

const MAX_TENTATIVAS = 3;
const VISIBILIDADE_S = 360;

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function processarFila(prazoMs: number) {
  const admin = criarClienteAdmin();
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < prazoMs;
  const relatorio: Array<{ id: string; resultado: string }> = [];

  while (temTempo()) {
    const { data: msgs, error } = await admin.rpc("fila_ler", { p_qtd: 1, p_visibilidade: VISIBILIDADE_S });
    if (error) throw new Error(`Fila: ${error.message}`);
    const msg = (msgs as Array<{ msg_id: number; mensagem: { sincronizacao_id?: string } }> | null)?.[0];
    if (!msg) break;

    const id = msg.mensagem.sincronizacao_id;
    const { data: s } = id ? await admin.from("sincronizacoes").select("*").eq("id", id).maybeSingle<Sincronizacao>() : { data: null };
    if (!s || s.status === "ok" || s.status === "erro") {
      await admin.rpc("fila_apagar", { p_msg_id: msg.msg_id });
      continue;
    }

    await admin
      .from("sincronizacoes")
      .update({ status: "rodando", tentativas: s.tentativas + 1, iniciado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), erro: null })
      .eq("id", s.id);

    let resultado: string;
    try {
      const executar = {
        meta: executarSincronizacaoMeta,
        stripe_historico: executarHistoricoStripe,
        meta_publicacao: executarPublicacao,
        meta_publico: executarPublico,
        clarity: executarColetaClarity,
      }[s.tipo];
      const r: ResultadoJob = await executar(admin, s, temTempo);
      if (r.status === "pronto") {
        await admin.from("sincronizacoes").update({ status: "ok", linhas: r.linhas, tentativas: 0, terminado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", s.id);
        if (s.tipo === "meta") await marcarConexaoMetaOk(s.organizacao_id);
        if (s.tipo === "clarity") await marcarConexaoOk(s.alvo);
        resultado = "ok";
      } else {
        await admin.from("sincronizacoes").update({ status: "na_fila", cursor: r.cursor, linhas: r.linhas, tentativas: 0, atualizado_em: new Date().toISOString() }).eq("id", s.id);
        await admin.rpc("fila_reenviar", { p_sincronizacao: s.id, p_atraso: r.atrasoSegundos ?? 0 });
        resultado = "continua";
      }
    } catch (e) {
      if (e instanceof ErroLimiteMeta) {
        await admin.from("sincronizacoes").update({ status: "na_fila", erro: e.message, tentativas: 0, atualizado_em: new Date().toISOString() }).eq("id", s.id);
        await admin.rpc("fila_reenviar", { p_sincronizacao: s.id, p_atraso: e.esperarSegundos });
        resultado = "limite";
      } else if (
        s.tentativas + 1 < MAX_TENTATIVAS &&
        !(e instanceof ErroMeta && [190, 200, 10].includes(e.codigo ?? 0)) &&
        // Publicação: erro da Meta (campo recusado, política) não melhora repetindo — vai direto para a tela.
        !((s.tipo === "meta_publicacao" || s.tipo === "meta_publico") && e instanceof ErroMeta) &&
        // Clarity: token, parâmetro ou cota do dia — repetir só gasta as 10 consultas diárias.
        !(e instanceof ErroClarity && e.definitivo)
      ) {
        await admin.from("sincronizacoes").update({ status: "na_fila", erro: mensagem(e), atualizado_em: new Date().toISOString() }).eq("id", s.id);
        await admin.rpc("fila_reenviar", { p_sincronizacao: s.id, p_atraso: 120 * (s.tentativas + 1) });
        resultado = "nova tentativa";
      } else {
        await admin.from("sincronizacoes").update({ status: "erro", erro: mensagem(e), terminado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", s.id);
        if (s.tipo === "meta" && e instanceof ErroMeta) await marcarConexaoMetaErro(s.organizacao_id, mensagem(e));
        if (s.tipo === "clarity" && e instanceof ErroClarity && e.deCredencial) await marcarErroConexao(admin, s.alvo, mensagem(e));
        resultado = "erro";
      }
      console.error("[worker]", s.organizacao_id, s.tipo, s.alvo, mensagem(e));
    }
    await admin.rpc("fila_apagar", { p_msg_id: msg.msg_id });
    relatorio.push({ id: s.id, resultado });
  }
  return relatorio;

  async function marcarConexaoMetaOk(org: string) {
    const { data } = await admin.from("conexoes").select("id, status").eq("organizacao_id", org).eq("tipo", "meta").maybeSingle();
    if (data?.status === "erro") await marcarErroConexao(admin, data.id, null);
  }
  async function marcarConexaoOk(conexaoId: string) {
    const { data } = await admin.from("conexoes").select("status").eq("id", conexaoId).maybeSingle();
    if (data?.status === "erro") await marcarErroConexao(admin, conexaoId, null);
  }
  async function marcarConexaoMetaErro(org: string, erro: string) {
    const { data } = await admin.from("conexoes").select("id").eq("organizacao_id", org).eq("tipo", "meta").maybeSingle();
    if (data) await marcarErroConexao(admin, data.id, erro);
  }
}
