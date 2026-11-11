import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { Formulario } from "@/components/Formulario";
import { IconeExterno, IconeSeta, IconeVoltar } from "@/components/Icones";
import { Aviso, BotaoLink, Campo, Cartao, classeAreaTexto, corAnuncio, Etiqueta, MiniaturaCriativo, Selecao, Tabela, Titulo } from "@/components/ui";
import { exigirGestao, temPapel } from "@/lib/auth/sessao";
import { dataHora, moeda } from "@/lib/formato";
import { ativarCampanha, copiarTextosParaTodos, enviarParaMeta, excluirRascunho, removerCriativo, salvarCriativo, salvarRascunho, validarNaMeta } from "@/lib/publicacao/acoes";
import { BUCKET_UPLOADS } from "@/lib/publicacao/job";
import { CHAMADAS, EVENTOS, validarRascunho, type ConfigPublicacao, type CriativoRascunho } from "@/lib/publicacao/modelo";
import { TIPOS_PUBLICO, type Publico } from "@/lib/publicos/modelo";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import { SITUACAO_CAMPANHA } from "../situacao";
import { CamposOrcamento } from "./CamposOrcamento";
import { EnviarArquivos } from "./EnviarArquivos";

export const metadata: Metadata = { title: "Campanha" };

const SITUACAO_CRIATIVO: Record<string, string> = {
  pendente: "aguardando envio",
  enviado: "vídeo enviado, a Meta está processando",
  processado: "mídia pronta",
  criado: "anúncio criado",
  erro: "erro",
};

