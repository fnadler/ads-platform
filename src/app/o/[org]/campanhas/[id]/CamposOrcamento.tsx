"use client";

import { useState } from "react";
import { Campo, Selecao } from "@/components/ui";

// Tipo de orçamento: diário (média por dia) ou total do período (a Meta não passa do valor; exige fim).
export function CamposOrcamento({
  tipo,
  diaria,
  total,
  teto,
  inicio,
  fim,
}: {
  tipo: "diario" | "total";
  diaria: number;
  total: number;
  teto: string | null;
  inicio: string;
  fim: string;
}) {
  const [t, setT] = useState(tipo);
  const [valorTotal, setValorTotal] = useState(total || 0);
  const dias = fim && inicio ? (Date.parse(fim) - Date.parse(inicio)) / 86_400_000 : null;
  const media = t === "total" && dias && dias > 0 && valorTotal ? valorTotal / dias : null;
  return (
    <>
      <Selecao rotulo="Orçamento" name="tipo_orcamento" value={t} onChange={(e) => setT(e.currentTarget.value as "diario" | "total")}>
        <option value="diario">Diário (média por dia)</option>
        <option value="total">Total do período (não passa do valor)</option>
      </Selecao>
      {t === "diario" ? (
        <Campo rotulo="Verba diária (R$)" name="verba_diaria" type="number" min="1" step="1" defaultValue={diaria || ""} required ajuda={teto ? `Teto da organização: ${teto}/dia. A Meta pode variar o gasto de um dia para o outro.` : undefined} />
      ) : (
        <Campo
          rotulo="Orçamento total (R$)"
          name="verba_total"
          type="number"
          min="1"
          step="1"
          value={valorTotal || ""}
          onChange={(e) => setValorTotal(Number(e.currentTarget.value))}
          required
          ajuda={
            media
              ? `≈ ${media.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/dia em ${dias!.toFixed(1).replace(".0", "").replace(".", ",")} dias${teto ? ` (teto: ${teto}/dia)` : ""}. Exige a data de fim; salve para recalcular.`
              : "Informe também a data de fim: a Meta distribui o valor até ela."
          }
        />
      )}
    </>
  );
}
