"""Publica no canal do Telegram: o post do dia e duas publicações semanais em texto.

Lê data/conteudo/hoje.json (gerado por scripts/conteudo.py) e envia a imagem do
post principal com a legenda para o canal. Usa só a biblioteca padrão.

Segredos (GitHub → Settings → Secrets and variables → Actions):
  TELEGRAM_BOT_TOKEN  token do BotFather
  TELEGRAM_CHAT_ID    @ do canal (ex.: @carteiraterminal) ou ID numérico

Sem os segredos, sai sem fazer nada. Não posta a mesma data duas vezes: guarda a
última data publicada, o histórico dos posts e a semana de cada publicação
semanal em data/conteudo/telegram.json, que vai para o site e é lido de volta na
próxima execução (data/ começa vazio a cada build).

Logo depois do post diário, uma mensagem de texto "Top do dia" (3 de compra e 3 de venda de
data/ranking.json, gerado por scripts/ranking.py), uma vez por data.

Além do post diário, uma vez por semana ISO (datas em UTC):
  - resumo da semana (newsletter): na sexta, quando conteudo.py gera a newsletter;
  - "Como terminaram os sinais": a partir do sábado.

Três criativos por dia (imagens de scripts/criativos.py), cada um uma vez:
  1. Sinais do dia: assim que sai um Top do dia novo, um álbum com a imagem do Top do dia (3 de compra
     e 3 de venda) e a imagem do post do dia, com o Top na legenda.
  2. Educativo: a partir das 08:00 de Brasília, o próximo item de config/educativos.json (em rodízio).
  3. Como terminou: a partir das 12:00 de Brasília, um sinal publicado 10 pregões antes, com entrada,
     saída e o placar de todos os sinais daquele dia (inclusive os que deram prejuízo).
No máximo um post do tipo 2 ou 3 por execução, para espaçar; o workflow telegram.yml roda várias vezes ao dia.

Dados: lê data/ local; o que faltar baixa do site publicado (o workflow do Telegram roda sem gerar dados).
Estado: data/conteudo/telegram.json (o workflow guarda na branch estado-telegram).

Uso:
  python scripts/telegram_postar.py                   # publica o que estiver pendente
  python scripts/telegram_postar.py --simular         # mostra os textos, sem enviar (imagens em data/conteudo/simulacao/)
  python scripts/telegram_postar.py --forcar-semanal  # ignora o dia da semana e a semana já publicada
  python scripts/telegram_postar.py --agora 2026-11-18T13:00   # finge outra hora de Brasília (testes)
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "data" / "conteudo"
SITE = "https://lubra-lucas.github.io/site-investimentos/"
LIMITE_LEGENDA = 1024  # limite do Telegram para legenda de foto
LIMITE_TEXTO = 4096    # limite do Telegram para mensagem de texto
MAX_POSTS = 200        # tamanho do histórico de posts guardado
MAX_PUBLICADOS = 400   # registro dos sinais publicados (Top do dia e post do dia), base do "Como terminou"
PRAZO = 10             # pregões até a saída (mesmo prazo do backtest diário)
FUSO = ZoneInfo("America/Sao_Paulo")
HORA_EDUCATIVO = 8     # a partir de que hora (Brasília) sai o educativo
HORA_TERMINOU = 12     # e o "Como terminou"
MIN_GRUPO = 3          # sinais publicados num dia para o placar usar só o registro
AVISO_RESULTADO = ("Resultado passado não garante resultado futuro. Sem custos e impostos. "
                   "Estudo estatístico, não é recomendação.")


def ler_json(caminho: Path):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def obter(rel: str) -> Path:
    """Arquivo de data/: o local, senão baixa do site publicado (e guarda). Devolve o caminho, exista ou não."""
    destino = RAIZ / "data" / rel
    if not destino.is_file():
        try:
            with urllib.request.urlopen(SITE + "data/" + rel, timeout=60) as r:
                corpo = r.read()
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(corpo)
        except (urllib.error.URLError, OSError, ValueError):
            pass
    return destino


def ler_dado(rel: str):
    return ler_json(obter(rel))


def estado_publicado() -> dict:
    """Estado salvo: arquivo local, senão o publicado no site (data/ começa vazio a cada build).

    Aceita o formato antigo {"ultimo": "AAAA-MM-DD"}. Formato atual:
    {"ultimo": data, "posts": [{data, ticker, rotulo, setup, setup_nome, lado, relatado?}],
     "semanal": {"newsletter": "AAAA-Www", "resultados": "AAAA-Www"},
     "ranking": "AAAA-MM-DD",   # data do último Top do dia publicado
     "publicados": [{data, ticker, rotulo, setup, setup_nome, lado, origem: "top"|"post"}],
     "educativo": {"proximo": 0, "dia": "AAAA-MM-DD"},
     "terminou": {"dia": "AAAA-MM-DD", "datas": ["AAAA-MM-DD"]}}
    Chaves desconhecidas são preservadas.
    """
    bruto = ler_json(PASTA / "telegram.json")
    if not bruto:
        try:
            with urllib.request.urlopen(SITE + "data/conteudo/telegram.json", timeout=15) as r:
                bruto = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError):
            bruto = None
    if not isinstance(bruto, dict):
        bruto = {}
    estado = dict(bruto)
    posts = bruto.get("posts")
    semanal = bruto.get("semanal")
    estado.update({"ultimo": bruto.get("ultimo"),
                   "posts": [p for p in posts if isinstance(p, dict)] if isinstance(posts, list) else [],
                   "semanal": semanal if isinstance(semanal, dict) else {},
                   "ranking": bruto.get("ranking") if isinstance(bruto.get("ranking"), str) else None})
    for chave in ("educativo", "terminou"):
        if not isinstance(estado.get(chave), dict):
            estado[chave] = {}
    if not isinstance(estado.get("publicados"), list):
        # semente: os posts do dia já feitos entram no registro
        estado["publicados"] = [dict(p, origem="post") for p in estado["posts"] if p.get("data") and p.get("ticker")]
    return estado


def gravar_estado(estado: dict) -> None:
    try:
        PASTA.mkdir(parents=True, exist_ok=True)
        estado = dict(estado, posts=estado.get("posts", [])[-MAX_POSTS:],
                      publicados=estado.get("publicados", [])[-MAX_PUBLICADOS:])
        if isinstance(estado.get("terminou"), dict):
            estado["terminou"] = dict(estado["terminou"], datas=sorted(estado["terminou"].get("datas", []))[-120:])
        (PASTA / "telegram.json").write_text(json.dumps(estado, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        print("Telegram: não gravou telegram.json:", e)


def semana_iso(d: date) -> str:
    ano, sem, _ = d.isocalendar()
    return f"{ano}-W{sem:02d}"


def br(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}"


def pct(v: float) -> str:
    return f"{v:+.1f}".replace(".", ",") + "%"


def montar_legenda(hoje: dict, principal: dict) -> str:
    texto = ""
    arq = principal.get("legenda")
    if arq and obter("conteudo/" + arq).is_file():
        texto = (PASTA / arq).read_text(encoding="utf-8").strip()
    if not texto:
        texto = (f"{principal.get('rotulo')} · {principal.get('setup_nome')}\n"
                 f"{principal.get('casos')} casos, {principal.get('acerto')}% com lucro.")
    # a legenda das redes já traz link e aviso; no Telegram as hashtags sobram
    linhas = [l for l in texto.splitlines() if not l.strip().startswith("#")]
    texto = "\n".join(linhas).strip()
    rodape = ""
    if SITE not in texto:
        rodape = f"\n\nVeja o histórico completo: {SITE}"
    aviso = hoje.get("aviso") or ""
    if "não é recomendação" not in texto and aviso:
        rodape = f"\n\n{aviso}" + rodape
    espaco = LIMITE_LEGENDA - len(rodape)
    if len(texto) > espaco:
        texto = texto[: espaco - 1].rstrip() + "…"
    return texto + rodape


def chamar_api(token: str, metodo: str, dados: bytes, tipo: str) -> dict:
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{metodo}", data=dados,
                                 headers={"Content-Type": tipo})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # a resposta do Telegram explica o erro (ex.: bot não é admin do canal)
        corpo = e.read().decode("utf-8", "replace")
        return {"ok": False, "description": f"HTTP {e.code}: {corpo[:300]}"}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {"ok": False, "description": f"erro de rede: {e}"}


def _multipart(campos: list[tuple[str, str]], arquivos: list[tuple[str, Path]]) -> tuple[bytes, str]:
    limite = "----" + uuid.uuid4().hex
    partes = [f'--{limite}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode("utf-8")
              for n, v in campos]
    for nome, img in arquivos:
        partes.append((f'--{limite}\r\nContent-Disposition: form-data; name="{nome}"; filename="{img.name}"\r\n'
                       "Content-Type: image/png\r\n\r\n").encode("utf-8") + img.read_bytes() + b"\r\n")
    partes.append(f"--{limite}--\r\n".encode("utf-8"))
    return b"".join(partes), f"multipart/form-data; boundary={limite}"


def enviar_foto_html(token: str, chat: str, imagem: Path, legenda: str) -> dict:
    corpo, tipo = _multipart([("chat_id", chat), ("caption", legenda), ("parse_mode", "HTML")], [("photo", imagem)])
    return chamar_api(token, "sendPhoto", corpo, tipo)


def enviar_album(token: str, chat: str, imagens: list[Path], legenda: str) -> dict:
    """Várias imagens num post só; a legenda (HTML) vai na primeira."""
    media = [{"type": "photo", "media": f"attach://f{i}"} for i in range(len(imagens))]
    media[0].update(caption=legenda, parse_mode="HTML")
    corpo, tipo = _multipart([("chat_id", chat), ("media", json.dumps(media, ensure_ascii=False))],
                             [(f"f{i}", img) for i, img in enumerate(imagens)])
    return chamar_api(token, "sendMediaGroup", corpo, tipo)


def enviar_foto(token: str, chat: str, imagem: Path, legenda: str) -> dict:
    limite = "----" + uuid.uuid4().hex
    partes = []
    for nome, valor in (("chat_id", chat), ("caption", legenda)):
        partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="{nome}"\r\n\r\n{valor}\r\n'.encode("utf-8"))
    partes.append((f'--{limite}\r\nContent-Disposition: form-data; name="photo"; filename="{imagem.name}"\r\n'
                   "Content-Type: image/png\r\n\r\n").encode("utf-8") + imagem.read_bytes() + b"\r\n")
    partes.append(f"--{limite}--\r\n".encode("utf-8"))
    return chamar_api(token, "sendPhoto", b"".join(partes), f"multipart/form-data; boundary={limite}")


def enviar_texto(token: str, chat: str, texto: str) -> dict:
    corpo = json.dumps({"chat_id": chat, "text": texto, "parse_mode": "HTML",
                        "disable_web_page_preview": True}).encode("utf-8")
    return chamar_api(token, "sendMessage", corpo, "application/json")


def ler_segredos() -> tuple[str, str]:
    """Token e canal: dos segredos separados ou de um segredo único TELEGRAM com linhas CHAVE=valor."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    for linha in os.environ.get("TELEGRAM", "").splitlines():
        chave, _, valor = linha.partition("=")
        chave, valor = chave.strip().upper(), valor.strip().strip('"').strip("'")
        if chave == "TELEGRAM_BOT_TOKEN" and not token:
            token = valor
        elif chave == "TELEGRAM_CHAT_ID" and not chat:
            chat = valor
    return token, chat


