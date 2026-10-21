# Arquitetura: um motor de setups, três páginas

## Ideia

Antes havia dois motores com definições diferentes: as estratégias do Radar (`scripts/estrategias.py`) e
os modelos do rastreador da Multitela (`assets/js/rastreador.js`). Agora:

- **`config/setups.json` é o catálogo único de setups.** Cada setup é uma lista de regras (as mesmas
  condições do editor de regras), com todos os parâmetros explícitos. Serve aos menus do site, ao cálculo
  dos eventos e ao backtest.
- **Python é a fonte da verdade dos setups do catálogo** (`scripts/setups.py`): avalia as regras em todo o
  histórico (diário e semanal), gera os eventos datados e alimenta o backtest.
- **JS avalia só as regras personalizadas** do usuário (`assets/js/rastreador.js`, `CONDICOES`), sobre as
  fotos de `data/rastreador.json`. As duas implementações das condições são conferidas por um teste de
  paridade (`scripts/testar_paridade.py`): para cada setup do catálogo e cada ativo, o último candle tem
  que dar o mesmo resultado em Python e em JS.

## Condições (tipos de regra)

`preco_media, media_media, inclinacao, pullback, cruzamento, cruzamento_medias, distancia, ifr,
estocastico, estoc_cruz, bollinger, comprimida, atr, variacao, rompimento, perto_extremo, candle, volume`
(já existentes em JS) e três novas:

- `boca` `{lado: compra|venda}`: Bollinger comprimida que abre (superior sobe, inferior desce) com
  fechamento fora da banda (acima na compra, abaixo na venda). Mesma regra de `estrategias._boca`.
- `multitempo` `{lado: compra|venda}`: a estratégia multitempo atual (tendência no tempo do sinal +
  exaustão no tempo menor). Precisa do intraday, então o Python calcula e publica o resultado por candle
  nas fotos; o JS só lê.
- `ranking` `{lado: quedas|altas}`: entre as 8% maiores quedas (altas) do mesmo mercado em 21 pregões
  (13 semanas), com pelo menos 8% (12%). Depende de todos os ativos: calculado no fim de
  `atualizar_dados.py` e publicado por candle nas fotos. Sem backtest.

## Dados publicados

- `data/setups.json`: o catálogo (mesmo formato de `config/setups.json`), com o resumo do backtest de cada
  setup quando houver: `item.bt = {"D": {...}, "W": {...}}`.
- `data/radar.json`: como antes (`ativos`, `retidos`, `em_formacao`, `verificacao`...), mas `familias` sai e
  `sinais` passa a ser a lista de eventos dos setups:
  `{"ticker", "setup", "tf": "D"|"W", "data": "AAAA-MM-DD", "lado": "compra"|"venda"|"neutro", "preco",
  "bt": [casos, acerto %, retorno médio %, vantagem %] | null}`.
  Janela: últimos 15 pregões (D) e 8 semanas (W), só candles fechados. Tempo gráfico é sempre `D`/`W`.
- `data/rastreador.json`: as fotos de sempre (para regras personalizadas, contexto e valores do card),
  mais os campos por candle das condições novas.
- `data/backtest.json`: por setup (id do catálogo) em vez de família.
- `data/paridade.json`: os setups que disparam no último candle de cada ativo segundo o Python (D e W),
  para o teste de paridade.

## Testes

- `scripts/testar_paridade.py`: compara `data/paridade.json` com `quandoAtende(foto, regras, tf, F, 1) === 0`
  rodado no node (`scripts/paridade.js`) sobre `data/rastreador.json`. Tem que dar zero diferenças.
- `scripts/rodar_offline.py`: o pipeline inteiro sem rede, com dados sintéticos determinísticos.
- `.github/workflows/testes.yml`: roda os dois em todo push e pull request (não publica nada).

## Páginas

- **Setups** (`setups.html`): substitui Radar e Multitela. Escolhe mercado, setup (pelo catálogo: lado →
  a favor/contra → setups) ou "Minhas regras", tempo (D/W) e quando (último pregão, 2, 3, 5). O resultado
  aparece numa **grade** de gráficos (1, 2×2, 3×3, 4×3). Cada ativo mostra os
  setups que disparou, o selo do histórico e o contexto a favor/cuidado. `radar.html` e `multitela.html`
  redirecionam para cá.
- **Carteira** (`index.html`): posições, simulações e a minha lista (o que eu tenho e acompanho).
- **Ativo** (`ativo.html#TICKER`): tudo sobre um papel. Gráfico, setups recentes, simulações, como cada
  setup se saiu nele e contexto. Clicar num ticker em qualquer página abre aqui.
- **Backtest** (`backtest.html`): o histórico de cada setup do catálogo.
