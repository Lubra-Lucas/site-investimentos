"""Páginas públicas estáticas por ativo (para o Google): ativos/<slug>.html, ativos/index.html, sitemap.xml e robots.txt.

Roda depois de ranking.py/resultados.py e antes de "Montar site". Só números dos dados publicados
(radar.json, setups.json, casos/, ativos/); sem dados, sai com código 0 sem gerar nada.
Reaproveita as regras do conteudo.py (último pregão fechado do mercado, só setups de entrada, ativo líquido e em dia)
e a nota de confiabilidade do ranking.py (limite inferior de Wilson 95%).
Estudo estatístico, não recomendação. Resultado passado não garante resultado futuro; sem custos e impostos.

Uso: python scripts/paginas_ativos.py [--dados data] [--saida .]
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conteudo as C  # noqa: E402
from ranking import wilson_inferior  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
SITE = C.SITE
MERCADOS = ("BR", "US", "CRIPTO")
NOME_MERCADO = {"BR": "Brasil", "US": "EUA", "CRIPTO": "Cripto"}
MIN_CASOS = 10
JANELA = 120
TELEGRAM = "https://t.me/canalterminalbot"
AVISO = ("Estudo estatístico de possíveis oportunidades, não é recomendação de investimento. "
         "Resultado passado não garante resultado futuro. Sem custos e impostos.")
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='%234c8dff'%3E"
           "%3Crect x='3' y='11' width='3.4' height='9' rx='1'/%3E%3Crect x='10.3' y='6' width='3.4' height='14' rx='1'/%3E"
           "%3Crect x='17.6' y='3' width='3.4' height='17' rx='1'/%3E%3C/g%3E%3C/svg%3E")
MARCA_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#4c8dff"><rect x="3" y="11" width="3.4" height="9" rx="1"/>'
             '<rect x="10.3" y="6" width="3.4" height="14" rx="1"/><rect x="17.6" y="3" width="3.4" height="17" rx="1"/></g></svg>')
TEND = {"alta": "em alta", "baixa": "em baixa", "lateral": "lateral (sem direção clara)"}
MOEDA = {"BRL": "R$", "USD": "US$"}
PRINCIPAIS = ("index.html", "painel.html", "setups.html", "ranking.html", "resultados.html", "backtest.html", "guia.html")

e = html.escape


def slug(a: dict) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (a.get("rotulo") or C.sem_sufixo(a["ticker"])).lower()).strip("-")


def pct(v, c=1) -> str:
    if v is not None and round(v, c) == 0:
        v = 0.0  # evita "-0,0%"
    return C.fmt_pct(v, c)


def cls(v) -> str:
    return "" if v is None or round(v, 1) == 0 else "alta" if v > 0 else "baixa"


def span_pct(v) -> str:
    return f'<span class="{cls(v)}">{e(pct(v))}</span>'


def preco(a: dict, v) -> str:
    return f"{MOEDA.get(a.get('moeda'), '')} {C.fmt_preco(v)}".strip()


def anos_de(candles: list) -> str:
    if len(candles) < 2:
        return "no período analisado"
    d0, d1 = date.fromisoformat(candles[0][0]), date.fromisoformat(candles[-1][0])
    anos = round((d1 - d0).days / 365.25)
    return "em 1 ano" if anos <= 1 else f"em {anos} anos"


def minigrafico(candles: list) -> str:
    fech = [c[4] for c in candles[-JANELA:] if c[4] is not None]
    if len(fech) < 10:
        return ""
    lo, hi = min(fech), max(fech)
    W, H, P = 600, 150, 6
    rng = (hi - lo) or 1
    pts = " ".join(f"{P + i * (W - 2 * P) / (len(fech) - 1):.1f},{H - P - (v - lo) / rng * (H - 2 * P):.1f}"
                   for i, v in enumerate(fech))
    cor = "#22b07d" if fech[-1] >= fech[0] else "#e5484d"
    return (f'<svg class="pa-grafico" viewBox="0 0 {W} {H}" role="img" aria-label="Linha dos últimos {len(fech)} fechamentos">'
            f'<polyline points="{pts}" fill="none" stroke="{cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>'
            f'<p class="pa-grafico-nota">Fechamentos dos últimos {len(fech)} pregões, de {e(C.fmt_data(candles[-len(fech)][0], True))} '
            f'a {e(C.fmt_data(candles[-1][0], True))}. Mínimo {e(C.fmt_preco(lo))}, máximo {e(C.fmt_preco(hi))}.</p>')


def historico_setups(ctx, casos: dict) -> list[dict]:
    out = []
    for sid, lista in ((casos or {}).get("casos", {}).get("D") or {}).items():
        if not C.entrada(ctx, sid):
            continue
        res = [x[4] for x in lista if x[4] is not None]
        if len(res) < MIN_CASOS:
            continue
        ganhos = sum(1 for r in res if r > 0)
        out.append({"id": sid, "nome": C.nome_setup(ctx, sid), "lado": ctx["itens"][sid].get("vies"), "casos": len(res),
                    "acerto": ganhos / len(res) * 100, "medio": sum(res) / len(res),
                    "nota": wilson_inferior(ganhos, len(res))})
    out.sort(key=lambda x: (-x["nota"], -x["medio"], x["nome"]))
    return out


def ultimos_casos(ctx, casos: dict, n=8) -> list[tuple]:
    todos = []
    for sid, lista in ((casos or {}).get("casos", {}).get("D") or {}).items():
        if not C.entrada(ctx, sid):
            continue
        for x in lista:
            if x[4] is not None:
                todos.append((x[2], x[0], sid, x[1], x[3], x[4]))
    todos.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
    return todos[:n]


def historia_setup(sinal: dict, anos: str) -> str:
    bt = sinal.get("bt")
    if not bt or bt[0] is None or bt[0] < 1:
        return "Ainda não há casos suficientes deste setup neste ativo para mostrar um histórico."
    ganhos = round(bt[1] / 100 * bt[0]) if bt[1] is not None else None
    fim = f"; em {ganhos} terminou no lucro ({C.fmt(bt[1], 0)}%)" if ganhos is not None else ""
    medio = f"; retorno médio de {pct(bt[2])} saindo 10 pregões depois" if bt[2] is not None else ""
    return f"Neste ativo, apareceu {bt[0]} {'vez' if bt[0] == 1 else 'vezes'} {anos}{fim}{medio}."


def relacionados(a: dict, ativos: list[dict], n=6) -> list[dict]:
    """Mesmo mercado (não há setor nos dados): os de variação no ano mais parecida com a deste ativo."""
    mesmos = [x for x in ativos if x["mercado"] == a["mercado"] and x["ticker"] != a["ticker"]]
    ref = a.get("var_ano_pct")
    if ref is None:
        i = next((k for k, x in enumerate(ativos) if x["ticker"] == a["ticker"]), 0)
        viz = sorted(mesmos, key=lambda x: abs(ativos.index(x) - i))
    else:
        viz = sorted(mesmos, key=lambda x: (abs((x.get("var_ano_pct") if x.get("var_ano_pct") is not None else 1e9) - ref), x["ticker"]))
    return viz[:n]


def cabeca(titulo: str, desc: str, canonico: str, jsonld: str, nivel: str) -> str:
    return (f'<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{e(titulo)}</title>\n<meta name="description" content="{e(desc, quote=True)}">\n'
            f'<link rel="canonical" href="{e(canonico)}">\n<meta name="robots" content="index, follow">\n'
            f'<meta name="theme-color" content="#0c1016">\n<link rel="icon" href="{FAVICON}">\n'
            f'<meta property="og:type" content="website">\n<meta property="og:locale" content="pt_BR">\n'
            f'<meta property="og:site_name" content="Carteira Terminal">\n<meta property="og:title" content="{e(titulo, quote=True)}">\n'
            f'<meta property="og:description" content="{e(desc, quote=True)}">\n<meta property="og:url" content="{e(canonico)}">\n'
            f'<meta name="twitter:card" content="summary">\n'
            f'<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            f'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">\n'
            f'<link rel="stylesheet" href="{nivel}assets/css/pagina-ativo.css">\n'
            f'<script type="application/ld+json">{jsonld}</script>\n'
            f'<script defer src="{nivel}assets/js/medicao.js"></script>\n</head>\n<body>\n'
            f'<header class="pa-topo"><div><a class="pa-marca" href="{nivel}index.html">{MARCA_SVG}Carteira Terminal</a>'
            f'<nav aria-label="Principal"><a href="{nivel}painel.html">Painel</a><a href="{nivel}setups.html">Oportunidades</a>'
            f'<a href="{nivel}ranking.html">Top do dia</a><a href="index.html">Todos os ativos</a></nav></div></header>\n')


def rodape(nivel: str) -> str:
    return (f'<footer><p>{e(AVISO)}</p><p><a href="{nivel}termos.html">Termos de uso</a> · '
            f'<a href="{nivel}privacidade.html">Política de privacidade</a></p></footer>\n</body>\n</html>\n')


def jsonld(nome: str, desc: str, url: str, trilha: list[tuple[str, str]]) -> str:
    import json
    d = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "name": nome, "description": desc, "url": url, "inLanguage": "pt-BR",
         "isPartOf": {"@type": "WebSite", "name": "Carteira Terminal", "url": SITE}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(trilha)]}]}
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def pagina(ctx, a: dict, sl: str, dados: Path, ativos: list[dict], slugs: dict, hoje: dict) -> str:
    rot = a.get("rotulo") or C.sem_sufixo(a["ticker"])
    velas = C.ler(dados / "ativos" / f"{a['arquivo']}.json") or {}
    candles = velas.get("c") or []
    casos = C.ler(dados / "casos" / f"{a['arquivo']}.json") or {}
    anos = anos_de(candles)
    mercado = NOME_MERCADO[a["mercado"]]
    titulo = f"{rot} ({a['nome']}): sinais técnicos de hoje e histórico | Carteira Terminal"
    desc = (f"{rot} ({a['nome']}): fechamento de {C.fmt_data(a['data'], True)}, tendência no diário e no semanal, "
            f"setups de hoje e como cada setup se saiu neste ativo nos últimos anos. Estudo estatístico, não é recomendação.")
    url = f"{SITE}ativos/{sl}.html"
    ld = jsonld(titulo, desc, url, [("Carteira Terminal", SITE), ("Ativos", f"{SITE}ativos/index.html"), (rot, url)])
    h = [cabeca(titulo, desc, url, ld, "../")]
    h.append('<main>\n')
    h.append(f'<p class="pa-migalhas"><a href="../index.html">Carteira Terminal</a> › <a href="index.html">Ativos</a> › {e(rot)}</p>\n')
    h.append(f'<h1>{e(rot)}: sinais técnicos de hoje e histórico</h1>\n'
             f'<p class="pa-sub">{e(a["nome"])} · {e(mercado)} · ticker {e(a["ticker"])}</p>\n')
    h.append('<section class="pa-painel" aria-labelledby="h-res"><h2 id="h-res">Resumo</h2>\n<dl class="pa-resumo">')
    h.append(f'<div><dt>Último fechamento</dt><dd>{e(preco(a, a["ultimo"]))} <small>em {e(C.fmt_data(a["data"], True))}</small></dd></div>')
    for rotulo, k in (("No dia", "var_dia_pct"), ("No mês", "var_mes_pct"), ("No ano", "var_ano_pct")):
        h.append(f'<div><dt>{rotulo}</dt><dd>{span_pct(a.get(k))}</dd></div>')
    h.append(f'<div><dt>Tendência no diário</dt><dd>{e(TEND.get(a.get("tend_d"), "indefinida"))}</dd></div>')
    h.append(f'<div><dt>Tendência no semanal</dt><dd>{e(TEND.get(a.get("tend_s"), "indefinida"))}</dd></div></dl>\n')
    h.append(minigrafico(candles))
    h.append('</section>\n')

    # sinais de hoje
    h.append('<section class="pa-painel" aria-labelledby="h-sin">\n')
    sinais = hoje.get(a["ticker"], [])
    if sinais:
        h.append(f'<h2 id="h-sin">Sinais de hoje ({e(C.fmt_data(a["data"], True))})</h2>\n')
        for s in sorted(sinais, key=lambda s: ((s.get("bt") or [0])[0] * -1, s["setup"])):
            lado = {"compra": "compra", "venda": "venda"}.get(s["lado"], s["lado"])
            c = "alta" if lado == "compra" else "baixa"
            h.append(f'<div class="pa-sinal"><strong>{e(C.nome_setup(ctx, s["setup"]))}</strong>'
                     f'<span class="pa-lado {c}">{e(lado)}</span><p>{e(historia_setup(s, anos))}</p></div>\n')
    else:
        h.append('<h2 id="h-sin">Sinais de hoje</h2>\n')
        h.append(f'<p>Nenhum setup de entrada apareceu em {e(rot)} no último pregão '
                 f'({e(C.fmt_data(ctx["sessao"].get(a["mercado"]) or a["data"], True))}).</p>\n')
        rec = sorted((s for s in ctx["R"]["sinais"] if s["ticker"] == a["ticker"] and s["tf"] == "D" and C.entrada(ctx, s["setup"])),
                     key=lambda s: (s["data"], s["setup"]), reverse=True)[:5]
        if rec:
            h.append('<p>Os sinais mais recentes neste ativo:</p>\n<div class="pa-tabela-caixa"><table><thead><tr><th>Setup</th><th>Lado</th>'
                     '<th>Data</th></tr></thead><tbody>')
            for s in rec:
                h.append(f'<tr><td>{e(C.nome_setup(ctx, s["setup"]))}</td><td>{e(s["lado"])}</td><td>{e(C.fmt_data(s["data"], True))}</td></tr>')
            h.append('</tbody></table></div>\n')
    h.append('</section>\n')

    # histórico dos setups
    hist = historico_setups(ctx, casos)
    h.append('<section class="pa-painel" aria-labelledby="h-his"><h2 id="h-his">Histórico dos setups neste ativo</h2>\n')
    if hist:
        h.append(f'<p class="pa-sub">Setups com pelo menos {MIN_CASOS} casos em {e(rot)}, ordenados pela confiabilidade '
                 f'(limite inferior do intervalo de Wilson de 95% da taxa de lucro). Saída 10 pregões depois da entrada.</p>\n'
                 '<div class="pa-tabela-caixa"><table><thead><tr><th>Setup</th><th class="num">Casos</th><th class="num">No lucro</th>'
                 '<th class="num">Retorno médio</th></tr></thead><tbody>')
        for x in hist[:15]:
            h.append(f'<tr><td>{e(x["nome"])}</td><td class="num">{x["casos"]}</td><td class="num">{e(C.fmt(x["acerto"], 0))}%</td>'
                     f'<td class="num">{span_pct(x["medio"])}</td></tr>')
        h.append('</tbody></table></div>\n')
    else:
        h.append(f'<p>Nenhum setup tem ainda {MIN_CASOS} casos ou mais em {e(rot)}.</p>\n')
    h.append('</section>\n')

    # últimos casos
    ult = ultimos_casos(ctx, casos)
    if ult:
        h.append('<section class="pa-painel" aria-labelledby="h-ult"><h2 id="h-ult">Últimos casos encerrados</h2>\n'
                 '<div class="pa-tabela-caixa"><table><thead><tr><th>Sinal</th><th>Setup</th><th class="num">Entrada</th>'
                 '<th class="num">Saída</th><th class="num">Resultado</th></tr></thead><tbody>')
        for saida, sinal, sid, ent, sai, res in ult:
            h.append(f'<tr><td>{e(C.fmt_data(sinal, True))}</td><td>{e(C.nome_setup(ctx, sid))}</td>'
                     f'<td class="num">{e(C.fmt_preco(ent))}</td><td class="num">{e(C.fmt_preco(sai))} <small>({e(C.fmt_data(saida))})</small></td>'
                     f'<td class="num">{span_pct(res)}</td></tr>')
        h.append('</tbody></table></div></section>\n')

    h.append('<section class="pa-painel pa-texto" aria-labelledby="h-que"><h2 id="h-que">O que é um setup e como ler este histórico</h2>\n'
             '<p>Setup é uma situação de preço definida por regras objetivas, como um recuo até a média ou um rompimento. '
             'O terminal procura esses padrões nos gráficos de todos os ativos e registra cada vez que um apareceu.</p>\n'
             '<p>O histórico mostra o que aconteceu neste ativo nas vezes em que o setup apareceu: quantas vezes terminou no lucro '
             'e qual foi o retorno médio saindo 10 pregões depois da entrada. Inclui os casos de prejuízo. '
             'É uma medida do passado, sem custos e impostos, e não indica o que vai acontecer.</p></section>\n')

    h.append('<div class="pa-acoes">'
             f'<a class="pa-botao pri" href="../ativo.html#{e(rot)}">Ver {e(rot)} no terminal</a>'
             '<a class="pa-botao" href="../setups.html">Ver as oportunidades de hoje</a>'
             '<a class="pa-botao" href="../ranking.html">Top do dia</a>'
             f'<a class="pa-botao" href="{TELEGRAM}" rel="noopener">Canal no Telegram</a></div>\n')

    rel = relacionados(a, ativos)
    if rel:
        h.append('<section class="pa-painel" aria-labelledby="h-rel"><h2 id="h-rel">Outros ativos do mesmo mercado</h2><ul class="pa-chips">')
        for x in rel:
            h.append(f'<li><a href="{slugs[x["ticker"]]}.html">{e(x.get("rotulo") or x["ticker"])}</a></li>')
        h.append('</ul><p style="margin:12px 0 0"><a href="index.html">Ver todos os ativos</a></p></section>\n')
    h.append('</main>\n')
    h.append(rodape("../"))
    return "".join(h)


def pagina_indice(ativos: list[dict], slugs: dict) -> str:
    titulo = "Todos os ativos: ações do Brasil, EUA e criptomoedas | Carteira Terminal"
    desc = (f"Lista de {len(ativos)} ativos (ações brasileiras, ações americanas e criptomoedas) com a página de sinais técnicos "
            "e o histórico dos setups de cada um. Estudo estatístico, não é recomendação.")
    url = f"{SITE}ativos/index.html"
    ld = jsonld(titulo, desc, url, [("Carteira Terminal", SITE), ("Ativos", url)])
    h = [cabeca(titulo, desc, url, ld, "../"), '<main>\n',
         '<p class="pa-migalhas"><a href="../index.html">Carteira Terminal</a> › Ativos</p>\n',
         '<h1>Todos os ativos</h1>\n<p class="pa-sub">Escolha um ativo para ver os sinais técnicos de hoje e como cada setup se saiu nele.</p>\n',
         '<input class="pa-busca" id="busca" type="search" placeholder="Buscar por ticker ou nome" aria-label="Buscar ativo" autocomplete="off">\n']
    for m in MERCADOS:
        lista = sorted((a for a in ativos if a["mercado"] == m), key=lambda a: a.get("rotulo") or a["ticker"])
        if not lista:
            continue
        h.append(f'<section class="pa-painel" data-m><h2>{e(NOME_MERCADO[m])} <small class="pa-sub">({len(lista)})</small></h2><ul class="pa-grade">')
        for a in lista:
            rot = a.get("rotulo") or a["ticker"]
            h.append(f'<li data-q="{e((rot + " " + a["nome"]).lower(), quote=True)}"><a href="{slugs[a["ticker"]]}.html"><b>{e(rot)}</b><span>{e(a["nome"])}</span></a></li>')
        h.append('</ul></section>\n')
    h.append('<div class="pa-acoes"><a class="pa-botao pri" href="../setups.html">Ver as oportunidades de hoje</a>'
             '<a class="pa-botao" href="../ranking.html">Top do dia</a></div>\n</main>\n')
    h.append('<script>(function(){var b=document.getElementById("busca");if(!b)return;b.addEventListener("input",function(){'
             'var q=b.value.trim().toLowerCase();document.querySelectorAll("li[data-q]").forEach(function(li){'
             'li.hidden=q&&li.getAttribute("data-q").indexOf(q)<0;});document.querySelectorAll("section[data-m]").forEach(function(s){'
             's.hidden=!s.querySelector("li:not([hidden])");});});})();</script>\n')
    h.append(rodape("../"))
    return "".join(h)


def sitemap(slugs: dict, hoje: str) -> str:
    urls = [f"{SITE}{p}" if p != "index.html" else SITE for p in PRINCIPAIS]
    urls.append(f"{SITE}ativos/index.html")
    urls += [f"{SITE}ativos/{s}.html" for s in sorted(set(slugs.values()))]
    corpo = "".join(f"  <url><loc>{e(u)}</loc><lastmod>{hoje}</lastmod></url>\n" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{corpo}</urlset>\n'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dados", default=str(RAIZ / "data"))
    ap.add_argument("--saida", default=str(RAIZ))
    args = ap.parse_args(argv)
    dados, saida = Path(args.dados), Path(args.saida)
    t0 = time.time()
    R, S = C.ler(dados / "radar.json"), C.ler(dados / "setups.json")
    if not R or not S or not R.get("ativos"):
        print("Páginas de ativos: sem dados, nada a gerar")
        return 0
    try:
        R["sinais"] = C.descompactar_sinais(R.get("sinais", []))
        ctx = C.montar_contexto(R, S)
        base = [a for a in R["ativos"] if a["mercado"] in MERCADOS and a.get("data") and a.get("ultimo") is not None]
        ativos = []
        for m in MERCADOS:  # só líquidos; se o mercado não tiver nenhum, usa todos (mesma regra do Painel)
            do_m = [a for a in base if a["mercado"] == m]
            ativos += [a for a in do_m if a.get("liquido") is not False] or do_m
        slugs, usados = {}, set()
        for a in ativos:
            sl = slug(a) or re.sub(r"[^a-z0-9]+", "-", a["ticker"].lower()).strip("-")
            if sl in usados:
                sl = f"{sl}-{a['mercado'].lower()}"
            usados.add(sl)
            slugs[a["ticker"]] = sl
        hoje: dict[str, list] = {}
        for c in C.candidatos(ctx):
            hoje.setdefault(c["ativo"]["ticker"], []).extend(c["setups"].values())
        pasta = saida / "ativos"
        pasta.mkdir(parents=True, exist_ok=True)
        total = 0
        for a in ativos:
            try:
                (pasta / f"{slugs[a['ticker']]}.html").write_text(pagina(ctx, a, slugs[a["ticker"]], dados, ativos, slugs, hoje), encoding="utf-8")
                total += 1
            except Exception as ex:  # um ativo com dado ruim não derruba os outros
                print(f"Páginas de ativos: {a['ticker']} ignorado ({ex!r})")
                slugs.pop(a["ticker"], None)
        (pasta / "index.html").write_text(pagina_indice([a for a in ativos if a["ticker"] in slugs], slugs), encoding="utf-8")
        (saida / "sitemap.xml").write_text(sitemap(slugs, date.today().isoformat()), encoding="utf-8")
        (saida / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}sitemap.xml\n", encoding="utf-8")
        print(f"Páginas de ativos: {total} páginas em {time.time() - t0:.1f}s")
    except Exception as ex:  # nunca derruba o build
        print("Páginas de ativos: erro:", repr(ex))
    return 0


if __name__ == "__main__":
    sys.exit(main())
