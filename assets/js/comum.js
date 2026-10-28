/* Código compartilhado pelas páginas: formatação, dados, indicadores e o gráfico. */

const LWC = window.LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ------------------------------------------------------------- formatação

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const fmtNum = (v, casas = 2) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** Casas decimais de um preço; cotações de moedas (FX) pedem mais casas (1,08345). */
const casasPreco = (v, moeda) => (moeda === "FX" ? (Math.abs(v) >= 20 ? 3 : 5)
  : v === 0 || Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6);
/** Preço na moeda do ativo. PTS (índices) e FX (cotação de moedas) saem só como número. */
const fmtMoeda = (v, moeda) => {
  if (v == null) return "—";
  if (moeda === "PTS") return fmtNum(v, 2);
  if (moeda === "FX") return fmtNum(v, casasPreco(v, "FX"));
  if (moeda === "USD" && Math.abs(v) < 1) return `US$ ${fmtNum(v, 6)}`;
  return (moeda === "USD" ? fmtUSD : fmtBRL).format(v);
};
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
const carregarBacktest = () => buscarJSON("data/backtest.json");

/** Preço mais recente: o do pregão em andamento, se houver, senão o último fechamento. */
const precoAtual = (a) => (a.parcial
  ? { ultimo: a.parcial.ultimo, var_pct: a.parcial.var_pct, parcial: true }
  : { ultimo: a.ultimo, var_pct: a.var_dia_pct, parcial: false });

/** Preço e variação do dia; durante o pregão, o valor em formação com um ponto indicando isso. */
const precoComFormacao = (a, classe) => {
  const p = precoAtual(a);
  return el("div", { class: classe, title: p.parcial ? `Pregão de ${fmtData(a.parcial.data)} em andamento (sem sinais até o fechamento)` : null },
    p.parcial ? el("span", { class: "ponto-formacao" }, "● ") : null,
    el("span", { class: "mono" }, fmtMoeda(p.ultimo, a.moeda)), " ",
    el("span", { class: `mono ${cor(p.var_pct)}` }, fmtPct(p.var_pct)));
};

const fmtDuracao = (ms) => {
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
};

/**
 * Aviso de pregão em andamento com contagem regressiva até os sinais do dia saírem
 * (candle fechado + rodada de atualização). Atualiza sozinho a cada 30 s.
 */
