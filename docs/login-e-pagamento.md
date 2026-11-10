# Plano técnico: login e pagamento

Documento de planejamento. Nada disso está implementado. O fundador cria as contas (Supabase e checkout); o código vem depois, seguindo as etapas abaixo. Valores de preço e taxa são aproximados e variam: onde estiver "conferir", confirme no site do fornecedor antes de decidir.

## 1. O ponto crítico: o site é público

Hoje o site é estático no GitHub Pages e **todos os arquivos de `data/*.json` são públicos** (qualquer pessoa abre `https://lubra-lucas.github.io/site-investimentos/data/radar.json`). O repositório também é público, então o histórico do Git expõe os mesmos dados.

Consequência: **um login feito só no front-end (JS) não protege nada.** Quem quiser pula a tela de login e baixa os JSON direto. Proteger de verdade exige que o dado premium **saia do GitHub Pages** e só seja entregue a quem tem assinatura ativa, por um servidor que confere a sessão.

Além disso, se o repositório continuar público, o código do pipeline (`scripts/*.py`, `config/setups.json`) fica à vista: a "receita" não é segredo, o valor está nos dados diários e na interface. Isso é aceitável, mas deve ser uma decisão consciente.

### Opção A: mover tudo o que é premium para o Supabase

- **A1. Storage com URLs assinadas.** O workflow continua gerando os JSON, mas em vez de publicá-los no Pages, envia para um bucket **privado** do Supabase Storage (chave `service_role` como segredo do GitHub). O front pede ao Supabase uma URL assinada (válida por minutos) e só recebe se a política de acesso confirmar a assinatura ativa. Mudança pequena no front (trocar `fetch("data/x.json")` por uma função que obtém a URL assinada), mas os arquivos grandes (`radar.json` ~1,25 MB, `ativos/*.json`, `casos/*.json`) passam a consumir a banda e as requisições do Supabase.
- **A2. Tabelas com RLS.** Importar os dados para tabelas Postgres e consultar via API. Mais flexível (filtrar no servidor, paginar), mas é uma reescrita grande: todo o front lê JSON inteiro e filtra no navegador. Não recomendado agora.

### Opção B: vitrine pública, resto protegido

Continua público o que serve de **vitrine e captação**: landing, Top do dia (`ranking.json`), Histórico dos sinais (`resultados.json`), guia, termos, privacidade, e o post do dia (`data/conteudo/`). Protege-se o resto (radar completo, `ativos/*.json`, `casos/*.json`, `rastreador.json`, backtest, carteira, ativo, triagem, multitela).

### Recomendação: B, implementada com A1

1. O que é vitrine continua no Pages: zero custo, zero atrito, ajuda o SEO e a prova social (o Top do dia e o Histórico são os melhores argumentos de venda, inclusive os prejuízos).
2. O que é premium vai para um **bucket privado do Supabase** com URLs assinadas, liberadas só a quem tem linha ativa em `assinaturas`.
3. O Inicial (plano de entrada) pode receber um recorte menor dos mesmos arquivos (ver seção 4), então o pipeline passa a gerar dois conjuntos: `publico/` (Pages) e `premium/` (Storage), com um subconjunto `inicial/` se necessário.

**Arquivos e páginas que mudam (estimativa):**

| O que | Mudança |
|---|---|
| `.github/workflows/atualizar.yml` | Passo novo: enviar `data/premium/**` para o Supabase Storage (com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como segredos); o passo "Montar site" deixa de copiar o que é premium para `_site/`. |
| `scripts/atualizar_dados.py`, `scripts/ranking.py`, `scripts/resultados.py` | Gravar em duas pastas (público x premium) ou um passo final que separe. |
| `assets/js/comum.js` (`buscarJSON`, `carregarRadar`, `carregarRastreador`) | Ponto único de leitura: se o caminho for premium, obter URL assinada e anexar a sessão; tratar 401/403 mandando para login ou planos. |
| `assets/js/setups.js`, `ativo.js`, `backtest.js`, `carteira.js`, `triagem.js`, `casos.js`, `landing.js` | Só ajustes pontuais onde leem caminhos diretos (`data/ativos/...`, `data/casos/...`). A landing usa hoje `radar.json` completo para a faixa ao vivo e a prova de sinais: passar a usar um `data/publico/amostra.json` pequeno. |
| Páginas novas | `entrar.html` (login), `conta.html` (assinatura, sair), e um estado "assine para ver" nas páginas premium. |
| `termos.html`, `privacidade.html` | Atualizar com dados de cadastro, pagamento, cancelamento e reembolso (seção 8). |
| `assets/js/tour.js` | Sem mudança, mas o tour só roda com sessão ativa. |

