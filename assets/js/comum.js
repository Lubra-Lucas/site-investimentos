/* Código compartilhado pelas páginas: formatação, dados, indicadores e o gráfico. */

const LWC = window.LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ------------------------------------------------------------- formatação

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const fmtNum = (v, casas = 2) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const casasPreco = (v) => (Math.abs(v) >= 1 ? 2 : 6);
const fmtMoeda = (v, moeda) =>
  v == null ? "—" : moeda === "USD" && Math.abs(v) < 1
    ? `US$ ${fmtNum(v, 6)}` : (moeda === "USD" ? fmtUSD : fmtBRL).format(v);
const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v)}%`);
const cor = (v) => (v == null ? "" : v >= 0 ? "alta" : "baixa");
const fmtCompacto = (v) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const fmtData = (iso, comDia = false) => {
  const [a, m, d] = iso.split("-");
  const dt = new Date(Date.UTC(+a, +m - 1, +d));
  return `${comDia ? DIAS_SEMANA[dt.getUTCDay()] + " " : ""}${d}/${m}`;
};
const semSufixo = (t) => t.replace(/\.SA$/, "");

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) n.append(f instanceof Node ? f : document.createTextNode(f));
  return n;
}

const guardar = {
  ler(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {} },
};

// ------------------------------------------------------------- dados

const cacheJSON = {};
function buscarJSON(url) {
  cacheJSON[url] ??= fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
  return cacheJSON[url];
}
const carregarRadar = () => buscarJSON("data/radar.json");
const carregarResumo = () => buscarJSON("data/resumo.json");
async function carregarIntraday(arquivo) {
  const d = await buscarJSON(`data/intraday/${encodeURIComponent(arquivo)}.json`);
  d.candles ??= d.h.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  return d;
}
async function carregarCandles(arquivo) {
  const d = await buscarJSON(`data/ativos/${encodeURIComponent(arquivo)}.json`);
  d.candles ??= d.c.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  return d;
}

const FAMILIA_CURTA = {
  pullback: "Pullback", ifr: "IFR extremo", mtf60: "Multitempo 60m", mtfd: "Multitempo D",
  bb_fora: "Fora da BB", bb_abertura: "Boca de jacaré",
};

/** Agrupa sinais por ativo e lado dentro do período. Confluência = nº de famílias distintas. */
function agruparSinais(sinais, { tf = "D", desde = null } = {}) {
  const grupos = { compra: new Map(), venda: new Map() };
  for (const s of sinais) {
    if (s.tf !== tf || (desde && s.data < desde)) continue;
    const g = grupos[s.lado];
    if (!g.has(s.ticker)) g.set(s.ticker, { ticker: s.ticker, sinais: [], familias: new Set(), ultima: s.data });
    const item = g.get(s.ticker);
    item.sinais.push(s);
    item.familias.add(s.familia);
    if (s.data > item.ultima) item.ultima = s.data;
  }
  const ordenar = (m) => [...m.values()].sort((a, b) =>
    b.familias.size - a.familias.size || b.ultima.localeCompare(a.ultima) || a.ticker.localeCompare(b.ticker));
  return { compra: ordenar(grupos.compra), venda: ordenar(grupos.venda) };
}

/** Datas de pregão presentes nos sinais (mais recente primeiro). */
const datasSinais = (sinais, tf) => [...new Set(sinais.filter((s) => s.tf === tf).map((s) => s.data))].sort().reverse();

function chipsFamilias(familias) {
  return [...familias].map((f) => el("span", { class: `chip fam-${f}` }, FAMILIA_CURTA[f] ?? f));
}

function seloVerificacao(a) {
  const v = a.verificacao ?? {};
  const txt = v.status === "conferido"
    ? `Conferido com ${v.fonte}${v.ate ? " até " + fmtData(v.ate) : ""}` +
      (v.dif_max_pct != null ? ` · diferença máx. ${fmtNum(v.dif_max_pct, 2)}%` : "")
    : "Só verificação interna (sem fonte de referência)";
  return el("span", { class: `selo selo-${v.status}`, title: txt }, v.status === "conferido" ? "✓ conferido" : "◦ interno");
}

// ------------------------------------------------------------- indicadores

function sma(candles, n) {
  const out = [];
  let soma = 0;
  candles.forEach((c, i) => {
    soma += c.close;
    if (i >= n) soma -= candles[i - n].close;
    if (i >= n - 1) out.push({ time: c.time, value: soma / n });
  });
  return out;
}

function ifr(candles, n = 14) {
  const out = [];
  let ganho = 0, perda = 0;
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = Math.max(d, 0), p = Math.max(-d, 0);
    if (i <= n) { ganho += g / n; perda += p / n; }
    else { ganho = (ganho * (n - 1) + g) / n; perda = (perda * (n - 1) + p) / n; }
    if (i >= n) out.push({ time: candles[i].time, value: perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda) });
  }
  return out;
}

function bollinger(candles, n = 20, k = 2) {
  const sup = [], inf = [];
  for (let i = n - 1; i < candles.length; i++) {
    let soma = 0, soma2 = 0;
    for (let j = i - n + 1; j <= i; j++) { soma += candles[j].close; soma2 += candles[j].close ** 2; }
    const media = soma / n, dp = Math.sqrt(Math.max(soma2 / n - media ** 2, 0));
    sup.push({ time: candles[i].time, value: media + k * dp });
    inf.push({ time: candles[i].time, value: media - k * dp });
  }
  return { sup, inf };
}

/** 60 min -> 4 horas: blocos de 4h contados a partir da abertura de cada pregão. */
function agregar4h(candles) {
  const out = [];
  let dia = null, abertura = 0, bloco = null, atual = null;
  for (const c of candles) {
    const d = Math.floor(c.time / 86400);
    if (d !== dia) { dia = d; abertura = c.time; }
    const b = `${d}:${Math.floor((c.time - abertura) / 14400)}`;
    if (b !== bloco) { bloco = b; atual = { ...c }; out.push(atual); }
    else { atual.high = Math.max(atual.high, c.high); atual.low = Math.min(atual.low, c.low); atual.close = c.close; }
  }
  return out;
}

/** Agrega candles diários em semanais (chave = segunda-feira) ou mensais. */
function agregar(candles, tf) {
  if (tf === "D" || tf === "60") return candles;
  if (tf === "240") return agregar4h(candles);
  const grupos = new Map();
  for (const c of candles) {
    let chave;
    if (tf === "W") {
      const d = new Date(c.time + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      chave = d.toISOString().slice(0, 10);
    } else chave = c.time.slice(0, 8) + "01";
    const g = grupos.get(chave);
    if (!g) grupos.set(chave, { ...c, time: chave });
    else { g.high = Math.max(g.high, c.high); g.low = Math.min(g.low, c.low); g.close = c.close; }
  }
  return [...grupos.values()];
}

// ------------------------------------------------------------- gráfico

const graficos = new Set();
const BARRAS_VISIVEIS = { 60: 160, 240: 120, D: 180, W: 110, M: 72 };
const INTRADAY = new Set(["60", "240"]);
const ROTULO_TF = { 60: "60 min", 240: "4 horas", D: "Diário", W: "Semanal", M: "Mensal" };

class Grafico {
  /** opcoes: { mini: bool } — o mini não tem painel de IFR nem eixo de tempo detalhado. */
  constructor(alvo, opcoes = {}) {
    this.alvo = alvo;
    this.mini = !!opcoes.mini;
    this.pedido = 0;
    this.tf = "D";
    this.camadas = { mm: true, bb: true };
    this.chart = LWC.createChart(alvo, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: css("--texto-fraco"),
        fontFamily: "JetBrains Mono, monospace",
        fontSize: this.mini ? 10 : 11,
        attributionLogo: !this.mini,
        panes: { separatorColor: css("--borda"), separatorHoverColor: css("--bg-elev") },
      },
      grid: { vertLines: { color: "rgba(31,39,51,0.5)" }, horzLines: { color: "rgba(31,39,51,0.5)" } },
      rightPriceScale: { borderColor: css("--borda") },
      timeScale: { borderColor: css("--borda"), rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      handleScroll: !this.mini, handleScale: !this.mini,
      localization: { locale: "pt-BR", priceFormatter: (p) => fmtNum(p, casasPreco(p)) },
    });
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, {
      upColor: css("--alta"), downColor: css("--baixa"), borderVisible: false,
      wickUpColor: css("--alta"), wickDownColor: css("--baixa"),
    });
    const linha = (cor, pane = 0, extra = {}) => this.chart.addSeries(LWC.LineSeries, {
      color: cor, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra,
    }, pane);
    this.mm20 = linha(css("--mm20"));
    this.mm50 = linha(css("--mm50"));
    this.mm200 = linha(css("--mm200"), 0, { lineWidth: 2 });
    const bb = { color: css("--bb"), lineWidth: 1, lineStyle: LWC.LineStyle.Dotted };
    this.bbSup = linha(bb.color, 0, bb);
    this.bbInf = linha(bb.color, 0, bb);
    this.marcadores = LWC.createSeriesMarkers(this.candles, []);
    this.sinais = [];
    if (!this.mini) {
      this.ifr = linha(css("--acento"), 1, { lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 } });
      for (const [p, c] of [[80, "--baixa"], [70, "--borda-forte"], [30, "--borda-forte"], [20, "--alta"]])
        this.ifr.createPriceLine({ price: p, color: css(c), lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      this.chart.panes()[1].setHeight(110);
    }
    graficos.add(this);
  }

  async mostrar(arquivo, tf = this.tf) {
    const pedido = ++this.pedido;  // descarta respostas de cliques anteriores que chegarem depois
    this.tf = tf;
    const intraday = INTRADAY.has(tf);
    const dados = await (intraday ? carregarIntraday(arquivo) : carregarCandles(arquivo));
    if (pedido !== this.pedido) return false;
    this.chart.timeScale().applyOptions({ timeVisible: intraday, secondsVisible: false });
    const c = agregar(dados.candles, tf);
    this.candles.setData(c);
    this.mm20.setData(sma(c, 20));
    this.mm50.setData(sma(c, 50));
    this.mm200.setData(sma(c, 200));
    const { sup, inf } = bollinger(c);
    this.bbSup.setData(sup);
    this.bbInf.setData(inf);
    this.ifr?.setData(ifr(c));
    this.marcar(c);
    this.n = c.length;
    this.aplicarCamadas();
    this.centralizar();
    return true;
  }

  /** Setas nos candles em que as estratégias dispararam (diário e semanal). */
  marcar(candles) {
    const tfSinal = { D: "D", W: "S" }[this.tf];
    const existe = new Set(candles.map((c) => c.time));
    const porDia = new Map();
    for (const s of this.sinais) {
      if (s.tf !== tfSinal || !existe.has(s.data)) continue;
      const chave = `${s.data}:${s.lado}`;
      if (!porDia.has(chave)) porDia.set(chave, s);
    }
    const m = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)).map((s) => ({
      time: s.data,
      position: s.lado === "compra" ? "belowBar" : "aboveBar",
      shape: s.lado === "compra" ? "arrowUp" : "arrowDown",
      color: css(s.lado === "compra" ? "--alta" : "--baixa"),
    }));
    this.marcadores.setMarkers(m);
  }

  aplicarCamadas() {
    for (const s of [this.mm20, this.mm50, this.mm200]) s.applyOptions({ visible: this.camadas.mm });
    for (const s of [this.bbSup, this.bbInf]) s.applyOptions({ visible: this.camadas.bb });
  }

  /** Volta a escala automática de preço e o enquadramento padrão (Alt+R). */
  centralizar() {
    for (const s of [this.candles, this.ifr]) s?.priceScale().applyOptions({ autoScale: true });
    const n = this.n ?? 0;
    const vis = this.mini ? Math.min(BARRAS_VISIVEIS[this.tf], 120) : BARRAS_VISIVEIS[this.tf];
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - vis), to: n + 2 });
  }
}

document.addEventListener("keydown", (e) => {
  if (e.altKey && e.code === "KeyR") {
    e.preventDefault();
    graficos.forEach((g) => g.centralizar());
  }
});

// ------------------------------------------------------------- topo

function montarTopo(pagina, dados) {
  const link = (href, id, txt) => el("a", { href, class: pagina === id ? "ativo" : null }, txt);
  const topo = document.getElementById("topo");
  const v = dados?.verificacao;
  topo.replaceChildren(
    el("div", { class: "marca" }, el("span", { class: "marca-ponto" }), el("h1", {}, "Carteira", el("span", {}, "Terminal"))),
    el("nav", {}, link("index.html", "carteira", "Carteira"), link("radar.html", "radar", "Radar"), link("multitela.html", "multitela", "Multitela")),
    el("div", { class: "topo-info" },
      v ? el("span", { title: "Ativos publicados após a verificação de integridade" },
        "Dados ", el("b", {}, `${v.conferidos} conferidos · ${v.internos} internos · ${v.retidos} retidos`)) : null,
      dados ? el("span", {}, "USD/BRL ", el("b", {}, fmtNum(dados.usdbrl, 4))) : null,
      dados ? el("span", {}, "Atualizado ", el("b", {},
        new Date(dados.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))) : null,
      el("span", { class: "atalho", title: "Centraliza o gráfico no preço" }, el("kbd", {}, "Alt"), "+", el("kbd", {}, "R"))),
  );
}

function erroDados(e) {
  console.error(e);
  document.querySelector("main").replaceChildren(el("div", { class: "painel vazio" },
    "Não encontrei os dados. Rode ", el("code", {}, "python scripts/atualizar_dados.py"),
    " e sirva a pasta com ", el("code", {}, "python -m http.server"), "."));
}

/** Botões de segmento (um ativo por vez). */
function segmento(id, aoMudar) {
  const grupo = document.getElementById(id);
  grupo.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    grupo.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x === b));
    aoMudar(b.dataset);
  });
  return {
    marcar(chave, valor) {
      grupo.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x.dataset[chave] === valor));
    },
  };
}

// ------------------------------------------------------------- painel de gráfico

/** Painel completo: cabeçalho do ativo, tempo gráfico, camadas e o gráfico. */
function painelGrafico(alvo, { aoSelecionar } = {}) {
  const titulo = el("h2", {}, "Gráfico");
  const sub = el("p", { class: "sub" });
  const contexto = el("div", { class: "contexto" });
  const corpo = el("div", { class: "grafico" });
  const nota = el("p", { class: "nota-tf", hidden: true },
    "60 min e 4h: o último candle é o do pregão contínuo; o fechamento oficial do dia sai no leilão e pode diferir um pouco.");
  const tfs = el("div", { class: "segmento", role: "group", "aria-label": "Tempo gráfico" },
    ["60:60m", "240:4h", "D:Diário", "W:Semanal", "M:Mensal"].map((x) => {
      const [tf, rot] = x.split(":");
      return el("button", { "data-tf": tf, class: tf === "D" ? "ativo" : null, title: ROTULO_TF[tf] }, rot);
    }));
  const camadas = el("div", { class: "camadas" },
    el("label", { class: "leg mm" }, el("input", { type: "checkbox", checked: true, "data-c": "mm" }), "MM 20/50/200"),
    el("label", { class: "leg bb" }, el("input", { type: "checkbox", checked: true, "data-c": "bb" }), "Bollinger 20,2"),
    el("span", { class: "leg ifr" }, "IFR 14"));
  alvo.replaceChildren(
    el("div", { class: "painel-cab" }, el("div", {}, titulo, sub), el("div", { class: "controles" }, tfs)),
    el("div", { class: "barra-grafico" }, camadas, contexto),
    nota,
    corpo);
  const atualizarNota = () => { nota.hidden = !INTRADAY.has(g.tf); };

  const g = new Grafico(corpo);
  let atual = null;
  tfs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !atual) return;
    if (b.disabled) return;
    tfs.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x === b));
    g.mostrar(atual.arquivo, b.dataset.tf);
    atualizarNota();
  });
  camadas.addEventListener("change", (e) => {
    g.camadas[e.target.dataset.c] = e.target.checked;
    g.aplicarCamadas();
  });

  return {
    grafico: g,
    async selecionar(a, sinais = []) {
      atual = a;
      g.sinais = sinais;
      titulo.replaceChildren(el("span", { class: "mono" }, semSufixo(a.ticker)), " · ", a.nome);
      sub.replaceChildren(
        el("span", { class: "mono" }, fmtMoeda(a.ultimo, a.moeda)), " ",
        el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct)), " · ",
        `fechamento de ${fmtData(a.data)} `, seloVerificacao(a));
      contexto.replaceChildren(...contextoAtivo(a));
      // 60 min/4h só existem para ações com intraday verificado
      tfs.querySelectorAll("button").forEach((b) => {
        b.disabled = INTRADAY.has(b.dataset.tf) && !a.tem_intraday;
        b.title = b.disabled ? "Sem dados de 60 min verificados para este ativo" : ROTULO_TF[b.dataset.tf];
      });
      if (INTRADAY.has(g.tf) && !a.tem_intraday) g.tf = "D";
      tfs.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b.dataset.tf === g.tf));
      atualizarNota();
      await g.mostrar(a.arquivo);
      aoSelecionar?.(a);
    },
  };
}

/** Pílulas com o estado do ativo: tendência, IFRs, compressão. */
function contextoAtivo(a) {
  const p = [];
  if (a.tendencia_forte) p.push(el("span", { class: `pilula ${a.tendencia_forte}` },
    `Tendência forte de ${a.tendencia_forte} (D+S)`));
  else p.push(el("span", { class: "pilula" }, `D: ${a.tend_d} · S: ${a.tend_s}`));
  const v = (x) => (x == null ? "—" : fmtNum(x, 0));
  const ifrCls = (x) => (x == null ? "" : x < 30 ? "alta" : x > 70 ? "baixa" : "");
  p.push(el("span", { class: "pilula" }, "IFR ",
    el("b", { class: ifrCls(a.ifr_60) }, `60m ${v(a.ifr_60)}`), " · ",
    el("b", { class: ifrCls(a.ifr_d) }, `D ${v(a.ifr_d)}`), " · ",
    el("b", { class: ifrCls(a.ifr_s) }, `S ${v(a.ifr_s)}`), " · ",
    el("b", { class: ifrCls(a.ifr_m) }, `M ${v(a.ifr_m)}`)));
  if (a.estoc_60 != null || a.estoc_d != null)
    p.push(el("span", { class: "pilula" }, `Estoc. lento 60m ${v(a.estoc_60)} · D ${v(a.estoc_d)}`));
  if (a.bb_comprimida) p.push(el("span", { class: "pilula aviso" }, `Bollinger comprimida desde ${fmtData(a.bb_comprimida_desde)}`));
  return p;
}
