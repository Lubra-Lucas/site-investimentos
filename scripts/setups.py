"""Motor único dos setups do catálogo (config/setups.json). Ver docs/arquitetura.md.

Cada setup é uma lista de regras (as mesmas condições do editor de regras do site, CONDICOES em
assets/js/rastreador.js). Aqui cada condição é calculada em TODO o histórico, de uma vez
(pandas), devolvendo uma série booleana por candle; o setup dispara num candle quando todas as
regras valem nele. Sem dado suficiente = não disparou.

Python e JS comparam exatamente os mesmos números: o Contexto arredonda cada série como ela é
publicada em data/rastreador.json (preço nas casas do ativo, IFR com 1 casa...), e a foto do
rastreador é montada a partir dele. scripts/testar_paridade.py confere, ativo por ativo, que o
último candle dá o mesmo resultado nas duas implementações.

Diferença conhecida (só em candles anteriores ao último): o JS usa o ATR do último candle para
olhar candles passados; aqui cada candle usa o próprio ATR.

Três condições dependem de dados que o navegador não tem, então o Python publica o resultado por
candle nas fotos e o JS só lê:
  boca        boca de jacaré (Bollinger comprimida que abre com fechamento fora das bandas)
  multitempo  tendência no tempo do sinal + exaustão no tempo menor (60 min / diário / 4 horas)
  ranking     entre as maiores quedas/altas do mercado: compara todos os ativos, então é
              calculado no fim (ranking()), depois que todos os ativos foram processados.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

import backtest
import rastreador as R
from estrategias import (BB_DESVIOS, BB_JANELA_COMPRESSAO, BB_PERIODO, _exaustao, _inicio, _tendencia,
                         estocastico_lento, ifr, indicadores, para_4h)

CATALOGO_ARQ = Path(__file__).resolve().parent.parent / "config" / "setups.json"

# pullback: o quanto o candle pode ficar da média, em ATR (iguais aos de assets/js/rastreador.js)
PB_TOQUE_ATR = 0.25      # a sombra precisa chegar até a média (com esta folga)
PB_FECHAMENTO_ATR = 1.0  # e o fechamento ficar perto dela
PB_VIOLACAO_ATR = 1.0    # na violação, o fechamento do outro lado não pode ir além disso
JANELA_EVENTOS = {"D": 15, "W": 8}   # pregões / semanas de eventos publicados no radar
# ranking: variação em 21 pregões (13 semanas), 8% maiores do mercado (de 3 a 25 ativos), com movimento mínimo
RANKING_JANELA = {"D": 21, "W": 13}
RANKING_MINIMO = {"D": 8.0, "W": 12.0}
RANKING_FATIA, RANKING_N = 0.08, (3, 25)
RANKING_HISTORICO = 20   # candles de variação que cada ativo devolve para o ranking


def carregar_catalogo() -> dict:
    return json.loads(CATALOGO_ARQ.read_text(encoding="utf-8"))


def itens(catalogo: dict) -> list[dict]:
    return [s for g in catalogo["grupos"] for s in g["itens"]]


def tem_ranking(setup: dict) -> bool:
    return any(r["t"] == "ranking" for r in setup["regras"])


def _arred(s: pd.Series, casas: int) -> pd.Series:
    return s.replace([np.inf, -np.inf], np.nan).round(casas)


def janela_proxima(lista: list[int], v) -> int:
    """A janela mais próxima entre as disponíveis (a primeira, no empate), como no JS."""
    v = float(v)
    return int(v) if v in lista else min(lista, key=lambda x: abs(x - v))


def percentil_largura(larg: pd.Series, janela: int = BB_JANELA_COMPRESSAO, minimo: int = 60) -> pd.Series:
    """Percentil da largura de cada candle entre os `janela` - 1 anteriores (0 = a mais estreita).
    Igual a larg.rolling(janela, min_periods=minimo).apply(lambda x: (x[:-1] < x[-1]).mean() * 100),
    sem o laço em Python."""
    x = larg.to_numpy(dtype=float)
    n = len(x)
    if not n:
        return pd.Series(dtype=float, index=larg.index)
    w = sliding_window_view(np.concatenate([np.full(janela - 1, np.nan), x]), janela)
    tam = np.minimum(np.arange(n) + 1, janela)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (w[:, :-1] < w[:, -1:]).sum(axis=1) / (tam - 1) * 100
    out[(~np.isnan(w)).sum(axis=1) < minimo] = np.nan
    return pd.Series(out, index=larg.index)


class Contexto:
    """Indicadores de um tempo gráfico, por candle, arredondados como em data/rastreador.json."""

    def __init__(self, f: pd.DataFrame, tf: str, casas: int, extras: dict | None = None):
        self.f, self.tf, self.casas = f, tf, casas
        self.extras = extras or {}   # {"boca"|"mtf"|"rk": {lado: Series bool}}
        self._memo: dict = {}
        self.o, self.h, self.l, self.c = (_arred(f[k], casas) for k in ("Open", "High", "Low", "Close"))

    def _m(self, chave, fn):
        if chave not in self._memo:
            self._memo[chave] = fn()
        return self._memo[chave]

    def falso(self) -> pd.Series:
        return pd.Series(False, index=self.f.index)

    def tem_janela(self, n: int) -> bool:
        return len(self.f) > n + R.PERIODOS

    def media_bruta(self, n: int, tipo: str = "sma") -> pd.Series:
        c = self.f["Close"]
        return self._m(("mb", tipo, n), lambda: c.rolling(n).mean() if tipo == "sma"
                       else c.ewm(span=n, adjust=False, min_periods=n).mean())

    def media(self, m: str) -> pd.Series:
        """"sma20" / "ema9" (só os períodos publicados, como no JS)."""
        tipo, n = m[:3], int(m[3:])
        if n not in R.PERIODOS_MM or tipo not in ("sma", "ema"):
            return pd.Series(np.nan, index=self.f.index)
        return self._m(("m", m), lambda: _arred(self.media_bruta(n, tipo), self.casas))

    def ifr(self, n: int) -> pd.Series:
        if n not in R.PERIODOS_IFR:
            return pd.Series(np.nan, index=self.f.index)
        return self._m(("ifr", n), lambda: _arred(ifr(self.f["Close"], n), 1))

    def estocastico(self) -> tuple[pd.Series, pd.Series]:
        return self._m("estoc", lambda: tuple(_arred(x, 1) for x in estocastico_lento(self.f)))

    def bandas(self) -> dict:
        def calc():
            c = self.f["Close"]
            media = c.rolling(BB_PERIODO).mean()
            desvio = c.rolling(BB_PERIODO).std(ddof=0)
            sup, inf = media + BB_DESVIOS * desvio, media - BB_DESVIOS * desvio
            larg = (sup - inf) / media
            return {"sup": _arred(sup, self.casas), "inf": _arred(inf, self.casas),
                    "bbl": _arred(larg * 100, 2), "bbp": _arred(percentil_largura(larg), 0)}
        return self._m("bb", calc)

    def vr(self) -> pd.Series:
        def calc():
            vol = self.f["Volume"].fillna(0)
            media_vol = vol.shift(1).rolling(20).mean()
            return _arred(vol / media_vol.where(media_vol > 0), 2)
        return self._m("vr", calc)

    def var(self, n: int) -> pd.Series:
        c = self.f["Close"]
        if not self.tem_janela(n):
            return pd.Series(np.nan, index=self.f.index)
        return self._m(("var", n), lambda: _arred((c / c.shift(n) - 1) * 100, 2))

    def extremo(self, tipo: str, n: int) -> pd.Series:
        """Máxima/mínima dos n candles ANTERIORES a cada candle."""
        if not self.tem_janela(n):
            return pd.Series(np.nan, index=self.f.index)
        s = self.f["High" if tipo == "max" else "Low"].shift(1).rolling(n)
        return self._m(("ext", tipo, n), lambda: _arred(s.max() if tipo == "max" else s.min(), self.casas))

    def atr(self) -> pd.Series:
        """ATR 14 (Wilder) de cada candle, em % do fechamento."""
        def calc():
            h, l, c = self.f["High"], self.f["Low"], self.f["Close"]
            tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
            return _arred(tr.ewm(alpha=1 / 14, adjust=False).mean() / c * 100, 2)
        return self._m("atr", calc)

    def dn(self, n: int) -> pd.Series:
        """Distância "normal" do fechamento à MMS n (média da distância absoluta em ~1 ano), em %."""
        if n not in R.DIST_NORMAL_MM:
            return pd.Series(np.nan, index=self.f.index)
        def calc():
            dist = (self.f["Close"] / self.media_bruta(n) - 1).abs()
            return _arred(dist.rolling(R.JANELA_NORMAL[self.tf], min_periods=20).mean() * 100, 2)
        return self._m(("dn", n), calc)

    def externa(self, chave: str, lado: str) -> pd.Series:
        s = self.extras.get(chave, {}).get(lado)
        return self.falso() if s is None else s.reindex(self.f.index, fill_value=False).astype(bool)


# ------------------------------------------------------------- condições (mesma semântica do JS)
# Cada condição recebe o Contexto e os parâmetros da regra e devolve um vetor booleano (numpy, um
# valor por candle). Comparação com NaN dá False, como "sem dado" no JS.

def A(s: pd.Series) -> np.ndarray:
    return s.to_numpy(dtype=float)


def sh(a: np.ndarray, k: int) -> np.ndarray:
    """O valor de k candles antes (NaN no começo)."""
    if not k:
        return a
    out = np.full_like(a, np.nan)
    out[k:] = a[:-k]
    return out


tem = lambda a: ~np.isnan(a)


def _preco_media(x, p):
    c, m = A(x.c), A(x.media(p["media"]))
    return c > m if p["lado"] == "acima" else c < m


def _media_media(x, p):
    a, b = A(x.media(p["a"])), A(x.media(p["b"]))
    return a > b if p["lado"] == "acima" else a < b


def _inclinacao(x, p):
    m = A(x.media(p["media"]))
    return m > sh(m, 5) if p["dir"] == "sobe" else m < sh(m, 5)


def _pullback(x, p):
    m, c = A(x.media(p["media"])), A(x.c)
    compra = p["lado"] == "compra"
    L = 1 if compra else -1
    favor = np.greater if compra else np.less
    atrp = A(x.atr())
    atr = c * np.where(np.isnan(atrp), 2, atrp) / 100   # JS: ult(s.c) * (s.atr ?? 2) / 100
    sombra = A(x.l if compra else x.h)
    # o candle precisa estar NA média: a sombra encosta nela (folga de 1/4 de ATR) e o fechamento
    # fica a até 1 ATR. Sem isso, um gap que se afasta da média passaria como "retomada".
    na_media = (tem(m) & favor(c, m) & (L * (sombra - m) <= PB_TOQUE_ATR * atr)
                & (L * (c - m) <= PB_FECHAMENTO_ATR * atr))
    # rejeição: a sombra furou a média e o candle fechou do lado certo (e o anterior também)
    ok = (L * (sombra - m) <= 0) & favor(sh(c, 1), sh(m, 1))
    if p.get("modo", "retomada") == "retomada":
        # violação e retomada: fechou do outro lado por 1 ou 2 candles (até 1 ATR além da média),
        # vindo do lado certo antes disso. Mais tempo ou mais fundo é virada, não pullback.
        contra = lambda k: (tem(sh(m, k)) & ~favor(sh(c, k), sh(m, k))
                            & (L * (sh(m, k) - sh(c, k)) <= PB_VIOLACAO_ATR * atr))
        veio = lambda k: tem(sh(m, k)) & favor(sh(c, k), sh(m, k))
        c1 = contra(1)
        ok = ok | (c1 & veio(2)) | (c1 & contra(2) & veio(3))
    ok = na_media & ok
    if p.get("positivo") == "sim":
        ok = ok & favor(c, sh(c, 1))
    return ok


def _cruzamento(x, p):
    c, m = A(x.c), A(x.media(p["media"]))
    c1, m1 = sh(c, 1), sh(m, 1)
    return tem(m1) & (((c1 <= m1) & (c > m)) if p["dir"] == "cima" else ((c1 >= m1) & (c < m)))


def _cruzamento_medias(x, p):
    a, b = A(x.media(p["a"])), A(x.media(p["b"]))
    ok = tem(sh(a, 2)) & tem(sh(b, 2))   # nos últimos 2 candles
    ac = lambda k: sh(a, k) > sh(b, k)
    if p["dir"] == "cima":
        return ok & ac(0) & (~ac(1) | ~ac(2))
    return ok & ~ac(0) & (ac(1) | ac(2))


def _distancia(x, p):
    m = A(x.media(p["media"]))
    with np.errstate(divide="ignore", invalid="ignore"):
        d = (A(x.c) / np.where(m == 0, np.nan, m) - 1) * 100
    lado = d if p["lado"] == "acima" else -d
    if p.get("modo") == "pct":
        return (lado > 0) & (lado >= p["valor"])
    normal = A(x.dn(int(p["media"][3:]))) if p["media"].startswith("sma") else np.full(len(d), np.nan)
    return (lado > 0) & (normal > 0) & (lado >= p["valor"] * normal)


def _ifr(x, p):
    v = A(x.ifr(int(p["n"])))
    return v < p["valor"] if p["op"] == "abaixo" else v > p["valor"]


def _estocastico(x, p):
    k, d = x.estocastico()
    v = A(d if p["linha"] == "d" else k)
    return v < p["valor"] if p["op"] == "abaixo" else v > p["valor"]


def _estoc_cruz(x, p):
    k, d = (A(s) for s in x.estocastico())
    k1, d1 = sh(k, 1), sh(d, 1)
    ok = tem(k) & tem(d) & tem(k1) & tem(d1)
    if p["dir"] == "cima":
        cruzou, zona = (k1 <= d1) & (k > d), np.minimum(k1, d1) < 20
    else:
        cruzou, zona = (k1 >= d1) & (k < d), np.maximum(k1, d1) > 80
    return ok & cruzou & (zona if p.get("zona") == "extremo" else True)


def _bollinger(x, p):
    b = x.bandas()
    c, sup, inf, h, l = A(x.c), A(b["sup"]), A(b["inf"]), A(x.h), A(x.l)
    r = {"fechou_abaixo": lambda: c < inf, "fechou_acima": lambda: c > sup,
         "tocou_inf": lambda: l <= inf, "tocou_sup": lambda: h >= sup,
         "voltou_inf": lambda: (sh(c, 1) < sh(inf, 1)) & (c >= inf),
         "voltou_sup": lambda: (sh(c, 1) > sh(sup, 1)) & (c <= sup)}[p["pos"]]()
    return tem(c) & tem(sup) & tem(inf) & r


def _comprimida(x, p):
    return A(x.bandas()["bbp"]) <= p["valor"]


def _atr(x, p):
    a = A(x.atr())
    return a > p["valor"] if p["op"] == "acima" else a < p["valor"]


def _variacao(x, p):
    v = A(x.var(janela_proxima(R.JANELAS[x.tf]["var"], p["janela"])))
    return v > p["valor"] if p["op"] == "maior" else v < p["valor"]


def _rompimento(x, p):
    ref = A(x.extremo(p["tipo"], janela_proxima(R.JANELAS[x.tf]["ext"], p["janela"])))
    return A(x.c) > ref if p["tipo"] == "max" else A(x.c) < ref


def _perto_extremo(x, p):
    ref = A(x.extremo(p["tipo"], max(R.JANELAS[x.tf]["ext"])))
    if p["tipo"] == "max":
        return A(x.c) >= ref * (1 - p["valor"] / 100)
    return A(x.c) <= ref * (1 + p["valor"] / 100)


def _candle(x, p):
    o, c, h, l = A(x.o), A(x.c), A(x.h), A(x.l)
    o1, c1, h1, l1 = sh(o, 1), sh(c, 1), sh(h, 1), sh(l, 1)
    r = {"alta": lambda: c > c1, "baixa": lambda: c < c1, "gap_alta": lambda: o > h1, "gap_baixa": lambda: o < l1,
         "engolfo_alta": lambda: (c1 < o1) & (c > o) & (c >= o1) & (o <= c1),
         "engolfo_baixa": lambda: (c1 > o1) & (c < o) & (c <= o1) & (o >= c1)}[p["tipo"]]()
    return tem(c1) & r


def _volume(x, p):
    v = A(x.vr())
    return v > p["valor"] if p["op"] == "acima" else v < p["valor"]


CONDICOES = {
    "preco_media": (_preco_media, {"lado": "acima", "media": "sma20"}),
    "media_media": (_media_media, {"a": "sma20", "lado": "acima", "b": "sma50"}),
    "inclinacao": (_inclinacao, {"media": "sma50", "dir": "sobe"}),
    "pullback": (_pullback, {"lado": "compra", "media": "sma20", "modo": "retomada", "positivo": "nao"}),
    "cruzamento": (_cruzamento, {"dir": "cima", "media": "sma20"}),
    "cruzamento_medias": (_cruzamento_medias, {"a": "sma50", "dir": "cima", "b": "sma200"}),
    "distancia": (_distancia, {"lado": "abaixo", "media": "sma20", "valor": 2.5, "modo": "normal"}),
    "ifr": (_ifr, {"n": 14, "op": "abaixo", "valor": 30}),
    "estocastico": (_estocastico, {"linha": "k", "op": "abaixo", "valor": 20}),
    "estoc_cruz": (_estoc_cruz, {"dir": "cima", "zona": "extremo"}),
    "bollinger": (_bollinger, {"pos": "fechou_abaixo"}),
    "comprimida": (_comprimida, {"valor": 10}),
    "atr": (_atr, {"op": "abaixo", "valor": 3}),
    "variacao": (_variacao, {"janela": 21, "op": "menor", "valor": -10}),
    "rompimento": (_rompimento, {"tipo": "max", "janela": 20}),
    "perto_extremo": (_perto_extremo, {"tipo": "max", "valor": 3}),
    "candle": (_candle, {"tipo": "alta"}),
    "volume": (_volume, {"op": "acima", "valor": 1.5}),
    "boca": (lambda x, p: x.externa("boca", p["lado"]), {"lado": "compra"}),
    "multitempo": (lambda x, p: x.externa("mtf", p["lado"]), {"lado": "compra"}),
    "ranking": (lambda x, p: x.externa("rk", p["lado"]), {"lado": "quedas"}),
}


def avaliar_regra(x: Contexto, regra: dict) -> np.ndarray:
    """Uma regra em todos os candles (memorizada: setups repetem regras)."""
    chave = ("regra", json.dumps(regra, sort_keys=True))
    def calc():
        fn, padrao = CONDICOES[regra["t"]]
        r = np.asarray(fn(x, {**padrao, **regra}), dtype=bool)
        return np.broadcast_to(r, (len(x.f),))
    return x._m(chave, calc)


def avaliar(x: Contexto, regras: list[dict], sem: str | None = None) -> pd.Series:
    """True nos candles em que TODAS as regras valem (`sem`: tipo de regra a ignorar)."""
    ok = np.ones(len(x.f), dtype=bool)
    for regra in regras:
        if regra["t"] != sem:
            ok = ok & avaliar_regra(x, regra)
    return pd.Series(ok, index=x.f.index)


# ------------------------------------------------------------- condições calculadas só no Python

def boca(fi: pd.DataFrame) -> dict[str, pd.Series]:
    """Boca de jacaré (a mesma regra do radar antigo): bandas comprimidas nos 10 candles anteriores
    que abrem (superior sobe, inferior desce, largura +5%) com fechamento fora delas. Só o primeiro
    candle de cada abertura."""
    c = fi["Close"]
    abrindo = ((fi["BBsup"] > fi["BBsup"].shift(1)) & (fi["BBinf"] < fi["BBinf"].shift(1))
               & (fi["BBlarg"] > fi["BBlarg"].shift(1) * 1.05)
               & fi["BBcomprimida"].astype(float).shift(1).rolling(10, min_periods=1).max().fillna(0).astype(bool))
    return {"compra": _inicio(abrindo & (c > fi["BBsup"])), "venda": _inicio(abrindo & (c < fi["BBinf"]))}


def _exaustoes(menor: pd.DataFrame, filtro_alta: pd.Series, filtro_baixa: pd.Series, chave) -> dict:
    """Candles do tempo menor em que começa uma exaustão contra o lado, com o tempo maior (filtro
    por dia, já conhecido) a favor. Devolve, por lado, as chaves (dia ou semana) em que aconteceu."""
    dia = menor.index.normalize()
    out = {}
    for lado, filtro in (("compra", filtro_alta), ("venda", filtro_baixa)):
        fl = pd.Series(filtro.reindex(dia, fill_value=False).to_numpy(dtype=bool), index=menor.index)
        ini = _inicio(fl & _exaustao(menor, lado)).to_numpy()
        out[lado] = chave(menor.index[ini])
    return out


def multitempo(d: pd.DataFrame, w: pd.DataFrame, h: pd.DataFrame | None, h4: pd.DataFrame | None) -> dict:
    """Multitempo (indicadores já calculados por estrategias.indicadores).

    Diário: diário em tendência (fechamento de ontem acima/abaixo da MMS 20 e da MMS 50) + exaustão
    no 60 min (estocástico lento < 20 e/ou IFR 14 < 30; venda > 80 / > 70) naquele pregão.
    Semanal: semanal em tendência (última semana fechada) + a mesma exaustão no diário ou no
    4 horas naquela semana. Só o candle em que a exaustão começa conta."""
    alta_d, baixa_d = _tendencia(d)
    ontem = lambda s: s.shift(1, fill_value=False).astype(bool)
    dia = lambda idx: idx.normalize()
    segunda = lambda idx: idx.normalize() - pd.to_timedelta(idx.weekday, unit="D")
    vazio = {"compra": pd.DatetimeIndex([]), "venda": pd.DatetimeIndex([])}

    eventos_d = _exaustoes(h, ontem(alta_d), ontem(baixa_d), dia) if h is not None else vazio
    alta_w, baixa_w = _tendencia(w)
    fechada = lambda s: s.shift(1, fill_value=False).astype(bool).reindex(d.index, method="ffill").fillna(False).astype(bool)
    fa, fb = fechada(alta_w), fechada(baixa_w)
    eventos_w = _exaustoes(d, fa, fb, segunda)
    if h4 is not None:
        e4 = _exaustoes(h4, fa, fb, segunda)
        eventos_w = {lado: eventos_w[lado].union(e4[lado]) for lado in eventos_w}
    return {
        "D": {lado: pd.Series(d.index.isin(ev), index=d.index) for lado, ev in eventos_d.items()},
        "W": {lado: pd.Series(w.index.isin(ev), index=w.index) for lado, ev in eventos_w.items()},
    }


# ------------------------------------------------------------- análise de um ativo

def analisar(df: pd.DataFrame, mercado: str, casas: int, df60: pd.DataFrame | None, liquido: bool,
             ticker: str, catalogo: dict) -> dict:
    """Avalia o catálogo em todo o histórico de um ativo (diário e semanal, candles fechados).

    Devolve: fotos (para data/rastreador.json), eventos recentes (só ativo líquido), o backtest do
    ativo, o resultado no último candle (paridade) e o que o ranking precisa para fechar no fim."""
    q = R.quadros(df, mercado)
    ind = {tf: indicadores(f) for tf, f in q.items()}
    h = indicadores(df60) if df60 is not None and len(df60) >= 60 else None
    h4 = indicadores(para_4h(df60)) if h is not None else None
    mtf = multitempo(ind["D"], ind["W"], h, h4)
    ctxs = {tf: Contexto(f, tf, casas, {"boca": boca(ind[tf]), "mtf": mtf[tf]})
            for tf, f in q.items() if len(f) >= R.MINIMO_CANDLES}

    lista = itens(catalogo)
    sinais = {tf: {s["id"]: avaliar(x, s["regras"]) for s in lista if not tem_ranking(s)} for tf, x in ctxs.items()}
    out = {
        "fotos": {tf: R.foto(x) for tf, x in ctxs.items()},
        "paridade": {tf: [sid for sid, s in por.items() if s.iloc[-1]] for tf, por in sinais.items()},
        "eventos": [], "bt": None, "ranking": {},
    }
    # o que o ranking precisa: variação e as demais regras do setup, nos últimos candles
    for tf, x in ctxs.items():
        c = x.f["Close"]
        n = RANKING_JANELA[tf]
        out["ranking"][tf] = {
            "var": ((c / c.shift(n) - 1) * 100).iloc[-RANKING_HISTORICO:],
            "c": c.iloc[-RANKING_HISTORICO:],
            "regras": {s["id"]: avaliar(x, s["regras"], sem="ranking").iloc[-RANKING_HISTORICO:]
                       for s in lista if tem_ranking(s)},
        }
    if not liquido:
        return out

    vies = {s["id"]: s["vies"] for s in lista}
    testaveis = {tf: {sid: s.to_numpy() for sid, s in por.items() if vies[sid] != "neutro"} for tf, por in sinais.items()}
    out["bt"] = backtest.por_ativo({tf: ctxs[tf].f for tf in ctxs}, testaveis, vies)
    for tf, por in sinais.items():
        f = ctxs[tf].f
        inicio = len(f) - JANELA_EVENTOS[tf]
        for sid, s in por.items():
            for i in np.flatnonzero(s.to_numpy()[inicio:]) + max(inicio, 0):
                out["eventos"].append(evento(ticker, sid, tf, f.index[i], vies[sid], f["Close"].iat[i],
                                             backtest.selo(out["bt"], tf, sid)))
    return out


def evento(ticker, sid, tf, data, lado, preco, bt) -> dict:
    return {"ticker": ticker, "setup": sid, "tf": tf, "data": data.strftime("%Y-%m-%d"), "lado": lado,
            "preco": round(float(preco), 4), "bt": bt}


# ------------------------------------------------------------- ranking (todos os ativos)

def ranking(ativos: list[dict]) -> dict:
    """Maiores quedas e altas de cada mercado, por candle.

    ativos: [{"ticker", "mercado", "liquido", "ranking": {tf: {"var": Series}}}]. Entram no ranking
    só os ativos líquidos; em cada data, cada ativo vale pela última variação conhecida até ela.
    Devolve {(ticker, tf): {"quedas": Series, "altas": Series}} nas datas do próprio ativo."""
    out = {}
    for tf in ("D", "W"):
        for mercado in {a["mercado"] for a in ativos}:
            grupo = [a for a in ativos if a["mercado"] == mercado and a["liquido"] and tf in a["ranking"]]
            if not grupo:
                continue
            tabela = pd.DataFrame({a["ticker"]: a["ranking"][tf]["var"] for a in grupo}).sort_index().ffill()
            validos = tabela.notna().sum(axis=1)
            n = (validos * RANKING_FATIA).round().clip(*RANKING_N)
            quedas = (tabela.rank(axis=1, method="first").le(n, axis=0)) & (tabela <= -RANKING_MINIMO[tf])
            altas = (tabela.rank(axis=1, method="first", ascending=False).le(n, axis=0)) & (tabela >= RANKING_MINIMO[tf])
            for a in grupo:
                idx = a["ranking"][tf]["var"].index
                out[(a["ticker"], tf)] = {"quedas": quedas[a["ticker"]].reindex(idx, fill_value=False),
                                          "altas": altas[a["ticker"]].reindex(idx, fill_value=False)}
    return out


def aplicar_ranking(ativos: list[dict], catalogo: dict) -> list[dict]:
    """Fecha os setups de ranking depois que todos os ativos foram processados.

    ativos: [{"ticker", "mercado", "liquido", "ranking", "fotos", "paridade"}] (o que analisar()
    devolveu). Grava nas fotos o ranking por candle ("rk"), completa a paridade do último candle e
    devolve os eventos (só de ativo líquido; sem backtest)."""
    rk = ranking(ativos)
    com_ranking = [s for s in itens(catalogo) if tem_ranking(s)]
    eventos = []
    for a in ativos:
        for tf, dados in a["ranking"].items():
            idx = dados["var"].index
            lados = rk.get((a["ticker"], tf)) or {l: pd.Series(False, index=idx) for l in ("quedas", "altas")}
            if a["fotos"].get(tf):
                a["fotos"][tf]["rk"] = {l: R.bits(s) for l, s in lados.items()}
            for s in com_ranking:
                ok = dados["regras"][s["id"]].copy()
                for regra in s["regras"]:
                    if regra["t"] == "ranking":
                        ok &= lados[regra.get("lado", "quedas")].astype(bool)
                if ok.iloc[-1]:
                    a["paridade"][tf].append(s["id"])
                if a["liquido"]:
                    janela = ok.iloc[-JANELA_EVENTOS[tf]:]
                    for d in janela.index[janela.to_numpy()]:
                        eventos.append(evento(a["ticker"], s["id"], tf, d, s["vies"], dados["c"][d], None))
    return eventos
