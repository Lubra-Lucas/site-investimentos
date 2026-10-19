# Carteira Terminal

Painel pessoal para acompanhar uma carteira de longo prazo com **ações brasileiras, ações americanas e criptomoedas**,
com gráficos em candle (TradingView Lightweight Charts) e um radar de possíveis pontos de entrada.

## Como funciona

```
GitHub Actions (todo dia 18:30 BRT)
   └─ scripts/atualizar_dados.py
        ├─ baixa candles diários (Yahoo Finance via yfinance)
        │     B3: PETR4.SA · EUA: AAPL · Cripto: BTC-USD · Câmbio: USDBRL=X
        ├─ calcula IFR diário/semanal, MM20/50/200, volume, distância da máxima
        ├─ pontua cada ativo (score de oportunidade)
        ├─ consolida a carteira em BRL a partir das suas transações
        └─ grava data/resumo.json + data/ativos/<ticker>.json
   └─ publica o site estático no GitHub Pages
```

Sem servidor e sem chave de API: o site é HTML/CSS/JS puro que lê os JSONs gerados.

## Configurar no GitHub (uma vez)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Faça merge na branch `main` (ou rode **Actions → Atualizar dados e publicar → Run workflow**).
3. O site fica em `https://<seu-usuario>.github.io/site-investimentos/`.

> Pages em repositório privado exige plano pago do GitHub. Se o repo for privado no plano gratuito,
> veja a seção "Rodar local" ou publique na Cloudflare Pages/Netlify.

## Registrar compras e vendas

Edite `config/carteira.json` → `transacoes` (o preço é na moeda do ativo):

```json
"transacoes": [
  { "data": "2026-10-20", "ticker": "PETR4.SA", "tipo": "compra", "quantidade": 20, "preco": 38.50, "taxas": 0 },
  { "data": "2026-10-20", "ticker": "AAPL",     "tipo": "compra", "quantidade": 2,  "preco": 340.00, "cambio": 5.05 },
  { "data": "2026-10-21", "ticker": "BTC-USD",  "tipo": "compra", "quantidade": 0.004, "preco": 81000 }
]
```

- `cambio` é opcional; sem ele, usa o USD/BRL de fechamento do dia.
- Para acompanhar um novo ativo, adicione em `ativos` (ticker no formato do Yahoo: `XXXX3.SA`, `TICKER`, `MOEDA-USD`).

## Score de oportunidade

| Sinal | Pontos |
|---|---|
| IFR semanal < 30 (sobrevendido) | 3 |
| IFR diário < 30 | 2 |
| Pullback até 3% acima da MM200, em tendência de alta | 2 |
| Cruzamento dourado (MM50 > MM200) nos últimos 10 pregões | 2 |
| IFR diário ou semanal < 40 | 1 cada |
| Preço acima da MM200 | 1 |
| Preço testando a MM50 | 1 |
| Alta com volume > 1,5× a média de 20 dias | 1 |
| Mais de 30% abaixo da máxima de 52 semanas | 1 |

Ativos sem liquidez mínima (volume financeiro médio de 20 dias: R$ 20 mi na B3, US$ 100 mi nos EUA/cripto)
ficam com score 0. Alertas de sobrecompra e cruzamento da morte aparecem em vermelho.
As regras ficam em `gerar_sinais()` no script — fácil de ajustar.

**É um filtro técnico para chamar atenção, não recomendação de investimento.**

## Rodar local

```bash
pip install -r requirements.txt
python scripts/atualizar_dados.py
python -m http.server 8000   # abra http://localhost:8000
```
