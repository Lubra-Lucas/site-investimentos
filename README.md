# Carteira Terminal

Painel pessoal com três telas:

- **Carteira** (`index.html`): patrimônio em BRL, posições, evolução da carteira e sinais nos ativos acompanhados.
- **Radar** (`radar.html`): ~450 ativos. São todas as ações da B3 com volume médio acima de R$ 10 mi/dia,
  ~260 dos EUA e 31 criptos. O menu superior escolhe o mercado e a visão, e a lista à direita do gráfico mostra o resultado:
  - **Oportunidades:** abas **Compra** e **Venda**, separadas por estratégia, com o bloco **Prioridade** para quem
    dispara 2 ou mais estratégias. A **camada** define o tempo gráfico dos sinais (diário ou semanal).
  - **Filtros de estado:** tendência forte de alta e de baixa, IFR extremo e Bollinger comprimida. A Bollinger
    escolhe o tempo (60m, 4h, diário, semanal), e o gráfico acompanha.

  Clicou, o gráfico abre ao lado, com setas nos candles em que cada sinal apareceu (passe o mouse sobre o candle
  para ver o balão com o motivo); <kbd>↑</kbd> <kbd>↓</kbd> navegam pela lista. O botão ⛶ coloca o gráfico em tela cheia.
- **Multitela** (`multitela.html`): rastreador de ativos em grade de gráficos interativos (2×2, 3×3 ou 4×3).
  - **⌕ Rastrear condição:** escolha um modelo pronto (tendência de alta/baixa, alta forte com médias alinhadas,
    pullback na MME 9/MMS 20/MMS 50, fora da Bollinger, IFR e estocástico extremos, IFR 2, longe da média,
    compressão, rompimento de máxima/mínima, perto da máxima de 52 semanas, cruzamentos de médias...) ou monte
    as suas regras (todas precisam ser atendidas): fechamento x média, média x média, inclinação, pullback,
    cruzamentos, distância da média (em % ou × o normal do ativo), IFR 2/9/14, estocástico, Bollinger,
    compressão, ATR, variação no período, rompimento, máxima/mínima de 52 semanas, candle e volume. Médias
    simples (MMS) ou exponenciais (MME) de 5 a 200 períodos. As regras valem no **diário ou no semanal**, com
    os indicadores daquele tempo gráfico. Regras editadas podem ser salvas em "Minhas regras" (neste navegador).
  - Cada card mostra os valores que fizeram o ativo passar e um **contexto para decidir**: ✓ o que está a favor
    (tendência no outro tempo gráfico e há quanto tempo, perto da máxima de 52 semanas, volume, sinais das
    estratégias), ⚠ o que pede cuidado (IFR/estocástico esticados no diário, semanal ou mensal, longe da média,
    fora da Bollinger, contra o tempo maior, gap, volume fraco) e · informações (variação no mês/ano/12 meses,
    onde ficaria um stop técnico nas médias, ATR). As médias usadas nas regras aparecem no gráfico.
  - Também mostra as oportunidades de compra ou venda das estratégias e os seus ativos (carteira, simulações,
    lista própria). Cada gráfico pode ser arrastado, ter zoom pela roda do mouse e ser aberto em tela cheia.

Gráficos com TradingView Lightweight Charts: candles, MM20/50/200, Bollinger (20, 2) e IFR 14, nos tempos
**60 min, 4 horas**, diário, semanal e mensal. **Alt+C** centraliza o gráfico no preço.

## Como funciona

```
GitHub Actions (todo dia 19:30 BRT)
   └─ scripts/atualizar_dados.py
        ├─ fontes.py       baixa candles diários (6 anos) e de 60 min (6 meses) do Yahoo Finance
        ├─ validacao.py    verifica a integridade e confere os fechamentos com outra fonte
        ├─ rastreador.py   indicadores do diário e do semanal para o rastreador da Multitela
        ├─ estrategias.py  calcula indicadores e sinais datados (diário e semanal)
        └─ grava data/radar.json, data/resumo.json, data/ativos/<ticker>.json e data/intraday/<ticker>.json
   └─ publica o site estático no GitHub Pages
```

## Backtest das estratégias

A página **Backtest** (`backtest.html`) mostra, para cada mercado, sinal (diário/semanal), lado e prazo, como
cada estratégia se saiu nos últimos 6 anos, ativo por ativo (`scripts/backtest.py`):

- **Entrada na abertura do candle seguinte** ao sinal (o site publica depois do fechamento) e **saída no
  fechamento** depois de 5, 10 ou 20 pregões (sinal diário) ou 4, 8 ou 13 semanas (sinal semanal). Na venda,
  o resultado é invertido.
- Sinais repetidos da mesma estratégia dentro do prazo contam **uma vez só**.
- **Vantagem** = retorno médio do sinal menos o retorno médio de entrar num dia qualquer (mesmo mercado e prazo),
  porque em mercado de alta quase toda compra dá lucro.
