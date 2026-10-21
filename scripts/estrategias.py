"""Indicadores básicos e o ESTADO de cada ativo (a foto de hoje, para os filtros e o card).

Os sinais (setups) não estão mais aqui: o catálogo único (config/setups.json) é avaliado em
scripts/setups.py, que usa estes indicadores (IFR de Wilder, estocástico lento, Bollinger,
ATR, reamostragem semanal, 60 min -> 4 horas).

Estados:
  tendência forte  preço acima (abaixo) das duas médias no diário E no semanal.
  compressão       largura da Bollinger entre as 10% menores dos últimos 120 candles.
"""

from __future__ import annotations

import math

import pandas as pd

MM_RAPIDA, MM_LENTA, MM_LONGA = 20, 50, 200
IFR_PERIODO = 14
ESTOC_K, ESTOC_SUAVE, ESTOC_D = 14, 3, 3
ESTOC_SOBREVENDIDO, ESTOC_SOBRECOMPRADO = 20, 80
IFR_60_COMPRA, IFR_60_VENDA = 30, 70   # exaustão do multitempo (setups.multitempo)
BB_PERIODO, BB_DESVIOS = 20, 2.0
BB_JANELA_COMPRESSAO, BB_PERCENTIL_COMPRESSAO = 120, 0.10
ATR_PERIODO = 14

# volume financeiro médio de 20 dias para o ativo aparecer nas listas (índices, moedas e commodities não têm)
LIQUIDEZ_MINIMA = {"BR": 1e6, "US": 20e6, "CRIPTO": 5e6, "MACRO": 0}


# ------------------------------------------------------------- indicadores

def ifr(close: pd.Series, n: int = IFR_PERIODO) -> pd.Series:
    """IFR de Wilder."""
    delta = close.diff()
    ganho = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    perda = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + ganho / perda)


def estocastico_lento(f: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    minima = f["Low"].rolling(ESTOC_K).min()
    maxima = f["High"].rolling(ESTOC_K).max()
    rapido = 100 * (f["Close"] - minima) / (maxima - minima)
    k = rapido.rolling(ESTOC_SUAVE).mean()
    return k, k.rolling(ESTOC_D).mean()


def reamostrar(df: pd.DataFrame, regra: str) -> pd.DataFrame:
    return df.resample(regra).agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}
    ).dropna(subset=["Close"])


