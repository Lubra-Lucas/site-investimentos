/* Radar: oportunidades de compra e venda agrupadas por estratégia, com confluência. */

const estado = { mercado: "", tf: "D", periodo: 1, tabela: "forte-alta", ticker: null };
let R, porTicker, painel;

const DESCRICAO_FAMILIA = {
  pullback: "Tendência de alta recuando até a MM20, MM50 ou MM200 sem perdê-la (venda: repique rejeitado na média).",
  ifr: "IFR 14 cruzou abaixo de 20 (venda: acima de 80).",
  mtf60: "Diário e semanal acima das duas médias, com estocástico lento < 20 e IFR < 30 no 60 min.",
  mtfd: "Semanal acima das duas médias, com estocástico lento < 20 e IFR < 40 no diário.",
  bb_fora: "Fechamento fora da banda de Bollinger: reversão à média ou continuidade, conforme a tendência.",
  bb_abertura: "Bandas saindo de compressão e abrindo (boca de jacaré), com fechamento fora delas.",
};
const ORDEM_FAMILIAS = ["mtf60", "mtfd", "pullback", "bb_abertura", "bb_fora", "ifr"];

const visivel = (tk) => {
  const a = porTicker.get(tk);
  return a && (!estado.mercado || a.mercado === estado.mercado) && a.mercado !== "CRIPTO";
};

function periodoDesde() {
  const datas = datasSinais(R.sinais, estado.tf);
  return datas[Math.min(estado.periodo, datas.length) - 1] ?? null;
}

function selecionar(tk, rolar = true) {
  const a = porTicker.get(tk);
  if (!a) return;
  estado.ticker = tk;
  history.replaceState(null, "", `#${tk}`);
  document.querySelectorAll("[data-tk]").forEach((n) => n.classList.toggle("selecionado", n.dataset.tk === tk));
  painel.selecionar(a);
  if (rolar && window.innerWidth < 1100) document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth" });
}

// ------------------------------------------------------------- listas compra / venda

function cartaoAtivo(item, lado) {
  const a = porTicker.get(item.ticker);
  const n = item.familias.size;
  return el("li", { class: `cartao ${n >= 2 ? "confluencia" : ""}`, "data-tk": item.ticker, onclick: () => selecionar(item.ticker) },
    el("div", { class: "cartao-topo" },
      el("div", {},
        el("span", { class: "cartao-ticker" }, semSufixo(item.ticker)), " ",
        el("span", { class: "cartao-nome" }, a.nome)),
      el("div", { class: "cartao-preco" },
        el("span", { class: "mono" }, fmtMoeda(a.ultimo, a.moeda)), " ",
        el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct)))),
    el("div", { class: "chips" },
      n >= 2 ? el("span", { class: "chip destaque" }, `★ ${n} estratégias`) : null,
      chipsFamilias(item.familias),
      a.tendencia_forte === (lado === "compra" ? "alta" : "baixa") ? el("span", { class: "chip ctx" }, "Tendência forte D+S") : null),
    el("ul", { class: "motivos" }, item.sinais.map((s) =>
      el("li", {}, el("span", { class: "data" }, fmtData(s.data)), s.texto))));
}

