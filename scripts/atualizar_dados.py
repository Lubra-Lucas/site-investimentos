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
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

import backtest
import estrategias
import fontes
import rastreador
import validacao
from estrategias import _num, _var

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "config" / "carteira.json"
UNIVERSO = RAIZ / "config" / "universo.json"
SAIDA = RAIZ / "data"
SAIDA_ATIVOS = SAIDA / "ativos"
SAIDA_INTRADAY = SAIDA / "intraday"
TICKER_CAMBIO = "USDBRL=X"
MOEDA = {"BR": "BRL", "US": "USD", "CRIPTO": "USD", "MACRO": "USD"}  # MACRO: cada ativo diz a sua (USD, PTS, FX)

# O candle diário só vale para sinais depois que o pregão fecha. Antes disso ele aparece no
# gráfico como "em formação", mas não entra em estratégia, estado, backtest nem carteira.
# B3: fecha às 17h/18h (conforme o horário de verão dos EUA); o fechamento oficial chega ao
# Yahoo por volta das 18h30. EUA: fecha às 16h de Nova York. Cripto: dia UTC.
FECHAMENTO = {"BR": ("America/Sao_Paulo", time(18, 30)), "US": ("America/New_York", time(16, 30)),
              "CRIPTO": ("UTC", None),
              # índices, moedas e commodities: o dia de moedas e futuros vira às 17h de Nova York
              "MACRO": ("America/New_York", time(17, 15))}
# Mesmos horários do cron em .github/workflows/atualizar.yml (UTC); a rodada leva ~10 min
PUBLICACOES_UTC = (time(10, 17), time(22, 30))
DURACAO_RODADA = timedelta(minutes=10)


def pregao_em_formacao(mercado: str, agora: datetime) -> tuple[date, datetime] | None:
    """(data do pregão em andamento, quando ele fecha) ou None se o candle de hoje já é definitivo."""
    fuso, hora = FECHAMENTO[mercado]
    tz = ZoneInfo(fuso)
    dia = agora.astimezone(tz).date()
    fecha = (datetime.combine(dia + timedelta(days=1), time(0), tz) if hora is None
             else datetime.combine(dia, hora, tz))
    return (dia, fecha) if agora < fecha else None


def proxima_publicacao(depois: datetime) -> datetime:
    """Primeira rodada agendada que começa depois do fechamento, já com o tempo da rodada."""
    dia = depois.astimezone(timezone.utc).date()
    opcoes = [datetime.combine(dia + timedelta(days=n), h, timezone.utc)
              for n in range(3) for h in PUBLICACOES_UTC]
    return min(t for t in opcoes if t >= depois) + DURACAO_RODADA


def casas_preco(close: pd.Series, moeda: str = "") -> int:
    """Casas decimais para gravar: cotações de moedas pedem mais (1,08345)."""
    if moeda == "FX":
        return 3 if close.min() >= 20 else 5
    return 2 if close.min() >= 1 else 6


def intraday_compacto(h: pd.DataFrame, moeda: str = "") -> list[list]:
    """Horário local da bolsa como se fosse UTC: o gráfico mostra a hora do pregão."""
    casas = casas_preco(h["Close"], moeda)
    epoch = (h.index - pd.Timestamp("1970-01-01")) // pd.Timedelta(seconds=1)
    return [[int(t), round(r.Open, casas), round(r.High, casas), round(r.Low, casas), round(r.Close, casas)]
            for t, r in zip(epoch, h.itertuples())]


def separar_parcial(bruto: pd.DataFrame, formacao: tuple[date, datetime] | None,
                    mercado: str) -> tuple[pd.DataFrame, pd.Series | None]:
    """Tira do histórico o candle do pregão em andamento. Ele volta só para o gráfico, e só
    se for coerente (OHLC válido e sem salto absurdo em relação ao último fechamento)."""
    if formacao is None or bruto.empty or bruto.index[-1] < pd.Timestamp(formacao[0]):
        return bruto, None
    fechados = bruto[bruto.index < pd.Timestamp(formacao[0])]
    c = bruto.iloc[-1]
    o, h, l, f = (float(c[k]) for k in ("Open", "High", "Low", "Close"))
    ok = (all(pd.notna(v) and v > 0 for v in (o, h, l, f)) and h >= max(o, f) * 0.999999
          and l <= min(o, f) * 1.000001 and len(fechados)
          and abs(f / float(fechados["Close"].iloc[-1]) - 1) <= (0.6 if mercado == "CRIPTO" else 0.4))
    return fechados, (c if ok else None)


