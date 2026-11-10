import Link from "next/link";
import type { ReactNode } from "react";
import type { GrupoVisitas, SinaisVisitas } from "@/lib/clarity/campanha";
import { decimal, inteiro, pct } from "@/lib/formato";
import { IconeExclamacao } from "@/components/Icones";
import { Tabela } from "@/components/ui";
import { segundos } from "@/components/MapaRolagem";

// De onde vêm as visitas da campanha e como cada grupo usa a página: por anúncio, por navegador (que diz
// também se a pessoa abriu dentro do Instagram ou do Facebook) e, para comparar, as outras origens do site.
// Grupos com poucas visitas aparecem apagados e não entram nas frases de destaque.

const MINIMO = 10;
const MAX_LINHAS = 8;

const NAVEGADOR: Record<string, string> = {
  InstagramApp: "Dentro do Instagram",
  FacebookApp: "Dentro do Facebook",
  MessengerApp: "Dentro do Messenger",
  ChromeMobile: "Chrome no celular",
  Chrome: "Chrome",
  MobileSafari: "Safari no iPhone",
  Safari: "Safari",
  SamsungInternet: "Samsung Internet",
  EdgeMobile: "Edge no celular",
  Edge: "Edge",
  Firefox: "Firefox",
  FirefoxMobile: "Firefox no celular",
  Opera: "Opera",
  MiuiBrowser: "Navegador da Xiaomi",
  GoogleApp: "App do Google",
};
export const nomeNavegador = (b: string) => NAVEGADOR[b] ?? b;
/** "quem abre dentro do Instagram", "quem abre no Chrome no celular". */
export const quemNoNavegador = (b: string) => {
  const n = nomeNavegador(b);
  return n.startsWith("Dentro") ? `quem abre ${n.charAt(0).toLowerCase()}${n.slice(1)}` : `quem abre no ${n}`;
};

/** Junta vários grupos num só (médias ponderadas pelas visitas de quem tem a métrica). */
export function juntarSinais(gs: SinaisVisitas[]): SinaisVisitas {
  const media = (k: Exclude<keyof SinaisVisitas, "sessoes">) => {
    const com = gs.filter((g) => g[k] !== null);
    const peso = com.reduce((s, g) => s + g.sessoes, 0);
    return peso ? com.reduce((s, g) => s + (g[k] as number) * g.sessoes, 0) / peso : null;
  };
  return {
    sessoes: gs.reduce((s, g) => s + g.sessoes, 0),
    rolagem: media("rolagem"),
    tempoAtivo: media("tempoAtivo"),
    cliqueMorto: media("cliqueMorto"),
    cliqueRaiva: media("cliqueRaiva"),
    voltaRapida: media("voltaRapida"),
    erroScript: media("erroScript"),
    cliqueErro: media("cliqueErro"),
    paginasPorVisita: media("paginasPorVisita"),
  };
}

/** Onde as pessoas abriram o anúncio: dentro do Instagram, do Facebook ou num navegador. */
export function resumoApps(porNavegador: GrupoVisitas[]): string | null {
  const total = porNavegador.reduce((s, g) => s + g.sessoes, 0);
  if (total < MINIMO) return null;
  const de = (b: string) => porNavegador.find((g) => g.chave === b)?.sessoes ?? 0;
  const partes = [
    { n: de("InstagramApp"), t: "dentro do Instagram" },
    { n: de("FacebookApp") + de("MessengerApp"), t: "dentro do Facebook" },
  ];
  partes.push({ n: total - partes[0].n - partes[1].n, t: "num navegador" });
  const ditas = partes.filter((p) => p.n > 0).sort((a, b) => b.n - a.n).map((p) => `${pct(p.n / total, 0)} ${p.t}`);
  return ditas.length ? `Abriram a página ${ditas.length > 1 ? `${ditas.slice(0, -1).join(", ")} e ${ditas.at(-1)}` : ditas[0]}.` : null;
}

