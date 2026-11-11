-- Pausar e reativar também campanhas criadas direto no Gerenciador (sem linha em campanhas_assistente).
-- O registro de escrita na Meta passa a guardar o id da campanha na Meta, para o histórico da campanha
-- (quem pausou, quem reativou e quando) funcionar nas duas origens.

alter table public.operacoes_meta add column if not exists meta_campaign_id text;

create index if not exists operacoes_meta_campanha_meta_idx on public.operacoes_meta (organizacao_id, meta_campaign_id, criado_em desc)
  where meta_campaign_id is not null;

-- Operações antigas de campanhas montadas aqui: preenche pelo vínculo com o assistente.
update public.operacoes_meta o
set meta_campaign_id = c.meta_campaign_id
from public.campanhas_assistente c
where o.campanha_id = c.id
  and o.meta_campaign_id is null
  and c.meta_campaign_id is not null;
