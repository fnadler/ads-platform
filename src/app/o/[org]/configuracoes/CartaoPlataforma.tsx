import { Copiavel, Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, Tabela, type Tom } from "@/components/ui";
import { alterarModoPlataforma, conectarPlataforma, removerConexao } from "@/lib/conexoes/acoes";
import { dataHora, moeda } from "@/lib/formato";
import { PLATAFORMAS_VENDA, SCRIPT_CHECKOUT, type TipoPlataforma } from "@/lib/vendas/plataformas/catalogo";

export interface ConexaoPlataforma {
  id: string;
  status: string;
  config: { modo_teste?: boolean };
}
export interface EventoPlataforma {
  tipo: string;
  chave_idempotencia: string;
  payload: Record<string, unknown>;
  recebido_em: string;
  erro: string | null;
}

const ROTULO_EVENTO: Record<string, { rotulo: string; tom: Tom }> = {
  venda: { rotulo: "Venda", tom: "ok" },
  venda_pendente: { rotulo: "Aguardando pagamento", tom: "alerta" },
  venda_expirada: { rotulo: "Não concluída", tom: "info" },
  reembolso: { rotulo: "Reembolso", tom: "erro" },
  chargeback: { rotulo: "Chargeback", tom: "erro" },
};

/** Uma linha por venda entendida; eventos ignorados também aparecem, para a pessoa ver que chegaram. */
function Linhas({ e, fuso }: { e: EventoPlataforma; fuso: string }) {
  const lista = e.tipo === "teste" ? ((e.payload.eventos as Array<Record<string, unknown>>) ?? []) : e.tipo === "invalido" ? [] : [e.payload];
  const nome = e.tipo === "teste" || e.tipo === "invalido" ? String(e.payload.evento ?? "") : "";
  const quando = <td className="whitespace-nowrap">{dataHora(e.recebido_em, fuso)}</td>;
  if (e.erro)
    return (
      <tr>
        {quando}
        <td colSpan={3} className="text-xs text-err">
          {e.erro}
        </td>
      </tr>
    );
  if (!lista.length)
    return (
      <tr>
        {quando}
        <td colSpan={3} className="text-xs text-ink-2">
          {nome || "Evento"}: recebido e ignorado, porque não muda os números.
        </td>
      </tr>
    );
  return lista.map((v) => {
    const a = (v.atribuicao ?? {}) as { utm_ad_id?: string };
    const r = ROTULO_EVENTO[String(v.tipo)] ?? { rotulo: String(v.tipo), tom: "info" as Tom };
    return (
      <tr key={`${e.chave_idempotencia}:${String(v.id_externo)}`}>
        {quando}
        <td>
          <Etiqueta tom={r.tom}>{r.rotulo}</Etiqueta>
        </td>
        <td className="num whitespace-nowrap">{moeda(Number(v.valor), String(v.moeda ?? "BRL"))}</td>
        <td className="font-mono text-xs">{a.utm_ad_id ?? <span className="font-sans text-warn">Sem anúncio de origem</span>}</td>
      </tr>
    );
  });
}

