-- Plataformas de venda além do Stripe (Hotmart e Kiwify), novos estados da venda e funil por tipo de negócio.
--   pendente .... Pix ou boleto gerado: ainda não é receita
--   expirada .... não concluída (boleto vencido, cartão recusado, pedido cancelado)
--   chargeback .. contestação do cartão: desconta da receita, como o reembolso
-- Só pagamento, reembolso e chargeback entram na receita.

alter type public.origem_evento add value if not exists 'hotmart';
alter type public.origem_evento add value if not exists 'kiwify';
alter type public.tipo_conexao add value if not exists 'hotmart';
alter type public.tipo_conexao add value if not exists 'kiwify';

alter table public.vendas drop constraint vendas_tipo_check;
alter table public.vendas add constraint vendas_tipo_check check (tipo in ('pagamento', 'reembolso', 'chargeback', 'pendente', 'expirada'));

alter table public.organizacoes add column funil text not null default 'cadastro_teste_venda'
  check (funil in ('cadastro_teste_venda', 'cadastro_venda', 'venda_direta'));

drop function public.desempenho_anuncios(uuid, date, date);
create function public.desempenho_anuncios(p_org uuid, p_de date, p_ate date)
returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  status text, imagem_path text,
  gasto numeric, impressoes bigint, frequencia numeric, cliques_link bigint, visualizacoes_pagina bigint,
  leads_meta bigint, compras_meta bigint, valor_compras_meta numeric,
  leads bigint, testes bigint, testes_cancelados bigint, vendas bigint, receita numeric, vendas_pendentes bigint, valor_pendente numeric
)
language sql stable security invoker set search_path = ''
as $$
  with fuso as (select fuso from public.organizacoes where id = p_org),
  midia as (
    select d.account_id, d.ad_id,
           max(d.campaign_id) as campaign_id, max(d.campaign_name) as campaign_name,
           max(d.adset_id) as adset_id, max(d.adset_name) as adset_name, max(d.ad_name) as ad_name,
           sum(d.gasto) as gasto, sum(d.impressoes)::bigint as impressoes,
           case when sum(d.impressoes) > 0 then sum(d.frequencia * d.impressoes) / sum(d.impressoes) else 0 end as frequencia,
           sum(d.cliques_link)::bigint as cliques_link, sum(d.visualizacoes_pagina)::bigint as visualizacoes_pagina,
           sum(d.leads)::bigint as leads_meta, sum(d.compras)::bigint as compras_meta, sum(d.valor_compras) as valor_compras_meta
      from public.meta_anuncio_dia d
     where d.organizacao_id = p_org and d.dia between p_de and p_ate
     group by d.account_id, d.ad_id
  ),
  lds as (
    select l.ad_id, count(*)::bigint as leads, count(l.teste_iniciado_em)::bigint as testes,
           count(*) filter (where l.teste_iniciado_em is not null and l.teste_cancelado_em is not null and l.primeiro_pagamento_em is null)::bigint as testes_cancelados
      from public.leads l, fuso
     where l.organizacao_id = p_org and l.ad_id is not null and l.codigo_teste is null
       and (l.criado_em at time zone fuso.fuso)::date between p_de and p_ate
     group by l.ad_id
  ),
  vds as (
    select v.ad_id,
           count(*) filter (where v.tipo = 'pagamento')::bigint as vendas,
           sum(v.valor) filter (where v.tipo in ('pagamento', 'reembolso', 'chargeback')) as receita,
           count(*) filter (where v.tipo = 'pendente')::bigint as vendas_pendentes,
           sum(v.valor) filter (where v.tipo = 'pendente') as valor_pendente
      from public.vendas_atribuidas v, fuso
     where v.organizacao_id = p_org and v.ad_id is not null
       and (v.ocorrida_em at time zone fuso.fuso)::date between p_de and p_ate
     group by v.ad_id
  ),
  ids as (
    select ad_id from midia union select ad_id from lds union select ad_id from vds
  )
  select coalesce(m.account_id, a.account_id), coalesce(m.campaign_id, a.campaign_id), coalesce(a.campaign_name, m.campaign_name),
         coalesce(m.adset_id, a.adset_id), coalesce(a.adset_name, m.adset_name), ids.ad_id, coalesce(a.nome, m.ad_name),
         a.status, a.imagem_path,
         coalesce(m.gasto, 0), coalesce(m.impressoes, 0), coalesce(m.frequencia, 0), coalesce(m.cliques_link, 0), coalesce(m.visualizacoes_pagina, 0),
         coalesce(m.leads_meta, 0), coalesce(m.compras_meta, 0), coalesce(m.valor_compras_meta, 0),
         coalesce(lds.leads, 0), coalesce(lds.testes, 0), coalesce(lds.testes_cancelados, 0), coalesce(vds.vendas, 0), coalesce(vds.receita, 0),
         coalesce(vds.vendas_pendentes, 0), coalesce(vds.valor_pendente, 0)
    from ids
    left join midia m on m.ad_id = ids.ad_id
    left join lds on lds.ad_id = ids.ad_id
    left join vds on vds.ad_id = ids.ad_id
    left join lateral (
      select * from public.meta_anuncios x where x.organizacao_id = p_org and x.ad_id = ids.ad_id limit 1
    ) a on true;
$$;
grant execute on function public.desempenho_anuncios(uuid, date, date) to authenticated;
revoke execute on function public.desempenho_anuncios(uuid, date, date) from public, anon;

create or replace function public.cobertura_atribuicao(p_org uuid, p_de date, p_ate date)
returns table (leads bigint, leads_com_anuncio bigint, leads_so_campanha bigint, vendas bigint, vendas_com_anuncio bigint, receita numeric, receita_com_anuncio numeric)
language sql stable security invoker set search_path = ''
as $$
  with fuso as (select fuso from public.organizacoes where id = p_org),
  l as (
    select count(*)::bigint as leads,
           count(*) filter (where ad_id is not null)::bigint as com_anuncio,
           count(*) filter (where atribuicao = 'so_campanha')::bigint as so_campanha
      from public.leads, fuso
     where organizacao_id = p_org and codigo_teste is null
       and (criado_em at time zone fuso.fuso)::date between p_de and p_ate
  ),
  v as (
    select count(*) filter (where tipo = 'pagamento')::bigint as vendas,
           count(*) filter (where tipo = 'pagamento' and ad_id is not null)::bigint as com_anuncio,
           coalesce(sum(valor) filter (where tipo in ('pagamento', 'reembolso', 'chargeback')), 0) as receita,
           coalesce(sum(valor) filter (where tipo in ('pagamento', 'reembolso', 'chargeback') and ad_id is not null), 0) as receita_com_anuncio
      from public.vendas_atribuidas, fuso
     where organizacao_id = p_org and (ocorrida_em at time zone fuso.fuso)::date between p_de and p_ate
  )
  select l.leads, l.com_anuncio, l.so_campanha, v.vendas, v.com_anuncio, v.receita, v.receita_com_anuncio from l, v;
$$;
