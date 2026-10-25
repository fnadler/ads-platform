-- Infraestrutura do Supabase: fila de jobs (pgmq), agendamento (pg_cron), chamada HTTP ao worker
-- (pg_net, com URL e segredo no Vault) e o bucket dos criativos. Os testes locais (PGlite) não têm estas
-- extensões e pulam este arquivo.
--
-- Fluxo: enfileirar_sincronizacao grava a execução e põe uma mensagem na fila "jobs". A cada minuto o
-- pg_cron chama disparar_worker, que faz POST em /api/jobs/processar (Vercel) se houver mensagem.
-- O worker lê com tempo de visibilidade (a mensagem volta sozinha se a função morrer), processa uma fatia
-- dentro do prazo e apaga a mensagem ou a reenvia com atraso (próxima fatia, ou espera por limite de uso).
--
-- Antes de funcionar, crie os dois segredos no Vault (README, "Fila e agendamento"):
--   select vault.create_secret('https://<seu-dominio>/api/jobs/processar', 'worker_url');
--   select vault.create_secret('<mesmo valor de SEGREDO_WORKER>', 'worker_segredo');

-- Supabase (Postgres 17): pgmq e pg_cron precisam ir no próprio esquema; pg_net vai em "extensions".
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select pgmq.create('jobs');

-- Cria (ou reaproveita a viva) a execução e enfileira. Chamada pelo servidor (service role) ou por um
-- gestor da organização (botão "Sincronizar agora").
create function public.enfileirar_sincronizacao(
  p_org uuid, p_tipo text, p_alvo text, p_modo text, p_atraso integer default 0
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.tem_papel(p_org, 'gestor') then
    raise exception 'Só gestores sincronizam.';
  end if;
  insert into public.sincronizacoes (organizacao_id, tipo, alvo, modo, disparado_por)
  values (p_org, p_tipo, p_alvo, p_modo, auth.uid())
  on conflict (organizacao_id, tipo, alvo) where status in ('na_fila', 'rodando') do nothing
  returning id into v_id;
  if v_id is null then
    -- já existe uma viva para este alvo: não duplica
    select id into v_id from public.sincronizacoes
     where organizacao_id = p_org and tipo = p_tipo and alvo = p_alvo and status in ('na_fila', 'rodando');
    return v_id;
  end if;
  perform pgmq.send('jobs', jsonb_build_object('sincronizacao_id', v_id), greatest(p_atraso, 0));
  return v_id;
end;
$$;
revoke execute on function public.enfileirar_sincronizacao(uuid, text, text, text, integer) from public, anon;
grant execute on function public.enfileirar_sincronizacao(uuid, text, text, text, integer) to authenticated, service_role;

-- Acesso à fila para o worker (só service role).
create function public.fila_ler(p_qtd integer, p_visibilidade integer)
returns table (msg_id bigint, leituras integer, mensagem jsonb)
language sql security definer set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message from pgmq.read('jobs', p_visibilidade, p_qtd) r;
$$;

create function public.fila_apagar(p_msg_id bigint)
returns boolean
language sql security definer set search_path = ''
as $$ select pgmq.delete('jobs', p_msg_id); $$;

create function public.fila_reenviar(p_sincronizacao uuid, p_atraso integer)
returns bigint
language sql security definer set search_path = ''
as $$ select pgmq.send('jobs', jsonb_build_object('sincronizacao_id', p_sincronizacao), greatest(p_atraso, 0)); $$;

revoke execute on function public.fila_ler(integer, integer) from public, anon, authenticated;
revoke execute on function public.fila_apagar(bigint) from public, anon, authenticated;
revoke execute on function public.fila_reenviar(uuid, integer) from public, anon, authenticated;
grant execute on function public.fila_ler(integer, integer) to service_role;
grant execute on function public.fila_apagar(bigint) to service_role;
grant execute on function public.fila_reenviar(uuid, integer) to service_role;

-- Atualização automática: um job incremental por conta de anúncio ativa com conexão ativa.
create function public.agendar_incrementais()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select ca.organizacao_id, ca.account_id
      from public.contas_anuncio ca
      join public.conexoes co on co.id = ca.conexao_id
     where ca.ativa and co.status = 'ativa'
  loop
    perform public.enfileirar_sincronizacao(c.organizacao_id, 'meta', c.account_id, 'incremental');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.agendar_incrementais() from public, anon, authenticated;

-- Acorda o worker se houver mensagem na fila. Sem os segredos no Vault, não faz nada.
create function public.disparar_worker()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_segredo text;
begin
  if not exists (select 1 from pgmq.q_jobs where vt <= now()) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'worker_segredo';
  if v_url is null or v_segredo is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_segredo, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.disparar_worker() from public, anon, authenticated;

-- Execução presa em "rodando" (função morreu no meio): volta para a fila depois de 15 minutos.
create function public.destravar_sincronizacoes()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
begin
  for s in
    update public.sincronizacoes set status = 'na_fila', atualizado_em = now()
     where status = 'rodando' and atualizado_em < now() - interval '15 minutes'
    returning id
  loop
    perform pgmq.send('jobs', jsonb_build_object('sincronizacao_id', s.id));
  end loop;
end;
$$;
revoke execute on function public.destravar_sincronizacoes() from public, anon, authenticated;

-- Horários em UTC: 9h, 15h e 21h UTC = 6h, 12h e 18h em Brasília.
select cron.schedule('ads-worker', '* * * * *', $$select public.disparar_worker()$$);
select cron.schedule('ads-incrementais', '0 9,15,21 * * *', $$select public.agendar_incrementais()$$);
select cron.schedule('ads-destravar', '*/10 * * * *', $$select public.destravar_sincronizacoes()$$);
select cron.schedule('ads-retencao', '30 6 * * *', $$select public.limpar_retencao()$$);

-- Imagens dos criativos: privadas, em <organizacao_id>/<account_id>/<ad_id>.<ext>. Só o servidor grava;
-- membros leem (a tela usa URL assinada).
insert into storage.buckets (id, name, public) values ('criativos', 'criativos', false)
on conflict (id) do nothing;

create policy "membro lê criativos da organização" on storage.objects
  for select to authenticated
  using (bucket_id = 'criativos' and public.eh_membro(((storage.foldername(name))[1])::uuid));
