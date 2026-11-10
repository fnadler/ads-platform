-- Velocidade da página de destino: um teste do PageSpeed Insights (Lighthouse, celular simulado) por página
-- por dia, mais os avulsos ("Testar de novo"). Guarda só o resumo (~6 KB; a resposta inteira tem ~700 KB) e
-- o caminho da captura da página inteira no Storage (bucket "paginas", só a mais recente de cada página).
-- Gravado só pelo servidor (worker); membros leem.

alter table public.sincronizacoes drop constraint if exists sincronizacoes_tipo_check;
alter table public.sincronizacoes add constraint sincronizacoes_tipo_check
  check (tipo in ('meta', 'stripe_historico', 'meta_publicacao', 'meta_publico', 'clarity', 'pagespeed'));

create table public.pagina_testes (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  url            text not null,  -- como foi testada (sem parâmetros)
  chave          text not null,  -- host sem "www." + caminho sem barra no fim: casa com os destinos dos anúncios
  estrategia     text not null default 'mobile' check (estrategia in ('mobile', 'desktop')),
  testado_em     timestamptz not null default now(),
  nota           smallint check (nota between 0 and 100),
  resumo         jsonb not null,
  captura_path   text
);
create index pagina_testes_chave_idx on public.pagina_testes (organizacao_id, chave, testado_em desc);

alter table public.pagina_testes enable row level security;
create policy "membro lê" on public.pagina_testes for select to authenticated using (public.eh_membro(organizacao_id));
