/* Carteira: patrimônio, posições e sinais nos ativos acompanhados. */

let R, C, porTicker, painel;

function selecionar(tk, rolar = true) {
  const a = porTicker.get(tk);
  if (!a) return;
  guardar.gravar("carteira-ticker", tk);
  document.querySelectorAll("[data-tk]").forEach((n) => n.classList.toggle("selecionado", n.dataset.tk === tk));
  painel.selecionar(a, R.sinais.filter((s) => s.ticker === tk));
  if (rolar && window.innerWidth < 1000) document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth" });
}

function renderKPIs(c) {
  const kpi = (rotulo, valor, extra, classe = "") =>
    el("div", { class: "kpi" },
      el("div", { class: "kpi-rotulo" }, rotulo),
      el("div", { class: "kpi-valor" }, valor),
      extra ? el("div", { class: `kpi-extra ${classe}` }, extra) : null);
  document.getElementById("kpis").replaceChildren(
    kpi("Patrimônio", fmtBRL.format(c.patrimonio_brl)),
    kpi("Resultado", fmtBRL.format(c.resultado_brl), fmtPct(c.resultado_pct), cor(c.resultado_brl)),
    kpi("Investido", fmtBRL.format(c.investido_brl)),
    kpi("Caixa disponível", fmtBRL.format(c.caixa_brl)),
    kpi("Capital inicial", fmtBRL.format(c.capital_inicial)),
  );
}

function renderSinais() {
  const daCarteira = sinaisDoPeriodo(R, "D", 5).sinais.filter((s) => porTicker.get(s.ticker)?.carteira);
  const grupos = agruparSinais(daCarteira, { tf: "D" });
  const bloco = (lado, titulo) => {
    const itens = grupos[lado];
    return el("div", { class: `bloco-lado lado-${lado}` },
      el("h3", {}, titulo, " ", el("span", { class: "contagem" }, itens.length)),
      itens.length ? el("ol", { class: "cartoes" }, itens.map((i) => {
        const a = porTicker.get(i.ticker);
        return el("li", { class: `cartao ${i.familias.size >= 2 ? "confluencia" : ""}`, "data-tk": i.ticker, onclick: () => selecionar(i.ticker) },
          el("div", { class: "cartao-topo" },
            el("div", {}, el("span", { class: "cartao-ticker" }, semSufixo(i.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
            el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct))),
          el("div", { class: "chips" },
            i.familias.size >= 2 ? el("span", { class: "chip destaque" }, `★ ${i.familias.size} estratégias`) : null,
            chipsFamilias(i.familias)),
          el("ul", { class: "motivos" }, i.sinais.map((s) => el("li", {}, el("span", { class: "data" }, fmtData(s.data)), s.texto))));
      })) : el("p", { class: "vazio" }, "Nenhum sinal."));
  };
  document.getElementById("sinais-carteira").replaceChildren(
    bloco("compra", "▲ Compra"), bloco("venda", "▼ Venda"),
    el("a", { class: "link-radar", href: "radar.html" }, "Ver todas as oportunidades no Radar →"));
}

function tabela(id, colunas, linhas, aoClicar, vazio) {
  const t = document.getElementById(id);
  if (!linhas.length) {
    t.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "vazio", colspan: colunas.length }, vazio))));
    return;
  }
  t.replaceChildren(
    el("thead", {}, el("tr", {}, colunas.map((c) => el("th", { class: c.num ? "num" : "" }, c.rotulo)))),
    el("tbody", {}, linhas.map((l) =>
      el("tr", { "data-tk": l.ticker, onclick: () => aoClicar(l) }, colunas.map((c) => {
        const td = el("td", { class: [c.num ? "num" : "", c.classe ? c.classe(l) : ""].join(" ") });
        const v = c.valor(l);
        td.append(v instanceof Node ? v : document.createTextNode(v));
        return td;
      })))),
  );
}

const celTicker = (l) => el("span", { class: "ticker-cel" },
  el("b", {}, semSufixo(l.ticker)), el("span", {}, porTicker.get(l.ticker)?.nome ?? ""));

