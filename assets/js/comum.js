/* Código compartilhado pelas páginas: formatação, dados, indicadores e o gráfico. */

const LWC = window.LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ------------------------------------------------------------- formatação

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const fmtNum = (v, casas = 2) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const casasPreco = (v) => (v === 0 || Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6);
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
/** Rótulo de exibição: PETR4 em vez de PETR4.SA, SUI em vez de SUI20947-USD. */
const ROTULOS = new Map();
const semSufixo = (t) => ROTULOS.get(t) ?? t.replace(/\.SA$/, "");

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
const carregarRadar = () => buscarJSON("data/radar.json").then((r) => {
  if (!ROTULOS.size) for (const a of r.ativos) if (a.rotulo) ROTULOS.set(a.ticker, a.rotulo);
  return r;
});
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
  pullback: "Pullback", boca: "Boca de jacaré", mtf: "Multitempo",
  ifr: "IFR extremo", bb_fora: "Fora da BB", distancia: "Distância MM20", quedas: "Maior queda",
};
/** Nome curto pelo lado: na venda, "Maior queda" vira "Maior alta". */
const nomeFamilia = (f, lado) => (f === "quedas" && lado === "venda" ? "Maior alta" : FAMILIA_CURTA[f] ?? f);

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

/**
 * Sinais dos últimos `n` pregões de cada mercado. Cripto tem candle no fim de semana e a
 * ação não, então "o último pregão" é contado separadamente por mercado.
 */
function sinaisDoPeriodo(R, tf, n) {
  const mercado = new Map(R.ativos.map((a) => [a.ticker, a.mercado]));
  const datas = new Map();
  for (const s of R.sinais) {
    if (s.tf !== tf) continue;
    const m = mercado.get(s.ticker);
    if (!datas.has(m)) datas.set(m, new Set());
    datas.get(m).add(s.data);
  }
  const desde = new Map([...datas].map(([m, d]) => {
    const ord = [...d].sort().reverse();
    return [m, ord[Math.min(n, ord.length) - 1]];
  }));
  const ultima = new Map([...datas].map(([m, d]) => [m, [...d].sort().pop()]));
  return {
    sinais: R.sinais.filter((s) => s.tf === tf && s.data >= desde.get(mercado.get(s.ticker))),
    desde, ultima,
  };
}

/** Datas de pregão presentes nos sinais (mais recente primeiro). */
const datasSinais = (sinais, tf) => [...new Set(sinais.filter((s) => s.tf === tf).map((s) => s.data))].sort().reverse();

function chipsFamilias(familias, lado = "compra") {
  return [...familias].map((f) => el("span", { class: `chip fam-${f}` }, nomeFamilia(f, lado)));
}

