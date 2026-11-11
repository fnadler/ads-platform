import type { Funil } from "@/lib/vendas/plataformas/catalogo";
import { Termo } from "@/components/Termo";
import { decimal, inteiro, moeda, razao } from "@/lib/formato";
import type { Soma } from "./soma";

// Peças das tabelas de números (lista de campanhas, públicos e anúncios): as colunas que dependem do funil.

export const destaque = "bg-accent-soft font-semibold text-ink";
export const roas = (receita: number, gasto: number) => (receita ? decimal(razao(receita, gasto)) : "—");
export const rotuloCancelados = (n: number) => `${inteiro(n)} ${n === 1 ? "cancelado" : "cancelados"}`;

/** Célula de testes: os que iniciaram e, embaixo, quantos desistiram antes da cobrança. */
function Testes({ total, cancelados }: { total: number; cancelados: number }) {
  return (
    <>
      {inteiro(total)}
      {cancelados > 0 && <div className="text-xs text-ink-3">{rotuloCancelados(cancelados)}</div>}
    </>
  );
}

/**
 * Colunas técnicas (o que a Meta conta pelo pixel) só aparecem com "Ver detalhes", quando a tabela está dentro de
 * um bloco com o interruptor (ComDetalhes). Fora dele, aparecem sempre.
 */
export const TECNICA = "hidden group-has-[[data-detalhes]:checked]/detalhes:table-cell";

export function colunasFunil(funil: Funil, { tecnicas = false }: { tecnicas?: boolean } = {}) {
  const t = tecnicas ? TECNICA : "";
  if (funil === "venda_direta")
    return (
      <>
        <th className={`text-right ${t}`}>
          <Termo id="comprasMeta">Compras (Meta)</Termo>
        </th>
        <th className="text-right">
          <Termo id="pendentes">Pendentes</Termo>
        </th>
      </>
    );
  return (
    <>
      <th className={`text-right ${t}`}>
        <Termo id="cadastrosMeta">Cadastros (Meta)</Termo>
      </th>
      <th className={`text-right ${t}`}>
        <Termo id="custoCadastroMeta">Custo por cadastro (Meta)</Termo>
      </th>
      <th className="text-right">
        <Termo id="cadastros">Cadastros</Termo>
      </th>
      {funil === "cadastro_teste_venda" && (
        <th className="text-right">
          <Termo id="testes">Testes</Termo>
        </th>
      )}
    </>
  );
}

export function celulasFunil(s: Soma, funil: Funil, moedaIso: string, { tecnicas = false }: { tecnicas?: boolean } = {}) {
  const t = tecnicas ? TECNICA : undefined;
  if (funil === "venda_direta")
    return (
      <>
        <td className={t}>{inteiro(s.compras_meta)}</td>
        <td>{inteiro(s.vendas_pendentes)}</td>
      </>
    );
  return (
    <>
      <td className={t}>{inteiro(s.leads_meta)}</td>
      <td className={t}>{moeda(razao(s.gasto, s.leads_meta), moedaIso)}</td>
      <td>{inteiro(s.leads)}</td>
      {funil === "cadastro_teste_venda" && (
        <td>
          <Testes total={s.testes} cancelados={s.testes_cancelados} />
        </td>
      )}
    </>
  );
}
