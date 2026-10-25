-- Acesso: organizações (clientes), membros com papel por organização, convites e administradores da
-- plataforma. Todo o isolamento entre clientes é feito aqui, por RLS: as funções eh_membro/tem_papel são
-- usadas nas policies de todas as tabelas de dados.
--
-- Papéis (do maior para o menor): dono > gestor > leitura.
--   dono .... gerencia membros, convites e conexões da organização
--   gestor .. configura rastreio, dispara sincronizações, importa vendas
--   leitura . só vê
-- Administrador da plataforma: cria organizações (no piloto, só ele). Não vê dados de uma organização
-- sem ser membro dela.

create type public.papel_membro as enum ('leitura', 'gestor', 'dono');

create table public.administradores_plataforma (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  criado_em  timestamptz not null default now()
);

create table public.organizacoes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) between 2 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  fuso       text not null default 'America/Sao_Paulo',
  moeda      text not null default 'BRL',
  plano      text not null default 'piloto',
  criado_por uuid references auth.users (id) on delete set null,
  criado_em  timestamptz not null default now()
);

create table public.membros (
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  usuario_id     uuid not null references auth.users (id) on delete cascade,
  papel          public.papel_membro not null,
  criado_em      timestamptz not null default now(),
  primary key (organizacao_id, usuario_id)
);
create index membros_usuario_idx on public.membros (usuario_id);

-- O token do convite vai só no link; aqui fica o hash (sha256 hex).
create table public.convites (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  email          text not null check (email = lower(trim(email)) and email like '%@%'),
  papel          public.papel_membro not null,
  token_hash     text not null unique,
  criado_por     uuid references auth.users (id) on delete set null,
  criado_em      timestamptz not null default now(),
  expira_em      timestamptz not null default now() + interval '7 days',
  aceito_em      timestamptz,
  aceito_por     uuid references auth.users (id) on delete set null
);
create index convites_org_idx on public.convites (organizacao_id);

create table public.auditoria (
  id             bigint generated always as identity primary key,
  organizacao_id uuid references public.organizacoes (id) on delete cascade,
  usuario_id     uuid references auth.users (id) on delete set null,
  acao           text not null,
  detalhes       jsonb not null default '{}',
  criado_em      timestamptz not null default now()
);
create index auditoria_org_idx on public.auditoria (organizacao_id, criado_em desc);

-- ───────────────────────────── Funções de acesso ─────────────────────────────
-- security definer: leem membros sem passar pelo RLS de membros (evita recursão nas policies).

create function public.eh_admin_plataforma()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.administradores_plataforma where usuario_id = auth.uid());
$$;

create function public.papel_na_org(p_org uuid)
returns public.papel_membro
language sql stable security definer set search_path = ''
as $$
  select papel from public.membros where organizacao_id = p_org and usuario_id = auth.uid();
$$;

create function public.tem_papel(p_org uuid, p_minimo public.papel_membro)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.papel_na_org(p_org) >= p_minimo, false);
$$;

