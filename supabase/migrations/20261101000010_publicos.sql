-- Públicos (fases 1 e 2 do recurso de público-alvo).
--   detalhado .. local, idade, gênero e interesses da Meta (como sugestão ao Advantage+ ou restrição)
--   funil ...... lista de clientes montada pelos dados do sistema (pagantes, cadastrados sem teste…),
--                enviada à Meta só como hash (e-mail/telefone SHA-256) e atualizada todo dia
--   site ....... visitantes do site nos últimos N dias (pelo pixel)
--   semelhante . lookalike de outro público (ex.: semelhante aos pagantes)
-- Uma campanha pode ter vários públicos: um conjunto de anúncios por público, para o painel mostrar qual
-- público vende. Públicos com dados de clientes (funil) exigem o aceite do dono em config_publicacao.

create table public.publicos (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  nome             text not null check (length(trim(nome)) between 2 and 120),
  tipo             text not null check (tipo in ('detalhado', 'funil', 'site', 'semelhante')),
  definicao        jsonb not null default '{}',
  estimativa       jsonb,                 -- detalhado: {min, max, em}
  meta_audience_id text,                  -- funil/site/semelhante: público personalizado na Meta
  meta_tamanho     jsonb,                 -- {min, max, em} lido da Meta
  situacao         text not null default 'rascunho'
                   check (situacao in ('rascunho', 'pronto', 'enviando', 'erro')),
  erro             text,
  enviado_em       timestamptz,           -- última atualização da lista na Meta (funil)
  criado_por       uuid references auth.users (id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (organizacao_id, nome)
);
create index publicos_org_idx on public.publicos (organizacao_id, tipo);

-- Conjuntos de anúncios da campanha do assistente (um por público; sem público = "público rápido").
create table public.conjuntos_assistente (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  campanha_id    uuid not null references public.campanhas_assistente (id) on delete cascade,
  publico_id     uuid references public.publicos (id) on delete set null,
  ordem          integer not null default 0,
  nome           text not null,
  meta_adset_id  text,
  criado_em      timestamptz not null default now()
);
create index conjuntos_assistente_campanha_idx on public.conjuntos_assistente (campanha_id, ordem);

-- Anúncio = criativo × conjunto (o criativo é criado uma vez na Meta e reaproveitado nos conjuntos).
create table public.anuncios_assistente (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  criativo_id    uuid not null references public.criativos_assistente (id) on delete cascade,
  conjunto_id    uuid not null references public.conjuntos_assistente (id) on delete cascade,
  meta_ad_id     text,
  criado_em      timestamptz not null default now(),
  unique (criativo_id, conjunto_id)
);

-- Campanha já criada antes desta migração: um conjunto e os anúncios que ela tem.
insert into public.conjuntos_assistente (organizacao_id, campanha_id, ordem, nome, meta_adset_id)
select c.organizacao_id, c.id, 0, c.nome, c.meta_adset_id
  from public.campanhas_assistente c
 where c.meta_adset_id is not null;
insert into public.anuncios_assistente (organizacao_id, criativo_id, conjunto_id, meta_ad_id)
select cr.organizacao_id, cr.id, cj.id, cr.meta_ad_id
  from public.criativos_assistente cr
  join public.conjuntos_assistente cj on cj.campanha_id = cr.campanha_id
 where cr.meta_ad_id is not null;

-- Direito de oposição (LGPD): o lead marcado sai de todas as listas na atualização seguinte.
alter table public.leads add column if not exists fora_de_publicos_em timestamptz;

-- Aceite do dono: usar dados de clientes (hash de e-mail/telefone) em públicos da Meta.
alter table public.config_publicacao
  add column if not exists aceite_publicos_clientes_em timestamptz,
  add column if not exists aceite_publicos_clientes_por uuid references auth.users (id) on delete set null;

alter table public.sincronizacoes drop constraint if exists sincronizacoes_tipo_check;
alter table public.sincronizacoes add constraint sincronizacoes_tipo_check
  check (tipo in ('meta', 'stripe_historico', 'meta_publicacao', 'meta_publico'));

alter table public.publicos enable row level security;
alter table public.conjuntos_assistente enable row level security;
alter table public.anuncios_assistente enable row level security;

create policy "membro lê" on public.publicos for select to authenticated using (public.eh_membro(organizacao_id));
-- Gestor cria e edita a definição (as colunas da Meta, como meta_audience_id e situação, são gravadas pelo servidor).
create policy "gestor cria" on public.publicos for insert to authenticated
  with check (public.tem_papel(organizacao_id, 'gestor') and meta_audience_id is null and situacao = 'rascunho' and criado_por = auth.uid());
create policy "gestor edita" on public.publicos for update to authenticated
  using (public.tem_papel(organizacao_id, 'gestor'))
  with check (public.tem_papel(organizacao_id, 'gestor'));
create policy "gestor apaga" on public.publicos for delete to authenticated using (public.tem_papel(organizacao_id, 'gestor'));

create policy "membro lê" on public.conjuntos_assistente for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.anuncios_assistente for select to authenticated using (public.eh_membro(organizacao_id));

-- Quem entra num público do funil (hashes já normalizados na entrada: e-mail minúsculo, telefone com 55).
-- Leads de teste de rastreio e quem se opôs (fora_de_publicos_em) ficam de fora. dias limita pela data de
-- cadastro (null = todos).
create function public.membros_publico_funil(p_org uuid, p_segmento text, p_dias integer default null)
returns table (email_hash text, telefone_hash text)
language sql stable security definer set search_path = ''
as $$
  select l.email_hash, l.telefone_hash
    from public.leads l
   where l.organizacao_id = p_org
     and l.codigo_teste is null
     and l.fora_de_publicos_em is null
     and (l.email_hash is not null or l.telefone_hash is not null)
     and (p_dias is null or l.criado_em >= now() - make_interval(days => p_dias))
     and case p_segmento
           when 'pagantes' then l.primeiro_pagamento_em is not null
           when 'cadastrados_sem_teste' then l.teste_iniciado_em is null and l.primeiro_pagamento_em is null
           when 'teste_sem_pagamento' then l.teste_iniciado_em is not null and l.primeiro_pagamento_em is null
           when 'todos' then true
           else false
         end;
$$;
revoke execute on function public.membros_publico_funil(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.membros_publico_funil(uuid, text, integer) to service_role;

-- Atualização diária dos públicos do funil (a lista de clientes muda todo dia).
create function public.agendar_publicos()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
  n integer := 0;
begin
  for p in
    select pb.organizacao_id, pb.id
      from public.publicos pb
      join public.config_publicacao cp on cp.organizacao_id = pb.organizacao_id and cp.aceite_publicos_clientes_em is not null
     where pb.tipo = 'funil' and pb.meta_audience_id is not null
  loop
    insert into public.sincronizacoes (organizacao_id, tipo, alvo, modo)
    values (p.organizacao_id, 'meta_publico', p.id::text, 'incremental')
    on conflict (organizacao_id, tipo, alvo) where status in ('na_fila', 'rodando') do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.agendar_publicos() from public, anon, authenticated;
