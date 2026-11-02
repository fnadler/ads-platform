import { IconeSeta } from "@/components/Icones";
import { BotaoLink, Etiqueta, Titulo } from "@/components/ui";
import { exigirOrganizacao } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { lerFatos } from "@/lib/onboarding/fatos";
import { configuracaoEmAndamento, progresso, telas, telaInicial } from "@/lib/onboarding/modelo";
import { avaliarParametros } from "@/lib/rastreio/regras";
import { rotaOrg } from "@/lib/rotas";
import { PLATAFORMAS_VENDA, TIPOS_PLATAFORMA } from "@/lib/vendas/plataformas/catalogo";

// Início: o que falta para a campanha nascer rastreada, na ordem em que precisa acontecer.
export default async function InicioOrganizacao({ params }: PageProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, supabase } = await exigirOrganizacao(slug);
  const [
    { data: conexoes },
    { data: contas },
    { data: sinc },
    { data: anuncios },
    { data: teste },
    { count: leads },
    { data: ultimoLead },
    { count: vendas },
    { count: vendasComAnuncio },
  ] = await Promise.all([
    supabase.from("conexoes").select("tipo, status").eq("organizacao_id", org.id),
    supabase.from("contas_anuncio").select("account_id").eq("organizacao_id", org.id).eq("ativa", true),
    supabase
      .from("sincronizacoes")
      .select("status, terminado_em")
      .eq("organizacao_id", org.id)
      .eq("tipo", "meta")
      .eq("status", "ok")
      .order("terminado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("meta_anuncios").select("url_tags, status").eq("organizacao_id", org.id).in("status", ["ACTIVE", "PENDING_REVIEW", "PREAPPROVED", "IN_PROCESS"]),
    supabase.from("verificacoes_rastreio").select("status, verificado_em").eq("organizacao_id", org.id).order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).is("codigo_teste", null),
    supabase.from("leads").select("recebido_em").eq("organizacao_id", org.id).order("recebido_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("vendas").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).eq("tipo", "pagamento"),
    supabase.from("vendas").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).eq("tipo", "pagamento").not("utm_ad_id", "is", null),
  ]);
  const fatos = await lerFatos(supabase, org.id, org.onboarding);
  const continuar = configuracaoEmAndamento(fatos, (leads ?? 0) > 0 || (vendas ?? 0) > 0);
  const retomar = telas(fatos).find((t) => t.id === telaInicial(fatos));
  const conexao = (tipo: string) => conexoes?.find((c) => c.tipo === tipo);
  const plataformas = TIPOS_PLATAFORMA.flatMap((t) => (conexao(t) ? [{ rotulo: PLATAFORMAS_VENDA[t].rotulo, ativa: conexao(t)!.status === "ativa" }] : []));
  const fonteOk = conexao("webhook")?.status === "ativa" || conexao("stripe")?.status === "ativa" || plataformas.some((p) => p.ativa);
  const direta = org.funil === "venda_direta";
  const semRastreio = (anuncios ?? []).filter((a) => avaliarParametros(a.url_tags, { checkout: plataformas.length > 0 }).status === "erro").length;
  const r = (resto: string) => rotaOrg(slug, resto);

  const passos: Array<{ ok: boolean; titulo: string; detalhe: string; href: string }> = [
    {
      ok: conexao("meta")?.status === "ativa" && !!contas?.length,
      titulo: "Conectar a Meta e ligar a conta de anúncios",
      detalhe: contas?.length ? `${contas.length} conta(s) ligada(s)` : "Token do usuário do sistema",
      href: r("/configuracoes"),
    },
    {
      ok: fonteOk,
      titulo: "Conectar a fonte de venda",
      detalhe:
        [conexao("webhook") && "webhook", conexao("stripe") && `Stripe (${conexao("stripe")!.status})`, ...plataformas.map((p) => p.rotulo)].filter(Boolean).join(" · ") ||
        "Hotmart, Kiwify, Stripe, webhook ou CSV",
      href: r("/configuracoes"),
    },
    {
      ok: !!anuncios?.length && semRastreio === 0,
      titulo: "Parâmetros de URL em todos os anúncios",
      detalhe: !anuncios?.length ? "Nenhum anúncio ativo ou em análise lido ainda" : semRastreio ? `${semRastreio} anúncio(s) sem rastreio` : `${anuncios.length} anúncio(s) ok`,
      href: r("/rastreio"),
    },
    ...(direta
      ? []
      : [
          {
            ok: teste?.status === "ok",
            titulo: "Teste de ponta a ponta",
            detalhe: teste
              ? teste.status === "ok"
                ? `OK em ${dataHora(teste.verificado_em, org.fuso)}`
                : teste.status === "problema"
                  ? "Com problema"
                  : "Aguardando o lead de teste"
              : "Ainda não feito",
            href: r("/rastreio"),
          },
        ]),
    {
      ok: !!sinc,
      titulo: "Primeira sincronização da Meta",
      detalhe: sinc ? `Última: ${dataHora(sinc.terminado_em, org.fuso)}` : "Na fila ou não iniciada",
      href: r("/sincronizacoes"),
    },
    direta
      ? {
          ok: (vendasComAnuncio ?? 0) > 0,
          titulo: "Vendas chegando com o anúncio",
          detalhe: `${vendas ?? 0} venda(s), ${vendasComAnuncio ?? 0} com anúncio de origem`,
          href: r("/vendas"),
        }
      : {
          ok: (leads ?? 0) > 0,
          titulo: "Leads chegando",
          detalhe: `${leads ?? 0} lead(s), ${vendas ?? 0} venda(s)${ultimoLead ? ` · último ${dataHora(ultimoLead.recebido_em, org.fuso)}` : ""}`,
          href: r("/vendas"),
        },
  ];
  const prontos = passos.filter((p) => p.ok).length;
  const proximo = passos.find((p) => !p.ok);
  const ROTULO_ACAO: Record<string, string> = {
    "/configuracoes": "Abrir Configurações",
    "/rastreio": "Abrir Rastreio",
    "/sincronizacoes": "Ver Sincronizações",
    "/vendas": "Ver Leads e vendas",
  };
  const acao = (href: string) => ROTULO_ACAO[href.replace(r(""), "")] ?? "Abrir";
  const faltam = passos.length - prontos;

  return (
    <>
      <Titulo
        sobrancelha="Início"
        descricao={
          faltam
            ? `${faltam === 1 ? "Falta 1 passo" : `Faltam ${faltam} passos`}. O rastreio precisa estar certo antes de a campanha começar.`
            : "Tudo pronto: a campanha está rastreada do anúncio à venda."
        }
        acoes={
          <div className="flex flex-col items-end gap-2">
            <span className="text-sm font-semibold text-ink">
              <span className="num-display text-3xl">{prontos}</span> de {passos.length} prontos
            </span>
            <div className="flex gap-1" aria-hidden="true">
              {passos.map((p) => (
                <span key={p.titulo} className={`h-1.5 w-8 rounded-full ${p.ok ? "bg-ok" : "bg-line-strong"}`} />
              ))}
            </div>
          </div>
        }
      >
        Pronto para a campanha?
      </Titulo>
      {continuar && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-accent bg-accent-soft p-5">
          <div className="min-w-0">
            <span className="sobrancelha">Configuração em andamento · {progresso(fatos)}%</span>
            <p className="mt-1 text-lg font-semibold text-ink">{progresso(fatos) ? "Continue de onde parou" : "Vamos ligar seus anúncios às suas vendas"}</p>
            <p className="text-sm text-ink-2">{retomar ? `Próximo passo: ${retomar.titulo}` : "Cada passo é conferido pelo sistema, e você pode parar e voltar quando quiser."}</p>
          </div>
          <BotaoLink href={r("/configurar")} variante="peso" className="max-sm:w-full">
            {progresso(fatos) ? "Continuar" : "Começar"}
            <IconeSeta tamanho={16} />
          </BotaoLink>
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <ol className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {passos.map((p, i) => {
            const atual = p === proximo;
            return (
              <li key={p.titulo} className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4 first:border-t-0 ${atual ? "bg-accent-soft" : ""}`}>
                <span className={`num-display w-6 text-[28px] leading-none ${p.ok ? "text-line-strong" : "text-ink"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{p.titulo}</span>
                    <Etiqueta tom={p.ok ? "ok" : atual ? "alerta" : "info"}>{p.ok ? "Feito" : "Falta"}</Etiqueta>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{p.detalhe}</p>
                </div>
                <BotaoLink href={p.href} variante={atual ? "primario" : "secundario"} className="max-sm:w-full">
                  {acao(p.href)}
                  <IconeSeta tamanho={16} />
                </BotaoLink>
              </li>
            );
          })}
        </ol>
        <aside className="flex flex-col gap-4 rounded-lg bg-chrome p-6 text-chrome-ink">
          <span className="sobrancelha !text-chrome-ink-2">Por que isso importa</span>
          <p className="text-xl font-bold leading-tight tracking-[-0.01em]">Atribuição que não foi capturada não se recupera.</p>
          <p className="text-sm text-chrome-ink-2">
            Se um anúncio roda sem parâmetros ou a venda não chega com a origem, aquele dinheiro fica sem resposta para sempre. Feche os passos antes de ativar a campanha.
          </p>
          {proximo ? (
            <BotaoLink href={proximo.href} variante="peso" className="mt-2 justify-start">
              Próximo: {proximo.titulo}
              <IconeSeta tamanho={16} />
            </BotaoLink>
          ) : (
            <BotaoLink href={r("/desempenho")} variante="peso" className="mt-2 justify-start">
              Ver Desempenho
              <IconeSeta tamanho={16} />
            </BotaoLink>
          )}
        </aside>
      </div>
    </>
  );
}
