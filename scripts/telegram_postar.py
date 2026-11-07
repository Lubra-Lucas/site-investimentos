"""Publica o post do dia no canal do Telegram.

Lê data/conteudo/hoje.json (gerado por scripts/conteudo.py) e envia a imagem do
post principal com a legenda para o canal. Usa só a biblioteca padrão.

Segredos (GitHub → Settings → Secrets and variables → Actions):
  TELEGRAM_BOT_TOKEN  token do BotFather
  TELEGRAM_CHAT_ID    @ do canal (ex.: @carteiraterminal) ou ID numérico

Sem os segredos, sai sem fazer nada. Não posta a mesma data duas vezes: guarda a
última data publicada em data/conteudo/telegram.json, que vai para o site e é
lida de volta na próxima execução (data/ começa vazio a cada build).

Uso:
  python scripts/telegram_postar.py            # publica se houver post novo
  python scripts/telegram_postar.py --simular  # mostra o que enviaria, sem enviar
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "data" / "conteudo"
SITE = "https://lubra-lucas.github.io/site-investimentos/"
LIMITE_LEGENDA = 1024  # limite do Telegram para legenda de foto


def ler_json(caminho: Path) -> dict | None:
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def ultimo_publicado() -> str | None:
    """Última data postada: arquivo local, senão o publicado no site."""
    local = ler_json(PASTA / "telegram.json")
    if local and local.get("ultimo"):
        return local["ultimo"]
    try:
        with urllib.request.urlopen(SITE + "data/conteudo/telegram.json", timeout=15) as r:
            return json.loads(r.read().decode("utf-8")).get("ultimo")
    except (urllib.error.URLError, OSError, ValueError):
        return None


def gravar_ultimo(data: str | None) -> None:
    if not data:
        return
    PASTA.mkdir(parents=True, exist_ok=True)
    (PASTA / "telegram.json").write_text(json.dumps({"ultimo": data}), encoding="utf-8")


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


def enviar_foto(token: str, chat: str, imagem: Path, legenda: str) -> dict:
    limite = "----" + uuid.uuid4().hex
    partes = []
    for nome, valor in (("chat_id", chat), ("caption", legenda)):
        partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="{nome}"\r\n\r\n{valor}\r\n'.encode("utf-8"))
    partes.append((f'--{limite}\r\nContent-Disposition: form-data; name="photo"; filename="{imagem.name}"\r\n'
                   "Content-Type: image/png\r\n\r\n").encode("utf-8") + imagem.read_bytes() + b"\r\n")
    partes.append(f"--{limite}--\r\n".encode("utf-8"))
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendPhoto",
        data=b"".join(partes),
        headers={"Content-Type": f"multipart/form-data; boundary={limite}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # a resposta do Telegram explica o erro (ex.: bot não é admin do canal)
        corpo = e.read().decode("utf-8", "replace")
        return {"ok": False, "description": f"HTTP {e.code}: {corpo[:300]}"}


def status(ok: bool, msg: str) -> None:
    """Grava o resultado da última tentativa no site (sem segredos), para diagnóstico."""
    print("Telegram:", msg)
    try:
        PASTA.mkdir(parents=True, exist_ok=True)
        (PASTA / "telegram-status.json").write_text(
            json.dumps({"ok": ok, "mensagem": msg}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def main() -> int:
    simular = "--simular" in sys.argv
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    ultimo = ultimo_publicado()
    gravar_ultimo(ultimo)  # mantém o registro no site mesmo quando não posta

    if not simular and not (token and chat):
        status(False, "segredos não configurados" + ("" if token else " (falta TELEGRAM_BOT_TOKEN)") + ("" if chat else " (falta TELEGRAM_CHAT_ID)"))
        return 0

    hoje = ler_json(PASTA / "hoje.json")
    if not hoje or hoje.get("vazio") or not hoje.get("principal"):
        status(True, "sem post hoje")
        return 0
    principal = hoje["principal"]
    data = principal.get("data") or hoje.get("data")
    if data and data == ultimo:
        status(True, f"{data} já tinha sido publicado")
        return 0
    imagem = PASTA / (principal.get("post") or "")
    if not imagem.is_file():
        status(False, f"imagem {imagem.name} não encontrada")
        return 0

    legenda = montar_legenda(hoje, principal)
    if simular:
        print(f"[simulação] enviaria {imagem.name} ({len(legenda)} caracteres de legenda):\n{legenda}")
        return 0

    resp = enviar_foto(token, chat, imagem, legenda)
    if not resp.get("ok"):
        status(False, f"falhou: {resp.get('description')}")
        return 1
    gravar_ultimo(data)
    status(True, f"publicado {principal.get('rotulo')} de {data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
