# Carteira Terminal

Terminal pessoal de análise técnica, feito para a rotina **depois do fechamento**: ver quais setups se formaram,
comparar os gráficos dos ativos na mesma condição e decidir as entradas do dia seguinte. Cinco páginas:

- **Carteira** (`index.html`): o que você tem e acompanha. Patrimônio em BRL, posições, **Minha lista** (os
  ativos que você acompanha, salva neste navegador), **Minhas simulações** e os setups que dispararam nesses ativos.
- **Setups** (`setups.html`): ~420 ativos (todas as ações da B3 com volume médio acima de R$ 1 mi/dia, as 150
  maiores dos EUA, 30 criptos e 40 de macro). Escolha o setup pela árvore **Compra | Venda** → **A favor** ou
  **Contra a tendência** → setups (ou "Todos os setups" do lado), ou monte **Minhas regras**. Escolha também o
  tempo do sinal (diário ou semanal) e de quando (último pregão, 2, 3 ou 5). O resultado aparece numa **grade**
  (1, 2×2, 3×3 ou 4×3) de gráficos lado a lado para comparar, cabendo na tela no zoom 100%. O card é só
  gráfico; clique no selo ✓/⚠ do cabeçalho para o contexto (✓ a favor, ⚠ cuidado) entrar deslizando. Clique no nome para tela cheia.

  "Só com 2+ setups" mostra os ativos com vários setups ao mesmo tempo; dá para ordenar por melhor histórico,
  mais setups juntos, variação etc. As setas no gráfico marcam os candles em que o setup disparou.
- **Triagem** (`triagem.html`): um "Tinder" de ativos. Um card por ativo que deu sinal de **compra** (ou de
  **venda**) no último pregão fechado do mercado dele, com gráfico, setups, histórico e contexto. Arraste para a
  direita (♥ gostei), para a esquerda (✗ descartar, só por hoje) ou para cima (★ super); <kbd>←</kbd> <kbd>↑</kbd>
  <kbd>→</kbd> e <kbd>Backspace</kbd> (desfazer) também servem. Em **Hoje**, as três colunas, com atalhos para
  Comparar e Plano de amanhã; em **Dias anteriores**, quanto o preço andou desde a triagem. Salvo neste navegador.
- **Ativo** (`ativo.html#PETR4`): tudo sobre um papel. Gráfico completo, setups recentes (clique para ir à data),
  contexto, simulações e **como cada setup se saiu nesse ativo**. A busca no topo de qualquer página abre aqui
  (atalho <kbd>/</kbd>).
- **Backtest** (`backtest.html`): o histórico de cada setup do catálogo, por mercado, lado e prazo.

`radar.html` e `multitela.html` (as páginas antigas) redirecionam para Setups.

Gráficos com TradingView Lightweight Charts: candles, MM20/50/200, Bollinger (20, 2) e IFR 14, nos tempos
**60 min, 4 horas**, diário, semanal e mensal. **Alt+C** centraliza o gráfico no preço.

## Como funciona

```
GitHub Actions (todo dia 19:30 e 07:17 BRT, e a cada push no main)
   └─ scripts/atualizar_dados.py           (um processo por núcleo; ~5 min)
        ├─ fontes.py       baixa candles diários (6 anos) e de 60 min (6 meses) do Yahoo Finance
        ├─ validacao.py    verifica a integridade e confere os fechamentos com outra fonte
        ├─ setups.py       avalia o catálogo config/setups.json em todo o histórico (diário e semanal)
        ├─ backtest.py     mede o que aconteceu depois de cada setup, ativo por ativo
        ├─ rastreador.py   fotos dos indicadores para as regras próprias e o contexto do site
        └─ grava data/radar.json, data/setups.json, data/rastreador.json, data/backtest.json, data/ativos/...
   └─ publica o site estático no GitHub Pages
```

**Um motor só.** `config/setups.json` é o catálogo único: cada setup é uma lista de regras (as mesmas do editor
de "Minhas regras"). O Python avalia o catálogo e gera os sinais datados e o backtest; o site avalia só as suas
regras próprias. Um teste de paridade (`scripts/testar_paridade.py`, rodado a cada push por
`.github/workflows/testes.yml`) confere que Python e JS dão o mesmo resultado em todos os setups e ativos.
Detalhes em `docs/arquitetura.md`.

## Backtest dos setups

