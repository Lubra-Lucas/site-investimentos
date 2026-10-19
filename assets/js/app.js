/* Carteira Terminal - front-end estático.
 * Lê data/resumo.json e data/ativos/<ticker>.json (gerados por scripts/atualizar_dados.py)
 * e desenha o painel com Lightweight Charts. */

const LWC = window.LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const estado = { resumo: null, ticker: null, tf: "D", filtroMercado: "", cache: {} };

// ------------------------------------------------------------- formatação

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const fmtNum = (v, casas = 2) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtMoeda = (v, moeda) => (v == null ? "—" : (moeda === "USD" ? fmtUSD : fmtBRL).format(v));
const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v)}%`);
const cor = (v) => (v == null ? "" : v >= 0 ? "alta" : "baixa");
const casasPreco = (v) => (v >= 1000 ? 2 : v >= 1 ? 2 : 6);
const fmtCompacto = (v) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) n.append(f instanceof Node ? f : document.createTextNode(f));
  return n;
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
    if (i <= n) {
      ganho += g / n; perda += p / n;
    } else {
      ganho = (ganho * (n - 1) + g) / n;
      perda = (perda * (n - 1) + p) / n;
    }
    if (i >= n) out.push({ time: candles[i].time, value: perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda) });
  }
  return out;
}

function paraSemanal(candles) {
  const semanas = new Map();
  for (const c of candles) {
    const d = new Date(c.time + "T00:00:00Z");
    const seg = new Date(d);
    seg.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // segunda-feira da semana
    const chave = seg.toISOString().slice(0, 10);
    const s = semanas.get(chave);
    if (!s) semanas.set(chave, { ...c, time: chave });
    else {
      s.high = Math.max(s.high, c.high);
      s.low = Math.min(s.low, c.low);
      s.close = c.close;
      s.volume += c.volume;
    }
  }
  return [...semanas.values()];
}

// ------------------------------------------------------------- gráfico

const opcoesBase = () => ({
  autoSize: true,
  layout: {
    background: { type: "solid", color: "transparent" },
    textColor: css("--texto-fraco"),
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 11,
    panes: { separatorColor: css("--borda"), separatorHoverColor: css("--bg-elev") },
  },
  grid: { vertLines: { color: "rgba(31,39,51,0.5)" }, horzLines: { color: "rgba(31,39,51,0.5)" } },
  rightPriceScale: { borderColor: css("--borda") },
  timeScale: { borderColor: css("--borda") },
  crosshair: { mode: LWC.CrosshairMode.Normal },
  localization: { locale: "pt-BR", priceFormatter: (p) => fmtNum(p, casasPreco(Math.abs(p))) },
});

const grafico = LWC.createChart(document.getElementById("grafico"), opcoesBase());
const serieCandle = grafico.addSeries(LWC.CandlestickSeries, {
  upColor: css("--alta"), downColor: css("--baixa"), borderVisible: false,
  wickUpColor: css("--alta"), wickDownColor: css("--baixa"),
});
const serieVolume = grafico.addSeries(LWC.HistogramSeries, {
  priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false,
});
serieVolume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
const linha = (cor, pane = 0, w = 1.5) =>
  grafico.addSeries(LWC.LineSeries, {
    color: cor, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
  }, pane);
const serieMM20 = linha(css("--mm20"));
const serieMM50 = linha(css("--mm50"));
const serieMM200 = linha(css("--mm200"), 0, 2);
const serieIFR = linha(css("--acento"), 1);
serieIFR.applyOptions({ lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 } });
serieIFR.createPriceLine({ price: 70, color: css("--baixa"), lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
serieIFR.createPriceLine({ price: 30, color: css("--alta"), lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
grafico.panes()[1].setHeight(110);

async function carregarAtivo(arquivo) {
  if (!estado.cache[arquivo]) {
    const r = await fetch(`data/ativos/${encodeURIComponent(arquivo)}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    estado.cache[arquivo] = await r.json();
  }
  return estado.cache[arquivo];
}

async function desenharGrafico() {
  const meta = estado.resumo.ativos.find((a) => a.ticker === estado.ticker);
  if (!meta) return;
  document.getElementById("seletor-ativo").value = meta.ticker;
  document.getElementById("grafico-titulo").textContent = `${meta.ticker} · ${meta.nome}`;
  document.getElementById("grafico-sub").innerHTML =
    `<span class="mono">${fmtMoeda(meta.ultimo, meta.moeda)}</span> ` +
    `<span class="mono ${cor(meta.var_dia_pct)}">${fmtPct(meta.var_dia_pct)}</span> · ` +
    `IFR D <span class="mono">${fmtNum(meta.ifr_diario, 0)}</span> · ` +
    `IFR S <span class="mono">${fmtNum(meta.ifr_semanal, 0)}</span>`;
  document.querySelectorAll(".oport").forEach((n) => n.classList.toggle("selecionado", n.dataset.t === meta.ticker));

  const dados = await carregarAtivo(meta.arquivo);
  const candles = estado.tf === "W" ? paraSemanal(dados.candles) : dados.candles;
  serieCandle.setData(candles);
  serieVolume.setData(candles.map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? "rgba(38,194,129,0.35)" : "rgba(240,80,110,0.35)",
  })));
  serieMM20.setData(sma(candles, 20));
  serieMM50.setData(sma(candles, 50));
  serieMM200.setData(sma(candles, 200));
  serieIFR.setData(ifr(candles));

  const n = candles.length;
  const visiveis = estado.tf === "W" ? 104 : 180;
  grafico.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - visiveis), to: n + 3 });
}

