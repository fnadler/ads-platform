import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Renova o cookie de sessão do Supabase em toda requisição e manda para /entrar quem não está logado.
// Checagem otimista: a autorização de verdade está no RLS e em src/lib/auth/sessao.ts.
const PUBLICAS = /^\/(entrar|auth|convite|api)(\/|$)/;

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && !PUBLICAS.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

// Webhooks e o worker não passam pelo proxy (sem sessão, e respondem mais rápido).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhook|api/jobs|rastreio\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