function avisoFormacao(R) {
  const caixa = el("div", { class: "aviso-formacao", hidden: true });
  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
  const atualizar = () => {
    const grupos = new Map();  // mesmo horário de saída -> mercados
    for (const [m, f] of Object.entries(R.em_formacao ?? {})) {
      const chave = `${f.data}|${f.sinais_em}`;
      if (!grupos.has(chave)) grupos.set(chave, { ...f, mercados: [] });
      grupos.get(chave).mercados.push(nomes[m] ?? m);
    }
    caixa.hidden = !grupos.size;
    caixa.replaceChildren(...[...grupos.values()].sort((a, b) => a.sinais_em.localeCompare(b.sinais_em)).map((g) => {
      const falta = Date.parse(g.sinais_em) - Date.now();
      const hora = new Date(g.sinais_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return el("span", { class: "formacao-item",
        title: `O pregão de ${fmtData(g.data)} ainda não fechou: o candle aparece no gráfico como "em formação", ` +
          `mas só gera sinais depois do fechamento, na atualização prevista para ${hora}.` },
        el("b", {}, g.mercados.join(" e ")), `: sinais de ${fmtData(g.data)} `,
        falta > 0 ? el("b", { class: "contagem-regressiva" }, `em ${fmtDuracao(falta)}`) : el("b", {}, "já devem ter saído"),
        falta > 0 ? ` (≈ ${hora})` : " · recarregue a página");
    }));
  };
  atualizar();
  setInterval(atualizar, 30000);
  return caixa;
}
async function carregarIntraday(arquivo) {
  const d = await buscarJSON(`data/intraday/${encodeURIComponent(arquivo)}.json`);
  d.candles ??= d.h.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  return d;
}
async function carregarCandles(arquivo) {
  const d = await buscarJSON(`data/ativos/${encodeURIComponent(arquivo)}.json`);
  d.candles ??= d.c.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  // d.parcial: data do candle do pregão em andamento (o último), que ainda não gera sinais
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

/** Selo do backtest do sinal neste ativo: [casos, acerto %, retorno médio %, vantagem %]. */
function seloHistorico(bt, tf) {
  if (!bt) return null;
  const [n, acerto, medio, vantagem] = bt;
  const prazo = tf === "S" || tf === "W" ? "8 semanas" : "10 pregões";
  if (acerto == null) return el("span", { class: "hist hist-poucos", title: `Só ${n} caso(s) no histórico deste ativo: pouco para tirar conclusão` }, `histórico: ${n} caso(s)`);
  const cls = acerto >= 55 && vantagem > 0 ? "hist-bom" : acerto < 45 || vantagem < 0 ? "hist-ruim" : "hist-neutro";
  return el("span", { class: `hist ${cls}`,
    title: `Nos últimos 6 anos, este sinal apareceu ${n} vezes neste ativo. Entrando na abertura seguinte e saindo ${prazo} depois: ` +
      `${fmtNum(acerto, 0)}% deram lucro, retorno médio de ${fmtPct(medio)} e ${fmtPct(vantagem)} em relação a entrar num dia qualquer.` },
  `${fmtNum(acerto, 0)}% acerto · ${fmtPct(medio)} · ${n} casos`);
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

/** Média exponencial (mesma conta do pandas ewm(span=n, adjust=False) usada no servidor). */
function ema(candles, n) {
  const out = [];
  const k = 2 / (n + 1);
  let e = null;
  candles.forEach((c, i) => {
    e = e == null ? c.close : c.close * k + e * (1 - k);
    if (i >= n - 1) out.push({ time: c.time, value: e });
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

/** Estocástico lento (14, 3, 3): %K e %D. */
function estocastico(candles, n = 14, suave = 3, d = 3) {
  const rapido = [];
  for (let i = n - 1; i < candles.length; i++) {
    let max = -Infinity, min = Infinity;
    for (let j = i - n + 1; j <= i; j++) { max = Math.max(max, candles[j].high); min = Math.min(min, candles[j].low); }
    rapido.push({ time: candles[i].time, value: max > min ? (100 * (candles[i].close - min)) / (max - min) : 50 });
  }
  const media = (serie, m) => serie.slice(m - 1).map((x, i) => ({ time: x.time, value: serie.slice(i, i + m).reduce((t, y) => t + y.value, 0) / m }));
  const k = media(rapido, suave);
  return { k, d: media(k, d) };
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
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: this.mini ? 10 : 11,
        attributionLogo: !this.mini,
        panes: { separatorColor: css("--borda"), separatorHoverColor: css("--bg-elev") },
      },
      timeScale: { rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },

      localization: { locale: "pt-BR", priceFormatter: (p) => fmtNum(p, casasPreco(p, this.moeda)) },
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
    // as setas não mexem na escala: em gráfico baixo, abrir espaço para elas achatava os candles
    this.marcadores = LWC.createSeriesMarkers(this.candles, [], { autoScale: false });
    this.sinais = [];
    graficos.add(this);
    this.balao = el("div", { class: "balao-sinal", hidden: true });
    alvo.append(this.balao);
    this.chart.subscribeCrosshairMove((param) => this.mostrarBalao(param));
    // faixa que destaca o candle de um sinal escolhido na lista (irPara)
    this.destaque = el("div", { class: "destaque-sinal", hidden: true });
    alvo.append(this.destaque);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.posicionarDestaque());
    this.chart.timeScale().subscribeSizeChange(() => this.posicionarDestaque());
    this.aplicarPreferencias();
  }

  /** O painel do IFR só existe quando o indicador está ligado (sem ele, o gráfico fica limpo). */
  painelIFR(ligado, n = 14) {
    if (this.mini && !this.sob?.osc) ligado = false;
    if (ligado && this.ifr && this.ifrN !== n) { this.chart.removeSeries(this.ifr); this.ifr = null; }
    this.ifrN = n;
    if (ligado && !this.ifr) {
      const d = Preferencias.derivadas();
      this.ifr = this.chart.addSeries(LWC.LineSeries, {
        color: d.ifr, lineWidth: 1.5, priceLineVisible: false, crosshairMarkerVisible: false,
        lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 },
      }, 1);
      this.niveisIFR = [[80, "baixa"], [70, "nivel"], [30, "nivel"], [20, "alta"]].map(([price, c]) =>
        this.ifr.createPriceLine({ price, color: c, lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
      this.chart.panes()[1]?.setHeight(this.mini ? 60 : 110);
      if (this.c) this.ifr.setData(ifr(this.c, this.ifrN));
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
    // com sobreposição (rastreador), o gráfico mostra só o que a condição usa
    const sob = this.sob;
    const usa = (id) => sob.medias.some((m) => m.id === id);
    this.mm20.applyOptions({ visible: sob ? usa("sma20") : p.mm20 });
    this.mm50.applyOptions({ visible: sob ? usa("sma50") : p.mm50 });
    this.mm200.applyOptions({ visible: sob ? usa("sma200") : p.mm200 });
    for (const s of [this.bbSup, this.bbInf]) s.applyOptions({ visible: sob ? !!sob.bb : p.bb, color: d.bb });
    this.painelIFR(sob ? !!sob.osc?.ifr : p.ifr, sob?.osc?.ifr ?? 14);
    this.painelEstocastico(!!sob?.osc?.estoc);
    if (this.ifr) {
      this.ifr.applyOptions({ color: d.ifr });
      const cores = { baixa: p.corBaixa, nivel: d.nivel, alta: p.corAlta };
      this.niveisIFR.forEach((l, i) => l.applyOptions({ color: cores[["baixa", "nivel", "nivel", "alta"][i]] }));
    }
    this.alvo.classList.toggle("grafico-claro", d.claro);
    if (this.c) { this.pintarCandles(this.c); this.marcar(this.c); }
  }

  async mostrar(arquivo, tf = this.tf) {
    const pedido = ++this.pedido;  // descarta respostas de cliques anteriores que chegarem depois
    this.tf = tf;
    const intraday = INTRADAY.has(tf);
    const dados = await (intraday ? carregarIntraday(arquivo) : carregarCandles(arquivo));
    // a moeda define as casas do eixo de preço (o arquivo diário traz; o de 60 min, não)
    this.moeda = (intraday ? await carregarCandles(arquivo).catch(() => ({})) : dados).moeda;
    if (pedido !== this.pedido || this.removido) return false;
    this.chart.timeScale().applyOptions({ timeVisible: intraday, secondsVisible: false });
    const c = agregar(dados.candles, tf);
    // no diário/semanal/mensal, o último candle contém o pregão em andamento
    this.parcial = !intraday && dados.parcial && dados.candles.at(-1)?.time === dados.parcial ? c.at(-1).time : null;
    this.pintarCandles(c);
    this.mm20.setData(sma(c, 20));
    this.mm50.setData(sma(c, 50));
    this.mm200.setData(sma(c, 200));
    const { sup, inf } = bollinger(c);
    this.bbSup.setData(sup);
    this.bbInf.setData(inf);
    this.ifr?.setData(ifr(c, this.ifrN ?? 14));
    this.c = c;
    this.desenharExtras();
    this.desenharNiveis();
    this.preencherEstocastico();
    this.dataDestaque = null;
    this.destaque.hidden = true;
    this.marcar(c);
    this.n = c.length;
    this.centralizar();
    this.aoMostrar?.();
    return true;
  }

  /**
   * Sobreposição de um modelo do rastreador: { medias: [{id, tipo, n, cor}], bb, osc: {ifr, estoc},
   * niveis: [{preco, rotulo, cor}] }. Enquanto ativa, substitui os indicadores das preferências;
   * null volta ao normal.
   */
  definirSobreposicao(sob) {
    this.sob = sob;
    const padrao = new Set(["sma20", "sma50", "sma200"]);
    this.mediasExtras = (sob?.medias ?? []).filter((m) => !padrao.has(m.id));
    this.aplicarPreferencias();
    if (this.c) { this.desenharExtras(); this.desenharNiveis(); }
  }

  desenharNiveis() {
    for (const l of this.linhasNivel ?? []) this.candles.removePriceLine(l);
    this.linhasNivel = (this.sob?.niveis ?? []).map((n) => this.candles.createPriceLine({
      price: n.preco, color: n.cor ?? css("--aviso"), lineWidth: 1, lineStyle: LWC.LineStyle.Dashed,
      axisLabelVisible: true, title: n.rotulo }));
  }

  /** Estocástico lento no painel de baixo (junto do IFR, mesma escala 0-100). */
  painelEstocastico(ligado) {
    if (ligado && !this.estK) {
      const op = { lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      this.estK = this.chart.addSeries(LWC.LineSeries, { ...op, color: "#4aa3ff" }, 1);
      this.estD = this.chart.addSeries(LWC.LineSeries, { ...op, color: "#f5b942", lineStyle: LWC.LineStyle.Dotted }, 1);
      this.niveisEst = [80, 20].map((price) => this.estK.createPriceLine({
        price, color: css("--borda-forte"), lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
      this.chart.panes()[1]?.setHeight(this.mini ? 60 : 110);
      if (this.c) this.preencherEstocastico();
    } else if (!ligado && this.estK) {
      this.chart.removeSeries(this.estK);
      this.chart.removeSeries(this.estD);
      this.estK = this.estD = null;
    }
  }

  preencherEstocastico() {
    if (!this.estK) return;
    const { k, d } = estocastico(this.c);
    this.estK.setData(k);
    this.estD.setData(d);
  }

  desenharExtras() {
    for (const s of this.seriesExtras ?? []) this.chart.removeSeries(s);
    this.seriesExtras = (this.mediasExtras ?? []).map(({ tipo, n, cor }) => {
      const s = this.chart.addSeries(LWC.LineSeries, {
        color: cor, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(tipo === "ema" ? ema(this.c, n) : sma(this.c, n));
      return s;
    });
  }

  /** Candles na série; o do pregão em andamento fica translúcido. */
  pintarCandles(c) {
    if (!this.parcial) { this.candles.setData(c); return; }
    const p = Preferencias.ler();
    const claro = (hex) => `rgba(${hex.slice(1).match(/../g).map((x) => parseInt(x, 16)).join(",")},0.4)`;
    this.candles.setData(c.map((x) => (x.time !== this.parcial ? x : {
      ...x, color: claro(x.close >= x.open ? p.corAlta : p.corBaixa), wickColor: claro(x.close >= x.open ? p.corAlta : p.corBaixa) })));
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
      // setups sem lado (ex.: Bollinger comprimida) ganham um ponto em vez de seta
      shape: s.lado === "compra" ? "arrowUp" : s.lado === "venda" ? "arrowDown" : "circle",
      color: s.lado === "compra" ? p.corAlta : s.lado === "venda" ? p.corBaixa : css("--aviso"),
    }));
    if (this.parcial) {
      m.push({ time: this.parcial, position: "aboveBar", shape: "circle", size: 0.5, color: css("--texto-fraco"),
        text: "hoje" });
      m.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    }
    this.marcadores.setMarkers(m);
  }

  /** Balão com o motivo de cada sinal quando o mouse passa sobre o candle da seta. */
  mostrarBalao(param) {
    const sinais = param.time != null && param.point ? this.sinaisDoCandle?.get(param.time) : null;
    if (!sinais?.length) { this.balao.hidden = true; return; }
    const tfNome = this.tf === "W" ? "semanal" : "diário";
    const semana = this.tf === "W" ? "semana de " : "";
    const rotulo = { compra: "▲ Sinal de compra", venda: "▼ Sinal de venda", neutro: "◆ Setup sem lado" };
    this.balao.replaceChildren(...["compra", "venda", "neutro"].flatMap((lado) => {
      const doLado = sinais.filter((s) => s.lado === lado);
      if (!doLado.length) return [];
      return [el("div", { class: `balao-bloco ${lado}` },
        el("b", {}, `${rotulo[lado]} · ${semana}${fmtData(doLado[0].data)} · ${tfNome}`),
        el("ul", {}, doLado.map((s) => el("li", {}, el("span", { class: `chip fam-${s.familia}` }, nomeFamilia(s.familia, lado)), " ", s.texto,
          s.bt ? el("div", {}, seloHistorico(s.bt, s.tf)) : null))))];
    }));
    this.balao.hidden = false;
    const larg = this.alvo.clientWidth, w = this.balao.offsetWidth, h = this.balao.offsetHeight;
    const x = param.point.x + 16 + w > larg ? param.point.x - w - 16 : param.point.x + 16;
    this.balao.style.left = `${Math.max(4, x)}px`;
    this.balao.style.top = `${Math.max(4, Math.min(param.point.y - h / 2, this.alvo.clientHeight - h - 4))}px`;
  }

  /** Desmonta o gráfico; respostas que ainda estiverem a caminho são descartadas. */
  remover() {
    this.removido = true;
    graficos.delete(this);
    this.chart.remove();
  }

  /**
   * Leva o gráfico até o candle de uma data e o destaca, deixando espaço à direita
   * para ver o que o preço fez depois (o sinal deu certo?).
   */
  irPara(data) {
    if (!this.c?.length) return;
    let i = this.c.findIndex((c) => c.time >= data);
    if (i < 0) i = this.c.length - 1;
    for (const s of [this.candles, this.ifr]) s?.priceScale().applyOptions({ autoScale: true });
    const vis = this.mini ? Math.min(BARRAS_VISIVEIS[this.tf], 120) : BARRAS_VISIVEIS[this.tf];
    // o sinal fica a uns 40% da largura; perto do fim, encosta no último candle
    const to = Math.min(i + Math.round(vis * 0.6), this.n + 2);
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - vis), to });
    this.dataDestaque = this.c[i].time;
    this.posicionarDestaque();
  }

  /** Destaca o candle de uma data sem mexer no enquadramento. */
  destacar(data) {
    this.dataDestaque = this.c?.find((x) => x.time >= data)?.time ?? null;
    this.posicionarDestaque();
  }

  posicionarDestaque() {
    if (!this.dataDestaque) return;
    const ts = this.chart.timeScale();
    const x = ts.timeToCoordinate(this.dataDestaque);
    if (x == null || x < 0 || x > ts.width()) { this.destaque.hidden = true; return; }
    const larg = Math.max(6, ts.options().barSpacing);
    Object.assign(this.destaque.style, { left: `${x - larg / 2}px`, width: `${larg}px`, height: `${this.chart.panes()[0]?.getHeight() ?? 0}px` });
    this.destaque.hidden = false;
  }

  /** Volta a escala automática de preço e o enquadramento padrão (Alt+C). */
  centralizar() {
    for (const s of [this.candles, this.ifr]) s?.priceScale().applyOptions({ autoScale: true });
    const n = this.n ?? 0;
    const vis = this.mini ? Math.min(BARRAS_VISIVEIS[this.tf], 120) : BARRAS_VISIVEIS[this.tf];
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - vis), to: n + 2 });
  }
}

// Tela cheia: um botão "Sair" sempre visível (além do Esc), em qualquer elemento que entre em tela cheia
document.addEventListener("fullscreenchange", () => {
  document.querySelectorAll(".sair-tela-cheia").forEach((b) => b.remove());
  const alvo = document.fullscreenElement;
  if (!alvo) return;
  alvo.append(el("button", { type: "button", class: "sair-tela-cheia", "aria-label": "Sair da tela cheia",
    onclick: (e) => { e.stopPropagation(); document.exitFullscreen(); } }, "✕ Sair da tela cheia"));
});

document.addEventListener("keydown", (e) => {
  if (e.altKey && e.code === "KeyC") {
    e.preventDefault();
    graficos.forEach((g) => g.centralizar());
  }
});

// ------------------------------------------------------------- topo

/** Guia rápido de cada página (botão "?" do topo). */
const AJUDA = {
  inicio: ["Início", [
    "O terminal serve a um ciclo só: encontrar uma boa oportunidade de compra ou venda, simular o trade (entrada, stop e alvo) e registrar no Diário para aprender com o resultado.",
    "Oportunidades de hoje: quantos setups dispararam no último pregão fechado de cada mercado. Clique num setup para ver os ativos dele, ou em Simular trade para treinar a entrada.",
    "R é a unidade de risco: o stop vale −1R (você perde o que se dispôs a arriscar) e um alvo com o dobro da distância vale +2R. Assim os trades ficam comparáveis, seja qual for o preço do ativo.",
    "Meus trades: os trades que você simulou, o resultado de cada um em R e o total do mês. O Diário guarda o histórico e as estatísticas.",
  ]],
  carteira: ["Carteira", [
    "O que você tem e acompanha: posições, simulações e a sua lista de ativos, com os setups que dispararam em cada um.",
    "Clique em um ativo para abrir a página dele (gráfico, setups recentes, contexto e histórico).",
    "Na Minha lista, digite um ticker e clique em Adicionar; o × tira da lista. Ela fica salva neste navegador.",
    "Plano de amanhã: o que você vai operar no próximo pregão (entrada, stop, alvo, quantidade pelo risco); Minhas anotações: o que viu em cada ativo e o que o preço fez depois. Exportar/Importar leva os dois.",
    "Segure a linha de um ativo parada por meio segundo (ou arraste pelo ticker) até Comparar, Plano de amanhã ou Anotar, ou use o ⋯ ao lado dele.",
  ]],
  ativo: ["Ativo", [
    "Tudo de um ativo: gráfico, setups recentes, contexto, suas simulações e como cada setup se saiu nele.",
    "Clique num setup recente para ver no gráfico o que o preço fez depois.",
    "Use a busca no topo ou as setas ← → para trocar de ativo.",
    "⊕ Simular trade abre uma simulação no gráfico: arraste entrada, stop e alvo e salve. Ela entra no Diário e é reavaliada a cada atualização.",
    "+ Plano de amanhã põe o ativo no plano do próximo pregão com níveis sugeridos; ✎ Anotar guarda o que você viu, preso à data e ao preço.",
  ]],
  setups: ["Oportunidades", [
    "Escolha Compra ou Venda, depois \"A favor\" ou \"Contra a tendência\" e um setup (ou todos). Os chips mostram quantos ativos dispararam cada um no período.",
    "\"Minhas regras\" monta um filtro próprio (médias, IFR, Bollinger...), salvo neste navegador.",
    "Grade: vários gráficos lado a lado para comparar (1, 2×2, 3×3 ou 4×3); clique no selo ✓/⚠ do card para ver o contexto (✓ a favor, ⚠ cuidado; Esc fecha) e use ← → para trocar de página.",
    "As setas no gráfico são os setups escolhidos neste ativo; a faixa azul marca o candle do sinal. Os sinais só saem com o pregão fechado.",
    "Simular: o botão \"⊕ Simular\" do card abre a simulação do trade (entrada, stop e alvo) com o setup e o lado do card. Também dá para arrastar o card até \"Simular trade\" (borda esquerda).",
    "Segure um card parado por meio segundo (até em cima do gráfico) ou arraste pelo cabeçalho: aparecem Comparar, Simular trade, Plano de amanhã e Anotar nas bordas; solte num deles. O ⋯ do card faz o mesmo.",
  ]],
  triagem: ["Triagem", [
    "Um card por ativo que deu sinal de compra (ou de venda) no último pregão fechado do mercado dele: gráfico, setups do dia, histórico e contexto.",
    "Arraste o card para a direita (♥ Gostei), para a esquerda (✗ Descartar, só por hoje) ou para cima (★ Super). Os botões embaixo fazem o mesmo.",
    "Teclado: → gostei, ← descartar, ↑ super, Backspace ou Ctrl+Z desfaz a última decisão.",
    "Em \"Hoje\" ficam as três colunas (Super, Gostei, Descartados): mude de coluna, devolva ao baralho ou mande para Comparar e Plano de amanhã. Os descartados voltam no próximo pregão; Super e Gostei ficam em \"Dias anteriores\" com o quanto o preço andou desde a triagem.",
  ]],
  backtest: ["Backtest", ["Como cada setup se saiu nos últimos 6 anos, por mercado, lado e prazo."]],
  diario: ["Diário", [
    "O seu registro de trades: tudo o que você simula (e fecha) vira um trade aqui. R é o resultado em unidades do risco: +2R = ganhou 2× o que arriscou; o stop vale −1R.",
    "Calendário: cada dia mostra o R dos trades encerrados nele. Clique (ou Enter) num dia para ver os trades, a foto, o setup, a entrada e a saída. Setas movem entre os dias; PageUp e PageDown trocam o mês.",
    "Clique num trade para editar: estratégia, tese (por que entrei), revisão (o que aprendi), nota, etiquetas, níveis, saída manual e fotos (capturar o gráfico, anexar ou colar com Ctrl+V).",
    "Estatísticas por estratégia ou por setup: % de acerto, R médio (expectativa), fator de lucro, sequência de perdas, drawdown e a curva de R acumulado.",
    "Exporte uma planilha (CSV) ou um backup JSON com as fotos. Tudo fica salvo neste navegador: faça backup de vez em quando.",
  ]],
};
/** Glossário em português simples (Início e botão "?"): o que cada sigla quer dizer. */
const GLOSSARIO = [
  ["Setup", "Um padrão técnico que se formou no gráfico e costuma marcar um bom momento de compra ou de venda. Não é garantia."],
  ["Stop", "O preço em que você admite que errou e sai do trade para limitar a perda."],
  ["Alvo", "O preço em que você realiza o lucro."],
  ["R", "Unidade de risco: a distância entre a entrada e o stop. Perder no stop é −1R; ganhar o dobro do risco é +2R."],
  ["R:R", "Relação retorno/risco: 1 : 2 significa que o alvo está duas vezes mais longe que o stop."],
  ["MMS / MME", "Média móvel simples / exponencial: o preço médio dos últimos N candles (MMS 20 = 20 candles). A MME pesa mais os candles recentes."],
  ["Pullback", "Recuo do preço até uma média durante uma tendência, para comprar mais barato (na alta) ou vender mais caro (na baixa)."],
  ["IFR", "Índice de força relativa (RSI): de 0 a 100. Abaixo de 30, o preço caiu rápido demais; acima de 70, subiu rápido demais."],
  ["Bollinger", "Faixa em volta da MMS 20 que acompanha a volatilidade. Fechar fora da faixa indica movimento esticado."],
  ["Multitempo", "O mesmo sinal confirmado em mais de um tempo gráfico (por exemplo diário e semanal)."],
  ["Confluência", "Vários setups ao mesmo tempo no mesmo ativo (aparece como “2+ setups”)."],
  ["Pregão", "Um dia de negociação. “Último pregão fechado” é o dia mais recente que já terminou."],
];
const ATALHOS = [
  ["Alt", "C", "centraliza os gráficos"], ["Alt", "T", "segmento de reta"], ["Alt", "H", "linha horizontal"],
  ["Alt", "R", "retângulo"], ["Alt", "B", "pincel"], ["Ctrl", "Z", "desfaz o último desenho"],
  ["←", "→", "ativo anterior e seguinte (página do ativo)"],
];

function montarTopo(pagina, dados) {
  const topo = document.getElementById("topo");
  const v = dados?.verificacao;
  const marca = el("a", { class: "marca", href: "index.html", "aria-label": "Carteira Terminal: página inicial" });
  marca.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="4" height="9" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><rect x="17" y="11" width="4" height="6" rx="1"/></svg><span>Carteira <b>Terminal</b></span>';

  // status dos dados: data do último pregão e, no detalhe, a verificação
  const ultimo = dados?.ativos?.length ? dados.ativos.reduce((m, a) => (a.mercado !== "CRIPTO" && a.data > m ? a.data : m), "") : null;
  const status = dados ? el("span", { class: `status-dados ${v?.retidos ? "com-retidos" : ""}`,
    title: `${v?.conferidos ?? 0} ativos conferidos com fonte oficial · ${v?.internos ?? 0} só com checagem interna · ` +
      `${v?.retidos ?? 0} retidos por inconsistência.\nAtualizado em ${new Date(dados.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.` },
    el("i", { class: "ponto-status" }), "Pregão de ", el("b", {}, ultimo ? fmtData(ultimo) : "—"),
    el("span", { class: "status-extra" }, ` · atualizado ${new Date(dados.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`)) : null;
  const dolar = dados ? el("span", { class: "dolar", title: "Cotação do dólar usada para converter os ativos dos EUA" }, "Dólar ", el("b", {}, `R$ ${fmtNum(dados.usdbrl, 2)}`)) : null;

  const [titulo, linhas] = AJUDA[pagina] ?? ["Ajuda", []];
  const painelAjuda = el("div", { class: "ajuda", hidden: true, role: "dialog", "aria-labelledby": "ajuda-titulo", tabindex: "-1", id: "painel-ajuda" },
    el("h3", { id: "ajuda-titulo" }, `Como usar: ${titulo}`),
    el("ul", {}, linhas.map((l) => el("li", {}, l))),
    el("details", { class: "ajuda-glossario" }, el("summary", {}, "Glossário: o que significam as siglas"),
      el("dl", { class: "glossario" }, GLOSSARIO.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)]))),
    el("h3", {}, "Atalhos"),
    el("dl", { class: "atalhos" }, ATALHOS.flatMap(([a, b, t]) => [el("dt", {}, el("kbd", {}, a), el("kbd", {}, b)), el("dd", {}, t)])),
    el("p", { class: "sub" }, "Uso pessoal. Os sinais são filtros técnicos automáticos, não recomendação de investimento."));
  const botaoAjuda = el("button", { class: "botao-ajuda", "aria-label": "Como usar esta página", title: "Como usar",
    "aria-expanded": "false", "aria-controls": "painel-ajuda",
    onclick: (e) => { e.stopPropagation(); mostrarAjuda(painelAjuda.hidden); } }, "?");
  // abrir leva o foco ao painel (leitor de tela lê o título); fechar com Esc devolve o foco ao botão
  const mostrarAjuda = (abrir, devolverFoco = false) => {
    painelAjuda.hidden = !abrir;
    botaoAjuda.setAttribute("aria-expanded", String(abrir));
    if (abrir) painelAjuda.focus();
    else if (devolverFoco) botaoAjuda.focus();
  };
  document.addEventListener("click", (e) => { if (!painelAjuda.hidden && !painelAjuda.contains(e.target)) mostrarAjuda(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !painelAjuda.hidden) mostrarAjuda(false, painelAjuda.contains(document.activeElement));
  });

  topo.replaceChildren(
    marca,
    navegacao(pagina),
    buscaTopo(dados?.ativos ?? []),
    el("div", { class: "topo-info" }, status, dolar, botaoAjuda, painelAjuda),
  );
}

