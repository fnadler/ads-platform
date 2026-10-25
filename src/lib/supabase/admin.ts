import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service role: ignora o RLS. Só no servidor (o import "server-only" quebra o build se um componente
// do navegador importar). Usado pelo worker, pelos webhooks e para ler segredos. Toda consulta feita com
// ele PRECISA filtrar por organizacao_id explicitamente.
export function criarClienteAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
