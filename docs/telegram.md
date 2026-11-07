# Publicações no Telegram

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

## Publicações semanais (texto)
Além do post diário, duas mensagens de texto por semana (HTML do Telegram, até 4096 caracteres, sem pré-visualização de link). Datas e semanas ISO em UTC.
- **Resumo da semana**: na sexta, quando `conteudo.py` gera a newsletter (`hoje.json["newsletter"]`), o markdown é convertido em texto com link para `conteudo.html`. Aceita execução até 2 dias depois da sexta. Não repete a semana.
- **Como terminaram os sinais**: a partir do sábado (ou domingo, se o sábado não rodou). Lista os posts do canal cujo prazo de 10 pregões já acabou (ativo, setup, data do sinal e resultado, inclusive os prejuízos), o placar (X de Y no lucro, média) e o aviso de que resultado passado não garante futuro. Cada post entra uma vez só (campo `relatado`). Enquanto nenhum post tiver terminado, usa como alternativa os sinais do terminal encerrados na semana (6 melhores e 6 piores, placar de todos e ranking do mês na B3), com o texto deixando claro que são "os sinais do terminal", não "os que postamos".
- O resultado de cada post vem de `data/casos/<ativo>.json` (mesmo ativo, setup e data) ou, se faltar, de `data/resultados.json`. Posts mais recentes que o prazo ficam de fora até terminar.

## Histórico em `telegram.json`
```json
{"ultimo": "2026-11-06",
 "posts": [{"data": "...", "ticker": "...", "rotulo": "...", "setup": "...", "setup_nome": "...", "lado": "compra", "relatado": "2026-W46"}],
 "semanal": {"newsletter": "2026-W45", "resultados": "2026-W45"}}
```
Segue o mesmo carry-over do post diário: lido do site publicado quando `data/` está vazio e regravado a cada execução (guarda os últimos 200 posts). O formato antigo `{"ultimo": "AAAA-MM-DD"}` continua aceito. O histórico só passa a existir a partir dos posts feitos com esta versão.

## Testes
- `python scripts/telegram_postar.py --simular`: mostra legenda e textos semanais sem enviar nem gravar status.
- `--forcar-semanal`: ignora o dia da semana e a semana já publicada (use com `--simular`, ou com cuidado: publica de verdade).
- `telegram-status.json` traz o resultado do post diário (`ok`, `mensagem`) e de cada publicação semanal (`semanal`). Uma falha em qualquer uma não impede as outras nem o build.
