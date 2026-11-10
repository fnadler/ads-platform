import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { caminho } from "@/lib/clarity/campanha";
import { sha256 } from "@/lib/cifra";
import { buscarPageSpeed, ErroPageSpeed } from "@/lib/integracoes/pagespeed";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";
import { capturaDaPagina, resumirPageSpeed } from "./resumo";

// Teste de velocidade de uma página de destino (alvo = endereço sem parâmetros). Uma consulta por job:
// grava o resumo e troca a captura da página inteira no Storage (só a mais recente fica).

export const BUCKET_PAGINAS = "paginas";

/** Endereço testado: sem parâmetros nem âncora (os do anúncio não mudam a página e poluiriam o histórico). */
export function paginaParaTestar(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new ErroPageSpeed("Endereço de página inválido.", 400);
  return `${u.origin}${u.pathname}`;
}

export async function executarTestePagina(admin: SupabaseClient, s: Sincronizacao): Promise<ResultadoJob> {
  let url: string;
  try {
    url = paginaParaTestar(s.alvo);
  } catch {
    throw new ErroPageSpeed("Endereço de página inválido.", 400);
  }
  const chave = caminho(url)!;
  const json = await buscarPageSpeed(url, "mobile");
  const resumo = resumirPageSpeed(json);

  let captura_path: string | null = null;
  const captura = capturaDaPagina(json);
  if (captura) {
    const path = `${s.organizacao_id}/${sha256(chave).slice(0, 24)}.${captura.tipo === "image/png" ? "png" : captura.tipo === "image/webp" ? "webp" : "jpg"}`;
    const { error } = await admin.storage.from(BUCKET_PAGINAS).upload(path, captura.dados, { contentType: captura.tipo, upsert: true });
    // Sem a captura o teste continua valendo: a tela só não mostra a página inteira.
    if (!error) captura_path = path;
    else console.error("[pagespeed] captura", error.message);
  }

  const { error } = await admin.from("pagina_testes").insert({
    organizacao_id: s.organizacao_id,
    url,
    chave,
    estrategia: "mobile",
    testado_em: resumo.testadoEm,
    nota: resumo.nota,
    resumo,
    captura_path,
  });
  if (error) throw new Error(`Não foi possível gravar o teste de velocidade: ${error.message}`);
  return { status: "pronto", linhas: 1 };
}
