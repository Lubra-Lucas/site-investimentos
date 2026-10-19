"""Indicadores e estratégias do radar.

Cada sinal pertence a uma FAMÍLIA de estratégia e a um LADO (compra ou venda).
Quando o mesmo ativo dispara mais de uma família do mesmo lado, há confluência,
e ele merece mais atenção. Todas as estratégias de venda são o espelho das de compra.

Famílias:
  pullback     Tendência de alta (MM20 > MM50) que recua e toca a MM20, MM50 ou MM200
               sem perdê-la. Venda: tendência de baixa que repica até a média e é rejeitada.
  ifr          IFR 14 cruza abaixo de 20 (venda: acima de 80).
  mtf60        Multitempo: diário E semanal acima das duas médias e, no 60 min,
               estocástico lento < 20 e IFR < 30. Exaustão de curto prazo a favor da tendência.
  mtfd         Multitempo: semanal acima das duas médias e, no diário, estocástico lento < 20
               e IFR < 40.
  bb_fora      Fechamento fora da banda de Bollinger (20, 2). Lido como reversão ou
               continuidade conforme a tendência semanal.
  bb_abertura  Boca de jacaré: depois de bandas estreitas, a superior sobe, a inferior desce
               e o preço fecha fora delas.

Estados (não são eventos, são a foto de hoje):
  tendência forte  preço acima (abaixo) das duas médias no diário E no semanal.
  compressão       largura das bandas de Bollinger entre as 10% menores dos últimos 120 pregões.
  IFR extremo      IFR diário, semanal ou mensal abaixo de 20 / acima de 80.

Os eventos são calculados para cada pregão (e cada semana), então o radar mostra
em que dia cada oportunidade apareceu. Filtros de prazo maior usam só o que já
estava fechado naquele dia, sem olhar o futuro.
"""

from __future__ import annotations

import math

import pandas as pd

MM_RAPIDA, MM_LENTA, MM_LONGA = 20, 50, 200
IFR_PERIODO, IFR_SOBREVENDIDO, IFR_SOBRECOMPRADO = 14, 20, 80
ESTOC_K, ESTOC_SUAVE, ESTOC_D = 14, 3, 3
ESTOC_SOBREVENDIDO, ESTOC_SOBRECOMPRADO = 20, 80
IFR_60_COMPRA, IFR_60_VENDA = 30, 70
IFR_D_COMPRA, IFR_D_VENDA = 40, 60
BB_PERIODO, BB_DESVIOS = 20, 2.0
BB_JANELA_COMPRESSAO, BB_PERCENTIL_COMPRESSAO = 120, 0.10
TOQUE = 0.005        # a mínima precisa chegar a 0,5% da média para contar como toque
TOLERANCIA = 0.005   # e o fechamento não pode ficar mais de 0,5% do lado errado dela
JANELA_DIARIA = 15   # pregões de histórico de sinais
JANELA_SEMANAL = 8   # semanas de histórico de sinais

LIQUIDEZ_MINIMA = {"BR": 10e6, "US": 100e6, "CRIPTO": 100e6}

FAMILIAS = {
    "pullback": "Pullback nas médias",
    "ifr": "IFR extremo",
    "mtf60": "Multitempo 60 min",
    "mtfd": "Multitempo diário",
    "bb_fora": "Fora da Bollinger",
    "bb_abertura": "Boca de jacaré",
}


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


def indicadores(df: pd.DataFrame) -> pd.DataFrame:
    f = df.copy()
    for n in (MM_RAPIDA, MM_LENTA, MM_LONGA):
        f[f"MM{n}"] = f["Close"].rolling(n).mean()
    f["IFR"] = ifr(f["Close"])
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


# ------------------------------------------------------------- estratégias

