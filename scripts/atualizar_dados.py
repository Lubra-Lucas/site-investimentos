"""Atualização diária: baixa cotações, verifica a integridade, roda as
estratégias do radar e consolida a carteira em BRL.

Saída (lida pelo front-end estático):
  data/ativos/<TICKER>.json  -> candles diários verificados (só ativos aprovados)
  data/radar.json            -> estado de cada ativo, sinais datados e dados retidos
  data/resumo.json           -> carteira consolidada

Uso:  python scripts/atualizar_dados.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import estrategias
import fontes
import validacao
from estrategias import _num, _var

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "config" / "carteira.json"
UNIVERSO = RAIZ / "config" / "universo.json"
SAIDA = RAIZ / "data"
SAIDA_ATIVOS = SAIDA / "ativos"
SAIDA_INTRADAY = SAIDA / "intraday"
TICKER_CAMBIO = "USDBRL=X"
MOEDA = {"BR": "BRL", "US": "USD", "CRIPTO": "USD"}


def intraday_compacto(h: pd.DataFrame) -> list[list]:
    """Horário local da bolsa como se fosse UTC: o gráfico mostra a hora do pregão."""
    casas = 2 if h["Close"].min() >= 1 else 6
    epoch = (h.index - pd.Timestamp("1970-01-01")) // pd.Timedelta(seconds=1)
    return [[int(t), round(r.Open, casas), round(r.High, casas), round(r.Low, casas), round(r.Close, casas)]
            for t, r in zip(epoch, h.itertuples())]


def candles_compactos(df: pd.DataFrame) -> list[list]:
    casas = 2 if df["Close"].min() >= 1 else 6
    return [[d.strftime("%Y-%m-%d"), round(r.Open, casas), round(r.High, casas),
             round(r.Low, casas), round(r.Close, casas)] for d, r in df.iterrows()]


# ------------------------------------------------------------------- carteira

def consolidar_carteira(cfg: dict, precos: dict[str, pd.DataFrame], cambio: pd.Series,
                        retidos: set[str]) -> dict:
    moedas = {a["ticker"]: a["moeda"] for a in cfg["ativos"]}
    mercados = {a["ticker"]: a["mercado"] for a in cfg["ativos"]}

    def taxa(moeda: str, data: pd.Timestamp) -> float:
        if moeda == "BRL":
            return 1.0
        return float(cambio[cambio.index <= data].iloc[-1]) if (cambio.index <= data).any() else float(cambio.iloc[0])

    transacoes = sorted(cfg.get("transacoes", []), key=lambda t: t["data"])
    caixa = float(cfg.get("capital_inicial", 0))
    posicoes: dict[str, dict] = {}
    for t in transacoes:
        tk = t["ticker"]
        data = pd.Timestamp(t["data"])
        fx = float(t.get("cambio") or taxa(moedas.get(tk, "BRL"), data))
        qtd = float(t["quantidade"])
        bruto = qtd * float(t["preco"])
        taxas = float(t.get("taxas", 0))
        p = posicoes.setdefault(tk, {"quantidade": 0.0, "custo_brl": 0.0, "custo_moeda": 0.0})
        if t.get("tipo", "compra") == "compra":
            p["quantidade"] += qtd
            p["custo_brl"] += bruto * fx + taxas
            p["custo_moeda"] += bruto
            caixa -= bruto * fx + taxas
        else:  # venda: baixa o custo pelo preço médio
            frac = qtd / p["quantidade"] if p["quantidade"] else 0
            p["custo_brl"] -= p["custo_brl"] * frac
            p["custo_moeda"] -= p["custo_moeda"] * frac
            p["quantidade"] -= qtd
            caixa += bruto * fx - taxas

    hoje = pd.Timestamp.today().normalize()
    inicio_mes = hoje.replace(day=1)
    inicio_ano = hoje.replace(month=1, day=1)
    fx_hoje = float(cambio.iloc[-1])

    linhas = []
    total_mercado = 0.0
    for tk, p in posicoes.items():
        if p["quantidade"] <= 1e-12 or tk not in precos:
            continue
        close = precos[tk]["Close"]
        moeda = moedas.get(tk, "BRL")
        fx = 1.0 if moeda == "BRL" else fx_hoje
        valor = p["quantidade"] * float(close.iloc[-1]) * fx
        total_mercado += valor
        linhas.append({
            "ticker": tk,
            "mercado": mercados.get(tk),
            "moeda": moeda,
            "quantidade": _num(p["quantidade"], 8),
            "preco_medio": _num(p["custo_moeda"] / p["quantidade"], 4),
            "preco_atual": _num(close.iloc[-1], 4),
            "custo_brl": _num(p["custo_brl"], 2),
            "valor_brl": _num(valor, 2),
            "resultado_brl": _num(valor - p["custo_brl"], 2),
            "resultado_pct": _num((valor / p["custo_brl"] - 1) * 100, 2) if p["custo_brl"] else None,
            "var_mes_pct": _var(close, inicio_mes),
            "var_ano_pct": _var(close, inicio_ano),
            "verificado": tk not in retidos,
        })
    for linha in linhas:
        linha["peso_pct"] = _num(linha["valor_brl"] / total_mercado * 100, 2) if total_mercado else 0

    patrimonio = total_mercado + caixa
    capital = float(cfg.get("capital_inicial", 0))
    alocacao: dict[str, float] = {}
    for linha in linhas:
        alocacao[linha["mercado"]] = alocacao.get(linha["mercado"], 0) + linha["valor_brl"]
    alocacao["CAIXA"] = caixa

    return {
        "capital_inicial": capital,
        "caixa_brl": _num(caixa, 2),
        "investido_brl": _num(total_mercado, 2),
        "patrimonio_brl": _num(patrimonio, 2),
        "resultado_brl": _num(patrimonio - capital, 2),
        "resultado_pct": _num((patrimonio / capital - 1) * 100, 2) if capital else None,
        "alocacao_brl": {k: _num(v, 2) for k, v in alocacao.items()},
        "posicoes": sorted(linhas, key=lambda l: -l["valor_brl"]),
        "historico": historico_patrimonio(cfg, transacoes, precos, cambio, moedas),
    }


def historico_patrimonio(cfg, transacoes, precos, cambio, moedas) -> list[dict]:
    """Patrimônio diário (BRL) desde a primeira transação, para a curva da carteira."""
    if not transacoes:
        return []
    inicio = pd.Timestamp(transacoes[0]["data"])
    dias = pd.bdate_range(inicio, pd.Timestamp.today().normalize())
    fx = cambio.reindex(dias, method="ffill").bfill()
    caixa = pd.Series(float(cfg.get("capital_inicial", 0)), index=dias)
    valor = pd.Series(0.0, index=dias)
    for tk in {t["ticker"] for t in transacoes}:
        if tk not in precos:
            continue
        qtd = pd.Series(0.0, index=dias)
        for t in transacoes:
            if t["ticker"] != tk:
                continue
            sinal = 1 if t.get("tipo", "compra") == "compra" else -1
            data = pd.Timestamp(t["data"])
            q = float(t["quantidade"])
            taxa_fx = float(t.get("cambio") or (1.0 if moedas.get(tk) == "BRL" else fx.asof(data)))
            qtd[qtd.index >= data] += sinal * q
            caixa[caixa.index >= data] -= sinal * q * float(t["preco"]) * taxa_fx + float(t.get("taxas", 0))
        close = precos[tk]["Close"].reindex(dias, method="ffill")
        mult = 1.0 if moedas.get(tk) == "BRL" else fx
        valor += (qtd * close * mult).fillna(0)
    total = valor + caixa
    return [{"time": d.strftime("%Y-%m-%d"), "value": _num(v, 2)} for d, v in total.items()]


# ----------------------------------------------------------------------- main

def montar_lista(cfg: dict) -> dict[str, dict]:
    ativos: dict[str, dict] = {}
    universo = json.loads(UNIVERSO.read_text(encoding="utf-8"))
    for mercado, lista in universo.items():
        for a in lista:
            ativos[a["ticker"]] = {**a, "mercado": mercado, "moeda": MOEDA[mercado], "carteira": False}
    for a in cfg["ativos"]:
        ativos[a["ticker"]] = {**ativos.get(a["ticker"], {}), **a, "carteira": True}
    for t in cfg.get("transacoes", []):
        if t["ticker"] not in ativos:
            raise SystemExit(f"{t['ticker']} está em transacoes mas não em ativos")
    return ativos


def main() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    ativos = montar_lista(cfg)
    for pasta in (SAIDA_ATIVOS, SAIDA_INTRADAY):
        pasta.mkdir(parents=True, exist_ok=True)
        for antigo in pasta.glob("*.json"):
            antigo.unlink()  # ativo retido hoje não pode ficar com gráfico de ontem
    hoje = pd.Timestamp.today().normalize()

    print(f"Baixando {len(ativos)} ativos do Yahoo...")
    brutos = fontes.baixar_yahoo([*ativos, TICKER_CAMBIO])
    print("Buscando fechamentos de referência...")
    refs = fontes.referencias(list(ativos.values()))
    print("Baixando candles de 60 min...")
    intraday = {}
    for mercado, fuso in (("BR", "America/Sao_Paulo"), ("US", "America/New_York"), ("CRIPTO", "UTC")):
        intraday.update(fontes.baixar_yahoo_60min([t for t, a in ativos.items() if a["mercado"] == mercado], fuso))

    cambio_df, laudo_fx = validacao.avaliar(brutos[TICKER_CAMBIO], "CRIPTO", None, hoje)
    cambio = cambio_df["Close"]

    publicados, retidos, sinais = [], [], []
    precos: dict[str, pd.DataFrame] = {}
    for tk, meta in ativos.items():
        rotulo = meta.get("simbolo") or tk.removesuffix(".SA")
        base = {"ticker": tk, "rotulo": rotulo, "nome": meta["nome"], "mercado": meta["mercado"]}
        if tk not in brutos:
            retidos.append({**base, "motivo": "sem dados no Yahoo"})
            continue
        bruto = brutos[tk]
        if meta["mercado"] == "CRIPTO":
            # o candle diário de cripto só fecha à meia-noite UTC: o de hoje ainda está em formação
            hoje_utc = pd.Timestamp.now(tz="UTC").tz_localize(None).normalize()
            bruto = bruto[bruto.index < hoje_utc]
            if tk in intraday:
                intraday[tk] = intraday[tk][intraday[tk].index < hoje_utc]
        # candle quebrado/ausente no Yahoo é trocado pelo oficial da B3 ou da Nasdaq, quando existir
        bruto, completados = validacao.completar_com_oficial(bruto, (refs.get(tk) or {}).get("candles"))
        df, laudo = validacao.avaliar(bruto, meta["mercado"], refs.get(tk), hoje)
        precos[tk] = df
        if not laudo["publicar"]:
            retidos.append({**base, "motivo": laudo["motivo"]})
            print(f"[retido] {tk:10s} {laudo['motivo']}")
            continue

        h, dias_60_descartados = (validacao.limpar_intraday(intraday[tk], df) if tk in intraday else (None, 0))
        estado, sinais_tk = estrategias.analisar(df, meta["mercado"], h)
        arquivo = tk.replace("=", "_")
        (SAIDA_ATIVOS / f"{arquivo}.json").write_text(json.dumps(
            {"ticker": tk, "nome": meta["nome"], "moeda": meta["moeda"], "c": candles_compactos(df)},
            separators=(",", ":")), encoding="utf-8")
        if h is not None:
            (SAIDA_INTRADAY / f"{arquivo}.json").write_text(json.dumps(
                {"ticker": tk, "h": intraday_compacto(h)}, separators=(",", ":")), encoding="utf-8")

        conf = laudo.get("conferencia", {})
        publicados.append({
            **base, "moeda": meta["moeda"], "arquivo": arquivo, "carteira": meta["carteira"],
            "verificacao": {"status": conf.get("status", "interno"), "fonte": conf.get("fonte"),
                            "ate": conf.get("ate"), "dif_max_pct": conf.get("dif_max_pct"),
                            "comparados": conf.get("comparados", 0), "candles_descartados": laudo["n_correcoes"],
                            "dias_60min_descartados": dias_60_descartados,
                            "completados_oficial": completados,
                            # candle mais recente que veio incompleto da fonte e ficou de fora
                            "pendente": (bruto.index[-1].strftime("%Y-%m-%d")
                                         if bruto.index[-1] > df.index[-1] else None)},
            "tem_intraday": h is not None,
            **estado,
        })
        sinais += [{"ticker": tk, **x} for x in sinais_tk]

    sinais.sort(key=lambda x: (x["data"], x["ticker"]), reverse=True)
    sem_intraday = [a["ticker"] for a in publicados if a["liquido"] and a["mercado"] != "CRIPTO" and not a["intraday_ok"]]
    if sem_intraday:
        print(f"Sem 60 min confiável ({len(sem_intraday)}): {', '.join(sem_intraday)}")
    status = pd.Series([a["verificacao"]["status"] for a in publicados]).value_counts().to_dict()
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")

    radar = {
        "atualizado_em": agora,
        "usdbrl": _num(cambio.iloc[-1], 4),
        "parametros": {
            "mm": [estrategias.MM_RAPIDA, estrategias.MM_LENTA, estrategias.MM_LONGA],
            "ifr": [estrategias.IFR_SOBREVENDIDO, estrategias.IFR_SOBRECOMPRADO],
            "bollinger": [estrategias.BB_PERIODO, estrategias.BB_DESVIOS],
            "tolerancia_fechamento_pct": validacao.TOLERANCIA_FECHAMENTO * 100,
        },
        "familias": estrategias.FAMILIAS,
        "verificacao": {"conferidos": status.get("conferido", 0), "internos": status.get("interno", 0),
                        "retidos": len(retidos)},
        "ativos": publicados,
        "sinais": sinais,
        "retidos": retidos,
    }
    (SAIDA / "radar.json").write_text(json.dumps(radar, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    resumo = {
        "atualizado_em": agora,
        "usdbrl": _num(cambio.iloc[-1], 4),
        "carteira": consolidar_carteira(cfg, precos, cambio, {r["ticker"] for r in retidos}),
    }
    (SAIDA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Publicados {len(publicados)} ativos ({status}), {len(retidos)} retidos, {len(sinais)} sinais.")


if __name__ == "__main__":
    main()
