/* Conteúdo para redes sociais: mostra o que scripts/conteudo.py gerou (data/conteudo/hoje.json). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const PASTA = "data/conteudo/";
  const fmtNum = (v, c = 0) => (v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
  const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, 2)}%`);
  const fmtData = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
  const NOMES = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };

  const texto = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.text(); });

  async function copiar(txt, aviso) {
    try { await navigator.clipboard.writeText(txt); }
    catch {
      const t = el("textarea", { style: "position:fixed;opacity:0" });
      t.value = txt; document.body.append(t); t.select();
      try { document.execCommand("copy"); } finally { t.remove(); }
    }
    aviso.textContent = "Copiado.";
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  function cartao(alvo, titulo, sub, arquivo) {
    alvo.replaceChildren(
      el("div", {}, el("h2", {}, titulo), el("p", { class: "sub" }, sub)),
      el("img", { src: PASTA + arquivo, alt: `${titulo}: ${sub}`, loading: "lazy" }),
      el("div", { class: "cont-acoes" },
        el("a", { class: "botao primario", href: PASTA + arquivo, download: arquivo }, "Baixar PNG"),
        el("a", { class: "botao", href: PASTA + arquivo, target: "_blank", rel: "noopener" }, "Abrir")));
  }

  async function mostrar(item) {
    $("#cont-imagens").hidden = false;
    cartao($("#cont-post"), "Post · feed", "1080 × 1350 (Instagram, LinkedIn)", item.post);
    cartao($("#cont-story"), "Story · vertical", "1080 × 1920 (Stories, Reels, capa do TikTok)", item.story);
    $("#cont-resumo").replaceChildren(
      el("span", {}, el("b", {}, item.rotulo), ` · ${item.nome}`),
      el("span", {}, `${NOMES[item.mercado] ?? item.mercado} · sinal de ${item.lado} em ${fmtData(item.data)}`),
      el("span", {}, el("b", {}, item.setup_nome)),
      el("span", {}, `${fmtNum(item.casos)} casos · `,
        el("b", { class: item.acerto >= 50 ? "cont-alta" : "cont-baixa" }, `${fmtNum(item.acerto, 0)}% com lucro`),
        " · média ", el("b", { class: item.medio >= 0 ? "cont-alta" : "cont-baixa" }, fmtPct(item.medio)),
        " (saída em 10 pregões)"));
    $("#cont-leg").hidden = false;
    try { $("#cont-texto").value = await texto(PASTA + item.legenda); }
    catch { $("#cont-texto").value = "Não consegui carregar a legenda."; }
  }

  async function newsletter(n) {
    if (!n?.html) return;
    let html = "";
    try { html = await texto(PASTA + n.html); } catch { return; }
    $("#cont-news").hidden = false;
    $("#cont-news-sub").textContent = `Semana até ${fmtData(n.data)}. Use Copiar HTML no editor de e-mail (modo código) ou o Markdown.`;
    $("#cont-news-quadro").srcdoc = html;
    const aviso = el("span", { class: "cont-ok", role: "status" });
    $("#cont-news-acoes").replaceChildren(
      el("button", { class: "botao primario", type: "button", onclick: () => copiar(html, aviso) }, "Copiar HTML"),
      el("a", { class: "botao", href: PASTA + n.html, target: "_blank", rel: "noopener" }, "Abrir"),
      n.md ? el("button", { class: "botao", type: "button", onclick: async () => copiar(await texto(PASTA + n.md), aviso) }, "Copiar Markdown") : null,
      aviso);
  }

  async function iniciar() {
    let R = null, hoje = null;
    try { R = await carregarRadar(); } catch { /* o topo funciona sem os dados */ }
    montarTopo("conteudo", R);
    try { hoje = await buscarJSON(PASTA + "hoje.json"); }
    catch { $("#cont-sub").textContent = "Ainda não há conteúdo gerado. Ele aparece depois da próxima atualização diária dos dados."; return; }
    if (hoje.vazio || !hoje.principal) {
      $("#cont-sub").textContent = "Hoje nenhum ativo teve um sinal com histórico suficiente (pelo menos 8 casos) e preço em dia. Volte depois da próxima atualização.";
      return newsletter(hoje.newsletter);
    }
    const itens = [hoje.principal, ...(hoje.alternativas ?? [])];
    $("#cont-sub").textContent = `Pregão de ${fmtData(hoje.data)} · gerado em ${new Date(hoje.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
    const troca = $("#cont-troca");
    const escolher = (i) => {
      troca.querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
      mostrar(itens[i]);
    };
    if (itens.length > 1) {
      troca.replaceChildren(...itens.map((it, i) =>
        el("button", { type: "button", class: "botao", "aria-pressed": "false", onclick: () => escolher(i) },
          `${it.rotulo} · ${NOMES[it.mercado] ?? it.mercado}${i === 0 ? " (principal)" : ""}`)));
    }
    escolher(0);
    $("#cont-copiar").addEventListener("click", () => copiar($("#cont-texto").value, $("#cont-ok")));
    newsletter(hoje.newsletter);
  }
  iniciar();
})();