Limite honesto: assinante pode **copiar** os dados que vê (print, salvar o JSON). Não existe proteção total para conteúdo exibido no navegador; o objetivo é impedir o acesso gratuito e em massa, não o vazamento por quem paga. Mitigações leves: URL assinada curta, limite de requisições por usuário, termos de uso que proíbem redistribuição.

## 2. Arquitetura recomendada

Site continua estático (GitHub Pages). O back-end é o Supabase.

```
Navegador (Pages) ──login──▶ Supabase Auth (link mágico por e-mail, Google)
        │                          │
        │  JWT da sessão           ▼
        ├──consulta──▶ tabela assinaturas (RLS: cada um lê só a sua linha)
        └──URL assinada──▶ Storage privado (policy: exige assinatura ativa)

Checkout (Mercado Pago/Asaas/Stripe/Kiwify)
        │ webhook de pagamento
        ▼
Edge Function "webhook-pagamento" (valida assinatura do webhook, usa service_role)
        │ grava
        ▼
tabela assinaturas
```

### 2.1 Supabase Auth

- Provedores: **e-mail com link mágico (OTP)**, sem senha, e **Google**. Sem senha reduz suporte ("esqueci a senha") e risco de vazamento.
- SDK `@supabase/supabase-js` carregado por CDN com versão fixa (o site não tem etapa de build). A sessão fica no `localStorage`; o JWT vai nas chamadas.
- URLs de redirecionamento permitidas: `https://lubra-lucas.github.io/site-investimentos/` e `http://localhost:*` para teste.

### 2.2 Tabela `assinaturas` com RLS

```sql
create table public.assinaturas (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  plano          text not null check (plano in ('inicial','pro')),
  status         text not null check (status in ('ativa','atrasada','cancelada','teste')),
  provedor       text not null,            -- 'mercadopago' | 'asaas' | 'stripe' | 'kiwify'
  id_externo     text,                     -- id da assinatura no provedor
  valido_ate     timestamptz,              -- fim do período já pago
  atualizado_em  timestamptz not null default now()
);

alter table public.assinaturas enable row level security;

-- cada usuário só LÊ a própria linha; ninguém escreve pelo front
create policy "le_propria" on public.assinaturas
  for select using (auth.uid() = user_id);
-- sem policy de insert/update/delete: só a service_role (Edge Function) escreve
```

Função auxiliar `tem_plano(minimo text)` (SECURITY DEFINER) usada nas policies do Storage: retorna verdadeiro se existe linha do usuário com `status in ('ativa','teste')` e `valido_ate > now()`, e o plano atende ao mínimo (`pro` vale para tudo, `inicial` só para o recorte inicial).

Uma tabela `eventos_pagamento` (id do evento do provedor, payload, recebido_em) serve de **idempotência** (webhook repetido não duplica) e de trilha de auditoria.

### 2.3 Edge Function do webhook

- Endpoint público `https://<projeto>.supabase.co/functions/v1/webhook-pagamento`, cadastrado no provedor de checkout.
- Passos: (1) validar a assinatura/segredo do webhook; (2) ignorar evento já visto (`eventos_pagamento`); (3) achar o usuário pelo e-mail do comprador (ou criar o convite se ainda não tem conta); (4) fazer `upsert` em `assinaturas` com plano, status e `valido_ate`; (5) responder 200 rápido.
- Eventos tratados: pagamento aprovado/renovado → `ativa`; pagamento falhou → `atrasada` (carência de alguns dias); cancelada/estornada → `cancelada`.
- Usa a `service_role` (variável de ambiente da própria função, nunca no front).
- O casamento por e-mail exige que o cliente use o **mesmo e-mail** no checkout e no login. Para reduzir erro, o link de checkout pode receber o e-mail por parâmetro e, na tela de conta, aparece "ative com o e-mail da compra".

### 2.4 Storage privado

