/* Carteira: o que eu tenho e acompanho. Posições, minha lista, os setups que dispararam nesses
 * ativos e as simulações. Qualquer ativo abre a página dele (ativo.html#TICKER). */

let R, porTicker;
let tfSetups = guardar.ler("carteira-tf-setups", "D");

const urlAtivo = (tk) => `ativo.html#${encodeURIComponent(tk)}`;
const abrirAtivo = (tk) => { location.href = urlAtivo(tk); };

// ------------------------------------------------------------- carteira do usuário (salva só neste navegador)
// Chaves: "carteira-usuario-v1" = { v: 1, capital: número|null, posicoes: [{ id, ticker, quantidade, preco_medio, data? }] }
//         "carteira-exemplo-v1" = o mesmo formato, só enquanto o exemplo está carregado (nunca se mistura com a carteira real).
// A carteira do arquivo config/carteira.json é do dono do site e não entra aqui.

const CHAVE_CARTEIRA = "carteira-usuario-v1";
const CHAVE_EXEMPLO = "carteira-exemplo-v1";

const lerCarteira = (chave) => {
  const v = guardar.ler(chave, null);
  const posicoes = Array.isArray(v?.posicoes) ? v.posicoes.filter((p) => p?.ticker && p.quantidade > 0 && p.preco_medio > 0) : [];
  return { capital: v?.capital > 0 ? +v.capital : null, posicoes };
};
const gravarCarteira = (chave, c) => {
  if (!c.posicoes.length && c.capital == null) { try { localStorage.removeItem(chave); } catch {} return; }
  guardar.gravar(chave, { v: 1, capital: c.capital, posicoes: c.posicoes });
};
const novoId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let real = lerCarteira(CHAVE_CARTEIRA);
let exemplo = lerCarteira(CHAVE_EXEMPLO);
/** Só mostra o exemplo enquanto não há posição real. */
const emExemplo = () => !real.posicoes.length && exemplo.posicoes.length > 0;
const atual = () => (emExemplo() ? exemplo : real);
const salvar = () => gravarCarteira(emExemplo() ? CHAVE_EXEMPLO : CHAVE_CARTEIRA, atual());

/** Texto digitado (aceita vírgula decimal) -> número, ou NaN. */
const paraNumero = (t) => {
  const x = String(t ?? "").trim().replace(/\s/g, "");
  if (!x) return NaN;
  return Number(x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x);
};

/** Posições com valores atuais, em BRL (US$ convertido pelo câmbio do dia). */
function calcular(c) {
  const usd = R.usdbrl ?? 1;
  const linhas = c.posicoes.map((p) => {
    const a = porTicker.get(p.ticker);
    const fx = (a?.moeda ?? "BRL") === "USD" ? usd : 1;
    const preco = a ? precoAtual(a).ultimo : p.preco_medio;
    const custo = p.quantidade * p.preco_medio * fx;
    const valor = p.quantidade * preco * fx;
    return { ...p, ...(a ?? { nome: "não encontrado nos dados publicados", mercado: "—", moeda: "BRL" }), ticker: p.ticker, id: p.id, pos: p,
      preco_atual: preco, custo_brl: custo, valor_brl: valor, resultado_brl: valor - custo, resultado_pct: custo ? (valor / custo - 1) * 100 : 0, ausente: !a };
  });
  const investido = linhas.reduce((s, l) => s + l.custo_brl, 0);
  const valor = linhas.reduce((s, l) => s + l.valor_brl, 0);
  const capital = c.capital ?? investido;
  const caixa = capital - investido;
  const patrimonio = valor + caixa;
  for (const l of linhas) l.peso_pct = patrimonio > 0 ? (l.valor_brl / patrimonio) * 100 : 0;
  const alocacao = {};
  for (const l of linhas) alocacao[l.mercado] = (alocacao[l.mercado] ?? 0) + l.valor_brl;
  if (caixa > 0) alocacao.CAIXA = caixa;
  return { posicoes: linhas, investido_brl: investido, valor_brl: valor, caixa_brl: caixa, capital, capital_definido: c.capital != null,
    patrimonio_brl: patrimonio, resultado_brl: valor - investido, resultado_pct: investido ? (valor / investido - 1) * 100 : 0, alocacao_brl: alocacao };
}

