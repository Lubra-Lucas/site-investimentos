"""Criativos do canal do Telegram: três imagens por dia, no visual do post diário (1080 x 1350).

1. Top do dia: os 3 sinais de compra e os 3 de venda com melhor histórico (data/ranking.json).
2. Educativo: um item de config/educativos.json (como usar o terminal, estatística, mercado).
3. Como terminou: um sinal publicado 10 pregões antes, com entrada, saída, o caminho do preço e o
   placar de todos os sinais publicados naquele dia (inclusive os que deram prejuízo).

Só desenha; quem escolhe o que publicar e quando é scripts/telegram_postar.py.
Teste visual: python scripts/criativos.py --amostras <pasta>   (gera as três imagens com dados de exemplo)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conteudo import (ACENTO, AMBAR, BG, BORDA, MUDO, PAINEL, SITE_CURTO, TEXTO, VERDE,  # noqa: E402
                      VERMELHO, Tela, fmt_data, fmt_pct, fmt_preco, marca)

W, H, M = 1080, 1350, 60
RAIZ = Path(__file__).resolve().parent.parent
PAGINAS = {"setups.html": "Oportunidades", "ranking.html": "Top do dia", "resultados.html": "Histórico dos sinais",
           "backtest.html": "Backtest", "diario.html": "Diário", "triagem.html": "Triagem", "painel.html": "Painel",
           "ativo.html": "página do ativo", "guia.html": "Guia", "carteira.html": "Carteira"}
CATEGORIAS = {"terminal": ("COMO USAR O TERMINAL", ACENTO),
              "estatistica": ("ESTATÍSTICA SEM MISTÉRIO", AMBAR),
              "mercado": ("MERCADO E RISCO", VERDE)}


def _cabecalho(t: Tela, pilula: str) -> float:
    y = 56
    marca(t, M, y)
    pw = t.largura(pilula, "b", 24) + 40
    t.retangulo(W - M - pw, y - 2, W - M, y + 42, preenche=PAINEL, borda=BORDA, raio=22)
    t.texto(W - M - pw / 2, y + 28, pilula, "b", 24, MUDO, "ms")
    return y + 70


def _rodape(t: Tela, linhas=("Estudo estatístico, não é recomendação.",
                             "Resultado passado não garante resultado futuro."), direita="backtest sem custos"):
    base = H - 44
    topo = base - 128
    t.linha(M, topo, W - M, topo, BORDA, 1.5)
    ry = topo + 38
    for ln in linhas:
        t.texto(M, ry, ln, "n", 24, MUDO)
        ry += 32
    t.texto(M, base - 8, SITE_CURTO, "b", 28, ACENTO)
    if direita:
        t.texto(W - M, base - 8, direita, "n", 22, MUDO, "rs")
    return topo


def _cortar(t: Tela, s: str, tipo: str, px: int, maxw: float) -> str:
    if t.largura(s, tipo, px) <= maxw:
        return s
    while s and t.largura(s + "…", tipo, px) > maxw:
        s = s[:-1]
    return s.rstrip() + "…"


# ---------------------------------------------------------------- 1. Top do dia

def top_do_dia(rk: dict, caminho: Path, n: int = 3) -> bool:
    """Imagem com os n melhores de compra e de venda do ranking geral. False se não houver nenhum."""
    blocos = [(lado, ((rk.get(lado) or {}).get("geral") or [])[:n]) for lado in ("compra", "venda")]
    if not any(itens for _, itens in blocos):
        return False
    t = Tela(W, H)
    y = _cabecalho(t, f"Fechamento de {fmt_data(rk.get('data') or '', True)}")
    t.circulo(M + 8, y - 8, 8, AMBAR)
    t.texto(M + 28, y, "TOP DO DIA", "b", 24, AMBAR)
    y += 78
    t.texto(M, y, "Sinais com melhor histórico", "b", 56, TEXTO)
    y += 46
    t.texto(M, y, "Mesmo setup, mesmo ativo, 10 pregões depois", "n", 30, MUDO)
    y += 34
    topo_rod = H - 44 - 128
    altura_bloco = (topo_rod - 24 - y - 24) / 2
    for lado, itens in blocos:
        compra = lado == "compra"
        cor = VERDE if compra else VERMELHO
        t.retangulo(M, y, W - M, y + altura_bloco - 12, preenche=PAINEL, borda=BORDA, raio=18)
        t.texto(M + 28, y + 50, "▲ COMPRA" if compra else "▼ VENDA", "b", 28, cor)
        if not compra:
            t.texto(W - M - 28, y + 50, "lucro = queda do preço", "n", 22, MUDO, "rs")
        if not itens:
            t.texto(M + 28, y + 120, "Nenhum sinal qualificado hoje.", "n", 28, MUDO)
        linha_h = (altura_bloco - 12 - 80) / max(1, n)
        for i, x in enumerate(itens):
            ly = y + 80 + i * linha_h
            if i:
                t.linha(M + 28, ly, W - M - 28, ly, BORDA, 1)
            cy = ly + linha_h / 2
            t.texto(M + 28, cy + 4, f"{i + 1}", "b", 40, MUDO)
            t.texto(M + 82, cy - 6, str(x.get("rotulo") or x.get("ticker")), "b", 44, TEXTO)
            setup = _cortar(t, str(x.get("setup_nome") or x.get("setup")), "n", 25, 470)
            t.texto(M + 82, cy + 32, setup, "n", 25, MUDO)
            acerto = f"{x.get('ganhos')} de {x.get('casos')} no lucro"
            t.texto(W - M - 28, cy - 6, acerto, "b", 30, TEXTO, "rs")
            t.texto(W - M - 28, cy + 32, f"média {fmt_pct(x.get('medio') or 0, 1)}", "m", 26,
                    VERDE if (x.get("medio") or 0) >= 0 else VERMELHO, "rs")
        y += altura_bloco + 12
    _rodape(t, ("Ranking do histórico de cada ativo (mín. 10 casos). Não é recomendação.",
                "Resultado passado não garante resultado futuro."))
    caminho.parent.mkdir(parents=True, exist_ok=True)
    t.salvar(caminho)
    return True


# ---------------------------------------------------------------- 2. Educativo

def educativo(item: dict, caminho: Path, numero: int | None = None) -> None:
    rot, cor = CATEGORIAS.get(item.get("categoria"), CATEGORIAS["mercado"])
    t = Tela(W, H)
    y = _cabecalho(t, "Aprenda" if numero is None else f"Aprenda · {numero}")
    t.circulo(M + 8, y - 8, 8, cor)
    t.texto(M + 28, y, rot, "b", 24, cor)
    y += 30
    for ln in t.quebrar(item["titulo"], "b", 64, W - 2 * M)[:3]:
        y += 78
        t.texto(M, y, ln, "b", 64, TEXTO)
    y += 46
    topo_rod = H - 44 - 128
    pontos = item.get("pontos") or []
    px = 36
    linhas_por_ponto = [t.quebrar(p, "n", px, W - 2 * M - 120)[:4] for p in pontos]
    total = sum(len(l) for l in linhas_por_ponto)
    chamada_h = 112 if item.get("pagina") else 0
    disponivel = topo_rod - 30 - y - chamada_h
    alt_linha = min(52, (disponivel - len(pontos) * 54) / max(1, total))
    sobra = disponivel - (total * alt_linha + len(pontos) * 54)
    y += max(0, sobra / 2 - 10)
    for k, linhas in enumerate(linhas_por_ponto):
        h = len(linhas) * alt_linha + 40
        t.retangulo(M, y, W - M, y + h, preenche=PAINEL, borda=BORDA, raio=16)
        t.circulo(M + 46, y + 20 + alt_linha / 2 + 2, 22, cor)
        t.texto(M + 46, y + 20 + alt_linha / 2 + 13, str(k + 1), "b", 28, BG, "ms")
        ly = y + 20 + alt_linha * 0.78
        for ln in linhas:
            t.texto(M + 96, ly, ln, "n", px, TEXTO)
            ly += alt_linha
        y += h + 14
    if chamada_h:
        nome = PAGINAS.get(item["pagina"].split("#")[0], "o terminal")
        cy = topo_rod - 30 - 92
        t.retangulo(M, cy, W - M, cy + 92, preenche=(18, 28, 46), borda=(44, 74, 128), raio=16)
        t.texto(M + 28, cy + 58, "Veja no terminal:", "n", 30, MUDO)
        t.texto(M + 28 + t.largura("Veja no terminal: ", "n", 30), cy + 58, nome, "b", 30, ACENTO)
    _rodape(t, ("Conteúdo educativo, não é recomendação de investimento.",
                "Sinais com histórico estatístico, todo dia, no canal."), direita="")
    caminho.parent.mkdir(parents=True, exist_ok=True)
    t.salvar(caminho)


# ---------------------------------------------------------------- 3. Como terminou

def _caminho_preco(t: Tela, x0, y0, x1, y1, velas, i_ent, i_sai, compra):
    """Velas do período (com alguns pregões antes), entrada e saída marcadas."""
    t.retangulo(x0, y0, x1, y1, preenche=PAINEL, borda=BORDA, raio=18)
    px0, px1, py0, py1 = x0 + 24, x1 - 110, y0 + 30, y1 - 52
    lo, hi = min(v[3] for v in velas), max(v[2] for v in velas)
    pad = (hi - lo) * 0.06 or 1
    lo, hi = lo - pad, hi + pad

    def y(p):
        return py0 + (1 - (p - lo) / (hi - lo)) * (py1 - py0)

    for k in range(4):
        gy = py0 + (py1 - py0) * k / 3
        t.linha(px0, gy, px1 + 8, gy, (24, 30, 41), 1)
        t.texto(px1 + 16, gy + 7, fmt_preco(hi - (hi - lo) * k / 3, True), "n", 20, MUDO)
    n = len(velas)
    lw = (px1 - px0) / n
    cw = max(3.0, lw * 0.6)
    xa, xb = px0 + i_ent * lw, px0 + (i_sai + 1) * lw
    t.retangulo(xa, py0, xb, py1, preenche=(18, 26, 38))
    for i, (_, ab, mx, mn, fe) in enumerate(velas):
        cx = px0 + i * lw + lw / 2
        alta = fe >= ab
        cor = ACENTO if alta else (133, 145, 163)
        t.linha(cx, y(mx), cx, y(mn), cor, 1.4)
        topo, base = y(max(ab, fe)), y(min(ab, fe))
        if base - topo < 1.5:
            base = topo + 1.5
        t.retangulo(cx - cw / 2, topo, cx + cw / 2, base, preenche=cor if alta else (27, 34, 44), borda=None if alta else cor)
    ent, sai = velas[i_ent][1], velas[i_sai][4]
    ganhou = (sai > ent) == compra
    for preco, cor in ((ent, (139, 180, 255)), (sai, VERDE if ganhou else VERMELHO)):
        t.pontilhada(xa, xb, y(preco), cor, 1.5)
    t.circulo(px0 + i_ent * lw + lw / 2, y(ent), 8, (139, 180, 255))
    t.circulo(px0 + i_sai * lw + lw / 2, y(sai), 8, VERDE if ganhou else VERMELHO)
    t.texto(xa + 4, y1 - 18, "entrada", "b", 22, (139, 180, 255))
    t.texto(xb - 4, y1 - 18, "saída", "b", 22, VERDE if ganhou else VERMELHO, "rs")


def como_terminou(caso: dict, placar: dict, caminho: Path) -> None:
    """caso: rotulo, nome, setup_nome, lado, data (sinal), origem, moeda, velas [[d,a,m,n,f]], i_ent, i_sai, ret, melhor.
    placar: n, lucro, medio, data."""
    compra = caso["lado"] != "venda"
    ganhou = caso["ret"] > 0
    t = Tela(W, H)
    y = _cabecalho(t, f"Sinal de {fmt_data(caso['data'], True)}")
    cor = VERDE if ganhou else VERMELHO
    t.circulo(M + 8, y - 8, 8, cor)
    t.texto(M + 28, y, "COMO TERMINOU · 10 PREGÕES DEPOIS", "b", 24, cor)
    y += 92
    t.texto(M, y, str(caso["rotulo"]), "b", 96, TEXTO)
    t.texto(W - M, y, fmt_pct(caso["ret"], 1), "b", 96, cor, "rs")
    y += 46
    lado_txt = "sinal de compra" if compra else "sinal de venda (lucro = queda)"
    t.texto(W - M, y, lado_txt, "b", 26, VERDE if compra else VERMELHO, "rs")
    t.texto(M, y, _cortar(t, str(caso.get("setup_nome")), "n", 32, W - 2 * M - t.largura(lado_txt, "b", 26) - 30), "n", 32, MUDO)
    y += 30
    topo_rod = H - 44 - 128
    gy1 = topo_rod - 22 - 150 - 22 - 132 - 22
    _caminho_preco(t, M, y, W - M, gy1, caso["velas"], caso["i_ent"], caso["i_sai"], compra)
    # números
    sy = gy1 + 22
    moeda = {"USD": "US$ ", "BRL": "R$ "}.get(caso.get("moeda"), "")
    v = caso["velas"]
    cartoes = [(f"ENTRADA {fmt_data(v[caso['i_ent']][0])}", moeda + fmt_preco(v[caso["i_ent"]][1]), TEXTO),
               (f"SAÍDA {fmt_data(v[caso['i_sai']][0])}", moeda + fmt_preco(v[caso["i_sai"]][4]), TEXTO),
               ("MELHOR MOMENTO", fmt_pct(caso["melhor"], 1), VERDE if caso["melhor"] > 0 else MUDO)]
    bw = (W - 2 * M - 40) / 3
    for k, (rot, val, c) in enumerate(cartoes):
        bx = M + k * (bw + 20)
        t.retangulo(bx, sy, bx + bw, sy + 132, preenche=PAINEL, borda=BORDA, raio=18)
        t.texto(bx + bw / 2, sy + 38, rot, "b", 21, MUDO, "ms")
        t.texto(bx + bw / 2, sy + 98, val, "b", 46 if len(val) < 11 else 40 if len(val) < 13 else 34, c, "ms")
    # placar do dia
    py = sy + 132 + 22
    t.retangulo(M, py, W - M, py + 150, preenche=PAINEL, borda=BORDA, raio=18)
    origem = {"top": "do Top do dia", "post": "publicados"}.get(caso.get("origem"), "com melhor histórico")
    t.texto(M + 28, py + 48, f"Placar dos sinais {origem} em {fmt_data(placar['data'])}", "b", 26, MUDO)
    texto = f"{placar['lucro']} de {placar['n']} no lucro"
    t.texto(M + 28, py + 112, texto, "b", 48, TEXTO)
    t.texto(W - M - 28, py + 112, f"média {fmt_pct(placar['medio'], 1)}", "m", 36,
            VERDE if placar["medio"] >= 0 else VERMELHO, "rs")
    _rodape(t, ("Entrada na abertura após o sinal; saída no fechamento 10 pregões depois.",
                "Resultado passado não garante resultado futuro. Não é recomendação."))
    caminho.parent.mkdir(parents=True, exist_ok=True)
    t.salvar(caminho)


# ---------------------------------------------------------------- amostras

def _amostras(pasta: Path) -> None:
    import math
    rk = {"data": "2026-11-17", "compra": {"geral": [
        {"rotulo": "SAP", "setup_nome": "Pullback de compra na MMS 50", "ganhos": 15, "casos": 16, "medio": 4.57},
        {"rotulo": "PBR", "setup_nome": "IFR e estocástico sobrevendidos", "ganhos": 11, "casos": 13, "medio": 5.77},
        {"rotulo": "CBAV3", "setup_nome": "Perto da máxima de 52 semanas", "ganhos": 18, "casos": 24, "medio": 1.7}]},
        "venda": {"geral": [
            {"rotulo": "ARB", "setup_nome": "Pullback de venda na MME 9", "ganhos": 32, "casos": 52, "medio": 2.1},
            {"rotulo": "HAPV3", "setup_nome": "Perdeu a mínima de 20 candles", "ganhos": 14, "casos": 20, "medio": 1.2}]}}
    top_do_dia(rk, pasta / "amostra-top.png")
    itens = json.loads((RAIZ / "config" / "educativos.json").read_text(encoding="utf-8"))["itens"]
    for k in (0, 1, 4):
        educativo(itens[k], pasta / f"amostra-educativo-{itens[k]['id']}.png", k + 1)
    velas, p = [], 20.0
    for i in range(18):
        ab = p
        p = p * (1 + 0.012 * math.sin(i / 2.0) + 0.006)
        velas.append([f"2026-11-{i + 1:02d}", ab, max(ab, p) * 1.01, min(ab, p) * 0.99, p])
    caso = {"rotulo": "CBAV3", "setup_nome": "Perto da máxima de 52 semanas", "lado": "compra", "data": "2026-11-04",
            "origem": "top", "moeda": "BRL", "velas": velas, "i_ent": 5, "i_sai": 14,
            "ret": (velas[14][4] / velas[5][1] - 1) * 100, "melhor": 9.1}
    como_terminou(caso, {"n": 6, "lucro": 4, "medio": 1.3, "data": "2026-11-04"}, pasta / "amostra-terminou.png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--amostras", help="pasta onde gerar imagens de exemplo")
    a = ap.parse_args()
    if a.amostras:
        _amostras(Path(a.amostras))
        print("amostras geradas em", a.amostras)