// ------------------------------------------------------------- navegação principal

/** Páginas do menu. Três destinos principais (o ciclo: achar → simular → registrar) e o resto em "Mais". */
const NAV_PRINCIPAL = [
  { id: "inicio", href: "index.html", rot: "Início", icone: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { id: "setups", href: "setups.html", rot: "Oportunidades", dica: "Os setups que se formaram: ativos em bom momento de compra ou de venda",
    icone: "M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 100 8 4 4 0 000-8z" },
  { id: "diario", href: "diario.html", rot: "Diário", dica: "Seus trades simulados, resultado em R e estatísticas",
    icone: "M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM9 8h6M9 12h6M9 16h3" },
];
const NAV_MAIS = [
  { id: "triagem", href: "triagem.html", rot: "Triagem", dica: "Passe os sinais do dia, um a um, como num baralho" },
  { id: "backtest", href: "backtest.html", rot: "Backtest", dica: "Como cada setup se saiu nos últimos 6 anos" },
  { id: "carteira", href: "carteira.html", rot: "Carteira", dica: "Posições, minha lista e plano de amanhã" },
];

function iconeSvg(d) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("nav-icone");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/**
 * Menu das páginas. No computador é a barra do topo; no celular (≤ 600 px) o CSS leva o mesmo <nav> para
 * a base da tela (barra de abas ao alcance do polegar). "Mais" é um botão de revelar (aria-expanded) que abre
 * uma lista de links; Esc fecha e devolve o foco ao botão; clicar fora ou sair com Tab também fecha.
 */
function navegacao(pagina) {
  const noMais = NAV_MAIS.some((x) => x.id === pagina);
  const link = (x) => el("a", { href: x.href, class: pagina === x.id ? "ativo" : null, "aria-current": pagina === x.id ? "page" : null,
    title: x.dica ?? null }, x.icone ? iconeSvg(x.icone) : null, el("span", { class: "nav-rotulo" }, x.rot));
  const lista = el("ul", { class: "nav-mais-lista", id: "nav-mais-lista", hidden: true },
    NAV_MAIS.map((x) => el("li", {},
      el("a", { href: x.href, class: pagina === x.id ? "ativo" : null, "aria-current": pagina === x.id ? "page" : null },
        el("b", {}, x.rot), el("span", { class: "sub" }, x.dica)))));
  const ponto = "M5 12h.01M12 12h.01M19 12h.01";
  const botao = el("button", { type: "button", class: `nav-mais-botao ${noMais ? "ativo" : ""}`, "aria-expanded": "false", "aria-controls": "nav-mais-lista",
    title: "Triagem, Backtest e Carteira" }, iconeSvg(ponto), el("span", { class: "nav-rotulo" }, "Mais"), el("i", { class: "nav-seta", "aria-hidden": "true" }, "▾"));
  const caixa = el("div", { class: "nav-mais" }, botao, lista);
  const abrir = (aberto, focar = false) => {
    lista.hidden = !aberto;
    botao.setAttribute("aria-expanded", String(aberto));
    if (aberto && focar) lista.querySelector("a")?.focus();
  };
  botao.addEventListener("click", (e) => { e.stopPropagation(); abrir(lista.hidden); });
  botao.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); abrir(true, true); } });
  caixa.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lista.hidden) { e.stopPropagation(); abrir(false); botao.focus(); }
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest("a")) {
      e.preventDefault();
      const itens = [...lista.querySelectorAll("a")], i = itens.indexOf(document.activeElement);
      itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length].focus();
    }
  });
  caixa.addEventListener("focusout", (e) => { if (e.relatedTarget && !caixa.contains(e.relatedTarget)) abrir(false); });
  document.addEventListener("click", (e) => { if (!caixa.contains(e.target)) abrir(false); });
  return el("nav", { "aria-label": "Páginas", class: "nav-principal" }, NAV_PRINCIPAL.map(link), caixa);
}