export function CartaoPlataforma({
  tipo,
  conexao,
  eventos,
  base,
  orgId,
  dono,
  fuso,
}: {
  tipo: TipoPlataforma;
  conexao?: ConexaoPlataforma;
  eventos: EventoPlataforma[];
  base: string;
  orgId: string;
  dono: boolean;
  fuso: string;
}) {
  const p = PLATAFORMAS_VENDA[tipo];
  const ativa = conexao?.status === "ativa";
  const modoTeste = conexao?.config?.modo_teste !== false;
  const hidden = (
    <>
      <input type="hidden" name="organizacao_id" value={orgId} />
      <input type="hidden" name="tipo" value={tipo} />
    </>
  );
  return (
    <Cartao
      titulo={`${p.rotulo} (vendas)`}
      descricao="Compras aprovadas viram vendas, com o anúncio de origem. Pix e boleto ficam como pendentes até o pagamento; reembolso e chargeback descontam da receita."
      acoes={
        !conexao ? (
          <Etiqueta>Não conectada</Etiqueta>
        ) : !ativa ? (
          <Etiqueta tom="alerta">Falta o token</Etiqueta>
        ) : modoTeste ? (
          <Etiqueta tom="alerta">Em teste</Etiqueta>
        ) : (
          <Etiqueta tom="ok">Contando vendas</Etiqueta>
        )
      }
    >
      {!conexao && dono && (
        <Formulario acao={conectarPlataforma} rotulo={`Conectar ${p.rotulo}`} variante="secundario">
          {hidden}
        </Formulario>
      )}
      {!conexao && !dono && <p className="text-sm text-ink-2">Só o dono da organização conecta plataformas.</p>}
      {conexao && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Endereço do webhook:</span>
            <Copiavel valor={`${base}/api/webhook/plataforma/${conexao.id}`} />
          </div>
          {dono && (
            <details open={!ativa}>
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">{ativa ? "Trocar o token" : "Como configurar"}</summary>
              <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
                {p.passos.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <a href={p.painel} target="_blank" rel="noopener" className="mb-3 inline-flex min-h-10 items-center text-sm font-[550] text-accent-text">
                Abrir o painel da {p.rotulo} ↗
              </a>
              <Formulario acao={conectarPlataforma} rotulo="Salvar" className="grid gap-3">
                {hidden}
                <Campo rotulo={p.campoSegredo} name="segredo" type="password" autoComplete="off" required />
              </Formulario>
            </details>
          )}

          {modoTeste && ativa && (
            <Aviso tom="alerta">
              <strong>Modo de teste ligado.</strong> O que chega aparece abaixo, mas não entra nos números. Quando estiver certo, passe a contar as vendas. O que chegou durante o
              teste não é contado depois.
            </Aviso>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Últimos eventos</h3>
            {eventos.length ? (
              <div className="overflow-hidden rounded-md border border-line">
                <Tabela>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Entendido como</th>
                      <th className="text-right">Valor</th>
                      <th>Anúncio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventos.map((e) => (
                      <Linhas key={e.chave_idempotencia} e={e} fuso={fuso} />
                    ))}
                  </tbody>
                </Tabela>
              </div>
            ) : (
              <p className="text-sm text-ink-2">Nenhum evento recebido ainda.</p>
            )}
          </div>

          <details>
            <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">Como a venda chega com o anúncio</summary>
            <div className="mt-2 flex flex-col gap-3 text-sm text-ink-2">
              <p>
                Os anúncios precisam dos parâmetros da tela Rastreio: <code>sck</code> leva o ID do anúncio e <code>src</code>, o da campanha. As campanhas criadas pelo Adverdad já
                saem assim.
              </p>
              <p>Se o anúncio leva direto ao checkout, é só isso. Se leva a uma página sua antes, cole esta linha nela, para os parâmetros chegarem ao link de compra:</p>
              <Copiavel valor={SCRIPT_CHECKOUT} />
            </div>
          </details>

          {dono && (
            <div className="flex flex-wrap gap-3">
              {ativa && (
                <Formulario
                  acao={alterarModoPlataforma}
                  rotulo={modoTeste ? "Passar a contar as vendas" : "Voltar para o modo de teste"}
                  variante={modoTeste ? "peso" : "secundario"}
                  confirmar={modoTeste ? undefined : "No modo de teste, as próximas vendas não entram nos números. Continuar?"}
                >
                  <input type="hidden" name="organizacao_id" value={orgId} />
                  <input type="hidden" name="id" value={conexao.id} />
                  <input type="hidden" name="modo_teste" value={modoTeste ? "nao" : "sim"} />
                </Formulario>
              )}
              <Formulario acao={removerConexao} rotulo="Remover conexão" variante="perigo" confirmar={`Remover a conexão com a ${p.rotulo}? As vendas já recebidas ficam.`}>
                <input type="hidden" name="organizacao_id" value={orgId} />
                <input type="hidden" name="id" value={conexao.id} />
              </Formulario>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