function renderPosicoes(c) {
  const vazio = el("span", {}, "Nenhuma posição ainda. Registre suas compras em ",
    el("code", {}, "config/carteira.json"), " → ", el("code", {}, "transacoes"), ".");
  tabela("tabela-posicoes", [
    { rotulo: "Ativo", valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Qtd", num: true, valor: (l) => fmtNum(l.quantidade, l.mercado === "CRIPTO" ? 6 : 0) },
    { rotulo: "Preço médio", num: true, valor: (l) => fmtMoeda(l.preco_medio, l.moeda) },
    { rotulo: "Atual", num: true, valor: (l) => el("span", { title: l.verificado ? "" : "Preço não passou na verificação de hoje" },
      fmtMoeda(l.preco_atual, l.moeda), l.verificado ? "" : " ⚠") },
    { rotulo: "Valor (R$)", num: true, valor: (l) => fmtBRL.format(l.valor_brl) },
    { rotulo: "Peso", num: true, valor: (l) => `${fmtNum(l.peso_pct, 1)}%` },
    { rotulo: "Resultado", num: true, valor: (l) => fmtBRL.format(l.resultado_brl), classe: (l) => cor(l.resultado_brl) },
    { rotulo: "%", num: true, valor: (l) => fmtPct(l.resultado_pct), classe: (l) => cor(l.resultado_pct) },
    { rotulo: "Mês", num: true, valor: (l) => fmtPct(l.var_mes_pct), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => fmtPct(l.var_ano_pct), classe: (l) => cor(l.var_ano_pct) },
  ], c.posicoes, (l) => selecionar(l.ticker), vazio);

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", CAIXA: "Caixa" };
  const total = Object.values(c.alocacao_brl).reduce((s, v) => s + v, 0) || 1;
  document.getElementById("alocacao").replaceChildren(...Object.entries(c.alocacao_brl).map(([k, v]) =>
    el("span", {}, `${nomes[k] ?? k} `, el("b", {}, `${fmtNum((v / total) * 100, 1)}%`))));

  const alvo = document.getElementById("grafico-patrimonio");
  if (c.historico.length > 1) {
    const g = LWC.createChart(alvo, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: css("--texto-fraco"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: "rgba(31,39,51,0.5)" }, horzLines: { color: "rgba(31,39,51,0.5)" } },
      rightPriceScale: { borderColor: css("--borda") },
      timeScale: { borderColor: css("--borda"), fixLeftEdge: true, fixRightEdge: true },
      localization: { locale: "pt-BR", priceFormatter: (p) => fmtBRL.format(p) },
    });
    const s = g.addSeries(LWC.BaselineSeries, {
      baseValue: { type: "price", price: c.capital_inicial },
      topLineColor: css("--alta"), topFillColor1: "rgba(38,194,129,0.25)", topFillColor2: "rgba(38,194,129,0.02)",
      bottomLineColor: css("--baixa"), bottomFillColor1: "rgba(240,80,110,0.02)", bottomFillColor2: "rgba(240,80,110,0.25)",
      lineWidth: 2, priceLineVisible: false,
    });
    s.setData(c.historico);
    requestAnimationFrame(() => g.timeScale().fitContent());
  }
}

function renderAcompanhados() {
  const linhas = R.ativos.filter((a) => a.carteira);
  const ifrCls = (x) => (x == null ? "" : x < 30 ? "alta" : x > 70 ? "baixa" : "");
  tabela("tabela-acompanhados", [
    { rotulo: "Ativo", valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Último", num: true, valor: (l) => fmtMoeda(l.ultimo, l.moeda) },
    { rotulo: "Dia", num: true, valor: (l) => fmtPct(l.var_dia_pct), classe: (l) => cor(l.var_dia_pct) },
    { rotulo: "Mês", num: true, valor: (l) => fmtPct(l.var_mes_pct), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => fmtPct(l.var_ano_pct), classe: (l) => cor(l.var_ano_pct) },
    { rotulo: "Tendência", valor: (l) => l.tendencia_forte ? `forte ${l.tendencia_forte}` : `D ${l.tend_d} · S ${l.tend_s}`,
      classe: (l) => (l.tendencia_forte === "alta" ? "alta" : l.tendencia_forte === "baixa" ? "baixa" : "") },
    { rotulo: "IFR D", num: true, valor: (l) => fmtNum(l.ifr_d, 0), classe: (l) => ifrCls(l.ifr_d) },
    { rotulo: "IFR S", num: true, valor: (l) => fmtNum(l.ifr_s, 0), classe: (l) => ifrCls(l.ifr_s) },
    { rotulo: "IFR M", num: true, valor: (l) => fmtNum(l.ifr_m, 0), classe: (l) => ifrCls(l.ifr_m) },
    { rotulo: "Da máx. 52s", num: true, valor: (l) => fmtPct(l.dist_max52_pct), classe: (l) => cor(l.dist_max52_pct) },
    { rotulo: "Dados", valor: (l) => seloVerificacao(l) },
  ], linhas, (l) => selecionar(l.ticker), "Nenhum ativo acompanhado.");
}

async function iniciar() {
  try { [R, C] = await Promise.all([carregarRadar(), carregarResumo()]); }
  catch (e) { montarTopo("carteira"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("carteira", R);
  painel = painelGrafico(document.getElementById("painel-grafico"), { simular: true });

  renderKPIs(C.carteira);
  renderSinais();
  renderPosicoes(C.carteira);
  renderAcompanhados();

  // simulações: lista, exportar/importar e atualização quando salvar/excluir no gráfico
  const abrirSimulacao = (tk) => { selecionar(tk, false); document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth" }); };
  const listarSimulacoes = () => renderListaSimulacoes(document.getElementById("lista-simulacoes"), porTicker, abrirSimulacao);
  document.addEventListener("simulacoes", listarSimulacoes);
  document.getElementById("sim-exportar").addEventListener("click", exportarSimulacoes);
  document.getElementById("sim-importar").addEventListener("change", (e) => {
    if (e.target.files[0]) importarSimulacoes(e.target.files[0], () => location.reload());
  });
  listarSimulacoes();

  const salvo = guardar.ler("carteira-ticker", null);
  const inicial = [salvo, C.carteira.posicoes[0]?.ticker, R.ativos.find((a) => a.carteira)?.ticker].find((t) => porTicker.has(t));
  if (inicial) selecionar(inicial, false);
}

iniciar();
