/* Carteira: o que eu tenho e acompanho. Posições, minha lista, os setups que dispararam nesses
 * ativos e as simulações. Qualquer ativo abre a página dele (ativo.html#TICKER). */

let R, C, porTicker;
let tfSetups = guardar.ler("carteira-tf-setups", "D");

const urlAtivo = (tk) => `ativo.html#${encodeURIComponent(tk)}`;
const abrirAtivo = (tk) => { location.href = urlAtivo(tk); };

function renderKPIs(c) {
  const kpi = (rotulo, valor, extra, classe = "") =>
    el("div", { class: "kpi" },
      el("div", { class: "kpi-rotulo" }, rotulo),
      el("div", { class: "kpi-valor" }, valor),
      extra ? el("div", { class: `kpi-extra ${classe}` }, extra) : null);
  document.getElementById("kpis").replaceChildren(
    kpi("Patrimônio", fmtBRL.format(c.patrimonio_brl), `capital inicial ${fmtBRL.format(c.capital_inicial)}`),
    kpi("Resultado", fmtBRL.format(c.resultado_brl), fmtPct(c.resultado_pct), cor(c.resultado_brl)),
    kpi("Investido", fmtBRL.format(c.investido_brl), `${c.posicoes.length} ${c.posicoes.length === 1 ? "posição" : "posições"}`),
    kpi("Caixa disponível", fmtBRL.format(c.caixa_brl)),
  );
}

// ------------------------------------------------------------- tabelas

/** Tabela clicável: a linha inteira abre o ativo (o ticker também é um link de verdade). */
function tabela(id, colunas, linhas, vazio) {
  const t = document.getElementById(id);
  if (!linhas.length) {
    t.replaceChildren(el("tbody", {}, el("tr", { class: "sem-clique" }, el("td", { class: "vazio", colspan: colunas.length }, vazio))));
    return;
  }
  t.replaceChildren(
    el("thead", {}, el("tr", {}, colunas.map((c) => el("th", { class: c.num ? "num" : "" }, c.rotulo)))),
    el("tbody", {}, linhas.map((l) =>
      el("tr", { "data-tk": l.ticker, onclick: (e) => { if (porTicker.has(l.ticker) && !e.target.closest("a, button")) abrirAtivo(l.ticker); } },
        colunas.map((c) => {
          const td = el("td", { class: [c.num ? "num" : "", c.classe ? c.classe(l) : ""].join(" ") });
          const v = c.valor(l);
          td.append(v instanceof Node ? v : document.createTextNode(v));
          return td;
        })))),
  );
}

const celTicker = (l) => (porTicker.has(l.ticker)
  ? el("span", { class: "ticker-cel-acoes" }, el("a", { class: "ticker-cel", href: urlAtivo(l.ticker), title: "Abrir a página do ativo (arraste para Comparar)" },
    el("b", {}, semSufixo(l.ticker)), el("span", {}, porTicker.get(l.ticker).nome)), window.Arrastar?.menu(l.ticker))
  : el("span", { class: "ticker-cel" }, el("b", {}, semSufixo(l.ticker)), el("span", {}, l.nome ?? "")));

const tendencia = (l) => {
  const t = (x) => el("span", { class: x === "alta" ? "alta" : x === "baixa" ? "baixa" : "fraco" }, x === "alta" ? "▲ alta" : x === "baixa" ? "▼ baixa" : "lateral");
  return el("span", { title: "Alta: acima da MM20 e da MM50; baixa: abaixo das duas" }, t(l.tend_d), " · ", t(l.tend_s));
};

