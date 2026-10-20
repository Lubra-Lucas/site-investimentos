/* Multitela: grade de gráficos interativos para bater o olho em várias ações de uma vez. */

const FONTES = [
  { grupo: "Oportunidades", itens: [
    ["compra", "▲ Oportunidades de compra", "Ações com sinal de compra (qualquer estratégia)"],
    ["venda", "▼ Oportunidades de venda", "Ações com sinal de venda (qualquer estratégia)"],
  ] },
  { grupo: "Panorama", itens: [
    ["forte-alta", "Tendência forte de alta", "Acima da MM20 e da MM50 no diário e no semanal"],
    ["forte-baixa", "Tendência forte de baixa", "Abaixo da MM20 e da MM50 no diário e no semanal"],
    ["bb", "Bollinger comprimida", "Bandas estreitas no tempo gráfico escolhido"],
  ] },
  { grupo: "Meus ativos", itens: [
    ["carteira", "Minha carteira", "As posições registradas na Carteira"],
    ["simulacoes", "Minhas simulações", "Os ativos com simulações salvas no gráfico do Radar"],
    ["personalizada", "Minha lista", "Os ativos que você digitar"],
  ] },
];
const ANTIGAS = { "prioridade-compra": ["compra", true], "prioridade-venda": ["venda", true] };

const estado = guardar.ler("multitela", { fonte: "compra", confluencia: true, pregoes: "5", mercado: "", grade: "3", tf: "D",
  tickers: "PETR4, GOOGL, VALE3, NVDA", pagina: 0 });
if (ANTIGAS[estado.fonte]) [estado.fonte, estado.confluencia] = ANTIGAS[estado.fonte];  // opção da versão anterior
estado.pregoes ??= "5";
let R, porTicker, carteira = [];
const abertos = [];

const ehOportunidade = () => estado.fonte === "compra" || estado.fonte === "venda";

function listar() {
  const doMercado = (tk) => {
    const a = porTicker.get(tk);
    return a && (!estado.mercado || a.mercado === estado.mercado);
  };
  const ativos = (filtro) => R.ativos.filter((a) => a.liquido && doMercado(a.ticker) && filtro(a));
  // sinais só existem no diário e no semanal; 60m/4h usam os do diário
  const tfSinal = estado.tf === "W" ? "S" : "D";

  switch (estado.fonte) {
    case "compra":
    case "venda":
      return agruparSinais(sinaisDoPeriodo(R, tfSinal, +estado.pregoes).sinais, { tf: tfSinal })[estado.fonte]
        .filter((i) => doMercado(i.ticker) && (!estado.confluencia || i.familias.size >= 2))
        .map((i) => ({ ticker: i.ticker, familias: i.familias, lado: estado.fonte, sinais: i.sinais }));
    case "forte-alta":
    case "forte-baixa": {
      const lado = estado.fonte === "forte-alta" ? "alta" : "baixa";
      return ativos((a) => a.tendencia_forte === lado)
        .sort((a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? "")).map((a) => ({ ticker: a.ticker }));
    }
    case "bb": {
      const bb = (a) => a.bb_tf?.[estado.tf];
      return ativos((a) => bb(a)?.comprimida).sort((a, b) => bb(a).largura_pct - bb(b).largura_pct).map((a) => ({ ticker: a.ticker }));
    }
    case "carteira": return carteira.filter(doMercado).map((ticker) => ({ ticker }));
    case "simulacoes": {
      // a simulação mais recente primeiro
      const recentes = Simulacoes.todas().sort((a, b) => b.criada.localeCompare(a.criada) || b.id.localeCompare(a.id));
      return [...new Set(recentes.map((p) => p.ticker))].filter(doMercado).map((ticker) => ({ ticker }));
    }
    case "personalizada": {
      const pedidos = estado.tickers.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      const porRotulo = new Map(R.ativos.map((a) => [(a.rotulo ?? a.ticker).toUpperCase(), a.ticker]));
      return pedidos.map((t) => [t, `${t}.SA`, t.replace(".", "-"), porRotulo.get(t)].find((x) => porTicker.has(x)) ?? t)
        .filter(doMercado).map((ticker) => ({ ticker }));
    }
  }
  return [];
}