def _pullbacks(f, filtro_alta, filtro_baixa):
    c, h, l = f["Close"], f["High"], f["Low"]
    mr, ml = f[f"MM{MM_RAPIDA}"], f[f"MM{MM_LENTA}"]
    em_alta = (mr > ml) & (c > ml) & filtro_alta
    em_baixa = (mr < ml) & (c < ml) & filtro_baixa
    vistos, out = set(), []
    for n in (MM_LONGA, MM_LENTA, MM_RAPIDA):  # a média mais longa tocada é a mais relevante
        mm = f[f"MM{n}"]
        alta_ok, baixa_ok = ((c > mm) & (ml > mm), (c < mm) & (ml < mm)) if n == MM_LONGA else (em_alta, em_baixa)
        compra = alta_ok & (l <= mm * (1 + TOQUE)) & (c >= mm * (1 - TOLERANCIA)) & (c.shift(1) > mm.shift(1))
        venda = baixa_ok & (h >= mm * (1 - TOQUE)) & (c <= mm * (1 + TOLERANCIA)) & (c.shift(1) < mm.shift(1))
        for lado, cond, txt in (("compra", compra, "Pullback na"), ("venda", venda, "Repique rejeitado na")):
            for d in f.index[cond.fillna(False)]:
                if (d, lado) not in vistos:
                    vistos.add((d, lado))
                    out.append((d, lado, "pullback", f"{txt} MM{n}"))
    return out


def _ifr_extremo(f):
    r = f["IFR"]
    out = [(d, "compra", "ifr", f"IFR cruzou abaixo de {IFR_SOBREVENDIDO} ({r[d]:.0f})")
           for d in f.index[_inicio(r < IFR_SOBREVENDIDO)]]
    out += [(d, "venda", "ifr", f"IFR cruzou acima de {IFR_SOBRECOMPRADO} ({r[d]:.0f})")
            for d in f.index[_inicio(r > IFR_SOBRECOMPRADO)]]
    return out


def _mtf_diario(d, alta_s_fechada, baixa_s_fechada):
    compra = alta_s_fechada & (d["EstK"] < ESTOC_SOBREVENDIDO) & (d["IFR"] < IFR_D_COMPRA)
    venda = baixa_s_fechada & (d["EstK"] > ESTOC_SOBRECOMPRADO) & (d["IFR"] > IFR_D_VENDA)
    out = [(x, "compra", "mtfd", f"Semanal em alta + diário exausto (estoc. {d.loc[x, 'EstK']:.0f}, IFR {d.loc[x, 'IFR']:.0f})")
           for x in d.index[_inicio(compra)]]
    out += [(x, "venda", "mtfd", f"Semanal em baixa + diário esticado (estoc. {d.loc[x, 'EstK']:.0f}, IFR {d.loc[x, 'IFR']:.0f})")
            for x in d.index[_inicio(venda)]]
    return out


def _mtf_60(h, alta_ds, baixa_ds):
    """h: candles de 60 min com indicadores; alta_ds/baixa_ds: filtro diário+semanal por data."""
    dia = h.index.normalize()
    fa = pd.Series(alta_ds.reindex(dia).fillna(False).to_numpy(), index=h.index)
    fb = pd.Series(baixa_ds.reindex(dia).fillna(False).to_numpy(), index=h.index)
    compra = fa & (h["EstK"] < ESTOC_SOBREVENDIDO) & (h["IFR"] < IFR_60_COMPRA)
    venda = fb & (h["EstK"] > ESTOC_SOBRECOMPRADO) & (h["IFR"] > IFR_60_VENDA)
    out, vistos = [], set()
    for lado, cond, txt in (("compra", compra, "D+S em alta + exaustão no 60 min"),
                            ("venda", venda, "D+S em baixa + esticado no 60 min")):
        for t in h.index[_inicio(cond)]:
            chave = (t.normalize(), lado)
            if chave not in vistos:
                vistos.add(chave)
                out.append((t.normalize(), lado, "mtf60",
                            f"{txt} às {t:%H:%M} (estoc. {h.loc[t, 'EstK']:.0f}, IFR {h.loc[t, 'IFR']:.0f})"))
    return out


