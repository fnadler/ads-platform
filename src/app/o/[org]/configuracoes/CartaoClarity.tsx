import type { SupabaseClient } from "@supabase/supabase-js";
import { Formulario } from "@/components/Formulario";
import { Aviso, Campo, Cartao, Etiqueta, Tabela, type Tom } from "@/components/ui";
import { coletarClarityAgora, conectarClarity, removerConexao } from "@/lib/conexoes/acoes";
import { data, dataHora, decimal } from "@/lib/formato";

// Microsoft Clarity: experiência na página de destino. Conexão (ID do projeto + token da Data Export API),
// as últimas coletas e o que a leitura total mais recente trouxe.

const STATUS: Record<string, { rotulo: string; tom: Tom }> = {
  ativa: { rotulo: "Ativa", tom: "ok" },
  pendente: { rotulo: "Pendente", tom: "alerta" },
  erro: { rotulo: "Com erro", tom: "erro" },
  desativada: { rotulo: "Desativada", tom: "info" },
};

interface Coleta {
  id: string;
  coletado_em: string;
  dimensoes: string[];
  dia: string | null;
  linhas: number;
  cortada: boolean;
}

const RECORTE: Record<string, string> = { "": "Total", "Source,Medium,Campaign": "Origem da visita", "URL,Device": "Página × dispositivo", "URL,Device,Browser": "Página × dispositivo × navegador" };
const valor = (v: unknown) => (typeof v === "number" ? decimal(v, Number.isInteger(v) ? 0 : 2) : String(v ?? "—"));

export async function CartaoClarity({ orgId, dono, gestor, fuso, supabase }: { orgId: string; dono: boolean; gestor: boolean; fuso: string; supabase: SupabaseClient }) {
  const [{ data: conexao }, { data: coletas }] = await Promise.all([
    supabase.from("conexoes").select("id, status, ultimo_erro, validado_em, config").eq("organizacao_id", orgId).eq("tipo", "clarity").maybeSingle(),
    supabase.from("clarity_coletas").select("id, coletado_em, dimensoes, dia, linhas, cortada").eq("organizacao_id", orgId).order("coletado_em", { ascending: false }).limit(9),
  ]);
  const ultimaTotal = (coletas as Coleta[] | null)?.find((c) => c.dimensoes.length === 0);
  const { data: metricas } = ultimaTotal
    ? await supabase.from("clarity_metricas").select("metrica, valores").eq("coleta_id", ultimaTotal.id).order("metrica")
    : { data: null };
  const projeto = (conexao?.config as { projeto_id?: string } | undefined)?.projeto_id;
  const hidden = <input type="hidden" name="organizacao_id" value={orgId} />;
  const etiqueta = conexao ? <Etiqueta tom={STATUS[conexao.status].tom}>{STATUS[conexao.status].rotulo}</Etiqueta> : <Etiqueta>Não conectado</Etiqueta>;

  return (
    <Cartao
      titulo="Microsoft Clarity (experiência na página)"
      descricao="Rolagem, tempo de engajamento, cliques sem resposta e erros na página de destino. Coletado toda madrugada; o Clarity só guarda os últimos 3 dias para exportação, então o histórico é montado aqui."
      acoes={etiqueta}
    >
      {conexao?.ultimo_erro && (
        <Aviso tom="erro" className="mb-4">
          {conexao.ultimo_erro}
        </Aviso>
      )}
      {conexao && projeto && (
        <p className="mb-4 text-sm text-ink-2">
          Projeto: <code className="text-ink">{projeto}</code> ·{" "}
          <a className="font-[550] text-accent-text underline-offset-2 hover:underline" href={`https://clarity.microsoft.com/projects/view/${projeto}/dashboard`} target="_blank" rel="noreferrer">
            abrir o painel e as gravações
          </a>
          {conexao.validado_em && <> · token validado em {dataHora(conexao.validado_em, fuso)}</>}
        </p>
      )}

      {dono && (
        <details className="mb-4" open={!conexao || conexao.status !== "ativa"}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">{conexao ? "Trocar o projeto ou o token" : "Conectar"}</summary>
          <ol className="my-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>
              Instale o Clarity na página de destino (o script de Settings → Setup). Para filtrar as gravações por anúncio, marque a sessão com{" "}
              <code>clarity(&quot;set&quot;, &quot;ad_id&quot;, …)</code> a partir dos UTMs.
            </li>
            <li>
              Em Settings → Data Export → <strong>Generate new API token</strong> (só administradores do projeto). Copie o token na hora: ele não aparece de novo.
            </li>
            <li>Cole abaixo o ID do projeto (ou o script inteiro) e o token. O token é validado com uma consulta e guardado cifrado.</li>
          </ol>
          <Formulario acao={conectarClarity} rotulo="Validar e salvar" className="grid gap-3">
            {hidden}
            <Campo rotulo="ID do projeto" name="projeto" autoComplete="off" defaultValue={projeto ?? ""} placeholder="z9fvwq0b1n" required />
            <Campo
              rotulo="Token da Data Export API"
              name="token"
              type="password"
              autoComplete="off"
              placeholder={conexao ? "(mantém o atual se ficar vazio)" : "eyJhbGciOi…"}
              ajuda="O Clarity permite 10 consultas por projeto por dia. A validação usa 1, e a coleta diária usa 3."
            />
          </Formulario>
        </details>
      )}

      {!!coletas?.length && (
        <div className="mb-4">
          <Tabela>
            <thead>
              <tr>
                <th>Coletado em</th>
                <th>Cobre</th>
                <th>Recorte</th>
                <th>Linhas</th>
              </tr>
            </thead>
            <tbody>
              {(coletas as Coleta[]).map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{dataHora(c.coletado_em, fuso)}</td>
                  <td className="whitespace-nowrap text-ink-2">{c.dia ? `dia ${data(c.dia)}` : "últimas 24 h"}</td>
                  <td>{RECORTE[c.dimensoes.join(",")] ?? c.dimensoes.join(" × ")}</td>
                  <td>
                    {c.linhas}
                    {c.cortada && <span className="text-xs text-warn"> · cortada em 1.000</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </div>
      )}

      {!!metricas?.length && ultimaTotal && (
        <details className="mb-4">
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-[550] text-accent-text">
            O que a última leitura total trouxe ({dataHora(ultimaTotal.coletado_em, fuso)})
          </summary>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {(metricas as Array<{ metrica: string; valores: Record<string, unknown> }>).map((m, i) => (
              <div key={`${m.metrica}-${i}`} className="rounded-md border border-line p-3">
                <dt className="font-medium">{m.metrica}</dt>
                <dd className="mt-1 text-ink-2">
                  {Object.entries(m.valores).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="font-mono text-xs">{k}</span>
                      <span className="text-ink">{valor(v)}</span>
                    </div>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        {conexao?.status === "ativa" && gestor && (
          <Formulario
            acao={coletarClarityAgora}
            rotulo="Coletar agora (últimas 24 h)"
            variante="secundario"
            confirmar="Usa 3 das 10 consultas diárias do Clarity. A coleta automática da madrugada continua. Coletar agora?"
          >
            {hidden}
          </Formulario>
        )}
        {conexao && dono && (
          <Formulario acao={removerConexao} rotulo="Remover conexão" variante="perigo" confirmar="Remover a conexão com o Clarity? As coletas já guardadas ficam.">
            {hidden}
            <input type="hidden" name="id" value={conexao.id} />
          </Formulario>
        )}
      </div>
    </Cartao>
  );
}