A página **Backtest** (`backtest.html`) mostra, para cada mercado, sinal (diário/semanal), lado e prazo, como
cada setup se saiu nos últimos 6 anos, ativo por ativo (`scripts/backtest.py`):

- **Entrada na abertura do candle seguinte** ao sinal (o site publica depois do fechamento) e **saída no
  fechamento** depois de 5, 10 ou 20 pregões (sinal diário) ou 4, 8 ou 13 semanas (sinal semanal). Na venda,
  o resultado é invertido.
- Sinais repetidos do mesmo setup dentro do prazo contam **uma vez só**.
- **Vantagem** = retorno médio do sinal menos o retorno médio de entrar num dia qualquer (mesmo mercado e prazo),
  porque em mercado de alta quase toda compra dá lucro.
- Setups e ativos com menos de 5 casos aparecem como "poucos casos".
- Em Setups e no Ativo, cada sinal traz o selo do histórico **naquele ativo** (acerto, retorno médio e casos, no prazo de 10
  pregões ou 8 semanas), e a lista pode ser ordenada por **melhor histórico**.

Sem custos, impostos ou deslizamento; resultado passado não garante resultado futuro. "Maiores quedas/altas"
não tem backtest, porque depende da comparação entre ativos a cada dia, e "Bollinger comprimida" também não,
porque não tem lado.

## Personalizar o gráfico

O botão **⚙ Personalizar** (em Setups e no Ativo) ajusta todos os gráficos do site:

- **Predefinições:** *Escuro* (padrão), *Claro limpo* (fundo branco, sem grade e sem indicadores) e *Claro com grade*.
- **Fundo e grade:** cor de fundo e linhas verticais e horizontais ligadas ou desligadas.
- **Candles:** cores de alta e de baixa.
- **Indicadores:** MM20, MM50, MM200, Bollinger, IFR (o painel some quando desligado) e as setas dos sinais.

Os indicadores também têm atalhos de liga/desliga na barra acima de cada gráfico. A escolha fica salva no navegador.

## Ferramentas de desenho

Na barra do canto esquerdo do gráfico (Setups, grade e Ativo):

- **Linha horizontal**, **segmento de reta**, **retângulo** (com preenchimento e opacidade ajustável) e **pincel**.
- Com o cursor, clique num desenho para selecionar, arraste para mover ou arraste as alças das pontas.
  <kbd>Delete</kbd> apaga o selecionado e <kbd>Esc</kbd> volta ao cursor. A lixeira sem seleção apaga todos os desenhos do ativo.
- Os desenhos ficam presos a data e preço: continuam no lugar ao trocar de tempo gráfico. Ficam salvos por ativo no navegador.

## Simulador de posição

Em Setups e no Ativo, o botão **⊕ Simular** abre uma ferramenta de risco/retorno no gráfico, como a do TradingView:

- Linhas de **entrada**, **stop** e **alvo** que você arrasta com o mouse, com as zonas de risco (vermelha) e retorno (verde).
- **Boleta** abaixo do gráfico: compra ou venda, preços, capital, quantidade, risco, retorno e R:R, atualizados ao vivo.
- **Simulações salvas** são reavaliadas a cada atualização com os candles diários: *aguardando entrada*,
  *em aberto* (com o resultado do dia), *alvo atingido* ou *stop atingido* (com a data). Se stop e alvo cabem no
  mesmo candle, conta o stop (conservador).
- A seção **Minhas simulações**, na Carteira, lista todas com o resultado.

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
6. Um ativo que falha em qualquer etapa fica **retido**: sem gráfico e sem sinais no dia. A lista de retidos aparece no fim da página Setups.
7. **60 min e 4h:** cada dia de intraday é comparado com o candle diário já verificado. A máxima e a mínima
   precisam caber na do dia (folga de 0,5%), e o último fechamento precisa estar a até 2% do oficial (a diferença normal
   vem do leilão de fechamento). Os dias que não batem são descartados.

### Pregão em andamento

Sinais só saem de **candles fechados**. Se a atualização roda com o pregão aberto (um push no `main`, um cron
atrasado ou um disparo manual), o candle de hoje aparece no gráfico **translúcido, marcado "em formação"**, mas
fica fora dos setups, do estado do ativo, do backtest, da carteira e do setup multitempo (o 60 min de
hoje também não conta). O pregão é considerado fechado a partir de 18h30 em São Paulo (B3), 16h30 em Nova York
(EUA) e meia-noite UTC (cripto). As páginas mostram uma contagem regressiva até a rodada que publica os
sinais do dia ("Brasil e EUA: sinais de 20/10 em 3h05").