function celula(item) {
  const a = porTicker.get(item.ticker);
  const corpo = el("div", { class: "mini-grafico" });
  const cel = el("article", { class: `celula ${item.familias?.size >= 2 ? "confluencia" : ""}` },
    el("header", {},
      el("div", {},
        el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
      el("div", { class: "celula-acoes" },
        precoComFormacao(a, "celula-preco"),
        botaoTelaCheia(() => cel),
        el("a", { class: "abrir-radar", href: `radar.html?ativo#${encodeURIComponent(item.ticker)}`, title: "Abrir no Radar com os dados deste ativo" }, "↗"))),
    el("div", { class: "chips" },
      item.familias?.size >= 2 ? el("span", { class: "chip destaque" }, `★ ${item.familias.size}`) : null,
      item.familias ? chipsFamilias(item.familias, item.lado) : null,
      el("span", { class: "chip ctx" }, `IFR D ${fmtNum(a.ifr_d, 0)}`),
      a.tendencia_forte ? el("span", { class: `chip ctx ${a.tendencia_forte}` }, `forte ${a.tendencia_forte}`) : null),
    item.sinais ? el("ul", { class: "motivos celula-motivos" }, item.sinais.slice(0, 3).map((s) =>
      el("li", {}, el("span", { class: "data" }, fmtData(s.data)), s.texto))) : null,
    chipsSimulacoes(a),
    corpo);
  corpo.abrir = () => {
    const g = new Grafico(corpo, { mini: true });
    g.sinais = R.sinais.filter((s) => s.ticker === a.ticker);
    abertos.push(g);
    if (Simulacoes.doAtivo(a.ticker).length) new Simulador(g, corpo).definirAtivo(a);
    // ativo sem intraday verificado cai para o diário
    g.mostrar(a.arquivo, INTRADAY.has(estado.tf) && !a.tem_intraday ? "D" : estado.tf);
  };
  return cel;
}

// Cria cada gráfico só quando a célula aparece na tela
const observador = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    observador.unobserve(e.target);
    e.target.abrir();
  }
}, { rootMargin: "200px" });

function renderFontes() {
  document.getElementById("f-fonte").replaceChildren(...FONTES.map((g) =>
    el("div", { class: "grupo-fonte" }, el("span", { class: "grupo-fonte-nome" }, g.grupo),
      el("div", { class: "grupo-fonte-itens" }, g.itens.map(([k, rot, dica]) =>
        el("button", { class: `fonte ${k === estado.fonte ? "ativo" : ""} fonte-${k}`, title: dica,
          onclick: () => { estado.fonte = k; estado.pagina = 0; salvar(); renderFontes(); render(); } }, rot))))));
  document.getElementById("opcoes-oportunidades").hidden = !ehOportunidade();
  document.getElementById("caixa-personalizada").hidden = estado.fonte !== "personalizada";
}

function descricao(n) {
  const tfNome = ROTULO_TF_FRASE[estado.tf] ?? estado.tf;
  const fonte = FONTES.flatMap((g) => g.itens).find(([k]) => k === estado.fonte);
  let txt = `${n} ativo(s) · ${fonte?.[1].replace(/^[▲▼] /, "") ?? ""}`;
  if (ehOportunidade()) {
    txt += ` no sinal ${estado.tf === "W" ? "semanal" : "diário"}` +
      `, ${estado.pregoes === "1" ? "último pregão" : "últimos 5 pregões"}${estado.confluencia ? ", só com 2+ estratégias" : ""}`;
    if (INTRADAY.has(estado.tf)) txt += " (no 60m/4h, valem os sinais do diário)";
  } else if (estado.fonte === "bb") txt += ` no ${tfNome}`;
  return txt;
}

