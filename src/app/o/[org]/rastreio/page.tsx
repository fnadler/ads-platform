import type { Metadata } from "next";
import Link from "next/link";
import { Copiavel, Formulario } from "@/components/Formulario";
import { Aviso, Cartao, Etiqueta, Tabela, Titulo, Vazio } from "@/components/ui";
import { exigirGestao } from "@/lib/auth/sessao";
import { dataHora, inteiro } from "@/lib/formato";
import { relerAnuncios } from "@/lib/rastreio/acoes";
import { PARAMETROS_META } from "@/lib/rastreio/regras";
import { carregarRastreio, rotuloSaude } from "@/lib/rastreio/situacao";
import { rotaOrg } from "@/lib/rotas";
import { ROTULO_TESTE } from "./teste";

export const metadata: Metadata = { title: "Rastreio" };

// Gerenciar › Rastreio: a situação de cada campanha (o que corrigir primeiro) e o padrão a colar nos anúncios.
// O detalhe de cada campanha (anúncios, links, teste de ponta a ponta) fica em /rastreio/<id da campanha>.

export default async function Rastreio({ params }: PageProps<"/o/[org]/rastreio">) {
  const { org: slug } = await params;
  const { org, supabase } = await exigirGestao(slug);
  const { campanhas } = await carregarRastreio(supabase, org.id);
  const comProblema = campanhas.filter((c) => c.semRastreio > 0);
  const semRastreio = comProblema.reduce((t, c) => t + c.semRastreio, 0);

  return (
    <>
      <Titulo
        sobrancelha="Rastreio"
        descricao="A campanha precisa nascer rastreada: o cadastro ou a venda que chega sem o anúncio de origem não tem como ser recuperado depois."
        acoes={
          <Formulario acao={relerAnuncios} rotulo="Reler na Meta agora" variante="secundario">
            <input type="hidden" name="organizacao_id" value={org.id} />
          </Formulario>
        }
      >
        Cada clique precisa chegar com a origem
      </Titulo>
      <div className="grid gap-6">
        {semRastreio > 0 && (
          <Aviso tom="erro">
            <strong>
              {inteiro(semRastreio)} anúncio(s) no ar ou em análise sem rastreio, em {comProblema.length === 1 ? "1 campanha" : `${comProblema.length} campanhas`}.
            </strong>{" "}
            Abra a campanha abaixo para ver o que corrigir.
          </Aviso>
        )}

        <Cartao titulo="Campanhas" descricao="Só contam os anúncios no ar ou em análise: é neles que o rastreio faltando custa atribuição." rente>
          {campanhas.length ? (
            <Tabela>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Rastreio</th>
                  <th className="text-right">Anúncios no ar</th>
                  <th>Teste de ponta a ponta</th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => {
                  const saude = rotuloSaude(c);
                  const teste = c.ultimoTeste ? ROTULO_TESTE[c.ultimoTeste.status] : null;
                  return (
                    <tr key={c.campaignId}>
                      <td>
                        <Link href={rotaOrg(slug, `/rastreio/${c.campaignId}`)} className="font-medium text-ink hover:text-accent-text [overflow-wrap:anywhere]">
                          {c.nome}
                        </Link>
                      </td>
                      <td>
                        <Etiqueta tom={saude.tom}>{saude.rotulo}</Etiqueta>
                      </td>
                      <td className="num">{inteiro(c.vivos)}</td>
                      <td className="text-sm">
                        {teste && c.ultimoTeste ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <Etiqueta tom={teste.tom}>{teste.rotulo}</Etiqueta>
                            <span className="text-xs text-ink-3">{dataHora(c.ultimoTeste.verificado_em ?? c.ultimoTeste.criado_em, org.fuso)}</span>
                          </span>
                        ) : (
                          <span className="text-ink-3">Nenhum ainda</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          ) : (
            <div className="px-5 pb-5">
              <Vazio titulo="Nenhum anúncio lido ainda">Conecte a Meta em Configurações e clique em “Reler na Meta agora”.</Vazio>
            </div>
          )}
        </Cartao>

        <Cartao titulo="Como rastrear um anúncio" descricao="Cole em cada anúncio, no campo “Parâmetros de URL” (seção Destino → Rastreamento). A Meta preenche os valores sozinha.">
          <Copiavel valor={PARAMETROS_META} />
          <p className="mt-3 text-sm text-ink-2">
            O sistema atribui pelos IDs (<code>utm_ad_id</code>, <code>utm_campaign_id</code>), nunca pelos nomes, que mudam e se repetem. Dica: configure no nível do anúncio e
            duplique a partir dele. As campanhas montadas em Gerenciar › Campanhas já nascem com isso.
          </p>
        </Cartao>
      </div>
    </>
  );
}
