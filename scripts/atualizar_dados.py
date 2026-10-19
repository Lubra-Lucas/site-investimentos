"""Baixa os candles diários de todos os ativos, calcula indicadores, gera os
sinais de oportunidade e consolida a carteira em BRL.

Saída (lida pelo front-end estático):
  data/ativos/<TICKER>.json  -> candles OHLCV diários para o gráfico
  data/resumo.json           -> visão geral: carteira, posições, sinais

Uso:  python scripts/atualizar_dados.py
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "config" / "carteira.json"
SAIDA = RAIZ / "data"
SAIDA_ATIVOS = SAIDA / "ativos"

PERIODO = "3y"          # histórico baixado para o gráfico e as médias longas
TICKER_CAMBIO = "USDBRL=X"

# Liquidez mínima (volume financeiro médio de 20 dias) para um sinal de compra
# ser considerado. Evita sugerir papéis com pouco negócio.
LIQUIDEZ_MINIMA = {"BR": 20e6, "US": 100e6, "CRIPTO": 100e6}


# ---------------------------------------------------------------- indicadores

def rsi(close: pd.Series, periodo: int = 14) -> pd.Series:
    """IFR de Wilder."""
    delta = close.diff()
    ganho = delta.clip(lower=0).ewm(alpha=1 / periodo, adjust=False, min_periods=periodo).mean()
    perda = (-delta.clip(upper=0)).ewm(alpha=1 / periodo, adjust=False, min_periods=periodo).mean()
    rs = ganho / perda
    return 100 - 100 / (1 + rs)


def semanal(df: pd.DataFrame) -> pd.DataFrame:
    return df.resample("W-FRI").agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}
    ).dropna()


def calcular_indicadores(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["MM20"] = df["Close"].rolling(20).mean()
    df["MM50"] = df["Close"].rolling(50).mean()
    df["MM200"] = df["Close"].rolling(200).mean()
    df["IFR"] = rsi(df["Close"])
    df["VolMedio20"] = df["Volume"].rolling(20).mean()
    return df


# --------------------------------------------------------------------- sinais

def gerar_sinais(df: pd.DataFrame, df_sem: pd.DataFrame, mercado: str) -> dict:
    """Pontua o ativo como possível ponto de entrada de longo prazo.

    Cada regra soma pontos; quanto maior o score, mais confluência de sinais.
    Não é recomendação de investimento - é um filtro para chamar a atenção.
    """
    u = df.iloc[-1]
    ant = df.iloc[-2]
    ifr_sem = df_sem["IFR"].iloc[-1] if len(df_sem) else float("nan")
    sinais: list[dict] = []
    alertas: list[dict] = []

    def add(lista, pontos, texto, tipo):
        lista.append({"pontos": pontos, "texto": texto, "tipo": tipo})

    # IFR
    if u["IFR"] < 30:
        add(sinais, 2, f"IFR diário sobrevendido ({u['IFR']:.0f})", "ifr")
    elif u["IFR"] < 40:
        add(sinais, 1, f"IFR diário baixo ({u['IFR']:.0f})", "ifr")
    if ifr_sem < 30:
        add(sinais, 3, f"IFR semanal sobrevendido ({ifr_sem:.0f})", "ifr")
    elif ifr_sem < 40:
        add(sinais, 1, f"IFR semanal baixo ({ifr_sem:.0f})", "ifr")
    if u["IFR"] > 70:
        add(alertas, 0, f"IFR diário sobrecomprado ({u['IFR']:.0f})", "ifr")
    if ifr_sem > 70:
        add(alertas, 0, f"IFR semanal sobrecomprado ({ifr_sem:.0f})", "ifr")

    # Tendência e médias
    if not math.isnan(u["MM200"]):
        if u["Close"] > u["MM200"]:
            add(sinais, 1, "Preço acima da MM200 (tendência primária de alta)", "tendencia")
            dist = (u["Close"] / u["MM200"] - 1) * 100
            if dist < 3:
                add(sinais, 2, f"Pullback na MM200 ({dist:.1f}% acima)", "media")
        if not math.isnan(u["MM50"]):
            cruz = (df["MM50"] > df["MM200"]).astype(int).diff().tail(10)
            if (cruz == 1).any():
                add(sinais, 2, "Cruzamento dourado recente (MM50 > MM200)", "media")
            if (cruz == -1).any():
                add(alertas, 0, "Cruzamento da morte recente (MM50 < MM200)", "media")
    if not math.isnan(u["MM50"]) and u["Close"] > u["MM50"] and abs(u["Close"] / u["MM50"] - 1) < 0.02:
        add(sinais, 1, "Preço testando a MM50", "media")

    # Volume
    if u["VolMedio20"] and u["Volume"] > 1.5 * u["VolMedio20"] and u["Close"] > ant["Close"]:
        add(sinais, 1, f"Alta com volume {u['Volume'] / u['VolMedio20']:.1f}x a média", "volume")

    # Distância da máxima de 52 semanas
    max52 = df["High"].tail(252).max()
    queda = (u["Close"] / max52 - 1) * 100
    if queda < -30:
        add(sinais, 1, f"{queda:.0f}% abaixo da máxima de 52 semanas", "desconto")

    # No Yahoo, o volume de cripto já vem em USD; ações vêm em quantidade de papéis
    fin = df["Volume"] if mercado == "CRIPTO" else df["Close"] * df["Volume"]
    vol_fin = float(fin.tail(20).mean())
    liquido = vol_fin >= LIQUIDEZ_MINIMA.get(mercado, 0)
    score = sum(s["pontos"] for s in sinais)

    return {
        "score": score if liquido else 0,
        "liquido": liquido,
        "volume_financeiro_20d": vol_fin,
        "ifr_diario": _num(u["IFR"]),
        "ifr_semanal": _num(ifr_sem),
        "dist_max52": _num(queda),
        "sinais": sinais,
        "alertas": alertas,
    }


# ------------------------------------------------------------------- utilidades

def _num(v, casas: int = 4):
    if v is None or (isinstance(v, float) and math.isnan(v)) or pd.isna(v):
        return None
    return round(float(v), casas)


def baixar(ticker: str, tentativas: int = 4) -> pd.DataFrame:
    for i in range(tentativas):
        df = yf.Ticker(ticker).history(period=PERIODO, interval="1d", auto_adjust=True)
        if not df.empty:
            break
        time.sleep(2 ** (i + 1))  # Yahoo às vezes responde 429; espera e tenta de novo
    else:
        raise RuntimeError(f"sem dados para {ticker}")
    df.index = df.index.tz_localize(None).normalize()
    df = df[~df.index.duplicated(keep="last")]
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])


def variacao(close: pd.Series, desde: pd.Timestamp) -> float | None:
    base = close[close.index < desde]
    if base.empty:
        return None
    return _num((close.iloc[-1] / base.iloc[-1] - 1) * 100, 2)


# ------------------------------------------------------------------- carteira

def consolidar_carteira(cfg: dict, precos: dict[str, pd.DataFrame], cambio: pd.Series) -> dict:
    moedas = {a["ticker"]: a["moeda"] for a in cfg["ativos"]}
    mercados = {a["ticker"]: a["mercado"] for a in cfg["ativos"]}

    def taxa(moeda: str, data: pd.Timestamp) -> float:
        if moeda == "BRL":
            return 1.0
        return float(cambio[cambio.index <= data].iloc[-1]) if (cambio.index <= data).any() else float(cambio.iloc[0])

    transacoes = sorted(cfg.get("transacoes", []), key=lambda t: t["data"])
    caixa = float(cfg.get("capital_inicial", 0))
    posicoes: dict[str, dict] = {}
    for t in transacoes:
        tk = t["ticker"]
        data = pd.Timestamp(t["data"])
        fx = float(t.get("cambio") or taxa(moedas.get(tk, "BRL"), data))
        qtd = float(t["quantidade"])
        bruto = qtd * float(t["preco"])
        taxas = float(t.get("taxas", 0))
        p = posicoes.setdefault(tk, {"quantidade": 0.0, "custo_brl": 0.0, "custo_moeda": 0.0})
        if t.get("tipo", "compra") == "compra":
            p["quantidade"] += qtd
            p["custo_brl"] += bruto * fx + taxas
            p["custo_moeda"] += bruto
            caixa -= bruto * fx + taxas
        else:  # venda: baixa o custo pelo preço médio
            frac = qtd / p["quantidade"] if p["quantidade"] else 0
            p["custo_brl"] -= p["custo_brl"] * frac
            p["custo_moeda"] -= p["custo_moeda"] * frac
            p["quantidade"] -= qtd
            caixa += bruto * fx - taxas

    hoje = pd.Timestamp.today().normalize()
    inicio_mes = hoje.replace(day=1)
    inicio_ano = hoje.replace(month=1, day=1)
    fx_hoje = float(cambio.iloc[-1])

    linhas = []
    total_mercado = 0.0
    for tk, p in posicoes.items():
        if p["quantidade"] <= 1e-12 or tk not in precos:
            continue
        close = precos[tk]["Close"]
        moeda = moedas.get(tk, "BRL")
        fx = 1.0 if moeda == "BRL" else fx_hoje
        valor = p["quantidade"] * float(close.iloc[-1]) * fx
        total_mercado += valor
        linhas.append({
            "ticker": tk,
            "mercado": mercados.get(tk),
            "moeda": moeda,
            "quantidade": _num(p["quantidade"], 8),
            "preco_medio": _num(p["custo_moeda"] / p["quantidade"], 4),
            "preco_atual": _num(close.iloc[-1], 4),
            "custo_brl": _num(p["custo_brl"], 2),
            "valor_brl": _num(valor, 2),
            "resultado_brl": _num(valor - p["custo_brl"], 2),
            "resultado_pct": _num((valor / p["custo_brl"] - 1) * 100, 2) if p["custo_brl"] else None,
            "var_mes_pct": variacao(close, inicio_mes),
            "var_ano_pct": variacao(close, inicio_ano),
        })
    for linha in linhas:
        linha["peso_pct"] = _num(linha["valor_brl"] / total_mercado * 100, 2) if total_mercado else 0

    patrimonio = total_mercado + caixa
    capital = float(cfg.get("capital_inicial", 0))
    alocacao: dict[str, float] = {}
    for linha in linhas:
        alocacao[linha["mercado"]] = alocacao.get(linha["mercado"], 0) + linha["valor_brl"]
    alocacao["CAIXA"] = caixa

    return {
        "capital_inicial": capital,
        "caixa_brl": _num(caixa, 2),
        "investido_brl": _num(total_mercado, 2),
        "patrimonio_brl": _num(patrimonio, 2),
        "resultado_brl": _num(patrimonio - capital, 2),
        "resultado_pct": _num((patrimonio / capital - 1) * 100, 2) if capital else None,
        "alocacao_brl": {k: _num(v, 2) for k, v in alocacao.items()},
        "posicoes": sorted(linhas, key=lambda l: -l["valor_brl"]),
        "historico": historico_patrimonio(cfg, transacoes, precos, cambio, moedas),
    }


def historico_patrimonio(cfg, transacoes, precos, cambio, moedas) -> list[dict]:
    """Patrimônio diário (BRL) desde a primeira transação, para a curva da carteira."""
    if not transacoes:
        return []
    inicio = pd.Timestamp(transacoes[0]["data"])
    dias = pd.bdate_range(inicio, pd.Timestamp.today().normalize())
    fx = cambio.reindex(dias, method="ffill").bfill()
    caixa = pd.Series(float(cfg.get("capital_inicial", 0)), index=dias)
    valor = pd.Series(0.0, index=dias)
    for tk in {t["ticker"] for t in transacoes}:
        if tk not in precos:
            continue
        qtd = pd.Series(0.0, index=dias)
        for t in transacoes:
            if t["ticker"] != tk:
                continue
            sinal = 1 if t.get("tipo", "compra") == "compra" else -1
            data = pd.Timestamp(t["data"])
            q = float(t["quantidade"])
            taxa_fx = float(t.get("cambio") or (1.0 if moedas.get(tk) == "BRL" else fx.asof(data)))
            qtd[qtd.index >= data] += sinal * q
            caixa[caixa.index >= data] -= sinal * q * float(t["preco"]) * taxa_fx + float(t.get("taxas", 0))
        close = precos[tk]["Close"].reindex(dias, method="ffill")
        mult = 1.0 if moedas.get(tk) == "BRL" else fx
        valor += (qtd * close * mult).fillna(0)
    total = valor + caixa
    return [{"time": d.strftime("%Y-%m-%d"), "value": _num(v, 2)} for d, v in total.items()]


# ----------------------------------------------------------------------- main

def main() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    SAIDA_ATIVOS.mkdir(parents=True, exist_ok=True)

    tickers = {a["ticker"]: a for a in cfg["ativos"]}
    for t in cfg.get("transacoes", []):
        if t["ticker"] not in tickers:
            raise SystemExit(f"{t['ticker']} está em transacoes mas não em ativos")

    cambio = baixar(TICKER_CAMBIO)["Close"]
    precos: dict[str, pd.DataFrame] = {}
    resumo_ativos = []
    erros = []

    for tk, meta in tickers.items():
        try:
            df = calcular_indicadores(baixar(tk))
        except Exception as e:  # um ativo com problema não derruba a atualização
            erros.append(f"{tk}: {e}")
            print(f"[ERRO] {tk}: {e}")
            continue
        precos[tk] = df
        df_sem = semanal(df)
        df_sem["IFR"] = rsi(df_sem["Close"])
        analise = gerar_sinais(df, df_sem, meta["mercado"])

        arquivo = tk.replace("=", "_")
        candles = [
            {"time": d.strftime("%Y-%m-%d"), "open": _num(r.Open), "high": _num(r.High),
             "low": _num(r.Low), "close": _num(r.Close), "volume": _num(r.Volume, 0)}
            for d, r in df.iterrows()
        ]
        (SAIDA_ATIVOS / f"{arquivo}.json").write_text(json.dumps({
            "ticker": tk, **meta,
            "candles": candles,
        }, separators=(",", ":")), encoding="utf-8")

        close = df["Close"]
        hoje = df.index[-1]
        resumo_ativos.append({
            "ticker": tk, "arquivo": arquivo, **meta,
            "ultimo": _num(close.iloc[-1]),
            "data": hoje.strftime("%Y-%m-%d"),
            "var_dia_pct": _num((close.iloc[-1] / close.iloc[-2] - 1) * 100, 2),
            "var_mes_pct": variacao(close, hoje.replace(day=1)),
            "var_ano_pct": variacao(close, hoje.replace(month=1, day=1)),
            **analise,
        })
        print(f"[ok] {tk:10s} {close.iloc[-1]:>12.2f}  score={analise['score']}")

    resumo = {
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "usdbrl": _num(cambio.iloc[-1]),
        "carteira": consolidar_carteira(cfg, precos, cambio),
        "ativos": sorted(resumo_ativos, key=lambda a: -a["score"]),
        "erros": erros,
    }
    (SAIDA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"resumo.json gravado ({len(resumo_ativos)} ativos, {len(erros)} erros)")


if __name__ == "__main__":
    main()
