"""Atualização diária: baixa cotações, verifica a integridade, avalia os setups do catálogo
(config/setups.json, scripts/setups.py) e consolida a carteira em BRL.

Saída (lida pelo front-end estático):
  data/ativos/<TICKER>.json  -> candles diários verificados (só ativos aprovados)
  data/intraday/<TICKER>.json -> candles de 60 min
  data/radar.json            -> estado de cada ativo, eventos dos setups e dados retidos
  data/rastreador.json       -> fotos dos indicadores para as regras personalizadas
  data/setups.json           -> o catálogo com o resumo do backtest de cada setup
  data/backtest.json         -> backtest por setup, mercado e prazo
  data/paridade.json         -> setups do catálogo no último candle, segundo o Python
                                (conferido com o JS por scripts/testar_paridade.py)
  data/resumo.json           -> carteira consolidada

Uso:  python scripts/atualizar_dados.py
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from time import perf_counter
from zoneinfo import ZoneInfo

import pandas as pd

import backtest
import estrategias
import fontes
import rastreador
import setups
import validacao
from estrategias import _num, _var

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "config" / "carteira.json"
UNIVERSO = RAIZ / "config" / "universo.json"
SAIDA = RAIZ / "data"
SAIDA_ATIVOS = SAIDA / "ativos"
SAIDA_INTRADAY = SAIDA / "intraday"
SAIDA_CASOS = SAIDA / "casos"  # backtest caso a caso, por ativo (a página Backtest carrega ao clicar no ativo)
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
    ohlc = df[["Open", "High", "Low", "Close"]].astype(float).round(casas).to_numpy().tolist()
    return [[d, *v] for d, v in zip(df.index.strftime("%Y-%m-%d"), ohlc)]


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

_INICIO = perf_counter()


def etapa(msg: str) -> None:
    """Mensagem de progresso com o tempo desde o início (flush: o log do Actions mostra na hora)."""
    seg = int(perf_counter() - _INICIO)
    print(f"[{seg // 60:02d}:{seg % 60:02d}] {msg}", flush=True)


def processar_ativo(tarefa: tuple) -> dict:
    """Valida, avalia os setups (todo o histórico, com backtest) e grava os JSONs de um ativo. Roda
    em paralelo (um processo por núcleo), então só lê os argumentos e devolve o resultado para o
    main juntar."""
    tk, meta, bruto, ref, intra, form, hoje, catalogo = tarefa
    rotulo = meta.get("simbolo") or tk.removesuffix(".SA")
    base = {"ticker": tk, "rotulo": rotulo, "nome": meta["nome"], "mercado": meta["mercado"]}
    if bruto is None:
        return {"tk": tk, "retido": {**base, "motivo": "sem dados no Yahoo"}}
    # pregão de hoje ainda aberto: o candle sai do histórico (sem sinais) e volta só no gráfico
    bruto, parcial = separar_parcial(bruto, form, meta["mercado"])
    oficiais = (ref or {}).get("candles")
    if form and oficiais:
        oficiais = {d: c for d, c in oficiais.items() if pd.Timestamp(d) < pd.Timestamp(form[0])}
    # candle quebrado/ausente no Yahoo é trocado pelo oficial da B3 ou da Nasdaq, quando existir
    bruto, completados = validacao.completar_com_oficial(bruto, oficiais)
    df, laudo = validacao.avaliar(bruto, meta["mercado"], ref, hoje)
    if not laudo["publicar"]:
        return {"tk": tk, "df": df, "retido": {**base, "motivo": laudo["motivo"]}}

    grafico = df if parcial is None else pd.concat([df, parcial.to_frame().T.astype(float)])
    # o 60 min de hoje aparece no gráfico, mas o setup multitempo só vê pregões fechados
    h, dias_60_descartados = (validacao.limpar_intraday(intra, grafico) if intra is not None else (None, 0))
    h_fechado = h
    if h is not None and form:
        h_fechado = h[h.index.normalize() < pd.Timestamp(form[0])]
        h_fechado = h_fechado if len(h_fechado) >= 60 else None
    estado = estrategias.analisar(df, meta["mercado"], h_fechado)
    res = setups.analisar(df, meta["mercado"], casas_preco(df["Close"], meta["moeda"]), h_fechado,
                          estado["liquido"], tk, catalogo)
    if parcial is not None:
        estado["parcial"] = {"data": form[0].isoformat(), "ultimo": _num(parcial["Close"], 4),
                             "var_pct": _num((parcial["Close"] / df["Close"].iloc[-1] - 1) * 100)}
    arquivo = tk.replace("=", "_")
    (SAIDA_ATIVOS / f"{arquivo}.json").write_text(json.dumps(
        {"ticker": tk, "nome": meta["nome"], "moeda": meta["moeda"], "c": candles_compactos(grafico, meta["moeda"]),
         "parcial": estado.get("parcial", {}).get("data")},
        separators=(",", ":")), encoding="utf-8")
    casos = (res.get("bt") or {}).pop("casos", None)
    if casos:
        (SAIDA_CASOS / f"{arquivo}.json").write_text(json.dumps(
            {"ticker": tk, "principal": backtest.PRINCIPAL, "casos": casos}, separators=(",", ":")), encoding="utf-8")
    if h is not None:
        (SAIDA_INTRADAY / f"{arquivo}.json").write_text(json.dumps(
            {"ticker": tk, "h": intraday_compacto(h, meta["moeda"])}, separators=(",", ":")), encoding="utf-8")

    conf = laudo.get("conferencia", {})
    publicado = {
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
    }
    return {"tk": tk, "df": df, "publicado": publicado, "setups": res, "parcial": parcial is not None}


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
    for pasta in (SAIDA_ATIVOS, SAIDA_INTRADAY, SAIDA_CASOS):
        pasta.mkdir(parents=True, exist_ok=True)
        for antigo in pasta.glob("*.json"):
            antigo.unlink()  # ativo retido hoje não pode ficar com gráfico de ontem
    hoje = pd.Timestamp.today().normalize()

    etapa(f"Baixando {len(ativos)} ativos do Yahoo...")
    brutos = fontes.baixar_yahoo(list(dict.fromkeys([*ativos, TICKER_CAMBIO])))
    etapa("Buscando fechamentos de referência...")
    refs = fontes.referencias(list(ativos.values()))
    etapa("Baixando candles de 60 min...")
    intraday = {}
    for mercado, fuso in (("BR", "America/Sao_Paulo"), ("US", "America/New_York"), ("CRIPTO", "UTC"),
                          ("MACRO", "America/New_York")):
        intraday.update(fontes.baixar_yahoo_60min([t for t, a in ativos.items() if a["mercado"] == mercado], fuso))

    agora_utc = datetime.now(timezone.utc)
    formacao = {m: pregao_em_formacao(m, agora_utc) for m in FECHAMENTO}
    em_formacao: dict[str, dict] = {}
    cambio_df, laudo_fx = validacao.avaliar(brutos[TICKER_CAMBIO], "CRIPTO", None, hoje)
    cambio = cambio_df["Close"]

    catalogo = setups.carregar_catalogo()
    itens = setups.itens(catalogo)
    teste = backtest.Backtest({s["id"]: s["vies"] for s in itens})
    publicados, retidos, sinais = [], [], []
    fotos: dict[str, dict] = {}  # indicadores para as regras personalizadas (assets/js/rastreador.js)
    paridade: dict[str, dict] = {}
    para_ranking: list[dict] = []
    precos: dict[str, pd.DataFrame] = {}
    tarefas = [(tk, meta, brutos.get(tk), refs.get(tk), intraday.get(tk), formacao[meta["mercado"]], hoje, catalogo)
               for tk, meta in ativos.items()]
    nucleos = os.cpu_count() or 1
    etapa(f"Avaliando os setups em todo o histórico, com backtest ({nucleos} processos)...")
    with ProcessPoolExecutor(nucleos) as ex:
        resultados = list(ex.map(processar_ativo, tarefas, chunksize=8))
    for r in resultados:  # na ordem do universo, como antes
        tk, meta = r["tk"], ativos[r["tk"]]
        if "df" in r:
            precos[tk] = r["df"]
        if "retido" in r:
            retidos.append(r["retido"])
            if "df" in r:
                print(f"[retido] {tk:10s} {r['retido']['motivo']}")
            continue
        publicados.append(r["publicado"])
        res = r["setups"]
        sinais += res["eventos"]
        fotos[tk] = res["fotos"]
        paridade[tk] = res["paridade"]
        para_ranking.append({"ticker": tk, "mercado": meta["mercado"], "liquido": r["publicado"]["liquido"], **res})
        if res["bt"]:
            teste.adicionar(tk, meta["mercado"], res["bt"])
        if r["parcial"]:
            form = formacao[meta["mercado"]]
            em_formacao.setdefault(meta["mercado"], {
                "data": form[0].isoformat(), "fecha_em": form[1].astimezone(timezone.utc).isoformat(timespec="minutes"),
                "sinais_em": proxima_publicacao(form[1]).isoformat(timespec="minutes")})

    etapa("Ranking dos mercados, backtest e arquivos finais...")
    # maiores quedas/altas: compara os ativos entre si, então só fecha depois de todos
    sinais += setups.aplicar_ranking(para_ranking, catalogo)
    resultado_bt = teste.resultado()
    resultado_bt["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (SAIDA / "backtest.json").write_text(json.dumps(resultado_bt, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # o catálogo publicado: o mesmo de config/setups.json, com o resumo do backtest de cada setup
    bt_setup = teste.por_setup()
    publicado_catalogo = {"grupos": [{**g, "itens": [{**s, **({"bt": bt_setup[s["id"]]} if s["id"] in bt_setup else {})}
                                                     for s in g["itens"]]} for g in catalogo["grupos"]]}
    (SAIDA / "setups.json").write_text(json.dumps(publicado_catalogo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (SAIDA / "paridade.json").write_text(json.dumps(paridade, separators=(",", ":")), encoding="utf-8")
    sinais.sort(key=lambda x: (x["data"], x["ticker"], x["tf"], x["setup"]), reverse=True)
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
            "bollinger": [estrategias.BB_PERIODO, estrategias.BB_DESVIOS],
            "tolerancia_fechamento_pct": validacao.TOLERANCIA_FECHAMENTO * 100,
        },
        "verificacao": {"conferidos": status.get("conferido", 0), "internos": status.get("interno", 0),
                        "retidos": len(retidos)},
        # pregões abertos agora: o candle aparece no gráfico, os sinais saem em "sinais_em"
        # sinais: eventos dos setups do catálogo nos últimos 15 pregões / 8 semanas (candles fechados)
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
    etapa(f"Publicados {len(publicados)} ativos ({status}), {len(retidos)} retidos, {len(sinais)} eventos de setups.")


if __name__ == "__main__":
    main()
