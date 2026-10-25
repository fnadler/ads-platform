import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sha256 } from "@/lib/cifra";

// Entrada de leads e vendas, comum a todas as fontes (webhook genérico, Stripe, CSV). Idempotente: o
// lead é chaveado por (organização, id_externo) e a venda por (organização, origem, id_externo), então
// reenviar o mesmo evento não duplica. A atribuição até o anúncio é resolvida no banco (trigger).
//
// LGPD: e-mail e telefone viram hash SHA-256 aqui e não são gravados em claro em lugar nenhum (nem no
// payload guardado em eventos_recebidos).

const texto = (max = 500) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const quando = z.iso.datetime({ offset: true }).or(z.iso.date()).optional();

export const Atribuicao = z
  .object({
    utm_source: texto(),
    utm_medium: texto(),
    utm_campaign: texto(),
    utm_content: texto(),
    utm_term: texto(),
    utm_campaign_id: texto(64),
    utm_adset_id: texto(64),
    utm_ad_id: texto(64),
    fbclid: texto(),
    landing_path: texto(),
  })
  .partial();
export type Atribuicao = z.infer<typeof Atribuicao>;

const EventoLead = z.object({
  tipo: z.literal("lead"),
  id_externo: z.string().trim().min(1).max(200),
  ocorrido_em: quando,
  email: texto(320),
  telefone: texto(40),
  nome: texto(200),
  atribuicao: Atribuicao.optional(),
  primeiro_toque: Atribuicao.optional(),
});

const EventoTeste = z.object({
  tipo: z.literal("teste_iniciado"),
  id_externo: z.string().trim().min(1).max(200), // do lead
  ocorrido_em: quando,
});

const EventoVenda = z.object({
  tipo: z.enum(["venda", "reembolso"]),
  id_externo: z.string().trim().min(1).max(200), // da venda/pedido
  valor: z.coerce.number().finite(),
  moeda: z.string().trim().length(3).toUpperCase().optional(),
  ocorrido_em: quando,
  lead_id_externo: texto(200),
  cliente_externo: texto(200),
  email: texto(320),
  primeira: z.boolean().optional(),
  atribuicao: Atribuicao.optional(),
});

export const Evento = z.discriminatedUnion("tipo", [EventoLead, EventoTeste, EventoVenda]);
export type Evento = z.infer<typeof Evento>;
export const CorpoWebhook = z.union([z.object({ eventos: z.array(z.unknown()).min(1).max(500) }), z.record(z.string(), z.unknown())]);

type Origem = "webhook" | "stripe" | "csv";
interface Contexto {
  admin: SupabaseClient;
  organizacaoId: string;
  conexaoId: string | null;
  origem: Origem;
}

/** Normaliza e-mail/telefone antes do hash (o mesmo cliente casa entre fontes). */
export const hashEmail = (email?: string | null) => (email?.trim() ? sha256(email.trim().toLowerCase()) : null);
export const hashTelefone = (tel?: string | null) => {
  const d = tel?.replace(/\D/g, "") ?? "";
  return d.length >= 8 ? sha256(d.startsWith("55") ? d : `55${d}`) : null;
};

/** Código do lead de teste da verificação de rastreio: "rastreio-4f9a2c" no e-mail ou no nome. */
export const codigoTeste = (...campos: Array<string | undefined | null>) => campos.map((c) => c?.match(/rastreio-([a-f0-9]{6})/i)?.[1]?.toLowerCase()).find(Boolean) ?? null;

const semVazios = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;

const prefixar = (a: Atribuicao | undefined, prefixo: string) => Object.fromEntries(Object.entries(semVazios(a ?? {})).filter(([k]) => k.startsWith("utm_")).map(([k, v]) => [`${prefixo}${k}`, v]));

/** Payload que fica guardado (sem e-mail, telefone e nome). */
function payloadSeguro(e: Evento) {
  const copia: Record<string, unknown> = { ...e };
  delete copia.email;
  delete copia.telefone;
  delete copia.nome;
  return copia;
}

async function registrarEvento(ctx: Contexto, chave: string, e: Evento) {
  const { error } = await ctx.admin.from("eventos_recebidos").upsert(
    { organizacao_id: ctx.organizacaoId, conexao_id: ctx.conexaoId, origem: ctx.origem, chave_idempotencia: chave, tipo: e.tipo, payload: payloadSeguro(e), processado_em: new Date().toISOString(), erro: null },
    { onConflict: "organizacao_id,origem,chave_idempotencia" },
  );
  if (error) console.error("[ingestão] eventos_recebidos", error.message);
}

