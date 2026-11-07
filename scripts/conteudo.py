"""Conteúdo diário para redes sociais, gerado dos dados publicados (data/*.json).

Depois do pipeline (atualizar_dados.py), escolhe o melhor exemplo do dia, do mesmo jeito que a "prova" da
página inicial (conheca.html): último pregão fechado de cada mercado, só setups de entrada (fora o grupo
"Tendência" e os neutros), ativos líquidos e com preço em dia, preferindo ativos com mais setups juntos e um
setup com pelo menos 8 casos no histórico. Gera em data/conteudo/:

  post-AAAA-MM-DD.png     1080x1350 (feed do Instagram)
  story-AAAA-MM-DD.png    1080x1920 (Stories, Reels, capa do TikTok)
  post-AAAA-MM-DD.txt     legenda pronta
  hoje.json               aponta para os arquivos de hoje (a página conteudo.html lê este)
  newsletter-AAAA-MM-DD.html / .md   resumo semanal (sextas-feiras ou com --newsletter)

Além do principal (preferência por Brasil), gera até 2 alternativas de outros mercados
(post-AAAA-MM-DD-2.png etc.). Sem nenhum exemplo qualificado, grava hoje.json com {"vazio": true} e sai com 0.
Mantém só os últimos 14 dias de arquivos.

Uso: python scripts/conteudo.py [--newsletter] [--data DIR] [--saida DIR]
Só números que estão nos dados: nada inventado e nenhuma promessa de ganho.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SITE = "https://lubra-lucas.github.io/site-investimentos/"
SITE_CURTO = "lubra-lucas.github.io/site-investimentos"
AVISO = "Estudo estatístico, não é recomendação. Resultado passado não garante resultado futuro."
MIN_CASOS = 8
JANELA = 120          # pregões no mini gráfico
DIAS_GUARDAR = 14
MERCADOS = ["BR", "US", "CRIPTO", "MACRO"]
NOME_MERCADO = {"BR": "Brasil", "US": "EUA", "CRIPTO": "Cripto", "MACRO": "Macro"}

BG, PAINEL, BORDA = (7, 9, 13), (15, 19, 27), (34, 41, 54)
TEXTO, MUDO, ACENTO = (233, 238, 246), (133, 145, 163), (76, 141, 255)
VERDE, VERMELHO, AMBAR = (34, 176, 125), (240, 106, 110), (227, 162, 59)


# ---------------------------------------------------------------- utilidades

def fmt(v, c=2) -> str:
    if v is None:
        return "—"
    return f"{v:,.{c}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_pct(v, c=1) -> str:
    return "—" if v is None else f"{'+' if v > 0 else ''}{fmt(v, c)}%"


def fmt_preco(v, curto=False) -> str:
    if curto and v >= 1000:
        return fmt(v, 0)
    return fmt(v, 2 if v >= 1 else 4 if v >= 0.01 else 6)


def fmt_data(iso: str, ano4=False) -> str:
    a, m, d = iso.split("-")
    return f"{d}/{m}/{a if ano4 else a[2:]}"


def sem_sufixo(tk: str) -> str:
    return re.sub(r"(\.SA|-USD)$", "", tk).lstrip("^")


def ler(caminho: Path):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- seleção

def montar_contexto(R: dict, S: dict) -> dict:
    itens = {x["id"]: {**x, "grupo": g["nome"]} for g in S["grupos"] for x in g["itens"]}
    por_tk = {a["ticker"]: a for a in R["ativos"]}
    formacao = R.get("em_formacao") or {}
    # pregão de referência de cada mercado: a data em que a maior parte dos ativos está
    sessao = {}
    for m in MERCADOS:
        datas = Counter(a["data"] for a in R["ativos"] if a["mercado"] == m and a.get("data"))
        if datas:
            sessao[m] = max(datas.items(), key=lambda kv: (kv[1], kv[0]))[0]
    for m, f in formacao.items():
        if sessao.get(m) == f.get("data"):   # pregão ainda aberto: não é um "fechado"
            ant = sorted({a["data"] for a in R["ativos"] if a["mercado"] == m and a["data"] < f["data"]})
            if ant:
                sessao[m] = ant[-1]
            else:
                sessao.pop(m, None)
    return {"R": R, "itens": itens, "por_tk": por_tk, "sessao": sessao}


def entrada(ctx, id_) -> bool:
    x = ctx["itens"].get(id_)
    return bool(x) and x["grupo"] != "Tendência" and x.get("vies") != "neutro"


def ativo_ok(a: dict) -> bool:
    """Líquido e com preço em dia (sem conferência de fechamento pendente depois do último candle)."""
    if a.get("liquido") is False:
        return False
    pend = (a.get("verificacao") or {}).get("pendente")
    return not (pend and pend > a["data"])


def candidatos(ctx) -> list[dict]:
    """Um item por (ativo, lado) com os setups de entrada do último pregão fechado do mercado dele."""
    grupos: dict[tuple, dict] = {}
    for s in ctx["R"]["sinais"]:
        if s["tf"] != "D" or not entrada(ctx, s["setup"]):
            continue
        a = ctx["por_tk"].get(s["ticker"])
        if not a or not ativo_ok(a) or ctx["sessao"].get(a["mercado"]) != s["data"] or a["data"] != s["data"]:
            continue
        g = grupos.setdefault((s["ticker"], s["lado"]), {"ativo": a, "lado": s["lado"], "setups": {}})
        g["setups"][s["setup"]] = s
    return list(grupos.values())


def melhor_setup(c) -> dict | None:
    ok = [s for s in c["setups"].values() if s.get("bt") and s["bt"][0] >= MIN_CASOS and s["bt"][1] is not None]
    if not ok:
        return None
    # primeiro os que têm histórico favorável (acerto >= 55% e média positiva), depois o maior acerto
    return max(ok, key=lambda s: (s["bt"][1] >= 55 and (s["bt"][2] or 0) > 0, s["bt"][1], s["bt"][0]))


def escolher(ctx, dados: Path, n_max=3) -> list[dict]:
    """Principal (preferência: Brasil) e alternativas de outros mercados, já com candles e casos carregados."""
    por_mercado = defaultdict(list)
    for c in candidatos(ctx):
        s = melhor_setup(c)
        if s:
            por_mercado[c["ativo"]["mercado"]].append({**c, "s": s})
    escolhidos = []
    for m in MERCADOS:
        ordem = sorted(por_mercado.get(m, []), key=lambda c: (
            -len(c["setups"]), -(c["s"]["bt"][1] >= 55 and (c["s"]["bt"][2] or 0) > 0), -c["s"]["bt"][1],
            -c["s"]["bt"][0], c["ativo"]["ticker"]))
        for c in ordem:
            velas = ler(dados / "ativos" / f"{c['ativo']['arquivo']}.json")
            casos = ler(dados / "casos" / f"{c['ativo']['arquivo']}.json")
            cs = ((casos or {}).get("casos", {}).get("D", {}) or {}).get(c["s"]["setup"]) or []
            ca = (velas or {}).get("c") or []
            if not ca or not cs or ca[-1][0] != c["s"]["data"]:
                continue
            escolhidos.append({**c, "candles": ca, "lista": cs, "mercado": m})
            break
        if len(escolhidos) >= n_max:
            break
    return escolhidos


# ---------------------------------------------------------------- texto

def nome_setup(ctx, id_) -> str:
    return ctx["itens"].get(id_, {}).get("nome", id_)


def nome_curto(ctx, id_) -> str:
    return re.sub(r" de (compra|venda)\b", "", nome_setup(ctx, id_))


def hashtags(ex) -> str:
    a = ex["ativo"]
    base = ["#analisetecnica", "#backtest", "#investimentos"]
    m = a["mercado"]
    extra = {"BR": ["#bolsadevalores", "#b3", "#acoes"], "US": ["#bolsaamericana", "#stocks", "#investirnoexterior"],
             "CRIPTO": ["#criptomoedas", "#bitcoin", "#cripto"], "MACRO": ["#mercadofinanceiro", "#trading", "#forex"]}[m]
    tk = "#" + re.sub(r"[^A-Za-z0-9]", "", sem_sufixo(a["ticker"])).lower()
    return " ".join([*base, *extra, tk][:8])


def legenda(ctx, ex) -> str:
    a, s = ex["ativo"], ex["s"]
    n, acerto, medio, _ = s["bt"]
    tk = a.get("rotulo") or sem_sufixo(a["ticker"])
    setup = nome_setup(ctx, s["setup"])
    lado = "compra" if ex["lado"] == "compra" else "venda"
    outros = [nome_curto(ctx, i) for i in ex["setups"] if i != s["setup"]]
    linhas = [f"{tk} acendeu o setup {setup}. Quantas vezes isso já deu certo nele?", ""]
    quem = a["nome"] if tk.lower() in a["nome"].lower() else f"{a['nome']} ({tk})"
    linhas.append(f"No fechamento de {fmt_data(s['data'], True)}, {quem} deu sinal de {lado}: {setup}.")
    linhas.append(f"Olhando para trás, esse mesmo setup apareceu {n} vezes em {tk}. "
                  f"Saindo 10 pregões depois da entrada, {fmt(acerto, 0)}% terminaram com lucro, "
                  f"com resultado médio de {fmt_pct(medio, 2)} por operação (sem custos e impostos)"
                  + (", considerando que na venda o lucro vem da queda do preço." if lado == "venda" else "."))
    if outros:
        lista = outros[:3]
        junto = lista[0] if len(lista) == 1 else ", ".join(lista[:-1]) + " e " + lista[-1]
        linhas.append(f"Hoje {tk} tem {len(ex['setups'])} setups de {lado} ao mesmo tempo. Além deste: {junto}.")
    linhas += ["", "É um estudo estatístico do que já aconteceu, não uma previsão: resultado passado não garante resultado futuro.",
               "", f"E você, já acompanha {tk}? Qual setup você mais usa? Conta aqui nos comentários.",
               "", f"Veja o histórico completo de cada sinal, ativo por ativo, no terminal gratuito: {SITE}",
               "", "Estudo estatístico, não é recomendação de investimento.", "", hashtags(ex)]
    return "\n".join(linhas) + "\n"


# ---------------------------------------------------------------- imagem

FONTES = {
    "n": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "DejaVuSans.ttf", "Arial.ttf"],
    "b": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"],
    "m": ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono-Bold.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf", "DejaVuSansMono-Bold.ttf"],
}
_FC: dict = {}


def fonte(tipo, px):
    from PIL import ImageFont
    k = (tipo, px)
    if k not in _FC:
        for caminho in FONTES[tipo]:
            try:
                _FC[k] = ImageFont.truetype(caminho, px)
                break
            except OSError:
                continue
        else:
            raise RuntimeError("Nenhuma fonte com acentos encontrada (instale fonts-dejavu-core).")
    return _FC[k]


class Tela:
    """Desenha em coordenadas de 1080 de largura, em resolução dobrada (suaviza as linhas) e reduz no fim."""

    def __init__(self, w, h, escala=2):
        from PIL import Image, ImageDraw
        self.w, self.h, self.e = w, h, escala
        self.img = Image.new("RGB", (w * escala, h * escala), BG)
        self.d = ImageDraw.Draw(self.img)

    def p(self, v):
        return int(round(v * self.e))

    def retangulo(self, x0, y0, x1, y1, preenche=None, borda=None, raio=0, largura=1):
        caixa = [self.p(x0), self.p(y0), self.p(x1), self.p(y1)]
        if raio:
            self.d.rounded_rectangle(caixa, self.p(raio), fill=preenche, outline=borda, width=self.p(largura) if borda else 0)
        else:
            self.d.rectangle(caixa, fill=preenche, outline=borda, width=self.p(largura) if borda else 0)

    def linha(self, x0, y0, x1, y1, cor, largura=1):
        self.d.line([self.p(x0), self.p(y0), self.p(x1), self.p(y1)], fill=cor, width=max(1, self.p(largura)))

    def pontilhada(self, x0, x1, y, cor, largura=1, traco=6, vazio=6):
        x = x0
        while x < x1:
            self.linha(x, y, min(x + traco, x1), y, cor, largura)
            x += traco + vazio

    def circulo(self, cx, cy, r, cor):
        self.d.ellipse([self.p(cx - r), self.p(cy - r), self.p(cx + r), self.p(cy + r)], fill=cor)

    def poligono(self, pts, cor):
        self.d.polygon([(self.p(x), self.p(y)) for x, y in pts], fill=cor)

    def texto(self, x, y, s, tipo="n", px=28, cor=TEXTO, ancora="ls"):
        self.d.text((self.p(x), self.p(y)), s, font=fonte(tipo, self.p(px)), fill=cor, anchor=ancora)

    def largura(self, s, tipo, px):
        return fonte(tipo, self.p(px)).getlength(s) / self.e

    def quebrar(self, s, tipo, px, maxw):
        linhas, atual = [], ""
        for palavra in s.split():
            teste = f"{atual} {palavra}".strip()
            if self.largura(teste, tipo, px) <= maxw or not atual:
                atual = teste
            else:
                linhas.append(atual)
                atual = palavra
        return [*linhas, atual] if atual else linhas

    def salvar(self, caminho):
        from PIL import Image
        self.img.resize((self.w, self.h), Image.LANCZOS).save(caminho, optimize=True)


def marca(t: Tela, x, y):
    """Logotipo: as três barras do topo do site + nome."""
    for i, (bx, by, bh) in enumerate([(0, 14, 16), (9, 4, 28), (18, 18, 10)]):
        t.retangulo(x + bx, y + by - 4, x + bx + 6, y + by - 4 + bh, preenche=ACENTO, raio=2)
    t.texto(x + 36, y + 24, "Carteira ", "b", 30, TEXTO)
    t.texto(x + 36 + t.largura("Carteira ", "b", 30), y + 24, "Terminal", "b", 30, ACENTO)


def grafico(t: Tela, x0, y0, x1, y1, ex):
    """Mini gráfico de velas dos últimos pregões com os casos anteriores do setup e o sinal de hoje."""
    s = ex["s"]
    c = ex["candles"][-JANELA:]
    n = len(c)
    t.retangulo(x0, y0, x1, y1, preenche=PAINEL, borda=BORDA, raio=18)
    # legenda
    ly = y0 + 38
    marc = sum(1 for k in ex["lista"] if k[0] in {v[0] for v in c} and k[0] != s["data"])
    t.texto(x0 + 24, ly, f"Últimos {n} pregões" + (f" · {marc} {'caso' if marc == 1 else 'casos'}" if marc else ""), "b", 22, MUDO)
    lx = x1 - 24
    for cor, rot in ((VERMELHO, "prejuízo"), (VERDE, "lucro")):
        lx -= t.largura(rot, "n", 21)
        t.texto(lx, ly, rot, "n", 21, MUDO)
        lx -= 18
        t.circulo(lx, ly - 7, 7, cor)
        lx -= 30
    px0, px1 = x0 + 24, x1 - 100
    py0, py1 = y0 + 66, y1 - 56
    lo, hi = min(v[3] for v in c), max(v[2] for v in c)
    pad = (hi - lo) * 0.04 or 1
    lo, hi = lo - pad, hi + pad

    def y(p):
        return py0 + (1 - (p - lo) / (hi - lo)) * (py1 - py0)

    for k in range(4):
        gy = py0 + (py1 - py0) * k / 3
        t.linha(px0, gy, px1 + 8, gy, (24, 30, 41), 1)
        t.texto(px1 + 16, gy + 7, fmt_preco(hi - (hi - lo) * k / 3, True), "n", 20, MUDO)
    lw = (px1 - px0) / n
    cw = max(2.0, lw * 0.62)
    for i, (_, ab, mx, mn, fe) in enumerate(c):
        cx = px0 + i * lw + lw / 2
        alta = fe >= ab
        cor = ACENTO if alta else (133, 145, 163)
        t.linha(cx, y(mx), cx, y(mn), cor, 1.2)
        topo, base = y(max(ab, fe)), y(min(ab, fe))
        if base - topo < 1.5:
            base = topo + 1.5
        t.retangulo(cx - cw / 2, topo, cx + cw / 2, base, preenche=cor if alta else (27, 34, 44), borda=None if alta else cor)
    idx = {v[0]: i for i, v in enumerate(c)}
    for sinal, _e, _sd, _sa, r in ex["lista"]:
        i = idx.get(sinal)
        if i is None or sinal == s["data"]:
            continue
        cx = px0 + i * lw + lw / 2
        t.circulo(cx, min(y(c[i][3]) + 14, py1 + 22), 7, VERDE if r >= 0 else VERMELHO)
    i = idx.get(s["data"], n - 1)
    cx = px0 + i * lw + lw / 2
    base = min(y(c[i][3]) + 12, py1 + 18)
    t.linha(cx, py0, cx, y(c[i][3]) - 2, (60, 90, 150), 1.2)
    t.poligono([(cx, base), (cx - 12, base + 20), (cx + 12, base + 20)], (139, 180, 255))
    t.texto(cx - 18, base + 19, "hoje", "b", 22, (139, 180, 255), "rs")
    # linha do último preço
    yl = y(c[-1][4])
    t.pontilhada(px0, px1 + 8, yl, (76, 141, 255), 1)


def desenhar(ctx, ex, caminho: Path, w, h, story=False):
    a, s = ex["ativo"], ex["s"]
    n, acerto, medio, _ = s["bt"]
    tk = a.get("rotulo") or sem_sufixo(a["ticker"])
    t = Tela(w, h)
    M = 60
    compra = ex["lado"] == "compra"
    y = 190 if story else 56
    marca(t, M, y)
    pill = f"{NOME_MERCADO[a['mercado']]} · {fmt_data(s['data'], True)}"
    pw = t.largura(pill, "b", 24) + 40
    t.retangulo(w - M - pw, y - 2, w - M, y + 42, preenche=PAINEL, borda=BORDA, raio=22)
    t.texto(w - M - pw / 2, y + 28, pill, "b", 24, MUDO, "ms")
    y += 100 if story else 70
    cor_lado = VERDE if compra else VERMELHO
    tag = f"SINAL DE {'COMPRA' if compra else 'VENDA'} NO FECHAMENTO"
    t.circulo(M + 8, y - 8, 8, cor_lado)
    t.texto(M + 28, y, tag, "b", 24, cor_lado)
    y += 104 if story else 88
    t.texto(M, y, tk, "b", 112 if story else 96, TEXTO)
    preco = f"{'US$' if a.get('moeda') == 'USD' else 'R$' if a.get('moeda') == 'BRL' else ''} {fmt_preco(a['ultimo'])}".strip()
    var = a.get("var_dia_pct")
    t.texto(w - M, y - 36, preco, "m", 38, TEXTO, "rs")
    if var is not None:
        t.texto(w - M, y + 4, fmt_pct(var, 2), "m", 30, VERDE if var >= 0 else VERMELHO, "rs")
    y += 44
    t.texto(M, y, a["nome"], "n", 32, MUDO)
    if len(ex["setups"]) > 1:
        t.texto(w - M, y, f"{len(ex['setups'])} setups hoje", "b", 26, AMBAR, "rs")
    y += 22 if story else 12
    # nome do setup
    nome = nome_setup(ctx, s["setup"])
    linhas = t.quebrar(nome, "b", 46, w - 2 * M)
    for ln in linhas[:2]:
        y += 58
        t.texto(M, y, ln, "b", 46, ACENTO)
    y += 26
    # rodapé e blocos de baixo têm altura fixa; o gráfico ocupa o que sobra
    rodape_h = 190 if story else 128
    base = h - (230 if story else 44)
    topo_rod = base - rodape_h
    n_casos = min(3, len(ex["lista"]))
    casos_h = 46 + n_casos * 46
    stats_h = 132
    gap = 22
    gy1 = topo_rod - gap - casos_h - gap - stats_h - gap
    grafico(t, M, y, w - M, gy1, ex)
    # estatísticas grandes
    sy = gy1 + gap
    bw = (w - 2 * M - 2 * 20) / 3
    cartoes = [("CASOS", fmt(n, 0), TEXTO), ("COM LUCRO", f"{fmt(acerto, 0)}%", VERDE if acerto >= 50 else VERMELHO),
               ("MÉDIA", fmt_pct(medio, 2), VERDE if (medio or 0) >= 0 else VERMELHO)]
    for k, (rot, val, cor) in enumerate(cartoes):
        bx = M + k * (bw + 20)
        t.retangulo(bx, sy, bx + bw, sy + stats_h, preenche=PAINEL, borda=BORDA, raio=18)
        t.texto(bx + bw / 2, sy + 38, rot, "b", 22, MUDO, "ms")
        t.texto(bx + bw / 2, sy + 98, val, "b", 62 if len(val) < 7 else 54, cor, "ms")
    # últimos casos
    cy = sy + stats_h + gap
    t.texto(M, cy + 28, f"{'Venda · s' if not compra else 'S'}aída 10 pregões depois · últimos {n_casos} casos", "b", 24, MUDO)
    for k, (sinal, ent, _sd, sai, r) in enumerate(ex["lista"][-n_casos:][::-1]):
        ry = cy + 46 + k * 46 + 34
        t.circulo(M + 10, ry - 9, 8, VERDE if r >= 0 else VERMELHO)
        t.texto(M + 36, ry, fmt_data(sinal), "m", 28, TEXTO)
        t.texto(M + 250, ry, f"{fmt_preco(ent, True)}  →  {fmt_preco(sai, True)}", "m", 28, MUDO)
        t.texto(w - M, ry, fmt_pct(r, 1), "m", 30, VERDE if r >= 0 else VERMELHO, "rs")
    # rodapé
    t.linha(M, topo_rod, w - M, topo_rod, BORDA, 1.5)
    ry = topo_rod + 38
    for ln in ("Estudo estatístico, não é recomendação.", "Resultado passado não garante resultado futuro."):
        t.texto(M, ry, ln, "n", 24, MUDO)
        ry += 32
    t.texto(M, base - 8, SITE_CURTO, "b", 28, ACENTO)
    t.texto(w - M, base - 8, "backtest sem custos", "n", 22, MUDO, "rs")
    caminho.parent.mkdir(parents=True, exist_ok=True)
    t.salvar(caminho)


# ---------------------------------------------------------------- newsletter

def semana(ctx) -> dict:
    """Sinais de entrada (diário, ativos líquidos) dos últimos 7 dias corridos e o estado atual do mercado."""
    R = ctx["R"]
    ref = max(ctx["sessao"].values(), default=None)
    ini = (date.fromisoformat(ref) - timedelta(days=6)).isoformat() if ref else None
    contagem: dict[str, set] = defaultdict(set)
    por_lado: dict[str, str] = {}
    for s in R["sinais"]:
        a = ctx["por_tk"].get(s["ticker"])
        if s["tf"] != "D" or not ref or not (ini <= s["data"] <= ref) or not entrada(ctx, s["setup"]) or not a or a.get("liquido") is False:
            continue
        contagem[s["setup"]].add((s["ticker"], s["data"]))
        por_lado[s["setup"]] = s["lado"]
    top = sorted(contagem.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:3]
    # o que está em formação: sinais do último pregão fechado de cada mercado
    hoje = Counter()
    for s in R["sinais"]:
        a = ctx["por_tk"].get(s["ticker"])
        if s["tf"] == "D" and entrada(ctx, s["setup"]) and a and a.get("liquido") is not False and ctx["sessao"].get(a["mercado"]) == s["data"]:
            hoje[s["setup"]] += 1
    liq = [a for a in R["ativos"] if a.get("liquido") is not False]
    return {
        "ref": ref, "ini": ini, "top": [(i, len(v), len({tk for tk, _ in v}), por_lado[i]) for i, v in top],
        "hoje": hoje.most_common(3),
        "ifr_baixo": sorted(a["rotulo"] for a in liq if a["mercado"] == "BR" and (a.get("ifr_d") or 50) < 30),
        "ifr_alto": sorted(a["rotulo"] for a in liq if a["mercado"] == "BR" and (a.get("ifr_d") or 50) > 70),
        "bb": sorted(a["rotulo"] for a in liq if a["mercado"] == "BR" and a.get("bb_comprimida")),
        "n_br": sum(1 for a in liq if a["mercado"] == "BR"),
    }


def lista_curta(lst, k=8) -> str:
    return ", ".join(lst[:k]) + (f" e mais {len(lst) - k}" if len(lst) > k else "")


def newsletter(ctx, ex, dia: str, saida: Path):
    w = semana(ctx)
    if not w["ref"]:
        return None
    bt = lambda i, k: ((ctx["itens"].get(i) or {}).get("bt", {}).get("D") or {}).get(k)  # noqa: E731
    a, s = ex["ativo"], ex["s"]
    tk = a.get("rotulo") or sem_sufixo(a["ticker"])
    n, acerto, medio, _ = s["bt"]
    intervalo = f"{fmt_data(w['ini'], True)} a {fmt_data(w['ref'], True)}"
    abertura = (f"De {intervalo}, estes foram os {len(w['top'])} setups com mais sinais nos ativos líquidos do terminal. "
                "Abaixo, um caso real com o histórico dele e o que vale olhar na próxima semana. "
                "Tudo vem dos dados publicados do terminal; é estudo estatístico, não recomendação.")
    # 3 setups com mais sinais
    blocos = []
    for i, nsin, nat, lado in w["top"]:
        txt = f"{nsin} sinais em {nat} ativos."
        if bt(i, "n"):
            txt += (f" No catálogo inteiro (todos os mercados, 6 anos), esse setup somou {fmt(bt(i, 'n'), 0)} casos, "
                    f"{fmt(bt(i, 'acerto'), 0)}% com lucro e média de {fmt_pct(bt(i, 'medio'), 2)} saindo em 10 pregões.")
        blocos.append((nome_setup(ctx, i), lado, txt))
    # caso real
    ult = ex["lista"][-3:][::-1]
    caso = (f"{a['nome']} ({tk}) deu sinal de {ex['lado']} do setup {nome_setup(ctx, s['setup'])} em {fmt_data(s['data'], True)}. "
            f"Esse setup já apareceu {n} vezes em {tk}: {fmt(acerto, 0)}% terminaram com lucro, média de {fmt_pct(medio, 2)} "
            "saindo 10 pregões depois (sem custos).")
    # próxima semana
    prox = []
    if w["hoje"]:
        prox.append("Setups que mais se formaram no último pregão: " + "; ".join(f"{nome_setup(ctx, i)} ({c} ativos)" for i, c in w["hoje"]) + ".")
    if w["ifr_baixo"]:
        prox.append(f"Ações da B3 líquidas com IFR diário abaixo de 30 (sobrevendidas): {lista_curta(w['ifr_baixo'])}.")
    if w["ifr_alto"]:
        prox.append(f"Com IFR diário acima de 70 (sobrecompradas): {lista_curta(w['ifr_alto'])}.")
    if w["bb"]:
        prox.append(f"Com as Bandas de Bollinger comprimidas (volatilidade baixa, às vezes antes de um rompimento): {lista_curta(w['bb'])}.")
    if not prox:
        prox.append("Nenhum ativo em extremo de IFR nem com Bollinger comprimida no último pregão.")
    titulo = f"Carteira Terminal · resumo da semana ({intervalo})"

    # --- markdown
    md = [f"# {titulo}", "", abertura, "", "## Os 3 setups com mais sinais na semana", ""]
    for k, (nm, lado, txt) in enumerate(blocos, 1):
        md += [f"{k}. **{nm}** ({lado}): {txt}"]
    md += ["", "## Um caso real com histórico", "", caso, "", "| Sinal | Entrada | Saída | Resultado |", "|---|---:|---:|---:|"]
    md += [f"| {fmt_data(d)} | {fmt_preco(e)} | {fmt_preco(sa)} | {fmt_pct(r, 1)} |" for d, e, _sd, sa, r in ult]
    md += ["", "## O que olhar na próxima semana", ""] + [f"- {p}" for p in prox]
    md += ["", "## Aviso", "", AVISO + " Backtest sem custos operacionais, impostos ou deslizamento.", "",
           f"Terminal gratuito: {SITE}", ""]
    (saida / f"newsletter-{dia}.md").write_text("\n".join(md), encoding="utf-8")

    # --- html (tabelas e estilos inline, para clientes de e-mail)
    def h(txt):  # escape mínimo
        return txt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    F = "font-family:Arial,Helvetica,sans-serif;"
    def sec(tit, corpo):
        return (f'<tr><td style="padding:22px 28px 0 28px;{F}"><h2 style="margin:0 0 10px 0;font-size:18px;color:#0b1220;{F}">{h(tit)}</h2>'
                f'{corpo}</td></tr>')
    def par(txt, extra=""):
        return f'<p style="margin:0 0 10px 0;font-size:15px;line-height:1.55;color:#2a3342;{F}{extra}">{txt}</p>'
    top_html = "".join(par(f'<b>{k}. {h(nm)}</b> <span style="color:{"#14805a" if lado == "compra" else "#c23b40"}">({h(lado)})</span><br>{h(txt)}')
                       for k, (nm, lado, txt) in enumerate(blocos, 1)) or par("Sem sinais de entrada na janela.")
    linhas_tab = "".join(
        f'<tr><td style="padding:7px 8px;border-bottom:1px solid #e3e8f0;font-size:14px;color:#2a3342;{F}">{fmt_data(d)}</td>'
        f'<td align="right" style="padding:7px 8px;border-bottom:1px solid #e3e8f0;font-size:14px;color:#2a3342;{F}">{fmt_preco(e)}</td>'
        f'<td align="right" style="padding:7px 8px;border-bottom:1px solid #e3e8f0;font-size:14px;color:#2a3342;{F}">{fmt_preco(sa)}</td>'
        f'<td align="right" style="padding:7px 8px;border-bottom:1px solid #e3e8f0;font-size:14px;font-weight:bold;color:{"#14805a" if r >= 0 else "#c23b40"};{F}">{fmt_pct(r, 1)}</td></tr>'
        for d, e, _sd, sa, r in ult)
    tabela = (f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 4px 0">'
              f'<tr><th align="left" style="padding:6px 8px;font-size:12px;color:#6b7788;{F}">Sinal</th>'
              f'<th align="right" style="padding:6px 8px;font-size:12px;color:#6b7788;{F}">Entrada</th>'
              f'<th align="right" style="padding:6px 8px;font-size:12px;color:#6b7788;{F}">Saída</th>'
              f'<th align="right" style="padding:6px 8px;font-size:12px;color:#6b7788;{F}">Resultado</th></tr>{linhas_tab}</table>')
    html = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{h(titulo)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;"><tr><td align="center" style="padding:20px 10px;">
<table width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
<tr><td style="background:#07090d;padding:22px 28px;{F}"><span style="font-size:20px;font-weight:bold;color:#e9eef6;">Carteira <span style="color:#4c8dff;">Terminal</span></span><br>
<span style="font-size:13px;color:#8591a3;">Resumo da semana · {h(intervalo)}</span></td></tr>
<tr><td style="padding:24px 28px 0 28px;{F}">{par(h(abertura))}</td></tr>
{sec("Os 3 setups com mais sinais na semana", top_html)}
{sec("Um caso real com histórico", par(h(caso)) + tabela)}
{sec("O que olhar na próxima semana", "".join(par(h(p)) for p in prox))}
<tr><td style="padding:24px 28px;{F}"><p style="margin:0 0 14px 0;"><a href="{SITE}" style="display:inline-block;background:#4c8dff;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:8px;{F}">Abrir o terminal</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7788;{F}">{h(AVISO)} Backtest sem custos operacionais, impostos ou deslizamento. Os números vêm dos dados publicados do terminal.</p></td></tr>
</table></td></tr></table></body></html>
"""
    (saida / f"newsletter-{dia}.html").write_text(html, encoding="utf-8")
    return {"data": dia, "titulo": titulo, "html": f"newsletter-{dia}.html", "md": f"newsletter-{dia}.md"}


