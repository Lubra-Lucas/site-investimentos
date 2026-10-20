"""Backtest das estratégias do radar.

Para cada ativo, refaz todas as vezes que cada estratégia disparou no histórico (6 anos) e mede o
que aconteceu depois:

- entrada na ABERTURA do candle seguinte ao sinal (o site publica depois do fechamento);
- saída no FECHAMENTO depois de N candles: 5, 10 e 20 pregões (sinal diário) ou 4, 8 e 13 semanas
  (sinal semanal). Na venda o resultado é invertido (ganha se o preço cair);
- sem sobreposição: depois de um sinal, novos sinais da mesma estratégia e lado dentro da janela
  principal são ignorados, para não contar o mesmo movimento várias vezes;
- comparação com a "média de qualquer dia" do mesmo ativo e prazo (vantagem): em mercado de alta
  quase toda compra dá lucro, e a vantagem mostra se o sinal acrescenta algo além disso.

Não inclui custos, impostos nem deslizamento. Resultado passado não garante resultado futuro.
"""

from __future__ import annotations

import re
from collections import defaultdict

import numpy as np

HORIZONTES = {"D": (5, 10, 20), "S": (4, 8, 13)}
PRINCIPAL = {"D": 10, "S": 8}
MIN_CASOS = 5   # abaixo disso a taxa de acerto não quer dizer muito


def variante(familia: str, texto: str) -> str:
    """Agrupamento fino para o ranking: no pullback separa média, tipo e fechamento a favor."""
    if familia != "pullback":
        return familia
    return re.sub(r"\s*\(\d candles?\)", "", texto)


def _estatisticas(retornos: list[float], base: float | None) -> dict:
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


class Backtest:
    def __init__(self):
        # (mercado, tf, lado, familia, variante, H) -> retornos ; (mercado, tf, H) -> [soma, n] da base
        self.retornos = defaultdict(list)
        self.base_mercado = defaultdict(lambda: [0.0, 0])
        self.por_ativo: dict[str, dict] = {}

    def adicionar(self, ticker: str, mercado: str, historico: dict) -> None:
        frames, eventos = historico["frames"], historico["eventos"]
        bases, ativo = {}, defaultdict(lambda: defaultdict(list))
        for tf, f in frames.items():
            abre, fecha = f["Open"].to_numpy(dtype=float), f["Close"].to_numpy(dtype=float)
            for h in HORIZONTES[tf]:
                # retorno de "qualquer dia": entra na abertura seguinte e sai h candles depois
                if len(f) > h + 1:
                    # sinal no candle i: entrada abre[i + 1], saída fecha[i + h]
                    r = fecha[h:] / abre[1:len(f) - h + 1] - 1
                    r = r[np.isfinite(r)]
                    bases[(tf, h)] = float(r.mean()) if len(r) else None
                    soma = self.base_mercado[(mercado, tf, h)]
                    soma[0] += float(r.sum()); soma[1] += len(r)

        ultimo_usado: dict[tuple, int] = {}
        posicoes = {tf: {d: i for i, d in enumerate(f.index)} for tf, f in frames.items()}
        for data, tf, lado, familia, texto in sorted(eventos, key=lambda e: (e[0], e[1])):
            i = posicoes[tf].get(data)
            if i is None:
                continue
            chave = (tf, lado, familia)
            if chave in ultimo_usado and i - ultimo_usado[chave] < PRINCIPAL[tf]:
                continue  # mesmo movimento: não conta de novo
            f = frames[tf]
            sinal = 1 if lado == "compra" else -1
            usado = False
            for h in HORIZONTES[tf]:
                if i + h >= len(f):
                    continue
                entrada, saida = f["Open"].iat[i + 1], f["Close"].iat[i + h]
                if not (entrada > 0 and np.isfinite(saida)):
                    continue
                r = sinal * (saida / entrada - 1)
                self.retornos[(mercado, tf, lado, familia, variante(familia, texto), h)].append(r)
                if h == PRINCIPAL[tf]:
                    ativo[(tf, familia, lado)][h].append(r)
                    usado = True
            if usado:
                ultimo_usado[chave] = i

        resumo = {}
        for (tf, familia, lado), por_h in ativo.items():
            base = bases.get((tf, PRINCIPAL[tf]))
            base = None if base is None else (base if lado == "compra" else -base)
            resumo.setdefault(tf, {}).setdefault(familia, {})[lado] = _estatisticas(por_h[PRINCIPAL[tf]], base)
        self.por_ativo[ticker] = resumo

    def do_sinal(self, ticker: str, tf: str, familia: str, lado: str) -> list | None:
        """[casos, acerto %, retorno médio %, vantagem %] do ativo nesta estratégia, se houver casos suficientes."""
        e = self.por_ativo.get(ticker, {}).get(tf, {}).get(familia, {}).get(lado)
        if not e or e["n"] < MIN_CASOS:
            return [e["n"], None, None, None] if e else None
        return [e["n"], e["acerto"], e["medio"], e["vantagem"]]

    def resultado(self) -> dict:
        mercados = {}
        for (mercado, tf, lado, familia, var, h), rets in self.retornos.items():
            soma, n = self.base_mercado[(mercado, tf, h)]
            base = soma / n if n else None
            base = None if base is None else (base if lado == "compra" else -base)
            linhas = mercados.setdefault(mercado, {}).setdefault(tf, {}).setdefault(lado, {})
            linha = linhas.setdefault((familia, var), {"familia": familia, "variante": var, "h": {}})
            linha["h"][str(h)] = _estatisticas(rets, base)
        def ordem(x, tf):
            e = x["h"].get(str(PRINCIPAL[tf]), {})
            # estratégias com poucos casos vão para o fim, por mais bonitas que pareçam
            return (e.get("n", 0) < MIN_CASOS, -(e.get("vantagem") if e.get("vantagem") is not None else -1e9))
        saida = {m: {tf: {lado: sorted(l.values(), key=lambda x: ordem(x, tf))
                          for lado, l in por_lado.items()} for tf, por_lado in por_tf.items()} for m, por_tf in mercados.items()}
        base = {}
        for (mercado, tf, h), (soma, n) in self.base_mercado.items():
            base.setdefault(mercado, {}).setdefault(tf, {})[str(h)] = round(soma / n * 100, 2) if n else None
        return {
            "horizontes": HORIZONTES, "principal": PRINCIPAL, "min_casos": MIN_CASOS,
            "mercados": saida, "base": base, "ativos": self.por_ativo,
        }
