-- Teste grátis cancelado antes da cobrança. O teste começa com o cartão cadastrado e só é cobrado depois de
-- 7 dias; quem desiste nesse intervalo não vai pagar. A coluna guarda a data do cancelamento e é limpa se a
-- pessoa desfizer. "testes" continua contando quem iniciou; "testes_cancelados" é a parte que desistiu.

alter table public.leads add column teste_cancelado_em timestamptz;

-- A assinatura do retorno muda, então é preciso recriar (create or replace não permite coluna nova no meio).
drop function public.desempenho_anuncios(uuid, date, date);
create function public.desempenho_anuncios(p_org uuid, p_de date, p_ate date)
returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  status text, imagem_path text,
  gasto numeric, impressoes bigint, frequencia numeric, cliques_link bigint, visualizacoes_pagina bigint,
  leads_meta bigint, compras_meta bigint, valor_compras_meta numeric,
  leads bigint, testes bigint, testes_cancelados bigint, vendas bigint, receita numeric
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
         coalesce(lds.leads, 0), coalesce(lds.testes, 0), coalesce(lds.testes_cancelados, 0), coalesce(vds.vendas, 0), coalesce(vds.receita, 0)
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

-- Quem cancelou o teste não é mais "ainda não pagou": não vai ser cobrado.
create or replace function public.membros_publico_funil(p_org uuid, p_segmento text, p_dias integer default null)
returns table (email_hash text, telefone_hash text)
language sql stable security definer set search_path = ''
as $$
  with base as (
    select l.email_hash, l.telefone_hash, l.teste_iniciado_em, l.teste_cancelado_em,
           (l.primeiro_pagamento_em is not null or exists (
              select 1 from public.vendas v
               where v.organizacao_id = l.organizacao_id
                 and v.tipo = 'pagamento'
                 and (v.lead_id_externo = l.id_externo
                      or (v.lead_id_externo is null and v.email_hash is not null and v.email_hash = l.email_hash))
           )) as pagou
      from public.leads l
     where l.organizacao_id = p_org
       and l.codigo_teste is null
       and l.fora_de_publicos_em is null
       and (l.email_hash is not null or l.telefone_hash is not null)
       and (p_dias is null or l.criado_em >= now() - make_interval(days => p_dias))
  )
  select email_hash, telefone_hash
    from base
   where case p_segmento
           when 'pagantes' then pagou
           when 'cadastrados_sem_teste' then teste_iniciado_em is null and not pagou
           when 'teste_sem_pagamento' then teste_iniciado_em is not null and teste_cancelado_em is null and not pagou
           when 'todos' then true
           else false
         end;
$$;
revoke execute on function public.membros_publico_funil(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.membros_publico_funil(uuid, text, integer) to service_role;
