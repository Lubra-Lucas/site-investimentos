"""Fontes de dados.

- Yahoo Finance (yfinance): candles diários de todos os ativos. Usamos o fechamento
  SEM ajuste de dividendos (só ajustado por desdobramento), que é o mesmo número
  mostrado pelas corretoras e pelo TradingView.
- Nasdaq (api.nasdaq.com): fechamentos oficiais das ações americanas e a faixa
  (máxima/mínima) do pregão de hoje, usados só para conferir o Yahoo.
- B3 (fontes oficiais, sem chave), para conferir as ações brasileiras:
    * COTAHIST: arquivo diário com o fechamento oficial de cada papel. É publicado
      no dia seguinte, então confere os pregões anteriores.
    * API de cotações: abertura, máxima e mínima do pregão de hoje.
- brapi.dev (opcional, token em BRAPI_TOKEN): fechamentos da B3, inclusive o de hoje.
- Coinbase Exchange (sem chave): candles diários em UTC para conferir as criptos.
"""

from __future__ import annotations

import io
import os
import time
import zipfile
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


def _do_lote(lote: pd.DataFrame, tk: str) -> pd.DataFrame | None:
    """Extrai um ticker do download em lote (com 1 ticker o yfinance pode não agrupar)."""
    if isinstance(lote.columns, pd.MultiIndex):
        return lote[tk] if tk in lote.columns.get_level_values(0) else None
    return lote


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
            df = _do_lote(lote, tk)
            # candle sem fechamento fica (a validação descarta e registra o motivo); só some a linha vazia
            if df is not None and "Close" in df and df["Close"].notna().any():
                dados[tk] = _normalizar(df.dropna(how="all", subset=["Open", "High", "Low", "Close"]))
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


def _nasdaq_hoje(ticker: str) -> dict | None:
    """Máxima/mínima do pregão mais recente e o fechamento anterior (para saber qual pregão é)."""
    simbolo = ticker.replace("-", ".")
    r = requests.get(f"https://api.nasdaq.com/api/quote/{simbolo}/summary?assetclass=stocks",
                     headers=HEADERS_NASDAQ, timeout=15)
    r.raise_for_status()
    dados = ((r.json().get("data") or {}).get("summaryData") or {})
    faixa = (dados.get("TodayHighLow") or {}).get("value", "")
    anterior = (dados.get("PreviousClose") or {}).get("value", "")
    num = lambda x: float(x.replace("$", "").replace(",", ""))
    try:
        alta, baixa = (num(x) for x in faixa.split("/"))
        return {"high": alta, "low": baixa, "fechamento_anterior": num(anterior)}
    except ValueError:
        return None


def _coinbase(simbolo: str) -> dict[str, float]:
    """Fechamentos diários (UTC) do par SIMBOLO-USD na Coinbase."""
    r = requests.get(f"https://api.exchange.coinbase.com/products/{simbolo}-USD/candles",
                     params={"granularity": 86400}, timeout=15)
    r.raise_for_status()
    # cada candle: [início (s), mínima, máxima, abertura, fechamento, volume]
    return {pd.Timestamp(c[0], unit="s").strftime("%Y-%m-%d"): float(c[4]) for c in r.json()[:15]}


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


def b3_cotahist(pregoes: int = 6) -> dict[str, dict[str, float]]:
    """Fechamentos oficiais da B3 dos últimos pregões publicados: {PAPEL: {data: fechamento}}."""
    out: dict[str, dict[str, float]] = {}
    achados, dia = 0, date.today()
    for _ in range(14):
        if achados >= pregoes:
            break
        if dia.weekday() < 5:
            url = f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{dia:%d%m%Y}.ZIP"
            try:
                r = requests.get(url, timeout=60)
                if r.ok and r.content[:2] == b"PK":
                    z = zipfile.ZipFile(io.BytesIO(r.content))
                    for l in z.read(z.namelist()[0]).decode("latin1").splitlines():
                        # registro 01, lote padrão (BDI 02), mercado à vista (010)
                        if l[:2] == "01" and l[10:12] == "02" and l[24:27] == "010":
                            data = f"{l[2:6]}-{l[6:8]}-{l[8:10]}"
                            out.setdefault(l[12:24].strip(), {})[data] = int(l[108:121]) / 100
                    achados += 1
            except Exception:
                pass
        dia -= timedelta(days=1)
    return out


def _b3_hoje(ticker: str) -> dict | None:
    """Abertura, máxima e mínima do pregão corrente direto da B3."""
    simbolo = ticker.removesuffix(".SA")
    r = requests.get(f"https://cotacao.b3.com.br/mds/api/v1/instrumentQuotation/{simbolo}", timeout=15)
    r.raise_for_status()
    j = r.json()
    q = (((j.get("Trad") or [{}])[0].get("scty") or {}).get("SctyQtn")) or {}
    data = (j.get("Msg") or {}).get("dtTm", "")[:10]
    if not q.get("maxPric") or not data:
        return None
    return {"data": data, "open": q.get("opngPric"), "high": q["maxPric"], "low": q["minPric"]}


def referencias(ativos: list[dict]) -> dict[str, dict]:
    """Referências por ticker: {"fonte", "fechamentos": {data: close}, "hoje": {...} | None}."""
    token = os.environ.get("BRAPI_TOKEN", "").strip()
    tem_br = any(a["mercado"] == "BR" for a in ativos)
    cotahist = b3_cotahist() if tem_br else {}
    print(f"  COTAHIST da B3: {len({d for v in cotahist.values() for d in v})} pregões, {len(cotahist)} papéis")

    def rodar(a):
        tk = a["ticker"]
        for i in range(3):
            try:
                if a["mercado"] == "US":
                    return tk, {"fonte": "Nasdaq", "fechamentos": _nasdaq(tk), "hoje": _nasdaq_hoje(tk)}
                if a["mercado"] == "BR":
                    fech = dict(cotahist.get(tk.removesuffix(".SA"), {}))
                    fonte = "B3"
                    if token:
                        fech.update(_brapi(tk, token))
                        fonte = "B3 + brapi"
                    return tk, {"fonte": fonte, "fechamentos": fech, "hoje": _b3_hoje(tk)}
                if a["mercado"] == "CRIPTO" and a.get("simbolo"):
                    return tk, {"fonte": "Coinbase", "fechamentos": _coinbase(a["simbolo"]), "hoje": None}
                return tk, None
            except Exception:
                time.sleep(1 + i)
        return tk, None

    refs = {}
    with ThreadPoolExecutor(6) as ex:
        for tk, ref in ex.map(rodar, ativos):
            if ref and (ref["fechamentos"] or ref["hoje"]):
                refs[tk] = ref
    return refs


def baixar_yahoo_60min(tickers: list[str], fuso: str) -> dict[str, pd.DataFrame]:
    """Candles de 60 minutos dos últimos 6 meses, no horário local da bolsa."""
    if not tickers:
        return {}
    dados = {}
    for i in range(3):
        pendentes = [t for t in tickers if t not in dados]
        if not pendentes:
            break
        lote = yf.download(pendentes, period="6mo", interval="60m", group_by="ticker",
                           auto_adjust=False, actions=False, threads=True, progress=False)
        for tk in pendentes:
            df = _do_lote(lote, tk)
            if df is not None and "Close" in df and not (df := df.dropna(subset=["Close"])).empty:
                df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
                df.index = pd.DatetimeIndex(df.index).tz_convert(fuso).tz_localize(None)
                dados[tk] = df[~df.index.duplicated(keep="last")].sort_index()
        time.sleep(3 * (i + 1))
    return dados