- Estratégias e ativos com menos de 5 casos aparecem como "poucos casos".
- No Radar, cada sinal traz o selo do histórico **naquele ativo** (acerto, retorno médio e casos, no prazo de 10
  pregões ou 8 semanas), e a lista pode ser ordenada por **melhor histórico**.

Sem custos, impostos ou deslizamento; resultado passado não garante resultado futuro. "Maiores quedas/altas"
não tem backtest, porque depende da comparação entre ativos a cada dia.

## Personalizar o gráfico

O botão **⚙ Personalizar** (no Radar, na Carteira e na Multitela) ajusta todos os gráficos do site:

- **Predefinições:** *Escuro* (padrão), *Claro limpo* (fundo branco, sem grade e sem indicadores) e *Claro com grade*.
- **Fundo e grade:** cor de fundo e linhas verticais e horizontais ligadas ou desligadas.
- **Candles:** cores de alta e de baixa.
- **Indicadores:** MM20, MM50, MM200, Bollinger, IFR (o painel some quando desligado) e as setas dos sinais.

Os indicadores também têm atalhos de liga/desliga na barra acima de cada gráfico. A escolha fica salva no navegador.

## Ferramentas de desenho

Na barra do canto esquerdo do gráfico (Radar e Carteira):

- **Linha horizontal**, **segmento de reta**, **retângulo** (com preenchimento e opacidade ajustável) e **pincel**.
- Com o cursor, clique num desenho para selecionar, arraste para mover ou arraste as alças das pontas.
  <kbd>Delete</kbd> apaga o selecionado e <kbd>Esc</kbd> volta ao cursor. A lixeira sem seleção apaga todos os desenhos do ativo.
- Os desenhos ficam presos a data e preço: continuam no lugar ao trocar de tempo gráfico. Ficam salvos por ativo no navegador.

## Simulador de posição

No Radar e na Carteira, o botão **⊕ Simular** abre uma ferramenta de risco/retorno no gráfico, como a do TradingView:

- Linhas de **entrada**, **stop** e **alvo** que você arrasta com o mouse, com as zonas de risco (vermelha) e retorno (verde).
- **Boleta** abaixo do gráfico: compra ou venda, preços, capital, quantidade, risco, retorno e R:R, atualizados ao vivo.
- **Simulações salvas** são reavaliadas a cada atualização com os candles diários: *aguardando entrada*,
  *em aberto* (com o resultado do dia), *alvo atingido* ou *stop atingido* (com a data). Se stop e alvo cabem no
  mesmo candle, conta o stop (conservador).
- A seção **Minhas simulações** lista todas com o resultado.

As simulações ficam salvas **no navegador** (localStorage), sem servidor. Para levar a outro computador ou guardar
uma cópia, use **Exportar** e **Importar** (arquivo JSON).

## Integridade dos dados

Na dúvida, o dado não entra:

1. **Preço sem ajuste de dividendos.** É o mesmo número que a corretora e o TradingView mostram (ajustado só por desdobramento).
2. **Candles impossíveis são descartados:** OHLC incoerente, preço zero, pregão fantasma sem negócio
   (feriados que o Yahoo preenche), pico isolado que vai e volta no dia seguinte e pavio fora do padrão do ativo.
3. **Quebra de série:** gap acima de 40% sem volume que o justifique (grupamento não ajustado, incorporação).
   Nesse caso o histórico anterior é descartado, e nada é "consertado" ou inventado.
