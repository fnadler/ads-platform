-- Duração do teste grátis (funil cadastro → teste → venda): diz quando sai a primeira cobrança de cada
-- teste e, com isso, a partir de quando a leitura da campanha pode julgar custo por venda.
alter table public.organizacoes add column dias_teste smallint not null default 7 check (dias_teste between 1 and 90);