def _bollinger(f, alta_maior, baixa_maior):
    c = f["Close"]
    abaixo, acima = _inicio(c < f["BBinf"]), _inicio(c > f["BBsup"])
    out = []
    for x in f.index[abaixo]:
        if baixa_maior[x]:
            out.append((x, "venda", "bb_fora", "Fechou abaixo da banda inferior em tendência de baixa (continuidade)"))
        else:
            ctx = "dentro da alta" if alta_maior[x] else "em lateralização"
            out.append((x, "compra", "bb_fora", f"Fechou abaixo da banda inferior {ctx} (reversão à média)"))
    for x in f.index[acima]:
        if alta_maior[x]:
            out.append((x, "compra", "bb_fora", "Fechou acima da banda superior em tendência de alta (continuidade)"))
        else:
            ctx = "dentro da baixa" if baixa_maior[x] else "em lateralização"
            out.append((x, "venda", "bb_fora", f"Fechou acima da banda superior {ctx} (reversão à média)"))

    abrindo = ((f["BBsup"] > f["BBsup"].shift(1)) & (f["BBinf"] < f["BBinf"].shift(1))
               & (f["BBlarg"] > f["BBlarg"].shift(1) * 1.05)
               & f["BBcomprimida"].shift(1).rolling(10, min_periods=1).max().fillna(0).astype(bool))
    for x in f.index[_inicio(abrindo & (c > f["BBsup"]))]:
        out.append((x, "compra", "bb_abertura", "Bandas abrindo após compressão, rompimento para cima"))
    for x in f.index[_inicio(abrindo & (c < f["BBinf"]))]:
        out.append((x, "venda", "bb_abertura", "Bandas abrindo após compressão, rompimento para baixo"))
    return out


# ------------------------------------------------------------- utilidades

def _num(v, casas=2):
    if v is None or pd.isna(v) or (isinstance(v, float) and math.isinf(v)):
        return None
    return round(float(v), casas)


def _var(close: pd.Series, desde: pd.Timestamp):
    base = close[close.index < desde]
    return None if base.empty else _num((close.iloc[-1] / base.iloc[-1] - 1) * 100)


def _desde(serie: pd.Series) -> str | None:
    """Data em que começou a sequência atual de True."""
    serie = serie.fillna(False).astype(bool)
    if serie.empty or not serie.iloc[-1]:
        return None
    falsos = serie[~serie]
    inicio = serie.index[0] if falsos.empty else serie.index[serie.index > falsos.index[-1]][0]
    return inicio.strftime("%Y-%m-%d")


# ------------------------------------------------------------- análise