create function public.eh_membro(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.tem_papel(p_org, 'leitura');
$$;

-- ───────────────────────────── RLS ─────────────────────────────

alter table public.administradores_plataforma enable row level security;
alter table public.organizacoes enable row level security;
alter table public.membros enable row level security;
alter table public.convites enable row level security;
alter table public.auditoria enable row level security;

create policy "admin vê a lista de admins" on public.administradores_plataforma
  for select to authenticated using (public.eh_admin_plataforma());

create policy "membro ou admin vê a organização" on public.organizacoes
  for select to authenticated using (public.eh_membro(id) or public.eh_admin_plataforma());
create policy "dono edita a organização" on public.organizacoes
  for update to authenticated using (public.tem_papel(id, 'dono')) with check (public.tem_papel(id, 'dono'));
-- Criar organização: só pela função criar_organizacao (admin da plataforma).

create policy "membro vê os membros da organização" on public.membros
  for select to authenticated using (public.eh_membro(organizacao_id));
create policy "dono muda papel" on public.membros
  for update to authenticated using (public.tem_papel(organizacao_id, 'dono')) with check (public.tem_papel(organizacao_id, 'dono'));
create policy "dono remove membro" on public.membros
  for delete to authenticated using (public.tem_papel(organizacao_id, 'dono'));
-- Entrar numa organização: só pela função aceitar_convite (ou criar_organizacao).

create policy "dono vê convites" on public.convites
  for select to authenticated using (public.tem_papel(organizacao_id, 'dono'));
create policy "dono cria convites" on public.convites
  for insert to authenticated with check (public.tem_papel(organizacao_id, 'dono') and criado_por = auth.uid() and aceito_em is null);
create policy "dono revoga convites" on public.convites
  for delete to authenticated using (public.tem_papel(organizacao_id, 'dono'));

create policy "gestor vê a auditoria" on public.auditoria
  for select to authenticated using (public.tem_papel(organizacao_id, 'gestor'));

-- A organização nunca fica sem dono.
create function public.proteger_ultimo_dono()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.papel = 'dono' and (tg_op = 'DELETE' or new.papel <> 'dono') and not exists (
    select 1 from public.membros
     where organizacao_id = old.organizacao_id and papel = 'dono' and usuario_id <> old.usuario_id
  ) and exists (select 1 from public.organizacoes where id = old.organizacao_id) then
    raise exception 'A organização precisa de pelo menos um dono.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger membros_ultimo_dono before update or delete on public.membros
  for each row execute function public.proteger_ultimo_dono();

-- ───────────────────────────── Operações ─────────────────────────────

create function public.registrar_auditoria(p_org uuid, p_acao text, p_detalhes jsonb default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_org is not null and not public.eh_membro(p_org) and not public.eh_admin_plataforma() then
    raise exception 'Sem acesso a esta organização.';
  end if;
  insert into public.auditoria (organizacao_id, usuario_id, acao, detalhes) values (p_org, auth.uid(), p_acao, coalesce(p_detalhes, '{}'));
end;
$$;

-- Admin da plataforma cria a organização e entra como dono.
create function public.criar_organizacao(p_nome text, p_slug text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.eh_admin_plataforma() then
    raise exception 'Só um administrador da plataforma cria organizações.';
  end if;
  insert into public.organizacoes (nome, slug, criado_por) values (trim(p_nome), lower(trim(p_slug)), auth.uid())
  returning id into v_id;
  insert into public.membros (organizacao_id, usuario_id, papel) values (v_id, auth.uid(), 'dono');
  insert into public.auditoria (organizacao_id, usuario_id, acao, detalhes)
  values (v_id, auth.uid(), 'organizacao.criada', jsonb_build_object('nome', p_nome, 'slug', p_slug));
  return v_id;
end;
$$;

-- Aceita o convite do token (o e-mail da conta precisa ser o do convite). Devolve o slug da organização.
create function public.aceitar_convite(p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv  public.convites%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_slug  text;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.';
  end if;
  select * into v_conv from public.convites
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found or v_conv.aceito_em is not null then
    raise exception 'Convite inválido ou já usado.';
  end if;
  if v_conv.expira_em < now() then
    raise exception 'Convite expirado. Peça um novo a quem convidou você.';
  end if;
  if v_conv.email <> v_email then
    raise exception 'Este convite é para outro e-mail (%).', v_conv.email;
  end if;
  insert into public.membros (organizacao_id, usuario_id, papel)
  values (v_conv.organizacao_id, auth.uid(), v_conv.papel)
  on conflict (organizacao_id, usuario_id) do update set papel = greatest(public.membros.papel, excluded.papel);
  update public.convites set aceito_em = now(), aceito_por = auth.uid() where id = v_conv.id;
  insert into public.auditoria (organizacao_id, usuario_id, acao, detalhes)
  values (v_conv.organizacao_id, auth.uid(), 'convite.aceito', jsonb_build_object('papel', v_conv.papel));
  select slug into v_slug from public.organizacoes where id = v_conv.organizacao_id;
  return v_slug;
end;
$$;

revoke execute on function public.criar_organizacao(text, text) from public, anon;
revoke execute on function public.aceitar_convite(text) from public, anon;
revoke execute on function public.registrar_auditoria(uuid, text, jsonb) from public, anon;
grant execute on function public.criar_organizacao(text, text) to authenticated;
grant execute on function public.aceitar_convite(text) to authenticated;
grant execute on function public.registrar_auditoria(uuid, text, jsonb) to authenticated;

-- Membros com e-mail (auth.users não é exposto à API). Só para membros da organização.
create function public.membros_da_organizacao(p_org uuid)
returns table (usuario_id uuid, email text, papel public.papel_membro, criado_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.usuario_id, u.email::text, m.papel, m.criado_em
    from public.membros m
    join auth.users u on u.id = m.usuario_id
   where m.organizacao_id = p_org and public.eh_membro(p_org)
   order by m.papel desc, u.email;
$$;
revoke execute on function public.membros_da_organizacao(uuid) from public, anon;
grant execute on function public.membros_da_organizacao(uuid) to authenticated;

-- O que a página do convite mostra antes do login (quem possui o link já sabe que o convite existe).
create function public.ver_convite(p_token text)
returns table (organizacao text, email text, papel public.papel_membro, situacao text)
language sql stable security definer set search_path = ''
as $$
  select o.nome, c.email, c.papel,
         case when c.aceito_em is not null then 'usado' when c.expira_em < now() then 'expirado' else 'valido' end
    from public.convites c
    join public.organizacoes o on o.id = c.organizacao_id
   where c.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
grant execute on function public.ver_convite(text) to anon, authenticated;
