import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export async function POST(request: Request) {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/entrar", request.url), { status: 303 });
}
