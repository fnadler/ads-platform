-- Bucket dos arquivos enviados pelo assistente de campanhas (vídeos e imagens), privado. O navegador envia
-- direto ao Storage (sem passar pela função da Vercel, que limita o corpo a 4,5 MB); a Meta baixa o vídeo
-- por URL assinada. Caminho: <organizacao_id>/<campanha_id>/<arquivo>. Os testes locais (PGlite) pulam este
-- arquivo (não há Storage).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads-criativos', 'uploads-criativos', false, 52428800,
        array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "gestor envia criativos da organização" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads-criativos' and public.tem_papel(((storage.foldername(name))[1])::uuid, 'gestor'));

create policy "membro lê criativos enviados" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads-criativos' and public.eh_membro(((storage.foldername(name))[1])::uuid));

create policy "gestor apaga criativos enviados" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads-criativos' and public.tem_papel(((storage.foldername(name))[1])::uuid, 'gestor'));