function seloVerificacao(a) {
  const v = a.verificacao ?? {};
  const txt = v.status === "conferido"
    ? `Conferido com ${v.fonte}${v.ate ? " até " + fmtData(v.ate) : ""}` +
      (v.dif_max_pct != null ? ` · diferença máx. ${fmtNum(v.dif_max_pct, 2)}%` : "")
    : "Só verificação interna (sem fonte de referência)";
  const completados = v.completados_oficial ?? [];
  const extra = completados.length
    ? ` · candle de ${completados.map((d) => fmtData(d)).join(", ")} veio quebrado do Yahoo e foi trocado pelo oficial (${v.fonte})` : "";
  const selo = el("span", { class: `selo selo-${v.status}`, title: txt + extra }, v.status === "conferido" ? "✓ conferido" : "◦ interno");
  if (!v.pendente) return selo;
  return el("span", {}, selo, " ", el("span", { class: "selo selo-pendente",
    title: `O candle de ${fmtData(v.pendente)} veio sem fechamento da fonte e ficou de fora até a próxima atualização.` },
    `${fmtData(v.pendente)} incompleto na fonte`));
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

// ------------------------------------------------------------- preferências do gráfico

/** Predefinições. "limpo" = fundo branco, sem grade e sem indicadores (o usuário liga o que quiser). */
const PREDEFINICOES = {
  escuro: {
    nome: "Escuro", fundo: "#0f141c", gradeV: true, gradeH: true, corAlta: "#26c281", corBaixa: "#f0506e",
    mm20: true, mm50: true, mm200: true, bb: true, ifr: true, sinais: true,
  },
  limpo: {
    nome: "Claro limpo", fundo: "#ffffff", gradeV: false, gradeH: false, corAlta: "#089981", corBaixa: "#f23645",
    mm20: false, mm50: false, mm200: false, bb: false, ifr: false, sinais: false,
  },
  claro: {
    nome: "Claro com grade", fundo: "#ffffff", gradeV: true, gradeH: true, corAlta: "#089981", corBaixa: "#f23645",
    mm20: true, mm50: true, mm200: true, bb: true, ifr: true, sinais: true,
  },
};

const Preferencias = {
  chave: "grafico-preferencias",
  atual: null,
  ler() {
    this.atual ??= { ...PREDEFINICOES.escuro, ...guardar.ler(this.chave, {}) };
    return this.atual;
  },
  definir(mudancas) {
    this.atual = { ...this.ler(), ...mudancas };
    guardar.gravar(this.chave, this.atual);
    graficos.forEach((g) => g.aplicarPreferencias());
    document.dispatchEvent(new CustomEvent("preferencias"));
  },
  /** Cores que dependem do fundo: texto, grade e linhas auxiliares legíveis no claro e no escuro. */
  derivadas(p = this.ler()) {
    const hex = p.fundo.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const claro = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
    return claro
      ? { claro, texto: "#4a5361", grade: "#e9ecef", borda: "#d6dae0", bb: "#8a94a6", ifr: "#7e57c2", nivel: "#c9ced6" }
      : { claro, texto: css("--texto-fraco"), grade: "rgba(31,39,51,0.5)", borda: css("--borda"), bb: css("--bb"), ifr: css("--acento"), nivel: css("--borda-forte") };
  },
};

const graficos = new Set();
const BARRAS_VISIVEIS = { 60: 160, 240: 120, D: 180, W: 110, M: 72 };
const INTRADAY = new Set(["60", "240"]);
const ROTULO_TF = { 60: "60 min", 240: "4 horas", D: "Diário", W: "Semanal", M: "Mensal" };
const ROTULO_TF_FRASE = { 60: "60 min", 240: "4 horas", D: "diário", W: "semanal", M: "mensal" };

class Grafico {
  /** opcoes: { mini: bool } — o mini não tem painel de IFR nem eixo de tempo detalhado. */
  constructor(alvo, opcoes = {}) {
    this.alvo = alvo;
    this.mini = !!opcoes.mini;
    this.pedido = 0;
    this.tf = "D";
    this.chart = LWC.createChart(alvo, {
      autoSize: true,
      layout: {
        fontFamily: "JetBrains Mono, monospace",
        fontSize: this.mini ? 10 : 11,
        attributionLogo: !this.mini,
        panes: { separatorColor: css("--borda"), separatorHoverColor: css("--bg-elev") },
      },
      timeScale: { rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },

      localization: { locale: "pt-BR", priceFormatter: (p) => fmtNum(p, casasPreco(p)) },
    });
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, { borderVisible: false });
    const linha = (cor, pane = 0, extra = {}) => this.chart.addSeries(LWC.LineSeries, {
      color: cor, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra,
    }, pane);
    this.mm20 = linha(css("--mm20"));
    this.mm50 = linha(css("--mm50"));
    this.mm200 = linha(css("--mm200"), 0, { lineWidth: 2 });
    const bb = { lineWidth: 1, lineStyle: LWC.LineStyle.Dotted };
    this.bbSup = linha(css("--bb"), 0, bb);
    this.bbInf = linha(css("--bb"), 0, bb);
    this.marcadores = LWC.createSeriesMarkers(this.candles, []);
    this.sinais = [];
    // no mini (multitela) a roda do mouse rola a página; arrastar navega; em tela cheia volta o zoom pela roda
    if (this.mini) this.rodaDoMouse(false);
    graficos.add(this);
    this.balao = el("div", { class: "balao-sinal", hidden: true });
    alvo.append(this.balao);
    this.chart.subscribeCrosshairMove((param) => this.mostrarBalao(param));
    this.aplicarPreferencias();
  }

  /** O painel do IFR só existe quando o indicador está ligado (sem ele, o gráfico fica limpo). */
  painelIFR(ligado) {
    if (this.mini) return;
    if (ligado && !this.ifr) {
      const d = Preferencias.derivadas();
      this.ifr = this.chart.addSeries(LWC.LineSeries, {
        color: d.ifr, lineWidth: 1.5, priceLineVisible: false, crosshairMarkerVisible: false,
        lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 },
      }, 1);
      this.niveisIFR = [[80, "baixa"], [70, "nivel"], [30, "nivel"], [20, "alta"]].map(([price, c]) =>
        this.ifr.createPriceLine({ price, color: c, lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
      this.chart.panes()[1]?.setHeight(110);
      if (this.c) this.ifr.setData(ifr(this.c));
    } else if (!ligado && this.ifr) {
      this.chart.removeSeries(this.ifr);  // painel vazio é removido junto
      this.ifr = null;
    }
  }

  /** Aplica fundo, grade, cores dos candles e quais indicadores aparecem. */
  aplicarPreferencias() {
    const p = Preferencias.ler();
    const d = Preferencias.derivadas(p);
    this.chart.applyOptions({
      layout: {
        background: { type: "solid", color: p.fundo }, textColor: d.texto,
        panes: { separatorColor: d.borda, separatorHoverColor: d.grade },
      },
      grid: { vertLines: { visible: p.gradeV, color: d.grade }, horzLines: { visible: p.gradeH, color: d.grade } },
      rightPriceScale: { borderColor: d.borda },
      timeScale: { borderColor: d.borda },
    });
    this.candles.applyOptions({
      upColor: p.corAlta, downColor: p.corBaixa, wickUpColor: p.corAlta, wickDownColor: p.corBaixa,
    });
    this.mm20.applyOptions({ visible: p.mm20 });
    this.mm50.applyOptions({ visible: p.mm50 });
    this.mm200.applyOptions({ visible: p.mm200 });
    for (const s of [this.bbSup, this.bbInf]) s.applyOptions({ visible: p.bb, color: d.bb });
    this.painelIFR(p.ifr);
    if (this.ifr) {
      this.ifr.applyOptions({ color: d.ifr });
      const cores = { baixa: p.corBaixa, nivel: d.nivel, alta: p.corAlta };
      this.niveisIFR.forEach((l, i) => l.applyOptions({ color: cores[["baixa", "nivel", "nivel", "alta"][i]] }));
    }
    this.alvo.classList.toggle("grafico-claro", d.claro);
    if (this.c) this.marcar(this.c);
  }

  async mostrar(arquivo, tf = this.tf) {
    const pedido = ++this.pedido;  // descarta respostas de cliques anteriores que chegarem depois
    this.tf = tf;
    const intraday = INTRADAY.has(tf);
    const dados = await (intraday ? carregarIntraday(arquivo) : carregarCandles(arquivo));
    if (pedido !== this.pedido || this.removido) return false;
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
    this.c = c;
    this.marcar(c);
    this.n = c.length;
    this.centralizar();
    this.aoMostrar?.();
    return true;
  }

  /** Setas nos candles em que as estratégias dispararam (diário e semanal). */
  marcar(candles) {
    const p = Preferencias.ler();
    const tfSinal = p.sinais ? { D: "D", W: "S" }[this.tf] : null;
    const existe = new Set(candles.map((c) => c.time));
    const porDia = new Map();
    this.sinaisDoCandle = new Map();  // candle -> sinais, para o balão ao passar o mouse
    for (const s of this.sinais) {
      if (s.tf !== tfSinal || !existe.has(s.data)) continue;
      const chave = `${s.data}:${s.lado}`;
      if (!porDia.has(chave)) porDia.set(chave, s);
      if (!this.sinaisDoCandle.has(s.data)) this.sinaisDoCandle.set(s.data, []);
      this.sinaisDoCandle.get(s.data).push(s);
    }
    const m = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)).map((s) => ({
      time: s.data,
      position: s.lado === "compra" ? "belowBar" : "aboveBar",
      shape: s.lado === "compra" ? "arrowUp" : "arrowDown",
      color: s.lado === "compra" ? p.corAlta : p.corBaixa,
    }));
    this.marcadores.setMarkers(m);
  }

  /** Balão com o motivo de cada sinal quando o mouse passa sobre o candle da seta. */
  mostrarBalao(param) {
    const sinais = param.time != null && param.point ? this.sinaisDoCandle?.get(param.time) : null;
    if (!sinais?.length) { this.balao.hidden = true; return; }
    const tfNome = this.tf === "W" ? "semanal" : "diário";
    const semana = this.tf === "W" ? "semana de " : "";
    this.balao.replaceChildren(...["compra", "venda"].flatMap((lado) => {
      const doLado = sinais.filter((s) => s.lado === lado);
      if (!doLado.length) return [];
      return [el("div", { class: `balao-bloco ${lado}` },
        el("b", {}, `${lado === "compra" ? "▲ Sinal de compra" : "▼ Sinal de venda"} · ${semana}${fmtData(doLado[0].data)} · ${tfNome}`),
        el("ul", {}, doLado.map((s) => el("li", {}, el("span", { class: `chip fam-${s.familia}` }, nomeFamilia(s.familia, lado)), " ", s.texto))))];
    }));
    this.balao.hidden = false;
    const larg = this.alvo.clientWidth, w = this.balao.offsetWidth, h = this.balao.offsetHeight;
    const x = param.point.x + 16 + w > larg ? param.point.x - w - 16 : param.point.x + 16;
    this.balao.style.left = `${Math.max(4, x)}px`;
    this.balao.style.top = `${Math.max(4, Math.min(param.point.y - h / 2, this.alvo.clientHeight - h - 4))}px`;
  }

  rodaDoMouse(ligada) {
    this.chart.applyOptions({ handleScroll: { mouseWheel: ligada }, handleScale: { mouseWheel: ligada } });
  }

  /** Desmonta o gráfico; respostas que ainda estiverem a caminho são descartadas. */
  remover() {
    this.removido = true;
    graficos.delete(this);
    this.chart.remove();
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

// ------------------------------------------------------------- tela cheia

/** Botão que põe o elemento (painel do gráfico ou célula da multitela) em tela cheia. */
function botaoTelaCheia(elemento) {
  return el("button", { class: "botao-tela-cheia", title: "Tela cheia (Esc para sair)", "aria-label": "Tela cheia",
    onclick: (e) => {
      e.stopPropagation();
      const alvo = elemento();
      if (document.fullscreenElement) document.exitFullscreen();
      else alvo.requestFullscreen?.().catch(() => {});
    } }, "⛶");
}

// ------------------------------------------------------------- painel de gráfico

/** Painel completo: cabeçalho do ativo, tempo gráfico, camadas e o gráfico. */
function painelGrafico(alvo, { aoSelecionar, simular = false } = {}) {
  const titulo = el("h2", {}, "Gráfico");
  const sub = el("p", { class: "sub" });
  const contexto = el("div", { class: "contexto" });
  const corpo = el("div", { class: "grafico" });
  const boleta = el("div", { class: "boleta", hidden: true });
  const botaoSimular = el("button", { class: "botao-simular", hidden: !simular,
    title: "Simular uma posição: entrada, stop e alvo arrastáveis no gráfico" }, "⊕ Simular");
  const nota = el("p", { class: "nota-tf", hidden: true },
    "60 min e 4h: o último candle é o do pregão contínuo; o fechamento oficial do dia sai no leilão e pode diferir um pouco.");
  const tfs = el("div", { class: "segmento", role: "group", "aria-label": "Tempo gráfico" },
    ["60:60m", "240:4h", "D:Diário", "W:Semanal", "M:Mensal"].map((x) => {
      const [tf, rot] = x.split(":");
      return el("button", { "data-tf": tf, class: tf === "D" ? "ativo" : null, title: ROTULO_TF[tf] }, rot);
    }));
  const camadas = atalhosIndicadores({ comSinais: true });
  alvo.replaceChildren(
    el("div", { class: "painel-cab" }, el("div", {}, titulo, sub), el("div", { class: "controles" }, botaoSimular, tfs, botaoTelaCheia(() => alvo))),
    el("div", { class: "barra-grafico" }, camadas, contexto),
    nota,
    corpo,
    boleta);
  const atualizarNota = () => { nota.hidden = !INTRADAY.has(g.tf); };

  const g = new Grafico(corpo);
  // desenhos antes do simulador: com uma ferramenta ativa, o clique é do desenho
  const des = typeof Desenhos !== "undefined" ? new Desenhos(g, corpo) : null;
  const sim = simular && typeof Simulador !== "undefined" ? new Simulador(g, corpo, boleta, botaoSimular) : null;
  let atual = null;
  tfs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !atual) return;
    if (b.disabled) return;
    tfs.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x === b));
    g.mostrar(atual.arquivo, b.dataset.tf);
    atualizarNota();
  });

  return {
    grafico: g,
    simulador: sim,
    desenhos: des,
    /** Troca o tempo gráfico de fora (ex.: filtro de Bollinger no 4h). */
    mudarTf(tf) {
      const b = tfs.querySelector(`button[data-tf="${tf}"]`);
      if (b && !b.disabled && g.tf !== tf) b.click();
      else if (b?.disabled) g.tf = tf;  // o próximo ativo com intraday já abre nesse tempo
    },
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
      des?.definirAtivo(a.ticker);
      sim?.definirAtivo(a);
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

// ------------------------------------------------------------- personalização do gráfico

const INDICADORES = [
  ["mm20", "MM20", "--mm20"], ["mm50", "MM50", "--mm50"], ["mm200", "MM200", "--mm200"],
  ["bb", "Bollinger", "--bb"], ["ifr", "IFR", "--acento"], ["sinais", "Setas dos sinais", "--aviso"],
];

/** Liga/desliga rápido de cada indicador + botão que abre a personalização completa. */
function atalhosIndicadores({ comSinais = false, comIFR = true } = {}) {
  const p = Preferencias.ler();
  const caixa = el("div", { class: "camadas" },
    ...INDICADORES.filter(([k]) => (comSinais || k !== "sinais") && (comIFR || k !== "ifr")).map(([k, rot, cor]) =>
      el("label", { class: "leg", style: `--cor-leg: var(${cor})` },
        el("input", { type: "checkbox", "data-k": k, checked: p[k], onchange: (e) => Preferencias.definir({ [k]: e.target.checked }) }), rot)),
    el("button", { class: "botao-personalizar", title: "Fundo, grade, cores e indicadores do gráfico",
      onclick: (e) => abrirPersonalizacao(e.currentTarget) }, "⚙ Personalizar"));
  // mudança feita em outro lugar (painel de personalização) reflete aqui
  document.addEventListener("preferencias", () => {
    const atual = Preferencias.ler();
    caixa.querySelectorAll("input[data-k]").forEach((i) => { i.checked = atual[i.dataset.k]; });
  });
  return caixa;
}

let caixaPersonalizacao = null;

function abrirPersonalizacao(ancora) {
  if (caixaPersonalizacao?.isConnected) { caixaPersonalizacao.remove(); return; }
  const caixa = el("div", { class: "personalizacao", role: "dialog", "aria-label": "Personalizar gráfico" });
  caixaPersonalizacao = caixa;
  const p = Preferencias.ler();
  const marcar = (k, rot) => el("label", { class: "opcao" },
    el("input", { type: "checkbox", "data-k": k, checked: p[k], onchange: (e) => Preferencias.definir({ [k]: e.target.checked }) }), rot);
  const corInput = (k, rot) => el("label", { class: "opcao cor" }, rot,
    el("input", { type: "color", "data-k": k, value: p[k], oninput: (e) => Preferencias.definir({ [k]: e.target.value }) }));
  caixa.replaceChildren(
    el("div", { class: "personalizacao-topo" }, el("b", {}, "Personalizar gráfico"),
      el("button", { class: "fechar", "aria-label": "Fechar", onclick: () => caixa.remove() }, "×")),
    el("p", { class: "rotulo" }, "Predefinições"),
    el("div", { class: "predefinicoes" }, Object.entries(PREDEFINICOES).map(([k, pre]) =>
      el("button", { class: "predef", onclick: () => Preferencias.definir({ ...pre }) },
        el("span", { class: "amostra", style: `background:${pre.fundo}` },
          el("i", { style: `background:${pre.corAlta}` }), el("i", { style: `background:${pre.corBaixa}` })),
        pre.nome))),
    el("p", { class: "rotulo" }, "Fundo e grade"),
    el("div", { class: "grade-opcoes" }, corInput("fundo", "Cor de fundo"),
      marcar("gradeV", "Linhas verticais"), marcar("gradeH", "Linhas horizontais")),
    el("p", { class: "rotulo" }, "Candles"),
    el("div", { class: "grade-opcoes" }, corInput("corAlta", "Alta"), corInput("corBaixa", "Baixa")),
    el("p", { class: "rotulo" }, "Indicadores"),
    el("div", { class: "grade-opcoes" }, INDICADORES.map(([k, rot]) => marcar(k, rot))),
    el("p", { class: "sub" }, "Vale para todos os gráficos do site, inclusive a Multitela, e fica salvo neste navegador."),
  );
  // atualiza os campos no lugar (redesenhar fecharia o seletor de cor no meio da escolha)
  const sincronizar = () => {
    if (!caixa.isConnected) { document.removeEventListener("preferencias", sincronizar); return; }
    const atual = Preferencias.ler();
    caixa.querySelectorAll("input[data-k]").forEach((i) => {
      if (i === document.activeElement) return;
      if (i.type === "checkbox") i.checked = atual[i.dataset.k]; else i.value = atual[i.dataset.k];
    });
  };
  document.addEventListener("preferencias", sincronizar);
  document.body.append(caixa);
  const r = ancora.getBoundingClientRect();
  const largura = Math.min(320, window.innerWidth - 32);
  caixa.style.width = `${largura}px`;
  caixa.style.top = `${r.bottom + window.scrollY + 6}px`;
  caixa.style.left = `${Math.max(16, Math.min(r.right - largura, window.innerWidth - largura - 16)) + window.scrollX}px`;
  const fora = (e) => {
    if (!caixa.contains(e.target) && e.target !== ancora) { caixa.remove(); document.removeEventListener("pointerdown", fora); }
  };
  setTimeout(() => document.addEventListener("pointerdown", fora));
}