function renderLado(lado, grupos) {
  const itens = grupos[lado].filter((i) => visivel(i.ticker));
  const alvo = document.getElementById(`lista-${lado}`);
  const prioridade = itens.filter((i) => i.familias.size >= 2);
  document.getElementById(`sub-${lado}`).textContent =
    `${itens.length} ativos · ${prioridade.length} com confluência de estratégias`;
  if (!itens.length) {
    alvo.replaceChildren(el("p", { class: "vazio" }, "Nenhum sinal no período."));
    return;
  }

  const blocos = [];
  if (prioridade.length) {
    blocos.push(el("div", { class: "bloco bloco-prioridade" },
      el("h3", {}, "Prioridade: 2 ou mais estratégias"),
      el("ol", { class: "cartoes" }, prioridade.map((i) => cartaoAtivo(i, lado)))));
  }
  for (const fam of ORDEM_FAMILIAS) {
    const daFamilia = itens.filter((i) => i.familias.has(fam));
    if (!daFamilia.length) continue;
    blocos.push(el("details", { class: "bloco", open: daFamilia.length <= 8 },
      el("summary", {},
        el("h3", {}, R.familias[fam] ?? fam, " ", el("span", { class: "contagem" }, daFamilia.length)),
        el("p", { class: "sub" }, DESCRICAO_FAMILIA[fam])),
      el("ol", { class: "cartoes" }, daFamilia.map((i) => cartaoAtivo(i, lado)))));
  }
  alvo.replaceChildren(...blocos);
}

function renderSinais() {
  const desde = periodoDesde();
  const datas = datasSinais(R.sinais, estado.tf);
  const ate = datas[0];
  const rotTf = estado.tf === "D" ? "pregão" : "semana";
  document.getElementById("f-descricao").textContent = !ate ? "" : estado.periodo === 1
    ? `Sinais do último ${rotTf}: ${estado.tf === "D" ? fmtData(ate, true) : "semana de " + fmtData(ate)}${estado.tf === "S" ? " (semana em andamento até sexta)" : ""}`
    : `Sinais de ${fmtData(desde)} a ${fmtData(ate)}`;
  const grupos = agruparSinais(R.sinais, { tf: estado.tf, desde });
  renderLado("compra", grupos);
  renderLado("venda", grupos);
  if (estado.ticker) document.querySelectorAll("[data-tk]").forEach((n) => n.classList.toggle("selecionado", n.dataset.tk === estado.ticker));
}

// ------------------------------------------------------------- tabela de estado

const TABELAS = {
  "forte-alta": {
    desc: "Preço acima da MM20 e da MM50 no diário e no semanal. Tendências mais recentes primeiro.",
    filtro: (a) => a.tendencia_forte === "alta",
    ordem: (a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? ""),
  },
  "forte-baixa": {
    desc: "Preço abaixo da MM20 e da MM50 no diário e no semanal. Tendências mais recentes primeiro.",
    filtro: (a) => a.tendencia_forte === "baixa",
    ordem: (a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? ""),
  },
  ifr: {
    desc: "IFR 14 abaixo de 20 ou acima de 80 em qualquer tempo gráfico (60 min, diário, semanal ou mensal).",
    filtro: (a) => [a.ifr_60, a.ifr_d, a.ifr_s, a.ifr_m].some((x) => x != null && (x < 20 || x > 80)),
    ordem: (a, b) => Math.min(a.ifr_d ?? 50, a.ifr_m ?? 50) - Math.min(b.ifr_d ?? 50, b.ifr_m ?? 50),
  },
  bb: {
    desc: "Largura das bandas de Bollinger entre as 10% menores dos últimos 120 pregões: possível explosão de volatilidade à frente.",
    filtro: (a) => a.bb_comprimida,
    ordem: (a, b) => a.bb_largura_pct - b.bb_largura_pct,
  },
  todos: { desc: "Todos os ativos líquidos publicados.", filtro: () => true, ordem: (a, b) => a.ticker.localeCompare(b.ticker) },
};

