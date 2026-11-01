-- Pagantes pelos dados de venda (correção). leads.primeiro_pagamento_em só era gravado quando a venda chegava
-- depois do lead; na importação do histórico do Stripe as faturas vêm antes dos cadastros, e o campo ficava
-- vazio. Agora: (1) preenche o que faltou; (2) o funil considera pagante quem tem venda paga ligada ao lead
-- (pelo id externo ou, sem ele, pelo hash do e-mail), além do campo.

update public.leads l
   set primeiro_pagamento_em = v.primeira
  from (
    select organizacao_id, lead_id_externo, min(ocorrida_em) as primeira
      from public.vendas
     where tipo = 'pagamento' and lead_id_externo is not null
     group by 1, 2
  ) v
 where l.organizacao_id = v.organizacao_id
   and l.id_externo = v.lead_id_externo
   and l.primeiro_pagamento_em is null;

create or replace function public.membros_publico_funil(p_org uuid, p_segmento text, p_dias integer default null)
returns table (email_hash text, telefone_hash text)
language sql stable security definer set search_path = ''
as $$
  with base as (
    select l.email_hash, l.telefone_hash, l.teste_iniciado_em,
           (l.primeiro_pagamento_em is not null or exists (
              select 1 from public.vendas v
               where v.organizacao_id = l.organizacao_id
                 and v.tipo = 'pagamento'
                 and (v.lead_id_externo = l.id_externo
                      or (v.lead_id_externo is null and v.email_hash is not null and v.email_hash = l.email_hash))
           )) as pagou
      from public.leads l
     where l.organizacao_id = p_org
       and l.codigo_teste is null
       and l.fora_de_publicos_em is null
       and (l.email_hash is not null or l.telefone_hash is not null)
       and (p_dias is null or l.criado_em >= now() - make_interval(days => p_dias))
  )
  select email_hash, telefone_hash
    from base
   where case p_segmento
           when 'pagantes' then pagou
           when 'cadastrados_sem_teste' then teste_iniciado_em is null and not pagou
           when 'teste_sem_pagamento' then teste_iniciado_em is not null and not pagou
           when 'todos' then true
           else false
         end;
$$;
revoke execute on function public.membros_publico_funil(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.membros_publico_funil(uuid, text, integer) to service_role;
