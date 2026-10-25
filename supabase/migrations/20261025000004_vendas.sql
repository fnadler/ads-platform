-- Leads e vendas vindos das fontes de venda (webhook genérico, Stripe, CSV), com a atribuição até o
-- anúncio. Regra: a atribuição usa os IDs, nunca os nomes — utm_ad_id do último toque; sem ele, o do
-- primeiro toque (ftp_*); sem anúncio, fica ao menos a campanha. Resolvida no banco (trigger), igual
-- para todas as fontes.
--
-- LGPD: do cliente final guardamos o identificador da fonte (id_externo), o hash SHA-256 do e-mail e
-- do telefone (para casar lead e venda) e, só se a fonte mandar, o nome. O payload bruto de cada
-- evento fica 90 dias em eventos_recebidos (reprocessamento), sem e-mail nem telefone em claro.

create type public.origem_evento as enum ('webhook', 'stripe', 'csv');

create table public.eventos_recebidos (
  id                 bigint generated always as identity primary key,
  organizacao_id     uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id         uuid references public.conexoes (id) on delete set null,
  origem             public.origem_evento not null,
  chave_idempotencia text not null,
  tipo               text not null,
  payload            jsonb not null,
  recebido_em        timestamptz not null default now(),
  processado_em      timestamptz,
  erro               text,
  unique (organizacao_id, origem, chave_idempotencia)
);
create index eventos_recebidos_retencao_idx on public.eventos_recebidos (recebido_em);

create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  organizacao_id      uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id          uuid references public.conexoes (id) on delete set null,
  id_externo          text not null,
  criado_em           timestamptz not null,
  email_hash          text,
  telefone_hash       text,
  nome                text,
  -- último toque
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  utm_campaign_id     text,
  utm_adset_id        text,
  utm_ad_id           text,
  -- primeiro toque
  ftp_utm_source      text,
  ftp_utm_medium      text,
  ftp_utm_campaign    text,
  ftp_utm_content     text,
  ftp_utm_campaign_id text,
  ftp_utm_adset_id    text,
  ftp_utm_ad_id       text,
  fbclid              text,
  landing_path        text,
  -- atribuição resolvida (trigger resolver_atribuicao_lead)
  campaign_id         text,
  adset_id            text,
  ad_id               text,
  atribuicao          text not null default 'nenhuma' check (atribuicao in ('ultimo_toque', 'primeiro_toque', 'so_campanha', 'nenhuma')),
  -- marcos do funil (fase 1: assinatura com teste grátis; a fase 2 traz estágios configuráveis)
  teste_iniciado_em   timestamptz,
  primeiro_pagamento_em timestamptz,
  codigo_teste        text,          -- código da verificação de ponta a ponta (lead de teste)
  recebido_em         timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  unique (organizacao_id, id_externo)
);
create index leads_criado_idx on public.leads (organizacao_id, criado_em);
create index leads_ad_idx on public.leads (organizacao_id, ad_id);
create index leads_campanha_idx on public.leads (organizacao_id, campaign_id);
create index leads_email_idx on public.leads (organizacao_id, email_hash);
create index leads_codigo_idx on public.leads (organizacao_id, codigo_teste) where codigo_teste is not null;

create table public.vendas (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id       uuid references public.conexoes (id) on delete set null,
  origem           public.origem_evento not null,
  id_externo       text not null,          -- ex.: id da fatura no Stripe
  tipo             text not null default 'pagamento' check (tipo in ('pagamento', 'reembolso')),
  valor            numeric(14, 2) not null, -- reembolso entra negativo
  moeda            text not null default 'BRL',
  ocorrida_em      timestamptz not null,
  lead_id_externo  text,                   -- liga ao lead (ex.: user_id gravado na assinatura)
  email_hash       text,
  assinatura_id    text,
  cliente_externo  text,                   -- ex.: customer do Stripe (liga reembolsos à venda original)
  primeira         boolean not null default false, -- primeira cobrança paga da assinatura/cliente
  -- atribuição própria da venda (quando a fonte manda UTM na venda); senão vale a do lead
  utm_campaign_id  text,
  utm_adset_id     text,
  utm_ad_id        text,
  recebido_em      timestamptz not null default now(),
  unique (organizacao_id, origem, id_externo)
);
create index vendas_data_idx on public.vendas (organizacao_id, ocorrida_em);
create index vendas_lead_idx on public.vendas (organizacao_id, lead_id_externo);
create index vendas_cliente_idx on public.vendas (organizacao_id, cliente_externo);