# ---------------------------------------------------------------- Como terminaram os sinais

def resultado_do_post(post: dict, resultados: dict | None) -> float | None:
    """Retorno % (já invertido em venda) do caso encerrado do post: casos/ do ativo, senão resultados.json."""
    tk, setup, data = post.get("ticker"), post.get("setup"), post.get("data")
    if not (tk and setup and data):
        return None
    casos = ler_dado(f"casos/{tk}.json")
    if casos:
        for k in ((casos.get("casos") or {}).get("D") or {}).get(setup) or []:
            if k and k[0] == data and len(k) > 4 and k[4] is not None:
                return float(k[4])
    if resultados:
        try:
            ai = next(i for i, a in enumerate(resultados["ativos"]) if a[0] == tk)
            si = next(i for i, x in enumerate(resultados["setups"]) if x[0] == setup)
            dia = (date.fromisoformat(data) - date.fromisoformat(resultados["base"])).days
            for l in resultados["linhas"]:
                if l[0] == dia and l[1] == ai and l[2] == si and len(l) == 4 and l[3] is not None:
                    return float(l[3])
        except (StopIteration, KeyError, ValueError, TypeError, IndexError):
            pass
    return None


def linha_sinal(rotulo, setup_nome, lado, data: str, ret: float) -> str:
    marca = "🟢" if ret > 0 else "🔴"
    return (f"{marca} <b>{html.escape(str(rotulo))}</b> · {html.escape(str(setup_nome))} "
            f"({'venda' if lado == 'venda' else 'compra'}), sinal de {br(data)[:5]}: <b>{pct(ret)}</b>")


