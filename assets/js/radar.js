/* Radar: gráfico à esquerda e, à direita, a lista do que está selecionado no menu superior:
 * oportunidades (compra/venda por estratégia), um filtro de estado ou os dados só do ativo aberto. */

const estado = {
  mercado: "", visao: "oportunidades", tf: "D", periodo: 1, lado: "compra", estilo: "tendencia", categoria: "todas", soConfluencia: false,
  filtro: "forte-alta", ordem: "padrao", bbTf: "D", ordemOp: "confluencia", ticker: null,
};
let R, porTicker, painel;
let listaAtual = [];

const visivel = (tk) => {
  const a = porTicker.get(tk);
  return a && (!estado.mercado || a.mercado === estado.mercado);
};

function selecionar(tk, rolar = true) {
  const a = porTicker.get(tk);
  if (!a) return;
  estado.ticker = tk;
  history.replaceState(null, "", `${estado.visao === "ativo" ? "?ativo" : location.pathname}#${tk}`);
  marcarSelecionado();
  if (estado.visao === "ativo") renderFicha();
  painel.selecionar(a, R.sinais.filter((s) => s.ticker === tk));
  // no desktop a lista fica ao lado do gráfico; só no celular é preciso rolar até ele
  if (rolar && window.innerWidth < 1100)
    document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth", block: "start" });
}

function marcarSelecionado() {
  document.querySelectorAll("[data-tk]").forEach((n) => n.classList.toggle("selecionado", n.dataset.tk === estado.ticker));
}

/** Se o ativo aberto não está na lista atual, abre o primeiro dela. */
function abrirPrimeiro() {
  if (listaAtual.length && !listaAtual.some((i) => i.ticker === estado.ticker)) selecionar(listaAtual[0].ticker, false);
}

function mover(passo) {
  if (!listaAtual.length) return;
  const i = listaAtual.findIndex((x) => x.ticker === estado.ticker);
  const prox = listaAtual[Math.max(0, Math.min(listaAtual.length - 1, i < 0 ? 0 : i + passo))];
  selecionar(prox.ticker, false);
  document.querySelector(`#lista-ativos [data-tk="${CSS.escape(prox.ticker)}"]`)?.scrollIntoView({ block: "nearest" });
}