def analisar(df: pd.DataFrame, mercado: str, df60: pd.DataFrame | None = None) -> tuple[dict, list[dict]]:
    """Retorna (estado atual do ativo, lista de sinais datados).

    df60 já vem verificado contra o diário (validacao.limpar_intraday)."""
    d = indicadores(df)
    s = indicadores(reamostrar(df, "W-FRI"))
    m = indicadores(reamostrar(df, "MS"))
    s.index = s.index - pd.Timedelta(days=4)  # semana identificada pela segunda-feira

    alta_d, baixa_d = _tendencia(d)
    alta_s, baixa_s = _tendencia(s)
    # Para sinais diários, o filtro semanal usa a última semana já FECHADA
    fechada = lambda x: x.shift(1).reindex(d.index, method="ffill").fillna(False).astype(bool)
    alta_s_f, baixa_s_f = fechada(alta_s), fechada(baixa_s)
    sempre = pd.Series(True, index=s.index)
    alta_s_ant = alta_s.shift(1, fill_value=False).astype(bool)
    baixa_s_ant = baixa_s.shift(1, fill_value=False).astype(bool)

    u = d.iloc[-1]
    vol_fin = (df["Volume"] if mercado == "CRIPTO" else df["Close"] * df["Volume"]).tail(20).mean()
    liquido = bool(vol_fin >= LIQUIDEZ_MINIMA.get(mercado, 0))
    forte = "alta" if (alta_d.iloc[-1] and alta_s.iloc[-1]) else "baixa" if (baixa_d.iloc[-1] and baixa_s.iloc[-1]) else None

    h = indicadores(df60) if df60 is not None and len(df60) >= 60 else None
    # o estado "agora" do 60 min só vale se o intraday tiver o mesmo pregão do diário
    h_atual = h is not None and h.index[-1].normalize() == d.index[-1]
    estado = {
        "ultimo": _num(u["Close"], 4),
        "data": d.index[-1].strftime("%Y-%m-%d"),
        "var_dia_pct": _num((u["Close"] / d["Close"].iloc[-2] - 1) * 100),
        "var_mes_pct": _var(d["Close"], d.index[-1].replace(day=1)),
        "var_ano_pct": _var(d["Close"], d.index[-1].replace(month=1, day=1)),
        "ifr_d": _num(u["IFR"], 1), "ifr_s": _num(s["IFR"].iloc[-1], 1), "ifr_m": _num(m["IFR"].iloc[-1], 1),
        "estoc_d": _num(u["EstK"], 1),
        "ifr_60": _num(h["IFR"].iloc[-1], 1) if h_atual else None,
        "estoc_60": _num(h["EstK"].iloc[-1], 1) if h_atual else None,
        "tend_d": "alta" if alta_d.iloc[-1] else "baixa" if baixa_d.iloc[-1] else "lateral",
        "tend_s": "alta" if alta_s.iloc[-1] else "baixa" if baixa_s.iloc[-1] else "lateral",
        "tendencia_forte": forte,
        "tendencia_desde": _desde(alta_d if forte == "alta" else baixa_d) if forte else None,
        "bb_largura_pct": _num(u["BBlarg"] * 100),
        "bb_comprimida": bool(u["BBcomprimida"]),
        "bb_comprimida_desde": _desde(d["BBcomprimida"]),
        "dist_mm20_pct": _num((u["Close"] / u[f"MM{MM_RAPIDA}"] - 1) * 100),
        "dist_mm50_pct": _num((u["Close"] / u[f"MM{MM_LENTA}"] - 1) * 100),
        "dist_mm200_pct": _num((u["Close"] / u[f"MM{MM_LONGA}"] - 1) * 100),
        "dist_max52_pct": _num((u["Close"] / d["High"].tail(252).max() - 1) * 100),
        "volume_financeiro_20d": _num(vol_fin, 0),
        "liquido": liquido,
        "intraday_ok": bool(h_atual),
    }
    if not liquido:
        return estado, []

    eventos = []  # (data, tf, lado, familia, texto, frame)
    eventos += [(*e[:1], "D", *e[1:], d) for e in _pullbacks(d, alta_s_f, baixa_s_f)]
    eventos += [(*e[:1], "D", *e[1:], d) for e in _ifr_extremo(d)]
    eventos += [(*e[:1], "D", *e[1:], d) for e in _mtf_diario(d, alta_s_f, baixa_s_f)]
    eventos += [(*e[:1], "D", *e[1:], d) for e in _bollinger(d, alta_s_f, baixa_s_f)]
    eventos += [(*e[:1], "S", *e[1:], s) for e in _pullbacks(s, sempre, sempre)]
    eventos += [(*e[:1], "S", *e[1:], s) for e in _ifr_extremo(s)]
    eventos += [(*e[:1], "S", *e[1:], s) for e in _bollinger(s, alta_s_ant, baixa_s_ant)]
    if h is not None:
        # filtro D+S do pregão anterior: no 60 min de hoje só se sabia o fechamento de ontem
        alta_ds = (alta_d & alta_s_f).shift(1).fillna(False).astype(bool)
        baixa_ds = (baixa_d & baixa_s_f).shift(1).fillna(False).astype(bool)
        eventos += [(*e[:1], "D", *e[1:], d) for e in _mtf_60(h, alta_ds, baixa_ds)]

    corte = {"D": d.index[-min(JANELA_DIARIA, len(d))], "S": s.index[-min(JANELA_SEMANAL, len(s))]}
    sinais = []
    for data, tf, lado, familia, texto, f in eventos:
        if data < corte[tf] or data not in f.index:
            continue
        sinais.append({"data": data.strftime("%Y-%m-%d"), "tf": tf, "lado": lado, "familia": familia,
                       "texto": texto, "preco": _num(f.loc[data, "Close"], 4)})
    return estado, sinais
