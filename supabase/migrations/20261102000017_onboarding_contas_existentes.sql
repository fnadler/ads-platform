-- A tela Início passa a mostrar só o assistente. Quem conectou antes dele não respondeu às perguntas: as respostas
-- vêm do que já está conectado, para essas organizações não aparecerem como se nada tivesse sido feito.
update public.organizacoes o
   set onboarding = o.onboarding || jsonb_build_object(
         'plataforma', case
           when exists (select 1 from public.conexoes c where c.organizacao_id = o.id and c.tipo = 'hotmart') then 'hotmart'
           when exists (select 1 from public.conexoes c where c.organizacao_id = o.id and c.tipo = 'kiwify') then 'kiwify'
           when exists (select 1 from public.conexoes c where c.organizacao_id = o.id and c.tipo = 'stripe') then 'stripe'
           else 'outra' end,
         'funil', o.funil,
         'site', 'naosei',
         'campanhas', case when exists (select 1 from public.conexoes c where c.organizacao_id = o.id and c.tipo = 'meta_publicacao') then 'sim' else 'nao' end)
 where o.onboarding = '{}'
   and exists (select 1 from public.conexoes c where c.organizacao_id = o.id and c.tipo = 'meta');
