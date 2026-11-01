import { Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, Selecao } from "@/components/ui";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { lerPrerequisitos, linkTermosPublicos, type Prerequisitos } from "@/lib/integracoes/metaEscrita";
import { dataHora } from "@/lib/formato";
import { aceitarPublicosClientes } from "@/lib/publicos/acoes";
import { conectarPublicacao, salvarConfigPublicacao } from "@/lib/publicacao/acoes";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

// Conexão de publicação (assistente de campanhas): token próprio com ads_management, separado do de
// leitura, e a escolha de Página, Instagram, conjunto de dados e teto de verba — lidos da Meta na hora.
export async function CartaoPublicacao({ orgId, dono, supabase, fuso }: { orgId: string; dono: boolean; supabase: SupabaseClient; fuso: string }) {
  const [{ data: conexao }, { data: config }] = await Promise.all([
    supabase.from("conexoes").select("id, status, ultimo_erro, config").eq("organizacao_id", orgId).eq("tipo", "meta_publicacao").maybeSingle(),
    supabase.from("config_publicacao").select("*").eq("organizacao_id", orgId).maybeSingle(),
  ]);
  const hidden = <input type="hidden" name="organizacao_id" value={orgId} />;

  let p: Prerequisitos | null = null;
  let erroLeitura = "";
  if (conexao && config?.account_id && dono) {
    try {
      const admin = criarClienteAdmin();
      const segredo = await lerSegredo<SegredoMeta>(admin, orgId, conexao.id);
      if (segredo) p = await lerPrerequisitos(segredo.token, config.account_id);
    } catch (e) {
      erroLeitura = (e as Error).message;
    }
  }
  const opcao = (id: string, nome: string) => `${id}|${nome}`;

  return (
    <Cartao
      titulo="Meta (publicação)"
      descricao="Para o assistente criar campanhas na sua conta. Tudo nasce pausado; ativar é sempre uma decisão sua."
      acoes={conexao ? <Etiqueta tom={conexao.status === "ativa" ? "ok" : "erro"}>{conexao.status === "ativa" ? "Ativa" : "Com erro"}</Etiqueta> : <Etiqueta>Não conectada</Etiqueta>}
    >
      {conexao?.ultimo_erro && <Aviso tom="erro" className="mb-4">{conexao.ultimo_erro}</Aviso>}
      {dono && (
        <details className="mb-4" open={!conexao}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">{conexao ? "Trocar o token de publicação" : "Conectar"}</summary>
          <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>No Business Manager, no usuário do sistema: em Atribuir ativos, dê à conta de anúncios a permissão “Gerenciar campanhas” e atribua a Página do Facebook (e a conta do Instagram) da marca.</li>
            <li>
              “Gerar token” com o mesmo app, validade “Nunca”, marcando <code>ads_management</code>, <code>ads_read</code>, <code>pages_show_list</code>,{" "}
              <code>pages_read_engagement</code> e <code>instagram_basic</code> (as três últimas permitem listar a Página e o Instagram).
            </li>
            <li>Cole abaixo. O token de leitura continua separado: dá para revogar um sem afetar o outro.</li>
          </ol>
          <Formulario acao={conectarPublicacao} rotulo="Validar e salvar">
            {hidden}
            <Campo rotulo="Token com ads_management" name="token" type="password" autoComplete="off" placeholder="EAA…" required />
          </Formulario>
        </details>
      )}
      {erroLeitura && <Aviso tom="erro" className="mb-4">Não foi possível ler a conta na Meta: {erroLeitura}</Aviso>}
      {config && (
        <div className="text-sm">
          {p && dono ? (
            <Formulario acao={salvarConfigPublicacao} rotulo="Salvar" className="grid gap-3 sm:grid-cols-2">
              {hidden}
              <Selecao rotulo="Página do Facebook" name="page" defaultValue={config.page_id ? opcao(config.page_id, config.page_nome ?? "") : ""} required>
                <option value="">Escolha…</option>
                {p.paginas.map((x) => (
                  <option key={x.id} value={opcao(x.id, x.nome)}>
                    {x.nome}
                  </option>
                ))}
              </Selecao>
              <Selecao rotulo="Conta do Instagram" name="instagram" defaultValue={config.instagram_user_id ? opcao(config.instagram_user_id, config.instagram_nome ?? "") : ""}>
                <option value="">Sem Instagram (só Facebook)</option>
                {p.instagram.map((x) => (
                  <option key={x.id} value={opcao(x.id, x.nome)}>
                    {x.nome}
                  </option>
                ))}
              </Selecao>
              <Selecao rotulo="Conjunto de dados (pixel)" name="pixel" defaultValue={config.pixel_id ? opcao(config.pixel_id, config.pixel_nome ?? "") : ""} required>
                <option value="">Escolha…</option>
                {p.pixels.map((x) => (
                  <option key={x.id} value={opcao(x.id, x.nome)}>
                    {x.nome} ({x.id}){x.ultimoEvento ? "" : " · sem eventos"}
                  </option>
                ))}
              </Selecao>
              <Campo rotulo="Teto de verba diária por campanha (R$)" name="teto_verba_diaria" type="number" min="1" step="1" defaultValue={Number(config.teto_verba_diaria)} required ajuda="O assistente não deixa criar campanha acima disto." />
              {!p.paginas.length && (
                <Aviso tom="alerta" className="sm:col-span-2">
                  Nenhuma Página disponível.{" "}
                  {p.permissoes.includes("pages_show_list")
                    ? "Atribua a Página ao usuário do sistema (Contas → Páginas → Atribuir pessoas → Usuários do sistema, com permissão de Anúncios)."
                    : "O token não tem a permissão pages_show_list, sem a qual a Meta não lista Páginas: gere um token novo marcando pages_show_list, pages_read_engagement e instagram_basic, e cole acima."}
                </Aviso>
              )}
              {!p.instagram.length && (
                <Aviso tom="info" className="sm:col-span-2">
                  Nenhuma conta do Instagram disponível
                  {p.permissoes.includes("instagram_basic") ? "" : " (o token não tem a permissão instagram_basic)"}. Sem ela, os anúncios saem pela Página do Facebook.
                </Aviso>
              )}
            </Formulario>
          ) : (
            <dl className="grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-ink-2">Página</dt>
                <dd>{config.page_nome ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Instagram</dt>
                <dd>{config.instagram_nome ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Conjunto de dados</dt>
                <dd>{config.pixel_nome ? `${config.pixel_nome} (${config.pixel_id})` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Teto de verba diária</dt>
                <dd>{Number(config.teto_verba_diaria).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
      {config && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="text-base font-[550] text-ink">Públicos com dados de clientes</h3>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Permite criar na Meta públicos a partir dos seus leads e vendas (ex.: excluir quem já paga, reconquistar quem não terminou o cadastro). Só vão para a Meta e-mail e telefone
            criptografados (hash SHA-256), nunca em claro. Ao autorizar, você confirma que a política de privacidade do seu site informa esse uso para anúncios.
          </p>
          {config.aceite_publicos_clientes_em ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Etiqueta tom="ok">Autorizado em {dataHora(config.aceite_publicos_clientes_em, fuso)}</Etiqueta>
              {dono && (
                <Formulario acao={aceitarPublicosClientes} rotulo="Revogar" variante="perigo" confirmar="Revogar? As listas de clientes deixam de ser atualizadas na Meta.">
                  {hidden}
                  <input type="hidden" name="aceite" value="nao" />
                </Formulario>
              )}
            </div>
          ) : dono ? (
            <Formulario acao={aceitarPublicosClientes} rotulo="Autorizar" variante="secundario" className="mt-3 flex flex-col gap-3">
              {hidden}
              <input type="hidden" name="aceite" value="sim" />
            </Formulario>
          ) : (
            <p className="mt-3 text-sm text-ink-3">Só o dono da organização autoriza.</p>
          )}
          {config.account_id && (
            <p className="mt-3 text-xs text-ink-3">
              A Meta também exige que a conta de anúncios aceite os termos de público personalizado, uma vez:{" "}
              <a href={linkTermosPublicos(config.account_id)} target="_blank" rel="noreferrer">
                aceitar os termos na Meta
              </a>
              .
            </p>
          )}
        </div>
      )}
    </Cartao>
  );
}
