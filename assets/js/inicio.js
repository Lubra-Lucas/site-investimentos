/* Início (index.html): a porta de entrada do terminal. Para quem chega, o que ele faz e os 3 etapas
 * (encontrar → simular → registrar); para quem volta todo dia, as oportunidades de hoje e o andamento
 * dos seus trades. Dados: data/radar.json (sinais: {ticker, setup, tf, data, lado, preco, bt}) e
 * data/setups.json (nomes); trades: Diario (diario-dados.js), se existir, senão Simulacoes (simulador.js). */

const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
/** Setups do grupo "Tendência" são estados (disparam em todo candle de uma tendência): não são pontos de entrada. */
const GRUPO_ESTADO = "Tendência";
const MAX_ATIVOS = 6, MAX_CHIPS = 8, MAX_ABERTOS = 5;

const pref = Object.assign({ mercado: "", lado: "compra" }, guardar.ler("inicio-v1", {}));
const salvarPref = () => guardar.gravar("inicio-v1", pref);
const $ = (id) => document.getElementById(id);
let R, porTicker, HOJE;

// ------------------------------------------------------------- o que é + 3 etapas

function renderIntro() {
  const alvo = $("inicio-intro");
  const jaSimulou = (() => { try { return Simulacoes.todas().length > 0; } catch { return false; } })();
  // quem nunca escolheu vê tudo; quem já simulou algum trade começa com os etapas recolhidos
  const salvo = guardar.ler("inicio-intro-v1", null);
  let recolhido = salvo ? salvo === "recolhido" : jaSimulou;

  const etapas = [
    { n: 1, titulo: "Encontre uma oportunidade", href: "setups.html", cta: "Abrir as Oportunidades",
      texto: "Todo dia, depois do fechamento, o terminal mostra quais ativos formaram um setup: um padrão técnico que costuma marcar um bom momento de compra ou de venda." },
    { n: 2, titulo: "Simule o trade", href: "#hoje", cta: "Escolher um ativo",
      texto: "Defina a entrada, o stop (onde você admite que errou) e o alvo, direto no gráfico. O resultado sai em R: parar no stop é −1R; chegar a um alvo com o dobro da distância é +2R." },
    { n: 3, titulo: "Registre e aprenda no Diário", href: "diario.html", cta: "Abrir o Diário",
      texto: "Cada trade fica guardado com a sua tese, a foto do gráfico e o resultado em R. Com o tempo você vê quais estratégias funcionam para você." },
  ];

  const alternar = (abrir) => {
    recolhido = !abrir;
    guardar.gravar("inicio-intro-v1", recolhido ? "recolhido" : "aberto");
    desenhar();
    $(abrir ? "intro-recolher" : "intro-abrir")?.focus();
  };

  function desenhar() {
    if (recolhido) {
      alvo.className = "inicio-intro recolhido";
      alvo.replaceChildren(
        el("h1", { id: "inicio-titulo", class: "so-leitor" }, "Início"),
        el("nav", { class: "intro-mini", "aria-label": "O ciclo do terminal" },
          el("span", { class: "intro-mini-rot" }, "Como funciona:"),
          etapas.map((p) => el("a", { href: p.href, class: "intro-mini-etapa" }, el("b", {}, `${p.n}`), ` ${p.titulo.replace(" no Diário", "").replace(" uma oportunidade", "")}`)),
          el("button", { type: "button", id: "intro-abrir", class: "botao", "aria-expanded": "false", "aria-controls": "intro-corpo",
            onclick: () => alternar(true) }, "Como funciona ▾")));
      return;
    }
    alvo.className = "inicio-intro";
    alvo.replaceChildren(
      el("div", { class: "intro-texto", id: "intro-corpo" },
        el("h1", { id: "inicio-titulo" }, "Ache o bom momento, simule o trade e aprenda com o seu registro"),
        el("p", { class: "intro-lead" },
          `O Carteira Terminal acompanha ${R.ativos.length} ativos (B3, EUA, cripto e macro) e, depois de cada fechamento, mostra os que acabaram de formar um `,
          el("b", {}, "setup"), ", um padrão técnico de entrada. Você simula o trade no gráfico e o Diário guarda tudo para você montar o seu histórico e testar as suas estratégias."),
        el("button", { type: "button", id: "intro-recolher", class: "botao intro-recolher", "aria-expanded": "true", "aria-controls": "intro-corpo",
          title: "Esconde os etapas; o botão Como funciona os traz de volta", onclick: () => alternar(false) }, "Entendi, recolher ▴")),
      el("ol", { class: "etapas" }, etapas.map((p) => el("li", { class: "etapa" },
        el("a", { href: p.href, class: "etapa-link" },
          el("span", { class: "etapa-num", "aria-hidden": "true" }, String(p.n)),
          el("b", { class: "etapa-titulo" }, p.titulo),
          el("span", { class: "etapa-texto" }, p.texto),
          el("span", { class: "etapa-cta" }, `${p.cta} →`))))));
  }
  desenhar();
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
  const alvo = $("hoje");
  const mercados = ["BR", "US", "CRIPTO", "MACRO"].filter((m) => HOJE.porMercado.has(m));
  const soma = (lado) => mercados.reduce((t, m) => t + HOJE.porMercado.get(m)[lado].ativos.size, 0);

  const tile = (m) => {
    const x = HOJE.porMercado.get(m);
    const celula = (lado) => el("div", { class: `hoje-lado ${lado}`,
      title: `${fmtNum(x[lado].sinais, 0)} sinais de ${lado} (um ativo pode ter vários setups)` },
    el("span", { class: "hoje-seta", "aria-hidden": "true" }, lado === "compra" ? "▲" : "▼"),
    el("b", { class: "mono hoje-n", "data-n": `${m}-${lado}` }, fmtNum(x[lado].ativos.size, 0)),
    el("span", { class: "hoje-rot" }, lado === "compra" ? "compra" : "venda"));
    return el("li", { class: "hoje-mercado", "data-mercado": m },
      el("div", { class: "hoje-mercado-topo" }, el("b", {}, NOMES_MERCADO[m]), el("span", { class: "sub" }, `pregão ${fmtData(x.data, true)}`)),
      celula("compra"), celula("venda"));
  };

  const filtroMercado = [["", "Todos"], ...mercados.map((m) => [m, NOMES_MERCADO[m]])];
  if (pref.mercado && !mercados.includes(pref.mercado)) pref.mercado = "";
  const segmentoDe = (rotulo, itens, atual, aoEscolher) => el("div", { class: "segmento", role: "group", "aria-label": rotulo },
    itens.map(([v, t]) => el("button", { type: "button", class: v === atual ? "ativo" : null, "aria-pressed": String(v === atual),
      onclick: () => aoEscolher(v) }, t)));

  const { setups, ativos } = destaquesDe(pref.mercado, pref.lado);
  const lado = pref.lado;

  alvo.replaceChildren(
    el("div", { class: "painel-cab" },
      el("div", {}, el("h2", { id: "hoje-titulo" }, "Oportunidades de hoje"),
        el("p", { class: "sub" }, "Ativos que formaram um setup no último pregão fechado de cada mercado. Um ativo pode ter vários setups ao mesmo tempo.")),
      el("a", { class: "botao", href: "setups.html" }, "Ver todas →")),
    avisoFormacao(R),
    el("ul", { class: "hoje-mercados", "aria-label": "Ativos em setup por mercado" }, mercados.map(tile)),
    el("div", { class: "hoje-filtros" },
      segmentoDe("Mercado", filtroMercado, pref.mercado, (v) => { pref.mercado = v; salvarPref(); renderHoje(); }),
      segmentoDe("Lado", [["compra", `▲ Compra (${fmtNum(soma("compra"), 0)})`], ["venda", `▼ Venda (${fmtNum(soma("venda"), 0)})`]], pref.lado,
        (v) => { pref.lado = v; salvarPref(); renderHoje(); })),
    setups.length ? el("div", { class: "hoje-setups" },
      el("h3", {}, `Setups de ${lado} mais frequentes hoje`),
      el("p", { class: "sub" }, "Clique num setup para ver os ativos dele, com gráfico."),
      el("ul", { class: "chips-setups" }, setups.slice(0, MAX_CHIPS).map((s) => el("li", {},
        el("a", { class: `chip-setup vies-${lado}`, href: `setups.html?setup=${encodeURIComponent(s.id)}`,
          title: SETUP_POR_ID.get(s.id)?.desc ?? "" }, nomeCurtoSetup(s.id), " ", el("b", { class: "mono" }, String(s.n))))))) : null,
    el("div", { class: "hoje-ativos" },
      el("h3", {}, `Ativos com mais setups de ${lado}`),
      ativos.length ? el("ul", { class: "inicio-ativos" }, ativos.slice(0, MAX_ATIVOS).map((x) => cartaoAtivo(x, lado)))
        : el("p", { class: "vazio" }, `Nenhum ativo com setup de ${lado} neste mercado no último pregão.`)));
}

