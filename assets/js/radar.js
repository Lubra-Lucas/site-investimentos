/* Radar: gráfico à esquerda e, à direita, a lista do que está selecionado no menu superior:
 * oportunidades (compra/venda por estratégia) ou um filtro de estado. */

const estado = {
  mercado: "", visao: "oportunidades", tf: "D", periodo: 1, lado: "compra", categoria: "prioridade",
  filtro: "forte-alta", ordem: "padrao", bbTf: "D", ticker: null,
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
  history.replaceState(null, "", `#${tk}`);
  marcarSelecionado();
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
  el("div", { class: "cartao-preco" },
    el("span", { class: "mono" }, fmtMoeda(a.ultimo, a.moeda)), " ",
    el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct))));

function preencherLista(itens, render, vazio) {
  listaAtual = itens;
  document.getElementById("lista-ativos").replaceChildren(...(itens.length ? itens.map(render)
    : [el("li", { class: "vazio" }, vazio)]));
  marcarSelecionado();
}

// ------------------------------------------------------------- oportunidades

const DESCRICAO_FAMILIA = {
  pullback: "Tendência de alta recuando até a MM20, MM50 ou MM200 sem perdê-la (venda: repique rejeitado na média).",
  ifr: "IFR 14 cruzou abaixo de 20 (venda: acima de 80).",
  mtf60: "Diário e semanal acima das duas médias, com estocástico lento < 20 e IFR < 30 no 60 min.",
  mtfd: "Semanal acima das duas médias, com estocástico lento < 20 e IFR < 40 no diário.",
  bb_fora: "Fechamento fora da banda de Bollinger: reversão à média ou continuidade, conforme a tendência.",
  bb_abertura: "Bandas saindo de compressão e abrindo (boca de jacaré), com fechamento fora delas.",
  prioridade: "Ativos que dispararam 2 ou mais estratégias do mesmo lado no período: merecem mais atenção.",
  todas: "Todos os ativos com pelo menos um sinal no período.",
};
const ORDEM_FAMILIAS = ["mtf60", "mtfd", "pullback", "bb_abertura", "bb_fora", "ifr"];
const NOME_CATEGORIA = { prioridade: "★ Prioridade", todas: "Todas" };
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
      n >= 2 ? el("span", { class: "chip destaque" }, `★ ${n}`) : null,
      chipsFamilias(item.familias),
      a.tendencia_forte === (estado.lado === "compra" ? "alta" : "baixa") ? el("span", { class: "chip ctx" }, "forte D+S") : null),
    el("ul", { class: "motivos" }, sinais.map((s) =>
      el("li", { class: s.familia === estado.categoria ? "foco" : null }, el("span", { class: "data" }, fmtData(s.data)), s.texto))));
}

function calcularOportunidades() {
  const { sinais, ultima } = sinaisDoPeriodo(R, estado.tf, estado.periodo);
  const g = agruparSinais(sinais, { tf: estado.tf });
  grupos = { compra: g.compra.filter((i) => visivel(i.ticker)), venda: g.venda.filter((i) => visivel(i.ticker)) };
  document.getElementById("n-compra").textContent = grupos.compra.length;
  document.getElementById("n-venda").textContent = grupos.venda.length;

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto" };
  const mercados = [...ultima.keys()].filter((m) => !estado.mercado || m === estado.mercado);
  const rot = estado.tf === "D" ? "pregão" : "semana";
  document.getElementById("f-descricao").textContent =
    `${estado.periodo === 1 ? `Último ${rot}` : estado.periodo === 99 ? "Todos os sinais recentes" : `Últimos ${estado.periodo} ${rot}s`}` +
    ` · ${mercados.map((m) => `${nomes[m]} ${fmtData(ultima.get(m), estado.tf === "D")}`).join(" · ")}` +
    (estado.tf === "S" ? " (semana em andamento)" : "");
}