// ------------------------------------------------------------- simular trade (ponto de entrada comum)

/** O Diário (assets/js/diario-dados.js) pode não estar na página: carrega sob demanda; sem ele, resolve null. */
let _diarioPromessa = null;
function carregarDiario() {
  const api = () => (typeof Diario !== "undefined" ? Diario : window.Diario) ?? null;
  if (api()) return Promise.resolve(api());
  _diarioPromessa ??= new Promise((ok) => {
    const s = document.createElement("script");
    s.src = "assets/js/diario-dados.js";
    s.onload = () => ok(api());
    s.onerror = () => ok(null);
    document.head.append(s);
  });
  return _diarioPromessa;
}

/** compra/venda a partir de um contexto qualquer (setups sem lado, "neutro", viram compra). */
const ladoDoContexto = (ctx) => (ctx?.lado === "venda" ? "venda" : "compra");

/** Endereço da página do ativo já em modo "simular" (o plano B quando o Diário não está disponível). */
function urlSimular(ctx) {
  const q = new URLSearchParams({ simular: ladoDoContexto(ctx) });
  if (ctx.setup) q.set("setup", ctx.setup);
  if (ctx.tf) q.set("tf", ctx.tf);
  if (ctx.origem) q.set("origem", ctx.origem);
  return `ativo.html?${q}#${encodeURIComponent(ctx.ticker)}`;
}

