/* Backtest: como cada setup do catálogo se saiu por mercado, sinal (diário/semanal), lado e prazo,
 * e os ativos onde cada um funcionou melhor. Os números vêm de data/backtest.json
 * (scripts/backtest.py) e os nomes e grupos dos setups de data/setups.json (o catálogo). */

const estado = { mercado: "BR", tf: "D", lado: "compra", h: null, escolhido: null, ...guardar.ler("backtest", {}) };
if (estado.tf === "S") estado.tf = "W";  // formato antigo salvo no navegador
let B, R, S, porTicker, porSetup;

const rotPrazo = (tf, h) => (tf === "D" ? `${h} pregões` : `${h} semanas`);
const ESTILO = { tendencia: "A favor da tendência", contra: "Contra a tendência" };
const nomeSetup = (id) => porSetup.get(id)?.nome ?? id;
const salvar = () => guardar.gravar("backtest", { mercado: estado.mercado, tf: estado.tf, lado: estado.lado, h: estado.h });

function barra(valor, max, cls) {
  const larg = Math.min(100, Math.abs(valor ?? 0) / max * 100);
  return el("span", { class: `barra ${cls}` }, el("i", { style: `width:${larg}%` }));
}

function renderPrazos() {
  const hs = B.horizontes[estado.tf];
  if (!hs.includes(estado.h)) estado.h = B.principal[estado.tf];
  const seg = document.getElementById("f-prazo");
  seg.replaceChildren(...hs.map((h) => el("button", { "data-v": h, class: h === estado.h ? "ativo" : null,
    onclick: () => { estado.h = h; salvar(); renderPrazos(); render(); } }, rotPrazo(estado.tf, h))));
}

/** Linhas do backtest no filtro atual, agrupadas como no catálogo (só setups do lado escolhido). */
function linhasPorGrupo() {
  const linhas = new Map((B.mercados[estado.mercado]?.[estado.tf] ?? []).map((x) => [x.setup, x]));
  const H = String(estado.h);
  const ordem = (a, b) => {
    const ea = a.h[H] ?? {}, eb = b.h[H] ?? {};
    return ((ea.n ?? 0) < B.min_casos) - ((eb.n ?? 0) < B.min_casos) || (eb.vantagem ?? -1e9) - (ea.vantagem ?? -1e9);
  };
  return S.grupos.map((g) => ({
    nome: g.nome,
    linhas: g.itens.filter((s) => s.vies === estado.lado && linhas.has(s.id)).map((s) => linhas.get(s.id)).sort(ordem),
  })).filter((g) => g.linhas.length);
}

