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

Além do post diário, uma vez por semana ISO (datas em UTC):
  - resumo da semana (newsletter): na sexta, quando conteudo.py gera a newsletter;
  - "Como terminaram os sinais": a partir do sábado.

Uso:
  python scripts/telegram_postar.py                   # publica o que estiver pendente
  python scripts/telegram_postar.py --simular         # mostra os textos, sem enviar
  python scripts/telegram_postar.py --forcar-semanal  # ignora o dia da semana e a semana já publicada
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

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "data" / "conteudo"
SITE = "https://lubra-lucas.github.io/site-investimentos/"
LIMITE_LEGENDA = 1024  # limite do Telegram para legenda de foto
LIMITE_TEXTO = 4096    # limite do Telegram para mensagem de texto
MAX_POSTS = 200        # tamanho do histórico de posts guardado
AVISO_RESULTADO = ("Resultado passado não garante resultado futuro. Sem custos e impostos. "
                   "Estudo estatístico, não é recomendação.")


def ler_json(caminho: Path):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def estado_publicado() -> dict:
    """Estado salvo: arquivo local, senão o publicado no site (data/ começa vazio a cada build).

    Aceita o formato antigo {"ultimo": "AAAA-MM-DD"}. Formato atual:
    {"ultimo": data, "posts": [{data, ticker, rotulo, setup, setup_nome, lado, relatado?}],
     "semanal": {"newsletter": "AAAA-Www", "resultados": "AAAA-Www"}}
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
    posts = bruto.get("posts")
    semanal = bruto.get("semanal")
    return {"ultimo": bruto.get("ultimo"),
            "posts": [p for p in posts if isinstance(p, dict)] if isinstance(posts, list) else [],
            "semanal": semanal if isinstance(semanal, dict) else {}}


def gravar_estado(estado: dict) -> None:
    try:
        PASTA.mkdir(parents=True, exist_ok=True)
        estado = dict(estado, posts=estado.get("posts", [])[-MAX_POSTS:])
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
    if arq and (PASTA / arq).exists():
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
    casos = ler_json(RAIZ / "data" / "casos" / f"{tk}.json")
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
        casos = ler_json(RAIZ / "data" / "casos" / f"{tk}.json")
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
    if not arq or not (PASTA / arq).is_file():
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
    imagem = PASTA / (principal.get("post") or "")
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
        texto, relatados = montar_como_terminaram(estado, ler_json(RAIZ / "data" / "resultados.json"))
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


def main() -> int:
    simular = "--simular" in sys.argv
    forcar = "--forcar-semanal" in sys.argv
    token, chat = ler_segredos()

    estado = estado_publicado()
    gravar_estado(estado)  # mantém o registro no site mesmo quando não posta

    if not simular and not (token and chat):
        status(False, "segredos não configurados" + ("" if token else " (falta TELEGRAM_BOT_TOKEN)") + ("" if chat else " (falta TELEGRAM_CHAT_ID)"))
        return 0

    hoje = ler_json(PASTA / "hoje.json")
    try:
        ok, msg = publicar_diario(token, chat, simular, hoje, estado)
    except Exception as e:  # nada daqui pode derrubar o build
        ok, msg = False, f"erro inesperado no post diário: {e}"
    try:
        semanal = publicar_semanal(token, chat, simular, forcar, hoje, estado, datetime.now(timezone.utc))
    except Exception as e:
        semanal = {"erro": f"erro inesperado nas publicações semanais: {e}"}
    print("Telegram semanal:", semanal)
    if not simular:
        status(ok, msg, {"semanal": semanal})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