function renderTabela() {
  const t = TABELAS[estado.tabela];
  document.getElementById("tabela-descricao").textContent = t.desc;
  const linhas = R.ativos.filter((a) => a.liquido && visivel(a.ticker) && t.filtro(a)).sort(t.ordem);
  const ifrCel = (x) => el("td", { class: `num ${x == null ? "" : x < 20 ? "alta forte" : x < 30 ? "alta" : x > 80 ? "baixa forte" : x > 70 ? "baixa" : ""}` }, x == null ? "—" : fmtNum(x, 0));
  const tend = (x) => el("span", { class: `tend ${x}` }, x === "alta" ? "▲" : x === "baixa" ? "▼" : "▬");
  const tabela = document.getElementById("tabela");
  if (!linhas.length) {
    tabela.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "vazio" }, "Nenhum ativo neste filtro hoje."))));
    return;
  }
  tabela.replaceChildren(
    el("thead", {}, el("tr", {}, ["Ativo", "Mercado", "Último", "Dia", "Mês", "D", "S", "Desde",
      "IFR 60m", "IFR D", "IFR S", "IFR M", "BB larg.", "Dist. MM50", "Dados"].map((h, i) =>
      el("th", { class: i >= 2 && i !== 7 && i !== 14 ? "num" : "" }, h)))),
    el("tbody", {}, linhas.map((a) => el("tr", { "data-tk": a.ticker, onclick: () => selecionar(a.ticker) },
      el("td", { class: "ticker-cel" }, el("b", {}, semSufixo(a.ticker)), el("span", {}, a.nome)),
      el("td", {}, el("span", { class: "tag" }, a.mercado)),
      el("td", { class: "num" }, fmtMoeda(a.ultimo, a.moeda)),
      el("td", { class: `num ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct)),
      el("td", { class: `num ${cor(a.var_mes_pct)}` }, fmtPct(a.var_mes_pct)),
      el("td", {}, tend(a.tend_d)), el("td", {}, tend(a.tend_s)),
      el("td", {}, a.tendencia_desde ? fmtData(a.tendencia_desde) : a.bb_comprimida_desde && estado.tabela === "bb" ? fmtData(a.bb_comprimida_desde) : "—"),
      ifrCel(a.ifr_60), ifrCel(a.ifr_d), ifrCel(a.ifr_s), ifrCel(a.ifr_m),
      el("td", { class: "num" }, `${fmtNum(a.bb_largura_pct, 1)}%`),
      el("td", { class: `num ${cor(a.dist_mm50_pct)}` }, fmtPct(a.dist_mm50_pct)),
      el("td", {}, seloVerificacao(a))))));
}

function renderRetidos() {
  const lista = R.retidos;
  document.getElementById("retidos-resumo").textContent = `${lista.length} ativo(s)`;
  document.getElementById("lista-retidos").replaceChildren(...(lista.length
    ? lista.map((r) => el("li", {}, el("b", { class: "mono" }, semSufixo(r.ticker)), ` ${r.nome}: `, el("span", { class: "sub" }, r.motivo)))
    : [el("li", { class: "sub" }, "Nenhum. Todos os ativos passaram na verificação.")]));
}

// ------------------------------------------------------------- init

async function iniciar() {
  try { R = await carregarRadar(); } catch (e) { montarTopo("radar"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("radar", R);
  painel = painelGrafico(document.getElementById("painel-grafico"));

  Object.assign(estado, guardar.ler("radar-filtros", {}));
  const ligar = (id, chave, conv = (x) => x, depois) => {
    const seg = segmento(id, ({ v }) => { estado[chave] = conv(v); guardar.gravar("radar-filtros", { mercado: estado.mercado, tf: estado.tf, periodo: estado.periodo, tabela: estado.tabela }); depois(); });
    seg.marcar("v", String(estado[chave]));
  };
  ligar("f-mercado", "mercado", String, () => { renderSinais(); renderTabela(); });
  ligar("f-tf", "tf", String, renderSinais);
  ligar("f-periodo", "periodo", Number, renderSinais);
  ligar("f-tabela", "tabela", String, renderTabela);

  renderSinais();
  renderTabela();
  renderRetidos();

  const doHash = decodeURIComponent(location.hash.slice(1));
  const primeiro = document.querySelector("#lista-compra [data-tk]")?.dataset.tk;
  selecionar(porTicker.has(doHash) ? doHash : primeiro ?? R.ativos[0].ticker, false);
}

iniciar();
