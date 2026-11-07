#!/usr/bin/env python3
"""Confere se os dados publicados (data/radar.json) estão em dia.

Uso:
  python scripts/verificar_dados.py --url https://lubra-lucas.github.io/site-investimentos/data/radar.json
  python scripts/verificar_dados.py --arquivo data/radar.json --agora 2026-11-07T12:00Z
  python scripts/verificar_dados.py --testar        # casos de teste embutidos (sem rede)

Saída: resumo em português; código 1 se houver problema (o workflow falha e o GitHub avisa
o dono por e-mail). Com --resumo ARQUIVO grava o mesmo texto para virar corpo de issue.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date, datetime, timezone

URL_PADRAO = "https://lubra-lucas.github.io/site-investimentos/data/radar.json"

# Limites (ajuste aqui)
IDADE_MAX_HORAS = 30          # atualizado_em: as duas rodadas diárias deixam no máximo ~15h de folga
ATRASO_MAX_DIAS = {"BR": 4, "US": 4, "CRIPTO": 2}   # BR/US: fim de semana + feriado
RETIDOS_MAX_PCT = 25          # % de ativos retidos considerado anormal


def _datahora(texto: str) -> datetime:
    d = datetime.fromisoformat(texto.strip().replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _agora_de(texto: str | None) -> datetime:
    return _datahora(texto) if texto else datetime.now(timezone.utc)


def verificar(radar: dict, agora: datetime) -> tuple[list[str], list[str]]:
    """Devolve (erros, avisos) em português."""
    erros: list[str] = []
    avisos: list[str] = []

    # 1) carimbo geral
    try:
        atualizado = _datahora(radar["atualizado_em"])
        horas = (agora - atualizado).total_seconds() / 3600
        if horas > IDADE_MAX_HORAS:
            erros.append(f"Última atualização há {horas:.0f} h ({radar['atualizado_em']}); "
                         f"o limite é {IDADE_MAX_HORAS} h.")
    except (KeyError, ValueError):
        erros.append("O campo atualizado_em está ausente ou inválido no radar.json.")

    ativos = radar.get("ativos") or []
    if not ativos:
        erros.append("O radar.json não tem nenhum ativo.")
        return erros, avisos

    # 2) data mais recente por mercado
    hoje = agora.date()
    for mercado, limite in ATRASO_MAX_DIAS.items():
        datas = [a["data"] for a in ativos if a.get("mercado") == mercado and a.get("data")]
        if not datas:
            erros.append(f"Mercado {mercado}: nenhum ativo com data nos dados.")
            continue
        ultima = max(datas)
        atraso = (hoje - date.fromisoformat(ultima)).days
        if atraso > limite:
            erros.append(f"Mercado {mercado}: último candle em {ultima}, {atraso} dias atrás "
                         f"(limite {limite}).")

    # 3) ativos retidos (dados que não passaram na conferência)
    retidos = len(radar.get("retidos") or [])
    pct = 100 * retidos / len(ativos)
    if pct > RETIDOS_MAX_PCT:
        erros.append(f"{retidos} ativos retidos ({pct:.0f}% do total; limite {RETIDOS_MAX_PCT}%): "
                     "a conferência com a fonte oficial pode estar falhando.")
    elif retidos:
        avisos.append(f"{retidos} ativos retidos ({pct:.0f}% do total).")

    # 4) sessão incompleta na fonte (pendente mais novo que a data do ativo)
    for mercado in ("BR", "US"):
        grupo = [a for a in ativos if a.get("mercado") == mercado and a.get("data")]
        pend = [a for a in grupo
                if (a.get("verificacao") or {}).get("pendente")
                and a["verificacao"]["pendente"] > a["data"]]
        if not pend:
            continue
        ultima = max(a["data"] for a in grupo)
        atraso = (hoje - date.fromisoformat(ultima)).days
        msg = f"{mercado}: {len(pend)} de {len(grupo)} ativos com sessão incompleta na fonte"
        if len(pend) == len(grupo) and atraso > 1:
            erros.append(msg + f" (todos, e o último candle tem {atraso} dias).")
        else:
            avisos.append(msg + ".")
    return erros, avisos


def resumo(erros: list[str], avisos: list[str], radar: dict) -> str:
    linhas = []
    if erros:
        linhas.append("PROBLEMAS NOS DADOS PUBLICADOS")
        linhas += [f"- {e}" for e in erros]
    else:
        linhas.append("Dados em dia.")
    if avisos:
        linhas.append("Avisos:")
        linhas += [f"- {a}" for a in avisos]
    linhas.append(f"(atualizado_em: {radar.get('atualizado_em', '?')})")
    return "\n".join(linhas)


# ---------- testes embutidos ----------
def _radar_falso(atualizado, br="2026-11-06", us="2026-11-06", cripto="2026-11-06",
                 retidos=0, pend_br=0):
    ativos = []
    for i in range(10):
        pendente = br if i < pend_br else None
        ativos.append({"mercado": "BR", "data": "2000-01-01" if pendente else br,
                       "verificacao": {"pendente": pendente}})
    ativos += [{"mercado": "US", "data": us, "verificacao": {}},
               {"mercado": "CRIPTO", "data": cripto, "verificacao": {}}]
    return {"atualizado_em": atualizado, "ativos": ativos,
            "retidos": [{"ticker": f"X{i}"} for i in range(retidos)]}


def testar() -> int:
    agora = _datahora("2026-11-07T12:00Z")           # sábado
    fresco = "2026-11-07T02:11:00+00:00"
    casos = [
        ("fresco", _radar_falso(fresco), 0),
        ("atualização antiga", _radar_falso("2026-11-05T22:00:00+00:00"), 1),
        ("fim de semana (sexta é o último pregão)", _radar_falso(fresco, br="2026-11-06"), 0),
        ("BR parado desde terça", _radar_falso(fresco, br="2026-11-02"), 1),
        ("cripto atrasada", _radar_falso(fresco, cripto="2026-11-04"), 1),
        ("muitos retidos", _radar_falso(fresco, retidos=9), 1),
        ("pendentes só avisam", _radar_falso(fresco, pend_br=3), 0),
        ("todos pendentes e BR com 5 dias", _radar_falso(fresco, br="2026-11-02", pend_br=10), 1),
    ]
    falhas = 0
    for nome, radar, esperado in casos:
        erros, _ = verificar(radar, agora)
        ok = (1 if erros else 0) == esperado
        falhas += not ok
        print(("ok     " if ok else "FALHOU "), nome)
    return 1 if falhas else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--url", default=None, help="radar.json publicado")
    ap.add_argument("--arquivo", help="radar.json local")
    ap.add_argument("--agora", help="hora de referência (ISO, ex. 2026-11-07T12:00Z)")
    ap.add_argument("--resumo", help="grava o resumo neste arquivo (corpo da issue)")
    ap.add_argument("--testar", action="store_true", help="roda os casos embutidos")
    a = ap.parse_args()
    if a.testar:
        return testar()
    try:
        if a.arquivo:
            with open(a.arquivo, encoding="utf-8") as f:
                radar = json.load(f)
        else:
            req = urllib.request.Request(a.url or URL_PADRAO, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=60) as r:
                radar = json.load(r)
    except Exception as e:  # noqa: BLE001 - qualquer falha de leitura é problema
        texto = f"PROBLEMAS NOS DADOS PUBLICADOS\n- Não consegui ler o radar.json: {e}"
        print(texto)
        if a.resumo:
            with open(a.resumo, "w", encoding="utf-8") as f:
                f.write(texto + "\n")
        return 1
    erros, avisos = verificar(radar, _agora_de(a.agora))
    texto = resumo(erros, avisos, radar)
    print(texto)
    if a.resumo:
        with open(a.resumo, "w", encoding="utf-8") as f:
            f.write(texto + "\n")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