/**
 * Começa a simular um trade de um ativo: com o Diário, `Diario.registrar(ctx, { grafico })` cria o trade e abre o
 * editor (com a foto do gráfico, se `grafico` vier); sem ele, abre a página do ativo no modo simular.
 * ctx = { ticker, lado, setup?, tf?, data?, preco?, origem }.
 */
async function simularTrade(ctx, { grafico } = {}) {
  const c = { origem: "manual", ...ctx, lado: ladoDoContexto(ctx) };
  const D = await carregarDiario();
  if (D?.registrar) {
    try { return await D.registrar(c, { grafico }); } catch (e) { console.warn("Diario.registrar falhou; abrindo o ativo", e); }
  }
  location.href = urlSimular(c);
}

/** Acha o ativo pelo que foi digitado: PETR4, PETR4.SA, BTC, BRK.B... (null se não achar). */
function acharAtivo(ativos, txt) {
  const t = (txt ?? "").trim().toUpperCase();
  if (!t) return null;
  const tks = new Set(ativos.map((a) => a.ticker));
  const porRotulo = new Map(ativos.map((a) => [(a.rotulo ?? semSufixo(a.ticker)).toUpperCase(), a.ticker]));
  return [t, `${t}.SA`, t.replace(".", "-"), `${t}-USD`, porRotulo.get(t)].find((x) => x && tks.has(x)) ?? null;
}

