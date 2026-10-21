"""Foto dos indicadores de cada ativo para as regras personalizadas do site (assets/js/rastreador.js).

As regras do usuário (fechamento acima da MME 9, IFR abaixo de 30, pullback na MMS 20...) rodam
no navegador. Para isso o site precisa dos indicadores já calculados, no diário e no semanal,
sempre com candles FECHADOS: o pregão em andamento fica de fora, e no semanal só entram semanas
completas (o sinal da semana sai depois de sexta).

Os números da foto saem do mesmo setups.Contexto que o Python usa para avaliar o catálogo, já
arredondados: Python e JS comparam exatamente os mesmos valores (scripts/testar_paridade.py).

Para o usuário escolher "aconteceu no último pregão" ou "nos últimos N", as regras são
avaliadas em cada um dos PERIODOS últimos candles. Por isso:
  - preço, médias e osciladores trazem os ULTIMOS valores (do mais antigo para o mais recente),
    o bastante para olhar 2 candles antes e a inclinação de 5 candles em qualquer um deles;
  - o que é um número por candle (volume relativo, variação, máximas anteriores, percentil da
    Bollinger) vem como lista dos PERIODOS últimos candles.

Campos da foto (por tempo gráfico, "D" e "W"):
  d, datas          data do último candle e dos PERIODOS últimos
  o h l c           OHLC (ULTIMOS valores)
  sma, ema          {n: ULTIMOS valores} das médias de PERIODOS_MM
  ifr               {n: ULTIMOS valores} do IFR de Wilder (PERIODOS_IFR)
  k, kd             estocástico lento %K e %D (14, 3, 3)
  bbs, bbi          bandas de Bollinger (20, 2)
  bbl, bbp          por candle: largura das bandas (% da média) e percentil dela nos 120 candles
  vr                por candle: volume / média dos 20 candles anteriores
  var, max, min     por candle: {n: variação %}, {n: máxima/mínima dos n candles ANTERIORES}
  dn                {n: distância "normal" do fechamento à MMS n, em %} (média em ~1 ano)
  atr               ATR 14 do último candle, em % do fechamento
  alta, baixa       {n, desde}: há quanto tempo está em alta/baixa (fechamento x MMS 20 e 50)
  Condições que dependem de dados que o navegador não tem (calculadas em scripts/setups.py),
  por candle, 1 = aconteceu e 0 = não:
  boca              {"compra": [...], "venda": [...]}: boca de jacaré (estrategias._boca)
  mtf               {"compra": [...], "venda": [...]}: multitempo (precisa do 60 min e do 4 horas)
  rk                {"quedas": [...], "altas": [...]}: entre as maiores quedas/altas do mercado
                    (compara todos os ativos; entra no fim de atualizar_dados.py)
"""

from __future__ import annotations

import math

import pandas as pd

from estrategias import reamostrar

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
MINIMO_CANDLES = 30   # menos que isso não gera foto (nem eventos)


def _r(v, casas: int):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), casas)


def _serie(s: pd.Series, casas: int) -> list:
    return [_r(x, casas) for x in s.iloc[-ULTIMOS:]]


def _por_candle(s: pd.Series, casas: int) -> list:
    """Um valor por candle, nos PERIODOS últimos."""
    return [_r(x, casas) for x in s.iloc[-PERIODOS:]]


def bits(s: pd.Series) -> list:
    """Condição por candle (PERIODOS últimos) como 0/1."""
    return [int(bool(x)) for x in s.iloc[-PERIODOS:]]


def _sequencia(cond: pd.Series) -> int:
    """Quantos candles seguidos, até o último, a condição é verdadeira."""
    n = 0
    for v in reversed(cond.to_numpy()):
        if not v:
            break
        n += 1
    return n


def quadros(df: pd.DataFrame, mercado: str) -> dict[str, pd.DataFrame]:
    """Diário e semanal, só com candles fechados. No semanal só entram semanas completas: a semana
    em andamento só vira candle depois do último pregão dela (sexta; domingo em cripto) ou quando
    ela já passou. A semana é identificada pela segunda-feira."""
    cripto = mercado == "CRIPTO"
    semanal = reamostrar(df, "W-SUN" if cripto else "W-FRI")
    fim_semana = semanal.index[-1]  # o rótulo do resample é o último dia da semana
    if df.index[-1] < fim_semana and pd.Timestamp.today().normalize() <= fim_semana:
        semanal = semanal.iloc[:-1]
    semanal.index = semanal.index - pd.Timedelta(days=6 if cripto else 4)  # semana pela segunda-feira
    return {"D": df, "W": semanal}


def foto(x) -> dict | None:
    """Foto de um tempo gráfico a partir do setups.Contexto (valores já arredondados)."""
    f, tf, casas = x.f, x.tf, x.casas
    if len(f) < MINIMO_CANDLES:
        return None
    out: dict = {
        "d": f.index[-1].strftime("%Y-%m-%d"),
        "datas": [d.strftime("%Y-%m-%d") for d in f.index[-PERIODOS:]],
        "o": _serie(x.o, casas), "h": _serie(x.h, casas), "l": _serie(x.l, casas), "c": _serie(x.c, casas),
    }
    out["vr"] = _por_candle(x.vr(), 2)
    out["sma"] = {n: _serie(s, casas) for n in PERIODOS_MM if not math.isnan((s := x.media(f"sma{n}")).iloc[-1])}
    out["ema"] = {n: _serie(s, casas) for n in PERIODOS_MM if not math.isnan((s := x.media(f"ema{n}")).iloc[-1])}
    out["ifr"] = {n: _serie(x.ifr(n), 1) for n in PERIODOS_IFR}
    k, d = x.estocastico()
    out["k"], out["kd"] = _serie(k, 1), _serie(d, 1)
    b = x.bandas()
    out["bbs"], out["bbi"] = _serie(b["sup"], casas), _serie(b["inf"], casas)
    out["bbl"] = _por_candle(b["bbl"], 2)
    # percentil da largura de cada candle nos 120 anteriores a ele (0 = a mais estreita)
    out["bbp"] = _por_candle(b["bbp"], 0)
    # distância "normal" do fechamento a cada média: média da distância absoluta em ~1 ano
    out["dn"] = {n: v for n in DIST_NORMAL_MM if (v := _r(x.dn(n).iloc[-1], 2)) is not None}
    out["var"] = {n: _por_candle(x.var(n), 2) for n in JANELAS[tf]["var"] if x.tem_janela(n)}
    # máxima/mínima dos N candles ANTERIORES a cada candle (rompimento = fechar além delas)
    out["max"] = {n: _por_candle(x.extremo("max", n), casas) for n in JANELAS[tf]["ext"] if x.tem_janela(n)}
    out["min"] = {n: _por_candle(x.extremo("min", n), casas) for n in JANELAS[tf]["ext"] if x.tem_janela(n)}
    out["atr"] = _r(x.atr().iloc[-1], 2)

    # há quanto tempo está em alta/baixa pela regra padrão (fechamento x MMS 20 e MMS 50)
    c, m20, m50 = f["Close"], x.media_bruta(20), x.media_bruta(50)
    for chave, cond in (("alta", (c > m20) & (c > m50)), ("baixa", (c < m20) & (c < m50))):
        n = _sequencia(cond)
        if n:
            out[chave] = {"n": n, "desde": f.index[-n].strftime("%Y-%m-%d")}
    # condições calculadas no Python (o navegador só lê)
    for chave in ("boca", "mtf"):
        if chave in x.extras:
            out[chave] = {lado: bits(s) for lado, s in x.extras[chave].items()}
    return out