- Bucket `premium` (privado). Policy de leitura em `storage.objects` chamando `tem_plano(...)` conforme a pasta (`pro/` e `inicial/`).
- Front: `supabase.storage.from('premium').createSignedUrl(caminho, 300)` e `fetch` na URL. Cache em memória da URL durante a sessão.
- Upload só pelo workflow (service_role).

## 3. Comparação de checkout para o Brasil

Taxas são ordens de grandeza para orientar a conversa. **Confira sempre no site de cada um**: mudam por volume, prazo de recebimento e negociação.

| | Mercado Pago Assinaturas | Asaas | Stripe | Hotmart / Kiwify |
|---|---|---|---|---|
| **Pix** | Pix avulso sim; recorrência no Pix automático depende da liberação (conferir no site) | Sim, boleto/Pix recorrente com cobrança gerada a cada ciclo; taxa fixa baixa por cobrança (conferir no site) | Pix suportado no Brasil; recorrência automática limitada (conferir no site) | Sim, via a própria plataforma |
| **Cartão recorrente** | Sim, cobrança automática mensal | Sim | Sim, é o ponto forte (Billing) | Sim |
| **Taxa aproximada** | Alta no cartão, na faixa de 4 a 5% + valor fixo; Pix mais barato (conferir no site) | Cartão na faixa de 2 a 3% + fixo; Pix e boleto com valor fixo por cobrança (conferir no site) | Cartão nacional na faixa de 3 a 4% + fixo (conferir no site) | Mais cara: na faixa de 8 a 10% + fixo por venda, já com a parte de afiliados e área de membros (conferir no site) |
| **Nota fiscal** | Não emite; precisa de emissor próprio | Tem emissão de NFS-e integrada (conferir no site) | Não emite no Brasil; emissor próprio | Em geral não emite pelo produtor; o produtor emite (conferir no site) |
| **Webhook / API** | Boa, documentação em português | Boa, documentação em português, sandbox | Excelente, a melhor | Webhook simples, menos flexível |
| **Facilidade** | Média: aprovação de conta e limites podem travar | Alta para empresa brasileira, suporte em português | Alta no desenvolvimento, exige CNPJ/conta; aprovação de produto financeiro pode ser cuidadosa | Muito alta: página de venda pronta, sem código |
| **Atenção** | Retenção de saldo e análises de risco são reclamações comuns | Boa opção para quem quer Pix/boleto e NF | Pix recorrente imaturo | Exige produto compatível com a política; conteúdo sobre investimentos pode ter restrições (conferir) |

### Recomendação

- **Primeiro lançamento, rápido e barato de integrar: Asaas.** Cobre Pix, boleto e cartão recorrente, tem NFS-e e API em português. Boa relação entre taxa e controle.
- **Alternativa se o foco for cartão e API limpa: Stripe**, caso o fundador tenha CNPJ e aceite Pix como pagamento avulso complementar.
- **Hotmart/Kiwify só se a prioridade for vender sem programar nada** (e aceitar pagar bem mais por venda). Dão menos controle sobre o webhook e a base de clientes.
- **Mercado Pago** é aceitável se o público já usa a carteira, mas costuma ser a mais cara no cartão.

Independentemente do provedor, a integração tem o mesmo formato (webhook → Edge Function → `assinaturas`), então trocar depois custa pouco se o campo `provedor` já existir.

## 4. Divisão Inicial × Pro (proposta)

Baseada nas páginas que existem hoje. A lógica: o **Inicial** responde "o que fazer hoje" e o **Pro** dá as ferramentas para decidir e acompanhar.

| Área | Público (grátis) | Inicial | Pro |
|---|---|---|---|
| Landing, guia, termos, privacidade | ✔ | ✔ | ✔ |
| Top do dia (`ranking.html`), top 3 na landing | ✔ | ✔ | ✔ |
| Histórico dos sinais (`resultados.html`) | ✔ | ✔ | ✔ |
| Post do dia e canal no Telegram | ✔ | ✔ | ✔ |
| Oportunidades (`setups.html`), modo Simples, Brasil | amostra | ✔ | ✔ |
| Oportunidades, todos os mercados (EUA, cripto, macro) e modo Trader | | | ✔ |
| Gráfico do ativo (`ativo.html`) com sinais e casos do setup | | ✔ | ✔ |
| Backtest caso a caso (`backtest.html`) | | | ✔ |
| Regras personalizadas e "Minhas buscas" | | | ✔ |
| Diário de trades (`diario.html`) | | ✔ (local) | ✔ |
| Carteira (`carteira.html`) e plano de trade | | | ✔ |
| Triagem e Multitela | | | ✔ |
| Download de resultados (CSV) | | | ✔ |

