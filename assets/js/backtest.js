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
      onclick: () => abrirCasos({ ativo: porTicker.get(tk) ?? { ticker: tk, arquivo: tk }, setupId: id, nomeSetup: nomeSetup(id),
        vies: porSetup.get(id)?.vies, tf: estado.tf, resumo: e, principal: B.principal[estado.tf] }) },
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
