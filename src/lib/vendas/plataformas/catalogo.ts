// O que as telas mostram de cada plataforma de venda (sem lógica de recebimento) e o funil de cada tipo de negócio.

export const FUNIS = {
  cadastro_teste_venda: { rotulo: "Cadastro, teste grátis e pagamento", descricao: "Assinatura com teste: a venda conta na primeira cobrança." },
  cadastro_venda: { rotulo: "Cadastro e venda", descricao: "A pessoa deixa o contato na sua página e compra depois." },
  venda_direta: { rotulo: "Venda direta no checkout", descricao: "Infoproduto ou loja: o anúncio leva à compra, sem cadastro antes." },
} as const;
export type Funil = keyof typeof FUNIS;

export const PLATAFORMAS_VENDA = {
  hotmart: {
    rotulo: "Hotmart",
    campoSegredo: "Hottok",
    painel: "https://app.hotmart.com/tools/webhook",
    passos: [
      "Na Hotmart, abra Ferramentas → Webhook. Na aba Autenticação, copie o Hottok e cole abaixo.",
      "Clique em “+ Cadastrar Webhook”, escolha o produto (ou todos), cole o endereço acima e selecione a versão 2.0.0.",
      "Marque os eventos de compra: aprovada, completa, cancelada, reembolsada, chargeback, boleto impresso e expirada.",
      "Envie um evento de teste pela Hotmart e confira abaixo o que chegou.",
    ],
  },
  kiwify: {
    rotulo: "Kiwify",
    campoSegredo: "Token do webhook",
    painel: "https://dashboard.kiwify.com.br/apps/webhooks",
    passos: [
      "Na Kiwify, abra Apps → Webhooks e crie um webhook com o endereço acima.",
      "Copie o token do webhook e cole abaixo.",
      "Marque os gatilhos: compra aprovada, recusada e reembolsada, chargeback, Pix gerado, boleto gerado e assinatura renovada.",
      "Clique em “Testar Webhook” na Kiwify e confira abaixo o que chegou.",
    ],
  },
} as const;
export type TipoPlataforma = keyof typeof PLATAFORMAS_VENDA;
export const TIPOS_PLATAFORMA = Object.keys(PLATAFORMAS_VENDA) as TipoPlataforma[];
export const ehPlataforma = (t: string): t is TipoPlataforma => t in PLATAFORMAS_VENDA;

/** Para quem tem página própria antes do checkout: leva os parâmetros do anúncio até o link de compra. */
export const SCRIPT_CHECKOUT = `<script>document.addEventListener("DOMContentLoaded",function(){var q=new URLSearchParams(location.search),p=["sck","src","utm_source","utm_medium","utm_campaign","utm_content","utm_term"];document.querySelectorAll('a[href*="hotmart.com"],a[href*="kiwify.com"]').forEach(function(a){var u=new URL(a.href);p.forEach(function(k){var v=q.get(k);if(v&&!u.searchParams.has(k))u.searchParams.set(k,v)});a.href=u.toString()})});</script>`;
