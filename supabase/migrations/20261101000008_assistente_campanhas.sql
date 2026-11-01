-- Assistente de campanhas (fase A): o sistema cria campanhas na Meta a partir de modelos, com o rastreio
-- certo por construção. Regras de segurança:
--   • só CRIA objetos novos (nunca edita, pausa ou apaga o que já existe na conta);
--   • tudo nasce PAUSADO; ativar é um passo separado, com confirmação, e só nos objetos que o sistema criou;
--   • teto de verba diária por organização;
--   • toda chamada de escrita à Meta fica registrada em operacoes_meta.
-- A credencial de escrita é uma conexão própria (meta_publicacao, com ads_management), separada da de leitura.

alter type public.tipo_conexao add value if not exists 'meta_publicacao';

alter table public.sincronizacoes drop constraint if exists sincronizacoes_tipo_check;
alter table public.sincronizacoes add constraint sincronizacoes_tipo_check check (tipo in ('meta', 'stripe_historico', 'meta_publicacao'));

-- Onde e com o quê a organização publica: conta, Página, Instagram, pixel e o teto de verba.
create table public.config_publicacao (
  organizacao_id     uuid primary key references public.organizacoes (id) on delete cascade,
  account_id         text check (account_id ~ '^act_[0-9]+$'),
  page_id            text,
  page_nome          text,
  instagram_user_id  text,
  instagram_nome     text,
  pixel_id           text,
  pixel_nome         text,
  teto_verba_diaria  numeric(14, 2) not null default 100 check (teto_verba_diaria > 0),
  atualizado_em      timestamptz not null default now()
);

create table public.campanhas_assistente (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  modelo           text not null default 'cadastro_site',
  nome             text not null check (length(trim(nome)) between 2 and 200),
  rascunho         jsonb not null default '{}',
  status           text not null default 'rascunho'
                   check (status in ('rascunho', 'criando', 'criada', 'ativando', 'ativa', 'erro')),
  erro             text,
  account_id       text,
  meta_campaign_id text,
  meta_adset_id    text,
  criado_por       uuid references auth.users (id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  ativada_em       timestamptz,
  ativada_por      uuid references auth.users (id) on delete set null
);
create index campanhas_assistente_org_idx on public.campanhas_assistente (organizacao_id, criado_em desc);

create table public.criativos_assistente (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  campanha_id     uuid not null references public.campanhas_assistente (id) on delete cascade,
  ordem           integer not null default 0,
  nome            text not null check (length(trim(nome)) between 1 and 200),
  tipo            text not null check (tipo in ('video', 'imagem')),
  arquivo_path    text not null,          -- bucket uploads-criativos: <organizacao_id>/<campanha_id>/<arquivo>
  arquivo_nome    text,
  mime            text,
  tamanho         bigint,
  texto           text not null default '',
  titulo          text not null default '',
  chamada         text not null default 'SIGN_UP',
  status          text not null default 'pendente'
                  check (status in ('pendente', 'enviado', 'processado', 'criado', 'erro')),
  erro            text,
  meta_video_id   text,
  meta_image_hash text,
  meta_thumb_url  text,
  meta_creative_id text,
  meta_ad_id      text,
  criado_em       timestamptz not null default now()
);
create index criativos_assistente_campanha_idx on public.criativos_assistente (campanha_id, ordem);

-- Auditoria de escrita na Meta (sem token). validacao = chamada com validate_only.
create table public.operacoes_meta (
  id             bigint generated always as identity primary key,
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  campanha_id    uuid references public.campanhas_assistente (id) on delete set null,
  usuario_id     uuid references auth.users (id) on delete set null,
  metodo         text not null,
  caminho        text not null,
  parametros     jsonb not null default '{}',
  validacao      boolean not null default false,
  status_http    integer,
  resposta       jsonb,
  criado_em      timestamptz not null default now()
);
create index operacoes_meta_campanha_idx on public.operacoes_meta (campanha_id, criado_em);

alter table public.config_publicacao enable row level security;
alter table public.campanhas_assistente enable row level security;
alter table public.criativos_assistente enable row level security;
alter table public.operacoes_meta enable row level security;

create policy "membro lê" on public.config_publicacao for select to authenticated using (public.eh_membro(organizacao_id));
create policy "dono altera" on public.config_publicacao for update to authenticated using (public.tem_papel(organizacao_id, 'dono')) with check (public.tem_papel(organizacao_id, 'dono'));
create policy "dono cria" on public.config_publicacao for insert to authenticated with check (public.tem_papel(organizacao_id, 'dono'));

-- Rascunhos: gestor cria e edita enquanto o conjunto de anúncios não existe na Meta (se a Meta recusar o
-- conjunto depois de criar a campanha, ainda dá para corrigir e reenviar); daí em diante só o servidor muda.
create policy "membro lê" on public.campanhas_assistente for select to authenticated using (public.eh_membro(organizacao_id));
create policy "gestor cria rascunho" on public.campanhas_assistente for insert to authenticated
  with check (public.tem_papel(organizacao_id, 'gestor') and status = 'rascunho' and meta_campaign_id is null and criado_por = auth.uid());
create policy "gestor edita rascunho" on public.campanhas_assistente for update to authenticated
  using (public.tem_papel(organizacao_id, 'gestor') and status in ('rascunho', 'erro') and meta_adset_id is null)
  with check (public.tem_papel(organizacao_id, 'gestor') and status in ('rascunho', 'erro') and meta_adset_id is null);
create policy "gestor apaga rascunho" on public.campanhas_assistente for delete to authenticated
  using (public.tem_papel(organizacao_id, 'gestor') and meta_campaign_id is null);

create policy "membro lê" on public.criativos_assistente for select to authenticated using (public.eh_membro(organizacao_id));
create policy "gestor cria criativo" on public.criativos_assistente for insert to authenticated
  with check (public.tem_papel(organizacao_id, 'gestor') and status = 'pendente' and meta_creative_id is null
              and arquivo_path like organizacao_id::text || '/' || campanha_id::text || '/%'
              and exists (select 1 from public.campanhas_assistente c where c.id = campanha_id and c.organizacao_id = criativos_assistente.organizacao_id and c.status in ('rascunho', 'erro')));
create policy "gestor edita criativo" on public.criativos_assistente for update to authenticated
  using (public.tem_papel(organizacao_id, 'gestor') and meta_creative_id is null)
  with check (public.tem_papel(organizacao_id, 'gestor') and meta_creative_id is null);
create policy "gestor apaga criativo" on public.criativos_assistente for delete to authenticated
  using (public.tem_papel(organizacao_id, 'gestor') and meta_creative_id is null);

create policy "gestor lê auditoria" on public.operacoes_meta for select to authenticated using (public.tem_papel(organizacao_id, 'gestor'));
