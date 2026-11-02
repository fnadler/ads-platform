-- O primeiro toque também traz utm_term nos anúncios reais; sem a coluna, o webhook recusava o lead inteiro.
alter table public.leads add column if not exists ftp_utm_term text;
