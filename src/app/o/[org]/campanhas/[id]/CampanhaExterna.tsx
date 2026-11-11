import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconeExterno, IconeSeta, IconeVoltar } from "@/components/Icones";
import { Aviso, BotaoLink, Cartao, Etiqueta, Tabela, Titulo } from "@/components/ui";
import { exigirGestao } from "@/lib/auth/sessao";
import { linkGerenciador } from "@/lib/campanhas/lista";
import { ROTULO_VEICULACAO, situacaoPelosAnuncios, veiculacaoPelosAnuncios } from "@/lib/campanhas/veiculacao";
import { rotaDesempenho, rotaOrg } from "@/lib/rotas";
import { CartaoVeiculacao } from "../CartaoVeiculacao";

// Gerenciar › campanha criada no Gerenciador de Anúncios (endereço pelo id da Meta). Aqui só se pausa e
// reativa; verba, público e anúncios continuam sendo mudados no Gerenciador.

export async function CampanhaExterna({ slug, metaId }: { slug: string; metaId: string }) {
  const { org, supabase } = await exigirGestao(slug);
  const [{ data: montada }, { data: anuncios }, { data: conexao }] = await Promise.all([
    supabase.from("campanhas_assistente").select("id").eq("organizacao_id", org.id).eq("meta_campaign_id", metaId).maybeSingle(),
    supabase
      .from("meta_anuncios")
      .select("ad_id, nome, campaign_name, adset_id, adset_name, account_id, status")
      .eq("organizacao_id", org.id)
      .eq("campaign_id", metaId)
      .order("adset_name")
      .order("nome"),
    supabase.from("conexoes").select("status").eq("organizacao_id", org.id).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  // Montada aqui: a casa dela é a montagem (endereço interno).
  if (montada) redirect(rotaOrg(slug, `/campanhas/${montada.id}`));
  if (!anuncios?.length) notFound();

  const status = anuncios.map((a) => a.status);
  const situacao = situacaoPelosAnuncios(status);
  const gerenciador = linkGerenciador(anuncios[0].account_id, metaId);

  return (
    <>
      <Titulo
        sobrancelha={
          <Link href={rotaOrg(slug, "/campanhas")} className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-text">
            <IconeVoltar tamanho={14} /> Campanhas
          </Link>
        }
        acoes={
          <div className="flex flex-wrap items-center gap-3">
            <Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>
            <BotaoLink variante="secundario" href={rotaDesempenho(slug, metaId)}>
              Ver desempenho
              <IconeSeta tamanho={16} />
            </BotaoLink>
          </div>
        }
      >
        {anuncios[0].campaign_name ?? metaId}
      </Titulo>

      <div className="grid gap-6">
        <Aviso>
          Esta campanha foi criada direto no Gerenciador de Anúncios. Aqui você pausa e reativa a campanha; para mudar verba, público ou anúncios, use o Gerenciador.
          {gerenciador && (
            <>
              {" "}
              <a href={gerenciador} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium">
                Abrir no Gerenciador <IconeExterno tamanho={14} />
              </a>
            </>
          )}
        </Aviso>

        <CartaoVeiculacao
          supabase={supabase}
          orgId={org.id}
          fuso={org.fuso}
          metaCampaignId={metaId}
          veiculacao={veiculacaoPelosAnuncios(status)}
          publicacaoAtiva={conexao?.status === "ativa"}
          rotaConfiguracoes={rotaOrg(slug, "/configuracoes")}
        />

        <Cartao titulo="Conjuntos e anúncios" descricao="Como a última leitura da Meta encontrou cada anúncio." rente>
          <Tabela>
            <thead>
              <tr>
                <th>Anúncio</th>
                <th>Conjunto</th>
                <th>Veiculação</th>
              </tr>
            </thead>
            <tbody>
              {anuncios.map((a) => (
                <tr key={a.ad_id}>
                  <td className="font-medium text-ink">{a.nome ?? a.ad_id}</td>
                  <td className="text-sm text-ink-2">{a.adset_name ?? a.adset_id}</td>
                  <td className="whitespace-nowrap">{ROTULO_VEICULACAO[a.status ?? ""] ?? a.status}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Cartao>
      </div>
    </>
  );
}
