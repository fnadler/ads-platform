import type { Metadata } from "next";
import { Formulario } from "@/components/Formulario";
import { Aviso, Cartao, Etiqueta, Tabela, Titulo, type Tom } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { dataHora, inteiro, moeda, pct, razao } from "@/lib/formato";
import { importarCsv } from "@/lib/vendas/acoes";

export const metadata: Metadata = { title: "Leads e vendas" };

const ATRIBUICAO: Record<string, { rotulo: string; tom: Tom }> = {
  ultimo_toque: { rotulo: "Anúncio (último toque)", tom: "ok" },
  primeiro_toque: { rotulo: "Anúncio (primeiro toque)", tom: "ok" },
  so_campanha: { rotulo: "Só campanha", tom: "alerta" },
  nenhuma: { rotulo: "Sem anúncio", tom: "info" },
};

const hojeMenos = (dias: number, fuso: string) => new Date(Date.now() - dias * 86_400_000).toLocaleDateString("sv-SE", { timeZone: fuso });

export default async function Vendas({ params }: PageProps<"/o/[org]/vendas">) {
  const { org: slug } = await params;
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const [{ data: cobertura }, { data: leads }, { data: vendas }, { data: nomes }] = await Promise.all([
    supabase.rpc("cobertura_atribuicao", { p_org: org.id, p_de: hojeMenos(29, org.fuso), p_ate: hojeMenos(0, org.fuso) }).single<Record<string, number>>(),
    supabase
      .from("leads")
      .select("id_externo, criado_em, utm_source, utm_campaign, utm_content, ad_id, atribuicao, teste_iniciado_em, primeiro_pagamento_em, codigo_teste")
      .eq("organizacao_id", org.id)
      .order("criado_em", { ascending: false })
      .limit(50),
    supabase.from("vendas_atribuidas").select("id_externo, tipo, valor, moeda, ocorrida_em, ad_id, lead_id_externo, origem").eq("organizacao_id", org.id).order("ocorrida_em", { ascending: false }).limit(50),
    supabase.from("meta_anuncios").select("ad_id, nome").eq("organizacao_id", org.id),
  ]);
  const nomeAnuncio = new Map((nomes ?? []).map((n) => [n.ad_id, n.nome]));
  const c = cobertura ?? { leads: 0, leads_com_anuncio: 0, vendas: 0, vendas_com_anuncio: 0, receita: 0, receita_com_anuncio: 0 };
  const coberturaReceita = razao(Number(c.receita_com_anuncio), Number(c.receita));

  return (
    <>
      <Titulo descricao="O que chegou das fontes de venda e quanto disso chega até o anúncio de origem.">Leads e vendas</Titulo>
      <div className="grid gap-6">
        <Cartao titulo="Cobertura de atribuição (30 dias)" descricao="Decisões com cobertura baixa enganam: o que não tem anúncio de origem não aparece no desempenho dos criativos.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-2xl font-semibold">{pct(razao(Number(c.leads_com_anuncio), Number(c.leads)), 0)}</div>
              <div className="text-sm text-suave">
                dos leads com anúncio ({inteiro(Number(c.leads_com_anuncio))} de {inteiro(Number(c.leads))})
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{pct(razao(Number(c.vendas_com_anuncio), Number(c.vendas)), 0)}</div>
              <div className="text-sm text-suave">
                das vendas com anúncio ({inteiro(Number(c.vendas_com_anuncio))} de {inteiro(Number(c.vendas))})
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{pct(coberturaReceita, 0)}</div>
              <div className="text-sm text-suave">
                da receita com anúncio ({moeda(Number(c.receita_com_anuncio), org.moeda)} de {moeda(Number(c.receita), org.moeda)})
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-suave">Inclui vendas de clientes orgânicos e de antes da campanha: cobertura abaixo de 100% é esperada. O que importa é que os leads vindos de anúncio cheguem com o anúncio.</p>
        </Cartao>

        <Cartao titulo="Últimos leads">
          {leads?.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Origem</th>
                  <th>Atribuição</th>
                  <th>Teste</th>
                  <th>Pagante</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id_externo}>
                    <td className="whitespace-nowrap">{dataHora(l.criado_em, org.fuso)}</td>
                    <td className="text-xs">
                      {l.codigo_teste && <Etiqueta tom="alerta">teste de rastreio</Etiqueta>} {l.utm_source ?? "—"}
                      {l.utm_campaign && <div className="text-suave">{l.utm_campaign}</div>}
                    </td>
                    <td className="text-xs">
                      <Etiqueta tom={ATRIBUICAO[l.atribuicao].tom}>{ATRIBUICAO[l.atribuicao].rotulo}</Etiqueta>
                      {l.ad_id && <div className="mt-1 text-suave">{nomeAnuncio.get(l.ad_id) ?? l.ad_id}</div>}
                    </td>
                    <td>{l.teste_iniciado_em ? "sim" : ""}</td>
                    <td>{l.primeiro_pagamento_em ? "sim" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          ) : (
            <Aviso>Nenhum lead recebido ainda. Configure o webhook (Configurações) e faça o teste de ponta a ponta (Rastreio).</Aviso>
          )}
        </Cartao>

        <Cartao titulo="Últimas vendas">
          {vendas?.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Valor</th>
                  <th>Fonte</th>
                  <th>Anúncio</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={`${v.origem}:${v.id_externo}`}>
                    <td className="whitespace-nowrap">{dataHora(v.ocorrida_em, org.fuso)}</td>
                    <td className={v.tipo === "reembolso" ? "text-erro" : ""}>{moeda(Number(v.valor), v.moeda)}</td>
                    <td>{v.origem}</td>
                    <td className="text-xs">{v.ad_id ? (nomeAnuncio.get(v.ad_id) ?? v.ad_id) : <span className="text-suave">sem anúncio</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          ) : (
            <Aviso>Nenhuma venda ainda. Conecte o Stripe (Configurações) ou importe um CSV.</Aviso>
          )}
        </Cartao>

        {temPapel(papel, "gestor") && (
          <Cartao titulo="Importar CSV" descricao="Para vendas que não chegam por webhook. Colunas: id_externo (obrigatória), tipo (lead, venda, reembolso, teste_iniciado), data, valor, lead_id_externo, email e utm_* (inclusive utm_ad_id).">
            <Formulario acao={importarCsv} rotulo="Importar">
              <input type="hidden" name="organizacao_id" value={org.id} />
              <input type="file" name="arquivo" accept=".csv,text/csv" required className="text-sm" />
            </Formulario>
          </Cartao>
        )}
      </div>
    </>
  );
}
