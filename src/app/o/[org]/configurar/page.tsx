import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Copiavel, Formulario } from "@/components/Formulario";
import { IconeCheck, IconeExterno, IconeSeta, IconeVoltar } from "@/components/Icones";
import { Aviso, BotaoLink, Campo, Cartao, Etiqueta, Selecao, Tabela, Titulo, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { alterarConta } from "@/lib/conexoes/acoes";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { dataHora } from "@/lib/formato";
import { lerPrerequisitos, type Prerequisitos } from "@/lib/integracoes/metaEscrita";
import { conectarToken, concluirOnboarding, conferirPagina, iniciarTesteCadastro, salvarDestino, salvarEscolhas, salvarNegocio } from "@/lib/onboarding/acoes";
import { lerFatos } from "@/lib/onboarding/fatos";
import {
  ehIdTela,
  ETAPAS,
  funilSugerido,
  paginaFeita,
  pendentes,
  permissoesDoToken,
  progresso,
  telaInicial,
  telas,
  usaCheckoutExterno,
  type IdTela,
  type Onboarding,
} from "@/lib/onboarding/modelo";
import { verificarAgora } from "@/lib/rastreio/acoes";
import { PARAMETROS_META, type ResultadoCampo } from "@/lib/rastreio/regras";
import { rotaOrg } from "@/lib/rotas";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { urlSistema } from "@/lib/url";
import { FUNIS, PLATAFORMAS_VENDA, SCRIPT_CHECKOUT, type TipoPlataforma } from "@/lib/vendas/plataformas/catalogo";
import { CartaoPlataforma } from "../configuracoes/CartaoPlataforma";
import { CartaoStripe, CartaoWebhook, type ConexaoFonte } from "../configuracoes/CartoesFonte";
import { MensagemPronta } from "./MensagemPronta";

export const metadata: Metadata = { title: "Configuração" };

const LINKS_META = {
  portfolio: "https://business.facebook.com/settings",
  usuarios: "https://business.facebook.com/settings/system-users",
  apps: "https://developers.facebook.com/apps",
};

function LinkExterno({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-[550] text-ink no-underline hover:bg-surface-2 hover:no-underline"
    >
      {children} <IconeExterno tamanho={15} />
    </a>
  );
}

function Passos({ itens }: { itens: Array<[ReactNode, ReactNode?]> }) {
  return (
    <ol className="flex flex-col gap-3.5">
      {itens.map(([titulo, nota], i) => (
        <li key={i} className="grid grid-cols-[28px_1fr] gap-2.5 text-sm">
          <span className="grid size-[26px] place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{i + 1}</span>
          <span className="min-w-0">
            <span className="text-ink">{titulo}</span>
            {nota && <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{nota}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function GrupoOpcoes({ legenda, name, valor, opcoes }: { legenda: string; name: string; valor?: string; opcoes: Array<[string, string, string?]> }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2.5 text-sm font-semibold text-ink">{legenda}</legend>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        {opcoes.map(([v, rotulo, nota]) => (
          <label
            key={v}
            className="flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm font-[550] text-ink hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:ring-1 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input type="radio" name={name} value={v} defaultChecked={valor === v} required className="sr-only" />
            {rotulo}
            {nota && <small className="text-xs font-normal leading-4 text-ink-2">{nota}</small>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const TOM_ITEM: Record<string, Tom> = { ok: "ok", alerta: "alerta", erro: "erro" };
const ROTULO_ITEM: Record<string, string> = { ok: "OK", alerta: "Atenção", erro: "Corrigir" };

export default async function Configurar({ params, searchParams }: PageProps<"/o/[org]/configurar">) {
  const { org: slug } = await params;
  const busca = await searchParams;
  const { org, papel, supabase } = await exigirOrganizacao(slug, "gestor");
  const dono = papel === "dono";
  const gestor = temPapel(papel, "gestor");
  const o: Onboarding = org.onboarding ?? {};
  const fatos = await lerFatos(supabase, org.id, o);
  const lista = telas(fatos);
  const id: IdTela = ehIdTela(fatos, busca.tela) ? (busca.tela as IdTela) : telaInicial(fatos);
  const tela = lista.find((t) => t.id === id)!;
  const i = lista.indexOf(tela);
  const anterior = lista[i - 1];
  const proxima = lista[i + 1];
  const pct = progresso(fatos);
  const link = (t: IdTela) => rotaOrg(slug, `/configurar?tela=${t}`);
  const campanhas = o.campanhas === "sim";
  const plataforma = usaCheckoutExterno(o) ? (o.plataforma as TipoPlataforma) : null;
  const base = await urlSistema();
  const hidden = (
    <>
      <input type="hidden" name="organizacao_id" value={org.id} />
      <input type="hidden" name="slug" value={slug} />
    </>
  );
  const respostas = !!o.plataforma;
  const avisoDono = !dono && <Aviso tom="alerta">Só o dono da organização pode conectar contas. Use o botão abaixo para enviar a instrução a ele.</Aviso>;

  const msgMeta = `Oi! Estou configurando o Adverdad e preciso de ajuda no portfólio empresarial da Meta.

Precisamos de um usuário do sistema com acesso à conta de anúncios${campanhas ? ", à Página, ao Instagram e ao conjunto de dados" : ""}, e de um token com estas permissões: ${permissoesDoToken(campanhas).join(", ")}.

O passo a passo está aqui: ${base}${link("meta-acesso")}

Você pode fazer tudo por esse link, se tiver acesso à organização. Não me envie o token por mensagem.`;
  const msgSiteCheckout = `Oi! Preciso instalar o rastreio de vendas do Adverdad no site. É uma linha, antes de </body>, nas páginas que têm o botão de compra:

${SCRIPT_CHECKOUT}

Ela leva os parâmetros do anúncio (sck, src e utm) da URL da página até os links da Hotmart ou da Kiwify. Quando terminar, me avise para eu conferir no sistema.`;
  const msgSiteCadastro = `Oi! Precisamos enviar cada cadastro do site para o Adverdad, com a origem do anúncio.

1. Na chegada, guarde em cookie os parâmetros da URL: utm_source, utm_medium, utm_campaign, utm_content, utm_campaign_id, utm_adset_id e utm_ad_id.
2. Depois do cadastro, envie do servidor:

POST ${base}/api/webhook/eventos
Authorization: Bearer (token gerado no sistema, compartilhado por canal seguro)

{ "tipo": "lead", "id_externo": "id-do-cliente", "email": "cliente@exemplo.com", "atribuicao": { "utm_source": "meta", "utm_campaign_id": "...", "utm_adset_id": "...", "utm_ad_id": "..." } }

O formato completo está em Configurações, no cartão Webhook genérico.`;

  let conteudo: { h: string; d: string; corpo: ReactNode; lateral?: ReactNode; bloqueia?: boolean };

  switch (id) {
    case "negocio":
      conteudo = {
        h: "Conte como você vende",
        d: "Com estas respostas, mostramos só os passos que fazem sentido para você.",
        corpo: (
          <Cartao>
            <Formulario acao={salvarNegocio} rotulo="Continuar" variante="peso" className="flex flex-col gap-6">
              {hidden}
              <GrupoOpcoes
                legenda="Onde a venda acontece?"
                name="plataforma"
                valor={o.plataforma}
                opcoes={[
                  ["hotmart", "Hotmart"],
                  ["kiwify", "Kiwify"],
                  ["stripe", "Stripe"],
                  ["outra", "Outra plataforma", "Conecta por webhook ou planilha"],
                ]}
              />
              <GrupoOpcoes
                legenda="Como é a sua venda?"
                name="funil"
                valor={o.funil ?? (o.plataforma ? funilSugerido(o.plataforma) : undefined)}
                opcoes={Object.entries(FUNIS).map(([k, f]) => [k, f.rotulo, f.descricao])}
              />
              <GrupoOpcoes
                legenda="Quem cuida do seu site?"
                name="site"
                valor={o.site}
                opcoes={[
                  ["dev", "Um programador"],
                  ["eu", "Eu mesmo", "WordPress ou construtor de páginas"],
                  ["naosei", "Não sei"],
                ]}
              />
              <GrupoOpcoes
                legenda="Quer criar campanhas pelo Adverdad?"
                name="campanhas"
                valor={o.campanhas}
                opcoes={[
                  ["sim", "Sim", "Ler resultados e criar campanhas"],
                  ["nao", "Só acompanhar", "Só ler resultados da Meta"],
                ]}
              />
            </Formulario>
          </Cartao>
        ),
        lateral: (
          <Cartao titulo="O que vem depois">
            <p className="text-sm text-ink-2">
              Meta, página de destino, fonte de venda e um teste completo. Cada passo é conferido pelo sistema, e você pode parar e voltar quando quiser.
            </p>
          </Cartao>
        ),
      };
      break;

    case "meta-acesso":
      conteudo = {
        h: "Você administra o portfólio da Meta?",
        d: "Portfólio empresarial é o espaço da Meta que reúne suas contas de anúncios, Páginas e pixels. Antes ele se chamava Business Manager.",
        corpo: (
          <Cartao>
            <div className="flex flex-col gap-4">
              <Passos
                itens={[
                  ["Abra as configurações do portfólio.", "Se aparecer mais de um, escolha o da conta que paga os anúncios."],
                  ["Veja se o menu Usuários aparece.", "Se aparecer, você tem o acesso necessário."],
                ]}
              />
              <div>
                <LinkExterno href={LINKS_META.portfolio}>Abrir na Meta</LinkExterno>
              </div>
              <MensagemPronta para="quem administra a Meta" texto={msgMeta} />
            </div>
          </Cartao>
        ),
        lateral: (
          <Cartao titulo="Dúvidas comuns">
            <p className="text-sm text-ink-2">
              <strong className="text-ink">Não tenho portfólio.</strong> Crie um em business.facebook.com. Isso não muda seus anúncios.
            </p>
          </Cartao>
        ),
      };
      break;

    case "meta-usuario":
      conteudo = {
        h: "Crie um usuário para o Adverdad",
        d: "O usuário do sistema é um acesso próprio para integrações. Ele não depende da sua senha e continua funcionando se alguém sair da empresa.",
        corpo: (
          <>
            <Cartao>
              <div className="flex flex-col gap-4">
                <Passos
                  itens={[
                    ["Clique em Adicionar."],
                    ["Dê o nome “Adverdad”."],
                    ["Escolha a função Funcionário.", "É a função com menos acesso. A conta de anúncios você libera no próximo passo."],
                  ]}
                />
                <div>
                  <LinkExterno href={LINKS_META.usuarios}>Abrir Usuários do sistema</LinkExterno>
                </div>
                <MensagemPronta para="quem administra a Meta" texto={msgMeta} />
              </div>
            </Cartao>
            <Aviso>Este passo é conferido junto com o token: a Meta não informa se o usuário existe antes disso.</Aviso>
          </>
        ),
      };
      break;

    case "meta-ativos":
      conteudo = {
        h: campanhas ? "Dê acesso à conta, à Página e ao Instagram" : "Dê acesso à conta de anúncios",
        d: "Na página do usuário Adverdad, clique em Atribuir ativos.",
        corpo: (
          <Cartao>
            <div className="flex flex-col gap-4">
              <Passos
                itens={[
                  [`Conta de anúncios: ligue “${campanhas ? "Gerenciar campanhas" : "Ver desempenho"}”.`],
                  ...(campanhas
                    ? ([
                        ["Página do Facebook: dê acesso à Página da marca."],
                        ["Conta do Instagram: dê acesso à conta da marca.", "O Instagram precisa estar vinculado à Página."],
                        ["Conjunto de dados (pixel): dê acesso ao pixel do site."],
                      ] as Array<[ReactNode]>)
                    : []),
                ]}
              />
              <div>
                <LinkExterno href={LINKS_META.usuarios}>Abrir Atribuir ativos</LinkExterno>
              </div>
              <MensagemPronta para="quem administra a Meta" texto={msgMeta} />
            </div>
          </Cartao>
        ),
        lateral: (
          <Cartao titulo="Dúvidas comuns">
            <div className="flex flex-col gap-3 text-sm text-ink-2">
              <p>
                <strong className="text-ink">A conta não aparece.</strong> Ela precisa pertencer a este portfólio ou ter sido compartilhada com ele.
              </p>
              {campanhas && (
                <p>
                  <strong className="text-ink">O Instagram não aparece.</strong> Nas configurações da Página, em Contas vinculadas, conecte o Instagram. Depois, adicione-o ao
                  portfólio.
                </p>
              )}
            </div>
          </Cartao>
        ),
      };
      break;

    case "meta-app":
      conteudo = {
        h: campanhas ? "Crie e publique um app da Meta" : "Crie um app da Meta",
        d: "A Meta só gera tokens ligados a um app. Você não vai programar nada: ele é só um cadastro.",
        corpo: (
          <Cartao>
            <div className="flex flex-col gap-4">
              <Passos
                itens={[
                  ["Clique em Criar app e escolha o tipo Empresa.", "Se já tiver um app da sua empresa, pode usar o mesmo."],
                  ["Vincule ao seu portfólio."],
                  ...(campanhas
                    ? ([["Publique o app.", "Sem publicar, a Meta recusa a criação de anúncios. Ela pede uma política de privacidade: use a do seu site."]] as Array<
                        [ReactNode, ReactNode]
                      >)
                    : []),
                ]}
              />
              <div>
                <LinkExterno href={LINKS_META.apps}>Abrir Meus apps</LinkExterno>
              </div>
              <MensagemPronta para="quem administra a Meta" texto={msgMeta} />
            </div>
          </Cartao>
        ),
      };
      break;

    case "meta-token":
      conteudo = {
        h: fatos.temToken ? "Meta conectada" : "Gere o token e cole aqui",
        d: "O token é a chave que permite ao Adverdad acessar a Meta. Ele é conferido na hora e guardado cifrado.",
        bloqueia: !fatos.temToken,
        corpo: (
          <>
            {fatos.temToken && <Aviso tom="ok">O token está conectado. Para trocar, gere outro e cole abaixo.</Aviso>}
            {avisoDono}
            <Cartao>
              <div className="flex flex-col gap-5">
                <Passos
                  itens={[
                    ["No usuário Adverdad, clique em Gerar novo token e escolha o app."],
                    ["Em validade, escolha Nunca."],
                    [
                      "Marque estas permissões:",
                      <span key="p" className="mt-1.5 flex flex-wrap gap-1.5">
                        {permissoesDoToken(campanhas).map((p) => (
                          <code key={p} className="rounded-sm bg-sunken px-2 py-0.5 font-mono text-xs text-ink">
                            {p}
                          </code>
                        ))}
                      </span>,
                    ],
                    ["Copie o token e cole abaixo.", "A Meta só mostra o token uma vez."],
                  ]}
                />
                {dono && (
                  <Formulario acao={conectarToken} rotulo="Verificar token">
                    {hidden}
                    <Campo rotulo="Token" name="token" type="password" autoComplete="off" placeholder="EAA…" required />
                    <Campo
                      rotulo="ID da conta de anúncios (opcional)"
                      name="contas"
                      autoComplete="off"
                      placeholder="act_1234567890"
                      ajuda="Use só se a conta não aparecer sozinha. Está na URL do Gerenciador de Anúncios (act=…)."
                    />
                  </Formulario>
                )}
                <MensagemPronta para="quem administra a Meta" texto={msgMeta} />
              </div>
            </Cartao>
          </>
        ),
        lateral: (
          <Cartao titulo="Se der erro">
            <div className="flex flex-col gap-3 text-sm text-ink-2">
              <p>
                <strong className="text-ink">Nenhuma conta encontrada.</strong> Falta dar acesso em <Link href={link("meta-ativos")}>Acesso aos ativos</Link>.
              </p>
              <p>
                <strong className="text-ink">Falta permissão.</strong> O token não ganha permissões depois: gere outro com todas marcadas.
              </p>
            </div>
          </Cartao>
        ),
      };
      break;

    case "meta-escolhas": {
      const admin = criarClienteAdmin();
      const { data: contas } = await supabase.from("contas_anuncio").select("account_id, nome, moeda, fuso, ativa").eq("organizacao_id", org.id).order("nome");
      const contaAtiva = contas?.find((c) => c.ativa);
      const { data: leitura } = await supabase.from("conexoes").select("id").eq("organizacao_id", org.id).eq("tipo", "meta").maybeSingle();
      const { data: config } = await supabase.from("config_publicacao").select("*").eq("organizacao_id", org.id).maybeSingle();
      let p: Prerequisitos | null = null;
      let erroLeitura = "";
      if (contaAtiva && leitura) {
        const segredo = await lerSegredo<SegredoMeta>(admin, org.id, leitura.id);
        if (segredo)
          try {
            p = await lerPrerequisitos(segredo.token, contaAtiva.account_id);
          } catch (e) {
            erroLeitura = (e as Error).message;
          }
      }
      const opcao = (x?: string | null, n?: string | null) => (x ? `${x}|${n ?? ""}` : "");
      conteudo = {
        h: "Confirme o que vamos usar",
        d: "Estas opções vieram da sua conta na Meta.",
        bloqueia: !lista.find((t) => t.id === "meta-escolhas")!.feito,
        corpo: !fatos.temToken ? (
          <Aviso tom="alerta">
            Conecte o token primeiro. <Link href={link("meta-token")}>Voltar para Token</Link>
          </Aviso>
        ) : !contaAtiva ? (
          <Cartao titulo="Qual conta de anúncios?">
            <div className="flex flex-col gap-3">
              {contas?.map((c) => (
                <Formulario
                  key={c.account_id}
                  acao={alterarConta}
                  rotulo={`Usar ${c.nome}`}
                  variante="secundario"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3"
                >
                  <input type="hidden" name="organizacao_id" value={org.id} />
                  <input type="hidden" name="account_id" value={c.account_id} />
                  <input type="hidden" name="ativa" value="sim" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-ink">{c.nome}</span>
                    <span className="block text-xs text-ink-2">
                      {c.moeda} · {c.fuso} · <code className="font-mono">{c.account_id}</code>
                    </span>
                  </span>
                </Formulario>
              ))}
            </div>
          </Cartao>
        ) : (
          <>
            {erroLeitura && <Aviso tom="erro">Não consegui ler sua conta na Meta: {erroLeitura}</Aviso>}
            {avisoDono}
            <Aviso tom="ok">
              Conta <strong>{contaAtiva.nome}</strong> ligada. O histórico está carregando em segundo plano, e você pode continuar sem esperar.
            </Aviso>
            {dono && p && (
              <Cartao>
                <Formulario acao={salvarEscolhas} rotulo="Salvar e continuar" variante="peso" className="flex flex-col gap-4">
                  {hidden}
                  <Selecao rotulo="Pixel do seu site" name="pixel" defaultValue={opcao(config?.pixel_id, config?.pixel_nome)} required>
                    <option value="">Escolha…</option>
                    {p.pixels.map((x) => (
                      <option key={x.id} value={opcao(x.id, x.nome)}>
                        {x.nome} ({x.id}) · {x.ultimoEvento ? `último evento em ${dataHora(x.ultimoEvento, org.fuso)}` : "sem eventos"}
                      </option>
                    ))}
                  </Selecao>
                  {!p.pixels.length && <Aviso tom="alerta">Nenhum pixel apareceu. Crie um conjunto de dados no Gerenciador de Eventos e dê acesso ao usuário Adverdad.</Aviso>}
                  {campanhas && (
                    <>
                      <Selecao rotulo="Página do Facebook" name="page" defaultValue={opcao(config?.page_id, config?.page_nome)} required>
                        <option value="">Escolha…</option>
                        {p.paginas.map((x) => (
                          <option key={x.id} value={opcao(x.id, x.nome)}>
                            {x.nome}
                          </option>
                        ))}
                      </Selecao>
                      <Selecao rotulo="Conta do Instagram" name="instagram" defaultValue={opcao(config?.instagram_user_id, config?.instagram_nome)}>
                        <option value="">Sem Instagram</option>
                        {p.instagram.map((x) => (
                          <option key={x.id} value={opcao(x.id, x.nome)}>
                            {x.nome}
                          </option>
                        ))}
                      </Selecao>
                      <Campo
                        rotulo="Teto de verba diária por campanha (R$)"
                        name="teto_verba_diaria"
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={Number(config?.teto_verba_diaria ?? 100)}
                        required
                        ajuda="O sistema não cria campanha acima deste valor."
                      />
                      {!p.paginas.length && <Aviso tom="alerta">Nenhuma Página apareceu. Confira em Acesso aos ativos se o usuário Adverdad tem acesso a ela.</Aviso>}
                    </>
                  )}
                </Formulario>
              </Cartao>
            )}
          </>
        ),
        lateral: (
          <Cartao titulo="Mais de um pixel?">
            <p className="text-sm text-ink-2">Contas antigas costumam ter vários. Mostramos a data do último evento de cada um para ajudar a escolher o que está em uso.</p>
          </Cartao>
        ),
      };
      break;
    }

    case "pagina": {
      const r = o.pagina;
      const escolheDestino = !!plataforma && !o.destino;
      const irDireto = !!plataforma && o.destino === "checkout";
      conteudo = {
        h: escolheDestino ? "Para onde o anúncio leva?" : irDireto ? "Sem página para conferir" : "Vamos conferir sua página",
        d: escolheDestino
          ? "Isso define se há algo para instalar."
          : irDireto
            ? "O anúncio leva direto ao checkout, então os parâmetros já chegam à compra."
            : "Informe a página para onde os anúncios levam. O Adverdad abre essa página e procura o que precisa estar nela.",
        bloqueia: !paginaFeita(o),
        corpo: escolheDestino ? (
          <Cartao>
            <Formulario acao={salvarDestino} rotulo="Continuar" variante="peso" className="flex flex-col gap-5">
              {hidden}
              <GrupoOpcoes
                legenda="O clique no anúncio abre:"
                name="destino"
                opcoes={[
                  ["checkout", "O checkout", `Direto no link de compra da ${PLATAFORMAS_VENDA[plataforma!].rotulo}`],
                  ["pagina", "Uma página de vendas", "Página própria, com botão de compra"],
                ]}
              />
            </Formulario>
          </Cartao>
        ) : irDireto ? (
          <>
            <Aviso tom="ok">Nada para instalar. Se a plataforma tiver um pixel, configure o mesmo que você escolheu na Meta.</Aviso>
            <Formulario acao={salvarDestino} rotulo="Tenho uma página antes do checkout" variante="fantasma">
              {hidden}
              <input type="hidden" name="destino" value="pagina" />
            </Formulario>
          </>
        ) : (
          <>
            {plataforma ? (
              <Cartao
                titulo={o.site === "eu" ? "Cole esta linha na página" : "Esta linha precisa estar na página"}
                descricao="Ela leva os parâmetros do anúncio até o link de compra. Cole antes de </body>, ou como HTML personalizado no seu construtor de páginas."
              >
                <div className="flex flex-col gap-3">
                  <Copiavel valor={SCRIPT_CHECKOUT} />
                  <MensagemPronta para="quem cuida do site" texto={msgSiteCheckout} />
                </div>
              </Cartao>
            ) : (
              <Cartao
                titulo="Os cadastros precisam chegar ao Adverdad"
                descricao="O site guarda a origem do anúncio e envia cada cadastro por webhook. Isso pede um programador por enquanto."
              >
                <MensagemPronta para="o programador" texto={msgSiteCadastro} />
              </Cartao>
            )}
            <Cartao>
              <div className="flex flex-col gap-4">
                <Formulario acao={conferirPagina} rotulo="Conferir a página">
                  {hidden}
                  <Campo rotulo="Endereço da página" name="url" inputMode="url" defaultValue={r?.url ?? ""} placeholder="https://www.sualoja.com.br/pagina" required />
                </Formulario>
                {r && (
                  <div className="flex flex-col gap-2.5 border-t border-line pt-4">
                    {r.itens.map((x) => (
                      <div key={x.titulo} className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                          <Etiqueta tom={TOM_ITEM[x.tom]}>{ROTULO_ITEM[x.tom]}</Etiqueta> {x.titulo}
                        </span>
                        <span className="text-xs text-ink-2 [overflow-wrap:anywhere]">{x.detalhe}</span>
                      </div>
                    ))}
                    <span className="text-xs text-ink-3">Conferido em {dataHora(r.em, org.fuso)}</span>
                  </div>
                )}
              </div>
            </Cartao>
            {plataforma && (
              <Formulario acao={salvarDestino} rotulo="O anúncio leva direto ao checkout" variante="fantasma">
                {hidden}
                <input type="hidden" name="destino" value="checkout" />
              </Formulario>
            )}
          </>
        ),
        lateral: !escolheDestino && !irDireto && (
          <Cartao titulo="O que é conferido">
            <p className="text-sm text-ink-2">
              Se a página abre, se {plataforma ? "a linha de rastreio está nela e se " : ""}o pixel é o mesmo que você escolheu na Meta. Pixel no Google Tag Manager só aparece no
              navegador: nesse caso, mostramos um aviso e você pode seguir.
            </p>
          </Cartao>
        ),
      };
      break;
    }

    case "parametros":
      conteudo = {
        h: "Cole os parâmetros nos seus anúncios",
        d: "Como você cria as campanhas na Meta, cada anúncio precisa deste texto. É ele que diz de qual anúncio veio cada clique.",
        corpo: (
          <>
            <Cartao>
              <div className="flex flex-col gap-4">
                <Copiavel valor={PARAMETROS_META} />
                <Passos
                  itens={[
                    ["Abra o anúncio no Gerenciador."],
                    ["Em Destino, procure Parâmetros de URL."],
                    ["Cole o texto e publique.", "Configure um anúncio e duplique a partir dele."],
                  ]}
                />
              </div>
            </Cartao>
            <Aviso>
              A tela <Link href={rotaOrg(slug, "/rastreio")}>Rastreio</Link> aponta qualquer anúncio ativo sem esses parâmetros.
            </Aviso>
          </>
        ),
      };
      break;

    case "venda":
      conteudo = {
        h: plataforma ? `Conecte a ${PLATAFORMAS_VENDA[plataforma].rotulo}` : o.plataforma === "stripe" ? "Conecte a Stripe" : "Como suas vendas vão chegar?",
        d: plataforma
          ? "Siga os passos do cartão e envie um evento de teste pela plataforma."
          : o.plataforma === "stripe"
            ? "Com a chave e o webhook, faturas viram vendas e assinaturas em teste marcam o lead."
            : "Sua plataforma ou programador envia cada venda por webhook. Para começar, também dá para importar uma planilha em Leads e vendas.",
        bloqueia: !lista.find((t) => t.id === "venda")!.feito,
        corpo: plataforma ? (
          <CartaoPlataforma tipo={plataforma} conexao={fatos.conexaoPlataforma} eventos={fatos.eventos.slice(0, 5)} base={base} orgId={org.id} dono={dono} fuso={org.fuso} />
        ) : o.plataforma === "stripe" ? (
          <CartaoStripe stripe={await lerFonte("stripe")} base={base} orgId={org.id} dono={dono} gestor={gestor} />
        ) : (
          <CartaoWebhook webhook={await lerFonte("webhook")} base={base} orgId={org.id} dono={dono} />
        ),
      };
      break;

    case "teste": {
      const { data: verificacao } = plataforma
        ? { data: null }
        : await supabase.from("verificacoes_rastreio").select("*").eq("organizacao_id", org.id).order("criado_em", { ascending: false }).limit(1).maybeSingle();
      conteudo = {
        h: plataforma ? "Faça uma compra de teste" : "Faça um cadastro de teste",
        d: plataforma
          ? "É ela que mostra se a venda chega com o anúncio de origem. O botão de teste da plataforma não traz essa informação."
          : "Vamos simular um clique em anúncio para ver se o lead chega com a origem certa. Ele não entra nos seus números.",
        bloqueia: !lista.find((t) => t.id === "teste")!.feito,
        corpo: plataforma ? (
          <>
            <Cartao>
              <div className="flex flex-col gap-4">
                <Passos
                  itens={[
                    [
                      <>
                        Abra {o.destino === "pagina" ? "a sua página" : `o link de compra da ${PLATAFORMAS_VENDA[plataforma].rotulo}`} acrescentando{" "}
                        <code className="font-mono text-xs">?sck=120000000000000</code> no fim do endereço.
                      </>,
                      "Se o endereço já tiver um “?”, use &sck=120000000000000.",
                    ],
                    ["Faça a compra de um produto seu.", "Pix ou boleto aparecem como aguardando pagamento. Depois, você pode pedir o reembolso."],
                    ["Veja abaixo se o anúncio apareceu como 120000000000000."],
                  ]}
                />
                {fatos.eventoComAnuncio ? (
                  <Aviso tom="ok">Chegou um evento com o anúncio de origem. O rastreio está funcionando.</Aviso>
                ) : (
                  <Aviso tom="alerta">Ainda não chegou nenhum evento com o anúncio de origem. Esta tela atualiza quando você recarrega.</Aviso>
                )}
              </div>
            </Cartao>
            <CartaoPlataforma tipo={plataforma} conexao={fatos.conexaoPlataforma} eventos={fatos.eventos.slice(0, 5)} base={base} orgId={org.id} dono={dono} fuso={org.fuso} />
          </>
        ) : (
          <Cartao>
            {!verificacao ? (
              <Formulario acao={iniciarTesteCadastro} rotulo="Criar o teste">
                {hidden}
              </Formulario>
            ) : (
              <div className="flex flex-col gap-4">
                <Passos
                  itens={[
                    [
                      "Abra este link em uma janela anônima:",
                      <span key="u" className="mt-1.5 block">
                        <Copiavel valor={verificacao.url_teste} />
                      </span>,
                    ],
                    [
                      "Cadastre-se com um e-mail que tenha este código:",
                      <span key="e" className="mt-1.5 block">
                        <Copiavel valor={`seuemail+rastreio-${verificacao.codigo}@gmail.com`} />
                      </span>,
                    ],
                    ["Se o site pedir confirmação por e-mail, confirme.", "Alguns sites só enviam o lead nesse momento."],
                  ]}
                />
                <Formulario acao={verificarAgora} rotulo="Verificar agora">
                  <input type="hidden" name="organizacao_id" value={org.id} />
                  <input type="hidden" name="id" value={verificacao.id} />
                </Formulario>
                {verificacao.resultado && (
                  <div className="overflow-hidden rounded-md border border-line">
                    <Tabela>
                      <thead>
                        <tr>
                          <th>Campo</th>
                          <th>Esperado</th>
                          <th>Recebido</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(verificacao.resultado as ResultadoCampo[]).map((c) => (
                          <tr key={c.campo}>
                            <td className="font-mono text-xs">{c.campo}</td>
                            <td className="font-mono text-xs">{c.esperado}</td>
                            <td className="font-mono text-xs">{c.recebido ?? "—"}</td>
                            <td className="text-xs">{c.ok ? <Etiqueta tom="ok">OK</Etiqueta> : <span className={c.alerta ? "text-warn" : "text-err"}>{c.correcao}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Tabela>
                  </div>
                )}
              </div>
            )}
          </Cartao>
        ),
        lateral: !plataforma && o.plataforma === "stripe" && (
          <Cartao titulo="E o pagamento?">
            <p className="text-sm text-ink-2">Ele não entra neste teste, para não gerar uma cobrança real. O primeiro evento real aparece em Leads e vendas.</p>
          </Cartao>
        ),
      };
      break;
    }

    default: {
      const faltam = pendentes(fatos);
      const emTeste = !!plataforma && fatos.plataformaAtiva && fatos.plataformaEmTeste;
      const linhas = lista.filter((t) => !t.informativa);
      conteudo = {
        h: faltam.length ? "Quase lá: veja o que falta" : "Tudo pronto: seus anúncios estão ligados às vendas",
        d: "Este resumo reflete o que o sistema conferiu agora.",
        corpo: (
          <>
            <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              {linhas.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 first:border-t-0">
                  <span className="text-sm font-medium text-ink">
                    {ETAPAS[t.etapa - 1]}
                    <span className="block text-xs font-normal text-ink-2">{t.titulo}</span>
                  </span>
                  {t.feito ? (
                    <Etiqueta tom="ok">Feito</Etiqueta>
                  ) : (
                    <Link href={link(t.id)} className="text-sm font-[550] text-accent-text">
                      Resolver
                    </Link>
                  )}
                </div>
              ))}
            </div>
            {emTeste && (
              <Aviso tom="alerta">
                A {PLATAFORMAS_VENDA[plataforma!].rotulo} ainda está em modo de teste: as vendas não entram nos números. Passe a contar em{" "}
                <Link href={link("venda")}>Fonte de venda</Link>.
              </Aviso>
            )}
            {o.funil === "cadastro_teste_venda" && (
              <Aviso>Com teste grátis, as primeiras vendas só aparecem depois do período de teste. Até lá, acompanhe cadastros, testes e cancelamentos.</Aviso>
            )}
            <div className="flex flex-wrap gap-3">
              <Formulario acao={concluirOnboarding} rotulo={campanhas ? "Criar a primeira campanha" : "Ver o Desempenho"} variante="peso">
                {hidden}
                <input type="hidden" name="destino" value={campanhas ? "/campanhas" : "/desempenho"} />
              </Formulario>
              <Formulario acao={concluirOnboarding} rotulo="Ir para o Início" variante="secundario">
                {hidden}
              </Formulario>
            </div>
          </>
        ),
      };
    }
  }

  async function lerFonte(tipo: string) {
    const { data } = await supabase.from("conexoes").select("id, status, ultimo_erro, config").eq("organizacao_id", org.id).eq("tipo", tipo).maybeSingle();
    return (data ?? undefined) as ConexaoFonte | undefined;
  }

  const etapaAtual = tela.etapa;
  const avancarComo = conteudo.bloqueia ? "Continuar sem isso por agora" : "Continuar";

  return (
    <>
      <Titulo sobrancelha={`Configuração · etapa ${etapaAtual} de ${ETAPAS.length} · ${pct}% concluído`} descricao={conteudo.d}>
        {conteudo.h}
      </Titulo>
      <div className="grid items-start gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Etapas da configuração" className="flex flex-col gap-1 max-lg:hidden">
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
          </div>
          {ETAPAS.map((nome, n) => {
            const doGrupo = lista.filter((t) => t.etapa === n + 1);
            const contam = doGrupo.filter((t) => !t.informativa);
            const feita = contam.length > 0 && contam.every((t) => t.feito);
            const atual = etapaAtual === n + 1;
            return (
              <div key={nome}>
                <Link
                  href={link(doGrupo[0].id)}
                  aria-current={atual ? "step" : undefined}
                  className={`flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline hover:bg-surface-2 hover:no-underline ${atual ? "bg-surface font-semibold text-ink shadow-card" : "text-ink-2"}`}
                >
                  <span className={`grid size-6 flex-none place-items-center rounded-full text-xs font-semibold ${feita ? "bg-ok-soft text-ok" : "border border-line-strong"}`}>
                    {feita ? <IconeCheck tamanho={13} /> : n + 1}
                  </span>
                  {nome}
                </Link>
                {atual && doGrupo.length > 1 && (
                  <div className="my-1 ml-[21px] flex flex-col border-l border-line-strong">
                    {doGrupo.map((t) => (
                      <Link
                        key={t.id}
                        href={link(t.id)}
                        className={`py-1.5 pl-3.5 text-xs no-underline hover:text-ink hover:no-underline ${t.id === id ? "font-semibold text-ink" : "text-ink-2"}`}
                      >
                        {t.titulo}
                        {t.feito && <span className="text-ok"> ✓</span>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className={`grid items-start gap-5 ${conteudo.lateral ? "xl:grid-cols-[minmax(0,1fr)_280px]" : ""}`}>
          <div className="flex min-w-0 flex-col gap-5">
            {conteudo.corpo}
            {id !== "negocio" && id !== "pronto" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {anterior ? (
                  <BotaoLink href={link(anterior.id)} variante="fantasma">
                    <IconeVoltar tamanho={16} /> Voltar
                  </BotaoLink>
                ) : (
                  <span />
                )}
                {proxima && respostas && (
                  <BotaoLink href={link(proxima.id)} variante={conteudo.bloqueia ? "fantasma" : "primario"}>
                    {avancarComo} <IconeSeta tamanho={16} />
                  </BotaoLink>
                )}
              </div>
            )}
          </div>
          {conteudo.lateral && <aside className="flex min-w-0 flex-col gap-4">{conteudo.lateral}</aside>}
        </div>
      </div>
    </>
  );
}