function selecionar(ticker, rolar = true) {
  estado.ticker = ticker;
  try { localStorage.setItem("ticker", ticker); } catch {}
  desenharGrafico().catch((e) => console.error(e));
  if (rolar && window.innerWidth < 1000) document.querySelector(".painel-grafico").scrollIntoView({ behavior: "smooth" });
}

// ------------------------------------------------------------- blocos

function renderKPIs(c) {
  const kpi = (rotulo, valor, extra, classe = "") =>
    el("div", { class: "kpi" },
      el("div", { class: "kpi-rotulo" }, rotulo),
      el("div", { class: "kpi-valor" }, valor),
      extra ? el("div", { class: `kpi-extra ${classe}` }, extra) : null);
  document.getElementById("kpis").replaceChildren(
    kpi("Patrimônio", fmtBRL.format(c.patrimonio_brl)),
    kpi("Resultado", fmtBRL.format(c.resultado_brl), fmtPct(c.resultado_pct), cor(c.resultado_brl)),
    kpi("Investido", fmtBRL.format(c.investido_brl)),
    kpi("Caixa disponível", fmtBRL.format(c.caixa_brl)),
    kpi("Capital inicial", fmtBRL.format(c.capital_inicial)),
  );
}

function renderOportunidades(ativos) {
  const lista = ativos.filter((a) => a.score > 0).slice(0, 12);
  const ol = document.getElementById("oportunidades");
  if (!lista.length) {
    ol.replaceChildren(el("li", { class: "vazio" }, "Nenhum sinal de compra hoje."));
    return;
  }
  ol.replaceChildren(...lista.map((a) => {
    const nivel = a.score >= 5 ? "" : a.score >= 3 ? "medio" : "baixo";
    return el("li", { class: "oport", "data-t": a.ticker, onclick: () => selecionar(a.ticker) },
      el("div", { class: "oport-topo" },
        el("div", {},
          el("span", { class: "oport-ticker" }, a.ticker), " ",
          el("span", { class: "oport-nome" }, a.nome)),
        el("span", { class: `score ${nivel}` }, `score ${a.score}`)),
      el("ul", {},
        a.sinais.map((s) => el("li", {}, s.texto)),
        a.alertas.map((s) => el("li", { class: "alerta" }, s.texto))));
  }));
}

function tabela(id, colunas, linhas, aoClicar, vazio) {
  const t = document.getElementById(id);
  if (!linhas.length) {
    t.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "vazio", colspan: colunas.length }, vazio))));
    return;
  }
  t.replaceChildren(
    el("thead", {}, el("tr", {}, colunas.map((c) => el("th", { class: c.num ? "num" : "" }, c.rotulo)))),
    el("tbody", {}, linhas.map((l) =>
      el("tr", { onclick: () => aoClicar(l) }, colunas.map((c) => {
        const td = el("td", { class: [c.num ? "num" : "", c.classe ? c.classe(l) : ""].join(" ") });
        const v = c.valor(l);
        td.append(v instanceof Node ? v : document.createTextNode(v));
        return td;
      })))),
  );
}

const celTicker = (l) => {
  const nome = estado.resumo.ativos.find((a) => a.ticker === l.ticker)?.nome ?? "";
  return el("span", { class: "ticker-cel" }, el("b", {}, l.ticker), el("span", {}, nome));
};

