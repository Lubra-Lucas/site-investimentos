/* Painel: a página inicial do terminal. Como está o mercado hoje e por onde começar.
 * Dados: data/radar.json (ativos, sinais), data/ranking.json (Top do dia), data/resultados.json (como andam os
 * sinais), data/setups.json (nomes dos setups) e, no navegador, a Minha lista (eventos.js) e os trades (simulador.js).
 * Cada bloco é independente: se o dado faltar, mostra um estado vazio e o resto da página segue.
 * Os sinais são filtros técnicos automáticos, não recomendação de investimento. */

(() => {
const $ = (id) => document.getElementById(id);
const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto" };
const MERCADOS = ["BR", "US", "CRIPTO"];
/** Setups do grupo "Tendência" são estados (disparam em todo candle de uma tendência): não são pontos de entrada. */
const GRUPO_ESTADO = "Tendência";
const NS = "http://www.w3.org/2000/svg";

/** Faixa de mercado: ticker no universo, nome amigável. */
const FAIXA = [
  ["^BVSP", "Ibovespa"], ["^GSPC", "S&P 500"], ["^NDX", "Nasdaq 100"], ["USDBRL=X", "Dólar"],
  ["GC=F", "Ouro"], ["CL=F", "Petróleo WTI"], ["BTC-USD", "Bitcoin"], ["^VIX", "VIX"],
];

let R, porTicker, HOJE;

/** replaceChildren que ignora null/false. */
const trocar = (alvo, ...filhos) => alvo.replaceChildren(...filhos.flat(Infinity).filter((f) => f != null && f !== false));
const vazio = (txt, ...extra) => el("div", { class: "pn-vazio" }, el("p", {}, txt), ...extra);
const urlAtivo = (tk) => `ativo.html#${encodeURIComponent(tk)}`;
const rot = (a) => a.rotulo ?? semSufixo(a.ticker);
const ehEntrada = (id) => SETUP_POR_ID.get(id)?.grupo !== GRUPO_ESTADO;
const nomeCurto = (id) => nomeSetup(id).replace(/ de (compra|venda)\b/, "");
const pct0 = (v) => `${fmtNum(v, 0)}%`;

/** Ativos líquidos de um mercado. Se o mercado não tiver nenhum marcado como líquido (universo pequeno ou
 *  dados parciais), usa todos, para o bloco não sumir. */
function ativosDo(mercado) {
  const todos = R.ativos.filter((a) => a.mercado === mercado);
  const liquidos = todos.filter((a) => a.liquido !== false);
  return liquidos.length ? liquidos : todos;
}

// ------------------------------------------------------------- sinais de hoje (mesma conta de Início e Oportunidades)

/** Sinais do último pregão fechado de cada mercado, só setups de entrada com lado. */
function calcularHoje() {
  const eventos = (R.sinais ?? []).filter((s) => porTicker.has(s.ticker) && s.setup);
  const { sinais, ultima } = sinaisDoPeriodo({ ativos: R.ativos, sinais: eventos }, "D", 1);
  const entradas = sinais.filter((s) => (s.lado === "compra" || s.lado === "venda") && ehEntrada(s.setup));
  const porAtivo = new Map();
  for (const s of entradas) {
    if (!porAtivo.has(s.ticker)) porAtivo.set(s.ticker, []);
    porAtivo.get(s.ticker).push(s);
  }
  return { entradas, porAtivo, ultima };
}

// ------------------------------------------------------------- cabeçalho

/** Data do pregão: o mais recente de Brasil e EUA (cripto negocia no fim de semana e confundiria). */
function dataPregao() {
  const bolsas = R.ativos.filter((a) => a.mercado === "BR" || a.mercado === "US");
  const base = bolsas.length ? bolsas : R.ativos;
  return base.reduce((m, a) => (a.data > m ? a.data : m), "");
}

function resumoMercado() {
  const partes = [];
  for (const m of ["BR", "US"]) {
    const l = ativosDo(m).filter((a) => a.tend_d);
    if (l.length) partes.push(`${NOMES_MERCADO[m]}: ${pct0(100 * l.filter((a) => a.tend_d === "alta").length / l.length)} dos ativos em alta`);
  }
  const liquidos = new Set(MERCADOS.flatMap((m) => ativosDo(m).map((a) => a.ticker)));
  const conta = (lado) => new Set(HOJE.entradas.filter((s) => s.lado === lado && liquidos.has(s.ticker)).map((s) => s.ticker)).size;
  const c = conta("compra"), v = conta("venda");
  if (c || v) partes.push(`${fmtNum(c, 0)} ativos com sinal de compra e ${fmtNum(v, 0)} de venda`);
  return partes.join(" · ");
}

function renderCabecalho() {
  const d = dataPregao();
  $("pn-data").textContent = d ? `Pregão de ${fmtData(d, true)}/${d.slice(0, 4)}` : "";
  const txt = resumoMercado();
  $("pn-resumo").textContent = txt || "Os dados do mercado ainda não estão disponíveis.";
  trocar($("pn-formacao"), avisoFormacao(R));
}

// ------------------------------------------------------------- faixa de mercado

function sparkline(valores, tendencia) {
  if (valores.length < 2) return null;
  const w = 100, h = 32;
  const min = Math.min(...valores), max = Math.max(...valores), faixa = max - min || 1;
  const pts = valores.map((v, i) => `${(i / (valores.length - 1) * w).toFixed(1)},${(h - 3 - (v - min) / faixa * (h - 6)).toFixed(1)}`);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", `pn-spark ${tendencia >= 0 ? "alta" : "baixa"}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Últimos ${valores.length} fechamentos: ${valores.at(-1) >= valores[0] ? "em alta" : "em queda"}`);
  const area = document.createElementNS(NS, "polygon");
  area.setAttribute("points", `0,${h} ${pts.join(" ")} ${w},${h}`);
  const linha = document.createElementNS(NS, "polyline");
  linha.setAttribute("points", pts.join(" "));
  svg.append(area, linha);
  return svg;
}

function tile([tk, nome]) {
  const a = porTicker.get(tk);
  if (!a) return null;
  const p = precoAtual(a);
  const alvoSpark = el("span", { class: "pn-tile-spark" });
  carregarCandles(a.arquivo ?? a.ticker).then((d) => {
    const s = sparkline(d.candles.slice(-60).map((c) => c.close), p.var_pct ?? 0);
    if (s) alvoSpark.append(s);
  }).catch(() => {});
  return el("a", { class: "pn-tile", href: urlAtivo(tk),
    title: `${a.nome ?? nome}${p.parcial ? " · pregão em andamento" : ""}. Abrir a página do ativo.` },
    el("span", { class: "pn-tile-nome" }, nome),
    el("span", { class: "pn-tile-valor mono" }, tk === "USDBRL=X" ? `R$ ${fmtNum(p.ultimo, 2)}` : fmtMoeda(p.ultimo, a.moeda)),
    el("span", { class: "pn-tile-vars" },
      el("span", { class: `mono ${cor(p.var_pct)}` }, el("small", {}, "dia "), fmtPct(p.var_pct)),
      el("span", { class: `mono ${cor(a.var_mes_pct)}` }, el("small", {}, "mês "), fmtPct(a.var_mes_pct))),
    alvoSpark);
}

function renderFaixa() {
  const tiles = FAIXA.map(tile).filter(Boolean);
  trocar($("pn-tiles"), tiles.length ? tiles : vazio("Os índices e moedas ainda não estão disponíveis."));
}

// ------------------------------------------------------------- termômetro

function barra(partes, rotulo) {
  const total = partes.reduce((s, p) => s + p.n, 0);
  return el("div", { class: "pn-barra", role: "img", "aria-label": `${rotulo}: ${partes.map((p) => `${p.n} ${p.nome}`).join(", ")}` },
    partes.filter((p) => p.n > 0).map((p) => el("span", { class: `pn-seg ${p.cls}`, style: `flex:${p.n} 1 0`, title: `${p.nome}: ${p.n} (${pct0(100 * p.n / total)})` },
      p.n / total >= 0.1 ? pct0(100 * p.n / total) : "")));
}

function linhaTermo(m) {
  const ativos = ativosDo(m);
  if (!ativos.length) return null;
  const tickers = new Set(ativos.map((a) => a.ticker));
  const comTend = ativos.filter((a) => a.tend_d);
  const alta = comTend.filter((a) => a.tend_d === "alta").length;
  const baixa = comTend.filter((a) => a.tend_d === "baixa").length;
  const lateral = comTend.length - alta - baixa;
  const conta = (lado) => new Set(HOJE.entradas.filter((s) => s.lado === lado && tickers.has(s.ticker)).map((s) => s.ticker)).size;
  const compra = conta("compra"), venda = conta("venda");
  const sobrevendidos = ativos.filter((a) => a.ifr_d != null && a.ifr_d < 30).length;
  const sobrecomprados = ativos.filter((a) => a.ifr_d != null && a.ifr_d > 70).length;
  const pAlta = comTend.length ? 100 * alta / comTend.length : null;
  const ref = HOJE.ultima.get(m);

  return el("div", { class: "pn-mercado" },
    el("div", { class: "pn-mercado-cab" },
      el("b", {}, NOMES_MERCADO[m]),
      el("span", { class: "sub" }, `${fmtNum(ativos.length, 0)} ativos${ref ? ` · sinais de ${fmtData(ref)}` : ""}`),
      pAlta != null ? el("span", { class: `pn-mercado-pct mono ${pAlta >= 50 ? "alta" : "baixa"}` }, `${pct0(pAlta)} em alta`) : null),
    comTend.length ? el("div", { class: "pn-linha" },
      el("span", { class: "pn-rot" }, "Tendência"),
      barra([{ n: alta, nome: "em alta", cls: "alta" }, { n: lateral, nome: "laterais", cls: "lateral" }, { n: baixa, nome: "em baixa", cls: "baixa" }], `Tendência no diário em ${NOMES_MERCADO[m]}`),
      el("span", { class: "pn-nums sub" }, `${alta} alta · ${lateral} lateral · ${baixa} baixa`)) : null,
    compra + venda ? el("div", { class: "pn-linha" },
      el("span", { class: "pn-rot" }, "Sinais de hoje"),
      barra([{ n: compra, nome: "com sinal de compra", cls: "alta" }, { n: venda, nome: "com sinal de venda", cls: "baixa" }], `Sinais de hoje em ${NOMES_MERCADO[m]}`),
      el("span", { class: "pn-nums sub" }, `${compra} compra · ${venda} venda`)) : null,
    el("div", { class: "pn-chips" },
      el("span", { class: "pn-chip", title: "IFR (14 períodos, diário) abaixo de 30: o preço caiu forte e rápido" },
        el("b", { class: "mono" }, fmtNum(sobrevendidos, 0)), " sobrevendidos ", el("small", {}, "IFR < 30")),
      el("span", { class: "pn-chip", title: "IFR (14 períodos, diário) acima de 70: o preço subiu forte e rápido" },
        el("b", { class: "mono" }, fmtNum(sobrecomprados, 0)), " sobrecomprados ", el("small", {}, "IFR > 70"))));
}

function renderTermometro() {
  const linhas = MERCADOS.map(linhaTermo).filter(Boolean);
  trocar($("pn-termo"), linhas.length ? linhas : vazio("Ainda não há ativos para medir o mercado."));
}

// ------------------------------------------------------------- Top do dia

function itemTop(x, i) {
  return el("li", { class: "pn-top-item" },
    el("span", { class: "pn-pos" }, String(i + 1)),
    el("div", { class: "pn-top-corpo" },
      el("a", { class: "pn-top-ativo", href: urlAtivo(x.ticker), title: x.nome }, x.rotulo),
      el("span", { class: "pn-top-setup" }, x.setup_nome)),
    el("div", { class: "pn-top-num" },
      el("b", { class: `mono ${cor(x.medio)}` }, fmtPct(x.medio)),
      el("span", { class: "sub" }, `${fmtNum(x.acerto, 0)}% em ${x.casos}`)));
}

async function renderTop() {
  let D;
  try { D = await buscarJSON("data/ranking.json"); } catch { D = null; }
  const alvo = $("pn-top");
  if (!D || !(D.compra?.geral?.length || D.venda?.geral?.length)) {
    trocar(alvo, vazio("Hoje nenhum sinal passou nos critérios do ranking.", el("a", { class: "botao", href: "setups.html" }, "Ver oportunidades")));
    return;
  }
  if (D.data) $("pn-top-sub").textContent = `Sinais de ${fmtData(D.data)} com melhor histórico de acerto.`;
  const coluna = (titulo, cls, itens) => el("div", { class: "pn-top-col" },
    el("h3", { class: cls }, titulo),
    itens.length ? el("ol", { class: "pn-top-lista" }, itens.slice(0, 5).map(itemTop)) : el("p", { class: "sub pn-pouco" }, "Nenhum sinal passou nos critérios."));
  trocar(alvo, el("div", { class: "pn-top-cols" },
    coluna("▲ Compra", "alta", D.compra?.geral ?? []),
    coluna("▼ Venda", "baixa", D.venda?.geral ?? [])));
}

// ------------------------------------------------------------- mapa de calor

const DEGRAUS = {  // limites (em %) dos degraus 1, 2 e 3 de cada período; abaixo do 1 é neutro
  dia: [0.25, 1, 2.5], mes: [1, 4, 10], ano: [5, 20, 50],
};
const CAMPO = { dia: (a) => precoAtual(a).var_pct, mes: (a) => a.var_mes_pct, ano: (a) => a.var_ano_pct };
const NOME_PERIODO = { dia: "no dia", mes: "no mês", ano: "no ano" };
let periodo = "dia";

function degrau(v, lim) {
  if (v == null) return "n";
  const a = Math.abs(v);
  const n = a < lim[0] ? 0 : a < lim[1] ? 1 : a < lim[2] ? 2 : 3;
  return n === 0 ? "0" : `${v > 0 ? "a" : "b"}${n}`;
}

function celula(a, v, lim) {
  const p = precoAtual(a);
  const tit = `${a.nome ?? rot(a)} (${rot(a)})\n${fmtMoeda(p.ultimo, a.moeda)}\n${NOME_PERIODO[periodo][0].toUpperCase()}${NOME_PERIODO[periodo].slice(1)}: ${fmtPct(v)}`;
  return el("a", { class: `pn-cel g-${degrau(v, lim)}`, href: urlAtivo(a.ticker), title: tit, "aria-label": `${rot(a)}, ${fmtPct(v)} ${NOME_PERIODO[periodo]}` },
    el("b", {}, rot(a)),
    el("small", { class: "mono" }, v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, Math.abs(v) >= 10 ? 0 : 1)}%`));
}

function renderMapa() {
  document.querySelectorAll("#pn-mapa-periodo button").forEach((b) => { b.classList.toggle("ativo", b.dataset.v === periodo); estadoAria(b); });
  const campo = CAMPO[periodo], lim = DEGRAUS[periodo];
  const grupos = MERCADOS.map((m) => {
    const itens = ativosDo(m).map((a) => ({ a, v: campo(a) })).sort((x, y) => (y.v ?? -1e9) - (x.v ?? -1e9));
    return { m, itens };
  }).filter((g) => g.itens.length);
  if (!grupos.length) { trocar($("pn-mapa"), vazio("Ainda não há ativos para mostrar.")); $("pn-mapa-sub").textContent = ""; return; }
  const total = grupos.reduce((s, g) => s + g.itens.length, 0);
  $("pn-mapa-sub").textContent = `${fmtNum(total, 0)} ativos líquidos, do que mais subiu ao que mais caiu em cada mercado. Variação ${NOME_PERIODO[periodo]}.`;
  trocar($("pn-mapa"), grupos.map(({ m, itens }) => {
    const vals = itens.map((x) => x.v).filter((v) => v != null).sort((x, y) => x - y);
    const mediana = vals.length ? vals[Math.floor(vals.length / 2)] : null;
    const sobem = vals.filter((v) => v > 0).length;
    return el("div", { class: "pn-grupo" },
      el("div", { class: "pn-grupo-cab" },
        el("b", {}, NOMES_MERCADO[m]),
        el("span", { class: "sub" }, `${fmtNum(itens.length, 0)} ativos · ${sobem} em alta · ${vals.length - sobem} em queda · mediana `,
          el("span", { class: `mono ${cor(mediana)}` }, fmtPct(mediana)))),
      el("div", { class: "pn-celulas" }, itens.map(({ a, v }) => celula(a, v, lim))));
  }));
  const f = (n) => fmtNum(n, n % 1 ? 2 : 0);
  const rotulos = [`−${f(lim[2])}%`, `−${f(lim[1])}%`, `−${f(lim[0])}%`, "0", `+${f(lim[0])}%`, `+${f(lim[1])}%`, `+${f(lim[2])}%`];
  trocar($("pn-legenda"), el("span", { class: "sub" }, "Menos"),
    ["b3", "b2", "b1", "0", "a1", "a2", "a3"].map((g, i) => el("span", { class: `pn-leg g-${g}` }, rotulos[i])),
    el("span", { class: "sub" }, "Mais"));
}

// ------------------------------------------------------------- minha lista

function renderLista() {
  const alvo = $("pn-lista");
  const itens = MinhaLista.ler().map((t) => acharAtivo(R.ativos, t)).filter(Boolean).map((tk) => porTicker.get(tk));
  if (!itens.length) {
    $("pn-lista-sub").textContent = "Os ativos que você acompanha.";
    trocar(alvo, vazio("Sua lista está vazia. Adicione ativos à sua lista para ver preço e setups de hoje aqui.",
      el("a", { class: "botao primario", href: "carteira.html" }, "Adicionar ativos")));
    return;
  }
  $("pn-lista-sub").textContent = `${itens.length} ${itens.length === 1 ? "ativo" : "ativos"} · último preço e setups de hoje.`;
  const MAX = 7;
  trocar(alvo, el("ul", { class: "pn-lista" }, itens.slice(0, MAX).map((a) => {
    const evs = HOJE.porAtivo.get(a.ticker) ?? [];
    const setups = [...new Map(evs.map((e) => [e.setup, e])).values()];
    const p = precoAtual(a);
    return el("li", { class: "pn-lista-item" },
      el("a", { class: "pn-lista-ativo", href: urlAtivo(a.ticker), title: a.nome }, el("b", {}, rot(a)), el("span", { class: "sub" }, a.nome)),
      el("div", { class: "pn-lista-preco" }, el("span", { class: "mono" }, fmtMoeda(p.ultimo, a.moeda)), el("span", { class: `mono ${cor(p.var_pct)}` }, fmtPct(p.var_pct))),
      el("div", { class: "pn-lista-setups" }, setups.length
        ? [setups.slice(0, 2).map((e) => el("a", { class: `chip setup vies-${e.lado}`, href: `setups.html?setup=${encodeURIComponent(e.setup)}#${encodeURIComponent(a.ticker)}`,
            title: `${nomeSetup(e.setup)} (${e.lado})` }, `${e.lado === "compra" ? "▲" : "▼"} ${nomeCurto(e.setup)}`)),
          setups.length > 2 ? el("span", { class: "chip ctx", title: setups.slice(2).map((e) => nomeSetup(e.setup)).join(", ") }, `+${setups.length - 2}`) : null]
        : el("span", { class: "sub" }, "Sem setups hoje")));
  })), itens.length > MAX ? el("p", { class: "sub pn-mais" }, el("a", { href: "carteira.html" }, `Ver os outros ${itens.length - MAX} na Carteira →`)) : null);
}

