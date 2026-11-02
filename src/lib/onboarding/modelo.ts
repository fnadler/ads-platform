// Assistente de configuração, funções puras: quais telas cada negócio vê e o que falta. Nenhuma tela é marcada à
// mão: "feito" vem dos fatos que o sistema confere, então um token removido volta a aparecer como pendente.
import { z } from "zod";

export const RespostasNegocio = z.object({
  plataforma: z.enum(["hotmart", "kiwify", "stripe", "outra"], "Escolha onde a venda acontece."),
  funil: z.enum(["cadastro_teste_venda", "cadastro_venda", "venda_direta"], "Escolha como é a sua venda."),
  site: z.enum(["dev", "eu", "naosei"], "Escolha quem cuida do site."),
  campanhas: z.enum(["sim", "nao"], "Escolha se quer criar campanhas por aqui."),
});
export type RespostasNegocio = z.infer<typeof RespostasNegocio>;

export interface ResultadoPagina {
  url: string;
  status: "ok" | "aviso" | "erro";
  itens: Array<{ tom: "ok" | "alerta" | "erro"; titulo: string; detalhe: string }>;
  em: string;
}
export interface Onboarding extends Partial<RespostasNegocio> {
  destino?: "checkout" | "pagina";
  pagina?: ResultadoPagina;
  concluido_em?: string;
}

export interface Fatos {
  onboarding: Onboarding;
  temToken: boolean;
  temPublicacao: boolean;
  contaAtiva: boolean;
  pixelId: string | null;
  paginaFacebookId: string | null;
  stripeAtivo: boolean;
  webhookAtivo: boolean;
  plataformaAtiva: boolean;
  plataformaEmTeste: boolean;
  eventosPlataforma: number;
  eventoComAnuncio: boolean;
  testeLeadOk: boolean;
}

export const ETAPAS = ["Seu negócio", "Meta", "Página de destino", "Fonte de venda", "Teste completo", "Pronto"] as const;

export type IdTela =
  "negocio" | "meta-acesso" | "meta-usuario" | "meta-ativos" | "meta-app" | "meta-token" | "meta-escolhas" | "pagina" | "parametros" | "venda" | "teste" | "pronto";
export interface Tela {
  id: IdTela;
  etapa: number;
  titulo: string;
  feito: boolean;
  /** Só orienta: não conta como pendência (a conferência acontece em outra tela). */
  informativa?: boolean;
}

export const usaCheckoutExterno = (o: Onboarding) => o.plataforma === "hotmart" || o.plataforma === "kiwify";
export const paginaFeita = (o: Onboarding) => (usaCheckoutExterno(o) && o.destino === "checkout") || o.pagina?.status === "ok" || o.pagina?.status === "aviso";

export function telas(f: Fatos): Tela[] {
  const o = f.onboarding;
  const campanhas = o.campanhas === "sim";
  const escolhas = f.contaAtiva && !!f.pixelId && (!campanhas || (f.temPublicacao && !!f.paginaFacebookId));
  const venda = usaCheckoutExterno(o) ? f.plataformaAtiva && f.eventosPlataforma > 0 : o.plataforma === "stripe" ? f.stripeAtivo : f.webhookAtivo;
  const teste = usaCheckoutExterno(o) ? f.eventoComAnuncio : f.testeLeadOk;
  const lista: Tela[] = [
    { id: "negocio", etapa: 1, titulo: "Quatro perguntas", feito: !!RespostasNegocio.safeParse(o).success },
    { id: "meta-acesso", etapa: 2, titulo: "Acesso à Meta", feito: f.temToken, informativa: true },
    { id: "meta-usuario", etapa: 2, titulo: "Usuário do sistema", feito: f.temToken, informativa: true },
    { id: "meta-ativos", etapa: 2, titulo: "Acesso aos ativos", feito: f.temToken, informativa: true },
    { id: "meta-app", etapa: 2, titulo: "App da Meta", feito: f.temToken, informativa: true },
    { id: "meta-token", etapa: 2, titulo: "Token", feito: f.temToken },
    { id: "meta-escolhas", etapa: 2, titulo: "Conta e pixel", feito: escolhas },
    { id: "pagina", etapa: 3, titulo: "Conferir a página", feito: paginaFeita(o) },
  ];
  if (!campanhas) lista.push({ id: "parametros", etapa: 3, titulo: "Parâmetros nos anúncios", feito: paginaFeita(o), informativa: true });
  lista.push({
    id: "venda",
    etapa: 4,
    titulo:
      o.plataforma === "hotmart" ? "Conectar a Hotmart" : o.plataforma === "kiwify" ? "Conectar a Kiwify" : o.plataforma === "stripe" ? "Conectar a Stripe" : "Enviar as vendas",
    feito: venda,
  });
  lista.push({ id: "teste", etapa: 5, titulo: usaCheckoutExterno(o) ? "Compra de teste" : "Cadastro de teste", feito: teste });
  lista.push({ id: "pronto", etapa: 6, titulo: "Resumo", feito: false, informativa: true });
  return lista;
}

