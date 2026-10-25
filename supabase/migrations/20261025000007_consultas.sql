-- Consultas do painel (security invoker: o RLS de quem chama vale, então só a própria organização).
-- Período em datas do fuso da conta (Meta) / da organização (leads e vendas).
--   leads_meta ...... o que a Meta conta como lead (config_metricas) — o que o Gerenciador mostra
--   leads ........... leads que chegaram ao sistema atribuídos ao anúncio (criados no período)
--   testes .......... desses leads, os que iniciaram teste grátis
--   vendas/receita .. pagamentos no período atribuídos ao anúncio (reembolsos descontam a receita)

create function public.desempenho_anuncios(p_org uuid, p_de date, p_ate date)
returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  status text, imagem_path text,
  gasto numeric, impressoes bigint, frequencia numeric, cliques_link bigint, visualizacoes_pagina bigint,
  leads_meta bigint, compras_meta bigint, valor_compras_meta numeric,
  leads bigint, testes bigint, vendas bigint, receita numeric
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
    select l.ad_id, count(*)::bigint as leads, count(l.teste_iniciado_em)::bigint as testes
      from public.leads l, fuso
     where l.organizacao_id = p_org and l.ad_id is not null and l.codigo_teste is null
       and (l.criado_em at time zone fuso.fuso)::date between p_de and p_ate
     group by l.ad_id
  ),
  vds as (
    select v.ad_id, count(*) filter (where v.tipo = 'pagamento')::bigint as vendas, sum(v.valor) as receita
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
         coalesce(lds.leads, 0), coalesce(lds.testes, 0), coalesce(vds.vendas, 0), coalesce(vds.receita, 0)
    from ids
    left join midia m on m.ad_id = ids.ad_id
    left join lds on lds.ad_id = ids.ad_id
    left join vds on vds.ad_id = ids.ad_id
    left join lateral (
      select * from public.meta_anuncios x where x.organizacao_id = p_org and x.ad_id = ids.ad_id limit 1
    ) a on true;
$$;

-- Leads por dia (Meta e sistema), para o gráfico de acumulado; p_campanha opcional.
create function public.leads_por_dia(p_org uuid, p_de date, p_ate date, p_campanha text default null)
returns table (dia date, leads_meta bigint, leads bigint, gasto numeric)
language sql stable security invoker set search_path = ''
as $$
  with fuso as (select fuso from public.organizacoes where id = p_org),
  dias as (select generate_series(p_de, p_ate, interval '1 day')::date as dia),
  midia as (
    select d.dia, sum(d.leads)::bigint as leads_meta, sum(d.gasto) as gasto
      from public.meta_campanha_dia d
     where d.organizacao_id = p_org and d.dia between p_de and p_ate and (p_campanha is null or d.campaign_id = p_campanha)
     group by d.dia
  ),
  lds as (
    select (l.criado_em at time zone fuso.fuso)::date as dia, count(*)::bigint as leads
      from public.leads l, fuso
     where l.organizacao_id = p_org and l.campaign_id is not null and l.codigo_teste is null and (p_campanha is null or l.campaign_id = p_campanha)
       and (l.criado_em at time zone fuso.fuso)::date between p_de and p_ate
     group by 1
  )
  select dias.dia, coalesce(m.leads_meta, 0), coalesce(lds.leads, 0), coalesce(m.gasto, 0)
    from dias left join midia m using (dia) left join lds using (dia)
   order by dias.dia;
$$;

-- Cobertura de atribuição: quanto dos leads e da receita do período chega até o anúncio.
create function public.cobertura_atribuicao(p_org uuid, p_de date, p_ate date)
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
           coalesce(sum(valor), 0) as receita,
           coalesce(sum(valor) filter (where ad_id is not null), 0) as receita_com_anuncio
      from public.vendas_atribuidas, fuso
     where organizacao_id = p_org and (ocorrida_em at time zone fuso.fuso)::date between p_de and p_ate
  )
  select l.leads, l.com_anuncio, l.so_campanha, v.vendas, v.com_anuncio, v.receita, v.receita_com_anuncio from l, v;
$$;

-- Ações da Meta vistas nos últimos 30 dias (para escolher o que conta como lead/compra).
create function public.acoes_meta_vistas(p_org uuid)
returns table (action_type text, total numeric)
language sql stable security invoker set search_path = ''
as $$
  select a ->> 'action_type', sum((a ->> 'value')::numeric)
    from public.meta_campanha_dia d, jsonb_array_elements(d.acoes_brutas) a
   where d.organizacao_id = p_org and d.dia >= current_date - 30 and a ->> 'action_type' not like 'valor:%'
   group by 1
   order by 2 desc;
$$;

grant execute on function public.desempenho_anuncios(uuid, date, date) to authenticated;
grant execute on function public.leads_por_dia(uuid, date, date, text) to authenticated;
grant execute on function public.cobertura_atribuicao(uuid, date, date) to authenticated;
grant execute on function public.acoes_meta_vistas(uuid) to authenticated;
revoke execute on function public.desempenho_anuncios(uuid, date, date) from public, anon;
revoke execute on function public.leads_por_dia(uuid, date, date, text) from public, anon;
revoke execute on function public.cobertura_atribuicao(uuid, date, date) from public, anon;
revoke execute on function public.acoes_meta_vistas(uuid) from public, anon;
