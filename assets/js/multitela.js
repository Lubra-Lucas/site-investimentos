/* Multitela: grade de gráficos para bater o olho nas oportunidades. */

const estado = guardar.ler("multitela", { fonte: "prioridade-compra", mercado: "", grade: "3", tf: "D", tickers: "PETR4, GOOGL, VALE3, NVDA", pagina: 0 });
let R, porTicker, carteira = [];
const abertos = [];

function listar() {
  const datas = datasSinais(R.sinais, "D");
  const ultimo = datas[0], cinco = datas[Math.min(5, datas.length) - 1];
  const doMercado = (tk) => {
    const a = porTicker.get(tk);
    return a && (!estado.mercado || a.mercado === estado.mercado);
  };
  const acao = (tk) => doMercado(tk) && porTicker.get(tk).mercado !== "CRIPTO";
  const deGrupo = (lado, desde, minimo) => agruparSinais(R.sinais, { tf: "D", desde })[lado]
    .filter((i) => i.familias.size >= minimo && acao(i.ticker))
    .map((i) => ({ ticker: i.ticker, familias: i.familias, motivo: i.sinais.map((s) => `${fmtData(s.data)} ${s.texto}`).join("\n") }));

  switch (estado.fonte) {
    case "prioridade-compra": return deGrupo("compra", cinco, 2);
    case "prioridade-venda": return deGrupo("venda", cinco, 2);
    case "compra": return deGrupo("compra", ultimo, 1);
    case "venda": return deGrupo("venda", ultimo, 1);
    case "forte-alta": return R.ativos.filter((a) => a.liquido && a.tendencia_forte === "alta" && acao(a.ticker))
      .sort((a, b) => (b.tendencia_desde ?? "").localeCompare(a.tendencia_desde ?? "")).map((a) => ({ ticker: a.ticker }));
    case "bb": return R.ativos.filter((a) => a.liquido && a.bb_comprimida && acao(a.ticker))
      .sort((a, b) => a.bb_largura_pct - b.bb_largura_pct).map((a) => ({ ticker: a.ticker }));
    case "carteira": return carteira.filter(doMercado).map((ticker) => ({ ticker }));
    case "personalizada": {
      const pedidos = estado.tickers.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      return pedidos.map((t) => [t, `${t}.SA`, t.replace(".", "-")].find((x) => porTicker.has(x)) ?? t)
        .filter(doMercado).map((ticker) => ({ ticker }));
    }
  }
  return [];
}

function celula(item) {
  const a = porTicker.get(item.ticker);
  const corpo = el("div", { class: "mini-grafico" });
  const cel = el("article", { class: `celula ${item.familias?.size >= 2 ? "confluencia" : ""}`, title: item.motivo ?? "",
    onclick: () => { location.href = `radar.html#${encodeURIComponent(item.ticker)}`; } },
    el("header", {},
      el("div", {},
        el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
      el("div", {},
        el("span", { class: "mono" }, fmtMoeda(a.ultimo, a.moeda)), " ",
        el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct)))),
    el("div", { class: "chips" },
      item.familias?.size >= 2 ? el("span", { class: "chip destaque" }, `★ ${item.familias.size}`) : null,
      item.familias ? chipsFamilias(item.familias) : null,
      el("span", { class: "chip ctx" }, `IFR D ${fmtNum(a.ifr_d, 0)}`),
      a.tendencia_forte ? el("span", { class: `chip ctx ${a.tendencia_forte}` }, `forte ${a.tendencia_forte}`) : null),
    corpo);
  corpo.abrir = () => {
    const g = new Grafico(corpo, { mini: true });
    abertos.push(g);
    g.mostrar(a.arquivo, estado.tf);
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

function render() {
  observador.disconnect();
  abertos.splice(0).forEach((g) => { graficos.delete(g); g.chart.remove(); });
  document.getElementById("caixa-personalizada").hidden = estado.fonte !== "personalizada";
  const lista = listar().filter((i) => porTicker.has(i.ticker));
  const porPagina = { 2: 4, 3: 9, 4: 12 }[estado.grade];
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  estado.pagina = Math.min(estado.pagina, paginas - 1);
  const pagina = lista.slice(estado.pagina * porPagina, (estado.pagina + 1) * porPagina);

  const grade = document.getElementById("grade");
  grade.dataset.grade = estado.grade;
  document.getElementById("f-descricao").textContent = `${lista.length} ativo(s)`;
  grade.replaceChildren(...(pagina.length ? pagina.map(celula)
    : [el("p", { class: "vazio painel" }, "Nenhum ativo nesta lista hoje.")]));
  grade.querySelectorAll(".mini-grafico").forEach((c) => observador.observe(c));

  document.getElementById("paginacao").replaceChildren(...(paginas > 1
    ? Array.from({ length: paginas }, (_, i) => el("button", { class: i === estado.pagina ? "ativo" : null,
        onclick: () => { estado.pagina = i; salvar(); render(); window.scrollTo({ top: 0 }); } }, String(i + 1)))
    : []));
}

const salvar = () => guardar.gravar("multitela", estado);

async function iniciar() {
  try { R = await carregarRadar(); } catch (e) { montarTopo("multitela"); return erroDados(e); }
  try { carteira = (await carregarResumo()).carteira.posicoes.map((p) => p.ticker); } catch {}
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("multitela", R);

  const fonte = document.getElementById("f-fonte");
  fonte.value = estado.fonte;
  fonte.addEventListener("change", () => { estado.fonte = fonte.value; estado.pagina = 0; salvar(); render(); });
  const tickers = document.getElementById("f-tickers");
  tickers.value = estado.tickers;
  tickers.addEventListener("change", () => { estado.tickers = tickers.value; salvar(); render(); });
  for (const [id, chave] of [["f-mercado", "mercado"], ["f-grade", "grade"], ["f-tf", "tf"]]) {
    segmento(id, ({ v }) => { estado[chave] = v; estado.pagina = 0; salvar(); render(); }).marcar("v", estado[chave]);
  }
  render();
}

iniciar();
