# Carteira Terminal

Painel pessoal com três telas:

- **Carteira** (`index.html`): patrimônio em BRL, posições, evolução da carteira e sinais nos ativos acompanhados.
- **Radar** (`radar.html`): ~450 ativos. São todas as ações da B3 com volume médio acima de R$ 10 mi/dia,
  ~260 dos EUA e 31 criptos. O menu superior escolhe o mercado e a visão, e a lista à direita do gráfico mostra o resultado:
  - **Oportunidades:** abas **Compra** e **Venda**, separadas por estratégia, com o bloco **Prioridade** para quem
    dispara 2 ou mais estratégias. A **camada** define o tempo gráfico dos sinais (diário ou semanal).
  - **Filtros de estado:** tendência forte de alta e de baixa, IFR extremo e Bollinger comprimida. A Bollinger
    escolhe o tempo (60m, 4h, diário, semanal), e o gráfico acompanha.

  Clicou, o gráfico abre ao lado, com setas nos candles em que cada sinal apareceu; <kbd>↑</kbd> <kbd>↓</kbd> navegam pela lista.
- **Multitela** (`multitela.html`): grade de gráficos (2×2, 3×3 ou 4×3) para bater o olho nas oportunidades do dia.

Gráficos com TradingView Lightweight Charts: candles, MM20/50/200, Bollinger (20, 2) e IFR 14, nos tempos
**60 min, 4 horas**, diário, semanal e mensal. **Alt+R** centraliza o gráfico no preço.

## Como funciona

```
GitHub Actions (todo dia 19:30 BRT)
   └─ scripts/atualizar_dados.py
        ├─ fontes.py       baixa candles diários (6 anos) e de 60 min (6 meses) do Yahoo Finance
        ├─ validacao.py    verifica a integridade e confere os fechamentos com outra fonte
        ├─ estrategias.py  calcula indicadores e sinais datados (diário e semanal)
        └─ grava data/radar.json, data/resumo.json, data/ativos/<ticker>.json e data/intraday/<ticker>.json
   └─ publica o site estático no GitHub Pages
```

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
5. Um ativo que falha em qualquer etapa fica **retido**: sem gráfico e sem sinais no dia. A lista de retidos aparece no fim do Radar.
6. **60 min e 4h:** cada dia de intraday é comparado com o candle diário já verificado. A máxima e a mínima
   precisam caber na do dia (folga de 0,5%), e o último fechamento precisa estar a até 2% do oficial (a diferença normal
   vem do leilão de fechamento). Os dias que não batem são descartados.

### Cripto

- O candle diário de cripto só fecha à meia-noite UTC. A atualização usa apenas os dias já encerrados.
- A semana de cripto vai de segunda a domingo.
- "Último pregão" é contado por mercado: o último pregão da B3 pode ser sexta, enquanto o de cripto é domingo.

## Estratégias

Todas têm o espelho para venda. Um ativo com 2 ou mais famílias do mesmo lado entra em **Prioridade**.

| Família | Compra | Venda |
|---|---|---|
| Pullback nas médias | MM20 > MM50, preço acima da MM50, semanal em alta; a mínima toca a MM20/50/200 e o fechamento a segura | Espelho em tendência de baixa: repique rejeitado na média |
| IFR extremo | IFR 14 cruza abaixo de 20 | IFR cruza acima de 80 |
| Multitempo 60 min | Diário **e** semanal acima da MM20 e MM50; no 60 min, estocástico lento < 20 e IFR < 30 | D+S abaixo das médias; estocástico > 80 e IFR > 70 no 60 min |
| Multitempo diário | Semanal acima das duas médias; no diário, estocástico lento < 20 e IFR < 40 | Espelho |
| Fora da Bollinger | Fechamento abaixo da banda inferior (reversão à média) ou acima da superior em tendência de alta (continuidade) | Espelho |
| Boca de jacaré | Após bandas comprimidas, a superior sobe, a inferior desce e o preço fecha acima | Fecha abaixo |

Filtros de estado (a foto de hoje): **tendência forte** (acima ou abaixo das duas médias no diário e no semanal),
**IFR extremo** (< 20 ou > 80 no 60 min, diário, semanal ou mensal) e **Bollinger comprimida** (largura entre as
10% menores dos últimos 120 pregões, um possível sinal de explosão de volatilidade).

Os filtros de prazo maior usam só o que já estava fechado no dia do sinal, sem olhar o futuro.
Ativos com pouca liquidez (volume financeiro médio de 20 dias abaixo de R$ 10 mi na B3 ou US$ 100 mi nos EUA)
ficam fora dos sinais. Os parâmetros ficam no topo de `scripts/estrategias.py`.

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
