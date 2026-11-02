import { dataIso, idMeta, iguais, obj, txt, type Plataforma } from "./comum";

// Webhook 2.0.0 da Hotmart. A origem vem em purchase.origin (sck, src, xcod); o changelog da Hotmart também
// mostra purchase.tracking (source_sck, source), então os dois são aceitos. O anúncio vai no sck.

const VENDA = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"]);
const TIPOS: Record<string, { tipo: string; sufixo?: string }> = {
  PURCHASE_APPROVED: { tipo: "venda" },
  PURCHASE_COMPLETE: { tipo: "venda" },
  PURCHASE_BILLET_PRINTED: { tipo: "venda_pendente" },
  PURCHASE_EXPIRED: { tipo: "venda_expirada" },
  PURCHASE_CANCELED: { tipo: "venda_expirada" },
  PURCHASE_REFUNDED: { tipo: "reembolso", sufixo: ":reembolso" },
  PURCHASE_CHARGEBACK: { tipo: "chargeback", sufixo: ":chargeback" },
};

/**
 * O que fica com o produtor: a comissão PRODUCER, já descontadas as taxas da Hotmart e a parte de afiliados e
 * coprodutores (convertida, em venda em outra moeda). Sem ela no evento, vale o preço pago, para não perder a venda.
 */
function valorLiquido(dados: Record<string, unknown>, preco: Record<string, unknown>) {
  const comissoes = Array.isArray(dados.commissions) ? dados.commissions.map(obj) : [];
  const produtor = comissoes.find((c) => c.source === "PRODUCER");
  if (typeof produtor?.value !== "number") return { valor: preco.value, moeda: txt(preco.currency_value)?.toUpperCase() };
  const conversao = obj(produtor.currency_conversion);
  if (typeof conversao.converted_value === "number" && txt(conversao.converted_to_currency))
    return { valor: conversao.converted_value, moeda: txt(conversao.converted_to_currency)?.toUpperCase() };
  return { valor: produtor.value, moeda: txt(produtor.currency_value)?.toUpperCase() };
}

export const hotmart: Plataforma = {
  autenticar({ cabecalhos, corpo }, segredo) {
    let token = cabecalhos.get("x-hotmart-hottok");
    if (!token) {
      try {
        token = txt(obj(JSON.parse(corpo)).hottok) ?? null;
      } catch {
        return false;
      }
    }
    return !!token && iguais(token, segredo);
  },

  traduzir(json) {
    const raiz = obj(json);
    const evento = txt(raiz.event) ?? "desconhecido";
    const dados = obj(raiz.data);
    const compra = obj(dados.purchase);
    const id = txt(compra.transaction) ?? txt(raiz.id) ?? "sem-id";
    const mapa = TIPOS[evento];
    if (!mapa) return { evento, id, eventos: [] };

    const origem = obj(compra.origin);
    const rastreio = obj(compra.tracking);
    const preco = obj(compra.price);
    const recorrencia = compra.recurrence_number;
    return {
      evento,
      id,
      eventos: [
        {
          tipo: mapa.tipo,
          id_externo: `${compra.transaction ?? ""}${mapa.sufixo ?? ""}`,
          ...valorLiquido(dados, preco),
          ocorrido_em: dataIso(VENDA.has(evento) ? (compra.approved_date ?? raiz.creation_date) : raiz.creation_date),
          email: txt(obj(dados.buyer).email),
          primeira: VENDA.has(evento) ? recorrencia == null || Number(recorrencia) === 1 : undefined,
          atribuicao: {
            utm_ad_id: idMeta(origem.sck) ?? idMeta(rastreio.source_sck) ?? idMeta(origem.xcod) ?? idMeta(origem.xcode),
            utm_campaign_id: idMeta(origem.src) ?? idMeta(rastreio.source),
          },
        },
      ],
    };
  },
};