function renderPosicoes(c) {
  const vazio = el("span", {}, "Você ainda não tem posições registradas. Enquanto isso, treine com ",
    el("b", {}, "⊕ Simular"), " no gráfico de um ativo. (As compras e vendas reais ficam no arquivo de configuração do site, ",
    el("code", {}, "config/carteira.json"), ".)");
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
    { rotulo: "Setups", valor: (l) => chipsRecentes(l.ticker) },
  ], c.posicoes, vazio);

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro", CAIXA: "Caixa" };
  const total = Object.values(c.alocacao_brl).reduce((s, v) => s + v, 0) || 1;
  document.getElementById("alocacao").replaceChildren(...Object.entries(c.alocacao_brl).map(([k, v]) =>
    el("span", {}, `${nomes[k] ?? k} `, el("b", {}, `${fmtNum((v / total) * 100, 1)}%`))));

  const alvo = document.getElementById("grafico-patrimonio");
  if (c.historico.length > 1) {
    const g = LWC.createChart(alvo, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: css("--texto-fraco"), fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
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

// ------------------------------------------------------------- setups (eventos do catálogo)

let recentesD = new Map();

/** Chips dos setups do ativo nos últimos 5 pregões (diário), um por setup; o resto vai num "+n". */
function chipsRecentes(tk, max = 3) {
  const grupos = agruparPorSetup(recentesD.get(tk) ?? []);
  if (!grupos.length) return el("span", { class: "fraco" }, "—");
  const titulo = (g) => `${setaLado(g.lado)}${nomeSetup(g.setup)}: ${g.eventos.map((e) => fmtData(e.data)).join(", ")}`;
  return el("span", { class: "chips chips-linha" },
    grupos.slice(0, max).map((g) => el("span", { class: `chip evento ${g.lado}`, title: titulo(g) }, setaLado(g.lado), nomeSetup(g.setup))),
    grupos.length > max ? el("span", { class: "chip", title: grupos.slice(max).map(titulo).join("\n") }, `+${grupos.length - max}`) : null);
}

/** Os tickers "meus": posições, minha lista e acompanhados da configuração. */
const meusTickers = () => new Set([...C.carteira.posicoes.map((p) => p.ticker), ...tickersDaLista().filter(Boolean),
  ...R.ativos.filter((a) => a.carteira).map((a) => a.ticker)]);

/** Setups recentes nos meus ativos, por lado e estilo (a favor / contra a tendência). */
function renderSetups() {
  const n = tfSetups === "D" ? 5 : 2;
  const recentes = eventosRecentes(R, tfSetups, n);
  const meus = meusTickers();
  document.getElementById("setups-sub").textContent =
    `${tfSetups === "D" ? "Últimos 5 pregões" : "Últimas 2 semanas"} · posições, minha lista e acompanhados (${meus.size})`;
  const blocos = [];
  const ESTILOS = [["tendencia", "a favor da tendência"], ["contra", "contra a tendência"], [null, ""]];
  for (const lado of ["compra", "venda", "neutro"]) {
    for (const [estilo, nome] of ESTILOS) {
      const itens = [];
      for (const tk of meus) {
        const evs = (recentes.get(tk) ?? []).filter((e) => e.lado === lado &&
          (estilo ? SETUP_POR_ID.get(e.setup)?.estilo === estilo : !["tendencia", "contra"].includes(SETUP_POR_ID.get(e.setup)?.estilo)));
        if (evs.length && porTicker.has(tk)) itens.push({ ticker: tk, evs, setups: new Set(evs.map((e) => e.setup)) });
      }
      if (!itens.length) continue;
      itens.sort((x, y) => y.setups.size - x.setups.size || y.evs[0].data.localeCompare(x.evs[0].data) || x.ticker.localeCompare(y.ticker));
      const titulo = lado === "compra" ? "▲ Compra" : lado === "venda" ? "▼ Venda" : "◆ Neutro";
      blocos.push(el("div", { class: `bloco-lado lado-${lado}` },
        el("h3", {}, `${titulo} `, nome ? el("span", { class: "estilo-nome" }, nome) : null, " ", el("span", { class: "contagem" }, itens.length)),
        el("ol", { class: "cartoes" }, itens.map((i) => {
          const a = porTicker.get(i.ticker);
          return el("li", { class: `cartao ${i.setups.size >= 2 ? "confluencia" : ""}` },
            el("a", { class: "cartao-link", href: urlAtivo(i.ticker), title: "Abrir a página do ativo" },
              el("div", { class: "cartao-topo" },
                el("div", {}, el("span", { class: "cartao-ticker" }, semSufixo(i.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
                el("span", { class: `mono ${cor(a.var_dia_pct)}` }, fmtPct(a.var_dia_pct))),
              i.setups.size >= 2 ? el("div", { class: "chips" }, el("span", { class: "chip destaque" }, `${i.setups.size} setups`)) : null,
              el("ul", { class: "motivos" }, agruparPorSetup(i.evs).slice(0, 4).map((g) => el("li", {}, el("span", { class: "data" }, fmtData(g.ultima)),
                nomeSetup(g.setup), g.eventos.length > 1 ? el("span", { class: "fraco" }, ` · ${g.eventos.length}×`) : null, " ", seloEvento(g.eventos[0]))))));
        }))));
    }
  }
  document.getElementById("setups-carteira").replaceChildren(
    ...(blocos.length ? blocos : [el("p", { class: "vazio" }, `Nenhum setup nos seus ativos ${tfSetups === "D" ? "nos últimos 5 pregões" : "nas últimas 2 semanas"}.`)]),
    el("a", { class: "link-radar", href: "setups.html" }, "Ver todos os setups do mercado →"));
}

// ------------------------------------------------------------- minha lista

/** Ticker de cada item da lista (null quando o que foi digitado não existe nos dados). */
const tickersDaLista = () => MinhaLista.ler().map((t) => acharAtivo(R.ativos, t));

function renderLista() {
  const rotulos = MinhaLista.ler();
  const linhas = rotulos.map((rot) => {
    const tk = acharAtivo(R.ativos, rot);
    return tk ? { ...porTicker.get(tk), rot } : { ticker: rot, rot, nome: "não encontrado nos dados publicados", ausente: true };
  });
  const remover = (l) => el("button", { class: "botao-remover", title: `Tirar ${semSufixo(l.ticker)} da lista`, "aria-label": `Tirar ${semSufixo(l.ticker)} da lista`,
    onclick: () => { MinhaLista.gravar(MinhaLista.ler().filter((x) => x !== l.rot)); renderLista(); renderSetups(); } }, "×");
  const ou = (l, f) => (l.ausente ? "" : f(l));
  tabela("tabela-lista", [
    { rotulo: "Ativo", valor: celTicker },
    { rotulo: "Último", num: true, valor: (l) => ou(l, (x) => precoComFormacao(x, "celula-preco")) },
    { rotulo: "Mês", num: true, valor: (l) => ou(l, (x) => fmtPct(x.var_mes_pct)), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => ou(l, (x) => fmtPct(x.var_ano_pct)), classe: (l) => cor(l.var_ano_pct) },
    { rotulo: "Tendência (D · S)", valor: (l) => ou(l, tendencia) },
    { rotulo: "Setups recentes", valor: (l) => ou(l, (x) => chipsRecentes(x.ticker)) },
    { rotulo: "", valor: remover },
  ], linhas, "Sua lista está vazia. Digite um ticker acima e clique em Adicionar.");
}

function ligarLista() {
  document.getElementById("lista-tickers").replaceChildren(...R.ativos.map((a) =>
    el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome)));
  const campo = document.getElementById("lista-campo");
  document.getElementById("lista-adicionar").addEventListener("submit", (e) => {
    e.preventDefault();
    const tk = acharAtivo(R.ativos, campo.value);
    if (!tk) { campo.setCustomValidity("Ativo não encontrado"); campo.reportValidity(); campo.setCustomValidity(""); return; }
    const atuais = MinhaLista.ler();
    if (!atuais.some((t) => acharAtivo(R.ativos, t) === tk)) MinhaLista.gravar([...atuais, porTicker.get(tk).rotulo ?? semSufixo(tk)]);
    campo.value = "";
    renderLista();
    renderSetups();
  });
}

// ------------------------------------------------------------- acompanhados

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
    { rotulo: "Tendência (diário · semanal)", valor: tendencia },
    { rotulo: "IFR D", num: true, valor: (l) => fmtNum(l.ifr_d, 0), classe: (l) => ifrCls(l.ifr_d) },
    { rotulo: "IFR S", num: true, valor: (l) => fmtNum(l.ifr_s, 0), classe: (l) => ifrCls(l.ifr_s) },
    { rotulo: "IFR M", num: true, valor: (l) => fmtNum(l.ifr_m, 0), classe: (l) => ifrCls(l.ifr_m) },
    { rotulo: "Da máx. 52s", num: true, valor: (l) => fmtPct(l.dist_max52_pct), classe: (l) => cor(l.dist_max52_pct) },
    { rotulo: "Setups", valor: (l) => chipsRecentes(l.ticker) },
    { rotulo: "Dados", valor: (l) => seloVerificacao(l) },
  ], linhas, "Nenhum ativo acompanhado.");
}

// ------------------------------------------------------------- início

async function iniciar() {
  try { [R, C] = await Promise.all([carregarRadar(), carregarResumo()]); }
  catch (e) { montarTopo("carteira"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("carteira", R);
  await carregarCatalogoSetups().catch(() => null);  // sem o catálogo, os setups aparecem pelo id
  recentesD = eventosRecentes(R, "D", 5);

  renderKPIs(C.carteira);
  renderPosicoes(C.carteira);
  ligarLista();
  renderLista();
  segmento("f-tf-setups", ({ v }) => { tfSetups = v; guardar.gravar("carteira-tf-setups", v); renderSetups(); }).marcar("v", tfSetups);
  renderSetups();
  renderAcompanhados();

  // simulações: lista, exportar/importar; clicar abre a página do ativo
  const listarSimulacoes = () => renderListaSimulacoes(document.getElementById("lista-simulacoes"), porTicker, abrirAtivo);
  document.getElementById("sim-exportar").addEventListener("click", exportarSimulacoes);
  document.getElementById("sim-importar").addEventListener("change", (e) => {
    if (e.target.files[0]) importarSimulacoes(e.target.files[0], listarSimulacoes);
  });
  listarSimulacoes();
  // vindo de outra página com #secao-simulacoes: a seção só tem altura depois de montada
  if (location.hash) document.querySelector(location.hash.replace(/[^#\w-]/g, ""))?.scrollIntoView();
}

iniciar();
