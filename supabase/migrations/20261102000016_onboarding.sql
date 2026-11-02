-- Assistente de configuração: respostas da pessoa e resultado da conferência da página. O andamento de cada
-- passo não fica aqui: ele é calculado pelo que o sistema verifica (conexões, contas, eventos recebidos).
alter table public.organizacoes add column onboarding jsonb not null default '{}';
