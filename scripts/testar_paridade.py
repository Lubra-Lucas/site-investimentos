"""Teste de paridade Python x JS dos setups do catálogo.

Para cada ativo, cada tempo gráfico (D e W) e cada setup de config/setups.json, compara o
resultado no último candle fechado:
  - Python: data/paridade.json, gravado por atualizar_dados.py (scripts/setups.py);
  - JS: quandoAtende(foto, regras, tf, F, 1) === 0 com as CONDICOES de assets/js/rastreador.js,
    rodado no node (scripts/paridade.js) sobre data/rastreador.json.
Boca, multitempo e ranking são calculados no Python e publicados nas fotos (o JS só lê), então
entram no teste como as demais regras.

Uso: python scripts/testar_paridade.py [pasta de dados]   (sai com erro se houver diferença)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def node() -> str:
    for c in (os.environ.get("NODE"), shutil.which("node"), "/opt/node22/bin/node"):
        if c and Path(c).exists():
            return c
    raise SystemExit("node não encontrado (defina NODE)")


def main() -> int:
    dados = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "data"
    catalogo = RAIZ / "config" / "setups.json"
    py = json.loads((dados / "paridade.json").read_text(encoding="utf-8"))
    js = json.loads(subprocess.run([node(), str(RAIZ / "scripts" / "paridade.js"), str(dados / "rastreador.json"),
                                    str(catalogo)], check=True, capture_output=True, text=True).stdout)
    ids = [s["id"] for g in json.loads(catalogo.read_text(encoding="utf-8"))["grupos"] for s in g["itens"]]

    diferencas, comparados, disparos = [], 0, Counter()
    for tk in sorted(set(py) | set(js)):
        for tf in sorted(set(py.get(tk, {})) | set(js.get(tk, {}))):
            a, b = set(py.get(tk, {}).get(tf, [])), set(js.get(tk, {}).get(tf, []))
            if tf not in py.get(tk, {}) or tf not in js.get(tk, {}):
                diferencas.append((tk, tf, "(tempo gráfico só de um lado)", sorted(a), sorted(b)))
                continue
            comparados += len(ids)
            disparos.update((s, tf) for s in a)
            for s in sorted(a ^ b):
                diferencas.append((tk, tf, s, "Python" if s in a else "JS", ""))

    print(f"Paridade: {len(py)} ativos, {comparados} comparações (ativo x tempo x setup), {len(diferencas)} diferenças.")
    print("Disparos no último candle (Python): " + ", ".join(
        f"{s} {tf}={disparos[(s, tf)]}" for s in ids for tf in ("D", "W") if disparos[(s, tf)]))
    for d in diferencas[:200]:
        tk, tf, s, quem, extra = d
        print(f"  DIFERENTE {tk:12s} {tf} {s}: só no {quem} {extra}")
    return 1 if diferencas else 0


if __name__ == "__main__":
    sys.exit(main())
