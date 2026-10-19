"""Fontes de dados.

- Yahoo Finance (yfinance): candles diários de todos os ativos. Usamos o fechamento
  SEM ajuste de dividendos (só ajustado por desdobramento), que é o mesmo número
  mostrado pelas corretoras e pelo TradingView.
- Nasdaq (api.nasdaq.com): fechamentos oficiais das ações americanas, usados só
  para conferir o Yahoo.
- brapi.dev: fechamentos das ações da B3, usados só para conferir o Yahoo.
  Precisa de token gratuito (variável de ambiente BRAPI_TOKEN).
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pandas as pd
import requests
import yfinance as yf

PERIODO = "6y"  # o IFR mensal precisa de alguns anos de histórico
HEADERS_NASDAQ = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _normalizar(df: pd.DataFrame) -> pd.DataFrame:
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()
    return df[~df.index.duplicated(keep="last")].sort_index()


def baixar_yahoo(tickers: list[str], tentativas: int = 3) -> dict[str, pd.DataFrame]:
    """Baixa candles diários em lote; refaz individualmente o que vier vazio."""
    dados: dict[str, pd.DataFrame] = {}
    pendentes = list(tickers)
    for i in range(tentativas):
        if not pendentes:
            break
        lote = yf.download(pendentes, period=PERIODO, interval="1d", group_by="ticker",
                           auto_adjust=False, actions=False, threads=True, progress=False)
        for tk in pendentes:
            try:
                df = lote[tk] if len(pendentes) > 1 else lote
                df = df.dropna(subset=["Close"])
            except KeyError:
                continue
            if not df.empty:
                dados[tk] = _normalizar(df)
        pendentes = [t for t in pendentes if t not in dados]
        if pendentes:
            time.sleep(5 * (i + 1))  # Yahoo limita requisições (HTTP 429); espera e tenta de novo
    return dados


# ------------------------------------------------------------- referências

def _nasdaq(ticker: str) -> dict[str, float]:
    simbolo = ticker.replace("-", ".")
    hoje = date.today()
    url = (f"https://api.nasdaq.com/api/quote/{simbolo}/historical?assetclass=stocks"
           f"&fromdate={hoje - timedelta(days=20)}&todate={hoje}&limit=15")
    r = requests.get(url, headers=HEADERS_NASDAQ, timeout=15)
    r.raise_for_status()
    linhas = ((r.json().get("data") or {}).get("tradesTable") or {}).get("rows") or []
    out = {}
    for l in linhas:
        m, d, a = l["date"].split("/")
        out[f"{a}-{m}-{d}"] = float(l["close"].replace("$", "").replace(",", ""))
    return out


def _brapi(ticker: str, token: str) -> dict[str, float]:
    simbolo = ticker.removesuffix(".SA")
    r = requests.get(f"https://brapi.dev/api/quote/{simbolo}",
                     params={"range": "1mo", "interval": "1d", "token": token}, timeout=15)
    r.raise_for_status()
    res = (r.json().get("results") or [{}])[0]
    out = {}
    for c in res.get("historicalDataPrice") or []:
        if c.get("close") is None:
            continue
        # brapi devolve o timestamp do pregão em UTC; converte para a data em Brasília
        dia = pd.Timestamp(c["date"], unit="s", tz="UTC").tz_convert("America/Sao_Paulo")
        out[dia.strftime("%Y-%m-%d")] = float(c["close"])
    return out


def referencias(ativos: list[dict]) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """Fechamentos de referência por ticker: {ticker: {data: close}} e o nome da fonte."""
    token = os.environ.get("BRAPI_TOKEN", "").strip()
    tarefas = []
    for a in ativos:
        if a["mercado"] == "US":
            tarefas.append((a["ticker"], "Nasdaq", lambda t=a["ticker"]: _nasdaq(t)))
        elif a["mercado"] == "BR" and token:
            tarefas.append((a["ticker"], "brapi", lambda t=a["ticker"]: _brapi(t, token)))

    def rodar(tarefa):
        tk, fonte, fn = tarefa
        for i in range(3):
            try:
                return tk, fonte, fn()
            except Exception:
                time.sleep(1 + i)
        return tk, fonte, None

    refs, fontes = {}, {}
    with ThreadPoolExecutor(4) as ex:
        for tk, fonte, dados in ex.map(rodar, tarefas):
            if dados:
                refs[tk], fontes[tk] = dados, fonte
    return refs, fontes


def baixar_yahoo_60min(tickers: list[str], fuso: str) -> dict[str, pd.DataFrame]:
    """Candles de 60 minutos dos últimos ~60 pregões, no fuso da bolsa."""
    if not tickers:
        return {}
    dados = {}
    for i in range(3):
        pendentes = [t for t in tickers if t not in dados]
        if not pendentes:
            break
        lote = yf.download(pendentes, period="60d", interval="60m", group_by="ticker",
                           auto_adjust=False, actions=False, threads=True, progress=False)
        for tk in pendentes:
            try:
                df = (lote[tk] if len(pendentes) > 1 else lote).dropna(subset=["Close"])
            except KeyError:
                continue
            if not df.empty:
                df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
                df.index = pd.DatetimeIndex(df.index).tz_convert(fuso).tz_localize(None)
                dados[tk] = df[~df.index.duplicated(keep="last")].sort_index()
        time.sleep(3 * (i + 1))
    return dados
