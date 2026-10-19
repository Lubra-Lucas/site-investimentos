"""Verificação de integridade dos candles antes de publicar.

Regra geral: na dúvida, o dado não entra. Um candle suspeito é descartado (não
"consertado"), e um ativo cujo fechamento não bate com a fonte de referência é
retido inteiro, sem gráfico nem sinais, até a próxima atualização.
"""

from __future__ import annotations

import pandas as pd

TOLERANCIA_FECHAMENTO = 0.006   # 0,6% de diferença máxima para a fonte de referência
DIAS_CONFERIDOS = 5             # quantos pregões recentes comparar com a referência
SALTO_ACAO, SALTO_CRIPTO = 0.20, 0.30
QUEBRA_ACAO, QUEBRA_CRIPTO = 0.40, 0.60  # gap maior que isso = quebra de série (grupamento, reestruturação)
MAX_CORRECOES_RECENTES = 3      # mais que isso nos últimos 60 pregões => dados instáveis
DIAS_SEM_PREGAO = 5             # último candle mais velho que isso => desatualizado


def limpar(df: pd.DataFrame, mercado: str) -> tuple[pd.DataFrame, list[tuple[pd.Timestamp, str]]]:
    """Remove candles impossíveis ou com cara de erro de cotação."""
    problemas: list[tuple[pd.Timestamp, str]] = []
    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]

    def descartar(mascara: pd.Series, motivo: str):
        nonlocal df
        mascara = mascara.reindex(df.index, fill_value=False)
        for d in df.index[mascara]:
            problemas.append((d, motivo))
        df = df[~mascara]

    descartar(df[["Open", "High", "Low", "Close"]].isna().any(axis=1), "OHLC incompleto")
    descartar((df[["Open", "High", "Low", "Close"]] <= 0).any(axis=1), "preço zero ou negativo")
    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]
    tol = 1e-6
    descartar((h < pd.concat([o, c], axis=1).max(axis=1) * (1 - tol))
              | (l > pd.concat([o, c], axis=1).min(axis=1) * (1 + tol)), "máxima/mínima incoerentes")

    if mercado != "CRIPTO":
        # Candle "fantasma" de feriado: sem negócio e com O=H=L=C
        o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]
        descartar((df["Volume"].fillna(0) == 0) & (h == l) & (o == c), "pregão sem negócios")

    # Pico isolado: salta e volta no dia seguinte (erro de cotação, não movimento real).
    # O limite acompanha a volatilidade do ativo para não cortar movimentos reais de papéis voláteis.
    c = df["Close"]
    ida = c / c.shift(1) - 1
    vol_normal = ida.abs().rolling(60, min_periods=20).median().shift(1)
    lim = (vol_normal * 8).clip(lower=SALTO_CRIPTO if mercado == "CRIPTO" else SALTO_ACAO)
    volta = c.shift(-1) / c - 1
    liquido = (c.shift(-1) / c.shift(1) - 1).abs()
    descartar((ida.abs() > lim) & (volta.abs() > lim) & (ida * volta < 0) & (liquido < lim / 3),
              "pico isolado de preço")

    # Pavio absurdo: máxima/mínima muito longe do corpo comparado à volatilidade normal
    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]
    amplitude = ((h - l) / c).rolling(20, min_periods=5).median().shift(1)
    limite = (amplitude * 6).clip(lower=0.10)
    corpo_max = pd.concat([o, c], axis=1).max(axis=1)
    corpo_min = pd.concat([o, c], axis=1).min(axis=1)
    descartar((h / corpo_max - 1 > limite) | (1 - l / corpo_min > limite), "pavio fora do padrão")

    # Quebra de série: gap gigante sem volume que o justifique. O histórico anterior não é comparável
    # (ex.: grupamento não ajustado, incorporação), então o gráfico começa depois dela.
    # Movimento real de notícia vem com volume muito acima do normal; quebra técnica, não.
    quebra = QUEBRA_CRIPTO if mercado == "CRIPTO" else QUEBRA_ACAO
    vol_normal = df["Volume"].rolling(20, min_periods=5).median().shift(1)
    sem_fluxo = ~(df["Volume"] > vol_normal * 3)
    saltos = ((df["Close"] / df["Close"].shift(1) - 1).abs() > quebra) & sem_fluxo
    if saltos.any():
        ultima = df.index[saltos][-1]
        problemas.append((ultima, f"quebra de série ({df['Close'].shift(1)[ultima]:.2f} → "
                                  f"{df['Close'][ultima]:.2f}); histórico anterior descartado"))
        df = df[df.index >= ultima]

    return df, problemas


def conferir(df: pd.DataFrame, ref: dict[str, float] | None) -> dict:
    """Compara os últimos fechamentos com a fonte de referência."""
    if not ref:
        return {"status": "interno", "comparados": 0, "dif_max_pct": None}
    datas = [d.strftime("%Y-%m-%d") for d in df.index[-DIAS_CONFERIDOS:]]
    difs = {d: abs(float(df.loc[d, "Close"]) / ref[d] - 1) for d in datas if d in ref}
    if not difs:
        return {"status": "interno", "comparados": 0, "dif_max_pct": None}
    pior = max(difs, key=difs.get)
    status = "conferido" if difs[pior] <= TOLERANCIA_FECHAMENTO else "divergente"
    return {
        "status": status,
        "comparados": len(difs),
        "dif_max_pct": round(difs[pior] * 100, 3),
        "pior_dia": pior,
        "yahoo": round(float(df.loc[pior, "Close"]), 4),
        "referencia": ref[pior],
    }


def avaliar(df_bruto: pd.DataFrame, mercado: str, ref: dict[str, float] | None,
            hoje: pd.Timestamp) -> tuple[pd.DataFrame, dict]:
    """Limpa e confere um ativo. Retorna o df limpo e o laudo (com 'publicar')."""
    df, problemas = limpar(df_bruto, mercado)
    problemas.sort()
    laudo = {"correcoes": [f"{d:%d/%m/%Y}: {m}" for d, m in problemas[-10:]], "n_correcoes": len(problemas)}
    if len(df) < 60:
        return df, {**laudo, "publicar": False, "motivo": "histórico insuficiente"}

    recentes = sum(1 for d, _ in problemas if d >= df.index[-60])
    if recentes > MAX_CORRECOES_RECENTES:
        return df, {**laudo, "publicar": False, "motivo": f"{recentes} candles inválidos nos últimos 60 pregões"}

    if (hoje - df.index[-1]).days > DIAS_SEM_PREGAO:
        return df, {**laudo, "publicar": False, "motivo": f"sem cotação desde {df.index[-1]:%d/%m/%Y}"}

    conf = conferir(df, ref)
    laudo["conferencia"] = conf
    if conf["status"] == "divergente":
        return df, {**laudo, "publicar": False,
                    "motivo": (f"fechamento de {pd.Timestamp(conf['pior_dia']):%d/%m} diverge "
                               f"{conf['dif_max_pct']:.2f}% da referência "
                               f"({conf['yahoo']} x {conf['referencia']})")}
    return df, {**laudo, "publicar": True}
