/* Comparar: até 4 ativos lado a lado (gráficos com o mesmo tempo, a mesma janela de datas e a mira
 * sincronizada) ou sobrepostos numa linha só, em % desde uma data. A bandeja fica salva no navegador
 * (sobrevive à troca de página); arrastar.js põe os ativos nela. Toda mudança avisa com o evento
 * "bandejas" (o mesmo do Plano de amanhã e das Notas), que os contadores escutam. */

window.Comparar = (() => {
  const CHAVE = "comparar-v1", PREFS = "comparar-prefs", MAX = 4;
  const CORES = ["#4c8dff", "#f5b942", "#22b07d", "#e879f9"];
  const REFERENCIAS = [["", "Sem referência"], ["^BVSP", "Ibovespa"], ["^GSPC", "S&P 500"]];
  const PERIODOS = [["1", "1M"], ["3", "3M"], ["6", "6M"], ["12", "1A"], ["0", "Tudo"]];
  const avisar = () => document.dispatchEvent(new CustomEvent("bandejas", { detail: { origem: "comparar" } }));
  const ler = () => {
    const v = guardar.ler(CHAVE, []);
    return Array.isArray(v) ? [...new Set(v.filter((t) => typeof t === "string" && t))].slice(0, MAX) : [];
  };
  const gravar = (l) => { guardar.gravar(CHAVE, l); avisar(); };
  const prefs = () => ({ modo: "lado", tf: "D", periodo: "6", ref: "", ...guardar.ler(PREFS, {}) });
  const mudarPrefs = (m) => guardar.gravar(PREFS, { ...prefs(), ...m });
  // outra aba mexeu na bandeja: os contadores desta acompanham
  addEventListener("storage", (e) => { if (e.key === CHAVE) avisar(); });

  let tela = null;  // { fundo, corpo, graficos, sobre, voltarFoco }

  const api = {
    MAX,
    itens: ler,
    tem: (tk) => ler().includes(tk),
    /** Põe na bandeja. Devolve "ok", "repetido" ou "cheio" (para o aviso de quem chamou). */
    adicionar(tk) {
      const l = ler();
      if (l.includes(tk)) return "repetido";
      if (l.length >= MAX) return "cheio";
      gravar([...l, tk]);
      return "ok";
    },
    remover(tk) { gravar(ler().filter((t) => t !== tk)); },
    limpar() { gravar([]); },
    abrir,
    fechar,
    /** Para os testes e para quem quiser mexer na tela aberta: os gráficos lado a lado. */
    get graficos() { return tela?.graficos ?? []; },
    get sobreposto() { return tela?.sobre ?? null; },
  };

  // ------------------------------------------------------------- dados

  const radar = () => carregarRadar().catch(() => ({ ativos: [], sinais: [] }));
  const catalogo = () => buscarJSON("data/setups.json").catch(() => ({ grupos: [] }));
  const arquivoDe = (R, tk) => R.ativos.find((a) => a.ticker === tk)?.arquivo ?? tk.replace(/=/g, "_");

  /** Os setups recentes do ativo: um chip por setup (o mais recente primeiro), até 4. */
  function chipsSetups(R, nomes, tk) {
    const vistos = new Set();
    const evs = R.sinais.filter((s) => s.ticker === tk)
      .sort((x, y) => y.data.localeCompare(x.data) || x.tf.localeCompare(y.tf))
      .filter((s) => !vistos.has(s.setup + s.tf) && vistos.add(s.setup + s.tf));
    if (!evs.length) return el("p", { class: "sub" }, "Sem setups no período publicado.");
    return el("div", { class: "chips" }, evs.slice(0, 4).map((s) =>
      el("span", { class: `chip setup vies-${s.lado}`, title: `${nomes.get(s.setup)?.nome ?? s.setup} · ${s.tf === "W" ? "semanal" : "diário"} · ${fmtData(s.data)}` },
        s.lado === "compra" ? "▲ " : s.lado === "venda" ? "▼ " : "◆ ", nomes.get(s.setup)?.nome.replace(/ de (compra|venda)\b/, "") ?? s.setup,
        " ", el("span", { class: "data" }, `${s.tf === "W" ? "S " : ""}${fmtData(s.data)}`))),
    evs.length > 4 ? el("span", { class: "chip" }, `+${evs.length - 4}`) : null);
  }

  /** ✓ a favor / ⚠ cuidado (rastreador.js), no lado do setup mais recente. Sem o rastreador na página, nada. */
  async function resumoContexto(R, nomes, a) {
    if (typeof contextoDecisao !== "function" || typeof carregarRastreador !== "function") return null;
    const F = await carregarRastreador().catch(() => null);
    const fotos = F?.ativos?.[a.ticker];
    if (!fotos) return null;
    const sinais = R.sinais.filter((s) => s.ticker === a.ticker).sort((x, y) => y.data.localeCompare(x.data));
    const vies = sinais.find((s) => s.tf === "D")?.lado ?? sinais[0]?.lado ?? "neutro";
    const { favor, cuidado } = contextoDecisao(a, fotos, "D", vies, sinais, (id) => nomes.get(id)?.nome ?? id);
    if (!favor.length && !cuidado.length) return null;
    const lista = (itens, cls, simbolo) => (itens.length ? el("ul", { class: `contexto-lista ${cls}` },
      itens.slice(0, 3).map((t) => el("li", { title: t }, el("span", { class: "simbolo" }, simbolo), t)),
      itens.length > 3 ? el("li", { class: "mais", title: itens.slice(3).join("\n") }, `+${itens.length - 3}`) : null) : null);
    return el("div", { class: "contexto-decisao comparar-contexto" }, lista(favor, "favor", "✓"), lista(cuidado, "cuidado", "⚠"));
  }

  // ------------------------------------------------------------- tela

  async function abrir() {
    if (!tela) montar();
    await desenhar();
  }

  function montar() {
    const p = prefs();
    const seg = (itens, atual, chave, rotulo) => el("div", { class: "segmento", role: "group", "aria-label": rotulo, "data-chave": chave },
      itens.map(([v, t]) => el("button", { type: "button", "data-v": v, class: v === atual ? "ativo" : null,
        onclick: () => { mudarPrefs({ [chave]: v }); desenhar(); } }, t)));
    const campo = el("input", { type: "search", list: "comparar-tickers", placeholder: "Ticker", spellcheck: "false", autocomplete: "off",
      "aria-label": "Ticker para adicionar à comparação" });
    const form = el("form", { class: "comparar-adicionar", onsubmit: async (e) => {
      e.preventDefault();
      const R = await radar();
      const tk = acharAtivo(R.ativos, campo.value);
      if (!tk) { campo.setCustomValidity("Ativo não encontrado"); campo.reportValidity(); campo.setCustomValidity(""); return; }
      const r = api.adicionar(tk);
      if (r === "cheio") { campo.setCustomValidity(`Já são ${MAX} ativos: tire um para pôr outro`); campo.reportValidity(); campo.setCustomValidity(""); return; }
      campo.value = "";
      desenhar();
    } }, campo, el("datalist", { id: "comparar-tickers" }), el("button", { class: "botao", type: "submit" }, "+ Adicionar"));
    const fechar1 = el("button", { class: "comparar-fechar", type: "button", "aria-label": "Fechar a comparação (Esc)", title: "Fechar (Esc)", onclick: fechar }, "×");
    const titulo = el("h2", { id: "comparar-titulo" }, "⇆ Comparar");
    const corpo = el("div", { class: "comparar-corpo" });
    const topo = el("header", { class: "comparar-topo" },
      el("div", { class: "comparar-titulo" }, titulo, el("span", { class: "sub", id: "comparar-n" })),
      el("div", { class: "comparar-controles" },
        seg([["lado", "Lado a lado"], ["sobrepor", "Sobrepor em %"]], p.modo, "modo", "Modo"),
        seg([["D", "D"], ["W", "S"], ["M", "M"]], p.tf, "tf", "Tempo gráfico de todos"),
        seg(PERIODOS, p.periodo, "periodo", "Desde quando"),
        el("label", { class: "comparar-ref" }, "Referência ",
          el("select", { onchange: (e) => { mudarPrefs({ ref: e.target.value }); desenhar(); } },
            REFERENCIAS.map(([v, t]) => el("option", { value: v, selected: v === p.ref ? true : null }, t)))),
        form,
        el("button", { class: "botao", type: "button", title: "Fecha esta tela para você arrastar outro card até Comparar",
          onclick: fechar }, "Arrastar outro card"),
        el("button", { class: "botao perigo", type: "button", onclick: () => { api.limpar(); fechar(); } }, "Limpar"),
        fechar1));
    const caixa = el("div", { class: "comparar-tela", role: "dialog", "aria-modal": "true", "aria-labelledby": "comparar-titulo" }, topo, corpo);
    const fundo = el("div", { class: "comparar-fundo", onclick: (e) => { if (e.target === fundo) fechar(); } }, caixa);
    const tecla = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); fechar(); return; }
      if (e.key !== "Tab") return;
      // o foco fica dentro da tela enquanto ela está aberta
      const focaveis = [...caixa.querySelectorAll("button, a[href], input, select, [tabindex]:not([tabindex='-1'])")]
        .filter((n) => !n.disabled && n.offsetParent !== null);
      if (!focaveis.length) return;
      const [primeiro, ultimo] = [focaveis[0], focaveis.at(-1)];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    // a bandeja mudou (× de um painel, outra aba): redesenha
    const aoMudar = () => { if (tela && !tela.desenhando) desenhar(); };
    tela = { fundo, caixa, corpo, topo, graficos: [], sobre: null, voltarFoco: document.activeElement, tecla: null, aoMudar };
    document.addEventListener("bandejas", aoMudar);
    document.documentElement.classList.add("comparar-aberto");
    document.body.append(fundo);
    requestAnimationFrame(() => fundo.classList.add("visivel"));
    fechar1.focus();
    // com o prenderFoco do plano.js (pilha de janelas), Esc e Tab ficam com ele; senão, com a tecla daqui
    if (typeof window.prenderFoco === "function") {
      try { tela.soltarFoco = window.prenderFoco(caixa, fechar); } catch { document.addEventListener("keydown", tecla, true); tela.tecla = tecla; }
    } else { document.addEventListener("keydown", tecla, true); tela.tecla = tecla; }
    radar().then((R) => document.getElementById("comparar-tickers")?.replaceChildren(...R.ativos.map((a) =>
      el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome))));
  }

  function desmontarGraficos() {
    if (!tela) return;
    tela.graficos.splice(0).forEach((g) => g.remover());
    tela.sobre?.chart.remove();
    tela.sobre = null;
  }

  function fechar() {
    if (!tela) return;
    const t = tela;
    desmontarGraficos();
    tela = null;
    if (t.tecla) document.removeEventListener("keydown", t.tecla, true);
    if (typeof t.soltarFoco === "function") { try { t.soltarFoco(); } catch {} }
    document.removeEventListener("bandejas", t.aoMudar);
    document.documentElement.classList.remove("comparar-aberto");
    t.fundo.remove();
    if (t.voltarFoco?.isConnected) t.voltarFoco.focus?.();
  }

  async function desenhar() {
    if (!tela) return;
    const t = tela;
    t.desenhando = true;
    const p = prefs();
    const tks = ler();
    // controles: marca o escolhido e mostra só os do modo
    t.topo.querySelectorAll(".segmento[data-chave]").forEach((s) => {
      s.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === p[s.dataset.chave]));
      if (s.dataset.chave === "tf") s.hidden = p.modo !== "lado";
      if (s.dataset.chave === "periodo") s.hidden = p.modo !== "sobrepor";
    });
    t.topo.querySelector(".comparar-ref").hidden = p.modo !== "sobrepor";
    document.getElementById("comparar-n").textContent = tks.length
      ? `${tks.length} de ${MAX} ativos${tks.length < MAX ? " · arraste outro card até Comparar ou digite o ticker" : ""}` : "";
    desmontarGraficos();
    const [R, C] = await Promise.all([radar(), catalogo()]);
    if (tela !== t) return;
    const nomes = new Map((C.grupos ?? []).flatMap((g) => (g.itens ?? []).map((x) => [x.id, x])));
    t.corpo.dataset.n = tks.length;
    t.corpo.dataset.modo = p.modo;
    if (!tks.length) {
      t.corpo.replaceChildren(el("div", { class: "comparar-vazio" },
        el("p", {}, el("b", {}, "Nada para comparar ainda.")),
        el("p", { class: "sub" }, "Segure um card (ou arraste pelo cabeçalho) e solte em ", el("b", {}, "Comparar"),
          ", no alto da tela. Também dá para digitar o ticker acima ou usar o menu ⋯ de cada ativo.")));
      t.desenhando = false;
      return;
    }
    if (p.modo === "sobrepor") await desenharSobreposto(t, R, tks, p);
    else await desenharLadoALado(t, R, nomes, tks, p);
    t.desenhando = false;
  }

  // ------------------------------------------------------------- lado a lado

  async function desenharLadoALado(t, R, nomes, tks, p) {
    const porTk = new Map(R.ativos.map((a) => [a.ticker, a]));
    const paineis = tks.map((tk, i) => {
      const a = porTk.get(tk);
      const corpoG = el("div", { class: "comparar-grafico" });
      const ctx = el("div", { class: "comparar-ctx" });
      const sec = el("section", { class: "comparar-painel", "data-tk": tk, style: `--cor-ativo:${CORES[i]}` },
        el("header", {},
          el("div", { class: "comparar-id" }, el("i", { class: "cor-ativo" }), el("b", { class: "mono" }, semSufixo(tk)),
            a ? el("span", { class: "cartao-nome" }, a.nome) : el("span", { class: "sub" }, "não encontrado nos dados")),
          el("div", { class: "comparar-acoes" },
            a ? precoComFormacao(a, "celula-preco") : null,
            el("a", { class: "abrir-radar", href: `ativo.html#${encodeURIComponent(tk)}`, title: "Abrir a página do ativo" }, "↗"),
            el("button", { class: "comparar-remover", type: "button", title: `Tirar ${semSufixo(tk)} da comparação`,
              "aria-label": `Tirar ${semSufixo(tk)} da comparação`, onclick: () => api.remover(tk) }, "×"))),
        a ? chipsSetups(R, nomes, tk) : null,
        corpoG, ctx);
      return { tk, a, sec, corpoG, ctx };
    });
    t.corpo.replaceChildren(...paineis.map((x) => x.sec));
    const graficos = [];
    for (const x of paineis) {
      if (!x.a) continue;
      const g = new Grafico(x.corpoG, { mini: true });
      g.ticker = x.tk;
      g.sinais = R.sinais.filter((s) => s.ticker === x.tk).map((s) => ({ ...s, tf: s.tf === "W" ? "S" : "D",
        familia: nomes.get(s.setup)?.nome ?? s.setup, texto: nomes.get(s.setup)?.desc ?? "" }));
      graficos.push(g);
      resumoContexto(R, nomes, x.a).then((n) => { if (n && tela === t) x.ctx.replaceChildren(n); });
    }
    t.graficos = graficos;
    await Promise.all(graficos.map((g) => g.mostrar(porTk.get(g.ticker).arquivo, p.tf).catch(() => false)));
    if (tela !== t || t.graficos !== graficos) return;
    sincronizar(graficos);
  }

  /** Mesma janela de datas (por data, não por número de candles: mercados têm pregões diferentes) e a
   *  mira no mesmo dia em todos. Quem manda é o gráfico em que o mouse/dedo está. */
  function sincronizar(graficos) {
    if (!graficos.length) return;
    let lider = graficos[0];
    const ocupado = { faixa: false, mira: false };
    const tempoAte = (g, tempo) => {
      // o candle do outro ativo naquele dia ou o último antes dele (feriados diferentes)
      const c = g.c ?? [];
      let lo = 0, hi = c.length - 1, r = null;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].time <= tempo) { r = c[m]; lo = m + 1; } else hi = m - 1; }
      return r;
    };
    const copiarFaixa = (origem) => {
      const faixa = origem.chart.timeScale().getVisibleRange();
      if (!faixa || ocupado.faixa) return;
      ocupado.faixa = true;
      for (const g of graficos) if (g !== origem && g.c?.length) { try { g.chart.timeScale().setVisibleRange(faixa); } catch {} }
      ocupado.faixa = false;
    };
    for (const g of graficos) {
      // o balão dos sinais só aparece no gráfico em que o mouse está (nos outros a mira só acompanha)
      const balao = g.mostrarBalao.bind(g);
      g.mostrarBalao = (param) => { if (g === lider) balao(param); else g.balao.hidden = true; };
      const quem = () => { lider = g; graficos.forEach((o) => { if (o !== g) o.balao.hidden = true; }); };
      for (const ev of ["pointerenter", "pointerdown", "wheel", "touchstart"]) g.alvo.addEventListener(ev, quem, { passive: true });
      g.chart.timeScale().subscribeVisibleTimeRangeChange(() => { if (g === lider) copiarFaixa(g); });
      g.chart.subscribeCrosshairMove((param) => {
        if (g !== lider || ocupado.mira) return;
        ocupado.mira = true;
        for (const o of graficos) {
          if (o === g) continue;
          const c = param.time != null ? tempoAte(o, param.time) : null;
          if (c) o.chart.setCrosshairPosition(c.close, c.time, o.candles);
          else o.chart.clearCrosshairPosition();
        }
        ocupado.mira = false;
      });
    }
    // começa todo mundo na janela do primeiro
    copiarFaixa(graficos[0]);
    api.sincronizarCom = (g) => { lider = g; copiarFaixa(g); };
  }

  // ------------------------------------------------------------- sobreposto em %

  async function desenharSobreposto(t, R, tks, p) {
    const porTk = new Map(R.ativos.map((a) => [a.ticker, a]));
    const series = tks.filter((tk) => porTk.has(tk)).map((tk, i) => ({ tk, cor: CORES[tks.indexOf(tk)], ref: false }));
    if (p.ref && !tks.includes(p.ref)) series.push({ tk: p.ref, cor: css("--bb") || "#8fa3bf", ref: true });
    const caixaG = el("div", { class: "comparar-sobreposto" });
    const legenda = el("div", { class: "comparar-legenda", "aria-live": "polite" });
    t.corpo.replaceChildren(el("section", { class: "comparar-painel comparar-painel-unico" }, legenda, caixaG));
    const dados = await Promise.all(series.map((s) => carregarCandles(arquivoDe(R, s.tk)).then((d) => d.candles).catch(() => null)));
    if (tela !== t) return;
    const validas = series.map((s, i) => ({ ...s, candles: dados[i] })).filter((s) => s.candles?.length);
    if (!validas.length) { caixaG.replaceChildren(el("p", { class: "vazio" }, "Não consegui carregar os candles.")); return; }
    // início: N meses antes do último candle (de todos), ou o primeiro dia em que todos têm dados
    const fim = validas.reduce((m, s) => (s.candles.at(-1).time > m ? s.candles.at(-1).time : m), "");
    let inicio;
    if (+p.periodo > 0) {
      const d = new Date(fim + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() - +p.periodo);
      inicio = d.toISOString().slice(0, 10);
    } else inicio = validas.reduce((m, s) => (s.candles[0].time > m ? s.candles[0].time : m), "");
    const chart = LWC.createChart(caixaG, {
      autoSize: true,
      layout: { background: { type: "solid", color: Preferencias.ler().fundo }, textColor: Preferencias.derivadas().texto,
        fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: Preferencias.derivadas().grade }, horzLines: { color: Preferencias.derivadas().grade } },
      rightPriceScale: { borderColor: Preferencias.derivadas().borda },
      timeScale: { borderColor: Preferencias.derivadas().borda, rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      localization: { locale: "pt-BR", priceFormatter: (v) => fmtPct(v) },
    });
    const linhas = validas.map((s) => {
      const desde = s.candles.filter((c) => c.time >= inicio);
      const base = desde[0]?.close;
      const pontos = base ? desde.map((c) => ({ time: c.time, value: (c.close / base - 1) * 100 })) : [];
      const serie = chart.addSeries(LWC.LineSeries, { color: s.cor, lineWidth: s.ref ? 1.5 : 2, priceLineVisible: false,
        lineStyle: s.ref ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid, title: semSufixo(s.tk) });
      serie.setData(pontos);
      return { ...s, serie, final: pontos.at(-1)?.value ?? null, inicio: desde[0]?.time };
    });
    linhas[0]?.serie.createPriceLine({ price: 0, color: Preferencias.derivadas().nivel, lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false });
    chart.timeScale().fitContent();
    t.sobre = { chart, linhas, inicio };
    const nome = (tk) => REFERENCIAS.find(([v]) => v === tk)?.[1] ?? porTk.get(tk)?.nome ?? "";
    legenda.replaceChildren(
      el("span", { class: "sub" }, `Desde ${fmtData(inicio)}${inicio.slice(0, 4) !== fim.slice(0, 4) ? `/${inicio.slice(2, 4)}` : ""} = 0%`),
      ...[...linhas].sort((x, y) => (y.final ?? -1e9) - (x.final ?? -1e9)).map((l) =>
        el("span", { class: `comparar-leg ${l.ref ? "ref" : ""}`, "data-tk": l.tk, title: nome(l.tk) },
          el("i", { style: `background:${l.cor}` }), el("b", { class: "mono" }, semSufixo(l.tk)),
          l.ref ? el("span", { class: "sub" }, nome(l.tk)) : null,
          el("span", { class: `mono ${cor(l.final)}` }, fmtPct(l.final)))));
  }

  return api;
})();
