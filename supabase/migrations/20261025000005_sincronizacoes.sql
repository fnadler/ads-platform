-- Execuções de sincronização (um job por organização e alvo: uma conta de anúncio, uma conexão do
-- Stripe). O cursor permite retomar a carga fatiada; o índice parcial garante uma execução viva por alvo.
-- A fila (pgmq) e o agendamento (pg_cron) ficam na migração de infraestrutura.

create table public.sincronizacoes (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  tipo           text not null check (tipo in ('meta', 'stripe_historico')),
  alvo           text not null,         -- account_id (act_…) ou id da conexão
  modo           text not null check (modo in ('carga', 'incremental', 'manual')),
  status         text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'erro')),
  cursor         jsonb not null default '{}',
  janela_de      date,
  janela_ate     date,
  linhas         integer not null default 0,
  tentativas     integer not null default 0,
  erro           text,
  disparado_por  uuid references auth.users (id) on delete set null,
  criado_em      timestamptz not null default now(),
  iniciado_em    timestamptz,
  atualizado_em  timestamptz not null default now(),
  terminado_em   timestamptz
);
create unique index sincronizacoes_viva_idx on public.sincronizacoes (organizacao_id, tipo, alvo)
  where status in ('na_fila', 'rodando');
create index sincronizacoes_org_idx on public.sincronizacoes (organizacao_id, criado_em desc);

alter table public.sincronizacoes enable row level security;
create policy "membro lê" on public.sincronizacoes for select to authenticated using (public.eh_membro(organizacao_id));

-- Retenção (LGPD): payload bruto dos eventos por 90 dias; histórico de sincronizações por 180.
create function public.limpar_retencao()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.eventos_recebidos where recebido_em < now() - interval '90 days';
  delete from public.sincronizacoes where criado_em < now() - interval '180 days' and status in ('ok', 'erro');
$$;
revoke execute on function public.limpar_retencao() from public, anon, authenticated;