// ------------------------------------------------------------- trades em aberto

const fmtRTxt = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, 1)}R`);

async function renderTrades() {
  const alvo = $("pn-trades"), sub = $("pn-trades-sub");
  let trades = [];
  try { trades = (Simulacoes.todas() ?? []).filter((t) => !t.arquivado && porTicker.has(t.ticker)); } catch { /* sem trades */ }
  const convite = () => {
    sub.textContent = "Simulações de entrada, stop e alvo.";
    trocar(alvo, vazio("Você ainda não tem trades. Simule o primeiro: escolha uma oportunidade, marque entrada, stop e alvo e acompanhe o resultado em R.",
      el("a", { class: "botao primario", href: "setups.html" }, "Simular meu primeiro trade")));
  };
  if (!trades.length) return convite();
  const avaliados = (await Promise.all(trades.map(async (t) => {
    try {
      const a = porTicker.get(t.ticker);
      const d = await carregarCandles(a.arquivo ?? a.ticker);
      return { t, a, av: avaliarSimulacao(t, d.candles) };
    } catch { return null; }
  }))).filter(Boolean);
  const abertos = avaliados.filter(({ av }) => av.estado === "aberta");
  const aguardando = avaliados.filter(({ av }) => av.estado === "aguardando");
  if (!abertos.length && !aguardando.length) {
    sub.textContent = avaliados.length ? "Nenhum trade em aberto agora." : "";
    trocar(alvo, vazio("Nenhum trade em aberto agora. Que tal simular o próximo?", el("a", { class: "botao primario", href: "setups.html" }, "Ver oportunidades")));
    return;
  }
  sub.textContent = `${abertos.length} em aberto${aguardando.length ? ` · ${aguardando.length} aguardando entrada` : ""}`;
  const linha = ({ t, a, av }) => el("li", { class: "pn-trade" },
    el("a", { class: "pn-trade-ativo", href: urlAtivo(a.ticker) }, el("b", {}, rot(a))),
    el("span", { class: `pilula ${t.lado === "venda" ? "baixa" : "alta"}` }, t.lado === "venda" ? "▼ Venda" : "▲ Compra"),
    el("span", { class: "sub pn-trade-quando" }, av.entrou ? `desde ${fmtData(av.entrou)}` : "aguardando entrada"),
    el("b", { class: `pn-trade-r mono ${av.resultado_r == null ? "" : cor(av.resultado_r)}`, title: "Resultado atual em R (stop = −1R)" }, fmtRTxt(av.resultado_r)));
  trocar(alvo, el("ul", { class: "pn-trades" }, [...abertos, ...aguardando].slice(0, 8).map(linha)));
}

// ------------------------------------------------------------- como andam os sinais

async function renderSinais() {
  const alvo = $("pn-sinais"), sub = $("pn-sinais-sub");
  let D;
  try { D = await buscarJSON("data/resultados.json"); } catch { D = null; }
  const t = D?.resumo?.TODOS;
  if (!t?.n) {
    trocar(alvo, vazio("Ainda não há sinais encerrados para resumir."));
    return;
  }
  sub.textContent = `Sinais de entrada dos últimos ${D.pregoes ?? 60} pregões que já terminaram (${D.prazo ?? 10} pregões após a entrada).`;
  const kpi = (rotulo, valor, cls, nota) => el("div", { class: "pn-kpi" },
    el("span", { class: "sub" }, rotulo), el("b", { class: `mono ${cls ?? ""}` }, valor), nota ? el("span", { class: "sub" }, nota) : null);
  trocar(alvo,
    el("div", { class: "pn-kpis" },
      kpi("Terminaram no lucro", pct0(t.acerto), "", `${fmtNum(t.n, 0)} sinais`),
      kpi("Retorno médio", fmtPct(t.medio), cor(t.medio), "por sinal"),
      kpi("Pior e melhor", `${fmtNum(t.pior, 0)}% / +${fmtNum(t.melhor, 0)}%`, "", "extremos")),
    el("p", { class: "pn-aviso", role: "note" }, el("b", {}, "Resultado passado não garante futuro. "), "Sem custos e impostos; os sinais são filtros técnicos, não recomendação."));
}

// ------------------------------------------------------------- início

/** Cada bloco falha sozinho: um erro vira estado vazio e o resto da página segue. */
const seguro = (bloco, alvo) => (...args) => Promise.resolve().then(() => bloco(...args)).catch((e) => {
  console.error(e);
  trocar($(alvo), vazio("Não consegui montar este bloco agora."));
});

async function iniciar() {
  aguardarPagina();
  try { [R] = await Promise.all([carregarRadar(), carregarCatalogoSetups().catch(() => null)]); }
  catch (e) { montarTopo("painel"); paginaPronta(); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("painel", R);
  HOJE = calcularHoje();

  segmento("pn-mapa-periodo", ({ v }) => { periodo = v; renderMapa(); });
  for (const [f, alvo] of [[renderCabecalho, "pn-resumo"], [renderFaixa, "pn-tiles"], [renderTermometro, "pn-termo"], [renderMapa, "pn-mapa"], [renderLista, "pn-lista"]]) {
    try { f(); } catch (e) { console.error(e); trocar($(alvo), vazio("Não consegui montar este bloco agora.")); }
  }
  const assinc = [
    seguro(renderTop, "pn-top")(), seguro(renderSinais, "pn-sinais")(), seguro(renderTrades, "pn-trades")(),
  ];
  // espera um pouco pelos blocos que leem arquivos, para a página não pular, mas sem segurar o resto
  await Promise.race([Promise.all(assinc), new Promise((ok) => setTimeout(ok, 1500))]);
  paginaPronta();
  for (const ev of ["simulacoes", "diario"]) document.addEventListener(ev, seguro(renderTrades, "pn-trades"));
  addEventListener("storage", (e) => {
    if (e.key === "simulacoes-v1") seguro(renderTrades, "pn-trades")();
    if (e.key === MinhaLista.chave) renderLista();
  });
  addEventListener("pageshow", (e) => { if (e.persisted) { renderLista(); seguro(renderTrades, "pn-trades")(); } });
}

iniciar();
})();