function renderPosicoes(c) {
  const vazio = el("span", {}, "Nenhuma posição ainda. Registre suas compras em ",
    el("code", {}, "config/carteira.json"), " → ", el("code", {}, "transacoes"), ".");
  tabela("tabela-posicoes", [
    { rotulo: "Ativo", valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Qtd", num: true, valor: (l) => fmtNum(l.quantidade, l.mercado === "CRIPTO" ? 6 : 0) },
    { rotulo: "Preço médio", num: true, valor: (l) => fmtMoeda(l.preco_medio, l.moeda) },
    { rotulo: "Atual", num: true, valor: (l) => fmtMoeda(l.preco_atual, l.moeda) },
    { rotulo: "Valor (R$)", num: true, valor: (l) => fmtBRL.format(l.valor_brl) },
    { rotulo: "Peso", num: true, valor: (l) => `${fmtNum(l.peso_pct, 1)}%` },
    { rotulo: "Resultado", num: true, valor: (l) => fmtBRL.format(l.resultado_brl), classe: (l) => cor(l.resultado_brl) },
    { rotulo: "%", num: true, valor: (l) => fmtPct(l.resultado_pct), classe: (l) => cor(l.resultado_pct) },
    { rotulo: "Mês", num: true, valor: (l) => fmtPct(l.var_mes_pct), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => fmtPct(l.var_ano_pct), classe: (l) => cor(l.var_ano_pct) },
  ], c.posicoes, (l) => selecionar(l.ticker), vazio);

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", CAIXA: "Caixa" };
  const total = Object.values(c.alocacao_brl).reduce((s, v) => s + v, 0) || 1;
  document.getElementById("alocacao").replaceChildren(...Object.entries(c.alocacao_brl).map(([k, v]) =>
    el("span", {}, `${nomes[k] ?? k} `, el("b", {}, `${fmtNum((v / total) * 100, 1)}%`))));

  const alvo = document.getElementById("grafico-patrimonio");
  if (c.historico.length > 1) {
    const g = LWC.createChart(alvo, { ...opcoesBase(), localization: { locale: "pt-BR", priceFormatter: (p) => fmtBRL.format(p) } });
    const s = g.addSeries(LWC.BaselineSeries, {
      baseValue: { type: "price", price: c.capital_inicial },
      topLineColor: css("--alta"), topFillColor1: "rgba(38,194,129,0.25)", topFillColor2: "rgba(38,194,129,0.02)",
      bottomLineColor: css("--baixa"), bottomFillColor1: "rgba(240,80,110,0.02)", bottomFillColor2: "rgba(240,80,110,0.25)",
      lineWidth: 2, priceLineVisible: false,
    });
    s.setData(c.historico);
    g.timeScale().applyOptions({ fixLeftEdge: true, fixRightEdge: true });
    requestAnimationFrame(() => g.timeScale().fitContent());
  }
}

function renderRadar() {
  const ativos = estado.resumo.ativos.filter((a) => !estado.filtroMercado || a.mercado === estado.filtroMercado);
  tabela("tabela-radar", [
    { rotulo: "Ativo", valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Último", num: true, valor: (l) => fmtMoeda(l.ultimo, l.moeda) },
    { rotulo: "Dia", num: true, valor: (l) => fmtPct(l.var_dia_pct), classe: (l) => cor(l.var_dia_pct) },
    { rotulo: "Mês", num: true, valor: (l) => fmtPct(l.var_mes_pct), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => fmtPct(l.var_ano_pct), classe: (l) => cor(l.var_ano_pct) },
    { rotulo: "IFR D", num: true, valor: (l) => fmtNum(l.ifr_diario, 0), classe: (l) => (l.ifr_diario < 30 ? "alta" : l.ifr_diario > 70 ? "baixa" : "") },
    { rotulo: "IFR S", num: true, valor: (l) => fmtNum(l.ifr_semanal, 0), classe: (l) => (l.ifr_semanal < 30 ? "alta" : l.ifr_semanal > 70 ? "baixa" : "") },
    { rotulo: "Da máx. 52s", num: true, valor: (l) => fmtPct(l.dist_max52), classe: (l) => cor(l.dist_max52) },
    { rotulo: "Vol. fin. 20d", num: true, valor: (l) => fmtCompacto(l.volume_financeiro_20d) },
    { rotulo: "Score", num: true, valor: (l) => (l.liquido ? String(l.score) : "baixa liq.") },
  ], ativos, (l) => selecionar(l.ticker), "Nenhum ativo.");
}

// ------------------------------------------------------------- init

function ligarSegmento(id, aoMudar) {
  const grupo = document.getElementById(id);
  grupo.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    grupo.querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x === b));
    aoMudar(b.dataset);
  });
}

async function iniciar() {
  let resumo;
  try {
    const r = await fetch("data/resumo.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    resumo = await r.json();
  } catch (e) {
    document.querySelector("main").replaceChildren(el("div", { class: "painel vazio" },
      "Não encontrei data/resumo.json. Rode ", el("code", {}, "python scripts/atualizar_dados.py"),
      " e sirva a pasta com ", el("code", {}, "python -m http.server"), "."));
    return;
  }
  estado.resumo = resumo;

  document.getElementById("usdbrl").textContent = fmtNum(resumo.usdbrl, 4);
  document.getElementById("atualizado").textContent =
    new Date(resumo.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  renderKPIs(resumo.carteira);
  renderOportunidades(resumo.ativos);
  renderPosicoes(resumo.carteira);
  renderRadar();

  const sel = document.getElementById("seletor-ativo");
  sel.replaceChildren(...resumo.ativos
    .slice().sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map((a) => el("option", { value: a.ticker }, `${a.ticker} · ${a.nome}`)));
  sel.addEventListener("change", () => selecionar(sel.value));

  ligarSegmento("seletor-tf", ({ tf }) => { estado.tf = tf; desenharGrafico(); });
  ligarSegmento("filtro-mercado", ({ m }) => { estado.filtroMercado = m; renderRadar(); });

  let salvo = null;
  try { salvo = localStorage.getItem("ticker"); } catch {}
  const inicial = resumo.ativos.find((a) => a.ticker === salvo) ?? resumo.carteira.posicoes[0] ?? resumo.ativos[0];
  selecionar(inicial.ticker, false);
}

iniciar();
