import { Formulario } from "@/components/Formulario";
import { Campo, Cartao } from "@/components/ui";
import { salvarMetas } from "@/lib/campanhas/acoes";
import type { Metas } from "@/lib/campanhas/metas";
import type { Funil } from "@/lib/vendas/plataformas/catalogo";

// Metas da campanha em Gerenciar: quanto a pessoa aceita pagar por cadastro e por venda. A leitura da campanha
// compara o custo real com elas depois de alguns dias e avisa quando passa (sem alarmar no começo).

const valor = (v: number | null) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

export function CartaoMetas({ orgId, metaCampaignId, metas, funil, moeda }: { orgId: string; metaCampaignId: string; metas: Metas; funil: Funil; moeda: string }) {
  const simbolo = (0).toLocaleString("pt-BR", { style: "currency", currency: moeda }).replace(/[\d\s,. ]/g, "");
  const venda = funil === "cadastro_teste_venda" ? "assinante" : "venda";
  return (
    <Cartao
      titulo="Metas"
      descricao="Quanto você aceita pagar por resultado. Depois de 5 dias, a leitura da campanha avisa se o custo passou da meta. Deixe em branco o que não quiser acompanhar."
    >
      <Formulario acao={salvarMetas} rotulo="Salvar metas" variante="secundario" className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="organizacao_id" value={orgId} />
        <input type="hidden" name="campanha" value={metaCampaignId} />
        {funil !== "venda_direta" && (
          <Campo rotulo={`Custo por cadastro (${simbolo})`} name="custo_cadastro" inputMode="decimal" defaultValue={valor(metas.cadastro)} placeholder="Ex.: 3,00" />
        )}
        <Campo
          rotulo={`Custo por ${venda} (${simbolo})`}
          name="custo_venda"
          inputMode="decimal"
          defaultValue={valor(metas.venda)}
          placeholder="Ex.: 60,00"
          ajuda={funil === "cadastro_teste_venda" ? "Conta a partir da primeira cobrança, depois do teste grátis." : undefined}
        />
      </Formulario>
    </Cartao>
  );
}