Observações:
- O Diário e a Carteira guardam dados no navegador do usuário (não nos arquivos do site), então o que protege o plano aqui é a regra comercial, não o dado. O bloqueio real por plano vale para o que vem dos arquivos do servidor (radar, ativos, casos, rastreador).
- Os números do Top do dia e do Histórico ficam públicos de propósito: são a vitrine e a prova de que o terminal mostra também os prejuízos.
- Rever os limites depois de 30 dias de uso real (quais páginas mais convertem).

## 5. Passo a passo para o fundador

1. **Supabase**
   1. Criar conta em supabase.com e um projeto novo (região mais próxima: América do Sul/São Paulo). Guardar a senha do banco em um gerenciador de senhas.
   2. Authentication → Providers: ligar **Email** (link mágico) e **Google**. Para o Google: criar credencial OAuth no Google Cloud Console (tipo "aplicação web") e colar o Client ID e o Client Secret; copiar a URL de callback do Supabase para dentro do Google.
   3. Authentication → URL Configuration: Site URL = `https://lubra-lucas.github.io/site-investimentos/`; adicionar a mesma URL e `http://localhost:8000/` (teste) nas Redirect URLs.
   4. Authentication → SMTP: configurar um remetente próprio (ex.: Resend, Brevo) para o link mágico não cair em spam; o SMTP padrão do Supabase tem limite baixo de e-mails por hora (conferir).
   5. Storage: criar o bucket `premium` **privado**.
2. **Chaves** (Project Settings → API)
   - `Project URL` e `anon` / publishable key: **públicas por desenho**, vão no front (por exemplo em `assets/js/config.js`). A segurança vem do RLS, não do sigilo dessa chave.
   - `service_role`: **nunca** no código, no front nem no repositório. Vai apenas como **segredo do GitHub** (Settings → Secrets and variables → Actions → `SUPABASE_SERVICE_ROLE_KEY`, para o workflow enviar os arquivos) e como **segredo da Edge Function** (`supabase secrets set`). Ela ignora o RLS: quem a obtém lê e escreve tudo.
   - Segredos do GitHub a criar: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Checkout** (exemplo: Asaas)
   1. Criar a conta, enviar os documentos (CNPJ ou MEI recomendado) e esperar a aprovação.
   2. Criar os dois planos recorrentes (Inicial e Pro), mensal e, se quiser, anual com desconto.
   3. Gerar a chave de API de **sandbox** primeiro e testar tudo; só depois a de produção.
   4. Definir o link de pagamento de cada plano e colocá-lo em `PAGAMENTO` no `assets/js/landing.js` (hoje vazio).
4. **Webhook**
   1. Implantar a Edge Function (`supabase functions deploy webhook-pagamento`).
   2. No painel do checkout, cadastrar a URL da função e o token/segredo do webhook; guardar o token como segredo da função (`WEBHOOK_TOKEN`).
   3. Selecionar os eventos: pagamento confirmado, pagamento vencido, assinatura cancelada, estorno.
   4. Fazer uma compra de teste (sandbox) e conferir a linha em `assinaturas`.
5. **Testar o fluxo inteiro**: comprar → receber o e-mail → entrar com o link mágico → ver os dados premium → cancelar → perder o acesso ao fim do período. Testar também com um e-mail sem assinatura (deve ver só a vitrine).

## 6. Estimativa de esforço (desenvolvimento, uma pessoa)

| Etapa | Esforço |
|---|---|
| 1. Supabase: projeto, Auth, tabela `assinaturas`, RLS, funções SQL | 0,5 a 1 dia |
| 2. Login no front: `entrar.html`, `conta.html`, sessão, estado "assine para ver" | 1 a 2 dias |
| 3. Separar `data/` em público x premium no pipeline e no workflow, subir ao Storage | 1 a 2 dias |
| 4. Ajustar `comum.js` e as páginas para URLs assinadas e erros 401/403 | 1 a 2 dias |
| 5. Edge Function do webhook + idempotência + testes em sandbox | 1 a 2 dias |
| 6. Páginas de planos/checkout, cancelamento, e-mails transacionais | 1 dia |
| 7. Termos, privacidade, aviso de risco, testes ponta a ponta, Playwright | 1 dia |
| **Total** | **cerca de 6 a 11 dias** |

