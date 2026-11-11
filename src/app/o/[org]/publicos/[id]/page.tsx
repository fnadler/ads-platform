import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { Formulario } from "@/components/Formulario";
import { IconeVoltar } from "@/components/Icones";
import { Aviso, Campo, Cartao, Etiqueta, Selecao, Titulo } from "@/components/ui";
import { exigirGestao, temPapel } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { enviarPublico, excluirPublico, salvarPublico } from "@/lib/publicos/acoes";
import { DefinicaoDetalhado, MINIMO_PERSONALIZADO, PISO_TAMANHO_META, SEGMENTOS, textoTamanhoMeta, TIPOS_PUBLICO, type TipoPublico } from "@/lib/publicos/modelo";
import { rotaOrg } from "@/lib/rotas";
import { EditorInteresses } from "./EditorInteresses";

export const metadata: Metadata = { title: "Público" };

export default async function Publico({ params, searchParams }: PageProps<"/o/[org]/publicos/[id]">) {
  const { org: slug, id } = await params;
  const busca = await searchParams;
  const { org, papel, supabase } = await exigirGestao(slug);
  const gestor = temPapel(papel, "gestor");
  const novo = id === "novo";
  const [{ data: p }, { data: config }, { data: origens }] = await Promise.all([
    novo ? Promise.resolve({ data: null }) : supabase.from("publicos").select("*").eq("id", id).eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("config_publicacao").select("aceite_publicos_clientes_em, pixel_id").eq("organizacao_id", org.id).maybeSingle(),
    supabase.from("publicos").select("id, nome, meta_tamanho").eq("organizacao_id", org.id).in("tipo", ["funil", "site"]).not("meta_audience_id", "is", null),
  ]);
  if (!novo && !p) notFound();
  const tipo = (novo ? String(busca.tipo ?? "detalhado") : p!.tipo) as TipoPublico;
  if (!(tipo in TIPOS_PUBLICO)) notFound();
  const def = (p?.definicao ?? {}) as Record<string, unknown>;
  const tam = p?.meta_tamanho as { min?: number; max?: number; enviados?: number; situacao?: string; em?: string } | null;
  const hidden = (
    <>
      <input type="hidden" name="organizacao_id" value={org.id} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tipo" value={tipo} />
    </>
  );
  const travado = !!p?.meta_audience_id && (tipo === "site" || tipo === "semelhante");

  return (
    <>
      {p?.situacao === "enviando" && <AtualizarSozinho />}
      <Titulo
        sobrancelha={
          <Link href={rotaOrg(slug, "/publicos")} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-text">
            <IconeVoltar tamanho={14} /> Públicos · {TIPOS_PUBLICO[tipo]}
          </Link>
        }
        acoes={
          p && (
            <Etiqueta tom={p.situacao === "pronto" ? "ok" : p.situacao === "erro" ? "erro" : p.situacao === "enviando" ? "alerta" : "info"}>
              {p.situacao === "pronto" ? "Pronto" : p.situacao === "erro" ? "Com erro" : p.situacao === "enviando" ? "Enviando à Meta…" : "Rascunho"}
            </Etiqueta>
          )
        }
      >
        {p?.nome ?? `Novo público: ${TIPOS_PUBLICO[tipo]}`}
      </Titulo>

      <div className="grid gap-5">
        {p?.erro && <Aviso tom="erro">{p.erro}</Aviso>}

        {tipo === "detalhado" ? (
          gestor ? (
            <EditorInteresses orgId={org.id} slug={slug} id={id} nome={p?.nome ?? ""} definicao={DefinicaoDetalhado.parse(def)} />
          ) : (
            <Cartao titulo="Definição">
              <p className="text-sm text-ink-2">
                {DefinicaoDetalhado.parse(def)
                  .interesses.map((i) => i.nome)
                  .join(", ") || "Sem interesses"}
              </p>
            </Cartao>
          )
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Cartao
              titulo="Definição"
              descricao={
                tipo === "funil"
                  ? "A lista sai dos cadastros e vendas do sistema e é enviada à Meta só como hash (e-mail e telefone criptografados), atualizada todo dia às 4h."
                  : tipo === "site"
                    ? "Pessoas que abriram qualquer página do site com o pixel, no período escolhido."
                    : "A Meta encontra pessoas parecidas com o público de origem, no Brasil. 1% é o mais parecido; 10%, o mais amplo."
              }
            >
              {tipo === "funil" && !config?.aceite_publicos_clientes_em && (
                <Aviso tom="alerta" className="mb-4">
                  O dono da organização ainda não autorizou o uso de dados de clientes em públicos (Configurações → Meta (publicação)). Até lá, este público fica salvo, mas não vai
                  para a Meta.
                </Aviso>
              )}
              {gestor && !travado ? (
                <Formulario acao={salvarPublico} rotulo={p ? "Salvar" : "Criar público"} variante="peso" className="flex flex-col gap-4">
                  {hidden}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo
                      rotulo="Nome do público"
                      name="nome"
                      defaultValue={p?.nome ?? ""}
                      required
                      className="sm:col-span-2"
                      placeholder={tipo === "funil" ? "Ex.: Pagantes" : tipo === "site" ? "Ex.: Visitantes do site 30 dias" : "Ex.: Semelhante aos pagantes 1%"}
                    />
                    {tipo === "funil" && (
                      <>
                        <Selecao rotulo="Quem entra" name="segmento" defaultValue={String(def.segmento ?? "pagantes")} className="sm:col-span-2">
                          {Object.entries(SEGMENTOS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Selecao>
                        <Campo
                          rotulo="Só quem se cadastrou nos últimos (dias)"
                          name="dias"
                          type="number"
                          min={1}
                          max={730}
                          defaultValue={def.dias != null ? Number(def.dias) : ""}
                          ajuda="Em branco: todos."
                        />
                      </>
                    )}
                    {tipo === "site" && <Campo rotulo="Visitaram nos últimos (dias)" name="dias" type="number" min={1} max={180} defaultValue={Number(def.dias ?? 30)} required />}
                    {tipo === "semelhante" && (
                      <>
                        <Selecao rotulo="Parecido com" name="origem_publico_id" defaultValue={String(def.origem_publico_id ?? "")} required>
                          <option value="">Escolha um público de clientes ou do site…</option>
                          {(origens ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nome}
                            </option>
                          ))}
                        </Selecao>
                        <Campo
                          rotulo="Semelhança (%)"
                          name="percentual"
                          type="number"
                          min={1}
                          max={10}
                          defaultValue={Number(def.percentual ?? 1)}
                          ajuda="1% = mais parecido; 10% = mais amplo."
                        />
                      </>
                    )}
                  </div>
                </Formulario>
              ) : (
                <p className="text-sm text-ink-2">
                  {travado ? "Este público já existe na Meta e a regra não muda mais. Para outra regra, crie outro público." : "Só gestores editam públicos."}
                </p>
              )}
            </Cartao>

            {p && (
              <aside className="flex flex-col gap-4">
                <Cartao titulo="Na Meta">
                  {tipo === "funil" && tam?.enviados != null ? (
                    <>
                      <div className="num-display text-[28px] text-ink">{tam.enviados.toLocaleString("pt-BR")}</div>
                      <p className="mt-1 text-xs text-ink-3">
                        {tam.enviados === 1 ? "cliente enviado" : "clientes enviados"}
                        {p.enviado_em ? ` em ${dataHora(p.enviado_em, org.fuso)}` : ""}
                      </p>
                    </>
                  ) : (
                    <div className="num-display text-[28px] text-ink">{textoTamanhoMeta(tam) ?? "—"}</div>
                  )}
                  {textoTamanhoMeta(tam) && (
                    <p className="mt-2 text-xs text-ink-2">
                      A Meta encontrou {textoTamanhoMeta(tam)} {tam?.em ? `(lido ${dataHora(tam.em, org.fuso)})` : ""}
                      {(tam?.max ?? tam?.min ?? 0) <= PISO_TAMANHO_META ? ". Por privacidade, ela não informa números abaixo de mil." : "."}
                    </p>
                  )}
                  {tam?.situacao && <p className="mt-2 text-xs text-ink-2">{tam.situacao}</p>}
                  {tipo !== "semelhante" && (tam?.enviados ?? Infinity) < MINIMO_PERSONALIZADO && (
                    <Aviso tom="alerta" className="mt-3">
                      Menos de {MINIMO_PERSONALIZADO} pessoas: a Meta pode não entregar anúncios para este público nem criar semelhantes a partir dele. Como exclusão, funciona.
                    </Aviso>
                  )}
                  {gestor && (
                    <div className="mt-4">
                      <Formulario acao={enviarPublico} rotulo={p.meta_audience_id ? "Atualizar agora" : "Enviar à Meta"} variante="secundario">
                        <input type="hidden" name="organizacao_id" value={org.id} />
                        <input type="hidden" name="id" value={p.id} />
                      </Formulario>
                    </div>
                  )}
                </Cartao>
              </aside>
            )}
          </div>
        )}

        {p && gestor && (
          <div className="border-t border-line pt-5">
            <Formulario
              acao={excluirPublico}
              rotulo="Excluir público"
              variante="perigo"
              confirmar={
                p.meta_audience_id ? "Excluir do Adverdad? O público continua existindo na Meta (o sistema não apaga nada lá) e deixa de ser atualizado." : "Excluir este público?"
              }
            >
              <input type="hidden" name="organizacao_id" value={org.id} />
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="slug" value={slug} />
            </Formulario>
          </div>
        )}
      </div>
    </>
  );
}
