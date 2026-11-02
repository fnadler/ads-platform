import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Evento, payloadSeguro, processarEvento } from "../ingestao";
import type { Plataforma } from "./comum";
import { hotmart } from "./hotmart";
import { kiwify } from "./kiwify";
import type { TipoPlataforma } from "./catalogo";

export const RECEPTORES: Record<TipoPlataforma, Plataforma> = { hotmart, kiwify };

interface Contexto {
  admin: SupabaseClient;
  organizacaoId: string;
  conexaoId: string;
  origem: TipoPlataforma;
}

// O horário é atualizado: repetir o teste na plataforma precisa aparecer como evento novo na tela.
async function registrar(ctx: Contexto, chave: string, tipo: string, payload: object, erro: string | null) {
  const { error } = await ctx.admin
    .from("eventos_recebidos")
    .upsert(
      {
        organizacao_id: ctx.organizacaoId,
        conexao_id: ctx.conexaoId,
        origem: ctx.origem,
        chave_idempotencia: chave,
        tipo,
        payload,
        recebido_em: new Date().toISOString(),
        processado_em: erro ? null : new Date().toISOString(),
        erro,
      },
      { onConflict: "organizacao_id,origem,chave_idempotencia" },
    );
  if (error) throw new Error(error.message);
}

/**
 * Recebe um webhook já autenticado. No modo de teste nada entra nos números: fica só o registro do que foi
 * entendido, para conferir na tela (os botões de teste das plataformas mandam compras fictícias).
 * Evento fora do formato vira erro visível, sem novas tentativas: repetir o mesmo corpo não resolveria.
 * Falha ao gravar propaga, para a plataforma tentar de novo.
 */
export async function receberEvento(ctx: Contexto, plataforma: Plataforma, modoTeste: boolean, json: unknown) {
  const t = plataforma.traduzir(json);
  const validos: Evento[] = [];
  for (const cru of t.eventos) {
    const v = Evento.safeParse(cru);
    if (v.success) {
      validos.push(v.data);
      continue;
    }
    const erro = `Evento ${t.evento} fora do formato esperado: ${v.error.issues.map((i) => `${i.path.join(".") || "evento"}: ${i.message}`).join("; ")}`;
    await registrar(ctx, `invalido:${t.evento}:${t.id}`, "invalido", { evento: t.evento }, erro);
    return { evento: t.evento, aceitos: 0 };
  }
  if (modoTeste) {
    await registrar(ctx, `teste:${t.evento}:${t.id}`, "teste", { evento: t.evento, eventos: validos.map(payloadSeguro) }, null);
    return { evento: t.evento, aceitos: 0 };
  }
  for (const e of validos) await processarEvento(ctx, e);
  return { evento: t.evento, aceitos: validos.length };
}
