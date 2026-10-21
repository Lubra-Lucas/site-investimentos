/* Anotações: o que eu vi num ativo, presas à data e ao preço do candle, com uma etiqueta rápida
 * (👍 gostei · 👀 observar · ⚠ cuidado · ✗ descartei). Cada anotação mostra o que o preço fez desde
 * então. Ficam no navegador. API: window.Notas (abrir, do, etiqueta, selo) e o evento "bandejas".
 * Também cuida da exportação conjunta (plano + notas) e do lugar dos selos nos cards. */

(() => {
  const CHAVE = "notas-v1";
  const ETIQUETAS = [["👍", "gostei"], ["👀", "observar"], ["⚠", "cuidado"], ["✗", "descartei"]];
  const NOME_ETIQUETA = Object.fromEntries(ETIQUETAS);
  const ler = () => { const l = guardar.ler(CHAVE, []); return Array.isArray(l) ? l : []; };
  const gravar = (l) => { guardar.gravar(CHAVE, l); document.dispatchEvent(new CustomEvent("bandejas", { detail: { origem: "notas" } })); };
  const recentes = (l) => l.sort((x, y) => (y.criadaEm ?? "").localeCompare(x.criadaEm ?? ""));
  const doTk = (tk) => recentes(ler().filter((n) => n.ticker === tk));

  let R = null, porTk = new Map();
  async function carregar() {
    if (!R) { R = await carregarRadar(); porTk = new Map(R.ativos.map((a) => [a.ticker, a])); }
    return R;
  }

  /**
   * Quanto o preço andou do preço da anotação até o último fechamento. "A favor"/"contra" só quando
   * a etiqueta tem opinião: 👍 espera o preço andar no lado da anotação; ⚠ e ✗, o contrário.
   */
  function desde(n, a) {
    if (!a || !n.preco) return null;
    const v = (a.ultimo / n.preco - 1) * 100;
    const leitura = { "👍": 1, "⚠": -1, "✗": -1 }[n.etiqueta] ?? 0;
    const sentido = n.lado === "venda" ? -1 : 1;
    const juizo = leitura && Math.abs(v) >= 0.05 ? (v * sentido * leitura > 0 ? "a favor" : "contra") : null;
    return { v, juizo };
  }
  const elDesde = (n, a, prefixo = "desde a anotação: ") => {
    const d = desde(n, a);
    if (!d) return null;
    return el("span", { class: "nota-desde", title: `De ${fmtMoeda(n.preco, a.moeda)} (${fmtData(n.data)}) a ${fmtMoeda(a.ultimo, a.moeda)} (${fmtData(a.data)})` },
      prefixo, el("b", { class: cor(d.v) }, fmtPct(d.v)), d.juizo ? el("span", { class: `juizo ${d.juizo === "a favor" ? "alta" : "baixa"}` }, ` ${d.juizo}`) : null);
  };

  // ---------------------------------------------------------- editor (modal)

  let modal = null, soltar = null, grafico = null;

  function fecharEditor() {
    grafico?.remover();
    grafico = null;
    modal?.remove();
    modal = null;
    soltar?.();
    soltar = null;
  }

  /** ctx = { ticker, setup?, tf?, data?, lado?, preco?, id? } — com `id`, edita aquela anotação. */
  async function abrir(ctx = {}) {
    await carregar();
    const a = porTk.get(ctx.ticker);
    if (!a) { window.avisoRapido?.(`Não encontrei ${ctx.ticker ?? "o ativo"} nos dados publicados.`); return; }
    fecharEditor();
    const d = await carregarCandles(a.arquivo);
    const fech = d.parcial && d.candles.at(-1)?.time === d.parcial ? d.candles.slice(0, -1) : d.candles;
    const editando = ctx.id ? ler().find((n) => n.id === ctx.id) : null;
    const data = editando?.data ?? (ctx.data && fech.some((c) => c.time === ctx.data) ? ctx.data : fech.at(-1).time);
    const candle = fech.find((c) => c.time === data);
    const nota = editando ? { ...editando } : {
      ticker: a.ticker, data, preco: candle?.close ?? ctx.preco ?? a.ultimo,
      setup: ctx.setup ?? null, tf: ctx.tf ?? "D", lado: ctx.lado ?? null, etiqueta: null, texto: "",
    };

    const titulo = el("h2", { id: "nota-titulo" }, editando ? "Editar anotação · " : "Anotar · ", el("span", { class: "mono" }, semSufixo(a.ticker)));
    const corpo = el("div", { class: "nota-grafico" });
    const texto = el("textarea", { rows: "3", "aria-label": "Anotação", placeholder: "O que você viu? Ex.: pullback limpo na MME 9, volume fraco, esperar romper a máxima…" }, nota.texto ?? "");
    const etiquetas = el("div", { class: "nota-etiquetas", role: "group", "aria-label": "Etiqueta rápida" },
      ETIQUETAS.map(([e, rot]) => el("button", { type: "button", class: `nota-etiqueta ${nota.etiqueta === e ? "ativo" : ""}`, "aria-pressed": String(nota.etiqueta === e),
        title: rot, onclick: (ev) => {
          nota.etiqueta = nota.etiqueta === e ? null : e;
          etiquetas.querySelectorAll("button").forEach((b) => { const on = b === ev.currentTarget && nota.etiqueta; b.classList.toggle("ativo", !!on); b.setAttribute("aria-pressed", String(!!on)); });
        } }, el("span", { "aria-hidden": "true" }, e), ` ${rot}`)));
    const salvar = () => {
      nota.texto = texto.value.trim();
      if (!nota.texto && !nota.etiqueta) { texto.focus(); texto.setAttribute("aria-invalid", "true"); return; }
      const lista = ler();
      if (editando) gravar(lista.map((n) => (n.id === nota.id ? nota : n)));
      else gravar([...lista, { id: `${Date.now()}-${a.ticker}`, criadaEm: new Date().toISOString(), ...nota }]);
      fecharEditor();
      window.avisoRapido?.(`Anotação de ${semSufixo(a.ticker)} salva.`);
    };
    texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar(); } });

    const anteriores = doTk(a.ticker).filter((n) => n.id !== nota.id);
    const caixa = el("div", { class: "modal modal-nota", role: "dialog", "aria-modal": "true", "aria-labelledby": "nota-titulo" },
      el("div", { class: "modal-cab" },
        el("div", {}, titulo, el("p", { class: "sub" }, `${a.nome} · candle de ${fmtData(data, true)} a ${fmtMoeda(nota.preco, a.moeda)}`,
          nota.setup ? ` · ${nomeSetupNota(nota.setup)}` : "")),
        el("button", { class: "fechar", "aria-label": "Fechar (Esc)", title: "Fechar (Esc)", onclick: fecharEditor }, "×")),
      corpo, etiquetas, texto,
      el("div", { class: "modal-acoes" },
        el("button", { class: "botao primario", onclick: salvar, title: "Ctrl+Enter" }, "Salvar"),
        el("button", { class: "botao", onclick: fecharEditor, title: "Esc" }, "Cancelar"),
        editando ? el("button", { class: "botao perigo", onclick: () => { if (confirm("Apagar esta anotação?")) { gravar(ler().filter((n) => n.id !== nota.id)); fecharEditor(); } } }, "Apagar") : null,
        el("span", { class: "sub" }, "Ctrl+Enter salva · Esc cancela")),
      anteriores.length ? el("div", { class: "nota-anteriores" },
        el("h3", {}, `Anotações anteriores (${anteriores.length})`),
        el("ul", {}, anteriores.map((n) => el("li", { tabindex: "0", title: "Ver a data no gráfico",
          onclick: (e) => { if (!e.target.closest("button")) grafico?.irPara(n.data); },
          onkeydown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) grafico?.irPara(n.data); } },
          el("div", { class: "nota-linha" },
            el("span", { class: "data" }, fmtData(n.data)), el("span", { class: "nota-tag", title: NOME_ETIQUETA[n.etiqueta] ?? "" }, n.etiqueta ?? "✎"),
            el("span", { class: "nota-texto" }, n.texto || NOME_ETIQUETA[n.etiqueta] || ""),
            el("button", { class: "botao-link", onclick: () => abrir({ ticker: a.ticker, id: n.id }) }, "editar"),
            el("button", { class: "botao-link perigo", onclick: () => { if (confirm("Apagar esta anotação?")) { gravar(ler().filter((x) => x.id !== n.id)); abrir(ctx); } } }, "apagar")),
          elDesde(n, a))))) : null);
    modal = el("div", { class: "modal-fundo", onclick: (e) => { if (e.target === e.currentTarget) fecharEditor(); } }, caixa);
    document.body.append(modal);
    soltar = prenderFoco(caixa, fecharEditor);
    texto.focus();

    // gráfico diário com as anotações do ativo marcadas e o candle desta em destaque
    grafico = new Grafico(corpo, { mini: true });
    const g = grafico;
    g.marcar = (c) => {
      const existe = new Set(c.map((x) => x.time));
      const marcas = [...doTk(a.ticker).filter((n) => n.id !== nota.id), nota].filter((n) => existe.has(n.data))
        .sort((x, y) => x.data.localeCompare(y.data))
        .map((n) => ({ time: n.data, position: "aboveBar", shape: "circle", size: 0.6, color: css("--aviso"), text: n.etiqueta ?? "✎" }));
      g.marcadores.setMarkers(marcas);
    };
    if (await g.mostrar(a.arquivo, "D")) g.irPara(data);
  }
  const nomeSetupNota = (id) => (typeof SETUP_POR_ID !== "undefined" && SETUP_POR_ID.get(id)?.nome) || id;

  // ---------------------------------------------------------- selo, botão, blocos

  /** Selo pequeno para os cards: a etiqueta da última anotação (✎ se só tem texto). null sem anotação. */
  function selo(tk) {
    const ns = doTk(tk);
    if (!ns.length) return null;
    const u = ns[0];
    const txt = `${ns.length} anotação(ões). Última (${fmtData(u.data)}): ${u.etiqueta ? NOME_ETIQUETA[u.etiqueta] + ". " : ""}${u.texto ?? ""}`.trim();
    return el("button", { class: "selo-nota", type: "button", title: txt, "aria-label": txt,
      onclick: (e) => { e.stopPropagation(); abrir({ ticker: tk }); } }, u.etiqueta ?? "✎");
  }

  /** Lugar dos selos (plano + anotação) de um ativo; atualiza sozinho a cada "bandejas". */
  function selosBandeja(tk) {
    const s = el("span", { class: "selos-bandeja", "data-bandeja": tk });
    preencher(s);
    return s;
  }
  const preencher = (s) => s.replaceChildren(...[window.Plano?.selo?.(s.dataset.bandeja), selo(s.dataset.bandeja)].filter(Boolean));
  document.addEventListener("bandejas", () => document.querySelectorAll("[data-bandeja]").forEach(preencher));

  const botao = (obterCtx) => el("button", { class: "botao botao-anotar", title: "Anotar o que você viu neste ativo",
    onclick: () => abrir(obterCtx()) }, "✎ Anotar");

  /** Bloco "Anotações" da página do ativo (um <li> da ficha lateral). */
  function bloco(tk) {
    const a = porTk.get(tk);
    const ns = doTk(tk);
    // sem os dados ainda, o "desde" chega no próximo desenho
    if (!R && ns.length) carregar().then(() => document.dispatchEvent(new CustomEvent("bandejas", { detail: { origem: "notas-dados" } })));
    return el("li", { class: "ficha-bloco bloco-notas" },
      el("p", { class: "ficha-titulo" }, "Anotações", el("span", {}, el("button", { class: "botao-link", onclick: () => abrir({ ticker: tk }) }, "✎ anotar"))),
      ns.length ? el("ul", { class: "notas-lista" }, ns.map((n) => el("li", { tabindex: "0", title: "Abrir a anotação",
        onclick: () => abrir({ ticker: tk, id: n.id }), onkeydown: (e) => e.key === "Enter" && abrir({ ticker: tk, id: n.id }) },
        el("div", { class: "nota-linha" }, el("span", { class: "data" }, fmtData(n.data)),
          el("span", { class: "nota-tag" }, n.etiqueta ?? "✎"), el("span", { class: "nota-texto" }, n.texto || NOME_ETIQUETA[n.etiqueta] || "")),
        a ? elDesde(n, a) : null)))
        : el("p", { class: "sub" }, "Nenhuma anotação. Use ", el("b", {}, "✎ Anotar"), " para guardar o que viu (fica presa à data e ao preço)."));
  }

  // ---------------------------------------------------------- Carteira: "Minhas anotações" e exportar/importar

  let filtro = guardar.ler("notas-filtro", "todas");
  async function renderSecao() {
    const alvo = document.getElementById("notas-lista");
    if (!alvo) return;
    await carregar().catch(() => null);
    const todas = recentes(ler());
    const passa = (n) => filtro === "todas" || (filtro === "texto" ? !n.etiqueta : n.etiqueta === filtro);
    const filtros = [["todas", "Todas"], ...ETIQUETAS.map(([e, r]) => [e, `${e} ${r}`]), ["texto", "✎ só texto"]];
    const lista = todas.filter(passa);
    alvo.replaceChildren(
      el("div", { class: "segmento segmento-mini notas-filtros", role: "group", "aria-label": "Filtrar por etiqueta" }, filtros.map(([v, rot]) =>
        el("button", { class: filtro === v ? "ativo" : null, "aria-pressed": String(filtro === v),
          onclick: () => { filtro = v; guardar.gravar("notas-filtro", v); renderSecao(); } },
          rot, " ", el("span", { class: "contagem" }, todas.filter((n) => v === "todas" || (v === "texto" ? !n.etiqueta : n.etiqueta === v)).length)))),
      lista.length ? el("ul", { class: "notas-lista notas-carteira" }, lista.map((n) => {
        const a = porTk.get(n.ticker);
        return el("li", { tabindex: "0", title: "Abrir a anotação", onclick: (e) => { if (!e.target.closest("a")) abrir({ ticker: n.ticker, id: n.id }); },
          onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && abrir({ ticker: n.ticker, id: n.id }) },
          el("div", { class: "nota-linha" },
            el("a", { class: "mono", href: `ativo.html#${encodeURIComponent(n.ticker)}`, title: a?.nome ?? "" }, el("b", {}, semSufixo(n.ticker))),
            el("span", { class: "data" }, fmtData(n.data)), el("span", { class: "nota-tag", title: NOME_ETIQUETA[n.etiqueta] ?? "só texto" }, n.etiqueta ?? "✎"),
            el("span", { class: "nota-texto" }, n.texto || NOME_ETIQUETA[n.etiqueta] || "")),
          a ? elDesde(n, a) : null);
      })) : el("p", { class: "vazio" }, todas.length ? "Nenhuma anotação com esta etiqueta."
        : "Nenhuma anotação ainda. Na página do ativo, use ✎ Anotar (ou arraste um card de Setups para “Anotar”)."));
  }

  function exportar() {
    const dados = { versao: 1, exportado_em: new Date().toISOString(), plano: window.Plano?._exportar?.() ?? null, notas: ler() };
    const blob = new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `plano-e-notas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importar(arquivo) {
    try {
      const d = JSON.parse(await arquivo.text());
      if (!d || typeof d !== "object" || (!Array.isArray(d.notas) && !d.plano)) throw new Error("formato inválido");
      const atuais = new Map(ler().map((n) => [n.id, n]));
      let nn = 0;
      for (const n of d.notas ?? []) if (n?.id && n.ticker && n.data) { atuais.set(n.id, n); nn++; }
      guardar.gravar(CHAVE, [...atuais.values()]);
      const np = window.Plano?._importar?.(d.plano) ?? 0;
      document.dispatchEvent(new CustomEvent("bandejas", { detail: { origem: "importar" } }));
      window.avisoRapido?.(`Importado: ${np} item(ns) do plano e ${nn} anotação(ões).`);
    } catch (e) { alert(`Não consegui importar: ${e.message}`); }
  }

  if (document.getElementById("notas-lista")) {
    renderSecao();
    document.addEventListener("bandejas", renderSecao);
    document.getElementById("bandejas-exportar")?.addEventListener("click", exportar);
    document.getElementById("bandejas-importar")?.addEventListener("change", (e) => {
      if (e.target.files[0]) importar(e.target.files[0]);
      e.target.value = "";
    });
  }

  carregar().catch(() => null);

  window.Notas = {
    abrir, fechar: fecharEditor,
    do: (tk) => doTk(tk),
    etiqueta: (tk) => doTk(tk)[0]?.etiqueta ?? null,
    selo, botao, bloco, desde,
    exportar, importar,
  };
  window.selosBandeja = selosBandeja;
})();
