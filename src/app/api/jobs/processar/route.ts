import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processarFila } from "@/lib/jobs/worker";

// Chamado a cada minuto pelo Supabase (pg_cron + pg_net) quando há job na fila. Protegido pelo
// SEGREDO_WORKER. Processa jobs por até ~4 min e para antes do limite da função.
export const maxDuration = 300;

function autorizado(request: Request) {
  const esperado = process.env.SEGREDO_WORKER;
  const recebido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!esperado || recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

export async function POST(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const relatorio = await processarFila(240_000);
  return NextResponse.json({ processados: relatorio });
}
