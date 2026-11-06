-- Coleta diária do Clarity (pgmq/pg_cron; os testes locais pulam este arquivo).
-- Uma execução por conexão ativa. A API devolve as últimas 24 h a partir da chamada, então o horário
-- define o "dia": 3h10 UTC = 0h10 em Brasília, e a janela cobre o dia anterior inteiro (fuso de Brasília).
-- Cada coleta faz 3 consultas das 10 que o Clarity permite por dia; sobram 7 para "Coletar agora".

create or replace function public.agendar_clarity()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  n integer := 0;
begin
  for c in select organizacao_id, id from public.conexoes where tipo = 'clarity' and status = 'ativa'
  loop
    perform public.enfileirar_sincronizacao(c.organizacao_id, 'clarity', c.id::text, 'incremental');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.agendar_clarity() from public, anon, authenticated;

select cron.schedule('ads-clarity', '10 3 * * *', $$select public.agendar_clarity()$$);
