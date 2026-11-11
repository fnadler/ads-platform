import type { Metadata } from "next";
import Link from "next/link";
import { IconeMais } from "@/components/Icones";
import { BotaoLink, Cartao, Etiqueta, Tabela, Titulo, Vazio, type Tom } from "@/components/ui";
import { exigirGestao, temPapel } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { textoTamanhoMeta, TIPOS_PUBLICO, type TipoPublico } from "@/lib/publicos/modelo";
import { rotaOrg } from "@/lib/rotas";

export const metadata: Metadata = { title: "Públicos" };

const SITUACAO: Record<string, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  pronto: { rotulo: "Pronto", tom: "ok" },
  enviando: { rotulo: "Enviando à Meta…", tom: "alerta" },
  erro: { rotulo: "Com erro", tom: "erro" },
};

const NOVOS: Array<{ tipo: TipoPublico; descricao: string }> = [
  {
    tipo: "detalhado",
    descricao: "Local, idade e interesses da Meta (ex.: Coleção, Copa do Mundo, Panini).",
  },
  {
    tipo: "funil",
    descricao: "Seus clientes, pelos dados do sistema: excluir pagantes, reconquistar quem não terminou.",
  },
  {
    tipo: "site",
    descricao: "Quem visitou o site nos últimos dias, pelo pixel.",
  },
  {
    tipo: "semelhante",
    descricao: "Pessoas parecidas com um público seu (ex.: com os pagantes).",
  },
];

export default async function Publicos({ params }: PageProps<"/o/[org]/publicos">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirGestao(slug);
  const { data: publicos } = await supabase
    .from("publicos")
    .select("id, nome, tipo, situacao, estimativa, meta_tamanho, atualizado_em")
    .eq("organizacao_id", org.id)
    .order("tipo")
    .order("nome");

  return (
    <>
      <Titulo
        sobrancelha="Públicos"
        descricao="Monte uma vez e use em várias campanhas. Com mais de um público na campanha, cada um vira um conjunto, e o Desempenho mostra qual vende."
      >
        Para quem anunciar
      </Titulo>
      <div className="grid gap-5">
        {temPapel(papel, "gestor") && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {NOVOS.map((n) => (
              <Link
                key={n.tipo}
                href={rotaOrg(slug, `/publicos/novo?tipo=${n.tipo}`)}
                className="group flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-5 text-ink no-underline shadow-card transition-colors hover:border-accent hover:no-underline"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <IconeMais tamanho={16} className="text-accent-text" /> {TIPOS_PUBLICO[n.tipo]}
                </span>
                <span className="text-sm text-ink-2">{n.descricao}</span>
              </Link>
            ))}
          </div>
        )}
        <Cartao titulo="Públicos salvos" rente>
          {publicos?.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Público</th>
                  <th>Tipo</th>
                  <th className="text-right">Tamanho</th>
                  <th>Situação</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {publicos.map((p) => {
                  const meta = p.meta_tamanho as { min?: number; max?: number; enviados?: number } | null;
                  const tam =
                    p.tipo === "funil" && meta?.enviados != null
                      ? `${meta.enviados.toLocaleString("pt-BR")} enviados`
                      : (textoTamanhoMeta(meta ?? (p.estimativa as { min?: number; max?: number } | null)) ?? "—");
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={rotaOrg(slug, `/publicos/${p.id}`)} className="font-medium text-ink hover:text-accent-text">
                          {p.nome}
                        </Link>
                      </td>
                      <td className="text-ink-2">{TIPOS_PUBLICO[p.tipo as TipoPublico]}</td>
                      <td className="num whitespace-nowrap">{tam}</td>
                      <td>
                        <Etiqueta tom={SITUACAO[p.situacao]?.tom ?? "info"}>{SITUACAO[p.situacao]?.rotulo ?? p.situacao}</Etiqueta>
                      </td>
                      <td className="whitespace-nowrap text-ink-2">{dataHora(p.atualizado_em, org.fuso)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          ) : (
            <div className="px-5 pb-5">
              <Vazio
                titulo="Nenhum público ainda"
                acao={
                  temPapel(papel, "gestor") && (
                    <BotaoLink href={rotaOrg(slug, "/publicos/novo?tipo=detalhado")} variante="peso">
                      Criar o primeiro público
                    </BotaoLink>
                  )
                }
              >
                Comece por interesses (o público que você descreveria para alguém) e, depois, exclua quem já é cliente.
              </Vazio>
            </div>
          )}
        </Cartao>
      </div>
    </>
  );
}
