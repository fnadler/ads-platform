import { Copiavel, Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, type Tom } from "@/components/ui";
import { conectarStripe, gerarTokenWebhook, importarHistoricoStripe, removerConexao } from "@/lib/conexoes/acoes";

// Conexões de venda que aparecem tanto em Configurações quanto no assistente de configuração.

export interface ConexaoFonte {
  id: string;
  status: string;
  ultimo_erro: string | null;
  config: Record<string, string>;
}

const STATUS: Record<string, { rotulo: string; tom: Tom }> = {
  ativa: { rotulo: "Ativa", tom: "ok" },
  pendente: { rotulo: "Pendente", tom: "alerta" },
  erro: { rotulo: "Com erro", tom: "erro" },
  desativada: { rotulo: "Desativada", tom: "info" },
};
const rotuloConexao = (c?: ConexaoFonte) => (c ? <Etiqueta tom={STATUS[c.status].tom}>{STATUS[c.status].rotulo}</Etiqueta> : <Etiqueta>Não conectada</Etiqueta>);

export function CartaoStripe({ stripe, base, orgId, dono, gestor }: { stripe?: ConexaoFonte; base: string; orgId: string; dono: boolean; gestor: boolean }) {
  const hidden = <input type="hidden" name="organizacao_id" value={orgId} />;
  const etiqueta = rotuloConexao(stripe);
  return (
    <Cartao titulo="Stripe (vendas e assinaturas)" descricao="Faturas pagas viram vendas; assinaturas em teste grátis marcam o lead." acoes={etiqueta}>
      {stripe?.ultimo_erro && (
        <Aviso tom="alerta" className="mb-4">
          {stripe.ultimo_erro}
        </Aviso>
      )}
      {stripe && (
        <div className="mb-4 flex flex-col gap-1 text-sm">
          <span className="font-medium">Endereço do webhook (cole no Stripe):</span>
          <Copiavel valor={`${base}/api/webhook/stripe/${stripe.id}`} />
          <span className="text-xs text-ink-2">
            Eventos: <code>invoice.paid</code>, <code>customer.subscription.created</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>,{" "}
            <code>charge.refunded</code>. Campo do lead no metadata da assinatura: <code>{stripe.config.campo_lead}</code>
            {stripe.config.modo && ` · chave de ${stripe.config.modo}`}
          </span>
        </div>
      )}
      {dono && (
        <details open={!stripe || stripe.status !== "ativa"}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">{stripe ? "Atualizar credenciais" : "Conectar"}</summary>
          <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>
              Stripe → Desenvolvedores → Chaves de API → “Criar chave restrita” com <strong>leitura</strong> em Faturas, Assinaturas, Clientes e Cobranças. Cole abaixo e salve.
            </li>
            <li>Desenvolvedores → Webhooks → “Adicionar destino”: cole o endereço que aparece acima, com os cinco eventos acima.</li>
            <li>Copie o “Segredo de assinatura” (whsec_…) do destino e salve aqui.</li>
          </ol>
          <Formulario acao={conectarStripe} rotulo="Validar e salvar" className="grid gap-3">
            {hidden}
            <Campo rotulo="Chave restrita" name="chave" type="password" autoComplete="off" placeholder={stripe ? "(mantém a atual se ficar vazio)" : "rk_live_…"} />
            <Campo
              rotulo="Segredo de assinatura do webhook"
              name="segredo_webhook"
              type="password"
              autoComplete="off"
              placeholder={stripe ? "(mantém o atual se ficar vazio)" : "whsec_…"}
            />
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
  );
}

export function CartaoWebhook({ webhook, base, orgId, dono }: { webhook?: ConexaoFonte; base: string; orgId: string; dono: boolean }) {
  const hidden = <input type="hidden" name="organizacao_id" value={orgId} />;
  const etiquetaWeb = rotuloConexao(webhook);
  return (
    <Cartao
      titulo="Webhook genérico (leads e vendas)"
      descricao="Para o seu site, checkout próprio ou ferramenta de automação enviarem leads e vendas com os UTMs."
      acoes={etiquetaWeb}
    >
      <div className="mb-4 flex flex-col gap-1 text-sm">
        <span className="font-medium">Endereço:</span>
        <Copiavel valor={`${base}/api/webhook/eventos`} />
        {webhook && <span className="text-xs text-ink-2">Token em uso começa com {webhook.config.prefixo}…</span>}
      </div>
      <details className="mb-4">
        <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">Formato</summary>
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-sunken p-4 font-mono text-xs leading-relaxed text-ink">{`POST ${base}/api/webhook/eventos
Authorization: Bearer whk_…
Content-Type: application/json

{ "tipo": "lead", "id_externo": "id-do-cliente-no-seu-sistema",
  "ocorrido_em": "2026-11-03T14:05:00-03:00", "email": "cliente@exemplo.com",
  "atribuicao":     { "utm_source": "meta", "utm_campaign_id": "…", "utm_adset_id": "…", "utm_ad_id": "…" },
  "primeiro_toque": { "utm_campaign_id": "…", "utm_ad_id": "…" } }

{ "tipo": "teste_iniciado", "id_externo": "id-do-cliente" }
{ "tipo": "teste_cancelado", "id_externo": "id-do-cliente" }
{ "tipo": "teste_reativado", "id_externo": "id-do-cliente" }
{ "tipo": "venda", "id_externo": "pedido-123", "valor": 21.5, "lead_id_externo": "id-do-cliente" }
{ "tipo": "venda_pendente", "id_externo": "pedido-123", "valor": 21.5 }  (Pix ou boleto gerado; "venda" no mesmo id confirma)
{ "tipo": "venda_expirada", "id_externo": "pedido-123", "valor": 21.5 }
{ "tipo": "reembolso", "id_externo": "pedido-123", "valor": 21.5, "lead_id_externo": "id-do-cliente" }
{ "tipo": "chargeback", "id_externo": "pedido-123", "valor": 21.5, "lead_id_externo": "id-do-cliente" }

Vários de uma vez: { "eventos": [ … ] } (até 500). Reenviar não duplica.`}</pre>
      </details>
      {dono && (
        <Formulario
          acao={gerarTokenWebhook}
          rotulo={webhook ? "Gerar token novo (o atual deixa de valer)" : "Gerar token"}
          variante={webhook ? "secundario" : "primario"}
          confirmar={webhook ? "O token atual deixa de funcionar na hora. Continuar?" : undefined}
        >
          {hidden}
        </Formulario>
      )}
    </Cartao>
  );
}
