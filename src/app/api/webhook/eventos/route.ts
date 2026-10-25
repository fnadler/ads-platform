import { NextResponse } from "next/server";
import { sha256 } from "@/lib/cifra";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { CorpoWebhook, processarLote } from "@/lib/vendas/ingestao";

// Webhook genérico de leads e vendas. A organização vem do token (Authorization: Bearer whk_…), nunca do
// corpo. Aceita um evento ou { eventos: [...] } (até 500). Formato em README.md, "Webhook genérico".
// Responde 200 com o que entrou e os erros por posição; 400 só se nenhum evento for válido.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return NextResponse.json({ erro: "Envie o token no cabeçalho Authorization: Bearer <token>." }, { status: 401 });

  const admin = criarClienteAdmin();
  const { data: credencial } = await admin
    .from("tokens_webhook")
    .select("organizacao_id, conexao_id")
    .eq("token_hash", sha256(token))
    .is("revogado_em", null)
    .maybeSingle();
  if (!credencial) return NextResponse.json({ erro: "Token inválido ou revogado." }, { status: 401 });

  const bruto = await request.json().catch(() => null);
  const corpo = CorpoWebhook.safeParse(bruto);
  if (!corpo.success) return NextResponse.json({ erro: "Corpo precisa ser um evento JSON ou { eventos: [...] }." }, { status: 400 });
  const eventos = "eventos" in corpo.data && Array.isArray(corpo.data.eventos) ? corpo.data.eventos : [corpo.data];

  const resultado = await processarLote({ admin, organizacaoId: credencial.organizacao_id, conexaoId: credencial.conexao_id, origem: "webhook" }, eventos);
  if (!resultado.aceitos && resultado.erros.length) return NextResponse.json(resultado, { status: 400 });
  return NextResponse.json(resultado);
}