function renderKPIs(c) {
  const alvo = document.getElementById("kpis");
  alvo.hidden = !c.posicoes.length;
  if (!c.posicoes.length) { alvo.replaceChildren(); return; }
  const kpi = (rotulo, valor, extra, classe = "") =>
    el("div", { class: "kpi" },
      el("div", { class: "kpi-rotulo" }, rotulo),
      el("div", { class: "kpi-valor" }, valor),
      extra ? el("div", { class: `kpi-extra ${classe}` }, extra) : null);
  const editavel = !emExemplo();
  const caixaExtra = el("span", {}, c.capital_definido ? `capital ${fmtBRL.format(c.capital)}` : "capital não definido",
    editavel ? [" · ", el("button", { type: "button", class: "botao-link", onclick: editarCapital }, c.capital_definido ? "editar" : "definir")] : null);
  alvo.replaceChildren(
    kpi("Patrimônio", fmtBRL.format(c.patrimonio_brl), "posições + caixa"),
    kpi("Resultado", fmtBRL.format(c.resultado_brl), fmtPct(c.resultado_pct), cor(c.resultado_brl)),
    kpi("Investido", fmtBRL.format(c.investido_brl), `${c.posicoes.length} ${c.posicoes.length === 1 ? "posição" : "posições"}`),
    kpi("Caixa disponível", fmtBRL.format(Math.max(0, c.caixa_brl)),
      c.caixa_brl < 0 ? el("span", {}, el("span", { class: "baixa" }, `investido passa do capital em ${fmtBRL.format(-c.caixa_brl)}`), editavel ? [" · ", el("button", { type: "button", class: "botao-link", onclick: editarCapital }, "editar capital")] : null) : caixaExtra),
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
  t.classList.add("tab-cartoes");  // no celular, cada linha vira um cartão (carteira.css)
  t.replaceChildren(
    el("thead", {}, el("tr", {}, colunas.map((c) => el("th", { class: c.num ? "num" : "" }, c.rotulo)))),
    el("tbody", {}, linhas.map((l) =>
      el("tr", { "data-tk": l.ticker, onclick: (e) => { if (porTicker.has(l.ticker) && !e.target.closest("a, button")) abrirAtivo(l.ticker); } },
        colunas.map((c) => {
          const td = el("td", { class: [c.num ? "num" : "", c.cheia ? "cheia" : "", c.classe ? c.classe(l) : ""].join(" "), "data-rotulo": c.rotulo });
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

// ------------------------------------------------------------- janelas (formulários)

/** Janela modal nativa (<dialog>): foco preso e Esc fechando de graça. `campos` entram dentro do formulário. */
function janela(titulo, campos, { enviar, rotuloEnviar = "Salvar", descricao = null, aoMontar = null }) {
  const erro = el("p", { class: "cart-erro", role: "alert", hidden: true });
  const form = el("form", { class: "cart-form", method: "dialog", novalidate: true });
  const dlg = el("dialog", { class: "cart-dialogo", "aria-label": titulo }, form);
  const fechar = () => { dlg.close(); dlg.remove(); };
  form.append(
    el("div", { class: "cart-dialogo-cab" }, el("h2", {}, titulo),
      el("button", { type: "button", class: "botao-remover", "aria-label": "Fechar", onclick: fechar }, "×")),
    ...[descricao ? el("p", { class: "sub" }, descricao) : null, ...campos, erro].filter(Boolean),
    el("div", { class: "cart-acoes" },
      el("button", { type: "button", class: "botao", onclick: fechar }, "Cancelar"),
      el("button", { type: "submit", class: "botao primario" }, rotuloEnviar)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = enviar(new FormData(form));
    if (msg) { erro.textContent = msg; erro.hidden = false; return; }
    fechar();
  });
  dlg.addEventListener("cancel", () => setTimeout(() => dlg.remove(), 0));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) fechar(); });
  document.body.append(dlg);
  dlg.showModal();
  aoMontar?.(form);
  form.querySelector("input")?.focus();
  return dlg;
}

const campo = (rotulo, nome, atrs = {}, dica = null) =>
  el("label", { class: "cart-campo" }, el("span", {}, rotulo),
    el("input", { name: nome, autocomplete: "off", spellcheck: "false", ...atrs }),
    dica);

/** Adicionar (pos = null) ou editar uma posição. */
function abrirFormulario(pos = null) {
  const dica = el("small", { class: "cart-dica" });
  const rotuloPreco = el("span", {}, "Preço médio pago");
  const listaId = "cart-tickers";
  const lista = el("datalist", { id: listaId }, R.ativos.filter((a) => ["BRL", "USD"].includes(a.moeda))
    .map((a) => el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome)));
  const rotuloInicial = pos ? (porTicker.get(pos.ticker)?.rotulo ?? semSufixo(pos.ticker)) : "";
  const campoAtivo = campo("Ativo", "ativo", { list: listaId, placeholder: "PETR4, AAPL, BTC", value: rotuloInicial, required: true, "aria-describedby": "cart-dica-ativo" }, null);
  dica.id = "cart-dica-ativo";
  campoAtivo.append(dica);
  const atualizarDica = (f) => {
    const a = acharAtivo(R.ativos, f.elements.ativo.value);
    const ativo = a ? porTicker.get(a) : null;
    dica.textContent = ativo ? `${ativo.nome} · último ${fmtMoeda(precoAtual(ativo).ultimo, ativo.moeda)}` : (f.elements.ativo.value ? "Ativo não encontrado nos dados publicados." : "");
    rotuloPreco.textContent = `Preço médio pago (${ativo?.moeda === "USD" ? "US$" : "R$"})`;
  };
  const campoPreco = el("label", { class: "cart-campo" }, rotuloPreco,
    el("input", { name: "preco", inputmode: "decimal", autocomplete: "off", placeholder: "0,00", required: true, value: pos ? String(pos.preco_medio).replace(".", ",") : "" }));
  janela(pos ? "Editar posição" : "Adicionar posição", [
    campoAtivo, lista,
    el("div", { class: "cart-linha" },
      campo("Quantidade", "qtd", { inputmode: "decimal", placeholder: "100 (aceita fração: 0,5)", required: true, value: pos ? String(pos.quantidade).replace(".", ",") : "" }),
      campoPreco),
    campo("Data da compra (opcional)", "data", { type: "date", value: pos?.data ?? "", max: new Date().toLocaleDateString("sv-SE") }),
    emExemplo() ? el("p", { class: "cart-aviso" }, "Ao salvar, o exemplo é removido e a carteira passa a ser só a sua.") : null,
  ], {
    rotuloEnviar: pos ? "Salvar alterações" : "Adicionar",
    aoMontar: (f) => { atualizarDica(f); f.elements.ativo.addEventListener("input", () => atualizarDica(f)); f.elements.ativo.addEventListener("change", () => atualizarDica(f)); },
    enviar: (fd) => {
      const tk = acharAtivo(R.ativos, fd.get("ativo"));
      if (!tk) return "Não encontrei esse ativo. Digite o código, como PETR4, AAPL ou BTC.";
      if (!["BRL", "USD"].includes(porTicker.get(tk).moeda)) return "Este ativo não é negociado em reais nem em dólares; não dá para somar na carteira.";
      const qtd = paraNumero(fd.get("qtd")), pm = paraNumero(fd.get("preco"));
      if (!(qtd > 0)) return "Informe a quantidade (maior que zero).";
      if (!(pm > 0)) return "Informe o preço médio pago (maior que zero).";
      const data = fd.get("data") || null;
      if (data && data > new Date().toLocaleDateString("sv-SE")) return "A data da compra não pode ser no futuro.";
      if (emExemplo()) { exemplo = { capital: null, posicoes: [] }; gravarCarteira(CHAVE_EXEMPLO, exemplo); }
      const nova = { id: pos?.id ?? novoId(), ticker: tk, quantidade: +qtd.toFixed(8), preco_medio: +pm.toFixed(8), ...(data ? { data } : {}) };
      if (pos) real.posicoes = real.posicoes.map((p) => (p.id === pos.id ? nova : p));
      else {
        const igual = real.posicoes.find((p) => p.ticker === tk);
        if (igual) {  // mesmo ativo: soma na posição e recalcula o preço médio
          const q = igual.quantidade + nova.quantidade;
          Object.assign(igual, { quantidade: +q.toFixed(8), preco_medio: +((igual.quantidade * igual.preco_medio + nova.quantidade * nova.preco_medio) / q).toFixed(8) });
          window.avisoRapido?.(`${semSufixo(tk)} já estava na carteira: somei a quantidade e recalculei o preço médio.`);
        } else real.posicoes.push(nova);
      }
      salvar();
      renderTudo();
      return null;
    },
  });
}

function editarCapital() {
  const c = calcular(real);
  janela("Capital da carteira", [
    campo("Capital inicial (R$)", "capital", { inputmode: "decimal", placeholder: "ex.: 50.000,00", value: real.capital ? String(real.capital).replace(".", ",") : "" }),
    el("p", { class: "sub" }, `O caixa é o capital menos o que está investido (hoje ${fmtBRL.format(c.investido_brl)}). Deixe em branco para não controlar caixa.`),
  ], {
    enviar: (fd) => {
      const t = String(fd.get("capital") ?? "").trim();
      const v = t ? paraNumero(t) : null;
      if (t && !(v > 0)) return "Informe um valor maior que zero, ou deixe em branco.";
      real.capital = v;
      salvar();
      renderTudo();
      return null;
    },
  });
}

function removerPosicao(l) {
  const antes = [...real.posicoes];
  real.posicoes = real.posicoes.filter((p) => p.id !== l.id);
  salvar();
  renderTudo();
  window.avisoRapido?.(`${semSufixo(l.ticker)} removido da carteira.`, { rot: "Desfazer", fazer: () => { real.posicoes = antes; salvar(); renderTudo(); } });
}

// ------------------------------------------------------------- exemplo, backup

/** Posições de exemplo: sempre as mesmas, com preço médio em torno do preço de hoje (assim o resultado fica plausível). */
function gerarExemplo() {
  const base = [["PETR4.SA", 8000, 0.92], ["VALE3.SA", 600, 1.07], ["AAPL", 25, 0.84], ["BTC-USD", 0.04, 0.71]];
  const usd = R.usdbrl ?? 1;
  const posicoes = base.filter(([tk]) => porTicker.has(tk)).map(([tk, qtd, f], i) => {
    const a = porTicker.get(tk);
    return { id: `ex${i + 1}`, ticker: tk, quantidade: qtd, preco_medio: +(precoAtual(a).ultimo * f).toFixed(a.moeda === "USD" && precoAtual(a).ultimo < 1 ? 6 : 2) };
  });
  const investido = posicoes.reduce((s, p) => s + p.quantidade * p.preco_medio * (porTicker.get(p.ticker).moeda === "USD" ? usd : 1), 0);
  return { capital: Math.max(1000, Math.ceil((investido * 1.35) / 1000) * 1000), posicoes };
}

function verExemplo() {
  exemplo = gerarExemplo();
  if (!exemplo.posicoes.length) { window.avisoRapido?.("Não consegui montar o exemplo com os dados de hoje."); return; }
  gravarCarteira(CHAVE_EXEMPLO, exemplo);
  renderTudo();
}
function removerExemplo() {
  exemplo = { capital: null, posicoes: [] };
  gravarCarteira(CHAVE_EXEMPLO, exemplo);
  renderTudo();
}

function baixar(conteudo, nome, tipo) {
  const a = el("a", { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportarCarteira() {
  if (!real.posicoes.length && real.capital == null) { window.avisoRapido?.("Sua carteira está vazia: não há o que exportar."); return; }
  baixar(JSON.stringify({ formato: "carteira-terminal", versao: 1, exportado_em: new Date().toISOString(), capital: real.capital, posicoes: real.posicoes }, null, 2),
    `carteira-${new Date().toLocaleDateString("sv-SE")}.json`, "application/json");
}

async function importarCarteira(arquivo) {
  try {
    const d = JSON.parse(await arquivo.text());
    if (d?.formato !== "carteira-terminal" || !Array.isArray(d.posicoes)) throw new Error("este arquivo não é um backup da carteira");
    const posicoes = d.posicoes.filter((p) => p?.ticker && paraNumero(p.quantidade) > 0 && paraNumero(p.preco_medio) > 0)
      .map((p) => ({ id: novoId(), ticker: String(p.ticker), quantidade: +p.quantidade, preco_medio: +p.preco_medio, ...(/^\d{4}-\d{2}-\d{2}$/.test(p.data) ? { data: p.data } : {}) }));
    if (!posicoes.length) throw new Error("nenhuma posição válida no arquivo");
    if (real.posicoes.length && !confirm(`Substituir as ${real.posicoes.length} posições atuais por ${posicoes.length} do arquivo?`)) return;
    real = { capital: d.capital > 0 ? +d.capital : null, posicoes };
    exemplo = { capital: null, posicoes: [] };
    gravarCarteira(CHAVE_EXEMPLO, exemplo);
    gravarCarteira(CHAVE_CARTEIRA, real);
    renderTudo();
    window.avisoRapido?.(`Importado: ${posicoes.length} ${posicoes.length === 1 ? "posição" : "posições"}.`);
  } catch (e) {
    window.avisoRapido?.(`Não consegui importar: ${e.message}`);
  }
}

// ------------------------------------------------------------- posições

function renderPosicoes(c) {
  const vazia = !c.posicoes.length;
  const ex = emExemplo();
  document.getElementById("posicoes-vazio").hidden = !vazia;
  document.getElementById("posicoes-wrap").hidden = vazia;
  document.getElementById("alocacao").hidden = vazia;
  document.getElementById("cart-capital").hidden = ex || vazia;
  document.getElementById("cart-exportar").hidden = ex || vazia;
  document.getElementById("faixa-exemplo").hidden = !ex;
  if (vazia) { document.getElementById("tabela-posicoes").replaceChildren(); document.getElementById("alocacao").replaceChildren(); return; }

  const acoes = (l) => (ex ? "" : el("span", { class: "cart-linha-acoes" },
    el("button", { type: "button", class: "botao-link", "aria-label": `Editar ${semSufixo(l.ticker)}`, onclick: () => abrirFormulario(l.pos) }, "Editar"),
    el("button", { class: "botao-remover", title: `Remover ${semSufixo(l.ticker)}`, "aria-label": `Remover ${semSufixo(l.ticker)}`, onclick: () => removerPosicao(l) }, "×")));
  tabela("tabela-posicoes", [
    { rotulo: "Ativo", cheia: true, valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Qtd", num: true, valor: (l) => fmtNum(l.quantidade, Number.isInteger(l.quantidade) ? 0 : l.quantidade < 1 ? 4 : 2) },
    { rotulo: "Preço médio", num: true, valor: (l) => fmtMoeda(l.preco_medio, l.moeda) },
    { rotulo: "Atual", num: true, valor: (l) => fmtMoeda(l.preco_atual, l.moeda) },
    { rotulo: "Valor (R$)", num: true, valor: (l) => fmtBRL.format(l.valor_brl) },
    { rotulo: "Resultado", num: true, valor: (l) => fmtBRL.format(l.resultado_brl), classe: (l) => cor(l.resultado_brl) },
    { rotulo: "%", num: true, valor: (l) => fmtPct(l.resultado_pct), classe: (l) => cor(l.resultado_pct) },
    { rotulo: "Peso", num: true, valor: (l) => `${fmtNum(l.peso_pct, 1)}%` },
    { rotulo: "Setups", cheia: true, valor: (l) => chipsRecentes(l.ticker) },
    { rotulo: "", cheia: true, valor: acoes },
  ], c.posicoes, "");

  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro", CAIXA: "Caixa" };
  const total = Object.values(c.alocacao_brl).reduce((s, v) => s + v, 0) || 1;
  document.getElementById("alocacao").replaceChildren(...Object.entries(c.alocacao_brl).map(([k, v]) =>
    el("span", {}, `${nomes[k] ?? k} `, el("b", {}, `${fmtNum((v / total) * 100, 1)}%`))));
}

function renderTudo() {
  const c = calcular(atual());
  renderKPIs(c);
  renderPosicoes(c);
  renderSetups();
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
const meusTickers = () => new Set([...atual().posicoes.map((p) => p.ticker), ...tickersDaLista().filter(Boolean),
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
    el("a", { class: "link-radar", href: "setups.html" }, "Ver todas as oportunidades do mercado →"));
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
    { rotulo: "Ativo", cheia: true, valor: celTicker },
    { rotulo: "Último", num: true, cheia: true, valor: (l) => ou(l, (x) => precoComFormacao(x, "celula-preco")) },
    { rotulo: "Mês", num: true, valor: (l) => ou(l, (x) => fmtPct(x.var_mes_pct)), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => ou(l, (x) => fmtPct(x.var_ano_pct)), classe: (l) => cor(l.var_ano_pct) },
    { rotulo: "Tendência (D · S)", cheia: true, valor: (l) => ou(l, tendencia) },
    { rotulo: "Setups recentes", cheia: true, valor: (l) => ou(l, (x) => chipsRecentes(x.ticker)) },
    { rotulo: "", cheia: true, valor: remover },
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
    { rotulo: "Ativo", cheia: true, valor: celTicker },
    { rotulo: "Mercado", valor: (l) => el("span", { class: "tag" }, l.mercado) },
    { rotulo: "Último", num: true, valor: (l) => fmtMoeda(l.ultimo, l.moeda) },
    { rotulo: "Dia", num: true, valor: (l) => fmtPct(l.var_dia_pct), classe: (l) => cor(l.var_dia_pct) },
    { rotulo: "Mês", num: true, valor: (l) => fmtPct(l.var_mes_pct), classe: (l) => cor(l.var_mes_pct) },
    { rotulo: "Ano", num: true, valor: (l) => fmtPct(l.var_ano_pct), classe: (l) => cor(l.var_ano_pct) },
    { rotulo: "Tendência (diário · semanal)", cheia: true, valor: tendencia },
    { rotulo: "IFR D", num: true, valor: (l) => fmtNum(l.ifr_d, 0), classe: (l) => ifrCls(l.ifr_d) },
    { rotulo: "IFR S", num: true, valor: (l) => fmtNum(l.ifr_s, 0), classe: (l) => ifrCls(l.ifr_s) },
    { rotulo: "IFR M", num: true, valor: (l) => fmtNum(l.ifr_m, 0), classe: (l) => ifrCls(l.ifr_m) },
    { rotulo: "Da máx. 52s", num: true, valor: (l) => fmtPct(l.dist_max52_pct), classe: (l) => cor(l.dist_max52_pct) },
    { rotulo: "Setups", cheia: true, valor: (l) => chipsRecentes(l.ticker) },
    { rotulo: "Dados", valor: (l) => seloVerificacao(l) },
  ], linhas, "Nenhum ativo acompanhado.");
}

function ligarCarteira() {
  const on = (id, f) => document.getElementById(id).addEventListener("click", f);
  for (const id of ["cart-adicionar", "vazio-adicionar"]) on(id, () => abrirFormulario());
  on("vazio-exemplo", verExemplo);
  on("cart-capital", editarCapital);
  on("cart-exportar", exportarCarteira);
  on("exemplo-remover", removerExemplo);
  for (const id of ["cart-importar", "vazio-importar"]) document.getElementById(id).addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (f) importarCarteira(f);
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== CHAVE_CARTEIRA && e.key !== CHAVE_EXEMPLO) return;
    real = lerCarteira(CHAVE_CARTEIRA); exemplo = lerCarteira(CHAVE_EXEMPLO); renderTudo();
  });
}

// ------------------------------------------------------------- início

async function iniciar() {
  aguardarPagina();
  try { R = await carregarRadar(); }
  catch (e) { montarTopo("carteira"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("carteira", R);
  await carregarCatalogoSetups().catch(() => null);  // sem o catálogo, os setups aparecem pelo id
  recentesD = eventosRecentes(R, "D", 5);

  ligarCarteira();
  ligarLista();
  renderLista();
  segmento("f-tf-setups", ({ v }) => { tfSetups = v; guardar.gravar("carteira-tf-setups", v); renderSetups(); }).marcar("v", tfSetups);
  renderTudo();  // KPIs, posições e setups nos meus ativos
  renderAcompanhados();

  // simulações: lista, exportar/importar; clicar abre a página do ativo
  const listarSimulacoes = () => renderListaSimulacoes(document.getElementById("lista-simulacoes"), porTicker, abrirAtivo);
  document.getElementById("sim-exportar").addEventListener("click", exportarSimulacoes);
  document.getElementById("sim-importar").addEventListener("change", (e) => {
    if (e.target.files[0]) importarSimulacoes(e.target.files[0], listarSimulacoes);
  });
  listarSimulacoes();
  document.addEventListener("simulacoes", listarSimulacoes);  // ex.: "Virar simulação" no plano de amanhã
  // vindo de outra página com #secao-simulacoes: a seção só tem altura depois de montada
  paginaPronta();
  if (location.hash) document.querySelector(location.hash.replace(/[^#\w-]/g, ""))?.scrollIntoView();
}

iniciar();
