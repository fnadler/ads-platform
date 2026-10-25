# Roteiro de teste — piloto GN Coleciona

Objetivo: a campanha de **3/11** nasce rastreada, e o sistema mostra o desempenho dela desde o primeiro dia.

**Critério de pronto da fase 1** (conferir em 4/11):
- um lead de teste vindo de um anúncio aparece no sistema com o `ad_id` correto;
- o gasto do dia 3/11 no painel bate com o Gerenciador de Anúncios, com diferença de no máximo 2%.

## Etapa A — GN Coleciona (o que não pode esperar)

O site precisa capturar os IDs do anúncio **antes** de qualquer clique pago. O sistema novo pode ficar pronto depois: o site guarda tudo em `marketing_attribution`, e o script de reenvio leva o histórico.

1. No repositório `fifa-worldcup-2026`, revise as mudanças, que ainda não têm commit:
   - `lib/attribution.ts` e `proxy.ts`: capturam `utm_campaign_id`, `utm_adset_id` e `utm_ad_id`, e gravam o primeiro toque no cookie `gn_attr_ft`;
   - `lib/metaClient.ts`: leva o primeiro toque ao cadastro;
   - `lib/metaConversions.ts`: grava as colunas novas e envia o lead ao sistema;
   - `lib/adsPlatform.ts`: o envio;
   - `scripts/reenviar-leads-ads-platform.mjs`: reenvio do histórico;
   - `content/legal.ts`: política de privacidade;
   - `.env.example`.
2. No Supabase **do GN**, rode `supabase_migration_marketing_attribution_ids.sql` no SQL Editor.
3. Publique o GN. Sem as variáveis `ADS_PLATFORM_*`, ele só deixa um aviso no log e continua funcionando normalmente.
4. **Teste rápido:**
   - numa janela anônima, abra `https://www.gncoleciona.com.br/?utm_source=meta&utm_campaign=teste&utm_campaign_id=111111&utm_adset_id=222222&utm_ad_id=333333&fbclid=teste`;
   - crie uma conta e confirme o e-mail;
   - no Supabase do GN: `select utm_ad_id, ftp_utm_ad_id from marketing_attribution order by created_at desc limit 1;` deve trazer `333333` nas duas colunas.

## Etapa B — Sistema no ar

1. Siga a seção **Instalação** do README: Supabase, migrações, segredos no Vault, variáveis, Vercel Pro e primeiro admin.
2. Entre como admin → **Administração** → crie a organização **GN Coleciona** (`gn-coleciona`).
3. Confira que o worker é chamado:
   - em **Sincronizações**, as execuções saem de “Na fila” em até 1 minuto;
   - se não saírem, verifique no Supabase: `select * from cron.job_run_details order by start_time desc limit 5;` e `select * from net._http_response order by created desc limit 5;`.

## Etapa C — Conexões

1. **Meta:**
   - crie o usuário do sistema no portfólio do GN, com acesso à conta de anúncios e `ads_read`;
   - cole o token em **Configurações → Meta**;
   - ligue a conta de anúncios, com histórico desde 1/10/2026 (ou a data que preferir).
2. **Webhook:**
   - em **Configurações → Webhook**, gere o token;
   - na Vercel do GN, configure `ADS_PLATFORM_URL` (endereço do sistema) e `ADS_PLATFORM_TOKEN` (o token) e publique de novo;
   - para trazer os cadastros que já existem: `node --env-file=.env.local scripts/reenviar-leads-ads-platform.mjs` no repositório do GN.
3. **Stripe:** siga a tela (chave restrita → endereço do webhook → `whsec_`). Depois, clique em **Importar histórico**.
4. **Métricas:** depois da primeira sincronização, marque o cadastro como “Lead” (`offsite_conversion.fb_pixel_complete_registration`, ou o tipo que aparecer na lista) e rode **Sincronizações → Recarregar histórico**.

**Teste do Stripe** (modo de teste):
1. Use uma chave `rk_test_` e um webhook de teste.
2. Faça uma assinatura com o cartão `4242 4242 4242 4242`. Em **Leads e vendas**, o lead deve aparecer com “Teste = sim”.
3. No Stripe CLI, `stripe trigger invoice.paid` gera uma venda.
4. Depois, troque pela chave de produção.

## Etapa D — Anúncios (antes de publicar a campanha)

1. Monte a campanha no Gerenciador. Em **cada anúncio → Destino → Parâmetros de URL**, cole o texto da tela **Rastreio**.
2. **Rastreio → Reler na Meta agora.** Todos os anúncios devem aparecer como “OK”. Anúncios em rascunho não aparecem: publique agendada para 3/11 ou deixe pausada até lá.
3. **Verificar páginas de destino:** todas devem responder 200.
4. **Teste de ponta a ponta:**
   1. clique em **Novo teste**;
   2. abra o link numa janela anônima;
   3. cadastre-se no GN com `seuemail+rastreio-<código>@gmail.com` e confirme o e-mail;
   4. clique em **Verificar agora**: todos os campos devem dar OK, inclusive “anúncio atribuído”.

   Se algum campo falhar, a coluna da direita diz onde corrigir.
5. A tela **Início** deve mostrar os passos 1 a 4 como “Feito”.

## Etapa E — Dia 3/11 e seguintes

1. Ao longo do dia, os leads aparecem em **Leads e vendas** com “Anúncio (último toque)”. A cobertura de leads vindos da campanha deve ficar perto de 100%.
2. **4/11, critério de gasto:** em **Desempenho → 7 dias**, abra a campanha e compare o gasto do dia 3/11 com o Gerenciador (coluna “Valor usado”, mesmo dia, fuso da conta).
   - A diferença tolerada é de 2%.
   - O painel atualiza às 6h, 12h e 18h; para conferir na hora, use **Sincronizações → Sincronizar agora**.
3. **4/11, critério de atribuição:** repita o teste de ponta a ponta com o anúncio já veiculando e confirme “Ponta a ponta OK”.
4. A diferença entre “Leads (Meta)” e “Leads (sistema)” é esperada:
   - a Meta conta por janela de atribuição (7 dias clique / 1 dia visualização) e modela conversões;
   - o sistema conta só quem chegou com o `utm_ad_id`.

   O que importa é a tendência, e a cobertura não cair.

## Se algo der errado

| Sintoma | Onde olhar |
| --- | --- |
| Lead chega “Sem anúncio” | Os parâmetros do anúncio (Rastreio); se o lead veio com `utm_source=meta` mas sem IDs, o anúncio foi publicado antes de colar os parâmetros. |
| Lead não chega | Logs da Vercel do GN (`[ads-platform]`) e se o token do webhook é o atual. Reenvie com o script. |
| Venda sem anúncio | Se a assinatura tem `user_id` no metadata (o checkout do GN já grava) e se o lead desse usuário chegou. |
| Sincronização em erro | A mensagem em Sincronizações. “Token expirou”: gere um token novo do usuário do sistema. |
| Gasto diverge mais de 2% | Fuso da conta (Configurações) e se a última sincronização terminou depois das 6h do dia seguinte. |
