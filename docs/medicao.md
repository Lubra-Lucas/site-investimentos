# Medição de uso (GoatCounter)

Medição simples e amigável à privacidade: o [GoatCounter](https://www.goatcounter.com) é gratuito
para uso não comercial, **não usa cookies**, não guarda IP nem identifica pessoas. Vem **desligado**:
enquanto o código do site estiver vazio, nenhum script é carregado e nada é enviado.

## Como ligar

1. Crie a conta em <https://www.goatcounter.com/signup> e escolha o **código do site**
   (ex.: `carteira-terminal`, que vira `carteira-terminal.goatcounter.com`).
2. Abra `assets/js/medicao.js` e preencha a constante do topo:
   `const GOATCOUNTER = "carteira-terminal";`
3. Faça o commit na `main`. No próximo deploy a medição está ativa em todas as páginas.

Para desligar de novo, deixe a constante vazia (`""`).

## O que é medido

- **Páginas vistas** (Início, Oportunidades, Ativo, Backtest, Triagem, Carteira, Diário), com a origem
  do acesso (referrer), país, navegador e tamanho de tela, tudo agregado.
- **Eventos** (cliques), via `medir(evento)` (disponível em `window`):
  - `plano-<nome>`: clique em um plano da landing (`[data-plano]`);
  - `simular-card`: clique em "Simular" num card de oportunidade (`.botao-simular-card`);
  - `hero-cta`: clique no botão principal do topo da landing (`.hero-acoes .botao-primario`).
- Não é medido: conteúdo digitado, carteira, diário, ativos consultados ou qualquer dado do usuário
  (isso tudo fica só no navegador).

## Como ler o painel

Em `https://<codigo>.goatcounter.com`:

- **Pages**: ranking de páginas e gráfico de visitas por dia/hora. Clique numa página para ver de onde veio.
- **Referrers** (dentro de cada página, ou em "Locations/Browsers" no resumo): de onde vêm os visitantes.
- **Eventos**: aparecem na mesma lista, com ícone de evento; compare `hero-cta` e `plano-*`
  com as visitas do Início para ter a taxa de clique.

## Para a política de privacidade

Informe que o site usa o GoatCounter para estatísticas agregadas de acesso, **sem cookies e sem
dados pessoais** (não há banner de consentimento por cookies para isso). O script é carregado de
`gc.zgo.at` e os dados vão para `<codigo>.goatcounter.com`.

## Verificação de dados atrasados (alertas)

Fora a medição: o workflow `Verificar dados publicados` roda duas vezes ao dia e falha se o
`radar.json` estiver velho. O GitHub avisa por e-mail quando um workflow falha, desde que as
notificações estejam ligadas: **GitHub → Settings → Notifications → Actions** e marque
"Send notifications for failed workflows only" (e-mail ou web). Em **Watch** do repositório,
mantenha ao menos "Participating" ou "Custom → Actions". Além do e-mail, o workflow abre a issue
"Dados atrasados" (e a fecha quando tudo volta ao normal). Teste local:
`python scripts/verificar_dados.py --arquivo data/radar.json --agora 2026-11-07T12:00Z`
e `python scripts/verificar_dados.py --testar`.
