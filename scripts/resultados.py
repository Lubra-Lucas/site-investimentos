"""Histórico dos sinais: gera data/resultados.json para a página resultados.html.

Responde "como os sinais dos últimos ~60 pregões terminaram?", sem escolher só os bons:

- ENCERRADOS: os casos de data/casos/*.json (backtest.py) cujo sinal caiu nos últimos 60 pregões do
  ativo. Entrada na abertura do candle seguinte ao sinal, saída no fechamento 10 pregões depois, sem
  custos nem impostos (em venda, o resultado é invertido). Sem sobreposição, como no backtest.
- EM ABERTO: o primeiro sinal (do radar.json) que ainda não completou os 10 pregões e que o backtest
  aproveitaria (não sobrepõe o último caso encerrado do mesmo setup no ativo). Mostra o retorno
  até o último fechamento; se o sinal é do último pregão, a entrada ainda não aconteceu (sem retorno).
- Só ativos que têm arquivo de casos (os líquidos), dos mercados BR, US e CRIPTO, e só setups de
  entrada (sem o grupo "Tendência", que é estado, nem os neutros), no gráfico diário.

Agregados: acerto e média dos encerrados (total e por mercado) e o ranking do mês: por mercado e
setup, os casos que terminaram nos últimos 30 dias (mínimo de 5). Resultado passado não garante
resultado futuro. Não inclui custos, impostos nem deslizamento.

Uso: python scripts/resultados.py [--dados data]
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

MERCADOS = ("BR", "US", "CRIPTO")
PREGOES = 60          # janela do histórico, em candles diários do próprio ativo
PRAZO = 10            # prazo principal do diário (backtest.PRINCIPAL["D"])
DIAS_RANKING = 30
MIN_RANKING = 5


def ler(caminho: Path):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def estatisticas(rets: list[float]) -> dict:
    if not rets:
        return {"n": 0}
    return {"n": len(rets), "acerto": round(sum(r > 0 for r in rets) / len(rets) * 100, 1),
            "medio": round(sum(rets) / len(rets), 2), "pior": round(min(rets), 2), "melhor": round(max(rets), 2)}


def gerar(dados: Path) -> dict:
    R, S = ler(dados / "radar.json"), ler(dados / "setups.json")
    if not R or not S:
        raise SystemExit("radar.json ou setups.json ausente; rode atualizar_dados.py antes.")
    entrada = {x["id"]: (x["nome"], x["vies"]) for g in S["grupos"] if g["nome"] != "Tendência"
               for x in g["itens"] if x.get("vies") in ("compra", "venda")}
    ativos = {a["ticker"]: a for a in R["ativos"] if a["mercado"] in MERCADOS}
    sinais_radar: dict[str, list[dict]] = {}
    for s in R["sinais"]:
        if s["tf"] == "D" and s["setup"] in entrada and s["ticker"] in ativos:
            sinais_radar.setdefault(s["ticker"], []).append(s)

    linhas = []   # (data, ticker, setup, ret|None, aberto, saida)
    ref_mercado: dict[str, str] = {}
    for tk, a in ativos.items():
        casos = ler(dados / "casos" / f"{a['arquivo']}.json")
        velas = ler(dados / "ativos" / f"{a['arquivo']}.json")
        if not casos or not velas or not velas.get("c"):
            continue
        c = velas["c"]
        datas = [x[0] for x in c]
        n = len(datas)
        corte = datas[max(0, n - PREGOES)]
        ref_mercado[a["mercado"]] = max(ref_mercado.get(a["mercado"], ""), datas[-1])
        indice = {d: i for i, d in enumerate(datas)}
        for sid, lista in (casos["casos"].get("D") or {}).items():
            if sid not in entrada:
                continue
            for k in lista:
                if k[0] >= corte:
                    linhas.append((k[0], tk, sid, k[4], False, k[2]))
        # em aberto: no máximo um por setup (o próximo que o backtest aproveitaria)
        por_setup: dict[str, list[int]] = {}
        for s in sinais_radar.get(tk, []):
            if s["data"] in indice and s["data"] >= corte:
                por_setup.setdefault(s["setup"], []).append(indice[s["data"]])
        for sid, idxs in por_setup.items():
            lista = (casos["casos"].get("D") or {}).get(sid) or []
            ultimo = indice.get(lista[-1][0], -10**9) if lista else -10**9
            minimo = max(ultimo + PRAZO, n - PRAZO)
            cand = sorted(i for i in set(idxs) if i >= minimo)
            if not cand:
                continue
            i = cand[0]
            lado = 1 if entrada[sid][1] == "compra" else -1
            ret = None
            if i + 1 < n and c[i + 1][1] > 0:
                ret = round(lado * (c[-1][4] / c[i + 1][1] - 1) * 100, 2)
            linhas.append((datas[i], tk, sid, ret, True, None))

    # tabelas de nomes
    tks = sorted({l[1] for l in linhas})
    sids = sorted({l[2] for l in linhas})
    ti, si = {t: i for i, t in enumerate(tks)}, {s: i for i, s in enumerate(sids)}
    base = min((l[0] for l in linhas), default=str(date.today()))
    b = date.fromisoformat(base)
    dia = lambda iso: (date.fromisoformat(iso) - b).days
    linhas.sort(key=lambda l: (l[0], l[1], l[2]), reverse=True)
    out_linhas = []
    for d, tk, sid, ret, aberto, _ in linhas:
        row = [dia(d), ti[tk], si[sid], ret]
        if aberto:
            row.append(1)
        out_linhas.append(row)

    mercado_de = lambda tk: ativos[tk]["mercado"]
    resumo = {"TODOS": estatisticas([l[3] for l in linhas if not l[4]])}
    for m in MERCADOS:
        resumo[m] = estatisticas([l[3] for l in linhas if not l[4] and mercado_de(l[1]) == m])

    ranking = {}
    for m in MERCADOS:
        if m not in ref_mercado:
            continue
        corte_r = (date.fromisoformat(ref_mercado[m]) - timedelta(days=DIAS_RANKING)).isoformat()
        por: dict[str, list[float]] = {}
        for d, tk, sid, ret, aberto, saida in linhas:
            if not aberto and mercado_de(tk) == m and saida and saida >= corte_r and ret is not None:
                por.setdefault(sid, []).append(ret)
        itens = [{"setup": s, **estatisticas(r)} for s, r in por.items() if len(r) >= MIN_RANKING]
        itens.sort(key=lambda x: (-x["medio"], -x["acerto"], -x["n"]))
        ranking[m] = {"desde": corte_r, "ate": ref_mercado[m], "itens": itens}

    return {
        "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "base": base, "pregoes": PREGOES, "prazo": PRAZO, "min_ranking": MIN_RANKING, "dias_ranking": DIAS_RANKING,
        "referencia": ref_mercado,
        "ativos": [[tk, ativos[tk].get("rotulo") or tk, mercado_de(tk)] for tk in tks],
        "setups": [[s, entrada[s][0], entrada[s][1]] for s in sids],
        # [dia desde `base`, ativo, setup, retorno % (null se ainda não entrou), 1 se em aberto]
        "linhas": out_linhas,
        "resumo": resumo,
        "ranking": ranking,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dados", default=str(Path(__file__).resolve().parent.parent / "data"))
    dados = Path(ap.parse_args().dados)
    res = gerar(dados)
    destino = dados / "resultados.json"
    destino.write_text(json.dumps(res, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    abertos = sum(1 for r in res["linhas"] if len(r) > 4)
    print(f"resultados.json: {len(res['linhas'])} sinais ({abertos} em aberto), {destino.stat().st_size / 1024:.0f} KB.")


if __name__ == "__main__":
    main()