function render() {
  observador.disconnect();
  abertos.splice(0).forEach((g) => g.remover());
  const lista = listar().filter((i) => porTicker.has(i.ticker));
  const porPagina = { 2: 4, 3: 9, 4: 12 }[estado.grade];
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  estado.pagina = Math.min(estado.pagina, paginas - 1);
  const pagina = lista.slice(estado.pagina * porPagina, (estado.pagina + 1) * porPagina);

  const grade = document.getElementById("grade");
  grade.dataset.grade = estado.grade;
  document.getElementById("f-descricao").textContent = descricao(lista.length);
  grade.replaceChildren(...(pagina.length ? pagina.map(celula)
    : [el("p", { class: "vazio painel" }, ehOportunidade() && estado.confluencia
      ? "Nenhuma ação com 2+ estratégias no período. Desmarque \"Só com confluência\" ou aumente o período."
      : "Nenhum ativo nesta lista hoje.")]));
  grade.querySelectorAll(".mini-grafico").forEach((c) => observador.observe(c));

  totalPaginas = paginas;
  document.getElementById("paginacao").replaceChildren(...(paginas > 1
    ? Array.from({ length: paginas }, (_, i) => el("button", { class: i === estado.pagina ? "ativo" : null,
        onclick: () => irParaPagina(i, true) }, String(i + 1)))
    : []));
  // atalho no topo: ‹ 1/3 › (e as setas do teclado) para não precisar rolar até o fim
  document.getElementById("paginacao-topo").replaceChildren(...(paginas > 1 ? [
    el("button", { disabled: estado.pagina === 0, title: "Página anterior (←)", onclick: () => irParaPagina(estado.pagina - 1) }, "‹"),
    el("span", { class: "mono" }, `${estado.pagina + 1}/${paginas}`),
    el("button", { disabled: estado.pagina === paginas - 1, title: "Próxima página (→)", onclick: () => irParaPagina(estado.pagina + 1) }, "›"),
  ] : []));
}

let totalPaginas = 1;
function irParaPagina(i, topo = false) {
  if (i < 0 || i >= totalPaginas || i === estado.pagina) return;
  estado.pagina = i;
  salvar();
  render();
  if (topo) window.scrollTo({ top: 0 });
}

// ← e → trocam de página (fora de campos de texto e da tela cheia de um gráfico)
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.fullscreenElement) return;
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowRight") { e.preventDefault(); irParaPagina(estado.pagina + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); irParaPagina(estado.pagina - 1); }
});

const salvar = () => guardar.gravar("multitela", estado);

async function iniciar() {
  try { R = await carregarRadar(); } catch (e) { montarTopo("multitela"); return erroDados(e); }
  try { carteira = (await carregarResumo()).carteira.posicoes.map((p) => p.ticker); } catch {}
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("multitela", R);
  document.getElementById("f-descricao").after(avisoFormacao(R));
  document.getElementById("f-indicadores").replaceChildren(atalhosIndicadores({ comSinais: true, comIFR: false }));

  renderFontes();
  const tickers = document.getElementById("f-tickers");
  tickers.value = estado.tickers;
  tickers.addEventListener("change", () => { estado.tickers = tickers.value; salvar(); render(); });
  const confluencia = document.getElementById("f-confluencia");
  confluencia.checked = estado.confluencia;
  confluencia.addEventListener("change", () => { estado.confluencia = confluencia.checked; estado.pagina = 0; salvar(); render(); });
  for (const [id, chave] of [["f-mercado", "mercado"], ["f-grade", "grade"], ["f-tf", "tf"], ["f-pregoes", "pregoes"]]) {
    segmento(id, ({ v }) => { estado[chave] = v; estado.pagina = 0; salvar(); render(); }).marcar("v", estado[chave]);
  }
  render();
}

iniciar();