Para lançar antes: fazer só 1, 2, 5 e 6 com os dados ainda públicos e um selo "acesso antecipado" é **enganoso** (parece protegido e não é). Se for o caso, comunicar com clareza ou esperar a etapa 3.

## 7. Custos mensais (conferir tudo antes de contratar)

| Item | Custo aproximado |
|---|---|
| Supabase, plano grátis | R$ 0. Limites típicos (conferir): ~50 mil usuários ativos por mês, ~500 MB de banco, ~1 GB de Storage, ~5 GB de banda por mês. O projeto grátis **pausa após uma semana sem uso**. |
| Supabase Pro | cerca de US$ 25 por mês, se passar dos limites (banda dos JSON premium é o que mais pesa) |
| GitHub Pages e Actions | R$ 0 no repositório público |
| E-mail transacional (Resend, Brevo) | grátis até alguns milhares de e-mails por mês (conferir) |
| Domínio próprio (opcional) | cerca de R$ 40 por ano |
| Checkout | só a taxa por venda (seção 3); Hotmart/Kiwify é a mais cara |
| Emissor de nota fiscal, se o checkout não emitir | R$ 0 a algumas dezenas de reais por mês (conferir) |

Conta de banda: se o premium somar cerca de 5 MB por sessão de uso, o limite grátis de 5 GB cobre em torno de 1.000 sessões por mês. Passou disso, o plano Pro do Supabase entra. Cache agressivo no navegador e arquivos menores (como já se fez com o `radar.json` colunar) adiam essa troca.

## 8. Riscos de LGPD e de segurança

**LGPD (dados pessoais: e-mail, nome do Google, dados de pagamento, IP)**
- **Base legal e finalidade**: execução de contrato (acesso pago) e legítimo interesse (segurança). Dizer na política de privacidade exatamente o que se coleta, para quê e por quanto tempo.
- **Dados de cartão não passam pelo site nem pelo Supabase**: ficam só no checkout (PCI). O banco guarda apenas e-mail, plano e status.
- **Operadores e transferência internacional**: Supabase (servidores fora do Brasil, a menos que se escolha a região de São Paulo; conferir), Google (login), checkout e e-mail transacional. Listar na política.
- **Direitos do titular**: ter um canal (e-mail) para acesso, correção e exclusão de conta; `on delete cascade` em `assinaturas` ajuda. Guardar dados fiscais pelo prazo legal mesmo após a exclusão.
- **Encarregado (DPO)** e contato visíveis na política; registrar incidentes e saber avisar a ANPD e os usuários se houver vazamento.
- **Medição** (`assets/js/medicao.js`): rever o que ela envia e se precisa de aviso de cookies/consentimento quando houver conta.
- **Conteúdo de investimentos**: manter o aviso de que não é recomendação (CVM), sem prometer resultado; revisar a comunicação do plano pago com um advogado antes de lançar.

**Segurança**
- **`service_role` vazada** é o pior cenário (acesso total). Só em segredos; ativar o varredor de segredos do GitHub; rodar um rodízio de chaves se houver suspeita. Nunca em `config.js`.
- **RLS esquecido**: toda tabela nova com `enable row level security` e testes de acesso com um usuário sem plano (deve falhar). Revisar com o "Security Advisor" do Supabase.
- **Webhook falso**: sem validar o segredo, qualquer um liberaria plano para si. Validar token/assinatura, checar o valor e o id do evento, ser idempotente.
- **Compartilhamento de conta**: um login para várias pessoas. Mitigar com limite de sessões simultâneas e URLs assinadas curtas; não vale bloquear de forma agressiva no início.
- **Repositório público**: nunca commitar chaves; `data/` premium não pode ficar no Git (nem no histórico antigo, que continua público: o que já foi publicado não se desfaz).
- **Fraude e estorno** (chargeback): definir a política de reembolso (CDC dá 7 dias no pagamento à distância) e revogar o acesso no estorno.
- **Disponibilidade**: o site passa a depender do Supabase; se ele cair, o premium cai. Mostrar mensagem clara e manter a vitrine funcionando.
- **XSS**: o site monta DOM com `el(...)` e `textContent`; manter esse padrão ao exibir qualquer texto vindo do banco.