### Cripto

- O candle diário de cripto só fecha à meia-noite UTC: o dia em curso é "em formação" e não gera sinais.
- A semana de cripto vai de segunda a domingo.
- "Último pregão" é contado por mercado: o último pregão da B3 pode ser sexta, enquanto o de cripto é domingo.

## Setups (catálogo)

`config/setups.json`, 35 setups. Os de venda são o espelho dos de compra.

| Grupo | Setups | Estilo |
|---|---|---|
| Tendência | Tendência de alta / de baixa (fechamento acima/abaixo da MMS 20 e da MMS 50); Alta / Baixa forte (médias alinhadas, MMS 50 subindo/caindo); Alta curta (acima da MME 9, MMS 25 e MMS 50) | a favor |
| Pullback | Na MME 9, MMS 20, MMS 50 e MMS 200, de compra e de venda. **Rejeição** (a sombra fura a média e fecha do lado certo) ou **violação e retomada** (1 ou 2 candles do outro lado, até 1 ATR, vindo do lado certo). O candle precisa estar **na média**: a sombra chega até ela (folga de ¼ de ATR) e o fechamento fica a até 1 ATR | a favor |
| Multitempo | Diário em tendência + exaustão no 60 min (estocástico lento < 20 e/ou IFR < 30); semanal em tendência + exaustão no diário ou no 4 horas | a favor |
| Exaustão e extremos | Fechou fora da Bollinger; IFR 14 < 30 / > 70; IFR e estocástico sobrevendidos; IFR 2 < 10 em alta longa; muito longe da MMS 20 (2,5× o normal do ativo); maiores quedas / altas do mercado (8% maiores em 21 pregões ou 13 semanas, com pelo menos 8% / 12%) | contra |
| Volatilidade e rompimento | Boca de jacaré (Bollinger comprimida que abre com fechamento fora); compressão em tendência de alta; rompeu a máxima / perdeu a mínima de 20 candles (com ou sem volume); perto da máxima de 52 semanas; cruzou a MMS 20; MMS 50 cruzou a MMS 200 | a favor |
| Panorama | Bollinger comprimida (largura entre as 10% menores dos últimos 120 candles), sem lado | neutro |

Um setup dispara num candle fechado quando **todas** as regras dele valem. Para criar ou mudar um setup, edite
`config/setups.json` (as regras usam os mesmos tipos do editor de "Minhas regras") e confira com o teste de paridade.

Ativos com pouca liquidez (volume financeiro médio de 20 dias abaixo de R$ 1 mi na B3, US$ 20 mi nos EUA ou
US$ 5 mi em cripto) ficam fora dos sinais. Os parâmetros ficam no topo de `scripts/estrategias.py`.

**São filtros técnicos para chamar atenção, não recomendação de investimento.**

## Configuração

- `config/setups.json`: o catálogo de setups (veja acima).
- `config/universo.json`: os ativos acompanhados (B3, EUA, cripto e macro). As da B3 foram escolhidas pelo volume médio no COTAHIST.
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
python scripts/atualizar_dados.py      # leva alguns minutos (~420 ativos, um processo por núcleo)
python scripts/testar_paridade.py      # confere que Python e JS avaliam os setups igual
python -m http.server 8000             # abra http://localhost:8000
```

## Universo de ativos

`config/universo.json`, montado por `python scripts/montar_universo.py` (rodar à mão de vez em quando):

- **Brasil:** ações à vista da B3 com pelo menos R$ 1 milhão/dia de volume médio (arquivo oficial COTAHIST),
  sem BDRs e fundos.
- **EUA:** as 150 maiores ações por valor de mercado (screener da Nasdaq), hoje acima de ~US$ 110 bilhões.
- **Cripto:** os 30 pares em dólar mais negociados na Coinbase, sem stablecoins, com o preço do Yahoo
  conferido com a Coinbase.
- **Macro:** índices (Ibovespa, S&P 500, Nasdaq, Dow, DAX, Nikkei...), moedas (EUR/USD, GBP/USD, USD/BRL,
  DXY...) e commodities (ouro, prata, petróleo WTI e Brent, gás, cobre, soja, milho, café...). Não há fonte
  oficial gratuita para conferir esses fechamentos, então aparecem como "checagem interna".