export interface LinhaGrupo {
  chave: string;
  nome: ReactNode;
  /** Quem é o grupo, para as frases de destaque: "quem abre dentro do Instagram". */
  quem: string;
  href?: string;
  /** Linha de referência (esta campanha), em negrito e fora das comparações. */
  referencia?: boolean;
  s: SinaisVisitas;
}

/** Até duas frases sobre o grupo que destoa (só entre grupos com visitas suficientes). */
export function destaquesGrupos(linhas: LinhaGrupo[], geral: SinaisVisitas | null): string[] {
  const firmes = linhas.filter((l) => !l.referencia && l.s.sessoes >= MINIMO);
  const frases: string[] = [];
  const comRolagem = firmes.filter((l) => l.s.rolagem !== null).sort((a, b) => b.s.rolagem! - a.s.rolagem!);
  if (comRolagem.length >= 2) {
    const [melhor, pior] = [comRolagem[0], comRolagem.at(-1)!];
    if (melhor.s.rolagem! - pior.s.rolagem! >= 10 && pior.s.rolagem! <= melhor.s.rolagem! * 0.75)
      frases.push(`${maiuscula(pior.quem)} desce em média ${decimal(pior.s.rolagem, 0)}% da página; ${melhor.quem}, ${decimal(melhor.s.rolagem, 0)}%.`);
  }
  const ref = geral?.voltaRapida ?? null;
  const volta = firmes.filter((l) => l.s.voltaRapida !== null).sort((a, b) => b.s.voltaRapida! - a.s.voltaRapida!)[0];
  if (volta && ref !== null && volta.s.voltaRapida! >= 0.1 && volta.s.voltaRapida! >= ref * 1.8)
    frases.push(`${pct(volta.s.voltaRapida, 0)} das visitas de ${volta.quem} voltam logo para o anúncio (na média, ${pct(ref, 0)}).`);
  const erro = firmes.filter((l) => l.s.erroScript !== null).sort((a, b) => b.s.erroScript! - a.s.erroScript!)[0];
  const refErro = geral?.erroScript ?? null;
  if (erro && refErro !== null && erro.s.erroScript! >= 0.1 && erro.s.erroScript! >= refErro * 1.8)
    frases.push(`${pct(erro.s.erroScript, 0)} das visitas de ${erro.quem} têm erro de código na página (na média, ${pct(refErro, 0)}): vale abrir as gravações desse grupo no Clarity.`);
  return frases.slice(0, 2);
}

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fracao = (v: number | null) => (v === null ? "—" : pct(v, 0));

