# Versão simples (app.html)

A porta de entrada para quem não conhece o terminal, feita primeiro para o celular. Responde uma pergunta só: **o que deu sinal hoje e quantas vezes isso deu certo antes?**

## Como é
- Um baralho com as **20 melhores oportunidades do dia**, de compra ou de venda (botão no topo), filtráveis por mercado (Todos, Brasil, EUA, Cripto). No fim do baralho dá para ver o resto ("Ver mais N, com histórico menor").
- Cada carta: ativo, preço, minigráfico dos últimos 70 pregões, o número grande **"X de Y vezes deu certo"** (com uma bolinha por caso), a média em 10 pregões, a explicação do sinal em português simples e, em "Também deu sinal hoje", os outros setups do ativo com o próprio placar.
- Arrastar para a direita (ou ♥) salva; para a esquerda (ou ✕) pula; ↶ volta; ↗ abre o gráfico completo. Teclado: setas, Backspace.
- Salvos (♥ no topo): a lista com quanto o preço andou desde que salvou (na venda, a favor = queda). Salvar também põe o ativo na Minha lista do terminal.
- Primeira visita: 3 telas curtas de boas-vindas.

## Regras (as mesmas do terminal)
- Sinais de entrada (sem o grupo Tendência e sem os neutros) do gráfico diário, no último pregão fechado de cada mercado, só de ativos líquidos de BR, EUA e Cripto.
- Histórico = backtest do mesmo setup no mesmo ativo: entrada na abertura seguinte, saída 10 pregões depois, sem custos.
- Entra no baralho quem tem pelo menos 10 casos e média positiva; ordem pela nota de Wilson (95%), desempate pela média. É a regra do Top do dia, então o topo do baralho coincide com o Top do dia.
- Os nomes leigos dos setups ficam em `SIMPLES`, no início de `assets/js/app.js`. Setup novo sem entrada ali aparece com o nome técnico.

## Arquivos
`app.html`, `assets/js/app.js`, `assets/css/app.css`. Não depende do `comum.js`: a página é leve e baixa só `radar.json`, `setups.json` e os candles das cartas da vez.

Armazenamento local: `app-v1` (decisões do dia e salvos), `app-v1-prefs` (lado e mercado), `app-intro-v1` (boas-vindas vistas) e `multitela` (Minha lista, compartilhada com o terminal).

## Onde aparece
- Landing: botão "Ver as oportunidades de hoje" e a barra fixa do rodapé.
- Terminal: menu Mais → "Versão simples".
- Páginas por ativo: botão "Ver as oportunidades de hoje".
- App instalado no celular: abre direto aqui (`start_url` do manifest).
