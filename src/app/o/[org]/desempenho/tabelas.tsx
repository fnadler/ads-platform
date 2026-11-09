import type { Funil } from "@/lib/vendas/plataformas/catalogo";
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

export function colunasFunil(funil: Funil) {
  if (funil === "venda_direta")
    return (
      <>
        <th className="text-right">Compras (Meta)</th>
        <th className="text-right">Pendentes</th>
      </>
    );
  return (
    <>
      <th className="text-right">Leads (Meta)</th>
      <th className="text-right">CPL</th>
      <th className="text-right">Leads (sist.)</th>
      {funil === "cadastro_teste_venda" && <th className="text-right">Testes</th>}
    </>
  );
}

export function celulasFunil(s: Soma, funil: Funil, moedaIso: string) {
  if (funil === "venda_direta")
    return (
      <>
        <td>{inteiro(s.compras_meta)}</td>
        <td>{inteiro(s.vendas_pendentes)}</td>
      </>
    );
  return (
    <>
      <td>{inteiro(s.leads_meta)}</td>
      <td>{moeda(razao(s.gasto, s.leads_meta), moedaIso)}</td>
      <td>{inteiro(s.leads)}</td>
      {funil === "cadastro_teste_venda" && (
        <td>
          <Testes total={s.testes} cancelados={s.testes_cancelados} />
        </td>
      )}
    </>
  );
}
