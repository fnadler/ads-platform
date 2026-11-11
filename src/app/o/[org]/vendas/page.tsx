import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { TabelaLeads, TabelaVendas } from "@/components/ListaLeadsVendas";
import { Aviso, Botao, Cartao, Indicador, Indicadores, Selecao, Titulo, Vazio } from "@/components/ui";
import { exigirOrganizacao, temPapel } from "@/lib/auth/sessao";
import { listarCampanhas } from "@/lib/campanhas/lista";
import { SeletorPeriodo } from "@/components/SeletorPeriodo";
import { Termo } from "@/components/Termo";
import { dataHora, inicioDoDia, inteiro, moeda, pct, razao } from "@/lib/formato";
import { comDias, diaNoFuso, intervalo, lerDias } from "@/lib/periodo";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import { importarCsv } from "@/lib/vendas/acoes";
import { carregarLeadsVendas, SEM_CAMPANHA } from "@/lib/vendas/lista";

export const metadata: Metadata = { title: "Cadastros e vendas" };


export default async function Vendas({ params, searchParams }: PageProps<"/o/[org]/vendas">) {
  const { org: slug } = await params;
  const busca = await searchParams;
  const filtro = typeof busca.campanha === "string" && (busca.campanha === SEM_CAMPANHA || /^\d+$/.test(busca.campanha)) ? busca.campanha : null;
  const dias = lerDias(busca.dias);
  const { org, papel, supabase } = await exigirOrganizacao(slug);
  const { de, ate } = intervalo(dias, org.fuso);
  const [{ data: cobertura }, dados, campanhas] = await Promise.all([
    supabase.rpc("cobertura_atribuicao", { p_org: org.id, p_de: de, p_ate: ate }).single<Record<string, number>>(),
    carregarLeadsVendas(supabase, org.id, { campanha: filtro, desde: inicioDoDia(de, org.fuso) }),
    listarCampanhas(supabase, org.id),
  ]);
  const naMeta = campanhas.filter((c): c is typeof c & { metaId: string } => !!c.metaId);
  const nomeFiltro = filtro === SEM_CAMPANHA ? "Sem campanha" : filtro ? (naMeta.find((c) => c.metaId === filtro)?.nome ?? dados.nomeCampanha.get(filtro) ?? filtro) : null;
  const linkCampanha = (id: string) => comDias(rotaDesempenho(slug, id), dias);
  const linkVendas = (extra: { campanha?: string | null; dias?: number }) =>
    comDias(`${rotaOrg(slug, "/vendas")}${(extra.campanha === undefined ? filtro : extra.campanha) ? `?campanha=${extra.campanha === undefined ? filtro : extra.campanha}` : ""}`, extra.dias ?? dias);
  const comTeste = org.funil === "cadastro_teste_venda";
  const direta = org.funil === "venda_direta";
  // Eventos recusados na última semana (sem isso, uma falha de envio só apareceria no log de quem enviou).
  const { data: recusados, count: totalRecusados } = temPapel(papel, "gestor")
    ? await supabase
        .from("eventos_recebidos")
        .select("erro, recebido_em", { count: "exact" })
        .eq("organizacao_id", org.id)
        .not("erro", "is", null)
        .gte("recebido_em", inicioDoDia(diaNoFuso(7, org.fuso), org.fuso))
        .order("recebido_em", { ascending: false })
        .limit(1)
    : { data: null, count: 0 };
  const c = cobertura ?? { leads: 0, leads_com_anuncio: 0, vendas: 0, vendas_com_anuncio: 0, receita: 0, receita_com_anuncio: 0 };
  const coberturaReceita = razao(Number(c.receita_com_anuncio), Number(c.receita));

  return (
    <>
      <Titulo
        sobrancelha={direta ? "Vendas" : "Cadastros e vendas"}
        descricao="Tudo o que chegou das fontes de venda, de todas as campanhas e também o que veio sem campanha. Para ver uma campanha só, filtre abaixo ou abra a campanha em Desempenho."
        acoes={
          <div className="flex flex-wrap items-end gap-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            {dias !== 7 && <input type="hidden" name="dias" value={dias} />}
            <Selecao rotulo="Campanha" name="campanha" defaultValue={filtro ?? ""} className="min-w-[220px]">
              <option value="">Todas as campanhas</option>
              {naMeta.map((c) => (
                <option key={c.metaId} value={c.metaId}>
                  {c.nome}
                </option>
              ))}
              <option value={SEM_CAMPANHA}>Sem campanha</option>
            </Selecao>
            <Botao type="submit" variante="secundario">
              Ver
            </Botao>
          </form>
          <SeletorPeriodo dias={dias} href={(d) => linkVendas({ dias: d })} />
          </div>
        }
      >
        {nomeFiltro ?? "O que chegou à fonte de venda"}
      </Titulo>
      <div className="grid gap-6">
        {!!totalRecusados && (
          <Aviso tom="erro">
            <strong>{inteiro(totalRecusados)} evento(s) recusado(s) nos últimos 7 dias.</strong> Eles não entraram nos números abaixo. Último erro ({dataHora(recusados?.[0]?.recebido_em, org.fuso)}):{" "}
            <span className="font-mono text-xs">{recusados?.[0]?.erro}</span>
          </Aviso>
        )}
        {filtro && (
          <Aviso>
            Mostrando só {filtro === SEM_CAMPANHA ? "o que chegou sem campanha: clientes orgânicos, de antes da campanha ou de anúncios sem rastreio" : <>a campanha <strong>{nomeFiltro}</strong></>}.{" "}
            {filtro !== SEM_CAMPANHA && (
              <>
                Os números dela estão em <Link href={linkCampanha(filtro)}>Desempenho</Link>.{" "}
              </>
            )}
            <Link href={linkVendas({ campanha: null })}>Ver todas</Link>
          </Aviso>
        )}
        {!filtro && (
        <Cartao titulo={<Termo id="cobertura">{`Cobertura de atribuição · últimos ${dias} dias`}</Termo>} descricao="Decisões com cobertura baixa enganam: o que não tem anúncio de origem não aparece no desempenho dos criativos.">
          <Indicadores className="sm:grid-cols-3">
            <Indicador
              rotulo="Cadastros com anúncio"
              valor={pct(razao(Number(c.leads_com_anuncio), Number(c.leads)), 0)}
              detalhe={`${inteiro(Number(c.leads_com_anuncio))} de ${inteiro(Number(c.leads))}`}
            />
            <Indicador
              rotulo="Vendas com anúncio"
              valor={pct(razao(Number(c.vendas_com_anuncio), Number(c.vendas)), 0)}
              detalhe={`${inteiro(Number(c.vendas_com_anuncio))} de ${inteiro(Number(c.vendas))}`}
            />
            <Indicador
              rotulo="Recebido com anúncio"
              valor={pct(coberturaReceita, 0)}
              detalhe={`${moeda(Number(c.receita_com_anuncio), org.moeda)} de ${moeda(Number(c.receita), org.moeda)}`}
              destaque
            />
          </Indicadores>
          <p className="mt-3 text-sm text-ink-2">Inclui vendas de clientes orgânicos e de antes da campanha: cobertura abaixo de 100% é esperada. O que importa é que os cadastros vindos de anúncio cheguem com o anúncio.</p>
        </Cartao>
        )}

        <Cartao titulo={`Últimos cadastros · ${dias} dias`} rente>
          {dados.leads.length ? (
            <TabelaLeads dados={dados} fuso={org.fuso} linkCampanha={linkCampanha} comTeste={comTeste} />
          ) : (
            <div className="px-5 pb-5">
              <Vazio titulo={`Nenhum cadastro${filtro ? " neste filtro" : ""} nos últimos ${dias} dias`}>
                {filtro ? "Escolha outra campanha, um período maior ou veja todas." : "Escolha um período maior. Se nunca chegou nenhum, configure o webhook (Configurações) e faça o teste de ponta a ponta (Rastreio)."}
              </Vazio>
            </div>
          )}
        </Cartao>

        <Cartao titulo={`Últimas vendas · ${dias} dias`} rente>
          {dados.vendas.length ? (
            <TabelaVendas dados={dados} fuso={org.fuso} linkCampanha={linkCampanha} />
          ) : (
            <div className="px-5 pb-5">
              <Vazio titulo={`Nenhuma venda${filtro ? " neste filtro" : ""} nos últimos ${dias} dias`}>
                {filtro ? "Escolha outra campanha, um período maior ou veja todas." : "Escolha um período maior. Se nunca chegou nenhuma, conecte sua plataforma de venda (Configurações) ou importe um CSV."}
              </Vazio>
            </div>
          )}
        </Cartao>

        {temPapel(papel, "gestor") && (
          <Cartao titulo="Importar CSV" descricao="Para vendas que não chegam por webhook. Colunas: id_externo (obrigatória), tipo (lead, venda, reembolso, chargeback, venda_pendente, venda_expirada, teste_iniciado, teste_cancelado, teste_reativado), data, valor, lead_id_externo, email e utm_* (inclusive utm_ad_id).">
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
