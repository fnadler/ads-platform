-- Dados da Meta por organização: insights diários (campanha e anúncio) e a dimensão de anúncios
-- (nome atual, status, parâmetros de URL, destino, textos e a imagem guardada no Storage, porque as
-- URLs da Meta expiram). Gravados só pelo servidor (sincronização); membros leem.
-- Janelas de atribuição: 7 dias clique + 1 dia visualização. leads/compras somam as ações listadas em
-- config_metricas no momento da sincronização; as ações brutas ficam em acoes_brutas.

create table public.meta_campanha_dia (
  organizacao_id       uuid not null references public.organizacoes (id) on delete cascade,
  account_id           text not null,
  campaign_id          text not null,
  dia                  date not null,
  campaign_name        text,
  gasto                numeric(14, 2) not null default 0,
  impressoes           bigint not null default 0,
  frequencia           numeric(8, 4) not null default 0,
  cliques_link         integer not null default 0,
  visualizacoes_pagina integer not null default 0,
  leads                integer not null default 0,
  compras              integer not null default 0,
  valor_compras        numeric(14, 2) not null default 0,
  conversas_iniciadas  integer not null default 0,
  acoes_brutas         jsonb not null default '[]',
  sincronizado_em      timestamptz not null default now(),
  primary key (organizacao_id, account_id, campaign_id, dia)
);
create index meta_campanha_dia_dia_idx on public.meta_campanha_dia (organizacao_id, dia);

create table public.meta_anuncio_dia (
  organizacao_id       uuid not null references public.organizacoes (id) on delete cascade,
  account_id           text not null,
  ad_id                text not null,
  dia                  date not null,
  campaign_id          text,
  campaign_name        text,
  adset_id             text,
  adset_name           text,
  ad_name              text,
  gasto                numeric(14, 2) not null default 0,
  impressoes           bigint not null default 0,
  frequencia           numeric(8, 4) not null default 0,
  cliques_link         integer not null default 0,
  visualizacoes_pagina integer not null default 0,
  leads                integer not null default 0,
  compras              integer not null default 0,
  valor_compras        numeric(14, 2) not null default 0,
  conversas_iniciadas  integer not null default 0,
  acoes_brutas         jsonb not null default '[]',
  sincronizado_em      timestamptz not null default now(),
  primary key (organizacao_id, account_id, ad_id, dia)
);
create index meta_anuncio_dia_campanha_idx on public.meta_anuncio_dia (organizacao_id, campaign_id, dia);
create index meta_anuncio_dia_dia_idx on public.meta_anuncio_dia (organizacao_id, dia);

create table public.meta_anuncios (
  organizacao_id    uuid not null references public.organizacoes (id) on delete cascade,
  account_id        text not null,
  ad_id             text not null,
  nome              text,
  campaign_id       text,
  campaign_name     text,
  adset_id          text,
  adset_name        text,
  status            text,          -- effective_status da Meta (ou EXPIRED: conjunto/campanha já terminou)
  creative_id       text,
  url_tags          text,          -- "Parâmetros de URL" do anúncio
  destinos          text[] not null default '{}',
  titulo            text,
  texto             text,
  chamada           text,
  imagem_path       text,          -- caminho no bucket "criativos": <organizacao_id>/<account_id>/<ad_id>.<ext>
  imagem_original   boolean not null default false,
  imagem_em         timestamptz,
  atualizado_em     timestamptz not null default now(),
  primary key (organizacao_id, account_id, ad_id)
);
create index meta_anuncios_campanha_idx on public.meta_anuncios (organizacao_id, campaign_id);

alter table public.meta_campanha_dia enable row level security;
alter table public.meta_anuncio_dia enable row level security;
alter table public.meta_anuncios enable row level security;

create policy "membro lê" on public.meta_campanha_dia for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.meta_anuncio_dia for select to authenticated using (public.eh_membro(organizacao_id));
create policy "membro lê" on public.meta_anuncios for select to authenticated using (public.eh_membro(organizacao_id));