function renderOportunidades() {
  const itens = grupos[estado.lado];
  const contagem = { prioridade: itens.filter((i) => i.familias.size >= 2).length, todas: itens.length };
  for (const f of ORDEM_FAMILIAS) contagem[f] = itens.filter((i) => i.familias.has(f)).length;
  if (!contagem[estado.categoria]) estado.categoria = contagem.prioridade ? "prioridade" : "todas";

  document.getElementById("categorias").replaceChildren(...["prioridade", ...ORDEM_FAMILIAS, "todas"].map((c) =>
    el("button", { class: `cat ${c === estado.categoria ? "ativo" : ""} ${c in FAMILIA_CURTA ? "fam-" + c : "cat-" + c}`,
      disabled: !contagem[c], onclick: () => { estado.categoria = c; salvar(); renderOportunidades(); abrirPrimeiro(); } },
      NOME_CATEGORIA[c] ?? R.familias[c] ?? c, " ", el("span", { class: "contagem" }, contagem[c]))));
  document.getElementById("cat-descricao").textContent = DESCRICAO_FAMILIA[estado.categoria];

  preencherLista(itens.filter((i) => estado.categoria === "todas" ? true
    : estado.categoria === "prioridade" ? i.familias.size >= 2 : i.familias.has(estado.categoria)),
  itemOportunidade, "Nenhum sinal no período.");
}

// ------------------------------------------------------------- filtros de estado

