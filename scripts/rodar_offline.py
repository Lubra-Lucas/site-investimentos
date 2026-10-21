"""Roda atualizar_dados.py SEM rede, com dados sintéticos (para os testes do GitHub Actions).

Cada ticker do universo ganha um passeio aleatório determinístico (semente = o próprio ticker),
com regimes de alta e de baixa: candles de 60 min nos últimos ~6 meses e diários de 6 anos,
coerentes entre si (o diário é a soma do intraday). Yahoo, Nasdaq, B3 e Coinbase são trocados
por stubs (inclusive o módulo yfinance), então nada sai da máquina. Depois é só rodar
scripts/testar_paridade.py sobre o data/ gerado.

Uso: python scripts/rodar_offline.py
"""

from __future__ import annotations

import sys
import types
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
# o yfinance de verdade não é usado (nem precisa estar instalado)
yf = types.ModuleType("yfinance")
yf.download = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("sem rede no teste offline"))
sys.modules["yfinance"] = yf

import atualizar_dados  # noqa: E402
import fontes  # noqa: E402

ANOS = 6
DIAS_INTRADAY = 130
HORAS = {"BR": range(10, 17), "US": range(10, 16), "CRIPTO": range(0, 24), "MACRO": range(9, 17)}
_CACHE: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
_MERCADO: dict[str, str] = {}


def _sintetico(tk: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(diário, 60 min) de um ticker, sempre os mesmos para o mesmo ticker."""
    if tk in _CACHE:
        return _CACHE[tk]
    mercado = _MERCADO.get(tk, "US")
    rng = np.random.default_rng(zlib.crc32(tk.encode()))
    hoje = pd.Timestamp.today().normalize()
    inicio = hoje - pd.DateOffset(years=ANOS)
    dias = pd.date_range(inicio, hoje, freq="D" if mercado == "CRIPTO" else "B")
    horas = list(HORAS[mercado])
    nh = len(horas)
    # retorno diário: volatilidade do ativo + tendência que muda a cada ~2 a 6 meses
    vol = rng.uniform(0.012, 0.035)
    regimes = np.repeat(rng.normal(0, 0.0025, len(dias) // 40 + 1), rng.integers(40, 120, len(dias) // 40 + 1))
    tendencia = np.resize(regimes, len(dias))
    ret_h = rng.normal(np.repeat(tendencia / nh, nh), vol / np.sqrt(nh))
    preco0 = float(np.exp(rng.uniform(np.log(3), np.log(300))))
    fech = preco0 * np.exp(np.cumsum(ret_h))
    abre = np.concatenate([[preco0], fech[:-1]]) * np.exp(rng.normal(0, vol / 10, len(fech)))
    amp = np.abs(rng.normal(0, vol / np.sqrt(nh) / 2, (2, len(fech))))
    alta = np.maximum(abre, fech) * (1 + amp[0])
    baixa = np.minimum(abre, fech) * (1 - amp[1])
    volume = np.round(rng.lognormal(np.log(2e6 / nh), 0.5, len(fech)))
    idx = pd.DatetimeIndex(np.repeat(dias.values, nh)) + pd.to_timedelta(np.tile(horas, len(dias)), unit="h")
    h = pd.DataFrame({"Open": abre, "High": alta, "Low": baixa, "Close": fech, "Volume": volume}, index=idx)
    d = h.groupby(h.index.normalize()).agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"})
    _CACHE[tk] = (d, h[h.index >= hoje - pd.Timedelta(days=DIAS_INTRADAY)])
    return _CACHE[tk]


def main() -> None:
    ativos = atualizar_dados.montar_lista(__import__("json").loads(atualizar_dados.CONFIG.read_text(encoding="utf-8")))
    _MERCADO.update({tk: a["mercado"] for tk, a in ativos.items()})
    _MERCADO[atualizar_dados.TICKER_CAMBIO] = "CRIPTO"   # câmbio negocia todo dia útil e fim de semana não importa
    fontes.baixar_yahoo = lambda tickers, *a, **k: {tk: _sintetico(tk)[0] for tk in tickers}
    fontes.referencias = lambda lista: {}
    fontes.baixar_yahoo_60min = lambda tickers, fuso: {tk: _sintetico(tk)[1] for tk in tickers}
    atualizar_dados.main()


if __name__ == "__main__":
    main()
