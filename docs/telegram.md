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

## Top do dia (texto, diário)
Logo depois do post diário, uma mensagem de texto "🏆 Top do dia — sinais com melhor histórico" com o top 3 de compra e o top 3 de venda de `data/ranking.json` (gerado por `scripts/ranking.py`, passo `continue-on-error` do workflow antes do Telegram). Cada linha: ativo · setup · X de Y no lucro · média. No fim, aviso de risco e link para `ranking.html`.
- Critério: último pregão fechado de cada mercado (BR, US, Cripto), setups de entrada, mínimo de 10 casos, retorno médio positivo, nota = limite inferior de Wilson (95%) da taxa de acerto, um setup por ativo.
- Não repete a data: `telegram.json` guarda `"ranking": "AAAA-MM-DD"` (a data do ranking publicado). Formatos antigos sem a chave continuam aceitos.
- Bloco com try/except próprio; o resultado vai em `telegram-status.json` na chave `ranking` (`ok`, `mensagem`). Sem ranking qualificado, não posta.

## Post do dia sem contradição com o Top do dia
O post principal e as alternativas (`escolher` em `scripts/conteudo.py`) pulam o ativo que está no top 10 geral do lado **oposto** do Top do dia: não sai "compra" de quem está no top de venda, nem "venda" de quem está no top de compra. A checagem usa `ranking.top_geral`, que reaproveita as regras de `scripts/ranking.py` (mesma nota de Wilson, mínimo de casos e retorno médio positivo), então não depende da ordem dos passos nem de `ranking.json`. Os pulados aparecem no log (`fora do post ... Top do dia do lado oposto`). Se o cálculo falhar, nada é filtrado e o comportamento é o de antes.

## Publicações semanais (texto)
Além do post diário, duas mensagens de texto por semana (HTML do Telegram, até 4096 caracteres, sem pré-visualização de link). Datas e semanas ISO em UTC.
- **Resumo da semana**: na sexta, quando `conteudo.py` gera a newsletter (`hoje.json["newsletter"]`), o markdown é convertido em texto com link para `conteudo.html`. Aceita execução até 2 dias depois da sexta. Não repete a semana.
- **Como terminaram os sinais**: a partir do sábado (ou domingo, se o sábado não rodou). Lista os posts do canal cujo prazo de 10 pregões já acabou (ativo, setup, data do sinal e resultado, inclusive os prejuízos), o placar (X de Y no lucro, média) e o aviso de que resultado passado não garante futuro. Cada post entra uma vez só (campo `relatado`). Enquanto nenhum post tiver terminado, usa como alternativa os sinais do terminal encerrados na semana (6 melhores e 6 piores, placar de todos e ranking do mês na B3), com o texto deixando claro que são "os sinais do terminal", não "os que postamos".
- O resultado de cada post vem de `data/casos/<ativo>.json` (mesmo ativo, setup e data) ou, se faltar, de `data/resultados.json`. Posts mais recentes que o prazo ficam de fora até terminar.

## Histórico em `telegram.json`
```json
{"ultimo": "2026-11-06",
 "posts": [{"data": "...", "ticker": "...", "rotulo": "...", "setup": "...", "setup_nome": "...", "lado": "compra", "relatado": "2026-W46"}],
 "semanal": {"newsletter": "2026-W45", "resultados": "2026-W45"},
 "ranking": "2026-11-06"}
```
Segue o mesmo carry-over do post diário: lido do site publicado quando `data/` está vazio e regravado a cada execução (guarda os últimos 200 posts). O formato antigo `{"ultimo": "AAAA-MM-DD"}` continua aceito. O histórico só passa a existir a partir dos posts feitos com esta versão.

## Testes
- `python scripts/telegram_postar.py --simular`: mostra legenda e textos semanais sem enviar nem gravar status.
- `--forcar-semanal`: ignora o dia da semana e a semana já publicada (use com `--simular`, ou com cuidado: publica de verdade).
- `telegram-status.json` traz o resultado do post diário (`ok`, `mensagem`) e de cada publicação semanal (`semanal`). Uma falha em qualquer uma não impede as outras nem o build.
