import { NextResponse } from "next/server";
import { destinoSeguro } from "@/lib/rotas";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Link de acesso por e-mail (fluxo PKCE: só funciona no navegador que pediu o link).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${destinoSeguro(searchParams.get("next"))}`);
  }
  return NextResponse.redirect(`${origin}/entrar?erro=1`);
}
