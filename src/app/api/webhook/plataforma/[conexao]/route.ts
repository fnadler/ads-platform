import { NextResponse } from "next/server";
import { lerSegredo } from "@/lib/conexoes/segredos";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ehPlataforma } from "@/lib/vendas/plataformas/catalogo";
import { RECEPTORES, receberEvento } from "@/lib/vendas/plataformas/receber";

// Webhook das plataformas de venda (um endereço por conexão: /api/webhook/plataforma/<id da conexão>). Cada
// plataforma tem o seu jeito de autenticar; depois disso, o caminho é o mesmo. Erro ao gravar → 500 e a
// plataforma tenta de novo (a ingestão é idempotente).
export async function POST(request: Request, ctx: RouteContext<"/api/webhook/plataforma/[conexao]">) {
  const { conexao: conexaoId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(conexaoId)) return NextResponse.json({ erro: "conexão não encontrada" }, { status: 404 });
  const admin = criarClienteAdmin();
  const { data: conexao } = await admin.from("conexoes").select("id, organizacao_id, tipo, config").eq("id", conexaoId).maybeSingle();
  if (!conexao || !ehPlataforma(conexao.tipo)) return NextResponse.json({ erro: "conexão não encontrada" }, { status: 404 });

  const segredo = await lerSegredo<{ segredo: string }>(admin, conexao.organizacao_id, conexao.id);
  if (!segredo?.segredo) return NextResponse.json({ erro: "conexão sem credencial: cole o token nas Configurações" }, { status: 401 });

  const corpo = await request.text();
  const plataforma = RECEPTORES[conexao.tipo];
  if (!plataforma.autenticar({ corpo, cabecalhos: request.headers, url: new URL(request.url) }, segredo.segredo))
    return NextResponse.json({ erro: "credencial inválida" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ erro: "corpo precisa ser JSON" }, { status: 400 });
  }

  const modoTeste = (conexao.config as { modo_teste?: boolean })?.modo_teste !== false;
  try {
    const r = await receberEvento({ admin, organizacaoId: conexao.organizacao_id, conexaoId: conexao.id, origem: conexao.tipo }, plataforma, modoTeste, json);
    return NextResponse.json({ recebido: true, ...r, modo_teste: modoTeste });
  } catch (err) {
    console.error("[webhook plataforma]", conexao.organizacao_id, conexao.tipo, err);
    return NextResponse.json({ erro: "falha ao processar" }, { status: 500 });
  }
}