/** Tabela de grupos de visitas; acima de 8 grupos, o resto vira "Outros". */
export function TabelaGrupos({ rotuloColuna, linhas }: { rotuloColuna: string; linhas: LinhaGrupo[] }) {
  const ref = linhas.filter((l) => l.referencia);
  const resto = linhas.filter((l) => !l.referencia);
  const visiveis = resto.length > MAX_LINHAS ? resto.slice(0, MAX_LINHAS - 1) : resto;
  const outros = resto.length > MAX_LINHAS ? resto.slice(MAX_LINHAS - 1) : [];
  const todas: LinhaGrupo[] = [
    ...ref,
    ...visiveis,
    ...(outros.length ? [{ chave: "_outros", nome: `Outros (${outros.length})`, quem: "os outros", s: juntarSinais(outros.map((o) => o.s)) }] : []),
  ];
  return (
    <Tabela>
      <thead>
        <tr>
          <th>{rotuloColuna}</th>
          <th className="text-right">Visitas</th>
          <th className="text-right">Descem, em média</th>
          <th className="text-right">Tempo ativo</th>
          <th className="text-right">Voltaram logo</th>
          <th className="text-right">Clique sem resposta</th>
          <th className="text-right">Erro na página</th>
        </tr>
      </thead>
      <tbody className="[&_td:not(:first-child)]:num [&_td:not(:first-child)]:whitespace-nowrap [&_td:not(:first-child)]:text-right">
        {todas.map((l) => (
          <tr key={l.chave} className={l.referencia ? "bg-accent-soft font-[600]" : l.s.sessoes < MINIMO ? "text-ink-3" : ""}>
            <td className="max-w-[18rem]">
              {l.href ? (
                <Link href={l.href} className="line-clamp-2 text-ink">
                  {l.nome}
                </Link>
              ) : (
                <span className="line-clamp-2">{l.nome}</span>
              )}
            </td>
            <td>{inteiro(l.s.sessoes)}</td>
            <td>{l.s.rolagem === null ? "—" : `${decimal(l.s.rolagem, 0)}%`}</td>
            <td>{segundos(l.s.tempoAtivo)}</td>
            <td>{fracao(l.s.voltaRapida)}</td>
            <td>{fracao(l.s.cliqueMorto)}</td>
            <td>{fracao(l.s.erroScript)}</td>
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}

/** Bloco com título, descrição, frases de destaque e a tabela. */
export function BlocoGrupos({ titulo, descricao, destaques, children }: { titulo: string; descricao?: ReactNode; destaques: string[]; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <header className="flex flex-col gap-1 px-5 pb-4 pt-5">
        <h3 className="text-base font-[600] text-ink">{titulo}</h3>
        {descricao && <p className="max-w-3xl text-sm text-ink-2">{descricao}</p>}
        {destaques.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {destaques.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink">
                <IconeExclamacao tamanho={15} className="mt-0.5 shrink-0 text-warn" />
                {f}
              </li>
            ))}
          </ul>
        )}
      </header>
      {children}
    </section>
  );
}

const SINAIS: Array<{ k: "cliqueMorto" | "cliqueRaiva" | "erroScript" | "cliqueErro"; rotulo: string; explica: string; alerta: number }> = [
  { k: "cliqueMorto", rotulo: "Clicaram em algo que não respondeu", explica: "uma imagem ou texto que parece botão, mas não é", alerta: 0.15 },
  { k: "cliqueRaiva", rotulo: "Clicaram várias vezes seguidas", explica: "sinal de irritação: o botão demora ou não funciona", alerta: 0.05 },
  { k: "erroScript", rotulo: "Tiveram erro de código na página", explica: "algo da página quebrou no aparelho da pessoa", alerta: 0.1 },
  { k: "cliqueErro", rotulo: "Clicaram e deu erro", explica: "o clique disparou um erro (botão, formulário)", alerta: 0.03 },
];

/** O que deu errado durante as visitas da campanha. Acima do limite, a linha ganha o ícone de atenção. */
export function SinaisProblema({ s, gravacoes, compacto }: { s: SinaisVisitas; gravacoes?: string | null; compacto?: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-[600] text-ink">Sinais de problema na página</h3>
        {gravacoes && (
          <a href={gravacoes} target="_blank" rel="noreferrer" className="text-sm font-[550] text-accent-text">
            Ver as gravações no Clarity
          </a>
        )}
      </div>
      <ul className={`grid gap-x-6 gap-y-3 ${compacto ? "" : "sm:grid-cols-2"}`}>
        {SINAIS.map(({ k, rotulo, explica, alerta }) => {
          const v = s[k];
          const atencao = v !== null && v >= alerta;
          return (
            <li key={k} className="flex items-start gap-3">
              <span className={`num-display w-12 shrink-0 text-right text-lg ${atencao ? "text-warn" : "text-ink"}`}>{fracao(v)}</span>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  {atencao && <IconeExclamacao tamanho={14} className="shrink-0 text-warn" role="img" aria-hidden={false} aria-label="pede atenção" />}
                  {rotulo}
                </span>
                <span className="text-xs text-ink-3">{explica}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3">Porcentagem das visitas da campanha em que isso aconteceu pelo menos uma vez.</p>
    </section>
  );
}