// ------------------------------------------------------------- meus trades

const diarioAPI = () => (typeof Diario !== "undefined" ? Diario : window.Diario) ?? null;
const ESTADO_ROTULO = { aberta: "em aberto", aguardando: "aguardando entrada", alvo: "alvo", stop: "stop", manual: "saída manual" };

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

async function renderTrades() {
  const alvo = $("inicio-trades");
  const cab = (extra) => el("div", { class: "painel-cab" },
    el("div", {}, el("h2", { id: "trades-titulo" }, "Meus trades"), el("p", { class: "sub" }, "Trades simulados e o resultado em R (o stop vale −1R).")),
    extra);
  alvo.replaceChildren(cab(), el("p", { class: "sub" }, "Carregando…"));
  let dados;
  try { dados = await lerTrades(); } catch (e) { console.error(e); alvo.replaceChildren(cab(), el("p", { class: "vazio" }, "Não consegui ler os seus trades.")); return; }
  const { itens, diario } = dados;

  if (!itens.length) {
    alvo.replaceChildren(cab(),
      el("div", { class: "trades-vazio" },
        el("p", {}, el("b", {}, "Você ainda não simulou nenhum trade.")),
        el("p", { class: "sub" }, "Comece pelas oportunidades de hoje: escolha um ativo e clique em “Simular trade”."),
        el("a", { class: "botao primario", href: "#hoje" }, "Ver as oportunidades de hoje ↓")));
    return;
  }

  const mes = new Date().toISOString().slice(0, 7);
  const abertos = itens.filter(({ t, av }) => av.estado === "aberta" && !t.arquivado);
  const aguardando = itens.filter(({ t, av }) => av.estado === "aguardando" && !t.arquivado);
  const doMes = itens.filter(({ av }) => av.saiu && av.saiu.slice(0, 7) === mes && av.resultado_r != null);
  const soma = (ls) => ls.reduce((s, { av }) => s + (av.resultado_r ?? 0), 0);
  const rAberto = soma(abertos), rMes = soma(doMes);

  const kpi = (rot, valor, cls, extra, id) => el("div", { class: "kpi" }, el("div", { class: "kpi-rotulo" }, rot),
    el("div", { class: `kpi-valor ${cls ?? ""}`, "data-k": id }, valor), extra ? el("div", { class: "kpi-extra" }, extra) : null);
  const abrirTrade = (t) => (diarioAPI()?.abrir ? () => diarioAPI().abrir(t.id) : null);

  alvo.replaceChildren(
    cab(el("a", { class: "botao", href: "diario.html" }, "Abrir o Diário →")),
    el("div", { class: "kpis kpis-trades" },
      kpi("Em aberto", String(abertos.length), "", aguardando.length ? `${aguardando.length} aguardando entrada` : "trades em andamento", "abertos"),
      kpi("Resultado em aberto", abertos.length ? fmtRTxt(rAberto) : "—", abertos.length ? cor(rAberto) : "", "parcial, até agora", "r-aberto"),
      kpi("R do mês", doMes.length ? fmtRTxt(rMes) : "—", doMes.length ? cor(rMes) : "",
        doMes.length ? `${doMes.length} encerrado${doMes.length > 1 ? "s" : ""}` : "nenhum encerrado ainda", "r-mes")),
    abertos.length ? el("ul", { class: "trades-abertos", "aria-label": "Trades em aberto" }, abertos
      .sort((x, y) => (y.av.resultado_r ?? 0) - (x.av.resultado_r ?? 0)).slice(0, MAX_ABERTOS).map(({ t, av }) => {
        const fazer = abrirTrade(t);
        const conteudo = [el("span", { class: t.lado === "compra" ? "alta" : "baixa", title: t.lado === "compra" ? "Compra" : "Venda" }, t.lado === "compra" ? "▲" : "▼"),
          el("b", { class: "mono" }, semSufixo(t.ticker)),
          el("span", { class: "sub" }, `desde ${fmtData(av.entrou ?? t.criada)}`),
          el("b", { class: `mono ${cor(av.resultado_r)}` }, fmtRTxt(av.resultado_r))];
        return el("li", {}, fazer
          ? el("button", { type: "button", class: "trade-linha", onclick: fazer, "aria-label": `Abrir o trade de ${semSufixo(t.ticker)}` }, conteudo)
          : el("a", { class: "trade-linha", href: `ativo.html#${encodeURIComponent(t.ticker)}`, "aria-label": `Abrir ${semSufixo(t.ticker)}` }, conteudo));
      })) : el("p", { class: "sub" }, "Nenhum trade em aberto agora."),
    abertos.length > MAX_ABERTOS ? el("p", { class: "sub" }, `e mais ${abertos.length - MAX_ABERTOS} no Diário`) : null,
    diario ? null : el("p", { class: "sub nota-fonte" }, "Lendo das simulações salvas neste navegador."));
}

// ------------------------------------------------------------- glossário

function renderGlossario() {
  const g = el("details", { class: "painel inicio-glossario", id: "glossario" },
    el("summary", {}, "Glossário: o que significam setup, stop, R, MME, IFR…"),
    el("dl", { class: "glossario" }, GLOSSARIO.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)])));
  document.querySelector(".inicio-grade").after(g);
}

// ------------------------------------------------------------- início

async function iniciar() {
  aguardarPagina();
  try { [R] = await Promise.all([carregarRadar(), carregarCatalogoSetups().catch(() => null)]); } catch (e) { montarTopo("inicio"); paginaPronta(); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("inicio", R);
  HOJE = calcularHoje();
  renderIntro();
  renderGlossario();
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
