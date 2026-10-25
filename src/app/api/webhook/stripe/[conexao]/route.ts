import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { lerSegredo, type SegredoStripe } from "@/lib/conexoes/segredos";
import { clienteStripe } from "@/lib/integracoes/stripe";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { processarEvento, type Evento } from "@/lib/vendas/ingestao";
import { reembolsoDaCobranca, testeDaAssinatura, vendaDaFatura } from "@/lib/vendas/stripe";

// Webhook do Stripe de uma organização (um endpoint por conexão: /api/webhook/stripe/<id da conexão>).
// Eventos: invoice.paid, customer.subscription.created e charge.refunded. A assinatura é conferida com o
// segredo whsec_ da conexão. Erro ao gravar → 500 e o Stripe tenta de novo (a ingestão é idempotente).
export async function POST(request: Request, ctx: RouteContext<"/api/webhook/stripe/[conexao]">) {
  const { conexao: conexaoId } = await ctx.params;
  const admin = criarClienteAdmin();
  const { data: conexao } = await admin.from("conexoes").select("id, organizacao_id, config").eq("id", conexaoId).eq("tipo", "stripe").maybeSingle();
  if (!conexao) return NextResponse.json({ erro: "conexão não encontrada" }, { status: 404 });
  const segredo = await lerSegredo<SegredoStripe>(admin, conexao.organizacao_id, conexao.id);
  const assinatura = request.headers.get("stripe-signature");
  if (!segredo?.segredo_webhook || !assinatura) return NextResponse.json({ erro: "webhook não configurado" }, { status: 400 });

  const stripe = clienteStripe(segredo.chave);
  let evento: Stripe.Event;
  try {
    evento = stripe.webhooks.constructEvent(await request.text(), assinatura, segredo.segredo_webhook);
  } catch {
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 400 });
  }

  const campo = (conexao.config as { campo_lead?: string })?.campo_lead || "user_id";
  try {
    let e: Evento | null = null;
    if (evento.type === "invoice.paid") e = await vendaDaFatura(stripe, evento.data.object, campo);
    else if (evento.type === "customer.subscription.created") e = testeDaAssinatura(evento.data.object, campo);
    else if (evento.type === "charge.refunded") e = await reembolsoDaCobranca(admin, conexao.organizacao_id, evento.data.object);
    if (e) await processarEvento({ admin, organizacaoId: conexao.organizacao_id, conexaoId: conexao.id, origem: "stripe" }, e);
  } catch (err) {
    console.error("[webhook stripe]", conexao.organizacao_id, evento.type, evento.id, err);
    return NextResponse.json({ erro: "falha ao processar" }, { status: 500 });
  }
  return NextResponse.json({ recebido: true });
}
