import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { destinoSeguro } from "@/lib/rotas";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Link de e-mail no formato token_hash (abre em qualquer aparelho). Modelo do e-mail no Supabase:
//   {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=magiclink&next=/
const TIPOS: EmailOtpType[] = ["magiclink", "recovery", "email", "invite"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && tipo && TIPOS.includes(tipo)) {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${destinoSeguro(searchParams.get("next"))}`);
  }
  return NextResponse.redirect(`${origin}/entrar?erro=1`);
}