export default async function Campanha({ params }: PageProps<"/o/[org]/campanhas/[id]">) {
  const { org: slug, id } = await params;
  const { org, papel, supabase } = await exigirGestao(slug);
  const [{ data: c }, { data: criativos }, { data: config }, { data: operacoes }, { data: publicosOrg }, { data: conjuntos }] = await Promise.all([
    supabase.from("campanhas_assistente").select("*").eq("id", id).eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("criativos_assistente").select("*").eq("campanha_id", id).eq("organizacao_id", org.id).order("ordem").order("criado_em"),
    supabase.from("config_publicacao").select("*").eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("operacoes_meta").select("criado_em, caminho, validacao, status_http, resposta").eq("campanha_id", id).order("criado_em", { ascending: false }).limit(30),
    supabase.from("publicos").select("id, nome, tipo, definicao, meta_audience_id, meta_tamanho, situacao").eq("organizacao_id", org.id).order("nome"),
    supabase.from("conjuntos_assistente").select("id, nome, meta_adset_id").eq("campanha_id", id).order("ordem"),
  ]);
  if (!c) notFound();

  const gestor = temPapel(papel, "gestor");
  // A campanha (verba, datas, público) só muda antes de o conjunto existir na Meta; cada criativo, até virar
  // anúncio. Com erro no meio da criação, dá para corrigir o que ainda não foi criado e tentar de novo.
  const aberta = gestor && ["rascunho", "erro"].includes(c.status);
  const editavel = aberta && !c.meta_adset_id;
  const r = c.rascunho as Record<string, unknown>;
  const lista = (criativos ?? []) as Array<
    CriativoRascunho & {
      arquivo_path: string;
      status: string;
      erro: string | null;
      meta_creative_id: string | null;
    }
  >;
  const cfg: ConfigPublicacao | null = config ? { ...config, teto_verba_diaria: Number(config.teto_verba_diaria) } : null;
  const publicos = (publicosOrg ?? []) as Publico[];
  const escolhidos = new Set((r.publicos as string[] | undefined) ?? []);
  const excluidos = new Set((r.excluir as string[] | undefined) ?? []);
  const { problemas } = validarRascunho(r, lista, cfg, org.fuso, c.meta_campaign_id ? new Date(0) : new Date(), publicos);
  const { data: previas } = lista.length
    ? await supabase.storage.from(BUCKET_UPLOADS).createSignedUrls(
        lista.map((x) => x.arquivo_path),
        3600,
      )
    : { data: [] };
  const previa = new Map((previas ?? []).flatMap((p) => (p.path && p.signedUrl ? [[p.path, p.signedUrl] as const] : [])));
  const hidden = (
    <>
      <input type="hidden" name="organizacao_id" value={org.id} />
      <input type="hidden" name="id" value={id} />
    </>
  );
  const orcamento = r.tipo_orcamento === "total" ? `${moeda(Number(r.verba_total), org.moeda)} no total` : `${moeda(Number(r.verba_diaria), org.moeda)}/dia`;
  const linkGerenciador =
    c.meta_campaign_id && c.account_id
      ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(c.account_id).replace("act_", "")}&selected_campaign_ids=${c.meta_campaign_id}`
      : null;

  return (
    <>
      {["criando", "ativando"].includes(c.status) && <AtualizarSozinho />}
      <Titulo
        sobrancelha={
          <Link href={rotaOrg(slug, "/campanhas")} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-text">
            <IconeVoltar tamanho={14} /> Campanhas
          </Link>
        }
        acoes={
          <div className="flex flex-wrap items-center gap-3">
            <Etiqueta tom={SITUACAO_CAMPANHA[c.status].tom}>{SITUACAO_CAMPANHA[c.status].rotulo}</Etiqueta>
            {c.meta_campaign_id && (
              <BotaoLink variante="secundario" href={rotaDesempenho(slug, c.meta_campaign_id)}>
                Ver desempenho
                <IconeSeta tamanho={16} />
              </BotaoLink>
            )}
          </div>
        }
      >
        {c.nome}
      </Titulo>

      <div className="grid gap-6">
        {c.erro && <Aviso tom="erro">{c.erro}</Aviso>}

        {/* ── Depois de criada ── */}
        {c.status === "criando" && <Aviso>Criando na Meta. Esta página se atualiza sozinha; vídeos podem levar alguns minutos para a Meta processar.</Aviso>}
        {["criada", "ativando", "ativa"].includes(c.status) && (
          <Cartao
            titulo={c.status === "ativa" ? "Campanha ativa" : "Criada na Meta, pausada"}
            descricao={
              c.status === "ativa"
                ? `Ativada em ${dataHora(c.ativada_em, org.fuso)}. Ela veicula a partir do início programado, depois da análise da Meta.`
                : "Confira no Gerenciador de Anúncios se está como você quer. Quando estiver, ative aqui."
            }
          >
            <div className="flex flex-col gap-4 text-sm">
              {!!conjuntos?.length && (
                <div>
                  <div className="sobrancelha mb-1.5">{conjuntos.length === 1 ? "Conjunto" : `${conjuntos.length} conjuntos (um por público)`}</div>
                  <ul className="flex flex-col gap-1">
                    {conjuntos.map((cj) => (
                      <li key={cj.id} className="flex items-center gap-2">
                        <Etiqueta tom={cj.meta_adset_id ? "ok" : "info"}>{cj.meta_adset_id ? "Criado" : "Pendente"}</Etiqueta>
                        <span className="text-ink">{cj.nome}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {linkGerenciador && (
                <a href={linkGerenciador} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start font-medium text-accent-text">
                  Abrir no Gerenciador de Anúncios <IconeExterno tamanho={15} />
                </a>
              )}
              <p className="text-ink-2">
                Depois da análise, confira o rastreio em <Link href={rotaOrg(slug, "/rastreio")}>Rastreio</Link> (“Reler na Meta agora”) e faça o teste de ponta a ponta.
              </p>
              {c.status === "criada" && gestor && (
                <Formulario acao={ativarCampanha} rotulo="Ativar campanha" variante="peso" className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
                  {hidden}
                  <p>
                    Ativar liga os anúncios, o conjunto e a campanha. O orçamento de <strong>{orcamento}</strong> passa a ser gasto a partir do início programado.
                  </p>
                  <Campo rotulo="Digite ATIVAR para confirmar" name="confirmacao" autoComplete="off" required />
                </Formulario>
              )}
            </div>
          </Cartao>
        )}

        {/* ── Rascunho ── */}
        <Cartao titulo="1. Campanha" descricao="Objetivo Cadastros, destino site, atribuição 7 dias clique / 1 dia visualização e Parâmetros de URL: definidos pelo sistema.">
          {editavel ? (
            <Formulario acao={salvarRascunho} rotulo="Salvar" className="grid gap-3 sm:grid-cols-2">
              {hidden}
              <Campo rotulo="Nome da campanha" name="nome" defaultValue={c.nome} required className="sm:col-span-2" />
              <CamposOrcamento
                tipo={r.tipo_orcamento === "total" ? "total" : "diario"}
                diaria={Number(r.verba_diaria) || 0}
                total={Number(r.verba_total) || 0}
                teto={cfg ? moeda(cfg.teto_verba_diaria, org.moeda) : null}
                inicio={String(r.inicio ?? "")}
                fim={String(r.fim ?? "")}
              />
              <Selecao rotulo="Otimizar para" name="evento" defaultValue={String(r.evento ?? "COMPLETE_REGISTRATION")}>
                {Object.entries(EVENTOS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Selecao>
              <Campo rotulo="Início" name="inicio" type="datetime-local" defaultValue={String(r.inicio ?? "")} required ajuda={`Horário de ${org.fuso}.`} />
              <Campo
                rotulo="Fim"
                name="fim"
                type="datetime-local"
                defaultValue={String(r.fim ?? "")}
                ajuda="Obrigatório com orçamento total. Com orçamento diário, em branco roda até você pausar."
              />
              <Campo
                rotulo="Página de destino"
                name="url_destino"
                type="url"
                defaultValue={String(r.url_destino ?? "")}
                placeholder="https://"
                required
                className="sm:col-span-2"
                ajuda="Sem utm_: o sistema acrescenta os Parâmetros de URL sozinho."
              />
              <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
                <legend className="mb-1 font-[550]">Público</legend>
                <p className="text-xs text-ink-3">
                  Cada público marcado vira um conjunto de anúncios, e o Desempenho mostra qual vende. Com mais de um, o orçamento fica na campanha e a Meta distribui.{" "}
                  <Link href={rotaOrg(slug, "/publicos")}>Gerenciar públicos</Link>
                </p>
                {publicos.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {publicos.map((p) => (
                      <label
                        key={p.id}
                        className="flex min-h-11 items-center gap-2.5 rounded-md border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                      >
                        <input type="checkbox" name="publicos" value={p.id} defaultChecked={escolhidos.has(p.id)} className="size-4 accent-accent" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.nome}</span>
                          <span className="text-xs text-ink-3">{TIPOS_PUBLICO[p.tipo]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-2">Nenhum público salvo: a campanha usa o público rápido abaixo.</p>
                )}
              </fieldset>
              {publicos.some((p) => p.tipo !== "detalhado") && (
                <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
                  <legend className="mb-1 font-[550]">Excluir</legend>
                  <div className="flex flex-wrap gap-2">
                    {publicos
                      .filter((p) => p.tipo !== "detalhado")
                      .map((p) => (
                        <label
                          key={p.id}
                          className="flex min-h-10 items-center gap-2 rounded-full border border-line px-3 has-[:checked]:border-err-line has-[:checked]:bg-err-soft"
                        >
                          <input type="checkbox" name="excluir" value={p.id} defaultChecked={excluidos.has(p.id)} className="size-4" />
                          {p.nome}
                        </label>
                      ))}
                  </div>
                  <span className="text-xs text-ink-3">Ex.: excluir os pagantes para não gastar verba com quem já é cliente.</span>
                </fieldset>
              )}
              <details className="sm:col-span-2" open={!publicos.length}>
                <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">Público rápido (quando nenhum público salvo é marcado)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="Idade mínima" name="idade_min" type="number" min="18" max="65" defaultValue={Number(r.idade_min ?? 18)} />
                  <Campo rotulo="Idade máxima" name="idade_max" type="number" min="18" max="65" defaultValue={Number(r.idade_max ?? 65)} />
                  <label className="flex items-start gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" name="publico_advantage" defaultChecked={r.publico_advantage !== false} className="mt-1 size-4 accent-accent" />
                    <span>
                      <span className="font-medium">Deixar a Meta ampliar o público (Advantage+)</span>
                      <span className="block text-xs text-ink-2">Recomendado. A idade vira sugestão e a Meta busca quem tem mais chance de se cadastrar. Público: Brasil.</span>
                    </span>
                  </label>
                </div>
              </details>
            </Formulario>
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-2">Orçamento</dt>
                <dd>{orcamento}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Otimizar para</dt>
                <dd>{EVENTOS[String(r.evento) as keyof typeof EVENTOS] ?? String(r.evento)}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Início / fim</dt>
                <dd>
                  {String(r.inicio).replace("T", " ")}
                  {r.fim ? ` → ${String(r.fim).replace("T", " ")}` : ""}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-ink-2">Destino</dt>
                <dd className="truncate">{String(r.url_destino)}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Público</dt>
                <dd>
                  {escolhidos.size
                    ? publicos
                        .filter((p) => escolhidos.has(p.id))
                        .map((p) => p.nome)
                        .join(", ")
                    : `Brasil, ${String(r.idade_min)}–${String(r.idade_max)}${r.publico_advantage !== false ? ", Advantage+" : ""}`}
                  {excluidos.size
                    ? ` · exclui ${publicos
                        .filter((p) => excluidos.has(p.id))
                        .map((p) => p.nome)
                        .join(", ")}`
                    : ""}
                </dd>
              </div>
            </dl>
          )}
        </Cartao>

        <Cartao titulo="2. Criativos" descricao="Cada arquivo vira um anúncio. O nome do anúncio é o que aparece no painel de Desempenho: use o gancho (ex.: “A1 | B gaveta”).">
          <div className="flex flex-col gap-4">
            {aberta && <EnviarArquivos orgId={org.id} campanhaId={id} />}
            {lista.map((x, i) => (
              <div key={x.id} className="grid gap-4 border-t border-line pt-5 sm:grid-cols-[140px_1fr]">
                <div className="flex flex-col gap-1">
                  <MiniaturaCriativo src={previa.get(x.arquivo_path)} tipo={x.tipo} cor={corAnuncio(i)} controles className="w-full" />
                  {c.status !== "rascunho" && <span className={`text-xs ${x.status === "erro" ? "text-err" : "text-ink-2"}`}>{x.erro ?? SITUACAO_CRIATIVO[x.status]}</span>}
                </div>
                {aberta && !x.meta_creative_id ? (
                  <div className="flex flex-col gap-2">
                    <Formulario acao={salvarCriativo} rotulo="Salvar anúncio" variante="secundario" className="grid gap-2">
                      {hidden}
                      <input type="hidden" name="id" value={x.id} />
                      <Campo rotulo={`Anúncio ${i + 1}: nome`} name="nome" defaultValue={x.nome} required />
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Texto principal</span>
                        <textarea name="texto" defaultValue={x.texto} rows={4} className={classeAreaTexto} />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Campo rotulo="Título" name="titulo" defaultValue={x.titulo} />
                        <Selecao rotulo="Botão" name="chamada" defaultValue={x.chamada}>
                          {Object.entries(CHAMADAS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Selecao>
                      </div>
                    </Formulario>
                    <div className="flex flex-wrap gap-2">
                      {lista.length > 1 && (
                        <Formulario
                          acao={copiarTextosParaTodos}
                          rotulo="Usar este texto em todos"
                          variante="secundario"
                          confirmar="Copiar texto, título e botão deste anúncio para todos os outros?"
                        >
                          {hidden}
                          <input type="hidden" name="id" value={x.id} />
                        </Formulario>
                      )}
                      <Formulario acao={removerCriativo} rotulo="Remover" variante="perigo" confirmar={`Remover “${x.nome}”?`}>
                        {hidden}
                        <input type="hidden" name="id" value={x.id} />
                      </Formulario>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm">
                    <div className="font-medium">{x.nome}</div>
                    <p className="mt-1 whitespace-pre-line text-ink-2">{x.texto}</p>
                    <p className="mt-1">
                      <strong>{x.titulo}</strong> · {CHAMADAS[x.chamada as keyof typeof CHAMADAS] ?? x.chamada}
                    </p>
                  </div>
                )}
              </div>
            ))}
            {!lista.length && !aberta && <p className="text-sm text-ink-2">Sem criativos.</p>}
          </div>
        </Cartao>

        {aberta && (
          <Cartao titulo="3. Revisar e criar" descricao="O sistema cria campanha, conjunto e anúncios na Meta, todos pausados. Nada é gasto até você ativar.">
            <div className="flex flex-col gap-4">
              {problemas.length ? (
                <Aviso tom="alerta">
                  <div className="font-medium">Falta resolver:</div>
                  <ul className="mt-1 list-disc pl-5">
                    {problemas.map((p, i) => (
                      <li key={i}>{p.texto}</li>
                    ))}
                  </ul>
                </Aviso>
              ) : (
                <Aviso tom="ok">
                  Pronto para criar: {lista.length} anúncio(s) em “{c.nome}”, {orcamento}, a partir de {String(r.inicio).replace("T", " ")}. Rastreio automático (Parâmetros de URL
                  e conjunto de dados {cfg?.pixel_id}).
                </Aviso>
              )}
              <div className="flex flex-wrap gap-3">
                <Formulario acao={validarNaMeta} rotulo="Validar na Meta" variante="secundario">
                  {hidden}
                </Formulario>
                {!problemas.length && (
                  <Formulario
                    acao={enviarParaMeta}
                    rotulo={c.meta_campaign_id ? "Tentar de novo" : "Criar na Meta (pausada)"}
                    variante="peso"
                    confirmar={c.meta_campaign_id ? "Continuar a criação de onde parou?" : "Criar a campanha na Meta? Ela fica pausada até você ativar."}
                  >
                    {hidden}
                  </Formulario>
                )}
              </div>
              {!c.meta_campaign_id && (
                <div className="border-t border-line pt-4">
                  <Formulario acao={excluirRascunho} rotulo="Excluir rascunho" variante="perigo" confirmar="Excluir este rascunho e os arquivos enviados?">
                    {hidden}
                    <input type="hidden" name="slug" value={slug} />
                  </Formulario>
                </div>
              )}
            </div>
          </Cartao>
        )}

        {gestor && !!operacoes?.length && (
          <Cartao titulo="Registro de chamadas à Meta" descricao="Tudo o que o sistema enviou à Meta para esta campanha.">
            <Tabela>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Chamada</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {operacoes.map((o, i) => {
                  const resp = o.resposta as {
                    id?: string;
                    error?: { error_user_msg?: string; message?: string };
                  } | null;
                  return (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{dataHora(o.criado_em, org.fuso)}</td>
                      <td className="font-mono text-xs">
                        {o.validacao ? "validar " : ""}
                        {o.caminho}
                      </td>
                      <td className="text-xs">
                        {resp?.error ? (
                          <span className="text-err">{resp.error.error_user_msg ?? resp.error.message}</span>
                        ) : resp?.id ? (
                          `criado ${resp.id}`
                        ) : (
                          `HTTP ${o.status_http}`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          </Cartao>
        )}
      </div>
    </>
  );
}