/** Busca de ativo do topo: abre ativo.html#TICKER. No celular vira só a lupa, que abre o campo. */
function buscaTopo(ativos) {
  const lista = el("datalist", { id: "busca-topo-tickers" },
    ativos.map((a) => el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome)));
  const campo = el("input", { type: "search", list: "busca-topo-tickers", spellcheck: "false", autocomplete: "off",
    placeholder: "Buscar ativo", "aria-label": "Buscar ativo (atalho: /)", title: "Digite o ticker e tecle Enter (atalho: /)" });
  const form = el("form", { class: "busca-topo", role: "search" });
  const aviso = el("p", { class: "busca-aviso", role: "status", "aria-live": "polite", hidden: true });
  campo.addEventListener("input", () => { aviso.hidden = true; campo.removeAttribute("aria-invalid"); });
  const abrir = () => {
    const tk = acharAtivo(ativos, campo.value) ?? (ativos.length ? null : campo.value.trim().toUpperCase());
    if (!tk) {
      const txt = campo.value.trim();
      aviso.textContent = txt ? `Não encontrei “${txt}”. Tente PETR4, VALE3, AAPL ou BTC.` : "Digite o código do ativo, por exemplo PETR4, VALE3, AAPL ou BTC.";
      aviso.hidden = false;
      campo.setAttribute("aria-invalid", "true");
      clearTimeout(aviso._t);
      aviso._t = setTimeout(() => { aviso.hidden = true; campo.removeAttribute("aria-invalid"); }, 5000);
      return;
    }
    campo.value = "";
    form.classList.remove("aberta");
    location.href = `ativo.html#${encodeURIComponent(tk)}`;
  };
  const lupa = el("button", { type: "button", class: "busca-lupa", "aria-label": "Buscar ativo", title: "Buscar ativo",
    onclick: () => {
      // no celular a lupa só abre o campo; com o campo visível, busca
      if (getComputedStyle(campo).display === "none") { form.classList.add("aberta"); campo.focus(); }
      else if (campo.value.trim()) abrir();
      else campo.focus();
    } }, "⌕");
  form.addEventListener("submit", (e) => { e.preventDefault(); abrir(); });
  // escolher uma opção da lista já abre o ativo
  campo.addEventListener("input", (e) => { if (!e.inputType || e.inputType === "insertReplacementText") if (acharAtivo(ativos, campo.value)) abrir(); });
  campo.addEventListener("keydown", (e) => { if (e.key === "Escape") { campo.value = ""; campo.blur(); form.classList.remove("aberta"); } });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); form.classList.add("aberta"); campo.focus();
  });
  form.append(lupa, campo, lista, aviso);
  return form;
}

