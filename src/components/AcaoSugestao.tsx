"use client";

import { useActionState, useState } from "react";
import type { ContextoAcoes } from "@/app/o/[org]/desempenho/carregar";
import { moeda as formatarMoeda } from "@/lib/formato";
import type { AcaoExecutavel } from "@/lib/leitura/modelo";
import { ajustarVerba, pausarAnuncio, reativarAnuncio, testarAnuncios } from "@/lib/publicacao/acoesCampanha";
import { nomeConjuntoTeste, verbaSugeridaTeste } from "@/lib/publicacao/ajustes";
import type { Resultado } from "./Formulario";
import { Modal } from "./Modal";
import { Aviso, Botao } from "./ui";

// O botão de uma sugestão que a plataforma consegue executar na Meta. Abre uma confirmação dizendo
// exatamente o que vai acontecer (o que é criado, quanto gasta, até quando) antes de mexer em qualquer coisa.

export type AcaoTela = AcaoExecutavel | { tipo: "reativar_anuncio"; anuncio: string };

const ROTULO: Record<AcaoTela["tipo"], string> = {
  testar_anuncios: "Testar com verba própria",
  pausar_anuncio: "Pausar este anúncio",
  reativar_anuncio: "Reativar anúncio",
  ajustar_verba: "Ajustar a verba",
};

const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

