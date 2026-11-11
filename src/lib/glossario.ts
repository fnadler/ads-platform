// Uma frase por termo, em português simples, para quem não é da área. Aparece ao passar o mouse ou tocar no "?"
// ao lado do nome (componente Termo). Manter curto: o que é e por que importa.

export const GLOSSARIO = {
  investido: "Quanto a Meta cobrou pelos anúncios no período.",
  cadastros: "Pessoas que se cadastraram no seu site e chegaram ao sistema com o anúncio de origem. É sobre elas que contamos vendas e retorno.",
  cadastrosMeta: "Cadastros que a Meta conta pelo pixel do site. Costuma ser diferente do número do sistema: bloqueadores e navegadores escondem parte das visitas.",
  custoCadastro: "Investido dividido pelos cadastros. Quanto custou, em média, cada cadastro.",
  custoCadastroMeta: "Investido dividido pelos cadastros que a Meta conta. É o custo por lead que o Gerenciador mostra.",
  testes: "Quem começou o teste grátis. Cancelados são os que desistiram antes da primeira cobrança.",
  vendas: "Pagamentos confirmados pela sua plataforma de venda, ligados ao anúncio de origem. Pix e boleto só contam depois de pagos.",
  comprasMeta: "Compras que a Meta conta pelo pixel. A venda confirmada pela sua plataforma é a coluna Vendas.",
  pendentes: "Pix ou boleto gerados e ainda não pagos.",
  recebido: "Soma das vendas que vieram dos anúncios, já descontando reembolso e chargeback.",
  custoVenda: "Investido dividido pelas vendas. Quanto custou, em média, cada venda.",
  retorno: "Quanto voltou em vendas para cada R$ 1 investido (o ROAS). Acima de 1, os anúncios pagam o que custam.",
  impressoes: "Quantas vezes os anúncios apareceram na tela de alguém.",
  frequencia: "Quantas vezes, em média, a mesma pessoa viu os anúncios. Muito alta cansa o público.",
  ctr: "De cada 100 vezes que o anúncio apareceu, quantas viraram clique no link (taxa de cliques).",
  cobertura: "Quanto do que chegou à sua fonte de venda veio com o anúncio de origem. O que chega sem ele não aparece no desempenho dos anúncios.",
  atribuicao: "Como o sistema ligou o cadastro a um anúncio: pelo último anúncio clicado antes de se cadastrar, ou pelo primeiro.",
} as const;

export type IdTermo = keyof typeof GLOSSARIO;