4. **Conferência com fonte oficial** (selo "✓ conferido até dd/mm" no site):
   - Os 5 últimos fechamentos precisam bater em até 0,6% com a referência.
   - O candle de hoje precisa ter máxima e mínima iguais às oficiais (tolerância de 0,6%) e o fechamento dentro dessa faixa.
   - **B3:** arquivo oficial COTAHIST (fechamentos dos pregões anteriores) e a API de cotações da B3 (faixa do dia).
     Sem chave. Opcional: um token gratuito da [brapi.dev](https://brapi.dev) no secret `BRAPI_TOKEN` acrescenta
     uma terceira fonte.
   - **EUA:** API pública da Nasdaq (histórico oficial e faixa do dia). Sem chave.
   - **Cripto:** Coinbase Exchange (candles diários em UTC), com tolerância de 1%, porque não existe fechamento
     oficial único. Só entram as moedas que existem na Coinbase e cujo preço no Yahoo bate com ela. Ficaram de fora,
     por exemplo, TON (o Yahoo devolve outro token com o mesmo símbolo), TRX (sem par na Coinbase), SHIB e PEPE
     (o Yahoo arredonda o preço e distorce os candles).
5. **Candle quebrado no Yahoo** (sem fechamento ou com abertura/máxima/mínima zeradas, o que acontece à noite)
   é trocado pelo candle oficial da B3 (COTAHIST) ou da Nasdaq, quando a fonte já publicou aquele pregão.
   Se ainda não publicou, o dia fica de fora com o aviso "incompleto na fonte". Uma segunda rodada às 07:17
   completa o que faltar.
6. Um ativo que falha em qualquer etapa fica **retido**: sem gráfico e sem sinais no dia. A lista de retidos aparece no fim do Radar.
7. **60 min e 4h:** cada dia de intraday é comparado com o candle diário já verificado. A máxima e a mínima
   precisam caber na do dia (folga de 0,5%), e o último fechamento precisa estar a até 2% do oficial (a diferença normal
   vem do leilão de fechamento). Os dias que não batem são descartados.

### Pregão em andamento

Sinais só saem de **candles fechados**. Se a atualização roda com o pregão aberto (um push no `main`, um cron
atrasado ou um disparo manual), o candle de hoje aparece no gráfico **translúcido, marcado "em formação"**, mas
fica fora das estratégias, do estado do ativo, do backtest, da carteira e da estratégia multitempo (o 60 min de
hoje também não conta). O pregão é considerado fechado a partir de 18h30 em São Paulo (B3), 16h30 em Nova York
(EUA) e meia-noite UTC (cripto). Radar e Multitela mostram uma contagem regressiva até a rodada que publica os
sinais do dia ("Brasil e EUA: sinais de 20/10 em 3h05").

### Cripto

- O candle diário de cripto só fecha à meia-noite UTC: o dia em curso é "em formação" e não gera sinais.
- A semana de cripto vai de segunda a domingo.
- "Último pregão" é contado por mercado: o último pregão da B3 pode ser sexta, enquanto o de cripto é domingo.

## Estratégias (Oportunidades)

No Radar: **1. Mercado** → **2. O que ver** (Oportunidades ou Filtros de estado) → **3. Sinal** (diário ou semanal).
As oportunidades vêm em **Compra** e **Venda**, separadas em duas modalidades. Toda estratégia de venda é o espelho
da de compra, com o mesmo nome. O grupo **★ Confluência** reúne os ativos com 2 ou mais estratégias do mesmo lado.

### A favor da tendência (comprar alta que continua / vender baixa que continua)

| Estratégia | Compra | Venda |
|---|---|---|
| Pullback nas médias | Médias alinhadas para cima. **Rejeição**: a mínima fura a MM20, MM50 ou MM200 e o candle fecha acima. **Violação e retomada**: fecha abaixo da média por 1 ou 2 candles e volta a fechar acima | Espelho, com as médias alinhadas para baixo |
| Boca de jacaré | Bollinger comprimida abre (superior sobe, inferior desce) e o preço fecha acima da banda superior | Fecha abaixo da inferior |
| Multitempo | **Sinal diário:** diário acima da MM20 e da MM50 + exaustão de queda no 60 min (estocástico lento < 20 e/ou IFR < 30). **Sinal semanal:** semanal em alta + a mesma exaustão no diário ou no 4 horas | Espelho (estocástico > 80 e/ou IFR > 70) |

### Contra a tendência (comprar a faca caindo / vender o que esticou demais)

| Estratégia | Compra | Venda |
|---|---|---|
| IFR extremo | IFR 14 abaixo de 20 | Acima de 80 |
| Fora da Bollinger | Fecha abaixo da banda inferior (fora de uma boca de jacaré) | Acima da superior |
| Distância da MM20 | Preço abaixo da MM20 a pelo menos 2,5x a distância média do próprio ativo (último ano no diário, 2 anos no semanal) | Acima |
| Maiores quedas / altas | Entre as 8% maiores quedas do mercado em 21 pregões (diário) ou 13 semanas (semanal), com pelo menos 8% / 12% | Maiores altas |

## Filtros de estado (panorama)

A foto de hoje, independente de evento: **tendência forte de alta** e **de baixa** (preço acima ou abaixo da MM20 e
da MM50 no diário e no semanal) e **Bollinger comprimida** (largura entre as 10% menores dos últimos 120 candles),
no tempo gráfico escolhido (60m, 4h, diário ou semanal).

Ativos com pouca liquidez (volume financeiro médio de 20 dias abaixo de R$ 10 mi na B3, US$ 100 mi nos EUA ou
US$ 30 mi em cripto) ficam fora dos sinais. Os parâmetros ficam no topo de `scripts/estrategias.py`.

**São filtros técnicos para chamar atenção, não recomendação de investimento.**

## Configuração

- `config/universo.json`: ações do radar (BR e EUA). As da B3 foram escolhidas pelo volume médio no COTAHIST.
- `config/carteira.json`: capital inicial, ativos acompanhados (inclusive cripto) e `transacoes`:

```json
"transacoes": [
  { "data": "2026-10-20", "ticker": "PETR4.SA", "tipo": "compra", "quantidade": 20, "preco": 38.50, "taxas": 0 },
  { "data": "2026-10-20", "ticker": "AAPL",     "tipo": "compra", "quantidade": 2,  "preco": 340.00, "cambio": 5.05 }
]
```

## Publicação

**Settings → Pages → Source: GitHub Actions.** A branch padrão do repositório precisa ser a `main`, porque o
agendamento diário só roda na branch padrão.

## Rodar local

```bash
pip install -r requirements.txt
python scripts/atualizar_dados.py      # leva alguns minutos (~270 ativos)
python -m http.server 8000             # abra http://localhost:8000
```
