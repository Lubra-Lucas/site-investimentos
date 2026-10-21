"""Foto dos indicadores de cada ativo para o rastreador da Multitela.

O rastreador roda no navegador, com regras que o usuário monta (fechamento acima da MME 9,
IFR abaixo de 30, pullback na MMS 20...). Para isso o site precisa dos indicadores já
calculados, no diário e no semanal, sempre com candles FECHADOS: o pregão em andamento fica
de fora, e no semanal só entram semanas completas (o sinal da semana sai depois de sexta).

Para o usuário escolher "aconteceu no último pregão" ou "nos últimos N", as regras são
avaliadas em cada um dos PERIODOS últimos candles. Por isso:
  - preço, médias e osciladores trazem os ULTIMOS valores (do mais antigo para o mais recente),
    o bastante para olhar 2 candles antes e a inclinação de 5 candles em qualquer um deles;
  - o que é um número por candle (volume relativo, variação, máximas anteriores, percentil da
    Bollinger) vem como lista dos PERIODOS últimos candles.
"""

from __future__ import annotations

import math

import pandas as pd

from estrategias import BB_DESVIOS, BB_JANELA_COMPRESSAO, BB_PERIODO, estocastico_lento, ifr, reamostrar

PERIODOS_MM = [5, 9, 10, 20, 21, 25, 50, 100, 200]
PERIODOS_IFR = [2, 9, 14]
PERIODOS = 5          # o rastreador olha até 5 candles para trás
ULTIMOS = PERIODOS + 5
# janelas em candles: variação e máximas/mínimas anteriores
JANELAS = {
    "D": {"var": [1, 5, 21, 63, 126, 252], "ext": [10, 20, 55, 252]},
    "W": {"var": [1, 4, 13, 26, 52], "ext": [4, 10, 26, 52]},
}
# janela para o "normal" da distância às médias: ~1 ano
JANELA_NORMAL = {"D": 252, "W": 52}
DIST_NORMAL_MM = [9, 20, 50, 200]


def _r(v, casas: int):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), casas)


def _serie(s: pd.Series, casas: int) -> list:
    return [_r(x, casas) for x in s.iloc[-ULTIMOS:]]


def _por_candle(s: pd.Series, casas: int) -> list:
    """Um valor por candle, nos PERIODOS últimos."""
    return [_r(x, casas) for x in s.iloc[-PERIODOS:]]


def _sequencia(cond: pd.Series) -> int:
    """Quantos candles seguidos, até o último, a condição é verdadeira."""
    n = 0
    for v in reversed(cond.to_numpy()):
        if not v:
            break
        n += 1
    return n


def foto(f: pd.DataFrame, tf: str, casas: int | None = None) -> dict | None:
    if len(f) < 30:
        return None
    casas = casas if casas is not None else 2 if f["Close"].min() >= 1 else 6
    c, h, l = f["Close"], f["High"], f["Low"]
    out: dict = {
        "d": f.index[-1].strftime("%Y-%m-%d"),
        "datas": [d.strftime("%Y-%m-%d") for d in f.index[-PERIODOS:]],
        "o": _serie(f["Open"], casas), "h": _serie(h, casas), "l": _serie(l, casas), "c": _serie(c, casas),
    }
    vol = f["Volume"].fillna(0)
    media_vol = vol.shift(1).rolling(20).mean()
    out["vr"] = _por_candle((vol / media_vol.where(media_vol > 0)), 2)

    sma = {n: c.rolling(n).mean() for n in PERIODOS_MM}
    ema = {n: c.ewm(span=n, adjust=False, min_periods=n).mean() for n in PERIODOS_MM}
    out["sma"] = {n: _serie(s, casas) for n, s in sma.items() if not math.isnan(s.iloc[-1])}
    out["ema"] = {n: _serie(s, casas) for n, s in ema.items() if not math.isnan(s.iloc[-1])}

    out["ifr"] = {n: _serie(ifr(c, n), 1) for n in PERIODOS_IFR}
    k, d = estocastico_lento(f)
    out["k"], out["kd"] = _serie(k, 1), _serie(d, 1)

    media = c.rolling(BB_PERIODO).mean()
    desvio = c.rolling(BB_PERIODO).std(ddof=0)
    sup, inf = media + BB_DESVIOS * desvio, media - BB_DESVIOS * desvio
    larg = (sup - inf) / media
    out["bbs"], out["bbi"] = _serie(sup, casas), _serie(inf, casas)
    out["bbl"] = _por_candle(larg * 100, 2)
    # percentil da largura de cada candle nos 120 anteriores a ele (0 = a mais estreita)
    pctl = larg.rolling(BB_JANELA_COMPRESSAO, min_periods=60).apply(lambda x: (x[:-1] < x[-1]).mean() * 100, raw=True)
    out["bbp"] = _por_candle(pctl, 0)

    # distância "normal" do fechamento a cada média: média da distância absoluta em ~1 ano
    out["dn"] = {}
    for n in DIST_NORMAL_MM:
        dist = (c / sma[n] - 1).abs().iloc[-JANELA_NORMAL[tf]:].dropna()
        if len(dist) >= 20:
            out["dn"][n] = _r(dist.mean() * 100, 2)

    out["var"] = {n: _por_candle((c / c.shift(n) - 1) * 100, 2) for n in JANELAS[tf]["var"] if len(c) > n + PERIODOS}
    # máxima/mínima dos N candles ANTERIORES a cada candle (rompimento = fechar além delas)
    out["max"] = {n: _por_candle(h.shift(1).rolling(n).max(), casas) for n in JANELAS[tf]["ext"] if len(h) > n + PERIODOS}
    out["min"] = {n: _por_candle(l.shift(1).rolling(n).min(), casas) for n in JANELAS[tf]["ext"] if len(l) > n + PERIODOS}

    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    out["atr"] = _r(tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1] / c.iloc[-1] * 100, 2)

    # há quanto tempo está em alta/baixa pela regra padrão (fechamento x MMS 20 e MMS 50)
    alta = (c > sma[20]) & (c > sma[50])
    baixa = (c < sma[20]) & (c < sma[50])
    for chave, cond in (("alta", alta), ("baixa", baixa)):
        n = _sequencia(cond)
        if n:
            out[chave] = {"n": n, "desde": f.index[-n].strftime("%Y-%m-%d")}
    return out


def fotos(df: pd.DataFrame, mercado: str, casas: int | None = None) -> dict:
    """Diário e semanal. No semanal só entram semanas completas: a semana em andamento só vira
    candle depois do último pregão dela (sexta; domingo em cripto) ou quando ela já passou."""
    cripto = mercado == "CRIPTO"
    semanal = reamostrar(df, "W-SUN" if cripto else "W-FRI")
    fim_semana = semanal.index[-1]  # o rótulo do resample é o último dia da semana
    if df.index[-1] < fim_semana and pd.Timestamp.today().normalize() <= fim_semana:
        semanal = semanal.iloc[:-1]
    semanal.index = semanal.index - pd.Timedelta(days=6 if cripto else 4)  # semana pela segunda-feira
    return {tf: x for tf, x in (("D", foto(df, "D", casas)), ("W", foto(semanal, "W", casas))) if x}
