# Carteira Terminal

Painel pessoal com três telas:

- **Carteira** (`index.html`): patrimônio em BRL, posições, evolução da carteira e sinais nos ativos acompanhados.
- **Radar** (`radar.html`): ~270 ações do Brasil e dos EUA, com oportunidades de compra e venda separadas por estratégia,
  destacando os ativos com confluência (2 ou mais estratégias). Também tem filtros de estado: tendência forte,
  IFR extremo e Bollinger comprimida.
- **Multitela** (`multitela.html`): grade de gráficos (2×2, 3×3 ou 4×3) para bater o olho nas oportunidades do dia.

Gráficos com TradingView Lightweight Charts: candles, MM20/50/200, Bollinger (20, 2) e IFR 14, nos tempos
diário, semanal e mensal. **Alt+R** centraliza o gráfico no preço.

## Como funciona

```
GitHub Actions (todo dia 19:30 BRT)
   └─ scripts/atualizar_dados.py
        ├─ fontes.py       baixa candles diários (6 anos) e de 60 min (60 pregões) do Yahoo Finance
        ├─ validacao.py    verifica a integridade e confere os fechamentos com outra fonte
        ├─ estrategias.py  calcula indicadores e sinais datados (diário e semanal)
        └─ grava data/radar.json, data/resumo.json e data/ativos/<ticker>.json
   └─ publica o site estático no GitHub Pages
```

## Integridade dos dados

Na dúvida, o dado não entra:

1. **Preço sem ajuste de dividendos.** É o mesmo número que a corretora e o TradingView mostram (ajustado só por desdobramento).
2. **Candles impossíveis são descartados:** OHLC incoerente, preço zero, pregão fantasma sem negócio
   (feriados que o Yahoo preenche), pico isolado que vai e volta no dia seguinte e pavio fora do padrão do ativo.
3. **Quebra de série:** gap acima de 40% sem volume que o justifique (grupamento não ajustado, incorporação).
   Nesse caso o histórico anterior é descartado, e nada é "consertado" ou inventado.
4. **Conferência com segunda fonte:** os 5 últimos fechamentos precisam bater em até 0,6% com a referência.
   - EUA: API pública da Nasdaq (sem chave).
   - B3: [brapi.dev](https://brapi.dev). Precisa de um token gratuito. Crie a conta, gere o token e cadastre-o em
     **Settings → Secrets and variables → Actions → New repository secret** com o nome `BRAPI_TOKEN`.
     Sem o token, as ações da B3 passam só pela verificação interna (selo "interno" no site).
5. Um ativo que falha em qualquer etapa fica **retido**: sem gráfico e sem sinais no dia. A lista de retidos aparece no fim do Radar.
6. O 60 min só é usado se o último candle bater com o fechamento diário (diferença de até 2%).

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

- `config/universo.json`: ações do radar (BR e EUA).
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
