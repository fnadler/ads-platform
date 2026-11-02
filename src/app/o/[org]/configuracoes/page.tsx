import type { Metadata } from "next";
import { Formulario } from "@/components/Formulario";
import { IconeSeta } from "@/components/Icones";
import { Aviso, BotaoLink, Campo, Cartao, Etiqueta, Selecao, Tabela, Titulo, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { alterarConta, conectarMeta, salvarFunil, salvarMetricas } from "@/lib/conexoes/acoes";
import { dataHora, decimal } from "@/lib/formato";
import { rotaOrg } from "@/lib/rotas";
import { urlSistema } from "@/lib/url";
import { FUNIS, TIPOS_PLATAFORMA } from "@/lib/vendas/plataformas/catalogo";
import { CartaoPlataforma, type ConexaoPlataforma, type EventoPlataforma } from "./CartaoPlataforma";
import { CartaoPublicacao } from "./CartaoPublicacao";
import { CartaoStripe, CartaoWebhook } from "./CartoesFonte";

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
  const conexaoPlataforma = (tipo: string) => (conexoes as Array<ConexaoPlataforma & { tipo: string }> | null)?.find((c) => c.tipo === tipo);
  const idsPlataforma = TIPOS_PLATAFORMA.map(conexaoPlataforma).flatMap((c) => (c ? [c.id] : []));
  const { data: recebidos } = idsPlataforma.length
    ? await supabase
        .from("eventos_recebidos")
        .select("conexao_id, tipo, chave_idempotencia, payload, recebido_em, erro")
        .in("conexao_id", idsPlataforma)
        .order("recebido_em", { ascending: false })
        .limit(40)
    : { data: [] };
  const eventosDe = (id?: string) => ((recebidos ?? []) as Array<EventoPlataforma & { conexao_id: string }>).filter((e) => e.conexao_id === id).slice(0, 5);
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
        sobrancelha="Configurações"
        descricao="Conexões com a Meta e com a fonte de venda, e o que conta como lead e compra."
        acoes={
          <div className="flex flex-wrap gap-2">
            <BotaoLink variante="secundario" href={rotaOrg(slug, "/configurar")}>
              Assistente de configuração
              <IconeSeta tamanho={16} />
            </BotaoLink>
            <BotaoLink variante="secundario" href={rotaOrg(slug, "/configuracoes/membros")}>
              Membros e convites
              <IconeSeta tamanho={16} />
            </BotaoLink>
          </div>
        }
      >
        Conexões e pessoas
      </Titulo>
      <div className="grid gap-6">
        <Cartao titulo="Como você vende" descricao="Define o que o Desempenho e o Início acompanham.">
          {gestor ? (
            <Formulario acao={salvarFunil} rotulo="Salvar" variante="secundario" className="flex flex-col gap-3">
              {hidden}
              <Selecao rotulo="Funil" name="funil" defaultValue={org.funil}>
                {Object.entries(FUNIS).map(([k, f]) => (
                  <option key={k} value={k}>
                    {f.rotulo}
                  </option>
                ))}
              </Selecao>
              <p className="text-xs text-ink-2">{FUNIS[org.funil].descricao}</p>
            </Formulario>
          ) : (
            <p className="text-sm">{FUNIS[org.funil].rotulo}</p>
          )}
        </Cartao>

        <Cartao titulo="Meta (anúncios)" descricao="Só leitura: o sistema nunca cria, edita ou pausa nada na sua conta." acoes={etiqueta(meta)}>
          {meta?.ultimo_erro && (
            <Aviso tom="erro" className="mb-4">
              {meta.ultimo_erro}
            </Aviso>
          )}
          {meta && (
            <p className="mb-4 text-sm text-ink-2">
              Usuário do sistema: <strong className="text-ink">{meta.config.usuario_nome ?? meta.config.usuario_id}</strong> · validado em {dataHora(meta.validado_em, org.fuso)}
            </p>
          )}
          {dono && (
            <details className="mb-4" open={!meta}>
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">
                {meta ? "Trocar o token" : "Conectar com token de usuário do sistema"}
              </summary>
              <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
                <li>No Business Manager: Configurações do negócio → Usuários → Usuários do sistema → Adicionar (função Funcionário).</li>
                <li>Em “Atribuir ativos”, dê acesso à conta de anúncios (permissão “Ver desempenho” basta).</li>
                <li>
                  “Gerar novo token”, escolha o app, marque <code>ads_read</code> e validade “Nunca”.
                </li>
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
                      <div className="font-mono text-xs text-ink-2">{c.account_id}</div>
                    </td>
                    <td className="text-ink-2">
                      {c.moeda} · {c.fuso}
                    </td>
                    <td colSpan={2}>
                      {gestor ? (
                        <Formulario
                          acao={alterarConta}
                          rotulo={c.ativa ? "Salvar" : "Ligar e carregar"}
                          variante={c.ativa ? "secundario" : "primario"}
                          className="flex flex-wrap items-center gap-2"
                        >
                          {hidden}
                          <input type="hidden" name="account_id" value={c.account_id} />
                          <input
                            type="date"
                            name="sincronizar_desde"
                            defaultValue={c.sincronizar_desde}
                            className="min-h-11 rounded-md border border-line-strong bg-surface px-3"
                          />
                          <select name="ativa" defaultValue={c.ativa ? "sim" : "nao"} className="min-h-11 rounded-md border border-line-strong bg-surface px-3">
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

        <CartaoPublicacao orgId={org.id} dono={dono} supabase={supabase} fuso={org.fuso} />

        <CartaoStripe stripe={stripe} base={base} orgId={org.id} dono={dono} gestor={gestor} />

        {TIPOS_PLATAFORMA.map((t) => (
          <CartaoPlataforma key={t} tipo={t} conexao={conexaoPlataforma(t)} eventos={eventosDe(conexaoPlataforma(t)?.id)} base={base} orgId={org.id} dono={dono} fuso={org.fuso} />
        ))}

        <CartaoWebhook webhook={webhook} base={base} orgId={org.id} dono={dono} />

        <Cartao
          titulo="O que conta como lead e compra na Meta"
          descricao="Somam-se as ações marcadas. As ações listadas são as que apareceram nas suas campanhas nos últimos 30 dias."
        >
          {gestor ? (
            <Formulario acao={salvarMetricas} rotulo="Salvar">
              {hidden}
              <div className="grid gap-6 sm:grid-cols-2">
                {(["acoes_lead", "acoes_compra"] as const).map((campo) => (
                  <fieldset key={campo} className="flex flex-col gap-1 text-sm">
                    <legend className="mb-1 font-medium">{campo === "acoes_lead" ? "Lead" : "Compra"}</legend>
                    {opcoesAcao.map((a) => (
                      <label key={a} className="flex items-center gap-2">
                        <input type="checkbox" name={campo} value={a} defaultChecked={metricas?.[campo]?.includes(a)} className="size-4 accent-accent" />
                        <code className="text-xs">{a}</code>
                        <span className="text-xs text-ink-2">{decimal(Number(acoesVistas.find((v) => v.action_type === a)?.total ?? NaN), 0)}</span>
                      </label>
                    ))}
                    <input
                      name={campo}
                      placeholder="outra ação (ex.: offsite_conversion.fb_pixel_complete_registration)"
                      className="mt-2 min-h-11 rounded-md border border-line-strong bg-surface px-3 font-mono text-xs"
                    />
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
