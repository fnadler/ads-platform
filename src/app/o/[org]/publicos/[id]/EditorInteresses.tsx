"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Formulario } from "@/components/Formulario";
import { IconeMais, IconeX } from "@/components/Icones";
import { Aviso, Botao, Campo, Etiqueta } from "@/components/ui";
import type { InteresseMeta } from "@/lib/integracoes/metaEscrita";
import { buscarInteressesAcao, buscarRegioesAcao, estimarAlcanceAcao, salvarPublico } from "@/lib/publicos/acoes";
import type { DefinicaoDetalhado } from "@/lib/publicos/modelo";

// Público de interesses, mais simples que o Gerenciador: busca por palavra → interesses que a Meta realmente
// tem (categoria e tamanho) → adicionar. Estimativa de alcance ao vivo. Nada vai à Meta ao salvar: o público
// entra na campanha quando ela é criada.

const tamanho = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : `${Math.round(n / 1000).toLocaleString("pt-BR")} mil`;

export function EditorInteresses({ orgId, slug, id, nome: nomeInicial, definicao }: { orgId: string; slug: string; id: string; nome: string; definicao: DefinicaoDetalhado }) {
  const [d, setD] = useState<DefinicaoDetalhado>(definicao);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<InteresseMeta[] | null>(null);
  const [termoRegiao, setTermoRegiao] = useState("");
  const [regioes, setRegioes] = useState<Array<{
    key: string;
    nome: string;
  }> | null>(null);
  const [estimativa, setEstimativa] = useState<{
    min: number | null;
    max: number | null;
    erro?: string;
  } | null>(null);
  const [buscando, iniciarBusca] = useTransition();
  const [estimando, iniciarEstimativa] = useTransition();
  const ultima = useRef(0);

  // Reestima ao mudar a definição (com folga para não chamar a Meta a cada clique).
  useEffect(() => {
    const n = ++ultima.current;
    const t = setTimeout(
      () =>
        iniciarEstimativa(async () => {
          const r = await estimarAlcanceAcao(orgId, d);
          if (n === ultima.current) setEstimativa(r);
        }),
      600,
    );
    return () => clearTimeout(t);
  }, [d, orgId]);

  const atualizar = (parcial: Partial<DefinicaoDetalhado>) => setD((x) => ({ ...x, ...parcial }));
  const selecionados = new Set(d.interesses.map((i) => i.id));
  const pequeno = estimativa?.max != null && estimativa.max < 200_000;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-5">
        <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-[550]">Interesses</h2>
          <p className="mt-1 text-sm text-ink-2">
            Digite palavras ligadas ao seu público. A Meta só tem interesses amplos (marcas grandes, hobbies, eventos): perfis pequenos do Instagram não existem como interesse.
            Confira cada resultado antes de adicionar: a busca da Meta é imprecisa.
          </p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              iniciarBusca(async () => setResultados(await buscarInteressesAcao(orgId, termo)));
            }}
          >
            <input
              value={termo}
              onChange={(e) => setTermo(e.currentTarget.value)}
              placeholder="Ex.: Panini, Copa do Mundo, coleção"
              aria-label="Buscar interesse"
              className="min-h-11 flex-1 rounded-md border border-line-strong bg-surface px-3 outline-none focus:border-accent"
            />
            <Botao type="submit" variante="secundario" disabled={buscando || termo.trim().length < 2}>
              {buscando ? "Buscando…" : "Buscar"}
            </Botao>
          </form>
          {resultados && (
            <ul className="mt-3 flex flex-col divide-y divide-line rounded-md border border-line">
              {!resultados.length && <li className="px-3 py-3 text-sm text-ink-2">A Meta não tem interesse para “{termo}”. Tente uma palavra mais ampla.</li>}
              {resultados.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{r.nome}</div>
                    <div className="truncate text-xs text-ink-3">
                      {r.caminho || "Interesse"} · {tamanho(r.tamanho)} no mundo
                    </div>
                  </div>
                  <Botao
                    type="button"
                    variante={selecionados.has(r.id) ? "fantasma" : "secundario"}
                    disabled={selecionados.has(r.id)}
                    onClick={() =>
                      atualizar({
                        interesses: [
                          ...d.interesses,
                          {
                            id: r.id,
                            nome: r.nome,
                            caminho: r.caminho,
                            tamanho: r.tamanho ?? undefined,
                          },
                        ],
                      })
                    }
                  >
                    {selecionados.has(r.id) ? (
                      "Adicionado"
                    ) : (
                      <>
                        <IconeMais tamanho={15} /> Adicionar
                      </>
                    )}
                  </Botao>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {d.interesses.map((i) => (
              <span key={i.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft pl-3 pr-1 text-sm text-accent-text">
                {i.nome}
                <button
                  type="button"
                  aria-label={`Remover ${i.nome}`}
                  className="grid size-7 place-items-center rounded-full hover:bg-surface"
                  onClick={() =>
                    atualizar({
                      interesses: d.interesses.filter((x) => x.id !== i.id),
                    })
                  }
                >
                  <IconeX tamanho={14} />
                </button>
              </span>
            ))}
            {!d.interesses.length && <span className="text-sm text-ink-3">Nenhum interesse: o público fica só por local, idade e gênero.</span>}
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
          <h2 className="text-lg font-[550] sm:col-span-2">Quem e onde</h2>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-[550]">Onde</span>
            <div className="flex flex-wrap gap-2">
              <Etiqueta tom="info">{d.regioes.length ? "Estados escolhidos" : "Brasil inteiro"}</Etiqueta>
              {d.regioes.map((r) => (
                <span key={r.key} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-surface-2 pl-3 pr-1 text-sm">
                  {r.nome}
                  <button
                    type="button"
                    aria-label={`Remover ${r.nome}`}
                    className="grid size-6 place-items-center rounded-full hover:bg-sunken"
                    onClick={() =>
                      atualizar({
                        regioes: d.regioes.filter((x) => x.key !== r.key),
                      })
                    }
                  >
                    <IconeX tamanho={13} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={termoRegiao}
                onChange={(e) => setTermoRegiao(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    buscarRegioesAcao(orgId, termoRegiao).then(setRegioes);
                  }
                }}
                placeholder="Limitar a um estado (ex.: São Paulo)"
                aria-label="Buscar estado"
                className="min-h-11 flex-1 rounded-md border border-line-strong bg-surface px-3 outline-none focus:border-accent"
              />
              <Botao type="button" variante="secundario" onClick={() => buscarRegioesAcao(orgId, termoRegiao).then(setRegioes)}>
                Buscar
              </Botao>
            </div>
            {regioes && (
              <div className="flex flex-wrap gap-2">
                {regioes.map((r) => (
                  <Botao key={r.key} type="button" variante="fantasma" onClick={() => !d.regioes.some((x) => x.key === r.key) && atualizar({ regioes: [...d.regioes, r] })}>
                    <IconeMais tamanho={14} /> {r.nome}
                  </Botao>
                ))}
              </div>
            )}
          </div>
          <Campo rotulo="Idade mínima" type="number" min={18} max={65} value={d.idade_min} onChange={(e) => atualizar({ idade_min: Number(e.currentTarget.value) })} />
          <Campo rotulo="Idade máxima" type="number" min={18} max={65} value={d.idade_max} onChange={(e) => atualizar({ idade_max: Number(e.currentTarget.value) })} />
          <fieldset className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <legend className="mb-1.5 font-[550]">Gênero</legend>
            <div className="flex gap-1 rounded-lg bg-sunken p-1">
              {(["todos", "mulheres", "homens"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => atualizar({ genero: g })}
                  className={`min-h-10 flex-1 rounded-md capitalize ${d.genero === g ? "bg-surface font-medium shadow-card" : "text-ink-2"}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <input type="checkbox" checked={d.advantage} onChange={(e) => atualizar({ advantage: e.currentTarget.checked })} className="mt-0.5 size-4 accent-accent" />
            <span>
              <span className="font-[550]">Usar como sugestão (Advantage+), recomendado</span>
              <span className="block text-xs text-ink-3">
                A Meta começa por esses interesses e amplia para quem tem mais chance de se cadastrar. Desmarcado, a campanha fica presa a eles: costuma custar mais.
              </span>
            </span>
          </label>
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <div className="sobrancelha">Tamanho estimado</div>
          <div className="num-display mt-2 text-[28px] text-ink">
            {estimando && !estimativa ? "…" : estimativa?.min != null ? `${tamanho(estimativa.min)} – ${tamanho(estimativa.max)}` : "—"}
          </div>
          <p className="mt-1 text-xs text-ink-3">
            pessoas por mês que a Meta consegue alcançar com este público
            {estimando ? " · atualizando…" : ""}
          </p>
          {estimativa?.erro && <p className="mt-2 text-xs text-err">{estimativa.erro}</p>}
          {pequeno && (
            <Aviso tom="alerta" className="mt-3">
              Público pequeno: a Meta otimiza pior. Use os interesses como sugestão ou amplie a idade e o local.
            </Aviso>
          )}
        </section>
        <Formulario acao={salvarPublico} rotulo="Salvar público" variante="peso" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-card">
          <input type="hidden" name="organizacao_id" value={orgId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="tipo" value="detalhado" />
          <input type="hidden" name="definicao" value={JSON.stringify(d)} />
          <input
            type="hidden"
            name="estimativa"
            value={JSON.stringify(
              estimativa?.min != null
                ? {
                    min: estimativa.min,
                    max: estimativa.max,
                    em: new Date().toISOString(),
                  }
                : null,
            )}
          />
          <Campo rotulo="Nome do público" name="nome" defaultValue={nomeInicial} placeholder="Ex.: Colecionadores Copa" required />
        </Formulario>
      </aside>
    </div>
  );
}
