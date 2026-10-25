# Tráfego que vende

Sistema multicliente de inteligência de tráfego pago. Conecta a conta de anúncios da Meta de cada cliente, cruza a mídia com as vendas e mostra quais anúncios trazem venda, não só clique ou conversa.

Stack: Next.js 16 (App Router), Supabase (Postgres com RLS, Auth, Storage, `pgmq`, `pg_cron`, `pg_net`, Vault) e Vercel.

> O roteiro para validar o piloto (GN Coleciona, campanha de 3/11) está em [docs/roteiro-teste-piloto.md](docs/roteiro-teste-piloto.md).

## Como está organizado

| Pasta | O quê |
| --- | --- |
| `supabase/migrations/` | Esquema, RLS e funções. Toda tabela de dados tem `organizacao_id`, e o isolamento entre clientes é feito no banco. |
| `src/lib/auth/sessao.ts` | Quem está logado e com que papel (`dono`, `gestor`, `leitura`) em qual organização. |
| `src/lib/integracoes/` | Clientes da Meta (só leitura) e do Stripe. |
| `src/lib/meta/sincronizacao.ts` | Sincronização da Meta: fatiada por mês, retomável pelo cursor. |
| `src/lib/vendas/` | Entrada de leads e vendas, comum a todas as fontes (webhook, Stripe, CSV). |
| `src/lib/rastreio/` | Regras de rastreio e o teste de ponta a ponta. |
| `src/lib/jobs/worker.ts` | Worker da fila. |
| `tests/banco/` | Testes de RLS e das consultas num Postgres em memória (PGlite). |

## Instalação (uma vez)

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. Em **Authentication → Sign In / Providers**:
   - **desligue** “Allow new users to sign up”: contas novas nascem só de convite;
   - deixe o provedor e-mail ligado.
3. Em **Authentication → URL Configuration**:
   - Site URL = o endereço do sistema (ex.: `https://ads.seudominio.com.br`);
   - acrescente `https://ads.seudominio.com.br/**` às Redirect URLs.
4. Aplique as migrações:

   ```bash
   npm install
   npx supabase login
   npm run db:vincular -- --project-ref <ref-do-projeto>
   npm run db:aplicar
   ```

   Elas criam as tabelas, o RLS, a fila `jobs` (pgmq), os agendamentos (pg_cron) e o bucket privado `criativos`.
