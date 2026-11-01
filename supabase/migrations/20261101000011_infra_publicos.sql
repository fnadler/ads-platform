-- Fila e agendamento dos públicos (pgmq/pg_cron; os testes locais pulam este arquivo).
-- agendar_publicos (migração 10) só registra as execuções; aqui elas entram na fila e o cron roda todo dia.

create or replace function public.agendar_publicos()
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
    perform public.enfileirar_sincronizacao(p.organizacao_id, 'meta_publico', p.id::text, 'incremental');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.agendar_publicos() from public, anon, authenticated;

-- 7h UTC = 4h em Brasília: a lista atualizada antes do dia de veiculação.
select cron.schedule('ads-publicos', '0 7 * * *', $$select public.agendar_publicos()$$);
