-- Metas por campanha e destino por criativo.
--
-- Metas: quanto a pessoa aceita pagar por cadastro e por venda. A leitura da campanha compara o custo real
-- com a meta (depois de um mínimo de dias e de volume) e avisa quando passa. Valem para as duas origens de
-- campanha, por isso a chave é o id da campanha na Meta. No rascunho do assistente (antes de existir id na
-- Meta) as metas ficam em campanhas_assistente.rascunho e servem de valor inicial.
--
-- Destino por criativo: cada anúncio montado aqui pode levar a pessoa a uma página própria (ex.: a mesma página
-- com ?para=vender para o anúncio que fala de vender). Em branco, vale o destino da campanha.

create table public.metas_campanha (
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  meta_campaign_id text not null check (meta_campaign_id ~ '^[0-9]+$'),
  custo_cadastro   numeric(14, 2) check (custo_cadastro > 0),
  custo_venda      numeric(14, 2) check (custo_venda > 0),
  atualizado_por   uuid references auth.users (id) on delete set null,
  atualizado_em    timestamptz not null default now(),
  primary key (organizacao_id, meta_campaign_id)
);

alter table public.metas_campanha enable row level security;

create policy "membro lê" on public.metas_campanha for select to authenticated using (public.eh_membro(organizacao_id));
create policy "gestor cria" on public.metas_campanha for insert to authenticated with check (public.tem_papel(organizacao_id, 'gestor'));
create policy "gestor altera" on public.metas_campanha for update to authenticated
  using (public.tem_papel(organizacao_id, 'gestor')) with check (public.tem_papel(organizacao_id, 'gestor'));
create policy "gestor apaga" on public.metas_campanha for delete to authenticated using (public.tem_papel(organizacao_id, 'gestor'));

alter table public.criativos_assistente add column if not exists url_destino text
  check (url_destino is null or (url_destino ~ '^https://' and url_destino !~ '[?&]utm_'));