def placar(rets: list[float]) -> str:
    lucro = sum(r > 0 for r in rets)
    return f"<b>Placar:</b> {lucro} de {len(rets)} no lucro; resultado médio de {pct(sum(rets) / len(rets))} por sinal."


def fechar_texto(blocos: list[str], rodape: str, fixos: int) -> str:
    """Junta blocos e rodapé; se passar do limite do Telegram, tira linhas do meio da lista (após `fixos`)."""
    def junta():
        return "\n".join(blocos) + "\n\n" + rodape
    while len(junta()) > LIMITE_TEXTO and len(blocos) > fixos + 4:
        del blocos[(fixos + len(blocos)) // 2]
    return junta()[:LIMITE_TEXTO]


def montar_como_terminaram(estado: dict, resultados: dict | None) -> tuple[str | None, list[dict]]:
    """Texto e posts relatados. Posts do canal com prazo encerrado; sem eles, os sinais do terminal."""
    pendentes = []
    for p in estado.get("posts", []):
        if p.get("relatado"):
            continue
        ret = resultado_do_post(p, resultados)
        if ret is not None:
            pendentes.append((p, ret))
    rodape = (f"{AVISO_RESULTADO}\n\n🔗 <a href=\"{SITE}resultados.html\">Todos os sinais e como terminaram</a>")
    if pendentes:
        pendentes.sort(key=lambda x: x[0].get("data", ""))
        blocos = ["<b>📊 Como terminaram os sinais que postamos</b>",
                  "Posts do canal cujo prazo de 10 pregões já acabou, com os que deram prejuízo:", ""]
        blocos += [linha_sinal(p.get("rotulo") or p.get("ticker"), p.get("setup_nome") or p.get("setup"),
                               p.get("lado"), p["data"], r) for p, r in pendentes]
        blocos += ["", placar([r for _, r in pendentes])]
        return fechar_texto(blocos, rodape, 3), [p for p, _ in pendentes]

    # fallback: sinais do terminal encerrados na semana
    if not resultados or not resultados.get("linhas") or not resultados.get("referencia"):
        return None, []
    ref = max(resultados["referencia"].values())
    refd = date.fromisoformat(ref)
    desde = (refd - timedelta(days=7)).isoformat()
    base = date.fromisoformat(resultados["base"])
    nomes = {x[0]: x[1] for x in resultados["setups"]}
    encerrados = []
    for l in resultados["linhas"]:
        if len(l) != 4 or l[3] is None:
            continue
        d = base + timedelta(days=l[0])
        if (refd - d).days > 35:  # sinal antigo demais para ter saído esta semana
            continue
        tk, rot, _ = resultados["ativos"][l[1]]
        sid, snome, lado = resultados["setups"][l[2]]
        casos = ler_dado(f"casos/{tk}.json")
        for k in (((casos or {}).get("casos") or {}).get("D") or {}).get(sid) or []:
            if k and k[0] == d.isoformat() and desde < k[2] <= ref:
                encerrados.append((rot, snome, lado, d.isoformat(), float(l[3])))
                break
    if not encerrados:
        return None, []
    encerrados.sort(key=lambda x: -x[4])
    mostrar = encerrados if len(encerrados) <= 12 else encerrados[:6] + encerrados[-6:]
    recorte = f"Os 6 melhores e os 6 piores, de {len(encerrados)} no total." if len(encerrados) > 12 else "Todos eles."
    blocos = ["<b>📊 Como terminaram os sinais do terminal</b>",
              "O histórico do canal ainda está começando. Estes são <b>os sinais do terminal</b> "
              "(não os que postamos) que fecharam o prazo de 10 pregões nesta semana. " + recorte, ""]
    blocos += [linha_sinal(*e[:3], e[3], e[4]) for e in mostrar]
    blocos += ["", placar([e[4] for e in encerrados])]
    mes = (resultados.get("ranking") or {}).get("BR") or {}
    if mes.get("itens"):
        blocos += ["", f"<b>Ranking do mês na B3</b> (saídas de {br(mes['desde'])[:5]} a {br(mes['ate'])[:5]}):"]
        for i in mes["itens"][:3]:
            blocos.append(f"{html.escape(nomes.get(i['setup'], i['setup']))}: {i['n']} sinais, "
                          f"{str(i['acerto']).replace('.', ',')}% no lucro, média {pct(i['medio'])}")
    return fechar_texto(blocos, rodape, 3), []


# ---------------------------------------------------------------- Resumo da semana

def md_para_html(md: str) -> str:
    """Markdown da newsletter para o HTML do Telegram (negrito, links, listas; tabelas viram linhas)."""
    saida: list[str] = []
    cab: list[str] | None = None
    for bruta in md.splitlines():
        linha = bruta.rstrip()
        if linha.startswith("|"):
            cel = [c.strip() for c in linha.strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", c) for c in cel):
                continue
            if cab is None:
                cab = cel
                continue
            saida.append("• " + " · ".join(f"{h}: {c}" for h, c in zip(cab, cel)))
            continue
        cab = None
        if linha.startswith("# "):
            linha = "**" + linha[2:] + "**"
        elif linha.startswith("## "):
            linha = "**" + linha[3:] + "**"
        elif linha.startswith("- "):
            linha = "• " + linha[2:]
        saida.append(linha)
    texto = html.escape("\n".join(saida), quote=False)
    texto = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", texto)
    texto = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', texto)
    return re.sub(r"\n{3,}", "\n\n", texto).strip()


def montar_newsletter(hoje: dict) -> str | None:
    arq = ((hoje or {}).get("newsletter") or {}).get("md")
    if not arq or not obter("conteudo/" + arq).is_file():
        return None
    texto = md_para_html((PASTA / arq).read_text(encoding="utf-8"))
    texto = re.sub(r"\n*Terminal gratuito:.*$", "", texto, flags=re.S).strip()  # o rodapé já leva ao site
    rodape = f'🔗 <a href="{SITE}conteudo.html">Leia a newsletter completa no site</a>'
    if len(texto) + len(rodape) + 2 > LIMITE_TEXTO:
        paragrafos = texto.split("\n\n")  # corta por parágrafos para não quebrar tags
        while len(paragrafos) > 2 and len("\n\n".join(paragrafos)) + len(rodape) + 80 > LIMITE_TEXTO:
            del paragrafos[-2]
        texto = "\n\n".join(paragrafos) + "\n\n(resumo cortado; a versão completa está no site)"
    return texto + "\n\n" + rodape


# ---------------------------------------------------------------- Principal

def status(ok: bool, msg: str, extra: dict | None = None) -> None:
    """Grava o resultado da última tentativa no site (sem segredos), para diagnóstico."""
    print("Telegram:", msg)
    try:
        PASTA.mkdir(parents=True, exist_ok=True)
        dados = {"ok": ok, "mensagem": msg, "em": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        dados.update(extra or {})
        (PASTA / "telegram-status.json").write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def publicar_diario(token: str, chat: str, simular: bool, hoje: dict | None, estado: dict) -> tuple[bool, str]:
    if not hoje or hoje.get("vazio") or not hoje.get("principal"):
        return True, "sem post hoje"
    principal = hoje["principal"]
    data = principal.get("data") or hoje.get("data")
    if data and data == estado.get("ultimo"):
        return True, f"{data} já tinha sido publicado"
    imagem = obter("conteudo/" + (principal.get("post") or "_"))
    if not imagem.is_file():
        return False, f"imagem {imagem.name} não encontrada"
    legenda = montar_legenda(hoje, principal)
    if simular:
        print(f"[simulação] enviaria {imagem.name} ({len(legenda)} caracteres de legenda):\n{legenda}\n")
        return True, "simulado"
    resp = enviar_foto(token, chat, imagem, legenda)
    if not resp.get("ok"):
        return False, f"falhou: {resp.get('description')}"
    estado["ultimo"] = data
    registro = {"data": data, "ticker": principal.get("ticker"), "rotulo": principal.get("rotulo"),
                "setup": principal.get("setup"), "setup_nome": principal.get("setup_nome"),
                "lado": principal.get("lado")}
    if not any(p.get("data") == data and p.get("ticker") == registro["ticker"] and p.get("setup") == registro["setup"]
               for p in estado["posts"]):
        estado["posts"].append(registro)
    gravar_estado(estado)
    return True, f"publicado {principal.get('rotulo')} de {data}"


def montar_ranking(rk: dict) -> str | None:
    """Mensagem do Top do dia (HTML do Telegram): 3 de compra e 3 de venda, ou None se não houver nada."""
    def bloco(titulo: str, lado: str) -> list[str]:
        itens = ((rk.get(lado) or {}).get("geral") or [])[:3]
        if not itens:
            return []
        linhas = [f"<b>{titulo}</b>"]
        for i, x in enumerate(itens, 1):
            linhas.append(f"{i}. <b>{html.escape(str(x.get('rotulo')))}</b> · {html.escape(str(x.get('setup_nome')))} · "
                          f"{x.get('ganhos')} de {x.get('casos')} no lucro · média {pct(x.get('medio') or 0)}")
        return linhas + [""]
    corpo = bloco("▲ Compra", "compra") + bloco("▼ Venda (lucro = queda do preço)", "venda")
    if not corpo:
        return None
    data = rk.get("data")
    cab = "🏆 <b>Top do dia — sinais com melhor histórico</b>" + (f"\n{br(data)}" if data else "")
    rodape = ("Ranking estatístico do histórico de cada ativo (mínimo de 10 casos, nota pelo limite inferior do "
              "intervalo de confiança), não é recomendação. Resultado passado não garante resultado futuro; "
              f"sem custos e impostos.\n<a href=\"{SITE}ranking.html\">Ver o ranking completo</a>")
    return (cab + "\n\n" + "\n".join(corpo) + "\n" + rodape)[:LIMITE_TEXTO]


def publicar_ranking(token: str, chat: str, simular: bool, estado: dict) -> tuple[bool, str]:
    rk = ler_dado("ranking.json")
    if not isinstance(rk, dict) or not rk.get("data"):
        return True, "sem ranking hoje"
    if rk["data"] == estado.get("ranking"):
        return True, f"ranking de {rk['data']} já publicado"
    texto = montar_ranking(rk)
    if not texto:
        return True, "sem ranking hoje"
    if simular:
        print(f"[simulação] top do dia ({len(texto)} caracteres):\n{texto}\n")
        return True, "simulado"
    r = enviar_texto(token, chat, texto)
    if not r.get("ok"):
        return False, f"falhou: {r.get('description')}"
    estado["ranking"] = rk["data"]
    gravar_estado(estado)
    return True, f"publicado ({rk['data']})"


def publicar_semanal(token: str, chat: str, simular: bool, forcar: bool, hoje: dict | None,
                     estado: dict, agora: datetime) -> dict:
    """Newsletter (sexta) e 'Como terminaram' (a partir do sábado), uma vez por semana ISO em UTC."""
    hj = agora.date()
    semana = semana_iso(hj)
    sem = estado["semanal"]
    res: dict = {}

    # newsletter: só existe em hoje.json nas sextas; aceita até 2 dias depois (execução atrasada)
    nl = (hoje or {}).get("newsletter") or {}
    try:
        nl_data = date.fromisoformat(nl.get("data", ""))
    except ValueError:
        nl_data = None
    if not nl_data:
        res["newsletter"] = "sem newsletter na semana"
    elif sem.get("newsletter") == semana_iso(nl_data) and not forcar:
        res["newsletter"] = f"semana {semana_iso(nl_data)} já publicada"
    elif not forcar and not (0 <= (hj - nl_data).days <= 2):
        res["newsletter"] = "newsletter antiga; fora da janela de publicação"
    else:
        texto = montar_newsletter(hoje)
        if not texto:
            res["newsletter"] = "arquivo da newsletter não encontrado"
        elif simular:
            print(f"[simulação] resumo da semana ({len(texto)} caracteres):\n{texto}\n")
            res["newsletter"] = "simulado"
        else:
            r = enviar_texto(token, chat, texto)
            if r.get("ok"):
                sem["newsletter"] = semana_iso(nl_data)
                gravar_estado(estado)
                res["newsletter"] = f"publicado ({sem['newsletter']})"
            else:
                res["newsletter"] = f"falhou: {r.get('description')}"

    # como terminaram: sábado (weekday 5) ou domingo, se o sábado não rodou
    if sem.get("resultados") == semana and not forcar:
        res["resultados"] = f"semana {semana} já publicada"
    elif hj.weekday() < 5 and not forcar:
        res["resultados"] = "aguardando o sábado"
    else:
        texto, relatados = montar_como_terminaram(estado, ler_dado("resultados.json"))
        origem = "posts do canal" if relatados else "sinais do terminal"
        if not texto:
            res["resultados"] = "sem dados de resultados"
        elif simular:
            print(f"[simulação] como terminaram ({origem}; {len(texto)} caracteres):\n{texto}\n")
            res["resultados"] = "simulado"
        else:
            r = enviar_texto(token, chat, texto)
            if r.get("ok"):
                sem["resultados"] = semana
                for p in relatados:
                    p["relatado"] = semana
                gravar_estado(estado)
                res["resultados"] = f"publicado ({semana}; {origem})"
            else:
                res["resultados"] = f"falhou: {r.get('description')}"
    return res


# ---------------------------------------------------------------- 1. Sinais do dia (álbum)

def _criativos():
    sys.path.insert(0, str(RAIZ / "scripts"))
    import criativos  # PIL só é carregado quando há imagem para desenhar
    return criativos


def pasta_imagens(simular: bool) -> Path:
    return PASTA / ("simulacao" if simular else "telegram")


def legenda_top(rk: dict, com_destaque: str | None) -> str:
    """Legenda do álbum (HTML, até 1024 caracteres): o Top do dia em texto."""
    def linhas(lado: str) -> list[str]:
        out = []
        for i, x in enumerate(((rk.get(lado) or {}).get("geral") or [])[:3], 1):
            setup = str(x.get("setup_nome") or x.get("setup"))
            setup = setup if len(setup) <= 34 else setup[:33] + "…"
            out.append(f"{i}. <b>{html.escape(str(x.get('rotulo')))}</b> · {html.escape(setup)} · "
                       f"{x.get('ganhos')}/{x.get('casos')} · {pct(x.get('medio') or 0)}")
        return out
    corpo = ["🏆 <b>Top do dia</b> · fechamento de " + br(rk["data"])[:5], ""]
    if linhas("compra"):
        corpo += ["▲ <b>Compra</b>", *linhas("compra"), ""]
    if linhas("venda"):
        corpo += ["▼ <b>Venda</b> (lucro = queda)", *linhas("venda"), ""]
    if com_destaque:
        corpo += [f"Na 2ª imagem: <b>{html.escape(com_destaque)}</b> em detalhe, com o gráfico e os últimos casos.", ""]
    corpo += ["Histórico do mesmo setup em cada ativo, 10 pregões depois (mín. 10 casos). "
              "Daqui a 10 pregões mostramos como estes sinais terminaram, inclusive os prejuízos.",
              "", AVISO_RESULTADO, f'🔗 <a href="{SITE}ranking.html">Top do dia completo</a>']
    texto = "\n".join(corpo)
    return texto if len(texto) <= LIMITE_LEGENDA else texto[:LIMITE_LEGENDA - 1] + "…"


def registrar(estado: dict, itens: list[dict], origem: str) -> None:
    chaves = {(p.get("data"), p.get("ticker"), p.get("setup")) for p in estado["publicados"]}
    for x in itens:
        k = (x.get("data"), x.get("ticker"), x.get("setup"))
        if None in k or k in chaves:
            continue
        chaves.add(k)
        estado["publicados"].append({"data": x["data"], "ticker": x["ticker"], "rotulo": x.get("rotulo"),
                                     "setup": x["setup"], "setup_nome": x.get("setup_nome"),
                                     "lado": x.get("lado"), "mercado": x.get("mercado"), "origem": origem})


def publicar_sinais(token: str, chat: str, simular: bool, hoje: dict | None, estado: dict) -> tuple[bool, str]:
    """Top do dia novo -> álbum [imagem do Top, imagem do post do dia] com o Top na legenda.
    Sem Top novo, mas com post do dia novo -> só o post do dia (como antes)."""
    rk = ler_dado("ranking.json")
    tem_rk = isinstance(rk, dict) and rk.get("data") and rk["data"] != estado.get("ranking") and \
        any(((rk.get(l) or {}).get("geral") or []) for l in ("compra", "venda"))
    principal = (hoje or {}).get("principal") if hoje and not hoje.get("vazio") else None
    data_post = (principal or {}).get("data") or (hoje or {}).get("data")
    tem_post = bool(principal) and data_post != estado.get("ultimo")
    if not tem_rk:
        if not tem_post:
            return True, f"top do dia de {rk.get('data') if isinstance(rk, dict) else '?'} já publicado"
        return publicar_diario(token, chat, simular, hoje, estado)

    img_top = pasta_imagens(simular) / f"top-{rk['data']}.png"
    _criativos().top_do_dia(rk, img_top)
    imagens = [img_top]
    img_post = obter("conteudo/" + (principal.get("post") or "_")) if tem_post else None
    if img_post is not None and img_post.is_file():
        imagens.append(img_post)
    destaque = principal.get("rotulo") if len(imagens) > 1 else None
    legenda = legenda_top(rk, destaque)
    if simular:
        print(f"[simulação] álbum {[i.name for i in imagens]} ({len(legenda)} caracteres):\n{legenda}\n")
        return True, "simulado"
    r = enviar_album(token, chat, imagens, legenda) if len(imagens) > 1 else enviar_foto_html(token, chat, img_top, legenda)
    if not r.get("ok"):
        return False, f"falhou: {r.get('description')}"
    estado["ranking"] = rk["data"]
    itens = [dict(x, lado=lado) for lado in ("compra", "venda") for x in ((rk.get(lado) or {}).get("geral") or [])[:3]]
    registrar(estado, itens, "top")
    if len(imagens) > 1:
        estado["ultimo"] = data_post
        reg = {"data": data_post, "ticker": principal.get("ticker"), "rotulo": principal.get("rotulo"),
               "setup": principal.get("setup"), "setup_nome": principal.get("setup_nome"), "lado": principal.get("lado")}
        if not any(p.get("data") == data_post and p.get("ticker") == reg["ticker"] for p in estado["posts"]):
            estado["posts"].append(reg)
        registrar(estado, [dict(reg, mercado=principal.get("mercado"))], "post")
    gravar_estado(estado)
    return True, f"top do dia de {rk['data']} publicado" + (f" com {destaque}" if destaque else "")


# ---------------------------------------------------------------- 2. Educativo

def publicar_educativo(token: str, chat: str, simular: bool, estado: dict, dia: str) -> tuple[bool, str]:
    cat = ler_json(RAIZ / "config" / "educativos.json") or {}
    itens = cat.get("itens") or []
    if not itens:
        return True, "sem itens educativos"
    ed = estado["educativo"]
    k = int(ed.get("proximo") or 0) % len(itens)
    item = itens[k]
    img = pasta_imagens(simular) / f"educativo-{item['id']}.png"
    _criativos().educativo(item, img, k + 1)
    link = SITE + (item.get("pagina") or "")
    legenda = (f"📚 <b>{html.escape(item['titulo'])}</b>\n\n{html.escape(item.get('legenda', ''))}\n\n"
               f'🔗 <a href="{link}">Veja no terminal</a>\n\nConteúdo educativo, não é recomendação.')[:LIMITE_LEGENDA]
    if simular:
        print(f"[simulação] educativo {k + 1}/{len(itens)} {img.name}:\n{legenda}\n")
        return True, "simulado"
    r = enviar_foto_html(token, chat, img, legenda)
    if not r.get("ok"):
        return False, f"falhou: {r.get('description')}"
    estado["educativo"] = {"proximo": k + 1, "dia": dia, "ultimo_id": item["id"]}
    gravar_estado(estado)
    return True, f"educativo {item['id']} publicado"


# ---------------------------------------------------------------- 3. Como terminou

def velas_fechadas(tk: str) -> tuple[list, str | None]:
    """Candles diários fechados do ativo (sem o pregão em formação) e a moeda."""
    d = ler_dado(f"ativos/{tk}.json")
    if not isinstance(d, dict) or not d.get("c"):
        return [], None
    c = d["c"]
    if d.get("parcial") and c and c[-1][0] == d["parcial"]:
        c = c[:-1]
    return c, d.get("moeda")


def apurar(sinal: dict) -> dict | None:
    """Resultado do sinal como no backtest: entra na abertura seguinte, sai no fechamento PRAZO pregões depois.
    None se o prazo ainda não acabou ou faltam dados."""
    c, moeda = velas_fechadas(sinal["ticker"])
    idx = {v[0]: i for i, v in enumerate(c)}
    i = idx.get(sinal["data"])
    if i is None or i + PRAZO >= len(c):
        return None
    ent, sai = c[i + 1][1], c[i + PRAZO][4]
    if not ent or not sai:
        return None
    s = -1 if sinal.get("lado") == "venda" else 1
    ret = s * (sai / ent - 1) * 100
    extremos = [(v[2] if s > 0 else v[3]) for v in c[i + 1:i + PRAZO + 1]]
    melhor = max(s * (x / ent - 1) * 100 for x in extremos)
    ini = max(0, i - 4)
    return dict(sinal, ret=ret, melhor=melhor, moeda=moeda, velas=c[ini:i + PRAZO + 1],
                i_ent=i + 1 - ini, i_sai=i + PRAZO - ini, saida=c[i + PRAZO][0])


def top_refeito(data: str) -> list[dict]:
    """Sinais de `data` que a regra do Top do dia escolheria (3 de compra e 3 de venda), para os dias
    antes de existir o registro. Usa os sinais encerrados de resultados.json e o histórico de backtest.json."""
    res, bt = ler_dado("resultados.json"), ler_dado("backtest.json")
    if not res or not bt:
        return []
    sys.path.insert(0, str(RAIZ / "scripts"))
    from ranking import MIN_CASOS, wilson_inferior
    try:
        dia = (date.fromisoformat(data) - date.fromisoformat(res["base"])).days
    except (KeyError, ValueError):
        return []
    melhores: dict = {}
    for l in res.get("linhas", []):
        if l[0] != dia or len(l) < 4:  # encerrados e em aberto; quem decide se terminou é apurar()
            continue
        tk, rot, merc = res["ativos"][l[1]]
        sid, snome, lado = res["setups"][l[2]]
        e = (((bt.get("ativos") or {}).get(tk) or {}).get("D") or {}).get(sid) or {}
        n, acerto, medio = e.get("n") or 0, e.get("acerto"), e.get("medio")
        if n < MIN_CASOS or acerto is None or medio is None or medio <= 0:
            continue
        nota = wilson_inferior(round(acerto / 100 * n), n)
        k = (tk, lado)
        if k not in melhores or (nota, medio) > melhores[k][0]:
            melhores[k] = ((nota, medio), {"data": data, "ticker": tk, "rotulo": rot, "mercado": merc, "setup": sid,
                                           "setup_nome": snome, "lado": lado, "origem": "refeito"})
    out = []
    for lado in ("compra", "venda"):
        lista = sorted((v for (tk, ld), v in melhores.items() if ld == lado), key=lambda v: v[0], reverse=True)
        out += [x for _, x in lista[:3]]
    return out


def escolher_terminou(estado: dict, hoje_d: date) -> tuple[list[dict], str | None, str]:
    """Grupo de sinais de um dia já encerrado e ainda não relatado: (apurados, data, origem)."""
    feitas = set(estado["terminou"].get("datas") or [])
    limite = (hoje_d - timedelta(days=30)).isoformat()
    por_data: dict = {}
    for p in estado["publicados"]:
        if p.get("data") and p["data"] >= limite and p["data"] not in feitas:
            por_data.setdefault(p["data"], []).append(p)
    # 1) o registro, quando o dia teve sinais suficientes publicados
    for d in sorted(por_data):
        if len(por_data[d]) >= MIN_GRUPO:
            ap = [a for a in map(apurar, por_data[d]) if a]
            if ap and len(ap) == len(por_data[d]):
                return ap, d, "top"
    # 2) dias com poucos publicados: refaz o Top daquele dia pela mesma regra e junta com o que foi postado
    res = ler_dado("resultados.json")
    if not res or not res.get("linhas"):
        return [], None, ""
    base = date.fromisoformat(res["base"])
    datas = sorted({(base + timedelta(days=l[0])).isoformat() for l in res["linhas"]}, reverse=True)
    for d in datas:
        if d < limite or d in feitas or date.fromisoformat(d).weekday() >= 5:
            continue  # fim de semana só tem cripto: o placar fica pequeno demais
        grupo = top_refeito(d)
        chaves = {(x["ticker"], x["setup"]) for x in grupo}
        grupo += [p for p in por_data.get(d, []) if (p["ticker"], p["setup"]) not in chaves]
        ap = [a for a in map(apurar, grupo) if a]
        if len(ap) >= MIN_GRUPO and len(ap) == len(grupo):  # só quando todos os sinais do dia terminaram
            return ap, d, "refeito"
    return [], None, ""


def legenda_terminou(caso: dict, ap: list[dict], data: str, origem: str) -> str:
    lucro = sum(a["ret"] > 0 for a in ap)
    medio = sum(a["ret"] for a in ap) / len(ap)
    compra = caso.get("lado") != "venda"
    moeda = {"USD": "US$ ", "BRL": "R$ "}.get(caso.get("moeda"), "")
    v = caso["velas"]
    if caso["ret"] > 0:
        cab = f"✅ <b>Deu certo: {html.escape(str(caso['rotulo']))} {pct(caso['ret'])}</b>"
    else:
        cab = "📉 <b>Nem sempre dá certo</b>"
    quem = "do Top do dia" if origem == "top" else "com melhor histórico"
    linhas = [cab, "",
              f"Sinal de {'compra' if compra else 'venda'} de {br(data)[:5]} em <b>{html.escape(str(caso['rotulo']))}</b> "
              f"({html.escape(str(caso.get('setup_nome') or caso.get('setup')))}).",
              f"Quem entrasse na abertura de {br(v[caso['i_ent']][0])[:5]} a {moeda}{fmt_br(v[caso['i_ent']][1])} e saísse no "
              f"fechamento de {br(v[caso['i_sai']][0])[:5]}, {PRAZO} pregões depois, a {moeda}{fmt_br(v[caso['i_sai']][4])}, "
              f"teria <b>{pct(caso['ret'])}</b>" + ("" if compra else " (venda: lucro com a queda)") +
              f". No melhor momento, {pct(caso['melhor'])}.", "",
              f"<b>Placar dos sinais {quem} de {br(data)[:5]}:</b> {lucro} de {len(ap)} terminaram no lucro; "
              f"média de {pct(medio)} por sinal."]
    ruins = [a for a in ap if a["ret"] <= 0]
    if ruins:
        linhas.append("Não deram certo: " + ", ".join(f"{html.escape(str(a['rotulo']))} {pct(a['ret'])}" for a in ruins[:4]) + ".")
    linhas += ["", AVISO_RESULTADO, f'🔗 <a href="{SITE}resultados.html">Todos os sinais e como terminaram</a>']
    texto = "\n".join(linhas)
    return texto if len(texto) <= LIMITE_LEGENDA else texto[:LIMITE_LEGENDA - 1] + "…"


def fmt_br(v: float) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def publicar_terminou(token: str, chat: str, simular: bool, estado: dict, dia: str) -> tuple[bool, str]:
    ap, data, origem = escolher_terminou(estado, date.fromisoformat(dia))
    if not ap:
        return True, "nenhum sinal publicado terminou o prazo ainda"
    caso = max(ap, key=lambda a: a["ret"])
    placar = {"n": len(ap), "lucro": sum(a["ret"] > 0 for a in ap), "medio": sum(a["ret"] for a in ap) / len(ap), "data": data}
    img = pasta_imagens(simular) / f"terminou-{data}.png"
    _criativos().como_terminou(dict(caso, origem=origem), placar, img)
    legenda = legenda_terminou(caso, ap, data, origem)
    if simular:
        print(f"[simulação] como terminou ({origem}, {len(ap)} sinais de {data}) {img.name}:\n{legenda}\n")
        return True, "simulado"
    r = enviar_foto_html(token, chat, img, legenda)
    if not r.get("ok"):
        return False, f"falhou: {r.get('description')}"
    t = estado["terminou"]
    t["datas"] = sorted(set(t.get("datas") or []) | {data})
    t["dia"] = dia
    gravar_estado(estado)
    return True, f"como terminou de {data} publicado ({caso['rotulo']} {pct(caso['ret'])}, {placar['lucro']} de {placar['n']})"


def main() -> int:
    simular = "--simular" in sys.argv
    forcar = "--forcar-semanal" in sys.argv
    agora = datetime.now(timezone.utc)
    if "--agora" in sys.argv:
        agora = datetime.fromisoformat(sys.argv[sys.argv.index("--agora") + 1]).replace(tzinfo=FUSO).astimezone(timezone.utc)
    local = agora.astimezone(FUSO)
    dia = local.date().isoformat()
    token, chat = ler_segredos()

    estado = estado_publicado()
    gravar_estado(estado)

    if not simular and not (token and chat):
        status(False, "segredos não configurados" + ("" if token else " (falta TELEGRAM_BOT_TOKEN)") + ("" if chat else " (falta TELEGRAM_CHAT_ID)"))
        return 0

    hoje = ler_dado("conteudo/hoje.json")
    res: dict = {}
    try:
        ok, msg = publicar_sinais(token, chat, simular, hoje, estado)
    except Exception as e:  # nada daqui pode derrubar o workflow
        ok, msg = False, f"erro inesperado nos sinais do dia: {e}"
    print("Telegram sinais:", msg)

    # um post extra por execução (educativo ou como terminou), para espaçar
    extra = None
    if local.hour >= HORA_EDUCATIVO and estado["educativo"].get("dia") != dia:
        extra = "educativo"
    elif local.hour >= HORA_TERMINOU and estado["terminou"].get("dia") != dia:
        extra = "terminou"
    for nome, funcao in (("educativo", publicar_educativo), ("terminou", publicar_terminou)):
        if extra != nome:
            res[nome] = "aguardando a hora" if estado[nome].get("dia") != dia else "já publicado hoje"
            continue
        try:
            okx, msgx = funcao(token, chat, simular, estado, dia)
        except Exception as e:
            okx, msgx = False, f"erro inesperado: {e}"
        if okx and not simular and estado[nome].get("dia") != dia:
            estado[nome]["dia"] = dia  # nada para publicar hoje: não tenta de novo até amanhã
            gravar_estado(estado)
        res[nome] = msgx
        ok = ok and okx
        print(f"Telegram {nome}:", msgx)
    try:
        semanal = publicar_semanal(token, chat, simular, forcar, hoje, estado, agora)
    except Exception as e:
        semanal = {"erro": f"erro inesperado nas publicações semanais: {e}"}
    print("Telegram semanal:", semanal)
    if not simular:
        status(ok, msg, {**res, "semanal": semanal})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