5. No **SQL Editor**, crie os dois segredos que o agendador usa para acordar o worker:

   ```sql
   select vault.create_secret('https://ads.seudominio.com.br/api/jobs/processar', 'worker_url');
   select vault.create_secret('<mesmo valor de SEGREDO_WORKER>', 'worker_segredo');
   ```

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` (desenvolvimento) e preencha as mesmas variáveis na Vercel (Settings → Environment Variables):

| Variável | Onde pegar |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `CHAVE_CIFRAGEM` | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Ela cifra as credenciais dos clientes. Guarde num cofre: se ela se perder, todas as conexões precisam ser cadastradas de novo. |
| `SEGREDO_WORKER` | Gere com o mesmo comando. Use o mesmo valor no segredo `worker_segredo` do Vault. |
| `URL_SISTEMA` | Endereço público do sistema |
| `META_API_VERSION` | `v26.0` |

### 3. Vercel

Importe o repositório. É preciso o **plano Pro**: o worker roda até 5 minutos por chamada (`maxDuration = 300`), e o plano gratuito corta antes.

### 4. Primeiro administrador

```bash
npm run criar-admin -- voce@seudominio.com.br
```

Se a conta não existir, o comando a cria e mostra uma senha provisória uma vez.

## Uso

### Cadastrar uma organização (cliente)

1. Entre como administrador e abra **Administração** (link na página inicial).
2. Informe o nome e o endereço (ex.: `gn-coleciona`). Você entra como dono da organização.
3. Em **Configurações → Membros**, convide as pessoas do cliente. O sistema gera um link válido por 7 dias para você mandar a elas; quem recebe cria a própria senha ao abrir.

### Conectar a Meta

Em **Configurações → Meta**, cole o token de um **usuário do sistema** do portfólio empresarial do cliente, com `ads_read` e acesso à conta de anúncios. O passo a passo aparece na própria tela.

- O token é validado na hora (leitura de `/me` e `/me/adaccounts`) e guardado cifrado.
- Ligue a conta de anúncios e escolha a data de início do histórico. A carga entra na fila.
- Depois disso, a sincronização roda sozinha às 6h, 12h e 18h (horário de Brasília) e reescreve os últimos 7 dias, porque a Meta revisa conversões nessa janela.
- Em **Configurações → O que conta como lead e compra**, marque as ações da Meta que valem como lead. No GN Coleciona é o cadastro: `offsite_conversion.fb_pixel_complete_registration`. A lista mostra as ações que já apareceram nas campanhas.

### Conectar a fonte de venda

**Webhook genérico** (qualquer site ou ferramenta de automação):
- Em **Configurações → Webhook**, gere o token. O endereço é `POST /api/webhook/eventos`, com `Authorization: Bearer whk_…`.
- O formato aparece na tela: `lead`, `teste_iniciado`, `venda` e `reembolso`, um por vez ou `{ "eventos": [...] }`.
- Reenviar o mesmo evento não duplica nada.

**Stripe:**
1. Crie uma chave restrita com **leitura** em Faturas, Assinaturas, Clientes e Cobranças.
2. Em **Configurações → Stripe**, cole a chave e informe o campo do metadata da assinatura que guarda o id do lead (no GN: `user_id`).
3. No Stripe, crie um destino de webhook com o endereço que a tela mostra e os eventos `invoice.paid`, `customer.subscription.created` e `charge.refunded`.
4. Cole o segredo `whsec_…` na tela e clique em **Importar histórico** para trazer os últimos 365 dias.

**CSV:** em **Leads e vendas → Importar CSV**, com as colunas `id_externo`, `tipo`, `data`, `valor`, `lead_id_externo`, `email` e `utm_*`.

### Rastreio

A tela **Rastreio** mostra:
- os **Parâmetros de URL** para colar em cada anúncio;
- todos os anúncios (inclusive os que ainda não gastaram), com o que falta corrigir;
- a verificação das páginas de destino;
- o **teste de ponta a ponta**: um link com os IDs reais do anúncio e um código. A pessoa se cadastra com o código no e-mail (`voce+rastreio-4f9a2c@gmail.com`) e o sistema confere campo a campo o que chegou.

## Regras de atribuição

- A atribuição usa sempre **IDs**, nunca nomes. A ordem é:
  1. `utm_ad_id` do último toque;
  2. sem ele, o `utm_ad_id` do primeiro toque (`ftp_*`);
  3. sem anúncio, fica só a campanha.
  
  A resolução é feita no banco (trigger `resolver_atribuicao_lead`), igual para todas as fontes.
- Uma venda herda o anúncio do lead, ligada pelo `lead_id_externo` ou, na falta dele, pelo hash do e-mail. Se a própria venda trouxer `utm_ad_id`, vale o da venda.
- Leads e vendas são contados no fuso da organização. A mídia, no fuso da conta de anúncios.
- **Cobertura de atribuição** (Leads e vendas) mostra quanto dos leads e da receita chega até o anúncio.

## Segurança e LGPD

- **Isolamento entre clientes** por RLS. O worker e os webhooks usam a service role e sempre filtram por `organizacao_id`. Os testes em `tests/banco/rls.test.ts` cobrem o isolamento.
- **Credenciais** ficam cifradas com AES-256-GCM em `conexoes_segredos`, uma tabela sem nenhuma policy: o navegador nunca as recebe.
- **Meta só leitura:** nenhuma chamada cria, edita ou pausa algo na conta do cliente.
- **Dados pessoais:**
  - e-mail e telefone dos clientes finais viram hash SHA-256 na entrada e nunca são gravados em claro;
  - o nome só é guardado se a fonte enviar;
  - o payload bruto dos eventos fica 90 dias, sem dados pessoais;
  - apagar a organização apaga tudo dela (cascata).

## Fila e agendamento

Toda a fila roda dentro do Supabase, com `pgmq` + `pg_cron` + `pg_net`, sem um serviço extra. Cada job é uma conta de anúncio ou uma conexão, então um cliente não segura os outros.

- **Execução:** a cada minuto, o `pg_cron` chama `/api/jobs/processar` se houver mensagem na fila. O worker processa uma fatia por vez, grava o cursor e reenfileira o restante.
- **Limite de uso da Meta:** o job volta para a fila com atraso, em vez de prender a função esperando.
- **Função interrompida:** se a função morrer no meio, a mensagem reaparece sozinha. Uma execução presa há mais de 15 minutos é destravada.

## Desenvolvimento

```bash
npm run dev        # http://localhost:3000 (usa o projeto Supabase do .env.local)
npm test           # unitários + RLS em Postgres em memória (não precisa de Docker)
npm run typecheck
npm run lint
```

`cacheComponents` fica desligado (veja `next.config.ts`). Todas as telas são autenticadas e por organização, então nada iria para o shell estático.