const ifrExtremo = (x) => x != null && (x < 20 || x > 80);
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
  ifr: {
    nome: "IFR extremo", classe: "ifr",
    desc: "IFR 14 abaixo de 20 ou acima de 80 no 60 min, diário, semanal ou mensal.",
    filtro: (a) => [a.ifr_60, a.ifr_d, a.ifr_s, a.ifr_m].some(ifrExtremo),
    padrao: (a, b) => Math.min(a.ifr_d ?? 50, a.ifr_m ?? 50) - Math.min(b.ifr_d ?? 50, b.ifr_m ?? 50), rotPadrao: "IFR mais baixo",
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
  "var-dia": ["Maior alta no dia", (a, b) => (b.var_dia_pct ?? -1e9) - (a.var_dia_pct ?? -1e9)],
  "var-mes": ["Maior alta no mês", (a, b) => (b.var_mes_pct ?? -1e9) - (a.var_mes_pct ?? -1e9)],
  "ifr-d": ["Menor IFR diário", (a, b) => (a.ifr_d ?? 999) - (b.ifr_d ?? 999)],
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

/** Largura da Bollinger no tempo do filtro (ou no diário, nos outros filtros). */
function bbItem(a) {
  const tf = estado.filtro === "bb" ? estado.bbTf : "D";
  const bb = a.bb_tf?.[tf];
  if (!bb) return el("span", {}, `BB ${ROTULO_TF_FRASE[tf]} —`);
  return el("span", {}, `BB ${ROTULO_TF_FRASE[tf]} ${fmtNum(bb.largura_pct, 1)}%`,
    bb.comprimida ? el("b", { class: "aviso" }, ` comprimida${bb.desde ? " desde " + fmtData(bb.desde.slice(0, 10)) : ""}`) : "");
}

function itemEstado(a) {
  const v = (x) => (x == null ? "—" : fmtNum(x, 0));
  const ifrCls = (x) => (x == null ? "" : x < 20 ? "alta forte" : x < 30 ? "alta" : x > 80 ? "baixa forte" : x > 70 ? "baixa" : "");
  const seta = (t) => el("span", { class: `tend ${t}` }, t === "alta" ? "▲" : t === "baixa" ? "▼" : "▬");
  return el("li", { class: "item", "data-tk": a.ticker, onclick: () => selecionar(a.ticker) },
    cabecalhoItem(a),
    el("div", { class: "metricas" },
      el("span", {}, "D ", seta(a.tend_d), " S ", seta(a.tend_s),
        a.tendencia_desde ? ` desde ${fmtData(a.tendencia_desde)}` : ""),
      el("span", {}, "IFR ",
        el("b", { class: ifrCls(a.ifr_60) }, `60m ${v(a.ifr_60)}`), " · ",
        el("b", { class: ifrCls(a.ifr_d) }, `D ${v(a.ifr_d)}`), " · ",
        el("b", { class: ifrCls(a.ifr_s) }, `S ${v(a.ifr_s)}`), " · ",
        el("b", { class: ifrCls(a.ifr_m) }, `M ${v(a.ifr_m)}`)),
      bbItem(a),
      el("span", {}, "MM50 ", el("b", { class: cor(a.dist_mm50_pct) }, fmtPct(a.dist_mm50_pct)), " · mês ",
        el("b", { class: cor(a.var_mes_pct) }, fmtPct(a.var_mes_pct)))));
}

function renderEstado() {
  const f = FILTROS[estado.filtro];
  const ordem = ORDENS[estado.ordem]?.[1] ?? f.padrao;
  const itens = doFiltro(estado.filtro).sort(ordem);
  const titulo = document.getElementById("estado-titulo");
  titulo.textContent = f.nome;
  titulo.className = `fe-${f.classe}`;
  document.getElementById("estado-n").textContent = itens.length;
  const sel = document.getElementById("estado-ordem");
  sel.replaceChildren(el("option", { value: "padrao" }, f.rotPadrao),
    ...Object.entries(ORDENS).map(([k, [rot]]) => el("option", { value: k }, rot)));
  sel.value = estado.ordem;
  document.getElementById("cat-descricao").textContent = f.desc;
  document.getElementById("caixa-bb-tf").hidden = estado.filtro !== "bb";
  preencherLista(itens, itemEstado, "Nenhum ativo neste filtro hoje.");
}

// ------------------------------------------------------------- visão

function aplicarVisao() {
  const op = estado.visao === "oportunidades";
  document.getElementById("menu-oportunidades").hidden = !op;
  document.getElementById("menu-estado").hidden = op;
  document.getElementById("cab-oportunidades").hidden = !op;
  document.getElementById("cab-estado").hidden = op;
  if (op) { calcularOportunidades(); renderOportunidades(); }
  else { renderMenuEstado(); renderEstado(); }
}

function renderRetidos() {
  document.getElementById("retidos-resumo").textContent = `${R.retidos.length} ativo(s)`;
  document.getElementById("lista-retidos").replaceChildren(...(R.retidos.length
    ? R.retidos.map((r) => el("li", {}, el("b", { class: "mono" }, r.rotulo ?? semSufixo(r.ticker)), ` ${r.nome}: `, el("span", { class: "sub" }, r.motivo)))
    : [el("li", { class: "sub" }, "Nenhum. Todos os ativos passaram na verificação.")]));
}

const salvar = () => guardar.gravar("radar-v2", {
  mercado: estado.mercado, visao: estado.visao, tf: estado.tf, periodo: estado.periodo,
  lado: estado.lado, categoria: estado.categoria, filtro: estado.filtro, bbTf: estado.bbTf,
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
  painel = painelGrafico(document.getElementById("painel-grafico"), { simular: true });
  Object.assign(estado, guardar.ler("radar-v2", {}));

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
  document.getElementById("estado-ordem").addEventListener("change", (e) => {
    estado.ordem = e.target.value;
    renderEstado();
  });

  aplicarVisao();
  renderRetidos();
  // simulações: lista, exportar/importar e atualização quando salvar/excluir no gráfico
  const abrirSimulacao = (tk) => { selecionar(tk, false); document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth" }); };
  const listarSimulacoes = () => renderListaSimulacoes(document.getElementById("lista-simulacoes"), porTicker, abrirSimulacao);
  document.addEventListener("simulacoes", listarSimulacoes);
  document.getElementById("sim-exportar").addEventListener("click", exportarSimulacoes);
  document.getElementById("sim-importar").addEventListener("change", (e) => {
    if (e.target.files[0]) importarSimulacoes(e.target.files[0], () => { listarSimulacoes(); selecionar(estado.ticker ?? R.ativos[0].ticker, false); });
  });
  listarSimulacoes();

  const doHash = decodeURIComponent(location.hash.slice(1));
  selecionar(porTicker.has(doHash) ? doHash : listaAtual[0]?.ticker ?? R.ativos[0].ticker, false);
}

iniciar();
