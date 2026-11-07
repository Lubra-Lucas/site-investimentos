# Post diário no Telegram

A cada atualização de dados, `scripts/conteudo.py` gera o post do dia e `scripts/telegram_postar.py` envia a imagem e a legenda para o canal.

## Como ligar
1. No canal do Telegram: Administradores → Adicionar administrador → o bot, com "Publicar mensagens".
2. No GitHub: Settings → Secrets and variables → Actions → New repository secret:
   - `TELEGRAM_BOT_TOKEN`: token do BotFather.
   - `TELEGRAM_CHAT_ID`: `@nome_do_canal` (canal público) ou o ID numérico (canal privado, começa com `-100`).

Também funciona um segredo único `TELEGRAM` com as duas linhas `TELEGRAM_BOT_TOKEN=...` e `TELEGRAM_CHAT_ID=...`. Sem eles, o passo não faz nada; o resultado de cada tentativa fica em `data/conteudo/telegram-status.json`.

## Como funciona
- Roda no workflow `atualizar.yml`, depois de gerar o conteúdo, com `continue-on-error` (uma falha no Telegram não derruba o site).
- Não posta a mesma data duas vezes: a última data publicada fica em `data/conteudo/telegram.json`, que vai para o site e é lida de volta na execução seguinte.
- Testar sem enviar: `python scripts/telegram_postar.py --simular`.
- Se falhar, o log do passo mostra a resposta do Telegram (ex.: "chat not found" = ID errado; "not enough rights" = bot não é admin).