function erroDados(e) {
  console.error(e);
  document.querySelector("main").replaceChildren(el("div", { class: "painel vazio" },
    "Não encontrei os dados. Rode ", el("code", {}, "python scripts/atualizar_dados.py"),
    " e sirva a pasta com ", el("code", {}, "python -m http.server"), "."));
  paginaPronta();
}

/** Botões de segmento (um ativo por vez). */
function segmento(id, aoMudar) {
  const grupo = document.getElementById(id);
  grupo.setAttribute("role", "group");
  grupo.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    grupo.querySelectorAll("button").forEach((x) => { x.classList.toggle("ativo", x === b); estadoAria(x); });
    aoMudar(b.dataset);
  });
  grupo.querySelectorAll("button").forEach(estadoAria);
  return {
    marcar(chave, valor) {
      grupo.querySelectorAll("button").forEach((x) => { x.classList.toggle("ativo", x.dataset[chave] === valor); estadoAria(x); });
    },
  };
}

// ------------------------------------------------------------- acessibilidade (vale para todas as páginas)

/** Botões de estado (segmentos, abas, chips de filtro) marcam o selecionado com a classe `ativo`.
 * Leitor de tela precisa de aria-pressed (botão liga/desliga) ou aria-selected (aba): sincronizado aqui. */
