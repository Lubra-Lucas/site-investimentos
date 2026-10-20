"""Indicadores e estratégias do radar.

Cada sinal tem um LADO (compra ou venda), uma FAMÍLIA de estratégia e uma MODALIDADE:

A favor da tendência (comprar alta que continua / vender baixa que continua):
  pullback   Pullback nas médias (MM20, MM50 ou MM200), com as médias alinhadas a favor:
             - rejeição: a mínima fura a média e o candle fecha acima dela;
             - violação e retomada: fecha abaixo da média por 1 ou 2 candles e volta a fechar acima.
             Venda: o espelho (máxima fura e fecha abaixo; ou fecha acima 1-2 candles e perde de novo).
  boca       Boca de jacaré: bandas de Bollinger comprimidas que abrem (superior sobe, inferior
             desce) com fechamento fora delas.
  mtf        Multitempo: tendência no tempo do sinal + exaustão no tempo menor.
             Sinal diário: diário acima da MM20 e da MM50 + 60 min com estocástico lento < 20
             e/ou IFR < 30. Sinal semanal: semanal acima das médias + a mesma exaustão no diário
             ou no 4 horas.

Contra a tendência (comprar a faca caindo / vender o que esticou demais):
  ifr        IFR 14 cruza abaixo de 20 (venda: acima de 80).
  bb_fora    Fecha abaixo da banda inferior de Bollinger (venda: acima da superior), fora de uma
             abertura de boca de jacaré.
  distancia  Preço anormalmente longe da MM20: distância pelo menos 2,5x a distância média
             do próprio ativo no último ano.
  quedas     Maiores quedas do período no mercado (venda: maiores altas). Calculado em
             atualizar_dados.py, porque compara os ativos entre si.

Estados (a foto de hoje, para os filtros de estado):
  tendência forte  preço acima (abaixo) das duas médias no diário E no semanal.
  compressão       largura da Bollinger entre as 10% menores dos últimos 120 candles.

Os eventos são calculados para cada pregão (e cada semana), então o radar mostra em que dia
cada oportunidade apareceu. Filtros de prazo maior usam só o que já estava fechado naquele
dia, sem olhar o futuro.
"""

from __future__ import annotations

import math

import pandas as pd

MM_RAPIDA, MM_LENTA, MM_LONGA = 20, 50, 200
IFR_PERIODO, IFR_SOBREVENDIDO, IFR_SOBRECOMPRADO = 14, 20, 80
ESTOC_K, ESTOC_SUAVE, ESTOC_D = 14, 3, 3
ESTOC_SOBREVENDIDO, ESTOC_SOBRECOMPRADO = 20, 80
IFR_60_COMPRA, IFR_60_VENDA = 30, 70
BB_PERIODO, BB_DESVIOS = 20, 2.0
BB_JANELA_COMPRESSAO, BB_PERCENTIL_COMPRESSAO = 120, 0.10
DISTANCIA_FATOR = 2.5                  # distância da MM20 x a distância média do ativo
DISTANCIA_MINIMA = {"D": 0.02, "S": 0.04}  # e nunca menos que isso
JANELA_DIARIA = 15   # pregões de histórico de sinais
JANELA_SEMANAL = 8   # semanas de histórico de sinais

LIQUIDEZ_MINIMA = {"BR": 10e6, "US": 100e6, "CRIPTO": 30e6}

