"use server";

import { refresh } from "next/cache";
import type { Resultado } from "@/components/Formulario";
import { acessoOrganizacao } from "@/lib/auth/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { lerCsv, linhaParaEvento } from "./csv";
import { processarLote } from "./ingestao";

const LIMITE_LINHAS = 5000;

/** Importa leads e vendas de um CSV (mesmos campos do webhook; reimportar não duplica). */
export async function importarCsv(_: Resultado, dados: FormData): Promise<Resultado> {
  const orgId = String(dados.get("organizacao_id"));
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || !arquivo.size) return { erro: "Escolha um arquivo CSV." };
  if (arquivo.size > 3_900_000) return { erro: "Arquivo maior que 4 MB: divida em partes." };
  try {
    const { supabase } = await acessoOrganizacao(orgId, "gestor");
    const linhas = lerCsv(await arquivo.text());
    if (!linhas.length) return { erro: "O CSV está vazio ou sem cabeçalho." };
    if (linhas.length > LIMITE_LINHAS) return { erro: `Até ${LIMITE_LINHAS} linhas por arquivo.` };
    if (!("id_externo" in linhas[0])) return { erro: "Falta a coluna id_externo." };
    const r = await processarLote({ admin: criarClienteAdmin(), organizacaoId: orgId, conexaoId: null, origem: "csv" }, linhas.map(linhaParaEvento));
    await supabase.rpc("registrar_auditoria", { p_org: orgId, p_acao: "csv.importado", p_detalhes: { arquivo: arquivo.name, aceitos: r.aceitos, erros: r.erros.length } });
    refresh();
    if (!r.erros.length) return { mensagem: `${r.aceitos} linha(s) importada(s).` };
    const amostra = r.erros.slice(0, 5).map((e) => `linha ${e.indice + 2}: ${e.erro}`).join(" · ");
    return { [r.aceitos ? "mensagem" : "erro"]: `${r.aceitos} importada(s), ${r.erros.length} com erro. ${amostra}` } as Resultado;
  } catch (e) {
    return { erro: (e as Error).message };
  }
}
