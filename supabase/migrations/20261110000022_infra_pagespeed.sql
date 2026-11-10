-- Velocidade das páginas de destino (Storage + pg_cron; os testes locais pulam este arquivo).

-- Capturas da página inteira: privadas, em <organizacao_id>/<hash da página>.jpg (só a mais recente).
-- Só o servidor grava; membros leem (a tela usa URL assinada).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paginas', 'paginas', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "membro lê capturas de página da organização" on storage.objects
  for select to authenticated
  using (bucket_id = 'paginas' and public.eh_membro(((storage.foldername(name))[1])::uuid));

-- Um teste por página de destino dos anúncios ativos, por organização. O alvo é o endereço sem parâmetros.
create or replace function public.agendar_pagespeed()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
  n integer := 0;
begin
  for p in
    select distinct a.organizacao_id,
           regexp_replace(split_part(split_part(d, '#', 1), '?', 1), '^(https?://[^/]+)$', '\1/') as url
      from public.meta_anuncios a, unnest(a.destinos) d
     where a.status = 'ACTIVE' and d ~* '^https?://'
  loop
    perform public.enfileirar_sincronizacao(p.organizacao_id, 'pagespeed', p.url, 'incremental');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.agendar_pagespeed() from public, anon, authenticated;

-- 9h UTC = 6h em Brasília: o teste da manhã já está pronto quando a equipe abre o painel.
select cron.schedule('ads-pagespeed', '0 9 * * *', $$select public.agendar_pagespeed()$$);