FAMILIAS = {
    "pullback": {"nome": "Pullback nas médias", "modalidade": "tendencia"},
    "boca": {"nome": "Boca de jacaré", "modalidade": "tendencia"},
    "mtf": {"nome": "Multitempo", "modalidade": "tendencia"},
    "ifr": {"nome": "IFR extremo", "modalidade": "contra"},
    "bb_fora": {"nome": "Fora da Bollinger", "modalidade": "contra"},
    "distancia": {"nome": "Distância da MM20", "modalidade": "contra"},
    "quedas": {"nome": "Maiores quedas", "nome_venda": "Maiores altas", "modalidade": "contra"},
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


def _br(v: float, casas: int = 1) -> str:
    """Número no formato brasileiro (vírgula decimal)."""
    return f"{v:.{casas}f}".replace(".", ",")


def _inicio(cond: pd.Series) -> pd.Series:
    """True só no primeiro candle de cada sequência em que a condição vale."""
    cond = cond.fillna(False).astype(bool)
    return cond & ~cond.shift(1, fill_value=False)


def _antes(cond: pd.Series, n: int) -> pd.Series:
    return cond.shift(n, fill_value=False).astype(bool)


# ------------------------------------------------------------- a favor da tendência

def _pullbacks(f: pd.DataFrame) -> list[tuple]:
    """Rejeição ou violação-e-retomada da MM20, MM50 ou MM200 com as médias alinhadas."""
    c, h, l = f["Close"], f["High"], f["Low"]
    m20, m50, m200 = f[f"MM{MM_RAPIDA}"], f[f"MM{MM_LENTA}"], f[f"MM{MM_LONGA}"]
    contexto = {  # média: (alinhamento de alta, alinhamento de baixa)
        MM_LONGA: (m200 > m200.shift(20), m200 < m200.shift(20)),
        MM_LENTA: (m50 > m200, m50 < m200),
        MM_RAPIDA: ((m20 > m50) & (m50 > m200), (m20 < m50) & (m50 < m200)),
    }
    vistos, out = set(), []
    for n in (MM_LONGA, MM_LENTA, MM_RAPIDA):  # a média mais longa é a mais relevante
        mm = f[f"MM{n}"]
        alta_ok, baixa_ok = (x.fillna(False) for x in contexto[n])
        abaixo, acima = (c < mm).fillna(False), (c > mm).fillna(False)
        casos = {
            "compra": [
                (alta_ok & (l < mm) & acima & _antes(acima, 1), f"Rejeição da MM{n}: a mínima furou e fechou acima"),
                (alta_ok & acima & _antes(abaixo, 1) & ~_antes(abaixo, 2),
                 f"Violação e retomada da MM{n}: 1 candle abaixo e voltou"),
                (alta_ok & acima & _antes(abaixo, 1) & _antes(abaixo, 2) & ~_antes(abaixo, 3),
                 f"Violação e retomada da MM{n}: 2 candles abaixo e voltou"),
            ],
            "venda": [
                (baixa_ok & (h > mm) & abaixo & _antes(abaixo, 1), f"Rejeição da MM{n}: a máxima furou e fechou abaixo"),
                (baixa_ok & abaixo & _antes(acima, 1) & ~_antes(acima, 2),
                 f"Violação e perda da MM{n}: 1 candle acima e voltou a perder"),
                (baixa_ok & abaixo & _antes(acima, 1) & _antes(acima, 2) & ~_antes(acima, 3),
                 f"Violação e perda da MM{n}: 2 candles acima e voltou a perder"),
            ],
        }
        for lado, regras in casos.items():
            for cond, texto in regras:
                for d in f.index[cond.fillna(False)]:
                    if (d, lado) not in vistos:
                        vistos.add((d, lado))
                        out.append((d, lado, "pullback", texto))
    return out


def _boca(f: pd.DataFrame) -> list[tuple]:
    c = f["Close"]
    abrindo = ((f["BBsup"] > f["BBsup"].shift(1)) & (f["BBinf"] < f["BBinf"].shift(1))
               & (f["BBlarg"] > f["BBlarg"].shift(1) * 1.05)
               & f["BBcomprimida"].shift(1).rolling(10, min_periods=1).max().fillna(0).astype(bool))
    out = [(x, "compra", "boca", "Bandas abrindo após compressão, fechou acima da banda superior")
           for x in f.index[_inicio(abrindo & (c > f["BBsup"]))]]
    out += [(x, "venda", "boca", "Bandas abrindo após compressão, fechou abaixo da banda inferior")
            for x in f.index[_inicio(abrindo & (c < f["BBinf"]))]]
    return out


def _exaustao(f: pd.DataFrame, lado: str) -> pd.Series:
    if lado == "compra":
        return (f["EstK"] < ESTOC_SOBREVENDIDO) | (f["IFR"] < IFR_60_COMPRA)
    return (f["EstK"] > ESTOC_SOBRECOMPRADO) | (f["IFR"] > IFR_60_VENDA)


def _descreve_exaustao(f: pd.DataFrame, t, lado: str) -> str:
    est, r = f.loc[t, "EstK"], f.loc[t, "IFR"]
    partes = []
    if (est < ESTOC_SOBREVENDIDO) if lado == "compra" else (est > ESTOC_SOBRECOMPRADO):
        partes.append(f"estocástico {est:.0f}")
    if (r < IFR_60_COMPRA) if lado == "compra" else (r > IFR_60_VENDA):
        partes.append(f"IFR {r:.0f}")
    return " e ".join(partes) + (" (os dois)" if len(partes) == 2 else "")


def _mtf(menor: pd.DataFrame, filtro_alta: pd.Series, filtro_baixa: pd.Series, nome_maior: str,
         nome_menor: str, chave_evento, com_hora: bool) -> list[tuple]:
    """Tendência no tempo maior (filtro por dia, já conhecido) + exaustão no tempo menor."""
    dia = menor.index.normalize()
    fa = pd.Series(filtro_alta.reindex(dia).fillna(False).to_numpy(), index=menor.index)
    fb = pd.Series(filtro_baixa.reindex(dia).fillna(False).to_numpy(), index=menor.index)
    out, vistos = [], set()
    for lado, filtro, tend, exaustao in (("compra", fa, "em alta", "exaustão de queda"),
                                         ("venda", fb, "em baixa", "exaustão de alta")):
        for t in menor.index[_inicio(filtro & _exaustao(menor, lado))]:
            chave = (chave_evento(t), lado)
            if chave in vistos:
                continue
            vistos.add(chave)
            quando = f"{t:%d/%m %H:%M}" if com_hora else f"{t:%d/%m}"
            out.append((chave_evento(t), lado, "mtf",
                        f"{nome_maior} {tend} + {exaustao} no {nome_menor} em {quando}: "
                        f"{_descreve_exaustao(menor, t, lado)}"))
    return out


# ------------------------------------------------------------- contra a tendência

def _ifr_extremo(f: pd.DataFrame) -> list[tuple]:
    r = f["IFR"]
    out = [(d, "compra", "ifr", f"IFR em {r[d]:.0f}: sobrevendido (abaixo de {IFR_SOBREVENDIDO})")
           for d in f.index[_inicio(r < IFR_SOBREVENDIDO)]]
    out += [(d, "venda", "ifr", f"IFR em {r[d]:.0f}: sobrecomprado (acima de {IFR_SOBRECOMPRADO})")
            for d in f.index[_inicio(r > IFR_SOBRECOMPRADO)]]
    return out


def _fora_bollinger(f: pd.DataFrame, bocas: set) -> list[tuple]:
    c = f["Close"]
    out = [(x, "compra", "bb_fora", "Fechou abaixo da banda inferior: esticado para baixo")
           for x in f.index[_inicio(c < f["BBinf"])] if (x, "venda") not in bocas]
    out += [(x, "venda", "bb_fora", "Fechou acima da banda superior: esticado para cima")
            for x in f.index[_inicio(c > f["BBsup"])] if (x, "compra") not in bocas]
    return out


def _distancia(f: pd.DataFrame, tf: str) -> list[tuple]:
    dist = f["Close"] / f[f"MM{MM_RAPIDA}"] - 1
    janela = 250 if tf == "D" else 104
    normal = dist.abs().rolling(janela, min_periods=janela // 2).mean().shift(1)
    longe = (dist.abs() >= normal * DISTANCIA_FATOR) & (dist.abs() >= DISTANCIA_MINIMA[tf])
    out = []
    for lado, cond, sentido in (("compra", longe & (dist < 0), "abaixo"), ("venda", longe & (dist > 0), "acima")):
        for x in f.index[_inicio(cond)]:
            out.append((x, lado, "distancia",
                        f"{_br(abs(dist[x]) * 100)}% {sentido} da MM20 (o normal deste ativo é {_br(normal[x] * 100)}%)"))
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
    # cripto negocia todo dia: a semana vai até domingo
    cripto = mercado == "CRIPTO"
    s = indicadores(reamostrar(df, "W-SUN" if cripto else "W-FRI"))
    m = indicadores(reamostrar(df, "MS"))
    s.index = s.index - pd.Timedelta(days=6 if cripto else 4)  # semana identificada pela segunda-feira

    alta_d, baixa_d = _tendencia(d)
    alta_s, baixa_s = _tendencia(s)
    # Para sinais diários, o filtro semanal usa a última semana já FECHADA
    fechada = lambda x: x.shift(1).reindex(d.index, method="ffill").fillna(False).astype(bool)
    alta_s_f, baixa_s_f = fechada(alta_s), fechada(baixa_s)

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
    if not liquido:
        return estado, []

    eventos = []  # (data, tf, lado, familia, texto)
    for tf, f in (("D", d), ("S", s)):
        bocas = _boca(f)
        eventos += [(x, tf, *e) for x, *e in _pullbacks(f)]
        eventos += [(x, tf, *e) for x, *e in bocas]
        eventos += [(x, tf, *e) for x, *e in _ifr_extremo(f)]
        eventos += [(x, tf, *e) for x, *e in _fora_bollinger(f, {(x, lado) for x, lado, *_ in bocas})]
        eventos += [(x, tf, *e) for x, *e in _distancia(f, tf)]

    # Multitempo. Sinal diário: tendência do diário (fechamento de ontem, já conhecido) + exaustão no 60 min.
    if h is not None:
        ontem = lambda x: x.shift(1, fill_value=False).astype(bool)
        eventos += [(x, "D", *e) for x, *e in _mtf(h, ontem(alta_d), ontem(baixa_d), "Diário", "60 min",
                                                    lambda t: t.normalize(), com_hora=True)]
    # Sinal semanal: semanal em tendência (última semana fechada) + exaustão no diário ou no 4 horas.
    segunda = lambda t: t.normalize() - pd.Timedelta(days=t.weekday())
    eventos += [(x, "S", *e) for x, *e in _mtf(d, alta_s_f, baixa_s_f, "Semanal", "diário", segunda, com_hora=False)]
    if h is not None:
        h4 = indicadores(para_4h(df60))
        eventos += [(x, "S", *e) for x, *e in _mtf(h4, alta_s_f, baixa_s_f, "Semanal", "4 horas", segunda, com_hora=True)]

    corte = {"D": d.index[-min(JANELA_DIARIA, len(d))], "S": s.index[-min(JANELA_SEMANAL, len(s))]}
    frames = {"D": d, "S": s}
    sinais, vistos = [], set()
    for data, tf, lado, familia, texto in eventos:
        f = frames[tf]
        chave = (data, tf, lado, familia)
        if data < corte[tf] or data not in f.index or chave in vistos:
            continue
        vistos.add(chave)
        sinais.append({"data": data.strftime("%Y-%m-%d"), "tf": tf, "lado": lado, "familia": familia,
                       "modalidade": FAMILIAS[familia]["modalidade"], "texto": texto,
                       "preco": _num(f.loc[data, "Close"], 4)})
    return estado, sinais
