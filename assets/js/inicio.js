/* Início (index.html): a página de apresentação do terminal. O texto fixo (hero, perfis de investidor, 3 passos,
 * perguntas) está no HTML; aqui entram só as partes com dados: o número de ativos no topo, a vitrine ao vivo
 * dos ativos com mais setups hoje e, para quem já tem trades, a faixa "Seus trades". Dados: data/radar.json
 * (sinais: {ticker, setup, tf, data, lado, preco, bt}) e data/setups.json (nomes); trades: Diario
 * (diario-dados.js), se existir, senão Simulacoes (simulador.js). */

const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
/** Setups do grupo "Tendência" são estados (disparam em todo candle de uma tendência): não são pontos de entrada. */
const GRUPO_ESTADO = "Tendência";
const MAX_ATIVOS = 6;

const pref = Object.assign({ mercado: "", lado: "compra" }, guardar.ler("inicio-v1", {}));
const salvarPref = () => guardar.gravar("inicio-v1", pref);
const $ = (id) => document.getElementById(id);
let R, porTicker, HOJE;

// ------------------------------------------------------------- topo

/** replaceChildren que ignora null/false: passar null direto vira o texto "null" na página. */
const trocar = (alvo, ...filhos) => alvo.replaceChildren(...filhos.flat(Infinity).filter((f) => f != null && f !== false));

/** Os números do topo: quantos ativos e mercados o terminal acompanha de verdade. */
function renderIntro() {
  const mercados = new Set(R.ativos.map((a) => a.mercado)).size;
  $("hero-selo").textContent = `Terminal de estudo · ${fmtNum(R.ativos.length, 0)} ativos · ${mercados} mercados · atualizado a cada pregão`;
}

// ------------------------------------------------------------- oportunidades de hoje

/** Sinais do último pregão fechado de cada mercado (a mesma conta de Setups e da Triagem). */
function calcularHoje() {
  const eventos = (R.sinais ?? []).filter((s) => porTicker.has(s.ticker) && s.setup);
  const { sinais, ultima } = sinaisDoPeriodo({ ativos: R.ativos, sinais: eventos }, "D", 1);
  const porMercado = new Map();
  for (const m of ultima.keys()) porMercado.set(m, { data: ultima.get(m), compra: { sinais: 0, ativos: new Set() }, venda: { sinais: 0, ativos: new Set() } });
  for (const s of sinais) {
    const m = porMercado.get(porTicker.get(s.ticker).mercado);
    if (!m || !m[s.lado]) continue;  // setups sem lado (Bollinger comprimida) não entram na conta de compra/venda
    m[s.lado].sinais++;
    m[s.lado].ativos.add(s.ticker);
  }
  return { sinais, ultima, porMercado };
}

const ehEntrada = (id) => SETUP_POR_ID.get(id)?.grupo !== GRUPO_ESTADO;

/** Setups de entrada de hoje e os ativos com mais deles, no filtro de mercado e lado escolhido. */
function destaquesDe(mercado, lado) {
  const doFiltro = HOJE.sinais.filter((s) => s.lado === lado && ehEntrada(s.setup) && (!mercado || porTicker.get(s.ticker).mercado === mercado));
  const porSetup = new Map(), porAtivo = new Map();
  for (const s of doFiltro) {
    if (!porSetup.has(s.setup)) porSetup.set(s.setup, new Set());
    porSetup.get(s.setup).add(s.ticker);
    if (!porAtivo.has(s.ticker)) porAtivo.set(s.ticker, []);
    porAtivo.get(s.ticker).push(s);
  }
  const setups = [...porSetup].map(([id, tks]) => ({ id, n: tks.size })).sort((a, b) => b.n - a.n || nomeSetup(a.id).localeCompare(nomeSetup(b.id)));
  const ativos = [...porAtivo].map(([tk, evs]) => ({ tk, a: porTicker.get(tk), evs, n: new Set(evs.map((e) => e.setup)).size }))
    .filter((x) => x.a.liquido !== false)
    .sort((x, y) => y.n - x.n || (y.a.volume_financeiro_20d ?? 0) - (x.a.volume_financeiro_20d ?? 0) || x.tk.localeCompare(y.tk));
  return { setups, ativos };
}

const nomeCurtoSetup = (id) => nomeSetup(id).replace(/ de (compra|venda)\b/, "");

