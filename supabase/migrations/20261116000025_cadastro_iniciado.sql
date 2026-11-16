-- "Cadastro iniciado": quem começou o cadastro (deixou e-mail ou telefone no primeiro passo) mas pode não ter
-- terminado. Fica numa tabela própria, separada de leads, para não mudar nenhuma contagem de cadastro. Serve a
-- duas coisas:
--   • medir a perda dentro do cadastro (quantos começam e não terminam), por campanha e anúncio;
--   • o público de recuperação "Começaram o cadastro e não terminaram".
-- Terminou = existe um lead da organização com o mesmo id_externo, e-mail ou telefone (hash).
-- LGPD: como em leads, e-mail e telefone chegam só como hash SHA-256.

create table public.cadastros_iniciados (
  id                  uuid primary key default gen_random_uuid(),
  organizacao_id      uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id          uuid references public.conexoes (id) on delete set null,
  id_externo          text not null,
  iniciado_em         timestamptz not null,
  email_hash          text,
  telefone_hash       text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  utm_campaign_id     text,
  utm_adset_id        text,
  utm_ad_id           text,
  ftp_utm_source      text,
  ftp_utm_medium      text,
  ftp_utm_campaign    text,
  ftp_utm_content     text,
  ftp_utm_campaign_id text,
  ftp_utm_adset_id    text,
  ftp_utm_ad_id       text,
  fbclid              text,
  landing_path        text,
  -- atribuição resolvida pela mesma regra dos leads (trigger resolver_atribuicao_lead)
  campaign_id         text,
  adset_id            text,
  ad_id               text,
  atribuicao          text not null default 'nenhuma' check (atribuicao in ('ultimo_toque', 'primeiro_toque', 'so_campanha', 'nenhuma')),
  codigo_teste        text,
  recebido_em         timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  unique (organizacao_id, id_externo),
  check (email_hash is not null or telefone_hash is not null)
);
create index cadastros_iniciados_data_idx on public.cadastros_iniciados (organizacao_id, iniciado_em);
create index cadastros_iniciados_campanha_idx on public.cadastros_iniciados (organizacao_id, campaign_id, iniciado_em);
create index cadastros_iniciados_email_idx on public.cadastros_iniciados (organizacao_id, email_hash);

create trigger cadastros_iniciados_atribuicao before insert or update on public.cadastros_iniciados
  for each row execute function public.resolver_atribuicao_lead();

-- Para a ligação "terminou" pelo telefone.
create index if not exists leads_telefone_idx on public.leads (organizacao_id, telefone_hash) where telefone_hash is not null;

alter table public.cadastros_iniciados enable row level security;
create policy "membro lê" on public.cadastros_iniciados for select to authenticated using (public.eh_membro(organizacao_id));

-- Cada cadastro iniciado no período, com a campanha e o anúncio e se terminou (sem dado pessoal).
create function public.cadastros_iniciados_resumo(p_org uuid, p_desde timestamptz, p_campanha text default null)
returns table (iniciado_em timestamptz, campaign_id text, ad_id text, concluiu boolean)
language sql stable security invoker set search_path = ''
as $$
  select c.iniciado_em, c.campaign_id, c.ad_id,
         exists (
           select 1 from public.leads l
            where l.organizacao_id = c.organizacao_id
              and (l.id_externo = c.id_externo
                   or (c.email_hash is not null and l.email_hash = c.email_hash)
                   or (c.telefone_hash is not null and l.telefone_hash = c.telefone_hash))
         ) as concluiu
    from public.cadastros_iniciados c
   where c.organizacao_id = p_org
     and c.codigo_teste is null
     and c.iniciado_em >= p_desde
     and (p_campanha is null or c.campaign_id = p_campanha);
$$;
grant execute on function public.cadastros_iniciados_resumo(uuid, timestamptz, text) to authenticated;
revoke execute on function public.cadastros_iniciados_resumo(uuid, timestamptz, text) from public, anon;

-- Públicos do funil: segmento novo "iniciaram_sem_concluir" (começaram o cadastro e não terminaram).
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
       and p_segmento <> 'iniciaram_sem_concluir'
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
         end
  union all
  select distinct c.email_hash, c.telefone_hash
    from public.cadastros_iniciados c
   where p_segmento = 'iniciaram_sem_concluir'
     and c.organizacao_id = p_org
     and c.codigo_teste is null
     and (p_dias is null or c.iniciado_em >= now() - make_interval(days => p_dias))
     and not exists (
       select 1 from public.leads l
        where l.organizacao_id = c.organizacao_id
          and (l.id_externo = c.id_externo
               or (c.email_hash is not null and l.email_hash = c.email_hash)
               or (c.telefone_hash is not null and l.telefone_hash = c.telefone_hash))
     );
$$;
revoke execute on function public.membros_publico_funil(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.membros_publico_funil(uuid, text, integer) to service_role;