# ---------------------------------------------------------------- principal

def limpar(saida: Path, hoje: date):
    corte = (hoje - timedelta(days=DIAS_GUARDAR)).isoformat()
    for f in saida.iterdir():
        m = re.match(r"(?:post|story|newsletter)-(\d{4}-\d{2}-\d{2})", f.name)
        if m and m.group(1) < corte:
            f.unlink()


def ultima_newsletter(saida: Path):
    arqs = sorted(saida.glob("newsletter-*.html"))
    if not arqs:
        return None
    dia = arqs[-1].stem.removeprefix("newsletter-")
    return {"data": dia, "html": arqs[-1].name, "md": f"newsletter-{dia}.md" if (saida / f"newsletter-{dia}.md").exists() else None}


def herdar_newsletter(saida: Path) -> None:
    """No Actions o data/ nasce vazio a cada rodada: traz do site publicado a última newsletter (se for recente),
    para a página não ficar sem ela nos outros dias da semana. Falha em silêncio."""
    try:
        import requests
        base = SITE + "data/conteudo/"
        n = requests.get(base + "hoje.json", timeout=8).json().get("newsletter") or {}
        dia = n.get("data") or ""
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dia) or dia < (date.today() - timedelta(days=DIAS_GUARDAR)).isoformat():
            return
        for ext, nome in (("html", n.get("html")), ("md", n.get("md"))):
            if nome and nome == f"newsletter-{dia}.{ext}":
                r = requests.get(base + nome, timeout=8)
                if r.ok:
                    (saida / nome).write_bytes(r.content)
    except Exception:
        return


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--newsletter", action="store_true", help="gera também a newsletter semanal (automático às sextas)")
    ap.add_argument("--sem-rede", action="store_true", help="não tenta buscar a newsletter anterior no site publicado")
    ap.add_argument("--data", default=str(RAIZ / "data"))
    ap.add_argument("--saida", default=None)
    args = ap.parse_args(argv)
    dados = Path(args.data)
    saida = Path(args.saida) if args.saida else dados / "conteudo"
    saida.mkdir(parents=True, exist_ok=True)
    agora = datetime.now(timezone.utc)
    hoje = agora.date()
    base = {"gerado_em": agora.isoformat(timespec="seconds"), "site": SITE}

    R, S = ler(dados / "radar.json"), ler(dados / "setups.json")
    escolhidos = []
    ctx = None
    if R and S:
        ctx = montar_contexto(R, S)
        try:
            escolhidos = escolher(ctx, dados)
        except Exception as e:  # nunca derruba o build por causa do conteúdo
            print(f"conteudo: falha ao escolher exemplos ({e!r})", file=sys.stderr)
    try:
        limpar(saida, hoje)
    except OSError:
        pass
    if not args.newsletter and hoje.weekday() != 4 and not ultima_newsletter(saida) and not args.sem_rede:
        herdar_newsletter(saida)
    # sexta-feira, a pedido, ou quando ainda não existe nenhuma newsletter recente
    quer_news = args.newsletter or hoje.weekday() == 4 or not ultima_newsletter(saida)
    news = None
    if not escolhidos:
        print("conteudo: nenhum exemplo qualificado hoje.")
        (saida / "hoje.json").write_text(json.dumps({**base, "vazio": True, "newsletter": ultima_newsletter(saida)},
                                                    ensure_ascii=False, indent=1), encoding="utf-8")
        return 0

    dia = escolhidos[0]["s"]["data"]
    itens = []
    for k, ex in enumerate(escolhidos):
        suf = "" if k == 0 else f"-{k + 1}"
        post, story, leg = f"post-{dia}{suf}.png", f"story-{dia}{suf}.png", f"post-{dia}{suf}.txt"
        desenhar(ctx, ex, saida / post, 1080, 1350)
        desenhar(ctx, ex, saida / story, 1080, 1920, story=True)
        (saida / leg).write_text(legenda(ctx, ex), encoding="utf-8")
        a, s = ex["ativo"], ex["s"]
        itens.append({"ticker": a["ticker"], "rotulo": a.get("rotulo") or sem_sufixo(a["ticker"]), "nome": a["nome"],
                      "mercado": a["mercado"], "lado": ex["lado"], "setup": s["setup"], "setup_nome": nome_setup(ctx, s["setup"]),
                      "data": s["data"], "casos": s["bt"][0], "acerto": s["bt"][1], "medio": s["bt"][2],
                      "setups_hoje": len(ex["setups"]), "post": post, "story": story, "legenda": leg})
        print(f"conteudo: {itens[-1]['rotulo']} · {itens[-1]['setup_nome']} → {post}")
    if quer_news:
        try:
            news = newsletter(ctx, escolhidos[0], dia, saida)
        except Exception as e:
            print(f"conteudo: falha na newsletter ({e!r})", file=sys.stderr)
    (saida / "hoje.json").write_text(json.dumps(
        {**base, "vazio": False, "data": dia, "principal": itens[0], "alternativas": itens[1:],
         "newsletter": news or ultima_newsletter(saida), "aviso": AVISO}, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:   # o conteúdo é opcional: nunca quebra a publicação
        print(f"conteudo: erro inesperado ({e!r})", file=sys.stderr)
        sys.exit(0)
