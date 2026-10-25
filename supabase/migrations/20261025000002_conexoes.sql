-- Conexões de cada organização (Meta, Stripe, webhook, CSV), as credenciais cifradas e as contas de
-- anúncio. Credencial nunca vai ao navegador: conexoes_segredos e tokens_webhook não têm policy nenhuma
-- (só o servidor, com a service role, lê) e o conteúdo é cifrado na aplicação (AES-256-GCM, src/lib/cifra.ts).

create type public.tipo_conexao as enum ('meta', 'stripe', 'webhook', 'csv');
create type public.status_conexao as enum ('pendente', 'ativa', 'erro', 'desativada');

create table public.conexoes (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  tipo           public.tipo_conexao not null,
  nome           text not null,
  status         public.status_conexao not null default 'pendente',
  ultimo_erro    text,
  validado_em    timestamptz,
  -- Configuração não secreta (ex.: Stripe: campo de metadata que liga a assinatura ao lead; Meta: nome
  -- do usuário do sistema; webhook: prefixo do token, para a pessoa reconhecer qual está em uso).
  config         jsonb not null default '{}',
  criado_por     uuid references auth.users (id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (organizacao_id, tipo, nome)
);

create table public.conexoes_segredos (
  conexao_id     uuid primary key references public.conexoes (id) on delete cascade,
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  cifrado        text not null, -- "v<versão da chave>:<iv>:<tag>:<texto cifrado>", base64url
  atualizado_em  timestamptz not null default now()
);

-- Token de entrada do webhook genérico: só o hash (sha256 hex). O token aparece uma vez, na criação.
create table public.tokens_webhook (
  token_hash     text primary key,
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id     uuid not null references public.conexoes (id) on delete cascade,
  criado_em      timestamptz not null default now(),
  revogado_em    timestamptz
);
create index tokens_webhook_conexao_idx on public.tokens_webhook (conexao_id);

create table public.contas_anuncio (
  id                uuid primary key default gen_random_uuid(),
  organizacao_id    uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id        uuid not null references public.conexoes (id) on delete cascade,
  account_id        text not null check (account_id ~ '^act_[0-9]+$'),
  nome              text,
  moeda             text,
  fuso              text,
  ativa             boolean not null default true,
  sincronizar_desde date not null default (current_date - 90),
  criado_em         timestamptz not null default now(),
  unique (organizacao_id, account_id)
);

-- Quais ações da Meta contam como "lead" e como "compra" para esta organização (formulário no site,
-- formulário instantâneo, cadastro, conversa...). Somam-se as ações da lista. Mudou: sincronize de novo.
create table public.config_metricas (
  organizacao_id uuid primary key references public.organizacoes (id) on delete cascade,
  acoes_lead     text[] not null default array['offsite_conversion.fb_pixel_lead'],
  acoes_compra   text[] not null default array['offsite_conversion.fb_pixel_purchase'],
  atualizado_em  timestamptz not null default now()
);

create function public.criar_config_metricas()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.config_metricas (organizacao_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger organizacoes_config_metricas after insert on public.organizacoes
  for each row execute function public.criar_config_metricas();

alter table public.conexoes enable row level security;
alter table public.conexoes_segredos enable row level security;
alter table public.tokens_webhook enable row level security;
alter table public.contas_anuncio enable row level security;
alter table public.config_metricas enable row level security;
revoke all on public.conexoes_segredos, public.tokens_webhook from anon, authenticated;

-- Conexões: todos os membros veem o status; criar, trocar credencial e remover passa pelo servidor
-- (que valida e cifra), com o papel conferido lá e nestas policies.
create policy "membro vê conexões" on public.conexoes
  for select to authenticated using (public.eh_membro(organizacao_id));
create policy "dono altera conexões" on public.conexoes
  for update to authenticated using (public.tem_papel(organizacao_id, 'dono')) with check (public.tem_papel(organizacao_id, 'dono'));
create policy "dono remove conexões" on public.conexoes
  for delete to authenticated using (public.tem_papel(organizacao_id, 'dono'));

create policy "membro vê contas de anúncio" on public.contas_anuncio
  for select to authenticated using (public.eh_membro(organizacao_id));
create policy "gestor altera contas de anúncio" on public.contas_anuncio
  for update to authenticated using (public.tem_papel(organizacao_id, 'gestor')) with check (public.tem_papel(organizacao_id, 'gestor'));

create policy "membro vê métricas" on public.config_metricas
  for select to authenticated using (public.eh_membro(organizacao_id));
create policy "gestor altera métricas" on public.config_metricas
  for update to authenticated using (public.tem_papel(organizacao_id, 'gestor')) with check (public.tem_papel(organizacao_id, 'gestor'));
