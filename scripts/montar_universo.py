"""Monta config/universo.json: os ativos que o terminal acompanha.

- Brasil: ações à vista da B3 com volume financeiro médio de pelo menos R$ 1 milhão/dia nos
  últimos ~20 pregões (arquivo oficial COTAHIST), sem BDRs, fundos ou direitos.
- EUA: ações listadas (screener da Nasdaq) com valor de mercado de US$ 10 bilhões ou mais.
- Cripto: os pares em dólar mais negociados na Coinbase (sem stablecoins), cujo histórico no
  Yahoo bate com o preço da Coinbase (evita ticker do Yahoo que é de outro token).
- Macro: principais índices, moedas e commodities (lista fixa abaixo).

Todos precisam ter pelo menos ~1 ano de candles no Yahoo. Nomes já existentes no arquivo
são mantidos, e os ativos que já estavam na lista continuam (para nada sumir de quem acompanha). Roda à mão de vez em quando (não faz parte da atualização diária):

    python scripts/montar_universo.py
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVO = RAIZ / "config" / "universo.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
           "Accept": "application/json, text/plain, */*"}

VOLUME_MINIMO_BR = 1e6          # R$/dia
VALOR_MERCADO_MINIMO_US = 10e9  # US$
CRIPTOS = 70
ESTAVEIS = {"USDT", "USDC", "DAI", "PYUSD", "EURC", "GUSD", "USDS", "FDUSD", "TUSD", "USD1", "PAX", "WBTC", "CBETH",
            "WETH", "LSETH", "MSOL", "STETH", "RLUSD", "USDE", "GYEN", "XSGD", "AUDD"}

MACRO = [
    # índices (pontos)
    ("^BVSP", "IBOV", "Ibovespa", "PTS"), ("^GSPC", "SPX", "S&P 500", "PTS"), ("^NDX", "NDX", "Nasdaq 100", "PTS"),
    ("^IXIC", "NASDAQ", "Nasdaq Composite", "PTS"), ("^DJI", "DOW", "Dow Jones", "PTS"),
    ("^RUT", "RUT", "Russell 2000", "PTS"), ("^VIX", "VIX", "Volatilidade do S&P 500", "PTS"),
    ("^GDAXI", "DAX", "DAX (Alemanha)", "PTS"), ("^FTSE", "FTSE", "FTSE 100 (Reino Unido)", "PTS"),
    ("^STOXX50E", "STOXX50", "Euro Stoxx 50", "PTS"), ("^N225", "NIKKEI", "Nikkei 225 (Japão)", "PTS"),
    ("^HSI", "HSI", "Hang Seng (Hong Kong)", "PTS"),
    # moedas (cotação)
    ("EURUSD=X", "EURUSD", "Euro / Dólar", "FX"), ("GBPUSD=X", "GBPUSD", "Libra / Dólar", "FX"),
    ("USDJPY=X", "USDJPY", "Dólar / Iene", "FX"), ("AUDUSD=X", "AUDUSD", "Dólar australiano / Dólar", "FX"),
    ("USDCAD=X", "USDCAD", "Dólar / Dólar canadense", "FX"), ("USDCHF=X", "USDCHF", "Dólar / Franco suíço", "FX"),
    ("NZDUSD=X", "NZDUSD", "Dólar neozelandês / Dólar", "FX"), ("EURJPY=X", "EURJPY", "Euro / Iene", "FX"),
    ("GBPJPY=X", "GBPJPY", "Libra / Iene", "FX"), ("EURGBP=X", "EURGBP", "Euro / Libra", "FX"),
    ("USDMXN=X", "USDMXN", "Dólar / Peso mexicano", "FX"), ("USDBRL=X", "USDBRL", "Dólar / Real", "FX"),
    ("EURBRL=X", "EURBRL", "Euro / Real", "FX"), ("DX-Y.NYB", "DXY", "Índice do dólar (DXY)", "PTS"),
    # commodities (contrato futuro contínuo, em dólar)
    ("GC=F", "OURO", "Ouro", "USD"), ("SI=F", "PRATA", "Prata", "USD"), ("PL=F", "PLATINA", "Platina", "USD"),
    ("HG=F", "COBRE", "Cobre", "USD"), ("CL=F", "WTI", "Petróleo WTI", "USD"), ("BZ=F", "BRENT", "Petróleo Brent", "USD"),
    ("NG=F", "GASNAT", "Gás natural", "USD"), ("ZS=F", "SOJA", "Soja (Chicago)", "USD"), ("ZC=F", "MILHO", "Milho (Chicago)", "USD"),
    ("ZW=F", "TRIGO", "Trigo (Chicago)", "USD"), ("KC=F", "CAFE", "Café arábica (NY)", "USD"), ("SB=F", "ACUCAR", "Açúcar (NY)", "USD"),
    ("CT=F", "ALGODAO", "Algodão (NY)", "USD"), ("LE=F", "BOI", "Boi gordo (Chicago)", "USD"),
]


def historico_ok(tickers: list[str], minimo: int = 250) -> dict[str, float]:
    """Tickers com histórico suficiente no Yahoo -> último fechamento."""
    ok: dict[str, float] = {}
    for i in range(0, len(tickers), 200):
        lote = tickers[i:i + 200]
        d = yf.download(lote, period="2y", interval="1d", group_by="ticker", auto_adjust=False,
                        actions=False, threads=True, progress=False)
        for tk in lote:
            try:
                c = (d[tk] if isinstance(d.columns, pd.MultiIndex) else d)["Close"].dropna()
            except KeyError:
                continue
            if len(c) >= minimo:
                ok[tk] = float(c.iloc[-1])
    return ok


def cotahist(pregoes: int = 20) -> dict[str, dict]:
    """Volume financeiro médio e nome de cada ação à vista nos últimos pregões."""
    vol: dict[str, list[float]] = {}
    nomes: dict[str, str] = {}
    achados, dia = 0, date.today()
    while achados < pregoes and dia > date.today() - timedelta(days=45):
        if dia.weekday() < 5:
            r = requests.get(f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{dia:%d%m%Y}.ZIP", timeout=60)
            if r.ok and r.content[:2] == b"PK":
                z = zipfile.ZipFile(io.BytesIO(r.content))
                for l in z.read(z.namelist()[0]).decode("latin1").splitlines():
                    # lote padrão (BDI 02), mercado à vista (010); especificação de ação (ON/PN/UNT), sem BDR (DR*)
                    if l[:2] != "01" or l[10:12] != "02" or l[24:27] != "010":
                        continue
                    especi = l[39:49].strip()
                    if not especi.split()[0] in {"ON", "PN", "PNA", "PNB", "PNC", "PND", "UNT"}:
                        continue
                    papel = l[12:24].strip()
                    vol.setdefault(papel, []).append(int(l[170:188]) / 100)
                    nomes[papel] = l[27:39].strip()
                achados += 1
        dia -= timedelta(days=1)
    return {p: {"volume": sum(v) / achados, "nome": nomes[p]} for p, v in vol.items()}


def brasil(nomes_antigos: dict[str, str]) -> list[dict]:
    dados = cotahist()
    liquidos = sorted((p for p, d in dados.items() if d["volume"] >= VOLUME_MINIMO_BR), key=lambda p: -dados[p]["volume"])
    ok = historico_ok([f"{p}.SA" for p in liquidos])
    print(f"Brasil: {len(liquidos)} com R$ {VOLUME_MINIMO_BR / 1e6:.0f} mi/dia, {len(ok)} com histórico no Yahoo")
    return [{"ticker": f"{p}.SA", "nome": nomes_antigos.get(f"{p}.SA") or dados[p]["nome"].title()}
            for p in liquidos if f"{p}.SA" in ok]


def eua(nomes_antigos: dict[str, str]) -> list[dict]:
    r = requests.get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true",
                     headers=HEADERS, timeout=60)
    linhas = r.json()["data"]["rows"]
    grandes = []
    for x in linhas:
        try:
            cap = float(x["marketCap"] or 0)
        except ValueError:
            continue
        sym = x["symbol"].strip()
        # sem preferenciais, warrants, units e direitos
        if cap < VALOR_MERCADO_MINIMO_US or "^" in sym or any(t in x["name"] for t in ("Preferred", "Warrant", "Depositary Shares Each")):
            continue
        grandes.append((sym.replace("/", "-"), x["name"], cap))
    grandes.sort(key=lambda g: -g[2])
    ok = historico_ok([g[0] for g in grandes])
    print(f"EUA: {len(grandes)} com US$ {VALOR_MERCADO_MINIMO_US / 1e9:.0f} bi de valor de mercado, {len(ok)} com histórico")
    limpar = lambda n: (n.replace(" Common Stock", "").replace(" Class A", "").replace(" Ordinary Shares", "")
                        .replace(" American Depositary Shares", "").replace(" Inc.", "").replace(", Inc.", "")
                        .replace(" Corporation", "").replace(" Holdings", "").strip(" ,"))
    return [{"ticker": t, "nome": nomes_antigos.get(t) or limpar(n)} for t, n, _ in grandes if t in ok]


def cripto(antigos: dict[str, dict]) -> list[dict]:
    produtos = requests.get("https://api.exchange.coinbase.com/products", timeout=30).json()
    usd = [p for p in produtos if p["quote_currency"] == "USD" and p["status"] == "online" and p["base_currency"] not in ESTAVEIS]
    # volume em dólar de 24h por par
    volume = {}
    for p in usd:
        try:
            st = requests.get(f"https://api.exchange.coinbase.com/products/{p['id']}/stats", timeout=15).json()
            volume[p["base_currency"]] = float(st["volume"]) * float(st["last"])
        except Exception:
            pass
    candidatos = sorted(volume, key=lambda b: -volume[b])[:CRIPTOS * 2]
    # o ticker do Yahoo pode ser de outro token com a mesma sigla: o preço tem que bater com a Coinbase
    precos_cb = {}
    for b in candidatos:
        try:
            precos_cb[b] = float(requests.get(f"https://api.exchange.coinbase.com/products/{b}-USD/ticker", timeout=15).json()["price"])
        except Exception:
            pass
    yahoo = {b: antigos.get(b, {}).get("ticker") or f"{b}-USD" for b in candidatos}
    ok = historico_ok(list(yahoo.values()), minimo=300)
    out = []
    for b in candidatos:
        tk = yahoo[b]
        if tk in ok and b in precos_cb and abs(ok[tk] / precos_cb[b] - 1) < 0.1:
            out.append({"ticker": tk, "nome": antigos.get(b, {}).get("nome") or b, "simbolo": b})
        if len(out) >= CRIPTOS:
            break
    print(f"Cripto: {len(out)} pares (preço do Yahoo conferido com a Coinbase)")
    return out


def macro() -> list[dict]:
    ok = historico_ok([m[0] for m in MACRO])
    faltam = [m[0] for m in MACRO if m[0] not in ok]
    if faltam:
        print(f"Macro sem histórico: {faltam}")
    return [{"ticker": t, "simbolo": s, "nome": n, "moeda": m} for t, s, n, m in MACRO if t in ok]


def main() -> None:
    atual = json.loads(ARQUIVO.read_text(encoding="utf-8")) if ARQUIVO.exists() else {}
    nomes = {a["ticker"]: a["nome"] for m in ("BR", "US") for a in atual.get(m, [])}
    criptos = {a.get("simbolo") or a["ticker"].removesuffix("-USD"): a for a in atual.get("CRIPTO", [])}
    novo = {"BR": brasil(nomes), "US": eua(nomes), "CRIPTO": cripto(criptos), "MACRO": macro()}
    for m, lista in novo.items():
        presentes = {a["ticker"] for a in lista}
        lista += [a for a in atual.get(m, []) if a["ticker"] not in presentes]
    ARQUIVO.write_text(json.dumps(novo, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print({k: len(v) for k, v in novo.items()})


if __name__ == "__main__":
    main()
