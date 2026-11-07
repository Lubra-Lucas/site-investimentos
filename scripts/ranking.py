"""Top do dia: ranking dos sinais de hoje com melhor histórico, gerado em data/ranking.json.

Reaproveita as regras de scripts/conteudo.py: último pregão fechado de cada mercado, só setups de entrada
(fora o grupo "Tendência" e os neutros), gráfico diário, ativos líquidos e com preço em dia.

Critério (estatística honesta):
- Amostra mínima: o setup precisa ter pelo menos 10 casos no histórico daquele ativo.
- Nota de confiabilidade: limite inferior do intervalo de Wilson (95%) da taxa de acerto (0 a 100).
  Penaliza amostra pequena: 9 de 10 não ganha de 60 de 80. Desempate pelo retorno médio.
- Fica de fora quem tem retorno médio <= 0.
- Um ativo por linha: com vários setups no mesmo lado, vale o de melhor nota ("outros" = quantos mais acenderam).
- O "acerto" do backtest já é medido a favor do lado do sinal (na venda, lucro = preço caiu).

Mercados: BR, US e CRIPTO (MACRO não entra: índices e câmbio não são operados como ativo).
Saída: top 10 geral e top 10 por mercado, para compra e venda. Nada qualificado -> estrutura vazia, código 0.
Resultado passado não garante resultado futuro; sem custos e impostos.

Uso: python scripts/ranking.py [--dados data]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conteudo as C  # noqa: E402  (regras de seleção compartilhadas)

RAIZ = Path(__file__).resolve().parent.parent
MERCADOS = ("BR", "US", "CRIPTO")
MIN_CASOS = 10
TOP = 10
Z = 1.96  # 95%


def wilson_inferior(sucessos: int, n: int, z: float = Z) -> float:
    """Limite inferior do intervalo de Wilson para a proporção sucessos/n, em %."""
    if n <= 0:
        return 0.0
    p = sucessos / n
    z2 = z * z
    centro = p + z2 / (2 * n)
    margem = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return max(0.0, (centro - margem) / (1 + z2 / n) * 100)


def nota_de(bt: list) -> tuple[int, float]:
    n, acerto = bt[0], bt[1]
    ganhos = round(acerto / 100 * n)
    return ganhos, wilson_inferior(ganhos, n)


def estrutura_vazia() -> dict:
    return {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "data": None,
            "min_casos": MIN_CASOS, "top": TOP, "mercados": list(MERCADOS), "sessao": {},
            "compra": {"geral": [], "mercado": {m: [] for m in MERCADOS}},
            "venda": {"geral": [], "mercado": {m: [] for m in MERCADOS}}}


def montar(dados: Path) -> dict:
    out = estrutura_vazia()
    R, S = C.ler(dados / "radar.json"), C.ler(dados / "setups.json")
    if not R or not S:
        return out
    R["sinais"] = C.descompactar_sinais(R.get("sinais", []))
    ctx = C.montar_contexto(R, S)
    out["sessao"] = {m: d for m, d in ctx["sessao"].items() if m in MERCADOS}
    itens = {"compra": [], "venda": []}
    for c in C.candidatos(ctx):
        a = c["ativo"]
        if a["mercado"] not in MERCADOS or c["lado"] not in itens:
            continue
        validos = []
        for s in c["setups"].values():
            bt = s.get("bt")
            if not bt or bt[0] < MIN_CASOS or bt[1] is None or bt[2] is None or bt[2] <= 0:
                continue
            ganhos, nota = nota_de(bt)
            validos.append((nota, bt[2], s, ganhos))
        if not validos:
            continue
        nota, _, s, ganhos = max(validos, key=lambda v: (v[0], v[1]))
        itens[c["lado"]].append({
            "ticker": a["ticker"], "rotulo": a.get("rotulo") or C.sem_sufixo(a["ticker"]), "nome": a["nome"],
            "mercado": a["mercado"], "data": s["data"], "setup": s["setup"], "setup_nome": C.nome_setup(ctx, s["setup"]),
            "casos": s["bt"][0], "ganhos": ganhos, "acerto": s["bt"][1], "medio": s["bt"][2],
            "nota": round(nota, 1), "outros": len(c["setups"]) - 1})
    for lado, lista in itens.items():
        lista.sort(key=lambda x: (-x["nota"], -x["medio"], x["ticker"]))
        out[lado] = {"geral": lista[:TOP],
                     "mercado": {m: [x for x in lista if x["mercado"] == m][:TOP] for m in MERCADOS}}
    datas = [x["data"] for lado in ("compra", "venda") for x in out[lado]["geral"]]
    out["data"] = max(datas) if datas else None
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dados", default=str(RAIZ / "data"))
    dados = Path(ap.parse_args().dados)
    try:
        r = montar(dados)
    except Exception as e:  # nunca derruba o build
        print("Ranking: erro:", e)
        r = estrutura_vazia()
    (dados / "ranking.json").write_text(json.dumps(r, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Ranking: data {r['data']}; compra {len(r['compra']['geral'])}, venda {len(r['venda']['geral'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