function render() {
  const grupos = linhasPorGrupo();
  const todas = grupos.flatMap((g) => g.linhas);
  const H = String(estado.h);
  const base = B.base[estado.mercado]?.[estado.tf]?.[H];
  const baseLado = base == null ? null : estado.lado === "compra" ? base : -base;
  document.getElementById("base").textContent = base == null ? "" :
    `Referência: ${estado.lado === "compra" ? "comprar" : "vender"} num dia qualquer e sair ${rotPrazo(estado.tf, estado.h)} depois ` +
    `rendeu ${fmtPct(baseLado)} em média neste mercado.`;
  document.getElementById("f-descricao").textContent =
    `${todas.length} setups de ${estado.lado} · agrupados como no catálogo e ordenados pela vantagem sobre um dia qualquer · ` +
    `menos de ${B.min_casos} casos vão para o fim · maiores quedas/altas e setups neutros não têm backtest`;

  const validas = todas.map((x) => x.h[H]).filter((e) => e?.n);
  const maxRet = Math.max(1, ...validas.map((e) => Math.abs(e.medio)));
  const maxVant = Math.max(1, ...validas.map((e) => Math.abs(e.vantagem ?? 0)));
  const linha = (x) => {
    const e = x.h[H] ?? { n: 0 };
    const s = porSetup.get(x.setup);
    const poucos = e.n < B.min_casos;
    return el("tr", { class: `${poucos ? "poucos" : ""} ${estado.escolhido === x.setup ? "selecionado" : ""}`,
      title: s?.desc ?? null, onclick: () => { estado.escolhido = x.setup; render(); renderAtivos(); } },
      el("td", {}, el("b", {}, nomeSetup(x.setup)), " ",
        el("a", { href: `setups.html?setup=${encodeURIComponent(x.setup)}`, class: "bt-ver", title: "Ver os ativos neste setup agora",
          onclick: (ev) => ev.stopPropagation() }, "ver ativos →"),
        el("div", { class: "sub" }, ESTILO[s?.estilo] ?? "")),
      el("td", { class: "num" }, String(e.n)),
      el("td", { class: "num" }, poucos ? "—" : el("span", { class: "valor-barra" },
        barra(e.acerto - 50, 50, e.acerto >= 50 ? "pos" : "neg"), `${fmtNum(e.acerto, 0)}%`)),
      el("td", { class: `num ${cor(e.medio)}` }, poucos ? "—" : el("span", { class: "valor-barra" },
        barra(e.medio, maxRet, e.medio >= 0 ? "pos" : "neg"), fmtPct(e.medio))),
      el("td", { class: `num ${cor(e.vantagem)}` }, poucos ? "—" : el("span", { class: "valor-barra" },
        barra(e.vantagem, maxVant, e.vantagem >= 0 ? "pos" : "neg"), fmtPct(e.vantagem))),
      el("td", { class: `num ${cor(e.mediana)}` }, poucos ? "—" : fmtPct(e.mediana)),
      el("td", { class: "num" }, poucos ? "poucos casos" : el("span", {},
        el("span", { class: "baixa" }, fmtPct(e.pior)), " / ", el("span", { class: "alta" }, fmtPct(e.melhor)))));
  };
  document.getElementById("tabela-estrategias").replaceChildren(
    el("thead", {}, el("tr", {}, ["Setup", "Casos", "Acerto", "Retorno médio", "Vantagem", "Mediana", "Pior / melhor"].map((h, i) =>
      el("th", { class: i ? "num" : "" }, h)))),
    ...grupos.map((g) => el("tbody", {},
      el("tr", { class: "grupo-bt" }, el("td", { colspan: 7 }, g.nome)),
      ...g.linhas.map(linha))));
}

/** Onde o setup escolhido funcionou melhor (e pior), ativo por ativo, no prazo principal. */
function renderAtivos() {
  const alvo = document.getElementById("ativos");
  const id = estado.escolhido;
  if (!id) return;
  const prazo = rotPrazo(estado.tf, B.principal[estado.tf]);
  document.getElementById("ativos-titulo").textContent = `${nomeSetup(id)} · por ativo`;
  document.getElementById("ativos-sub").textContent =
    `Sinal ${estado.tf === "D" ? "diário" : "semanal"}, saída em ${prazo}. Só ativos com ${B.min_casos} ou mais casos.`;
  const lista = Object.entries(B.ativos)
    .filter(([tk]) => porTicker.get(tk)?.mercado === estado.mercado)
    .map(([tk, a]) => ({ tk, e: a[estado.tf]?.[id] }))
    .filter((x) => x.e && x.e.n >= B.min_casos)
    .sort((a, b) => (b.e.vantagem ?? -1e9) - (a.e.vantagem ?? -1e9));
  if (!lista.length) { alvo.replaceChildren(el("p", { class: "vazio" }, "Nenhum ativo com casos suficientes.")); return; }
  const linha = ({ tk, e }) => el("li", { class: "bt-ativo" },
    el("button", { type: "button", class: "bt-ativo-botao", title: `Ver os ${e.n} casos no gráfico de ${semSufixo(tk)}`,
      onclick: () => abrirCasos(tk, id) },
    el("span", { class: "bt-ativo-nome" }, el("b", { class: "mono" }, semSufixo(tk)), " ", el("span", { class: "cartao-nome" }, porTicker.get(tk)?.nome ?? "")),
    el("span", { class: "bt-numeros" },
      el("span", { class: "bt-casos-link" }, `${e.n} casos ›`),
      el("span", {}, `${fmtNum(e.acerto, 0)}%`),
      el("b", { class: cor(e.medio) }, fmtPct(e.medio)),
      el("span", { class: cor(e.vantagem), title: "Vantagem sobre um dia qualquer neste ativo" }, `vant. ${fmtPct(e.vantagem)}`))),
    el("a", { class: "bt-abrir-ativo", href: `ativo.html#${encodeURIComponent(tk)}`, title: "Abrir a página do ativo",
      "aria-label": `Abrir a página de ${semSufixo(tk)}` }, "↗"));
  alvo.replaceChildren(
    el("p", { class: "rotulo-lista" }, "Onde mais funcionou"),
    el("ol", { class: "bt-lista" }, lista.slice(0, 15).map(linha)),
    lista.length > 15 ? el("p", { class: "rotulo-lista" }, "Onde menos funcionou") : "",
    lista.length > 15 ? el("ol", { class: "bt-lista" }, lista.slice(-5).reverse().map(linha)) : "");
}