create table public.verificacoes_rastreio (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  account_id     text not null,
  campaign_id    text not null,
  ad_id          text not null,
  codigo         text not null,
  url_teste      text not null,
  esperado       jsonb not null,
  status         text not null default 'aguardando' check (status in ('aguardando', 'ok', 'problema')),
  resultado      jsonb,
  lead_id        uuid references public.leads (id) on delete set null,
  criado_por     uuid references auth.users (id) on delete set null,
  criado_em      timestamptz not null default now(),
  verificado_em  timestamptz,
  unique (organizacao_id, codigo)
);
create index verificacoes_campanha_idx on public.verificacoes_rastreio (organizacao_id, campaign_id, criado_em desc);

-- ───────────────────────────── Atribuição ─────────────────────────────

create function public.eh_id_meta(v text)
returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(v ~ '^[0-9]{6,}$', false) $$;

create function public.resolver_atribuicao_lead()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.eh_id_meta(new.utm_ad_id) then
    new.ad_id := new.utm_ad_id;
    new.adset_id := case when public.eh_id_meta(new.utm_adset_id) then new.utm_adset_id end;
    new.campaign_id := case when public.eh_id_meta(new.utm_campaign_id) then new.utm_campaign_id end;
    new.atribuicao := 'ultimo_toque';
  elsif public.eh_id_meta(new.ftp_utm_ad_id) then
    new.ad_id := new.ftp_utm_ad_id;
    new.adset_id := case when public.eh_id_meta(new.ftp_utm_adset_id) then new.ftp_utm_adset_id end;
    new.campaign_id := case when public.eh_id_meta(new.ftp_utm_campaign_id) then new.ftp_utm_campaign_id end;
    new.atribuicao := 'primeiro_toque';
  elsif public.eh_id_meta(new.utm_campaign_id) or public.eh_id_meta(new.ftp_utm_campaign_id) then
    new.ad_id := null;
    new.adset_id := null;
    new.campaign_id := case when public.eh_id_meta(new.utm_campaign_id) then new.utm_campaign_id else new.ftp_utm_campaign_id end;
    new.atribuicao := 'so_campanha';
  else
    new.ad_id := null;
    new.adset_id := null;
    new.campaign_id := null;
    new.atribuicao := 'nenhuma';
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger leads_atribuicao before insert or update on public.leads
  for each row execute function public.resolver_atribuicao_lead();

-- Venda com a atribuição final: a da própria venda (se veio com utm_ad_id) ou a do lead ligado a ela
-- (pelo id_externo do lead ou, sem ele, pelo hash do e-mail).
create view public.vendas_atribuidas
with (security_invoker = true) as
select
  v.*,
  l.id as lead_id,
  case when public.eh_id_meta(v.utm_ad_id) then v.utm_campaign_id else l.campaign_id end as campaign_id,
  case when public.eh_id_meta(v.utm_ad_id) then v.utm_adset_id else l.adset_id end as adset_id,
  case when public.eh_id_meta(v.utm_ad_id) then v.utm_ad_id else l.ad_id end as ad_id,
  l.criado_em as lead_criado_em
from public.vendas v
left join lateral (
  select * from public.leads l
   where l.organizacao_id = v.organizacao_id
     and ((v.lead_id_externo is not null and l.id_externo = v.lead_id_externo)
          or (v.lead_id_externo is null and v.email_hash is not null and l.email_hash = v.email_hash))
   order by l.criado_em
   limit 1
) l on true;

alter table public.eventos_recebidos enable row level security;
alter table public.leads enable row level security;
alter table public.vendas enable row level security;
alter table public.verificacoes_rastreio enable row level security;

create policy "gestor lê eventos" on public.eventos_recebidos for select to authenticated using (public.tem_papel(organizacao_id, 'gestor'));
create policy "membro lê" on public.leads for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.vendas for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.verificacoes_rastreio for select to authenticated using (public.eh_membro(organizacao_id));