def candles_compactos(df: pd.DataFrame, moeda: str = "") -> list[list]:
    casas = casas_preco(df["Close"], moeda)
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


# -------------------------------------------------------------- maiores quedas

NOME_MERCADO = {"BR": "do Brasil", "US": "dos EUA", "CRIPTO": "de cripto", "MACRO": "de índices, moedas e commodities"}
FATIA_EXTREMOS = 0.08                       # 8% piores (e melhores) de cada mercado
MOVIMENTO_MINIMO = {"D": 8.0, "S": 12.0}    # e só se o movimento for relevante (%)


def maiores_movimentos(publicados: list[dict]) -> list[dict]:
    """Maiores quedas (compra, contra a tendência) e maiores altas (venda) de cada mercado.

    Sinal diário: variação em 21 pregões. Sinal semanal: variação em 13 semanas.
    """
    sinais = []
    for tf, campo, periodo in (("D", "var_21_pct", "21 pregões"), ("S", "var_13s_pct", "13 semanas")):
        for mercado in {a["mercado"] for a in publicados}:
            grupo = [a for a in publicados if a["mercado"] == mercado and a["liquido"] and a.get(campo) is not None]
            n = min(25, max(3, round(len(grupo) * FATIA_EXTREMOS)))
            ordem = sorted(grupo, key=lambda a: a[campo])
            for lado, lista in (("compra", ordem[:n]), ("venda", ordem[::-1][:n])):
                for a in lista:
                    v = a[campo]
                    if (lado == "compra" and v > -MOVIMENTO_MINIMO[tf]) or (lado == "venda" and v < MOVIMENTO_MINIMO[tf]):
                        continue
                    data = pd.Timestamp(a["data"])
                    if tf == "S":
                        data -= pd.Timedelta(days=data.weekday())  # semana identificada pela segunda-feira
                    verbo, extremo = ("Caiu", "quedas") if lado == "compra" else ("Subiu", "altas")
                    sinais.append({
                        "ticker": a["ticker"], "data": data.strftime("%Y-%m-%d"), "tf": tf, "lado": lado,
                        "familia": "quedas", "modalidade": "contra", "preco": a["ultimo"],
                        "texto": f"{verbo} {abs(v):.1f}% em {periodo}: entre as maiores {extremo} {NOME_MERCADO[mercado]}".replace(".", ","),
                    })
    return sinais


# ----------------------------------------------------------------------- main