/** O que ainda falta; as telas que só orientam não contam. */
export const pendentes = (f: Fatos) => telas(f).filter((t) => !t.feito && !t.informativa);

/** Tela onde a pessoa retoma: a primeira do grupo que falta (antes do token, o começo do passo a passo da Meta). */
export function telaInicial(f: Fatos): IdTela {
  const p = pendentes(f)[0];
  if (!p) return "pronto";
  return p.id === "meta-token" ? "meta-acesso" : p.id;
}

export const progresso = (f: Fatos) => {
  const contam = telas(f).filter((t) => !t.informativa);
  return Math.round((contam.filter((t) => t.feito).length / contam.length) * 100);
};

export const ehIdTela = (f: Fatos, id: unknown): id is IdTela => telas(f).some((t) => t.id === id);

/** Permissões que o token precisa ter: um token só, para ler e, se a pessoa quiser, criar campanhas. */
export const permissoesDoToken = (campanhas: boolean) => (campanhas ? ["ads_management", "ads_read", "pages_show_list", "pages_read_engagement", "instagram_basic"] : ["ads_read"]);

/** Plano sugerido a partir da plataforma: infoproduto costuma ir direto ao checkout. */
export const funilSugerido = (plataforma?: string) => (plataforma === "stripe" ? "cadastro_teste_venda" : plataforma === "outra" ? "cadastro_venda" : "venda_direta");

export interface ResumoEtapa {
  etapa: number;
  nome: string;
  feita: boolean;
  detalhe: string;
  /** Onde a pessoa retoma: a primeira tela que falta na etapa, ou o começo dela para rever. */
  tela: IdTela;
  /** Etapa concluída, mas com algo a resolver (a plataforma ainda não conta as vendas). */
  alerta?: string;
}

const ROTULO_PLATAFORMA: Record<string, string> = { hotmart: "Hotmart", kiwify: "Kiwify", stripe: "Stripe", outra: "Webhook ou planilha" };

/** As etapas para a tela Início (o resumo final não entra: ele é o fim do assistente). */
export function resumoEtapas(f: Fatos): ResumoEtapa[] {
  const lista = telas(f);
  const o = f.onboarding;
  const quandoFeita: Record<number, string> = {
    1: `Venda em ${ROTULO_PLATAFORMA[String(o.plataforma)] ?? "—"}`,
    2: "Token, conta e pixel conferidos",
    3: usaCheckoutExterno(o) && o.destino === "checkout" ? "O anúncio leva direto ao checkout" : (o.pagina?.url ?? "Página conferida"),
    4: `${ROTULO_PLATAFORMA[String(o.plataforma)] ?? "Fonte de venda"} conectada`,
    5: "A origem do anúncio chegou até o sistema",
  };
  return ETAPAS.slice(0, 5).map((nome, n) => {
    const etapa = n + 1;
    const grupo = lista.filter((t) => t.etapa === etapa);
    const falta = grupo.find((t) => !t.feito && !t.informativa);
    const retomar: IdTela | undefined = falta?.id === "meta-token" ? "meta-acesso" : falta?.id;
    return {
      etapa,
      nome,
      feita: !falta,
      detalhe: falta ? `Falta: ${falta.titulo}` : quandoFeita[etapa],
      tela: retomar ?? grupo[0].id,
      alerta: etapa === 4 && !falta && usaCheckoutExterno(o) && f.plataformaEmTeste ? "Em modo de teste: as vendas ainda não entram nos números" : undefined,
    };
  });
}
