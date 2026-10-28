"""Backtest dos setups do catálogo (config/setups.json).

Para cada ativo, refaz todas as vezes que cada setup disparou no histórico (6 anos, candles
fechados, diário e semanal) e mede o que aconteceu depois:

- entrada na ABERTURA do candle seguinte ao sinal (o site publica depois do fechamento);
- saída no FECHAMENTO depois de N candles: 5, 10 e 20 pregões (sinal diário) ou 4, 8 e 13 semanas
  (sinal semanal). Em setup de venda o resultado é invertido (ganha se o preço cair);
- sem sobreposição: depois de um sinal, novos sinais do mesmo setup dentro da janela principal são
  ignorados, para não contar o mesmo movimento várias vezes (um setup que fica valendo vários
  candles seguidos conta uma vez por janela);
- comparação com a "média de qualquer dia" do mesmo ativo e prazo (vantagem): em mercado de alta
  quase toda compra dá lucro, e a vantagem mostra se o sinal acrescenta algo além disso.

Setups neutros (sem lado) e o ranking (depende de todos os ativos) ficam de fora.
Não inclui custos, impostos nem deslizamento. Resultado passado não garante resultado futuro.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd

HORIZONTES = {"D": (5, 10, 20), "W": (4, 8, 13)}
PRINCIPAL = {"D": 10, "W": 8}
MIN_CASOS = 5   # abaixo disso a taxa de acerto não quer dizer muito
SINAL = {"compra": 1, "venda": -1}


def _estatisticas(retornos, base: float | None) -> dict:
    r = np.asarray(retornos, dtype=float)
    if not len(r):
        return {"n": 0}
    medio = float(r.mean())
    return {
        "n": int(len(r)),
        "acerto": round(float((r > 0).mean() * 100), 1),
        "medio": round(medio * 100, 2),
        "mediana": round(float(np.median(r)) * 100, 2),
        "pior": round(float(r.min()) * 100, 2),
        "melhor": round(float(r.max()) * 100, 2),
        "vantagem": round((medio - base) * 100, 2) if base is not None else None,
    }


def _preco(v: float) -> float:
    """Preço com 6 algarismos significativos (cripto de centavos e ações de milhares cabem)."""
    return float(f"{float(v):.6g}")


def _sem_sobreposicao(indices: np.ndarray, passo: int) -> np.ndarray:
    """Sinais aproveitados: depois de um, o próximo só vale `passo` candles depois."""
    sel, i = [], 0
    while i < len(indices):
        sel.append(indices[i])
        i = int(np.searchsorted(indices, indices[i] + passo, side="left"))
    return np.asarray(sel, dtype=int)


def por_ativo(frames: dict[str, pd.DataFrame], sinais: dict[str, dict[str, np.ndarray]], vies: dict[str, str]) -> dict:
    """Backtest de um ativo (roda no processo do ativo). sinais: {tf: {setup: bool por candle}}.

    Devolve os retornos por (tf, setup, H) e a base de "qualquer dia" por (tf, H), para o
    agregado do mercado, o resumo do ativo no prazo principal por tf e setup e os casos (cada
    sinal aproveitado, no prazo principal) para o site mostrar um a um."""
    out = {"retornos": {}, "base": {}, "resumo": {}, "casos": {}}
    for tf, f in frames.items():
        abre, fecha = f["Open"].to_numpy(dtype=float), f["Close"].to_numpy(dtype=float)
        datas = f.index.strftime("%Y-%m-%d")
        n, P = len(f), PRINCIPAL[tf]
        bases = {}
        for h in HORIZONTES[tf]:
            # retorno de "qualquer dia": sinal no candle i, entrada abre[i + 1], saída fecha[i + h]
            if n > h + 1:
                r = fecha[h:] / abre[1:n - h + 1] - 1
                r = r[np.isfinite(r)]
                bases[h] = float(r.mean()) if len(r) else None
                out["base"][(tf, h)] = (float(r.sum()), len(r))
        for sid, cond in sinais.get(tf, {}).items():
            # só conta o sinal que tem pelo menos o prazo mais curto pela frente
            idx = np.flatnonzero(cond)
            idx = _sem_sobreposicao(idx[idx + min(HORIZONTES[tf]) < n], P)
            if not len(idx):
                continue
            s = SINAL[vies[sid]]
            for h in HORIZONTES[tf]:
                ok = idx[idx + h < n]
                r = s * (fecha[ok + h] / abre[ok + 1] - 1)
                out["retornos"][(tf, sid, h)] = r[np.isfinite(r)]
            rp = out["retornos"][(tf, sid, P)]
            # caso a caso: [data do sinal, entrada (abertura seguinte), data da saída, saída (fechamento P depois), resultado %]
            ok = idx[idx + P < n]
            casos = [[datas[i], _preco(abre[i + 1]), datas[i + P], _preco(fecha[i + P]), round(float(s * (fecha[i + P] / abre[i + 1] - 1)) * 100, 2)]
                     for i in ok if np.isfinite(abre[i + 1]) and np.isfinite(fecha[i + P]) and abre[i + 1] > 0]
            if casos:
                out["casos"].setdefault(tf, {})[sid] = casos
            if len(rp):
                base = bases.get(P)
                out["resumo"].setdefault(tf, {})[sid] = _estatisticas(rp, None if base is None else s * base)
    return out


def selo(bt: dict | None, tf: str, sid: str) -> list | None:
    """[casos, acerto %, retorno médio %, vantagem %] do setup neste ativo (só casos, se forem poucos)."""
    e = (bt or {}).get("resumo", {}).get(tf, {}).get(sid)
    if not e:
        return None
    if e["n"] < MIN_CASOS:
        return [e["n"], None, None, None]
    return [e["n"], e["acerto"], e["medio"], e["vantagem"]]


class Backtest:
    """Junta o backtest de todos os ativos por mercado (e no geral, para o catálogo)."""

    def __init__(self, vies: dict[str, str]):
        self.vies = vies
        self.retornos = defaultdict(list)            # (mercado, tf, setup, H) -> [arrays]
        self.base = defaultdict(lambda: [0.0, 0])    # (mercado, tf, H) -> [soma, n]
        self.ativos: dict[str, dict] = {}

    def adicionar(self, ticker: str, mercado: str, bt: dict) -> None:
        for (tf, sid, h), r in bt["retornos"].items():
            self.retornos[(mercado, tf, sid, h)].append(r)
        for (tf, h), (soma, n) in bt["base"].items():
            b = self.base[(mercado, tf, h)]
            b[0] += soma
            b[1] += n
        self.ativos[ticker] = bt["resumo"]

    def _base(self, mercados, tf, h, sid) -> float | None:
        soma = sum(self.base[(m, tf, h)][0] for m in mercados)
        n = sum(self.base[(m, tf, h)][1] for m in mercados)
        return SINAL[self.vies[sid]] * soma / n if n else None

    def resultado(self) -> dict:
        mercados = {}
        for (mercado, tf, sid, h), rets in self.retornos.items():
            linhas = mercados.setdefault(mercado, {}).setdefault(tf, {})
            linhas.setdefault(sid, {"setup": sid, "h": {}})["h"][str(h)] = _estatisticas(
                np.concatenate(rets), self._base([mercado], tf, h, sid))

        def ordem(x, tf):
            e = x["h"].get(str(PRINCIPAL[tf]), {})
            # setups com poucos casos vão para o fim, por mais bonitos que pareçam
            return (e.get("n", 0) < MIN_CASOS, -(e.get("vantagem") if e.get("vantagem") is not None else -1e9))
        saida = {m: {tf: sorted(l.values(), key=lambda x: ordem(x, tf)) for tf, l in por_tf.items()}
                 for m, por_tf in mercados.items()}
        base = {}
        for (mercado, tf, h), (soma, n) in self.base.items():
            base.setdefault(mercado, {}).setdefault(tf, {})[str(h)] = round(soma / n * 100, 2) if n else None
        return {
            "horizontes": HORIZONTES, "principal": PRINCIPAL, "min_casos": MIN_CASOS,
            "mercados": saida, "base": base, "ativos": self.ativos,
        }

    def por_setup(self) -> dict[str, dict]:
        """Todos os mercados juntos, no prazo principal: {setup: {tf: estatísticas}} (para data/setups.json)."""
        todos = {m for m, *_ in self.base}
        juntos = defaultdict(list)
        for (mercado, tf, sid, h), rets in self.retornos.items():
            if h == PRINCIPAL[tf]:
                juntos[(tf, sid)] += rets
        out = {}
        for (tf, sid), rets in juntos.items():
            r = np.concatenate(rets)
            if len(r):
                out.setdefault(sid, {})[tf] = _estatisticas(r, self._base(todos, tf, PRINCIPAL[tf], sid))
        return out