const cabecalhoItem = (a) => el("div", { class: "item-topo" },
  el("div", { class: "item-nome" }, el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
  precoComFormacao(a, "cartao-preco"));

function preencherLista(itens, render, vazio) {
  listaAtual = itens;
  document.getElementById("lista-ativos").replaceChildren(...(itens.length ? itens.map(render)
    : [el("li", { class: "vazio" }, vazio)]));
  marcarSelecionado();
}

// ------------------------------------------------------------- oportunidades

const MODALIDADES = [
  { chave: "tendencia", nome: "A favor da tendência", familias: ["pullback", "boca", "mtf"],
    dica: { compra: "Comprar uma alta que continua: pullbacks nas médias, rompimentos, multitempo.",
      venda: "Vender uma baixa que continua: pullbacks nas médias, rompimentos para baixo, multitempo." } },
  { chave: "contra", nome: "Contra a tendência", familias: ["ifr", "bb_fora", "distancia", "quedas"],
    dica: { compra: "Comprar a virada depois de uma queda forte: IFR extremo, fora da Bollinger, longe da média.",
      venda: "Vender a virada depois de uma alta forte: IFR extremo, fora da Bollinger, longe da média." } },
];
const ORDEM_FAMILIAS = MODALIDADES.flatMap((m) => m.familias);
const NOME_CATEGORIA = { todas: "Todas" };

/** Explicação de cada estratégia, conforme o lado (compra/venda) e o sinal (diário/semanal). */
function descricaoCategoria(c, lado, tf) {
  const compra = lado === "compra";
  const D = tf === "D";
  const mm = "MM20, MM50 ou MM200";
  return {
    prioridade: `Ativos com 2 ou mais estratégias de ${lado} no período: merecem mais atenção.`,
    todas: `Todos os ativos com pelo menos um sinal de ${lado} no período.`,
    pullback: compra
      ? `Médias alinhadas para cima. Rejeição: a mínima furou a ${mm} e o candle fechou acima. Violação e retomada: fechou abaixo da média por 1 ou 2 candles e voltou a fechar acima.`
      : `Médias alinhadas para baixo. Rejeição: a máxima furou a ${mm} e o candle fechou abaixo. Violação e perda: fechou acima da média por 1 ou 2 candles e voltou a fechar abaixo.`,
    boca: compra
      ? "Bollinger comprimida que abre (banda superior sobe, inferior desce) com fechamento acima da banda superior: possível continuidade de alta."
      : "Bollinger comprimida que abre com fechamento abaixo da banda inferior: possível continuidade de baixa.",
    mtf: D
      ? `Diário ${compra ? "em alta (acima" : "em baixa (abaixo"} da MM20 e da MM50) + ${compra ? "exaustão de queda" : "exaustão de alta"} no 60 min: estocástico lento ${compra ? "< 20" : "> 80"} e/ou IFR ${compra ? "< 30" : "> 70"}. Os dois juntos reforçam o sinal.`
      : `Semanal ${compra ? "em alta" : "em baixa"} (última semana fechada) + ${compra ? "exaustão de queda" : "exaustão de alta"} no diário ou no 4 horas: estocástico lento ${compra ? "< 20" : "> 80"} e/ou IFR ${compra ? "< 30" : "> 70"}.`,
    ifr: compra
      ? "IFR 14 abaixo de 20: sobrevendido, clímax de queda. Compra contra a tendência."
      : "IFR 14 acima de 80: sobrecomprado, clímax de alta. Venda contra a tendência.",
    bb_fora: compra
      ? "Fechou abaixo da banda inferior de Bollinger: caiu demais, possível reversão nos próximos candles."
      : "Fechou acima da banda superior de Bollinger: subiu demais, possível reversão nos próximos candles.",
    distancia: `Preço muito ${compra ? "abaixo" : "acima"} da MM20 em relação ao normal do próprio ativo: pelo menos 2,5x a distância média ${D ? "do último ano" : "dos últimos 2 anos"}.`,
    quedas: `Entre as 8% maiores ${compra ? "quedas" : "altas"} do mercado em ${D ? "21 pregões" : "13 semanas"} (movimento de pelo menos ${D ? "8" : "12"}%): ${compra ? "preço descontado" : "preço esticado"}.`,
  }[c];
}

let grupos = { compra: [], venda: [] };

function itemOportunidade(item) {
  const a = porTicker.get(item.ticker);
  const n = item.familias.size;
  // na categoria de uma estratégia, o motivo dela vem primeiro
  const sinais = [...item.sinais].sort((x, y) =>
    (y.familia === estado.categoria) - (x.familia === estado.categoria) || y.data.localeCompare(x.data));
  return el("li", { class: `item ${n >= 2 ? "confluencia" : ""}`, "data-tk": item.ticker, onclick: () => selecionar(item.ticker) },
    cabecalhoItem(a),
    el("div", { class: "chips" },
      n >= 2 ? el("span", { class: "chip destaque" }, `${n} estratégias`) : null,
      chipsFamilias(item.familias, estado.lado),
      a.tendencia_forte === (estado.lado === "compra" ? "alta" : "baixa") ? el("span", { class: "chip ctx" }, "tendência forte D+S") : null),
    el("ul", { class: "motivos" }, sinais.map((s) =>
      el("li", { class: s.familia === estado.categoria ? "foco" : null }, el("span", { class: "data" }, fmtData(s.data)), s.texto,
        " ", seloHistorico(s.bt, s.tf)))));
}

function calcularOportunidades() {
  const { sinais, ultima } = sinaisDoPeriodo(R, estado.tf, estado.periodo);
  const g = agruparSinais(sinais, { tf: estado.tf });
  grupos = { compra: g.compra.filter((i) => visivel(i.ticker)), venda: g.venda.filter((i) => visivel(i.ticker)) };

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
  const mercados = [...ultima.keys()].filter((m) => !estado.mercado || m === estado.mercado);
  const rot = estado.tf === "D" ? "pregão" : "semana";
  // rótulos do período conforme o tempo do sinal (pregões ou semanas)
  document.querySelectorAll("#f-periodo button").forEach((b) => {
    const n = +b.dataset.v;
    b.textContent = n === 99 ? "Todos" : n === 1 ? (estado.tf === "D" ? "Último pregão" : "Última semana") : `${n} ${rot}s`;
  });
  document.getElementById("f-descricao").textContent =
    `${estado.periodo === 1 ? `Último ${rot}` : estado.periodo === 99 ? "Todos os sinais recentes" : `Últimos ${estado.periodo} ${rot}s`}` +
    ` · ${mercados.map((m) => `${nomes[m]} ${fmtData(ultima.get(m), estado.tf === "D")}`).join(" · ")}` +
    (estado.tf === "S" ? " (semana em andamento)" : "");
}

/** Os itens de um lado só com as estratégias de um estilo (a favor ou contra a tendência). */
function doEstilo(itens, estilo) {
  const fams = new Set(MODALIDADES.find((m) => m.chave === estilo).familias);
  return itens.map((i) => {
    const sinais = i.sinais.filter((x) => fams.has(x.familia));
    return sinais.length ? { ...i, sinais, familias: new Set(sinais.map((x) => x.familia)) } : null;
  }).filter(Boolean);
}

function renderOportunidades() {
  const m = MODALIDADES.find((x) => x.chave === estado.estilo) ?? MODALIDADES[0];
  estado.estilo = m.chave;
  const itens = doEstilo(grupos[estado.lado], m.chave);
  document.getElementById("n-compra").textContent = doEstilo(grupos.compra, m.chave).length;
  document.getElementById("n-venda").textContent = doEstilo(grupos.venda, m.chave).length;

  // 1) estilo: a favor ou contra a tendência (nunca misturados)
  document.getElementById("f-estilo").replaceChildren(...MODALIDADES.map((x) =>
    el("button", { class: `estilo ${x.chave === m.chave ? "ativo" : ""}`, role: "tab", "aria-selected": x.chave === m.chave,
      onclick: () => { estado.estilo = x.chave; estado.categoria = "todas"; salvar(); renderOportunidades(); abrirPrimeiro(); } },
    x.nome, el("span", { class: "contagem" }, doEstilo(grupos[estado.lado], x.chave).length))));
  document.getElementById("dica-estilo").textContent = m.dica[estado.lado];

  // 2) estratégias do estilo
  const contagem = { todas: itens.length };
  for (const f of m.familias) contagem[f] = itens.filter((i) => i.familias.has(f)).length;
  if (!(estado.categoria in contagem) || !contagem[estado.categoria]) estado.categoria = "todas";
  const botao = (c) => el("button", {
    class: `cat ${c === estado.categoria ? "ativo" : ""} ${c in FAMILIA_CURTA ? "fam-" + c : "cat-" + c}`,
    disabled: !contagem[c], onclick: () => { estado.categoria = c; salvar(); renderOportunidades(); abrirPrimeiro(); } },
  NOME_CATEGORIA[c] ?? (c === "quedas" && estado.lado === "venda" ? "Maiores altas" : R.familias[c]?.nome ?? c),
  " ", el("span", { class: "contagem" }, contagem[c]));
  const nConfluencia = itens.filter((i) => estado.categoria === "todas" || i.familias.has(estado.categoria))
    .filter((i) => i.familias.size >= 2).length;
  document.getElementById("categorias").replaceChildren(
    el("div", { class: "grupo-cat" }, botao("todas"), ...m.familias.map(botao)),
    el("div", { class: "grupo-cat opcoes-lista" },
      el("label", { class: "opcao", title: "Ativos com 2 ou mais estratégias deste estilo ao mesmo tempo" },
        el("input", { type: "checkbox", checked: estado.soConfluencia ? true : null,
          onchange: (e) => { estado.soConfluencia = e.target.checked; salvar(); renderOportunidades(); abrirPrimeiro(); } }),
        `Só com 2+ estratégias (${nConfluencia})`),
      el("label", { class: "ordem-op" }, "Ordenar ",
        el("select", { onchange: (e) => { estado.ordemOp = e.target.value; salvar(); renderOportunidades(); } },
          [["confluencia", "Mais estratégias"], ["historico", "Melhor histórico"]].map(([k, rot]) =>
            el("option", { value: k, selected: estado.ordemOp === k ? true : null }, rot))))));
  document.getElementById("cat-descricao").textContent = estado.categoria === "todas"
    ? `Ativos com sinal de ${estado.lado} ${m.chave === "tendencia" ? "a favor" : "contra"} da tendência no período.`
    : descricaoCategoria(estado.categoria, estado.lado, estado.tf);

  let lista = itens.filter((i) => (estado.categoria === "todas" || i.familias.has(estado.categoria))
    && (!estado.soConfluencia || i.familias.size >= 2));
  if (estado.ordemOp === "historico") {
    // melhor vantagem histórica entre os sinais da categoria (só conta com casos suficientes)
    const nota = (i) => Math.max(-1e9, ...i.sinais
      .filter((s) => (estado.categoria in FAMILIA_CURTA ? s.familia === estado.categoria : true) && s.bt?.[3] != null)
      .map((s) => s.bt[3]));
    lista = [...lista].sort((a, b) => nota(b) - nota(a));
  }
  preencherLista(lista, itemOportunidade, estado.soConfluencia
    ? "Nenhum ativo com 2+ estratégias deste estilo no período. Desmarque a opção ou aumente o período."
    : "Nenhum sinal deste estilo no período.");
}

// ------------------------------------------------------------- filtros de estado

const FILTROS = {
  "forte-alta": {
    nome: "▲ Tendência forte de alta", classe: "alta",
    desc: "Preço acima da MM20 e da MM50 no diário e no semanal.",
    filtro: (a) => a.tendencia_forte === "alta",
    padrao: (a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? ""), rotPadrao: "Tendência mais recente",
  },
  "forte-baixa": {
    nome: "▼ Tendência forte de baixa", classe: "baixa",
    desc: "Preço abaixo da MM20 e da MM50 no diário e no semanal.",
    filtro: (a) => a.tendencia_forte === "baixa",
    padrao: (a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? ""), rotPadrao: "Tendência mais recente",
  },
  bb: {
    nome: "Bollinger comprimida", classe: "bb",
    desc: "Largura das bandas entre as 10% menores dos últimos 120 candles do tempo escolhido: possível explosão de volatilidade à frente.",
    filtro: (a) => a.bb_tf?.[estado.bbTf]?.comprimida,
    padrao: (a, b) => a.bb_tf[estado.bbTf].largura_pct - b.bb_tf[estado.bbTf].largura_pct, rotPadrao: "Bandas mais estreitas",
  },
  todos: {
    nome: "Todos os ativos", classe: "todos", desc: "Todos os ativos líquidos publicados.",
    filtro: () => true, padrao: (a, b) => semSufixo(a.ticker).localeCompare(semSufixo(b.ticker)), rotPadrao: "Nome",
  },
};
const ORDENS = {
  "var-dia": ["▲ Alta no dia", (a, b) => (b.var_dia_pct ?? -1e9) - (a.var_dia_pct ?? -1e9)],
  "var-mes": ["▲ Alta no mês", (a, b) => (b.var_mes_pct ?? -1e9) - (a.var_mes_pct ?? -1e9)],
  "queda-mes": ["▼ Queda no mês", (a, b) => (a.var_mes_pct ?? 1e9) - (b.var_mes_pct ?? 1e9)],
  "ifr-d": ["IFR diário mais baixo", (a, b) => (a.ifr_d ?? 999) - (b.ifr_d ?? 999)],
  "mm50": ["Mais perto da MM50", (a, b) => Math.abs(a.dist_mm50_pct ?? 999) - Math.abs(b.dist_mm50_pct ?? 999)],
};

const doFiltro = (chave) => R.ativos.filter((a) => a.liquido && visivel(a.ticker) && FILTROS[chave].filtro(a));

function renderMenuEstado() {
  document.getElementById("f-estado").replaceChildren(...Object.entries(FILTROS).map(([k, f]) =>
    el("button", { class: `filtro-estado fe-${f.classe} ${k === estado.filtro ? "ativo" : ""}`,
      onclick: () => {
        estado.filtro = k; estado.ordem = "padrao"; salvar(); renderMenuEstado(); renderEstado(); abrirPrimeiro();
        if (k === "bb") painel.mudarTf(estado.bbTf);  // o gráfico acompanha o tempo do filtro
      } },
      el("span", {}, f.nome), el("b", { class: "contagem" }, doFiltro(k).length))));
}

/** Cartão do filtro de estado: cada número com o seu rótulo, agrupado por assunto. */
function itemEstado(a, clicavel = true) {
  const v = (x) => (x == null ? "—" : fmtNum(x, 0));
  const ifrCls = (x) => (x == null ? "" : x < 30 ? "alta" : x > 70 ? "baixa" : "");
  const tend = (rot, t) => el("span", { class: `tend-pilula ${t}` }, rot, " ",
    el("b", {}, t === "alta" ? "▲ alta" : t === "baixa" ? "▼ baixa" : "▬ lateral"));
  const metrica = (rot, valor, cls = "") => el("div", { class: "metrica" }, el("span", {}, rot), el("b", { class: cls }, valor));
  const bloco = (titulo, ...metricas) => el("div", { class: "bloco-metricas" }, el("p", {}, titulo), el("div", { class: "metricas-linha" }, metricas));
  const bbTf = estado.filtro === "bb" ? estado.bbTf : "D";
  const bb = a.bb_tf?.[bbTf];
  return el("li", { class: "item cartao-estado", "data-tk": clicavel ? a.ticker : null, onclick: clicavel ? () => selecionar(a.ticker) : null },
    el("div", { class: "ce-topo" },
      el("div", {}, el("b", { class: "ce-ticker" }, semSufixo(a.ticker)), el("span", { class: "ce-nome" }, a.nome)),
      el("div", { class: "ce-preco" }, el("b", {}, fmtMoeda(a.ultimo, a.moeda)), el("span", { class: cor(a.var_dia_pct) }, fmtPct(a.var_dia_pct)))),
    el("div", { class: "ce-tendencia" }, tend("Diário", a.tend_d), tend("Semanal", a.tend_s),
      a.tendencia_desde ? el("span", { class: "ce-desde" }, `há ${a.tendencia_pregoes} pregões · desde ${fmtData(a.tendencia_desde)}`) : null),
    bloco("Variação", metrica("Dia", fmtPct(a.var_dia_pct), cor(a.var_dia_pct)),
      metrica("Mês", fmtPct(a.var_mes_pct), cor(a.var_mes_pct)), metrica("Ano", fmtPct(a.var_ano_pct), cor(a.var_ano_pct))),
    bloco("IFR 14", metrica("60 min", v(a.ifr_60), ifrCls(a.ifr_60)), metrica("Diário", v(a.ifr_d), ifrCls(a.ifr_d)),
      metrica("Semanal", v(a.ifr_s), ifrCls(a.ifr_s)), metrica("Mensal", v(a.ifr_m), ifrCls(a.ifr_m))),
    bloco("Distância das médias", metrica("MM20", fmtPct(a.dist_mm20_pct), cor(a.dist_mm20_pct)),
      metrica("MM50", fmtPct(a.dist_mm50_pct), cor(a.dist_mm50_pct)), metrica("MM200", fmtPct(a.dist_mm200_pct), cor(a.dist_mm200_pct))),
    bloco(`Bollinger ${ROTULO_TF_FRASE[bbTf]}`,
      metrica("Largura", bb ? `${fmtNum(bb.largura_pct, 1)}%` : "—"),
      metrica("Situação", bb?.comprimida ? "Comprimida" : bb ? "Normal" : "—", bb?.comprimida ? "aviso" : ""),
      metrica("Desde", bb?.desde ? fmtData(bb.desde.slice(0, 10)) : "—")));
}

function renderEstado() {
  const f = FILTROS[estado.filtro];
  const ordem = ORDENS[estado.ordem]?.[1] ?? f.padrao;
  const itens = doFiltro(estado.filtro).sort(ordem);
  const titulo = document.getElementById("estado-titulo");
  titulo.textContent = f.nome;
  titulo.className = `fe-${f.classe}`;
  document.getElementById("estado-n").textContent = itens.length;
  document.getElementById("estado-ordem").replaceChildren(
    ...[["padrao", f.rotPadrao], ...Object.entries(ORDENS).map(([k, [rot]]) => [k, rot])].map(([k, rot]) =>
      el("button", { class: `ordem ${k === estado.ordem ? "ativo" : ""}`,
        onclick: () => { estado.ordem = k; renderEstado(); abrirPrimeiro(); } }, rot)));
  document.getElementById("cat-descricao").textContent = f.desc;
  document.getElementById("caixa-bb-tf").hidden = estado.filtro !== "bb";
  preencherLista(itens, itemEstado, "Nenhum ativo neste filtro hoje.");
}

// ------------------------------------------------------------- este ativo

const tituloBloco = (txt, extra) => el("p", { class: "ficha-titulo" }, txt, extra ? el("span", {}, extra) : null);

/** Quanto o preço andou do fechamento do sinal até hoje, a favor ou contra o lado do sinal. */
function desdeOSinal(s, a) {
  if (!s.preco || !a.ultimo) return null;
  const v = ((s.lado === "compra" ? 1 : -1) * (a.ultimo / s.preco - 1)) * 100;
  return el("div", { class: "ficha-sinal-desde" }, `Desde o sinal (${fmtMoeda(s.preco, a.moeda)}): `,
    el("b", { class: cor(v) }, `${fmtPct(v)} ${v >= 0 ? "a favor" : "contra"}`));
}

function irParaSinal(s, item) {
  document.querySelectorAll(".ficha-sinal.ativo").forEach((n) => n.classList.remove("ativo"));
  item.classList.add("ativo");
  painel.irPara(s.data, s.tf === "S" ? "W" : "D");
  if (window.innerWidth < 1100) document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth", block: "start" });
}

function blocoSinais(a) {
  const sinais = R.sinais.filter((s) => s.ticker === a.ticker)
    .sort((x, y) => y.data.localeCompare(x.data) || x.tf.localeCompare(y.tf) || x.lado.localeCompare(y.lado));
  const desde = R.sinais.reduce((m, s) => (s.data < m ? s.data : m), "9999");
  return el("li", { class: "ficha-bloco" },
    tituloBloco("Sinais recentes", `${sinais.length} desde ${fmtData(desde)}`),
    sinais.length ? el("p", { class: "sub" }, "Clique num sinal para ver no gráfico o que o preço fez depois.") : null,
    sinais.length ? el("ul", { class: "ficha-sinais" }, sinais.map((s) =>
      el("li", { class: `ficha-sinal ${s.lado}`, tabindex: "0", title: "Ver este sinal no gráfico",
        onclick: (e) => irParaSinal(s, e.currentTarget), onkeydown: (e) => e.key === "Enter" && irParaSinal(s, e.currentTarget) },
        el("div", { class: "ficha-sinal-topo" },
          el("span", { class: "data" }, fmtData(s.data)),
          el("span", { class: "chip ctx", title: s.tf === "S" ? "Sinal no semanal" : "Sinal no diário" }, s.tf === "S" ? "Semanal" : "Diário"),
          el("b", { class: s.lado === "compra" ? "alta" : "baixa" }, s.lado === "compra" ? "▲ Compra" : "▼ Venda"),
          el("span", { class: `chip fam-${s.familia}` }, nomeFamilia(s.familia, s.lado))),
        el("div", { class: "ficha-sinal-texto" }, s.texto, " ", seloHistorico(s.bt, s.tf)),
        desdeOSinal(s, a))))
      : el("p", { class: "sub" }, "Nenhum sinal de compra ou venda neste ativo no período publicado."));
}

function blocoSimulacoes(a) {
  return el("li", { class: "ficha-bloco" }, tituloBloco("Minhas simulações"),
    chipsSimulacoes(a) ?? el("p", { class: "sub" }, "Nenhuma simulação neste ativo. Use ", el("b", {}, "⊕ Simular"), " no gráfico."));
}

/** Como cada estratégia se saiu neste ativo nos últimos 6 anos (backtest), da melhor para a pior. */
async function blocoHistorico(a) {
  const caixa = el("li", { class: "ficha-bloco" }, tituloBloco("Histórico das estratégias neste ativo"), el("p", { class: "sub" }, "Carregando…"));
  carregarBacktest().then((B) => {
    const linhas = [];
    for (const [tf, fams] of Object.entries(B.ativos[a.ticker] ?? {}))
      for (const [fam, lados] of Object.entries(fams))
        for (const [lado, e] of Object.entries(lados)) if (e.n >= B.min_casos) linhas.push({ tf, fam, lado, e });
    linhas.sort((x, y) => (y.e.vantagem ?? -1e9) - (x.e.vantagem ?? -1e9));
    const prazo = (tf) => (tf === "D" ? `${B.principal.D} pregões` : `${B.principal.S} semanas`);
    caixa.replaceChildren(
      tituloBloco("Histórico das estratégias neste ativo", "6 anos"),
      linhas.length ? el("p", { class: "sub" }, `Entrando na abertura seguinte ao sinal e saindo ${prazo("D")} depois (diário) ou ${prazo("S")} (semanal). ` +
        `Vantagem: quanto rendeu a mais que entrar num dia qualquer.`) : null,
      linhas.length ? el("div", { class: "tabela-wrap" }, el("table", { class: "ficha-tabela" },
        el("thead", {}, el("tr", {}, ["Estratégia", "Casos", "Acerto", "Médio", "Vantagem"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
        el("tbody", {}, linhas.map(({ tf, fam, lado, e }) => el("tr", {},
          el("td", {}, el("b", { class: lado === "compra" ? "alta" : "baixa" }, lado === "compra" ? "▲ " : "▼ "),
            nomeFamilia(fam, lado), el("span", { class: "sub" }, ` · ${tf === "S" ? "semanal" : "diário"}`)),
          el("td", { class: "num" }, String(e.n)),
          el("td", { class: "num" }, `${fmtNum(e.acerto, 0)}%`),
          el("td", { class: `num ${cor(e.medio)}` }, fmtPct(e.medio)),
          el("td", { class: `num ${cor(e.vantagem)}` }, fmtPct(e.vantagem)))))))
        : el("p", { class: "sub" }, `Nenhuma estratégia com ${B.min_casos} ou mais casos neste ativo.`));
  }).catch(() => caixa.replaceChildren(tituloBloco("Histórico das estratégias neste ativo"), el("p", { class: "sub" }, "Backtest indisponível.")));
  return caixa;
}

async function renderFicha() {
  listaAtual = [];  // as setas não navegam nesta visão
  const a = porTicker.get(estado.ticker);
  const alvo = document.getElementById("lista-ativos");
  if (!a) { alvo.replaceChildren(el("li", { class: "vazio" }, "Nenhum ativo aberto.")); return; }
  document.getElementById("f-ativo").value = "";
  // as últimas operações primeiro; o panorama do ativo fecha o painel
  alvo.replaceChildren(el("li", { class: "ficha-cab" }, el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
    blocoSinais(a), blocoSimulacoes(a), await blocoHistorico(a),
    el("li", { class: "ficha-bloco" }, tituloBloco("Panorama"), itemEstado(a, false)));
}

/** Acha o ativo pelo que foi digitado: PETR4, PETR4.SA, BTC, BRK.B... */
function acharTicker(txt) {
  const t = txt.trim().toUpperCase();
  if (!t) return null;
  const porRotulo = new Map(R.ativos.map((a) => [(a.rotulo ?? semSufixo(a.ticker)).toUpperCase(), a.ticker]));
  return [t, `${t}.SA`, t.replace(".", "-"), `${t}-USD`, porRotulo.get(t)].find((x) => x && porTicker.has(x)) ?? null;
}

// ------------------------------------------------------------- visão

function aplicarVisao() {
  const v = estado.visao;
  document.getElementById("menu-oportunidades").hidden = v !== "oportunidades";
  document.getElementById("menu-estado").hidden = v !== "estado";
  document.getElementById("menu-ativo").hidden = v !== "ativo";
  document.getElementById("cab-oportunidades").hidden = v !== "oportunidades";
  document.getElementById("cab-estado").hidden = v !== "estado";
  document.getElementById("cat-descricao").hidden = v === "ativo";
  document.querySelector(".lista-sinais .dica").hidden = v === "ativo";
  document.querySelector(".area-radar").classList.toggle("modo-estado", v !== "oportunidades");
  if (estado.ticker) history.replaceState(null, "", `${v === "ativo" ? "?ativo" : location.pathname}#${estado.ticker}`);
  if (v === "oportunidades") { calcularOportunidades(); renderOportunidades(); }
  else if (v === "estado") { renderMenuEstado(); renderEstado(); }
  else renderFicha();
}

function renderRetidos() {
  document.getElementById("retidos-resumo").textContent = `${R.retidos.length} ativo(s)`;
  document.getElementById("lista-retidos").replaceChildren(...(R.retidos.length
    ? R.retidos.map((r) => el("li", {}, el("b", { class: "mono" }, r.rotulo ?? semSufixo(r.ticker)), ` ${r.nome}: `, el("span", { class: "sub" }, r.motivo)))
    : [el("li", { class: "sub" }, "Nenhum. Todos os ativos passaram na verificação.")]));
}

// "Este ativo" não fica salvo: o Radar volta a abrir na última lista usada
const salvar = () => guardar.gravar("radar-v2", {
  estilo: estado.estilo, soConfluencia: estado.soConfluencia,
  mercado: estado.mercado, visao: estado.visao === "ativo" ? guardar.ler("radar-v2", {}).visao : estado.visao, tf: estado.tf, periodo: estado.periodo,
  lado: estado.lado, categoria: estado.categoria, filtro: estado.filtro, bbTf: estado.bbTf, ordemOp: estado.ordemOp,
});

document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    mover(e.key === "ArrowDown" ? 1 : -1);
  }
});

async function iniciar() {
  try { R = await carregarRadar(); } catch (e) { montarTopo("radar"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("radar", R);
  document.getElementById("menu-oportunidades").append(avisoFormacao(R));
  painel = painelGrafico(document.getElementById("painel-grafico"), { simular: true });
  Object.assign(estado, guardar.ler("radar-v2", {}));
  if (!FILTROS[estado.filtro]) estado.filtro = "forte-alta";  // filtro salvo que deixou de existir
  if (estado.categoria === "prioridade") { estado.categoria = "todas"; estado.soConfluencia = true; }
  // vindo da Multitela ou do Backtest (radar.html?ativo#PETR4.SA): abre direto nos dados do ativo
  if (new URLSearchParams(location.search).has("ativo")) estado.visao = "ativo";
  const doHash = decodeURIComponent(location.hash.slice(1));
  if (porTicker.has(doHash)) estado.ticker = doHash;

  document.getElementById("lista-tickers").replaceChildren(...R.ativos.map((a) =>
    el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome)));
  const campoAtivo = document.getElementById("f-ativo");
  campoAtivo.addEventListener("change", () => {
    const tk = acharTicker(campoAtivo.value);
    if (tk) selecionar(tk, false);
    else campoAtivo.setCustomValidity("Ativo não encontrado"), campoAtivo.reportValidity(), campoAtivo.setCustomValidity("");
  });

  const ligar = (id, chave, conv, depois) =>
    segmento(id, ({ v }) => { estado[chave] = conv(v); salvar(); depois(); abrirPrimeiro(); }).marcar("v", String(estado[chave]));
  ligar("f-mercado", "mercado", String, aplicarVisao);
  ligar("f-visao", "visao", String, aplicarVisao);
  ligar("f-tf", "tf", String, aplicarVisao);
  ligar("f-periodo", "periodo", Number, aplicarVisao);
  ligar("f-bb-tf", "bbTf", String, () => { renderMenuEstado(); renderEstado(); painel.mudarTf(estado.bbTf); });

  const abas = document.querySelector(".abas-lado");
  const marcarAba = () => abas.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("ativo", b.dataset.lado === estado.lado);
    b.setAttribute("aria-selected", b.dataset.lado === estado.lado);
  });
  abas.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    estado.lado = b.dataset.lado;
    salvar(); marcarAba(); renderOportunidades(); abrirPrimeiro();
  });
  marcarAba();

  aplicarVisao();
  renderRetidos();
  // simulações: lista, exportar/importar e atualização quando salvar/excluir no gráfico
  const abrirSimulacao = (tk) => { selecionar(tk, false); document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth" }); };
  const listarSimulacoes = () => renderListaSimulacoes(document.getElementById("lista-simulacoes"), porTicker, abrirSimulacao);
  document.addEventListener("simulacoes", () => { listarSimulacoes(); if (estado.visao === "ativo") renderFicha(); });
  document.getElementById("sim-exportar").addEventListener("click", exportarSimulacoes);
  document.getElementById("sim-importar").addEventListener("change", (e) => {
    if (e.target.files[0]) importarSimulacoes(e.target.files[0], () => { listarSimulacoes(); selecionar(estado.ticker ?? R.ativos[0].ticker, false); });
  });
  listarSimulacoes();

  selecionar(estado.ticker ?? listaAtual[0]?.ticker ?? R.ativos[0].ticker, false);
}

iniciar();