async function upsertLead(ctx: Contexto, campos: Record<string, unknown> & { id_externo: string; criado_em?: string }) {
  // Lead que ainda não existe (ex.: a venda chegou antes do cadastro) nasce com a data do evento; quando o
  // cadastro chegar, ele completa a atribuição e a data.
  const { data: existente } = await ctx.admin.from("leads").select("id").eq("organizacao_id", ctx.organizacaoId).eq("id_externo", campos.id_externo).maybeSingle();
  if (existente) {
    const { error } = await ctx.admin.from("leads").update(campos).eq("id", existente.id);
    if (error) throw new Error(error.message);
    return existente.id as string;
  }
  const { data, error } = await ctx.admin
    .from("leads")
    .upsert({ organizacao_id: ctx.organizacaoId, conexao_id: ctx.conexaoId, criado_em: new Date().toISOString(), ...campos }, { onConflict: "organizacao_id,id_externo" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function processarEvento(ctx: Contexto, e: Evento): Promise<void> {
  const agora = new Date().toISOString();
  const em = (v?: string) => (v ? new Date(v).toISOString() : agora);

  if (e.tipo === "lead") {
    await upsertLead(ctx, {
      ...semVazios({
        id_externo: e.id_externo,
        conexao_id: ctx.conexaoId,
        email_hash: hashEmail(e.email),
        telefone_hash: hashTelefone(e.telefone),
        nome: e.nome,
        codigo_teste: codigoTeste(e.email, e.nome),
        fbclid: e.atribuicao?.fbclid,
        landing_path: e.atribuicao?.landing_path,
      }),
      ...prefixar(e.atribuicao, ""),
      ...prefixar(e.primeiro_toque, "ftp_"),
      id_externo: e.id_externo,
      criado_em: em(e.ocorrido_em),
    });
    await registrarEvento(ctx, `lead:${e.id_externo}`, e);
    return;
  }

  if (e.tipo === "teste_iniciado") {
    const { data: lead } = await ctx.admin.from("leads").select("id, teste_iniciado_em").eq("organizacao_id", ctx.organizacaoId).eq("id_externo", e.id_externo).maybeSingle();
    if (lead?.teste_iniciado_em) return; // vale o primeiro
    await upsertLead(ctx, { id_externo: e.id_externo, teste_iniciado_em: em(e.ocorrido_em), ...(lead ? {} : { criado_em: em(e.ocorrido_em) }) });
    await registrarEvento(ctx, `teste:${e.id_externo}`, e);
    return;
  }

  const reembolso = e.tipo === "reembolso";
  const { error } = await ctx.admin.from("vendas").upsert(
    {
      organizacao_id: ctx.organizacaoId,
      conexao_id: ctx.conexaoId,
      origem: ctx.origem,
      id_externo: e.id_externo,
      tipo: reembolso ? "reembolso" : "pagamento",
      valor: reembolso ? -Math.abs(e.valor) : e.valor,
      moeda: e.moeda ?? "BRL",
      ocorrida_em: em(e.ocorrido_em),
      lead_id_externo: e.lead_id_externo ?? null,
      cliente_externo: e.cliente_externo ?? null,
      email_hash: hashEmail(e.email),
      primeira: e.primeira ?? false,
      utm_campaign_id: e.atribuicao?.utm_campaign_id ?? null,
      utm_adset_id: e.atribuicao?.utm_adset_id ?? null,
      utm_ad_id: e.atribuicao?.utm_ad_id ?? null,
    },
    { onConflict: "organizacao_id,origem,id_externo" },
  );
  if (error) throw new Error(error.message);
  if (!reembolso && e.primeira && e.lead_id_externo) {
    await ctx.admin
      .from("leads")
      .update({ primeiro_pagamento_em: em(e.ocorrido_em) })
      .eq("organizacao_id", ctx.organizacaoId)
      .eq("id_externo", e.lead_id_externo)
      .is("primeiro_pagamento_em", null);
  }
  await registrarEvento(ctx, `${e.tipo}:${e.id_externo}`, e);
}

/** Valida e processa uma lista de eventos crus; devolve quantos entraram e os erros por posição. */
export async function processarLote(ctx: Contexto, crus: unknown[]) {
  let aceitos = 0;
  const erros: Array<{ indice: number; erro: string }> = [];
  for (const [indice, cru] of crus.entries()) {
    const v = Evento.safeParse(cru);
    if (!v.success) {
      erros.push({ indice, erro: v.error.issues.map((i) => `${i.path.join(".") || "evento"}: ${i.message}`).join("; ") });
      continue;
    }
    try {
      await processarEvento(ctx, v.data);
      aceitos++;
    } catch (e) {
      erros.push({ indice, erro: (e as Error).message });
    }
  }
  return { aceitos, erros };
}