// ------------------------------------------------------------- casos de um ativo

/** Janela com todos os casos do setup num ativo: o gráfico com cada entrada e saída marcadas e a lista,
 *  caso a caso (data do sinal, entrada na abertura seguinte, saída no fechamento N candles depois, resultado). */
async function abrirCasos(tk, id) {
  fecharCasos();
  const a = porTicker.get(tk);
  const tf = estado.tf, P = B.principal[tf];
  const e = B.ativos[tk]?.[tf]?.[id];
  const anterior = document.activeElement;
  const corpoGraf = el("div", { class: "bt-casos-grafico", role: "img", "aria-label": `Gráfico de ${semSufixo(tk)} com os casos marcados` });
  const lista = el("div", { class: "bt-casos-lista" }, el("p", { class: "sub" }, "Carregando os casos…"));
  const caixa = el("div", { class: "bt-casos", role: "dialog", "aria-modal": "true", "aria-labelledby": "bt-casos-titulo", tabindex: "-1" },
    el("header", { class: "bt-casos-cab" },
      el("div", {},
        el("h2", { id: "bt-casos-titulo" }, el("span", { class: "mono" }, semSufixo(tk)), ` · ${nomeSetup(id)}`),
        el("p", { class: "sub" }, `${a?.nome ?? ""} · sinal ${tf === "D" ? "diário" : "semanal"} · entrada na abertura do candle seguinte, ` +
          `saída no fechamento ${rotPrazo(tf, P)} depois` + (e ? ` · ${e.n} casos, ${fmtNum(e.acerto, 0)}% com lucro, média ${fmtPct(e.medio)}` : ""))),
      el("button", { type: "button", class: "fechar", "aria-label": "Fechar", onclick: fecharCasos }, "×")),
    corpoGraf,
    el("p", { class: "sub bt-casos-legenda" }, "▲/▼ entrada · ● saída (verde = lucro, vermelho = prejuízo). Clique num caso para ir até ele no gráfico."),
    lista,
    el("div", { class: "bt-casos-pe" },
      el("a", { class: "botao", href: `ativo.html#${encodeURIComponent(tk)}` }, "Abrir o ativo"),
      el("a", { class: "botao", href: `setups.html?setup=${encodeURIComponent(id)}` }, "Ver este setup hoje")));
  const fundo = el("div", { class: "modal-fundo bt-casos-fundo", onclick: (ev) => { if (ev.target === fundo) fecharCasos(); } }, caixa);
  const tecla = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); fecharCasos(); }
    else if (ev.key === "Tab") {  // o foco fica dentro da janela
      const f = [...caixa.querySelectorAll("button, a[href], [tabindex='0']")].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); }
      else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener("keydown", tecla, true);
  casosAbertos = { fundo, tecla, anterior, g: null };
  document.body.append(fundo);
  document.body.classList.add("dr-travado");
  caixa.focus();

  let dados;
  try { dados = await buscarJSON(`data/casos/${a?.arquivo ?? tk}.json`); } catch { dados = null; }
  if (casosAbertos?.fundo !== fundo) return;
  const casos = dados?.casos?.[tf]?.[id] ?? [];
  if (!casos.length) {
    lista.replaceChildren(el("p", { class: "vazio" }, dados
      ? "Nenhum caso deste setup neste ativo." : "Os casos um a um ainda não foram publicados: aparecem depois da próxima atualização dos dados."));
  }
  const g = new Grafico(corpoGraf);
  g.sinais = [];
  casosAbertos.g = g;
  const ok = a ? await g.mostrar(a.arquivo, tf).catch(() => false) : false;
  if (casosAbertos?.fundo !== fundo || !ok) return;
  // o candle de cada data: o último até ela (no semanal o Python rotula a semana pela sexta e o gráfico pela segunda)
  const ateData = (d) => { let i = g.c.length - 1; while (i > 0 && String(g.c[i].time) > d) i--; return i; };
  const compra = porSetup.get(id)?.vies !== "venda";
  const marcas = [];
  const itens = casos.map(([sinal, entrada, saida, preco, r]) => {
    const iE = Math.min(ateData(sinal) + 1, g.c.length - 1), iS = ateData(saida);
    marcas.push({ time: g.c[iE].time, position: compra ? "belowBar" : "aboveBar", shape: compra ? "arrowUp" : "arrowDown", color: "#2962ff", size: 1 });
    marcas.push({ time: g.c[iS].time, position: compra ? "aboveBar" : "belowBar", shape: "circle", color: r >= 0 ? "#089981" : "#f23645", size: 1,
      text: `${r > 0 ? "+" : ""}${fmtNum(r, 1)}%` });
    return { sinal, entrada, saida, preco, r, tEntrada: g.c[iE].time };
  });
  marcas.sort((x, y) => String(x.time).localeCompare(String(y.time)));
  LWC.createSeriesMarkers(g.candles, marcas);
  const moeda = a.moeda;
  const ir = (it, linha) => {
    g.irPara(it.tEntrada);
    lista.querySelectorAll("tr.ativo").forEach((n) => n.classList.remove("ativo"));
    linha.classList.add("ativo");
  };
  const acertos = itens.filter((x) => x.r > 0).length;
  const tabela = el("table", { class: "bt-casos-tabela" },
    el("thead", {}, el("tr", {}, ["Sinal", "Entrada", "Saída", "Resultado"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
    el("tbody", {}, [...itens].reverse().map((it) => {
      const linha = el("tr", { tabindex: "0", title: "Ver este caso no gráfico",
        onclick: () => ir(it, linha), onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ir(it, linha); } } },
      el("td", {}, dataComAno(it.sinal)),
      el("td", { class: "num" }, fmtMoeda(it.entrada, moeda)),
      el("td", { class: "num" }, `${fmtMoeda(it.preco, moeda)} `, el("span", { class: "sub bt-casos-data" }, dataComAno(it.saida))),
      el("td", { class: `num ${cor(it.r)}` }, el("b", {}, fmtPct(it.r))));
      return linha;
    })));
  if (casos.length) lista.replaceChildren(
    el("p", { class: "bt-casos-resumo" }, `${itens.length} casos · `, el("b", { class: "alta" }, `${acertos} com lucro`), " · ",
      el("b", { class: "baixa" }, `${itens.length - acertos} com prejuízo`), " · do mais recente para o mais antigo"),
    el("div", { class: "tabela-wrap" }, tabela));
  // abre no caso mais recente
  if (itens.length) g.irPara(itens.at(-1).tEntrada);
}