export function BotaoAcao({
  acao,
  ctx,
  variante = "peso",
  className,
  rotulo,
}: {
  acao: AcaoTela;
  ctx: ContextoAcoes;
  variante?: "peso" | "secundario" | "fantasma";
  className?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  // Remonta o formulário a cada abertura (limpa o resultado anterior).
  const [vez, setVez] = useState(0);
  if (!ctx.podeAgir) return null;
  return (
    <>
      <Botao
        type="button"
        variante={variante}
        className={className}
        onClick={() => {
          setVez((v) => v + 1);
          setAberto(true);
        }}
      >
        {rotulo ?? ROTULO[acao.tipo]}
      </Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo={ROTULO[acao.tipo]}>
        {acao.tipo === "testar_anuncios" && <FormTestar key={vez} acao={acao} ctx={ctx} fechar={() => setAberto(false)} />}
        {acao.tipo === "pausar_anuncio" && <FormAnuncio key={vez} pausar anuncio={acao.anuncio} ctx={ctx} fechar={() => setAberto(false)} />}
        {acao.tipo === "reativar_anuncio" && <FormAnuncio key={vez} anuncio={acao.anuncio} ctx={ctx} fechar={() => setAberto(false)} />}
        {acao.tipo === "ajustar_verba" && <FormVerba key={vez} ctx={ctx} fechar={() => setAberto(false)} />}
      </Modal>
    </>
  );
}

function Retorno({ estado, fechar }: { estado: Resultado; fechar: () => void }) {
  if (!estado) return null;
  return (
    <div className="flex flex-col gap-3">
      <Aviso tom={estado.erro ? "erro" : "ok"}>{estado.erro ?? estado.mensagem}</Aviso>
      {estado.mensagem && (
        <div>
          <Botao type="button" variante="secundario" onClick={fechar}>
            Fechar
          </Botao>
        </div>
      )}
    </div>
  );
}

function Escondidos({ ctx }: { ctx: ContextoAcoes }) {
  return (
    <>
      <input type="hidden" name="organizacao_id" value={ctx.orgId} />
      <input type="hidden" name="campanha" value={ctx.campanha} />
    </>
  );
}

function Passos({ itens }: { itens: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-4">
      <span className="sobrancelha">O que vai acontecer</span>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink">
        {itens.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────────────── Testar anúncios ─────────────────────────────

function FormTestar({ acao, ctx, fechar }: { acao: Extract<AcaoTela, { tipo: "testar_anuncios" }>; ctx: ContextoAcoes; fechar: () => void }) {
  const [estado, enviar, enviando] = useActionState(testarAnuncios, null);
  const opcoes = ctx.anuncios.filter((a) => a.daPlataforma);
  const [escolhidos, setEscolhidos] = useState<string[]>(acao.anuncios.filter((id) => opcoes.some((a) => a.id === id)));
  const tipo = ctx.orcamento?.tipo ?? "diario";
  const sugerida = verbaSugeridaTeste(escolhidos.length, ctx.custoPorMil, tipo);
  const [verbaDigitada, setVerba] = useState<string | null>(null);
  const verba = verbaDigitada === null ? sugerida : Number(verbaDigitada.replace(",", ".")) || 0;
  const [origem, setOrigem] = useState<"tirar" | "somar">("tirar");
  const atual = ctx.orcamento?.valor ?? 0;
  const fim = tipo === "total" ? ddmm(ctx.orcamento?.fim ?? null) : null;
  const nomes = opcoes.filter((a) => escolhidos.includes(a.id)).map((a) => a.nome);
  const f = (v: number) => formatarMoeda(v, ctx.moeda);
  const porDia = tipo === "diario" ? " por dia" : "";

  if (estado?.mensagem) return <Retorno estado={estado} fechar={fechar} />;
  return (
    <form action={enviar} className="flex flex-col gap-5">
      <Escondidos ctx={ctx} />
      <p className="text-sm leading-relaxed text-ink-2">
        A Meta põe quase toda a verba no anúncio que parece melhor no começo, e os outros mal aparecem. Com um conjunto só para eles, cada um aparece o bastante para dizer se
        funciona: a verba sugerida dá para exibir cada anúncio cerca de 3 mil vezes.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-[550] text-ink">Anúncios do teste</legend>
        {opcoes.map((a) => (
          <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line px-3 hover:bg-surface-2">
            <input
              type="checkbox"
              name="anuncio"
              value={a.id}
              checked={escolhidos.includes(a.id)}
              onChange={(e) => setEscolhidos((xs) => (e.target.checked ? [...xs, a.id] : xs.filter((x) => x !== a.id)))}
              className="size-4 accent-[var(--color-accent)]"
            />
            <span className="flex-1 text-sm text-ink">{a.nome}</span>
            <span className="text-xs tabular-nums text-ink-3">{a.impressoes.toLocaleString("pt-BR")} exibições</span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-[550] text-ink">Verba do teste{tipo === "total" ? (fim ? ` (até ${fim})` : "") : " por dia (por 7 dias)"}</span>
        <div className="flex items-center gap-2">
          <span className="text-ink-2">R$</span>
          <input
            name="verba"
            inputMode="decimal"
            value={verbaDigitada ?? String(sugerida)}
            onChange={(e) => setVerba(e.target.value)}
            className="min-h-11 w-32 rounded-md border border-line-strong bg-surface px-3 text-base tabular-nums text-ink outline-none focus:border-accent"
          />
          {verbaDigitada !== null && Number(verbaDigitada) !== sugerida && (
            <button type="button" onClick={() => setVerba(null)} className="text-sm text-accent-text hover:underline">
              Usar a sugerida ({f(sugerida)})
            </button>
          )}
        </div>
      </label>

      {ctx.orcamento && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-[550] text-ink">De onde sai a verba</legend>
          {(
            [
              ["tirar", "Tirar do orçamento atual", `O conjunto atual passa de ${f(atual)} para ${f(Math.max(atual - verba, 0))}${porDia}. O gasto total da campanha não muda.`],
              ["somar", "Somar ao orçamento", `O gasto total da campanha sobe ${f(verba)}${porDia}: de ${f(atual)} para ${f(atual + verba)}${porDia}.`],
            ] as const
          ).map(([valor, titulo, texto]) => (
            <label
              key={valor}
              className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 ${origem === valor ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
            >
              <input type="radio" name="origem" value={valor} checked={origem === valor} onChange={() => setOrigem(valor)} className="mt-1 size-4 accent-[var(--color-accent)]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-[550] text-ink">{titulo}</span>
                <span className="text-sm text-ink-2">{texto}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {nomes.length > 0 && (
        <Passos
          itens={[
            `Criar o conjunto “${nomeConjuntoTeste(ctx.nomeCampanha, nomes)}”, com o mesmo público e a mesma otimização do atual.`,
            `Colocar nele ${nomes.length === 1 ? "o anúncio" : `os ${nomes.length} anúncios`}: ${nomes.join(", ")}. Os anúncios atuais continuam como estão.`,
            `Verba própria de ${f(verba)}${tipo === "total" ? (fim ? ` até ${fim}` : "") : " por dia, por 7 dias"}${origem === "tirar" ? ", tirada do conjunto atual" : ", somada ao orçamento"}.`,
            "Ativar. A Meta analisa os anúncios antes de começar, o que costuma levar alguns minutos.",
          ]}
        />
      )}
      <Retorno estado={estado} fechar={fechar} />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" variante="peso" disabled={enviando || !escolhidos.length || !(verba > 0)}>
          {enviando ? "Criando o teste…" : "Criar e ativar o teste"}
        </Botao>
        <Botao type="button" variante="fantasma" onClick={fechar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

// ───────────────────────────── Pausar / reativar ─────────────────────────────

function FormAnuncio({ anuncio, pausar, ctx, fechar }: { anuncio: string; pausar?: boolean; ctx: ContextoAcoes; fechar: () => void }) {
  const [estado, enviar, enviando] = useActionState(pausar ? pausarAnuncio : reativarAnuncio, null);
  const a = ctx.anuncios.find((x) => x.id === anuncio);
  const outros = ctx.anuncios.filter((x) => x.id !== anuncio && x.ativo).length;
  if (estado?.mensagem) return <Retorno estado={estado} fechar={fechar} />;
  return (
    <form action={enviar} className="flex flex-col gap-5">
      <Escondidos ctx={ctx} />
      <input type="hidden" name="anuncio" value={anuncio} />
      <Passos
        itens={
          pausar
            ? [
                `“${a?.nome ?? anuncio}” para de aparecer agora.`,
                outros
                  ? `${outros === 1 ? "O outro anúncio continua" : `Os outros ${outros} anúncios continuam`} no ar e ficam com a verba dele.`
                  : "É o único anúncio ativo: a campanha para de gastar até você reativar.",
                "Dá para reativar depois, aqui mesmo, no cartão do anúncio.",
              ]
            : [`“${a?.nome ?? anuncio}” volta a aparecer e a disputar a verba com os outros anúncios.`]
        }
      />
      <Retorno estado={estado} fechar={fechar} />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" variante={pausar ? "perigo" : "peso"} disabled={enviando}>
          {enviando ? "Enviando…" : pausar ? "Pausar anúncio" : "Reativar anúncio"}
        </Botao>
        <Botao type="button" variante="fantasma" onClick={fechar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

// ───────────────────────────── Ajustar verba ─────────────────────────────

function FormVerba({ ctx, fechar }: { ctx: ContextoAcoes; fechar: () => void }) {
  const [estado, enviar, enviando] = useActionState(ajustarVerba, null);
  const o = ctx.orcamento;
  const [valor, setValor] = useState(String(o?.valor ?? ""));
  const f = (v: number) => formatarMoeda(v, ctx.moeda);
  if (estado?.mensagem) return <Retorno estado={estado} fechar={fechar} />;
  if (!o) return <Aviso>Não encontrei o orçamento desta campanha.</Aviso>;
  const novo = Number(valor.replace(",", ".")) || 0;
  const variacao = o.valor ? novo / o.valor - 1 : 0;
  return (
    <form action={enviar} className="flex flex-col gap-5">
      <Escondidos ctx={ctx} />
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-2 p-4 text-sm">
        <div>
          <dt className="text-xs text-ink-3">{o.tipo === "total" ? `Orçamento total${o.fim ? ` (até ${ddmm(o.fim)})` : ""}` : "Verba por dia"}</dt>
          <dd className="font-[600] tabular-nums text-ink">{f(o.valor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Já gasto</dt>
          <dd className="font-[600] tabular-nums text-ink">{f(o.gasto)}</dd>
        </div>
        {ctx.teto > 0 && (
          <div className="col-span-2">
            <dt className="text-xs text-ink-3">Teto da organização</dt>
            <dd className="tabular-nums text-ink">{f(ctx.teto)} por dia</dd>
          </div>
        )}
      </dl>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-[550] text-ink">{o.tipo === "total" ? "Novo orçamento total" : "Nova verba por dia"}</span>
        <div className="flex items-center gap-2">
          <span className="text-ink-2">R$</span>
          <input
            name="verba"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="min-h-11 w-32 rounded-md border border-line-strong bg-surface px-3 text-base tabular-nums text-ink outline-none focus:border-accent"
          />
        </div>
      </label>
      {Math.abs(variacao) > 0.2 && (
        <Aviso tom="alerta">Uma mudança de mais de 20% na verba pode fazer a Meta recomeçar o aprendizado por alguns dias. Se puder, mude aos poucos.</Aviso>
      )}
      <Retorno estado={estado} fechar={fechar} />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" variante="peso" disabled={enviando || !(novo > 0) || novo === o.valor}>
          {enviando ? "Salvando…" : "Salvar nova verba"}
        </Botao>
        <Botao type="button" variante="fantasma" onClick={fechar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