def para_4h(h: pd.DataFrame) -> pd.DataFrame:
    """60 min -> 4 horas, em blocos de 4h contados a partir do primeiro candle de cada dia
    (a mesma regra do gráfico no site)."""
    dia = h.index.normalize()
    inicio = pd.Series(h.index, index=h.index).groupby(dia).transform("min")
    bloco = ((h.index - inicio) // pd.Timedelta(hours=4)).astype(int)
    chave = inicio + pd.to_timedelta(bloco * 4, unit="h")
    return h.groupby(chave.to_numpy()).agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"})


def _compressao(f: pd.DataFrame) -> dict:
    """Estado da Bollinger no último candle de um tempo gráfico."""
    u = f.iloc[-1]
    return {"comprimida": bool(u["BBcomprimida"]), "largura_pct": _num(u["BBlarg"] * 100),
            "desde": _desde(f["BBcomprimida"])}


def indicadores(df: pd.DataFrame) -> pd.DataFrame:
    f = df.copy()
    for n in (MM_RAPIDA, MM_LENTA, MM_LONGA):
        f[f"MM{n}"] = f["Close"].rolling(n).mean()
    f["IFR"] = ifr(f["Close"])
    anterior = f["Close"].shift(1)
    tr = pd.concat([f["High"] - f["Low"], (f["High"] - anterior).abs(), (f["Low"] - anterior).abs()], axis=1).max(axis=1)
    f["ATR"] = tr.ewm(alpha=1 / ATR_PERIODO, adjust=False, min_periods=ATR_PERIODO).mean()
    f["EstK"], f["EstD"] = estocastico_lento(f)
    media = f["Close"].rolling(BB_PERIODO).mean()
    desvio = f["Close"].rolling(BB_PERIODO).std(ddof=0)
    f["BBsup"], f["BBinf"] = media + BB_DESVIOS * desvio, media - BB_DESVIOS * desvio
    f["BBlarg"] = (f["BBsup"] - f["BBinf"]) / media
    f["BBcomprimida"] = f["BBlarg"] <= f["BBlarg"].rolling(BB_JANELA_COMPRESSAO, min_periods=60).quantile(
        BB_PERCENTIL_COMPRESSAO)
    return f


def _tendencia(f: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    alta = (f["Close"] > f[f"MM{MM_RAPIDA}"]) & (f["Close"] > f[f"MM{MM_LENTA}"])
    baixa = (f["Close"] < f[f"MM{MM_RAPIDA}"]) & (f["Close"] < f[f"MM{MM_LENTA}"])
    return alta, baixa


def _inicio(cond: pd.Series) -> pd.Series:
    """True só no primeiro candle de cada sequência em que a condição vale."""
    cond = cond.fillna(False).astype(bool)
    return cond & ~cond.shift(1, fill_value=False)


def _exaustao(f: pd.DataFrame, lado: str) -> pd.Series:
    if lado == "compra":
        return (f["EstK"] < ESTOC_SOBREVENDIDO) | (f["IFR"] < IFR_60_COMPRA)
    return (f["EstK"] > ESTOC_SOBRECOMPRADO) | (f["IFR"] > IFR_60_VENDA)


# ------------------------------------------------------------- utilidades

def _num(v, casas=2):
    if v is None or pd.isna(v) or (isinstance(v, float) and math.isinf(v)):
        return None
    return round(float(v), casas)


def _var(close: pd.Series, desde: pd.Timestamp):
    base = close[close.index < desde]
    return None if base.empty else _num((close.iloc[-1] / base.iloc[-1] - 1) * 100)


def _sequencia(serie: pd.Series) -> int:
    """Quantos candles seguidos, até o último, a condição vale."""
    serie = serie.fillna(False).astype(bool)
    falsos = serie[~serie]
    return int(len(serie) if falsos.empty else (serie.index > falsos.index[-1]).sum())


def _desde(serie: pd.Series) -> str | None:
    """Data em que começou a sequência atual de True."""
    serie = serie.fillna(False).astype(bool)
    if serie.empty or not serie.iloc[-1]:
        return None
    falsos = serie[~serie]
    inicio = serie.index[0] if falsos.empty else serie.index[serie.index > falsos.index[-1]][0]
    return inicio.strftime("%Y-%m-%d")


# ------------------------------------------------------------- análise

def analisar(df: pd.DataFrame, mercado: str, df60: pd.DataFrame | None = None) -> dict:
    """Estado atual do ativo (tendência, IFR, compressão, liquidez...).

    df60 já vem verificado contra o diário (validacao.limpar_intraday)."""
    d = indicadores(df)
    # cripto negocia todo dia: a semana vai até domingo
    cripto = mercado == "CRIPTO"
    s = indicadores(reamostrar(df, "W-SUN" if cripto else "W-FRI"))
    m = indicadores(reamostrar(df, "MS"))
    s.index = s.index - pd.Timedelta(days=6 if cripto else 4)  # semana identificada pela segunda-feira

    alta_d, baixa_d = _tendencia(d)
    alta_s, baixa_s = _tendencia(s)

    u = d.iloc[-1]
    vol_fin = (df["Volume"] if mercado == "CRIPTO" else df["Close"] * df["Volume"]).tail(20).mean()
    liquido = bool(vol_fin >= LIQUIDEZ_MINIMA.get(mercado, 0))
    forte = "alta" if (alta_d.iloc[-1] and alta_s.iloc[-1]) else "baixa" if (baixa_d.iloc[-1] and baixa_s.iloc[-1]) else None

    h = indicadores(df60) if df60 is not None and len(df60) >= 60 else None
    # o estado "agora" do 60 min só vale se o intraday tiver o mesmo pregão do diário
    h_atual = h is not None and h.index[-1].normalize() == d.index[-1]
    estado = {
        "ultimo": _num(u["Close"], 6),
        "data": d.index[-1].strftime("%Y-%m-%d"),
        "var_dia_pct": _num((u["Close"] / d["Close"].iloc[-2] - 1) * 100),
        "var_mes_pct": _var(d["Close"], d.index[-1].replace(day=1)),
        "var_ano_pct": _var(d["Close"], d.index[-1].replace(month=1, day=1)),
        # variação no "mês" de cada sinal: 21 pregões (diário) e 13 semanas (semanal)
        "var_21_pct": _num((u["Close"] / d["Close"].iloc[-22] - 1) * 100) if len(d) > 22 else None,
        "var_13s_pct": _num((s["Close"].iloc[-1] / s["Close"].iloc[-14] - 1) * 100) if len(s) > 14 else None,
        "ifr_d": _num(u["IFR"], 1), "ifr_s": _num(s["IFR"].iloc[-1], 1), "ifr_m": _num(m["IFR"].iloc[-1], 1),
        "estoc_d": _num(u["EstK"], 1),
        "ifr_60": _num(h["IFR"].iloc[-1], 1) if h_atual else None,
        "estoc_60": _num(h["EstK"].iloc[-1], 1) if h_atual else None,
        "tend_d": "alta" if alta_d.iloc[-1] else "baixa" if baixa_d.iloc[-1] else "lateral",
        "tend_s": "alta" if alta_s.iloc[-1] else "baixa" if baixa_s.iloc[-1] else "lateral",
        "tendencia_forte": forte,
        "tendencia_desde": _desde(alta_d if forte == "alta" else baixa_d) if forte else None,
        "tendencia_pregoes": _sequencia(alta_d if forte == "alta" else baixa_d) if forte else 0,
        "bb_largura_pct": _num(u["BBlarg"] * 100),
        "bb_comprimida": bool(u["BBcomprimida"]),
        "bb_comprimida_desde": _desde(d["BBcomprimida"]),
        # compressão por tempo gráfico, para os filtros acompanharem o gráfico escolhido
        "bb_tf": {"D": _compressao(d), "W": _compressao(s),
                  **({"60": _compressao(h), "240": _compressao(indicadores(para_4h(df60)))} if h_atual else {})},
        "dist_mm20_pct": _num((u["Close"] / u[f"MM{MM_RAPIDA}"] - 1) * 100),
        "dist_mm50_pct": _num((u["Close"] / u[f"MM{MM_LENTA}"] - 1) * 100),
        "dist_mm200_pct": _num((u["Close"] / u[f"MM{MM_LONGA}"] - 1) * 100),
        "dist_max52_pct": _num((u["Close"] / d["High"].tail(252).max() - 1) * 100),
        "volume_financeiro_20d": _num(vol_fin, 0),
        "liquido": liquido,
        "intraday_ok": bool(h_atual),
    }
    return estado
