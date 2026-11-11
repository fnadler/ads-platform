import Link from "next/link";
import { Etiqueta, Tabela, type Tom } from "@/components/ui";
import { dataHora, moeda } from "@/lib/formato";
import type { LeadsVendas } from "@/lib/vendas/lista";

// Tabelas de leads e de vendas. Na organização mostram de qual campanha veio cada um (com link para o
// desempenho dela); dentro da campanha a coluna sai, porque o contexto já diz.

const ATRIBUICAO: Record<string, { rotulo: string; tom: Tom }> = {
  ultimo_toque: { rotulo: "Anúncio (último toque)", tom: "ok" },
  primeiro_toque: { rotulo: "Anúncio (primeiro toque)", tom: "ok" },
  so_campanha: { rotulo: "Só campanha", tom: "alerta" },
  nenhuma: { rotulo: "Sem anúncio", tom: "info" },
};

const SITUACAO_VENDA: Record<string, { rotulo: string; tom: Tom }> = {
  pagamento: { rotulo: "Paga", tom: "ok" },
  pendente: { rotulo: "Aguardando pagamento", tom: "alerta" },
  expirada: { rotulo: "Não concluída", tom: "info" },
  reembolso: { rotulo: "Reembolso", tom: "erro" },
  chargeback: { rotulo: "Chargeback", tom: "erro" },
};

interface Contexto {
  dados: LeadsVendas;
  fuso: string;
  /** Com a função, mostra a coluna Campanha (nível organização). */
  linkCampanha?: (id: string) => string;
}

function Campanha({ id, origem, dados, linkCampanha }: { id: string | null; origem?: string | null; dados: LeadsVendas; linkCampanha: (id: string) => string }) {
  if (!id)
    return (
      <span className="text-ink-3">
        Sem campanha{origem ? <span className="block text-xs">origem: {origem}</span> : null}
      </span>
    );
  return (
    <Link href={linkCampanha(id)} className="font-medium text-ink hover:text-accent-text [overflow-wrap:anywhere]">
      {dados.nomeCampanha.get(id) ?? id}
    </Link>
  );
}

export function TabelaLeads({ dados, fuso, linkCampanha, comTeste }: Contexto & { comTeste: boolean }) {
  return (
    <Tabela>
      <thead>
        <tr>
          <th>Quando</th>
          {linkCampanha && <th>Campanha</th>}
          <th>Anúncio</th>
          {comTeste && <th>Teste</th>}
          <th>Pagante</th>
        </tr>
      </thead>
      <tbody>
        {dados.leads.map((l) => (
          <tr key={l.id_externo}>
            <td className="whitespace-nowrap">
              {dataHora(l.criado_em, fuso)}
              {l.codigo_teste && (
                <div className="mt-1">
                  <Etiqueta tom="alerta">teste de rastreio</Etiqueta>
                </div>
              )}
            </td>
            {linkCampanha && (
              <td className="text-sm">
                <Campanha id={l.campaign_id} origem={l.utm_source} dados={dados} linkCampanha={linkCampanha} />
              </td>
            )}
            <td className="text-xs">
              <Etiqueta tom={ATRIBUICAO[l.atribuicao]?.tom ?? "info"}>{ATRIBUICAO[l.atribuicao]?.rotulo ?? l.atribuicao}</Etiqueta>
              {l.ad_id && <div className="mt-1 text-ink-2">{dados.nomeAnuncio.get(l.ad_id) ?? l.ad_id}</div>}
            </td>
            {comTeste && <td>{l.teste_cancelado_em && !l.primeiro_pagamento_em ? <Etiqueta tom="alerta">cancelado</Etiqueta> : l.teste_iniciado_em ? "sim" : ""}</td>}
            <td>{l.primeiro_pagamento_em ? "sim" : ""}</td>
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}

export function TabelaVendas({ dados, fuso, linkCampanha }: Contexto) {
  return (
    <Tabela>
      <thead>
        <tr>
          <th>Quando</th>
          <th>Valor</th>
          <th>Situação</th>
          {linkCampanha && <th>Campanha</th>}
          <th>Anúncio</th>
          <th>Fonte</th>
        </tr>
      </thead>
      <tbody>
        {dados.vendas.map((v) => (
          <tr key={`${v.origem}:${v.id_externo}`}>
            <td className="whitespace-nowrap">{dataHora(v.ocorrida_em, fuso)}</td>
            <td className={`num whitespace-nowrap ${Number(v.valor) < 0 ? "text-err" : ["pendente", "expirada"].includes(v.tipo) ? "text-ink-3" : ""}`}>{moeda(Number(v.valor), v.moeda)}</td>
            <td>
              <Etiqueta tom={SITUACAO_VENDA[v.tipo]?.tom ?? "info"}>{SITUACAO_VENDA[v.tipo]?.rotulo ?? v.tipo}</Etiqueta>
            </td>
            {linkCampanha && (
              <td className="text-sm">
                <Campanha id={v.campaign_id} dados={dados} linkCampanha={linkCampanha} />
              </td>
            )}
            <td className="text-xs">{v.ad_id ? (dados.nomeAnuncio.get(v.ad_id) ?? v.ad_id) : <span className="text-ink-2">sem anúncio</span>}</td>
            <td>{v.origem}</td>
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}
