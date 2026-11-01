import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { ErroMeta } from "@/lib/integracoes/meta";
import { ClienteMetaEscrita, lerPublicoPersonalizado, linkTermosPublicos } from "@/lib/integracoes/metaEscrita";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";
import { DefinicaoFunil, lotesListaClientes, payloadPublicoPersonalizado, type Publico } from "./modelo";

// Público personalizado na Meta (job da fila, alvo = id do público): cria se ainda não existe e, se for do
// funil, troca a lista de clientes inteira (só hashes SHA-256). Roda ao salvar e todo dia (agendar_publicos).
// Lista de clientes exige o aceite do dono no sistema e os termos de público personalizado na conta.

const PAGINA = 1000;

async function membrosDoFunil(admin: SupabaseClient, org: string, segmento: string, dias: number | null) {
  const todos: Array<{ email_hash: string | null; telefone_hash: string | null }> = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin.rpc("membros_publico_funil", { p_org: org, p_segmento: segmento, p_dias: dias }).range(de, de + PAGINA - 1);
    if (error) throw new Error(`Lista do funil: ${error.message}`);
    todos.push(...((data ?? []) as typeof todos));
    if ((data?.length ?? 0) < PAGINA) return todos;
  }
}

export async function executarPublico(admin: SupabaseClient, s: Sincronizacao): Promise<ResultadoJob> {
  const [{ data: p }, { data: config }, { data: conexao }] = await Promise.all([
    admin.from("publicos").select("*").eq("id", s.alvo).eq("organizacao_id", s.organizacao_id).maybeSingle(),
    admin.from("config_publicacao").select("*").eq("organizacao_id", s.organizacao_id).maybeSingle(),
    admin.from("conexoes").select("id").eq("organizacao_id", s.organizacao_id).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  if (!p) return { status: "pronto", linhas: 0 }; // apagado depois de enfileirado
  const publico = p as Publico & { organizacao_id: string };
  const atualizar = (campos: Record<string, unknown>) => admin.from("publicos").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", publico.id);

  try {
    if (publico.tipo === "detalhado") return { status: "pronto", linhas: 0 };
    if (!config?.account_id) throw new Error("Configure a conta de anúncios em Configurações → Meta (publicação).");
    if (publico.tipo === "funil" && !config.aceite_publicos_clientes_em)
      throw new Error("O dono da organização precisa autorizar o uso de dados de clientes em públicos (Configurações → Meta (publicação)).");
    const segredo = conexao ? await lerSegredo<SegredoMeta>(admin, s.organizacao_id, conexao.id) : null;
    if (!segredo) throw new Error("Organização sem conexão de publicação na Meta.");
    const meta = new ClienteMetaEscrita({ token: segredo.token, admin, organizacaoId: s.organizacao_id });
    await atualizar({ situacao: "enviando", erro: null });

    let audienceId = publico.meta_audience_id;
    if (!audienceId) {
      let origemMetaId: string | null = null;
      if (publico.tipo === "semelhante") {
        const { data: origem } = await admin
          .from("publicos")
          .select("meta_audience_id")
          .eq("id", (publico.definicao as { origem_publico_id?: string }).origem_publico_id ?? "")
          .eq("organizacao_id", s.organizacao_id)
          .maybeSingle();
        origemMetaId = origem?.meta_audience_id ?? null;
      }
      audienceId = await meta.criarPublico(config.account_id, payloadPublicoPersonalizado(publico, { pixelId: config.pixel_id, origemMetaId }));
      await atualizar({ meta_audience_id: audienceId });
    }

    let linhas = 0;
    if (publico.tipo === "funil") {
      const d = DefinicaoFunil.parse(publico.definicao);
      const { schema, lotes, total } = lotesListaClientes(await membrosDoFunil(admin, s.organizacao_id, d.segmento, d.dias));
      await meta.substituirListaClientes(audienceId, schema, lotes, total);
      linhas = total;
      await atualizar({ enviado_em: new Date().toISOString() });
    }

    const tamanho = await lerPublicoPersonalizado(segredo.token, audienceId).catch(() => null);
    await atualizar({ situacao: "pronto", erro: null, ...(tamanho ? { meta_tamanho: { min: tamanho.min, max: tamanho.max, situacao: tamanho.entrega ?? tamanho.operacao, em: new Date().toISOString() } } : {}) });
    return { status: "pronto", linhas };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ErroMeta && /terms|termos|tos/i.test(msg) && config?.account_id)
      msg = `A conta de anúncios ainda não aceitou os termos de público personalizado da Meta. Aceite em ${linkTermosPublicos(config.account_id)} e tente de novo.`;
    await atualizar({ situacao: "erro", erro: msg });
    throw e instanceof ErroMeta ? new ErroMeta(msg, e.codigo) : new Error(msg);
  }
}
