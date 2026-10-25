import Link from "next/link";
import { Cartao, Etiqueta, Titulo } from "@/components/ui";
import { exigirOrganizacao } from "@/lib/auth/sessao";
import { dataHora } from "@/lib/formato";
import { avaliarParametros } from "@/lib/rastreio/regras";
import { rotaOrg } from "@/lib/rotas";

// Início: o que falta para a campanha nascer rastreada, na ordem em que precisa acontecer.
export default async function InicioOrganizacao({ params }: PageProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, supabase } = await exigirOrganizacao(slug);
  const [{ data: conexoes }, { data: contas }, { data: sinc }, { data: anuncios }, { data: teste }, { count: leads }, { data: ultimoLead }, { count: vendas }] = await Promise.all([
    supabase.from("conexoes").select("tipo, status").eq("organizacao_id", org.id),
    supabase.from("contas_anuncio").select("account_id").eq("organizacao_id", org.id).eq("ativa", true),
    supabase.from("sincronizacoes").select("status, terminado_em").eq("organizacao_id", org.id).eq("tipo", "meta").eq("status", "ok").order("terminado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("meta_anuncios").select("url_tags, status").eq("organizacao_id", org.id).in("status", ["ACTIVE", "PENDING_REVIEW", "PREAPPROVED", "IN_PROCESS"]),
    supabase.from("verificacoes_rastreio").select("status, verificado_em").eq("organizacao_id", org.id).order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id).is("codigo_teste", null),
    supabase.from("leads").select("recebido_em").eq("organizacao_id", org.id).order("recebido_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("vendas").select("*", { count: "exact", head: true }).eq("organizacao_id", org.id),
  ]);
  const conexao = (tipo: string) => conexoes?.find((c) => c.tipo === tipo);
  const fonteOk = conexao("webhook")?.status === "ativa" || conexao("stripe")?.status === "ativa";
  const semRastreio = (anuncios ?? []).filter((a) => avaliarParametros(a.url_tags).status === "erro").length;
  const r = (resto: string) => rotaOrg(slug, resto);

  const passos: Array<{ ok: boolean; titulo: string; detalhe: string; href: string }> = [
    { ok: conexao("meta")?.status === "ativa" && !!contas?.length, titulo: "Conectar a Meta e ligar a conta de anúncios", detalhe: contas?.length ? `${contas.length} conta(s) ligada(s)` : "Token do usuário do sistema", href: r("/configuracoes") },
    { ok: fonteOk, titulo: "Conectar a fonte de venda", detalhe: [conexao("webhook") && "webhook", conexao("stripe") && `Stripe (${conexao("stripe")!.status})`].filter(Boolean).join(" · ") || "Webhook, Stripe ou CSV", href: r("/configuracoes") },
    {
      ok: !!anuncios?.length && semRastreio === 0,
      titulo: "Parâmetros de URL em todos os anúncios",
      detalhe: !anuncios?.length ? "Nenhum anúncio ativo ou em análise lido ainda" : semRastreio ? `${semRastreio} anúncio(s) sem rastreio` : `${anuncios.length} anúncio(s) ok`,
      href: r("/rastreio"),
    },
    { ok: teste?.status === "ok", titulo: "Teste de ponta a ponta", detalhe: teste ? (teste.status === "ok" ? `OK em ${dataHora(teste.verificado_em, org.fuso)}` : teste.status === "problema" ? "Com problema" : "Aguardando o lead de teste") : "Ainda não feito", href: r("/rastreio") },
    { ok: !!sinc, titulo: "Primeira sincronização da Meta", detalhe: sinc ? `Última: ${dataHora(sinc.terminado_em, org.fuso)}` : "Na fila ou não iniciada", href: r("/sincronizacoes") },
    { ok: (leads ?? 0) > 0, titulo: "Leads chegando", detalhe: `${leads ?? 0} lead(s), ${vendas ?? 0} venda(s)${ultimoLead ? ` · último ${dataHora(ultimoLead.recebido_em, org.fuso)}` : ""}`, href: r("/vendas") },
  ];
  const prontos = passos.filter((p) => p.ok).length;

  return (
    <>
      <Titulo descricao="Saiba quais anúncios trazem venda, não só conversa, e o que fazer a seguir.">{org.nome}</Titulo>
      <Cartao titulo="Pronto para a campanha?" descricao={`${prontos} de ${passos.length} passos concluídos. O rastreio precisa estar certo antes de a campanha começar: atribuição que não foi capturada não se recupera.`}>
        <ol className="divide-y divide-borda">
          {passos.map((p, i) => (
            <li key={p.titulo}>
              <Link href={p.href} className="flex items-center gap-3 py-3 hover:text-marca">
                <span className="w-5 text-sm text-suave">{i + 1}.</span>
                <span className="flex-1">
                  <span className="font-medium">{p.titulo}</span>
                  <span className="block text-sm text-suave">{p.detalhe}</span>
                </span>
                <Etiqueta tom={p.ok ? "ok" : "alerta"}>{p.ok ? "Feito" : "Falta"}</Etiqueta>
              </Link>
            </li>
          ))}
        </ol>
      </Cartao>
    </>
  );
}