let casosAbertos = null;
/** "26/08/24": os casos cobrem anos, então a data leva o ano. */
const dataComAno = (iso) => `${fmtData(iso)}/${iso.slice(2, 4)}`;
function fecharCasos() {
  if (!casosAbertos) return;
  const { fundo, tecla, anterior, g } = casosAbertos;
  casosAbertos = null;
  document.removeEventListener("keydown", tecla, true);
  g?.remover();
  fundo.remove();
  document.body.classList.remove("dr-travado");
  anterior?.focus?.();
}

/** Abre com o melhor setup do filtro já detalhado (se o escolhido não estiver na lista). */
function escolherPrimeiro() {
  const todas = linhasPorGrupo().flatMap((g) => g.linhas);
  if (!todas.some((x) => x.setup === estado.escolhido)) {
    const H = String(B.principal[estado.tf]);
    const melhor = [...todas].sort((a, b) => ((a.h[H]?.n ?? 0) < B.min_casos) - ((b.h[H]?.n ?? 0) < B.min_casos)
      || (b.h[H]?.vantagem ?? -1e9) - (a.h[H]?.vantagem ?? -1e9))[0];
    estado.escolhido = melhor?.setup ?? null;
  }
}

async function iniciar() {
  aguardarPagina();
  try { [B, R, S] = await Promise.all([carregarBacktest(), carregarRadar(), buscarJSON("data/setups.json")]); }
  catch (e) { montarTopo("backtest"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  porSetup = new Map(S.grupos.flatMap((g) => g.itens).map((s) => [s.id, s]));
  montarTopo("backtest", R);
  for (const [id, chave] of [["f-mercado", "mercado"], ["f-tf", "tf"], ["f-lado", "lado"]]) {
    segmento(id, ({ v }) => {
      estado[chave] = v; salvar(); renderPrazos(); escolherPrimeiro(); render(); renderAtivos();
    }).marcar("v", estado[chave]);
  }
  renderPrazos();
  escolherPrimeiro();
  render();
  renderAtivos();
  paginaPronta();
}

iniciar();
