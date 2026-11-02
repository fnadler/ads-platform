import { createHmac } from "node:crypto";
import { dataIso, idMeta, iguais, obj, txt, type Plataforma } from "./comum";

// Webhook da Kiwify. A assinatura é um HMAC-SHA1 do corpo exato com o token, no parâmetro "signature" da URL.
// A Kiwify repassa só src, sck, utm_* padrão e s1 a s3: o anúncio vai no sck e a campanha no src. O valor vem
// em centavos em Commissions.charge_amount.

const TIPOS: Record<string, { tipo: string; sufixo?: string }> = {
  order_approved: { tipo: "venda" },
  subscription_renewed: { tipo: "venda" },
  pix_created: { tipo: "venda_pendente" },
  billet_created: { tipo: "venda_pendente" },
  order_rejected: { tipo: "venda_expirada" },
  order_refunded: { tipo: "reembolso", sufixo: ":reembolso" },
  chargeback: { tipo: "chargeback", sufixo: ":chargeback" },
};

export const kiwify: Plataforma = {
  autenticar({ corpo, url }, segredo) {
    const assinatura = url.searchParams.get("signature");
    return !!assinatura && iguais(assinatura.toLowerCase(), createHmac("sha1", segredo).update(corpo).digest("hex"));
  },

  traduzir(json) {
    const raiz = obj(json);
    const evento = txt(raiz.webhook_event_type) ?? "desconhecido";
    const id = txt(raiz.order_id) ?? "sem-id";
    const mapa = TIPOS[evento];
    if (!mapa || !txt(raiz.order_id)) return { evento, id, eventos: [] };

    const comissoes = obj(raiz.Commissions);
    const rastreio = obj(raiz.TrackingParameters);
    const centavos = Number(comissoes.charge_amount);
    return {
      evento,
      id,
      eventos: [
        {
          tipo: mapa.tipo,
          id_externo: `${raiz.order_id}${mapa.sufixo ?? ""}`,
          // Sem valor válido, a validação recusa e o erro aparece em Leads e vendas: nunca grava venda zerada.
          valor: comissoes.charge_amount != null && Number.isFinite(centavos) ? centavos / 100 : undefined,
          moeda: txt(comissoes.currency)?.toUpperCase(),
          ocorrido_em: dataIso(evento === "order_approved" ? (raiz.approved_date ?? raiz.updated_at) : (raiz.updated_at ?? raiz.created_at)),
          email: txt(obj(raiz.Customer).email),
          primeira: evento === "order_approved" ? true : evento === "subscription_renewed" ? false : undefined,
          atribuicao: {
            utm_ad_id: idMeta(rastreio.sck) ?? idMeta(rastreio.s1),
            utm_campaign_id: idMeta(rastreio.src),
          },
        },
      ],
    };
  },
};
