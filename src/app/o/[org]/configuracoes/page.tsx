import type { Metadata } from "next";
import Link from "next/link";
import { Copiavel } from "@/components/Formulario";
import { Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, Tabela, Titulo, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { alterarConta, conectarMeta, conectarStripe, gerarTokenWebhook, importarHistoricoStripe, removerConexao, salvarMetricas } from "@/lib/conexoes/acoes";
import { dataHora, decimal } from "@/lib/formato";
import { rotaOrg } from "@/lib/rotas";
import { urlSistema } from "@/lib/url";

export const metadata: Metadata = { title: "Configurações" };

const STATUS: Record<string, { rotulo: string; tom: Tom }> = {
  ativa: { rotulo: "Ativa", tom: "ok" },
  pendente: { rotulo: "Pendente", tom: "alerta" },
  erro: { rotulo: "Com erro", tom: "erro" },
  desativada: { rotulo: "Desativada", tom: "info" },
};

interface Conexao {
  id: string;
  tipo: "meta" | "stripe" | "webhook" | "csv";
  status: string;
  ultimo_erro: string | null;
  validado_em: string | null;
  config: Record<string, string>;
}

export default async function Configuracoes({ params }: PageProps<"/o/[org]/configuracoes">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const dono = papel === "dono";
  const gestor = temPapel(papel, "gestor");
  const [{ data: conexoes }, { data: contas }, { data: metricas }, { data: vistas }, base] = await Promise.all([
    supabase.from("conexoes").select("id, tipo, status, ultimo_erro, validado_em, config").eq("organizacao_id", org.id),
    supabase.from("contas_anuncio").select("account_id, nome, moeda, fuso, ativa, sincronizar_desde").eq("organizacao_id", org.id).order("nome"),
    supabase.from("config_metricas").select("acoes_lead, acoes_compra").eq("organizacao_id", org.id).single(),
    supabase.rpc("acoes_meta_vistas", { p_org: org.id }),
    urlSistema(),
  ]);
  const de = (tipo: Conexao["tipo"]) => (conexoes as Conexao[] | null)?.find((c) => c.tipo === tipo);
  const meta = de("meta");
  const stripe = de("stripe");
  const webhook = de("webhook");
  const hidden = <input type="hidden" name="organizacao_id" value={org.id} />;
  const etiqueta = (c?: Conexao) => (c ? <Etiqueta tom={STATUS[c.status].tom}>{STATUS[c.status].rotulo}</Etiqueta> : <Etiqueta>Não conectada</Etiqueta>);
  const acoesVistas = (vistas as Array<{ action_type: string; total: number }> | null) ?? [];
  const opcoesAcao = [...new Set([...acoesVistas.map((a) => a.action_type), ...(metricas?.acoes_lead ?? []), ...(metricas?.acoes_compra ?? [])])];

  return (
    <>
      <Titulo
        descricao="Conexões com a Meta e com a fonte de venda, e o que conta como lead e compra."
        acoes={
          <Link className="text-sm text-marca hover:underline" href={rotaOrg(slug, "/configuracoes/membros")}>
            Membros →
          </Link>
        }
      >
        Configurações
      </Titulo>
      <div className="grid gap-6">
        <Cartao
          titulo="Meta (anúncios)"
          descricao="Só leitura: o sistema nunca cria, edita ou pausa nada na sua conta."
          acoes={etiqueta(meta)}
        >
          {meta?.ultimo_erro && <Aviso tom="erro" className="mb-4">{meta.ultimo_erro}</Aviso>}
          {meta && (
            <p className="mb-4 text-sm text-suave">
              Usuário do sistema: <strong className="text-texto">{meta.config.usuario_nome ?? meta.config.usuario_id}</strong> · validado em {dataHora(meta.validado_em, org.fuso)}
            </p>
          )}
          {dono && (
            <details className="mb-4" open={!meta}>
              <summary className="cursor-pointer text-sm font-medium">{meta ? "Trocar o token" : "Conectar com token de usuário do sistema"}</summary>
              <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-suave">
                <li>No Business Manager: Configurações do negócio → Usuários → Usuários do sistema → Adicionar (função Funcionário).</li>
                <li>Em “Atribuir ativos”, dê acesso à conta de anúncios (permissão “Ver desempenho” basta).</li>
                <li>“Gerar novo token”, escolha o app, marque <code>ads_read</code> e validade “Nunca”.</li>
                <li>Cole o token abaixo. Ele é validado na hora e guardado cifrado.</li>
              </ol>
              <Formulario acao={conectarMeta} rotulo="Validar e salvar">
                {hidden}
                <Campo rotulo="Token" name="token" type="password" autoComplete="off" placeholder="EAA…" required />
                <Campo
                  rotulo="ID da conta de anúncios (opcional)"
                  name="contas"
                  autoComplete="off"
                  placeholder="act_1234567890"
                  ajuda="Use se a conta não aparecer sozinha. Está no Gerenciador de Anúncios, no seletor de contas ou na URL (act=…). Várias: separe por vírgula."
                />
              </Formulario>
            </details>
          )}
          {!!contas?.length && (
            <Tabela>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Moeda / fuso</th>
                  <th>Histórico desde</th>
                  <th>Sincronizar</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => (
                  <tr key={c.account_id}>
                    <td>
                      <div className="font-medium">{c.nome}</div>
                      <div className="font-mono text-xs text-suave">{c.account_id}</div>
                    </td>
                    <td className="text-suave">
                      {c.moeda} · {c.fuso}
                    </td>
                    <td colSpan={2}>
                      {gestor ? (
                        <Formulario acao={alterarConta} rotulo={c.ativa ? "Salvar" : "Ligar e carregar"} variante={c.ativa ? "secundario" : "primario"} className="flex flex-wrap items-center gap-2">
                          {hidden}
                          <input type="hidden" name="account_id" value={c.account_id} />
                          <input type="date" name="sincronizar_desde" defaultValue={c.sincronizar_desde} className="rounded-md border border-borda bg-superficie px-2 py-1" />
                          <select name="ativa" defaultValue={c.ativa ? "sim" : "nao"} className="rounded-md border border-borda bg-superficie px-2 py-1">
                            <option value="sim">Ligada</option>
                            <option value="nao">Desligada</option>
                          </select>
                        </Formulario>
                      ) : c.ativa ? (
                        "Ligada"
                      ) : (
                        "Desligada"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Cartao>

        <Cartao titulo="Stripe (vendas e assinaturas)" descricao="Faturas pagas viram vendas; assinaturas em teste grátis marcam o lead." acoes={etiqueta(stripe)}>
          {stripe?.ultimo_erro && <Aviso tom="alerta" className="mb-4">{stripe.ultimo_erro}</Aviso>}
          {stripe && (
            <div className="mb-4 flex flex-col gap-1 text-sm">
              <span className="font-medium">Endereço do webhook (cole no Stripe):</span>
              <Copiavel valor={`${base}/api/webhook/stripe/${stripe.id}`} />
              <span className="text-xs text-suave">
                Eventos: <code>invoice.paid</code>, <code>customer.subscription.created</code>, <code>charge.refunded</code>. Campo do lead no metadata da assinatura:{" "}
                <code>{stripe.config.campo_lead}</code>
                {stripe.config.modo && ` · chave de ${stripe.config.modo}`}
              </span>
            </div>
          )}
          {dono && (
            <details open={!stripe || stripe.status !== "ativa"}>
              <summary className="cursor-pointer text-sm font-medium">{stripe ? "Atualizar credenciais" : "Conectar"}</summary>
              <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-suave">
                <li>
                  Stripe → Desenvolvedores → Chaves de API → “Criar chave restrita” com <strong>leitura</strong> em Faturas, Assinaturas, Clientes e Cobranças. Cole abaixo e salve.
                </li>
                <li>Desenvolvedores → Webhooks → “Adicionar destino”: cole o endereço que aparece acima, com os três eventos.</li>
                <li>Copie o “Segredo de assinatura” (whsec_…) do destino e salve aqui.</li>
              </ol>
              <Formulario acao={conectarStripe} rotulo="Validar e salvar" className="grid gap-3">
                {hidden}
                <Campo rotulo="Chave restrita" name="chave" type="password" autoComplete="off" placeholder={stripe ? "(mantém a atual se ficar vazio)" : "rk_live_…"} />
                <Campo rotulo="Segredo de assinatura do webhook" name="segredo_webhook" type="password" autoComplete="off" placeholder={stripe ? "(mantém o atual se ficar vazio)" : "whsec_…"} />
                <Campo
                  rotulo="Campo do metadata que guarda o id do lead"
                  name="campo_lead"
                  defaultValue={stripe?.config.campo_lead ?? "user_id"}
                  required
                  ajuda="O mesmo id_externo que o site manda no lead. Sem ele, a venda casa pelo e-mail."
                />
              </Formulario>
            </details>
          )}
          {stripe?.status === "ativa" && gestor && (
            <div className="mt-4">
              <Formulario acao={importarHistoricoStripe} rotulo="Importar histórico (365 dias)" variante="secundario">
                {hidden}
              </Formulario>
            </div>
          )}
          {stripe && dono && (
            <div className="mt-4">
              <Formulario acao={removerConexao} rotulo="Remover conexão" variante="perigo" confirmar="Remover a conexão com o Stripe? As vendas já importadas ficam.">
                {hidden}
                <input type="hidden" name="id" value={stripe.id} />
              </Formulario>
            </div>
          )}
        </Cartao>

        <Cartao titulo="Webhook genérico (leads e vendas)" descricao="Para o seu site, checkout próprio ou ferramenta de automação enviarem leads e vendas com os UTMs." acoes={etiqueta(webhook)}>
          <div className="mb-4 flex flex-col gap-1 text-sm">
            <span className="font-medium">Endereço:</span>
            <Copiavel valor={`${base}/api/webhook/eventos`} />
            {webhook && <span className="text-xs text-suave">Token em uso começa com {webhook.config.prefixo}…</span>}
          </div>
          <details className="mb-4">
            <summary className="cursor-pointer text-sm font-medium">Formato</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-fundo p-3 text-xs">{`POST ${base}/api/webhook/eventos
Authorization: Bearer whk_…
Content-Type: application/json

{ "tipo": "lead", "id_externo": "id-do-cliente-no-seu-sistema",
  "ocorrido_em": "2026-11-03T14:05:00-03:00", "email": "cliente@exemplo.com",
  "atribuicao":     { "utm_source": "meta", "utm_campaign_id": "…", "utm_adset_id": "…", "utm_ad_id": "…" },
  "primeiro_toque": { "utm_campaign_id": "…", "utm_ad_id": "…" } }

{ "tipo": "teste_iniciado", "id_externo": "id-do-cliente" }
{ "tipo": "venda", "id_externo": "pedido-123", "valor": 21.5, "lead_id_externo": "id-do-cliente" }
{ "tipo": "reembolso", "id_externo": "pedido-123", "valor": 21.5, "lead_id_externo": "id-do-cliente" }

Vários de uma vez: { "eventos": [ … ] } (até 500). Reenviar não duplica.`}</pre>
          </details>
          {dono && (
            <Formulario acao={gerarTokenWebhook} rotulo={webhook ? "Gerar token novo (o atual deixa de valer)" : "Gerar token"} variante={webhook ? "secundario" : "primario"} confirmar={webhook ? "O token atual deixa de funcionar na hora. Continuar?" : undefined}>
              {hidden}
            </Formulario>
          )}
        </Cartao>

        <Cartao titulo="O que conta como lead e compra na Meta" descricao="Somam-se as ações marcadas. As ações listadas são as que apareceram nas suas campanhas nos últimos 30 dias.">
          {gestor ? (
            <Formulario acao={salvarMetricas} rotulo="Salvar">
              {hidden}
              <div className="grid gap-6 sm:grid-cols-2">
                {(["acoes_lead", "acoes_compra"] as const).map((campo) => (
                  <fieldset key={campo} className="flex flex-col gap-1 text-sm">
                    <legend className="mb-1 font-medium">{campo === "acoes_lead" ? "Lead" : "Compra"}</legend>
                    {opcoesAcao.map((a) => (
                      <label key={a} className="flex items-center gap-2">
                        <input type="checkbox" name={campo} value={a} defaultChecked={metricas?.[campo]?.includes(a)} />
                        <code className="text-xs">{a}</code>
                        <span className="text-xs text-suave">{decimal(Number(acoesVistas.find((v) => v.action_type === a)?.total ?? NaN), 0)}</span>
                      </label>
                    ))}
                    <input name={campo} placeholder="outra ação (ex.: offsite_conversion.fb_pixel_complete_registration)" className="mt-1 rounded-md border border-borda bg-superficie px-2 py-1 text-xs" />
                  </fieldset>
                ))}
              </div>
            </Formulario>
          ) : (
            <p className="text-sm">
              Lead: <code>{metricas?.acoes_lead.join(", ")}</code> · Compra: <code>{metricas?.acoes_compra.join(", ")}</code>
            </p>
          )}
        </Cartao>
      </div>
    </>
  );
}
