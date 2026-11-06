-- Microsoft Clarity: experiência na página de destino (rolagem, cliques sem resposta, erros de script…),
-- coletada uma vez por dia pela Data Export API. A API só devolve as últimas 72 horas e o formato
-- documentado é só um exemplo, então cada resposta é guardada inteira (clarity_coletas.resposta) e
-- também achatada em linhas (clarity_metricas: métrica × combinação de dimensões), para consulta.
-- Gravado só pelo servidor (worker); membros leem. Dados agregados, sem dado pessoal.

alter type public.tipo_conexao add value if not exists 'clarity';

alter table public.sincronizacoes drop constraint if exists sincronizacoes_tipo_check;
alter table public.sincronizacoes add constraint sincronizacoes_tipo_check
  check (tipo in ('meta', 'stripe_historico', 'meta_publicacao', 'meta_publico', 'clarity'));

create table public.clarity_coletas (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  conexao_id     uuid references public.conexoes (id) on delete set null,
  projeto_id     text not null,
  coletado_em    timestamptz not null default now(),
  num_dias       smallint not null check (num_dias between 1 and 3),
  dimensoes      text[] not null default '{}',
  -- Dia (no fuso da organização) que a janela de 24 h cobre, quando é a coleta diária automática;
  -- nulo nas coletas avulsas (validação do token, "Coletar agora"), cuja janela não fecha um dia.
  dia            date,
  linhas         integer not null default 0,
  cortada        boolean not null default false, -- veio no limite de 1.000 linhas
  resposta       jsonb not null
);
create index clarity_coletas_org_idx on public.clarity_coletas (organizacao_id, coletado_em desc);
create unique index clarity_coletas_dia_idx on public.clarity_coletas (organizacao_id, projeto_id, dia, dimensoes) where dia is not null;

create table public.clarity_metricas (
  coleta_id      uuid not null references public.clarity_coletas (id) on delete cascade,
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  metrica        text not null,     -- metricName: "Traffic", "Scroll Depth", "Dead Click Count"…
  dimensoes      jsonb not null default '{}', -- ex.: {"Source": "facebook", "Device": "Mobile"}
  valores        jsonb not null default '{}'  -- ex.: {"totalSessionCount": 120, "averageScrollDepth": 41.2}
);
create index clarity_metricas_coleta_idx on public.clarity_metricas (coleta_id);
create index clarity_metricas_org_idx on public.clarity_metricas (organizacao_id, metrica);

alter table public.clarity_coletas enable row level security;
alter table public.clarity_metricas enable row level security;
create policy "membro lê" on public.clarity_coletas for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.clarity_metricas for select to authenticated using (public.eh_membro(organizacao_id));