const SEL_ESTADO = ".segmento button, [role='tab'], button.cat, button.fonte, button.filtro-estado, button.data-evento";
function estadoAria(b) {
  if (!b.matches?.(SEL_ESTADO)) return;
  const ligado = String(b.classList.contains("ativo"));
  if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", ligado);
  else b.setAttribute("aria-pressed", ligado);
}
function varrerEstados(raiz) {
  if (raiz.nodeType !== 1) return;
  if (raiz.matches(".segmento:not([role])")) raiz.setAttribute("role", "group");
  raiz.querySelectorAll?.(".segmento:not([role])").forEach((g) => g.setAttribute("role", "group"));
  estadoAria(raiz);
  raiz.querySelectorAll?.(SEL_ESTADO).forEach(estadoAria);
  // tabela que rola de lado: região focável e nomeada, para rolar com o teclado
  for (const w of [raiz, ...(raiz.querySelectorAll?.(".tabela-wrap") ?? [])]) {
    if (!w.matches(".tabela-wrap:not([role])")) continue;
    const nome = w.closest(".painel")?.querySelector("h2, h3")?.textContent.trim();
    w.setAttribute("role", "region");
    w.setAttribute("aria-label", nome ? `Tabela: ${nome}` : "Tabela");
    w.tabIndex = 0;
  }
}

/** Páginas que sabem quando terminam a primeira montagem chamam `aguardarPagina()` no início do `iniciar()` e
 * `paginaPronta()` no fim: o conteúdo fica oculto (com um esqueleto) até lá e aparece de uma vez, sem nada se
 * mexer na frente do usuário. Páginas que não chamam nada (as novas) aparecem quando o topo monta e o conteúdo
 * fica parado por 350 ms (ou 4 s no máximo). */
function aguardarPagina() { paginaPronta.manual = true; }

/** A página terminou a primeira montagem (dados chegaram, painéis preenchidos): tira o esqueleto. */
function paginaPronta() {
  document.documentElement.classList.add("pronto");
  paginaPronta.vigia?.disconnect();
  clearTimeout(paginaPronta.tempo);
}

/** Preparação comum de toda página: esqueleto sai quando a página avisa que está pronta, "Pular para o conteúdo",
 * landmark `main` com id, e um <h1> (só para leitor de tela) quando a página não tem um. */
function prepararPagina() {
  const topo = document.getElementById("topo");
  const principal = document.querySelector("main");
  if (!topo || !principal) paginaPronta();
  else {
    const aquietar = () => {
      clearTimeout(paginaPronta.tempo);
      // o topo "montou" quando tem algo visível (plano.js/notas.js já põem uma bandeja escondida lá dentro)
      if (topo.querySelector(":scope > :not([hidden])")) paginaPronta.tempo = setTimeout(() => { if (!paginaPronta.manual) paginaPronta(); }, 350);
    };
    paginaPronta.vigia = new MutationObserver(aquietar);
    paginaPronta.vigia.observe(topo, { childList: true });
    paginaPronta.vigia.observe(principal, { childList: true, subtree: true });
    aquietar();
    setTimeout(paginaPronta, 4000);  // se os dados falharem, não deixa a página invisível
  }

  const main = document.querySelector("main");
  if (!main) return;
  main.id ||= "conteudo";
  main.tabIndex = -1;
  if (!document.querySelector(".pular")) {
    document.body.prepend(el("a", { class: "pular", href: `#${main.id}`, onclick: (e) => {
      e.preventDefault();  // o # do endereço guarda o ativo em várias páginas: não pode mudar
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: "start" });
    } }, "Pular para o conteúdo"));
  }
  // um <h1> por página: o da página (ex.: o ticker no Ativo) vale; senão entra um só para leitor de tela
  const garantirH1 = () => {
    const proprios = [...document.querySelectorAll("h1:not(.so-leitor)")];
    const nosso = main.querySelector("h1.so-leitor");
    if (proprios.length) nosso?.remove();
    else if (!nosso) main.prepend(el("h1", { class: "so-leitor" }, document.title.split(" · ")[0]));
  };
  garantirH1();
  new MutationObserver(garantirH1).observe(main, { childList: true, subtree: true });

  varrerEstados(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") estadoAria(m.target);
      else m.addedNodes.forEach(varrerEstados);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", prepararPagina);
else prepararPagina();

// ------------------------------------------------------------- tela cheia

/** Botão que põe o elemento (painel do gráfico ou célula da multitela) em tela cheia. */
function botaoTelaCheia(elemento) {
  return el("button", { class: "botao-tela-cheia", title: "Tela cheia (Esc ou ✕ para sair)", "aria-label": "Tela cheia",
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
    /** Vai até o candle do sinal no tempo gráfico dele (diário ou semanal). */
    async irPara(data, tf) {
      if (!atual) return;
      if (g.tf !== tf) {
        tfs.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x.dataset.tf === tf));
        await g.mostrar(atual.arquivo, tf);
        atualizarNota();
      }
      g.irPara(data);
    },
    async selecionar(a, sinais = []) {
      atual = a;
      g.sinais = sinais;
      titulo.replaceChildren(el("span", { class: "mono" }, semSufixo(a.ticker)), " · ", a.nome);
      sub.replaceChildren(
        el("span", { class: "mono" }, fmtMoeda(a.ultimo, a.moeda)), " ",
        el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct)), " · ",
        `fechamento de ${fmtData(a.data)} `, seloVerificacao(a),
        ...[a.parcial ? el("span", { class: "selo selo-formacao", title: "Pregão em andamento: o candle de hoje aparece no gráfico, mas só gera sinais depois do fechamento" },
          `hoje ${fmtData(a.parcial.data)} em formação: ${fmtMoeda(a.parcial.ultimo, a.moeda)} ${fmtPct(a.parcial.var_pct)}`) : null].filter(Boolean));
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
