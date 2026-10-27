# Diário de trading: contrato

O terminal passa a servir um ciclo só: **encontrar** um bom momento (Oportunidades/Setups) → **simular** o trade
(entrada, stop, alvo) → **acompanhar e analisar** → **arquivar** no diário, que mostra o resultado em R por dia
(calendário), por estratégia e no total. Público: do investidor iniciante, que quer achar boas oportunidades
em diferentes setups, ao trader que quer um registro saudável dos seus trades e estatísticas da sua performance.

## Trade = simulação + diário

Um trade é um registro de `simulacoes-v1` (localStorage, `Simulacoes` em `assets/js/simulador.js`) com campos
opcionais de diário. Registros antigos continuam válidos (sem os campos novos).

```js
{
  // já existentes
  id, ticker, mercado, moeda, lado: "compra"|"venda", entrada, stop, alvo, capital,
  criada: "AAAA-MM-DD",          // data em que o trade foi planejado (candle de referência)
  preco_criacao,
  // diário (novos, todos opcionais)
  setup: "pb-mme9",              // id do catálogo (config/setups.json), se veio de um setup
  tf: "D"|"W",                   // tempo do sinal
  estrategia: "Pullback MME 9",  // nome livre da estratégia do usuário (padrão: nome do setup; senão "Sem estratégia")
  origem: "setups"|"ativo"|"triagem"|"plano"|"manual",
  tese: "por que entrei",        // antes do trade
  revisao: "o que aprendi",      // depois do trade
  nota: 1..5,                    // nota da execução (disciplina), opcional
  etiquetas: ["FOMO", "seguiu o plano"],
  saida_manual: { data: "AAAA-MM-DD", preco: 12.3 },  // encerrou antes do alvo/stop
  arquivado: true,               // tirado da lista de abertos sem apagar
  fotos: ["<id>", ...],          // ids de imagens no IndexedDB (ver abaixo)
}
```

## Resultado

- `avaliarSimulacao(pos, diarios)` (simulador.js) continua sendo a regra: entrada a mercado ou por ordem,
  stop/alvo nos candles diários, stop primeiro se os dois cabem no mesmo candle. **`saida_manual`, se existir,
  vale antes**: o trade fecha naquela data e preço (se já tinha entrado).
- R = resultado % / risco % (risco = distância entrada→stop). Stop = −1R.
- Estados: `aguardando` (ordem não executada), `aberta`, `alvo`, `stop`, `manual` (saída manual).
- **Data do resultado (calendário)** = data de saída (`saiu`); trades abertos aparecem no dia da entrada como
  "em aberto" e não somam R ao dia.

## Fotos

IndexedDB `diario` (versão 1), store `fotos` (key = id string, valor = `{ id, trade, tipo: "entrada"|"saida"|"outra",
blob, criada }`). Captura do gráfico: `grafico.chart.takeScreenshot()` (Lightweight Charts) → canvas → JPEG ~0,85.

## API (assets/js/diario-dados.js, global `Diario`)

- `Diario.trades()` → todos os trades (registros de `Simulacoes`).
- `Diario.avaliar(trade)` → `Promise<{estado, entrou, saiu, resultado_pct, resultado_r, ...}>` (carrega os candles).
- `Diario.registrar(ctx, { grafico } = {})` → cria um trade a partir de um contexto
  `{ ticker, lado, setup?, tf?, data?, preco?, entrada?, stop?, alvo?, origem }` (níveis sugeridos quando
  faltarem: entrada no rompimento da máxima/mínima do último candle, stop pela MMS 20 ou 1,5 ATR, alvo 2R) e,
  com `grafico`, já tira a foto da entrada. Abre o editor do trade. Devolve o trade.
- `Diario.abrir(id)` → abre o editor/detalhe do trade (modal, em qualquer página).
- `Diario.salvarFoto(tradeId, blob, tipo)`, `Diario.fotos(tradeId)` → `Promise<[{id, url, tipo}]>`.
- `Diario.estatisticas(trades, filtro)` → por estratégia/setup: trades, acertos, % acerto, R total, R médio,
  expectativa, fator de lucro, maior sequência de perdas, drawdown máximo em R, tempo médio.
- Evento `document` `"diario"` a cada mudança (além do `"simulacoes"` que já existe).

## Páginas

- **Início** (`index.html`): para quem chega: o que é o terminal e os 3 passos; oportunidades de hoje; trades
  abertos; R do mês. A antiga Carteira vai para `carteira.html` (no menu "Mais").
- **Oportunidades** (`setups.html`): a grade de setups (sem mudança de regra), com "Simular trade" em cada card.
- **Diário** (`diario.html`): calendário de R por dia (clicar no dia abre os trades dele com foto, setup, entrada,
  saída, R, tese e revisão), lista de trades com filtros, estatísticas por estratégia e curva de R.
- **Ativo** (`ativo.html#TK`): gráfico + "Simular trade" + trades daquele ativo.
- **Mais**: Triagem, Backtest, Carteira (pouco usados; continuam funcionando).

## Notas da implementação (desvios e extras do contrato)

- `Diario.avaliar(trade)` devolve também `fechado`, `dias` (entrada a saída) e `ultima` `{data, preco}` (último candle); sem candles
  devolve `{estado: "sem_dados"}`. `avaliarSimulacao` (simulador.js) já honra `saida_manual` (estado `manual`).
- `Diario.avaliarTodos(lista?)` devolve `[{...trade, av}]`. **`Diario.estatisticas(avaliados, filtro)` recebe esses trades avaliados**
  (não os crus) e filtra `{por: "estrategia"|"setup", estrategia, setup, mercado, lado, desde, ate}` (datas = saída). Devolve
  `{total, grupos: [{chave, rotulo, trades, acertos, pct_acerto, r_total, r_medio, fator_lucro, maior_seq_perdas, drawdown_r, duracao_media, curva}], curva}`.
- `Diario.registrar(ctx, { grafico, abrirEditor = true })`; níveis sugeridos vêm de `Plano.sugerir` (exposto em plano.js); sem plano.js
  cai em stop 5% e alvo 10%. A foto da entrada desenha entrada/stop/alvo só durante a captura.
- `Diario.abrir(id, { grafico })`: com `grafico`, o editor oferece "Capturar gráfico". Extras: `fotografar`, `removerFoto`,
  `atualizar(id, patch)`, `excluir(id)` (com desfazer), `preencher(trade, ctx)`, `fechar()`.
- IndexedDB `diario` v1, store `fotos` com índice `trade`. Sem IndexedDB, as fotos ficam na memória da sessão e aparece um aviso.
- `diario-dados.js` é autossuficiente: usa `prenderFoco`, `avisoRapido` e o catálogo de setups quando existem e tem versões próprias
  se não. Exige `comum.js` e `simulador.js`.
- Simulador: `simulador.contexto` (objeto ou `(rascunho) => objeto`) com `{setup, tf, origem}`; a boleta ganhou "Encerrar agora",
  "Editar no diário", exclusão com desfazer e textos de ajuda sobre R.
- Backup JSON: `{formato: "diario-trading", versao: 1, trades, fotos: [{id, trade, tipo, criada, dataUrl}]}` (aceita também a lista simples antiga).
- Data do resultado no calendário = `saiu`; trades arquivados continuam no calendário e nas estatísticas, só saem da lista padrão.