function sparkline(candles, classe) {
  const c = candles.slice(-40).map((x) => x.close);
  if (c.length < 2) return null;
  const min = Math.min(...c), max = Math.max(...c), w = 96, h = 30;
  const pts = c.map((v, i) => `${((i / (c.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", `spark ${c.at(-1) >= c[0] ? "alta" : "baixa"}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Últimos ${c.length} fechamentos: ${c.at(-1) >= c[0] ? "em alta" : "em queda"}`);
  const linha = document.createElementNS(ns, "polyline");
  linha.setAttribute("points", pts);
  svg.append(linha);
  return svg;
}

function cartaoAtivo({ tk, a, evs, n }, lado) {
  const rot = semSufixo(tk);
  const ids = [...new Set(evs.map((e) => e.setup))];
  const principal = evs.slice().sort((x, y) => (SETUP_POR_ID.get(y.setup)?.bt?.D?.vantagem ?? -1e9) - (SETUP_POR_ID.get(x.setup)?.bt?.D?.vantagem ?? -1e9))[0];
  const alvoSpark = el("span", { class: "ia-spark" });
  carregarCandles(a.arquivo).then((d) => { const s = sparkline(d.candles, lado); if (s) alvoSpark.append(s); }).catch(() => {});
  const url = `ativo.html#${encodeURIComponent(tk)}`;
  return el("li", { class: `inicio-ativo lado-${lado}`, "data-tk": tk },
    el("div", { class: "ia-topo" },
      el("a", { class: "ia-nome", href: url, title: `Abrir a página de ${rot}` }, el("b", { class: "mono" }, rot), el("span", { class: "cartao-nome" }, a.nome)),
      alvoSpark),
    precoComFormacao(a, "ia-preco"),
    el("div", { class: "chips" },
      n >= 2 ? el("span", { class: "chip destaque" }, `${n} setups`) : null,
      ids.slice(0, 3).map((id) => el("a", { class: `chip setup vies-${lado}`, href: `setups.html?setup=${encodeURIComponent(id)}#${encodeURIComponent(tk)}`,
        title: `${nomeSetup(id)}: ${SETUP_POR_ID.get(id)?.desc ?? ""}` }, nomeCurtoSetup(id))),
      ids.length > 3 ? el("span", { class: "chip ctx" }, `+${ids.length - 3}`) : null),
    el("div", { class: "ia-acoes" },
      el("a", { class: "botao", href: url, "aria-label": `Ver o gráfico de ${rot}` }, "Ver gráfico"),
      el("button", { type: "button", class: "botao primario", "data-simular": tk, "aria-label": `Simular trade de ${lado} em ${rot}`,
        title: `Simular uma ${lado} em ${rot}: entrada, stop e alvo`,
        onclick: () => simularTrade({ ticker: tk, lado, setup: principal?.setup, tf: "D", data: principal?.data ?? a.data,
          preco: principal?.preco ?? a.ultimo, origem: "setups" }) }, "⊕ Simular trade")));
}

function renderHoje() {
  const alvo = $("ao-vivo");
  const mercados = ["BR", "US", "CRIPTO", "MACRO"].filter((m) => HOJE.porMercado.has(m));
  if (pref.mercado && !mercados.includes(pref.mercado)) pref.mercado = "";
  // a contagem usa a mesma conta da lista (setups de entrada, ativos líquidos) e segue o filtro de mercado
  const contagem = (lado) => destaquesDe(pref.mercado, lado).ativos.length;

  const filtroMercado = [["", "Todos"], ...mercados.map((m) => [m, NOMES_MERCADO[m]])];
  const segmentoDe = (rotulo, itens, atual, aoEscolher) => el("div", { class: "segmento", role: "group", "aria-label": rotulo },
    itens.map(([v, t]) => el("button", { type: "button", class: v === atual ? "ativo" : null, "aria-pressed": String(v === atual),
      onclick: () => aoEscolher(v) }, t)));

  const lado = pref.lado;
  const { ativos } = destaquesDe(pref.mercado, lado);
  const total = contagem(lado);

  trocar(alvo,
    el("div", { class: "secao-cab" },
      el("h2", { id: "hoje-titulo" }, "Veja ao vivo: os ativos com mais setups apontando hoje"),
      el("p", { class: "secao-lead" }, "Dados reais do último pregão fechado de cada mercado. Quando vários setups apontam para o mesmo ativo, ele sobe na lista. Clique em “Simular trade” para testar um deles agora, sem risco.")),
    avisoFormacao(R),
    el("div", { class: "hoje-filtros" },
      segmentoDe("Mercado", filtroMercado, pref.mercado, (v) => { pref.mercado = v; salvarPref(); renderHoje(); }),
      segmentoDe("Lado", [["compra", `▲ Compra (${fmtNum(contagem("compra"), 0)})`], ["venda", `▼ Venda (${fmtNum(contagem("venda"), 0)})`]], pref.lado,
        (v) => { pref.lado = v; salvarPref(); renderHoje(); })),
    ativos.length ? el("ul", { class: "inicio-ativos", "aria-label": `Ativos com mais setups de ${lado}` }, ativos.slice(0, MAX_ATIVOS).map((x) => cartaoAtivo(x, lado)))
      : el("p", { class: "vazio" }, `Nenhum ativo com setup de ${lado} neste mercado no último pregão.`),
    el("p", { class: "ao-vivo-rodape" },
      total > MAX_ATIVOS ? el("span", { class: "sub" }, `Mostrando ${MAX_ATIVOS} de ${fmtNum(total, 0)} ativos.`) : null,
      el("a", { class: "botao primario botao-grande", href: "setups.html" }, "Ver todas as oportunidades →")));
}

// ------------------------------------------------------------- meus trades


/** Lê os trades: do Diário, se ele existe; senão das simulações salvas, avaliadas aqui com os candles. */
async function lerTrades() {
  const D = await carregarDiario();
  const trades = (D?.trades ? D.trades() : Simulacoes.todas()) ?? [];
  const avaliar = D?.avaliar ? (t) => D.avaliar(t)
    : async (t) => { const a = porTicker.get(t.ticker); return avaliarSimulacao(t, (await carregarCandles(a.arquivo)).candles); };
  const itens = await Promise.all(trades.filter((t) => porTicker.has(t.ticker)).map(async (t) => {
    try { return { t, av: await avaliar(t) }; } catch { return null; }
  }));
  return { itens: itens.filter(Boolean), diario: !!D };
}

const fmtRTxt = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, 1)}R`);

/** Faixa discreta para quem já tem trades; para visitantes novos fica escondida. */
async function renderTrades() {
  const alvo = $("inicio-trades");
  let dados;
  try { dados = await lerTrades(); } catch (e) { console.error(e); alvo.hidden = true; return; }
  const { itens } = dados;
  const ativos = itens.filter(({ t }) => !t.arquivado);
  if (!ativos.length) { trocar(alvo); alvo.hidden = true; return; }

  const mes = new Date().toISOString().slice(0, 7);
  const abertos = ativos.filter(({ av }) => av.estado === "aberta");
  const aguardando = ativos.filter(({ av }) => av.estado === "aguardando");
  const doMes = itens.filter(({ av }) => av.saiu && av.saiu.slice(0, 7) === mes && av.resultado_r != null);
  const rMes = doMes.reduce((s, { av }) => s + (av.resultado_r ?? 0), 0);

  trocar(alvo,
    el("a", { class: "faixa-link", href: "diario.html" },
      el("b", {}, "Seus trades"),
      el("span", { "data-k": "abertos" }, `${abertos.length} em aberto`),
      aguardando.length ? el("span", {}, `${aguardando.length} aguardando entrada`) : null,
      el("span", {}, "R do mês ", el("b", { class: `mono ${doMes.length ? cor(rMes) : ""}`, "data-k": "r-mes" }, doMes.length ? fmtRTxt(rMes) : "—")),
      el("span", { class: "faixa-ir" }, "Abrir o Diário →")));
  alvo.hidden = false;
}

// ------------------------------------------------------------- início

async function iniciar() {
  aguardarPagina();
  try { [R] = await Promise.all([carregarRadar(), carregarCatalogoSetups().catch(() => null)]); } catch (e) { montarTopo("inicio"); paginaPronta(); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("inicio", R);
  HOJE = calcularHoje();
  renderIntro();
  renderHoje();
  // os trades leem candles: espera um pouco por eles para a página não pular, mas não segura o resto
  await Promise.race([renderTrades(), new Promise((ok) => setTimeout(ok, 1500))]);
  paginaPronta();
  // simular ou excluir um trade (em outra aba ou no Diário) atualiza o painel
  for (const ev of ["simulacoes", "diario"]) document.addEventListener(ev, renderTrades);
  addEventListener("storage", (e) => { if (e.key === "simulacoes-v1") renderTrades(); });
  // voltar à página pelo "voltar" do navegador mostra os trades atuais
  addEventListener("pageshow", (e) => { if (e.persisted) renderTrades(); });
}

iniciar();