def montar_lista(cfg: dict) -> dict[str, dict]:
    ativos: dict[str, dict] = {}
    universo = json.loads(UNIVERSO.read_text(encoding="utf-8"))
    for mercado, lista in universo.items():
        for a in lista:
            ativos[a["ticker"]] = {**a, "mercado": mercado, "moeda": a.get("moeda", MOEDA[mercado]), "carteira": False}
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
    brutos = fontes.baixar_yahoo(list(dict.fromkeys([*ativos, TICKER_CAMBIO])))
    print("Buscando fechamentos de referência...")
    refs = fontes.referencias(list(ativos.values()))
    print("Baixando candles de 60 min...")
    intraday = {}
    for mercado, fuso in (("BR", "America/Sao_Paulo"), ("US", "America/New_York"), ("CRIPTO", "UTC"),
                          ("MACRO", "America/New_York")):
        intraday.update(fontes.baixar_yahoo_60min([t for t, a in ativos.items() if a["mercado"] == mercado], fuso))

    agora_utc = datetime.now(timezone.utc)
    formacao = {m: pregao_em_formacao(m, agora_utc) for m in FECHAMENTO}
    em_formacao: dict[str, dict] = {}
    cambio_df, laudo_fx = validacao.avaliar(brutos[TICKER_CAMBIO], "CRIPTO", None, hoje)
    cambio = cambio_df["Close"]

    teste = backtest.Backtest()
    publicados, retidos, sinais = [], [], []
    fotos: dict[str, dict] = {}  # indicadores para o rastreador da Multitela
    precos: dict[str, pd.DataFrame] = {}
    for tk, meta in ativos.items():
        rotulo = meta.get("simbolo") or tk.removesuffix(".SA")
        base = {"ticker": tk, "rotulo": rotulo, "nome": meta["nome"], "mercado": meta["mercado"]}
        if tk not in brutos:
            retidos.append({**base, "motivo": "sem dados no Yahoo"})
            continue
        form = formacao[meta["mercado"]]
        # pregão de hoje ainda aberto: o candle sai do histórico (sem sinais) e volta só no gráfico
        bruto, parcial = separar_parcial(brutos[tk], form, meta["mercado"])
        oficiais = (refs.get(tk) or {}).get("candles")
        if form and oficiais:
            oficiais = {d: c for d, c in oficiais.items() if pd.Timestamp(d) < pd.Timestamp(form[0])}
        # candle quebrado/ausente no Yahoo é trocado pelo oficial da B3 ou da Nasdaq, quando existir
        bruto, completados = validacao.completar_com_oficial(bruto, oficiais)
        df, laudo = validacao.avaliar(bruto, meta["mercado"], refs.get(tk), hoje)
        precos[tk] = df
        if not laudo["publicar"]:
            retidos.append({**base, "motivo": laudo["motivo"]})
            print(f"[retido] {tk:10s} {laudo['motivo']}")
            continue

        grafico = df if parcial is None else pd.concat([df, parcial.to_frame().T.astype(float)])
        # o 60 min de hoje aparece no gráfico, mas a estratégia multitempo só vê pregões fechados
        h, dias_60_descartados = (validacao.limpar_intraday(intraday[tk], grafico) if tk in intraday else (None, 0))
        h_fechado = h
        if h is not None and form:
            h_fechado = h[h.index.normalize() < pd.Timestamp(form[0])]
            h_fechado = h_fechado if len(h_fechado) >= 60 else None
        estado, sinais_tk, historico = estrategias.analisar(df, meta["mercado"], h_fechado)
        fotos[tk] = rastreador.fotos(df, meta["mercado"], casas_preco(df["Close"], meta["moeda"]))
        if parcial is not None:
            estado["parcial"] = {"data": form[0].isoformat(), "ultimo": _num(parcial["Close"], 4),
                                 "var_pct": _num((parcial["Close"] / df["Close"].iloc[-1] - 1) * 100)}
            em_formacao.setdefault(meta["mercado"], {
                "data": form[0].isoformat(), "fecha_em": form[1].astimezone(timezone.utc).isoformat(timespec="minutes"),
                "sinais_em": proxima_publicacao(form[1]).isoformat(timespec="minutes")})
        if historico:
            teste.adicionar(tk, meta["mercado"], historico)
        arquivo = tk.replace("=", "_")
        (SAIDA_ATIVOS / f"{arquivo}.json").write_text(json.dumps(
            {"ticker": tk, "nome": meta["nome"], "moeda": meta["moeda"], "c": candles_compactos(grafico, meta["moeda"]),
             "parcial": estado.get("parcial", {}).get("data")},
            separators=(",", ":")), encoding="utf-8")
        if h is not None:
            (SAIDA_INTRADAY / f"{arquivo}.json").write_text(json.dumps(
                {"ticker": tk, "h": intraday_compacto(h, meta["moeda"])}, separators=(",", ":")), encoding="utf-8")

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

    sinais += maiores_movimentos(publicados)
    # histórico de cada estratégia neste ativo: [casos, acerto %, retorno médio %, vantagem %]
    for x in sinais:
        x["bt"] = teste.do_sinal(x["ticker"], x["tf"], x["familia"], x["lado"])
    resultado_bt = teste.resultado()
    resultado_bt["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (SAIDA / "backtest.json").write_text(json.dumps(resultado_bt, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
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
        # pregões abertos agora: o candle aparece no gráfico, os sinais saem em "sinais_em"
        "em_formacao": em_formacao,
        "ativos": publicados,
        "sinais": sinais,
        "retidos": retidos,
    }
    (SAIDA / "rastreador.json").write_text(json.dumps({
        "gerado_em": agora, "periodos_mm": rastreador.PERIODOS_MM, "periodos_ifr": rastreador.PERIODOS_IFR,
        "janelas": rastreador.JANELAS, "ativos": fotos,
    }, separators=(",", ":")), encoding="utf-8")
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
