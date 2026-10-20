/* Multitela: rastreador de ativos. A grade mostra, lado a lado, todos os ativos que atendem
 * a uma condição (modelo pronto ou regras do usuário, no diário ou no semanal), com o contexto
 * de cada um para decidir qual está melhor. Também lista oportunidades das estratégias e os
 * ativos do usuário. */

const FONTES = [
  { grupo: "Rastreador", itens: [
    ["rastreador", "⌕ Rastrear condição", "Ativos que atendem às regras escolhidas (modelo pronto ou suas regras)"],
  ] },
  { grupo: "Oportunidades das estratégias", itens: [
    ["compra", "▲ Oportunidades de compra", "Ações com sinal de compra (qualquer estratégia)"],
    ["venda", "▼ Oportunidades de venda", "Ações com sinal de venda (qualquer estratégia)"],
  ] },
  { grupo: "Meus ativos", itens: [
    ["carteira", "Minha carteira", "As posições registradas na Carteira"],
    ["simulacoes", "Minhas simulações", "Os ativos com simulações salvas no gráfico do Radar"],
    ["personalizada", "Minha lista", "Os ativos que você digitar"],
  ] },
];
// opções de versões anteriores
const ANTIGAS = { "prioridade-compra": ["compra", true], "prioridade-venda": ["venda", true] };
const PANORAMA_ANTIGO = { "forte-alta": "tend-alta-forte", "forte-baixa": "tend-baixa-forte", bb: "comprimida" };

const estado = guardar.ler("multitela", { fonte: "rastreador", confluencia: true, pregoes: "5", mercado: "", grade: "3", tf: "D",
  tickers: "PETR4, GOOGL, VALE3, NVDA", pagina: 0 });
if (ANTIGAS[estado.fonte]) [estado.fonte, estado.confluencia] = ANTIGAS[estado.fonte];
if (PANORAMA_ANTIGO[estado.fonte]) { estado.rast = { modelo: `m:${PANORAMA_ANTIGO[estado.fonte]}` }; estado.fonte = "rastreador"; }
estado.pregoes ??= "5";
estado.ordem ??= "var_mes";
let R, F, porTicker, carteira = [];
const abertos = [];

const ehOportunidade = () => estado.fonte === "compra" || estado.fonte === "venda";

// ------------------------------------------------------------- regras do rastreador

const SALVOS = "rastreador-salvos";
const salvos = () => guardar.ler(SALVOS, []);

/** Regras em uso: o modelo escolhido, ou a versão editada dele. */
function regrasAtuais() {
  const r = estado.rast ??= {};
  r.tf ??= "D";
  r.modelo ??= "m:tend-alta";
  if (!r.regras) {
    const base = modeloEscolhido();
    r.regras = structuredClone(base?.regras ?? MODELO_POR_ID.get("tend-alta").regras);
    r.vies = base?.vies ?? "compra";
  }
  return r;
}

function modeloEscolhido() {
  const [tipo, id] = (estado.rast?.modelo ?? "m:tend-alta").split(":");
  return tipo === "m" ? MODELO_POR_ID.get(id) : salvos().find((x) => x.id === id);
}

function escolherModelo(valor) {
  estado.rast.modelo = valor;
  const m = modeloEscolhido() ?? MODELO_POR_ID.get("tend-alta");
  estado.rast.regras = structuredClone(m.regras);
  estado.rast.vies = m.vies;
  estado.rast.editado = false;
  estado.pagina = 0;
}

const ORDENS = {
  var_mes: ["Maior alta no mês", (a) => -(a.var_mes_pct ?? -1e9)],
  var_mes_baixa: ["Maior queda no mês", (a) => a.var_mes_pct ?? 1e9],
  var_ano: ["Maior alta no ano", (a) => -(a.var_ano_pct ?? -1e9)],
  var_dia: ["Maior alta no dia", (a) => -(a.var_dia_pct ?? -1e9)],
  tendencia: ["Há mais tempo em tendência", (a, s) => -((s?.alta ?? s?.baixa)?.n ?? 0)],
  ifr_baixo: ["IFR 14 mais baixo", (a, s) => ult(s?.ifr?.[14]) ?? 999],
  ifr_alto: ["IFR 14 mais alto", (a, s) => -(ult(s?.ifr?.[14]) ?? -999)],
  perto_mm20: ["Mais perto da MMS 20", (a, s) => Math.abs(pct(ult(s?.c), ult(s?.sma?.[20])) ?? 999)],
  volume: ["Maior volume relativo", (a, s) => -(s?.vr ?? 0)],
  nome: ["Nome", (a) => semSufixo(a.ticker)],
};

// ------------------------------------------------------------- lista

function listar() {
  const doMercado = (tk) => {
    const a = porTicker.get(tk);
    return a && (!estado.mercado || a.mercado === estado.mercado);
  };
  // sinais só existem no diário e no semanal; 60m/4h usam os do diário
  const tfSinal = estado.tf === "W" ? "S" : "D";

  switch (estado.fonte) {
    case "rastreador": {
      if (!F) return [];
      const { tf, regras } = regrasAtuais();
      const chave = ORDENS[estado.ordem]?.[1] ?? ORDENS.var_mes[1];
      const nota = (a) => chave(a, F.ativos[a.ticker]?.[tf]);
      return R.ativos.filter((a) => a.liquido && doMercado(a.ticker) && atende(F.ativos[a.ticker]?.[tf], regras, tf, F))
        .sort((a, b) => { const x = nota(a), y = nota(b); return typeof x === "string" ? x.localeCompare(y) : x - y; })
        .map((a) => ({ ticker: a.ticker }));
    }
    case "compra":
    case "venda":
      return agruparSinais(sinaisDoPeriodo(R, tfSinal, +estado.pregoes).sinais, { tf: tfSinal })[estado.fonte]
        .filter((i) => doMercado(i.ticker) && (!estado.confluencia || i.familias.size >= 2))
        .map((i) => ({ ticker: i.ticker, familias: i.familias, lado: estado.fonte, sinais: i.sinais }));
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

// ------------------------------------------------------------- célula

/** Viés da lista: define o que é "a favor" e o que é "cuidado" no contexto de cada ativo. */
function viesAtual() {
  if (estado.fonte === "rastreador") return regrasAtuais().vies;
  if (ehOportunidade()) return estado.fonte;
  return "neutro";
}

/** Tempo gráfico do contexto: o das regras no rastreador; nos demais, o do gráfico (60m/4h -> diário). */
const tfContexto = () => (estado.fonte === "rastreador" ? regrasAtuais().tf : estado.tf === "W" ? "W" : "D");

function blocoContexto(a) {
  const fotos = F?.ativos[a.ticker];
  if (!fotos) return null;
  const tf = tfContexto();
  const { favor, cuidado, info } = contextoDecisao(a, fotos, tf, viesAtual(), R.sinais.filter((s) => s.ticker === a.ticker));
  const lista = (itens, cls, simbolo, max) => (itens.length ? el("ul", { class: `contexto-lista ${cls}` },
    itens.slice(0, max).map((t) => el("li", {}, el("span", { class: "simbolo" }, simbolo), t)),
    itens.length > max ? el("li", { class: "mais", title: itens.slice(max).join("\n") }, `+${itens.length - max}`) : null) : null);
  return el("div", { class: "contexto-decisao" },
    lista(favor, "favor", "✓", 4), lista(cuidado, "cuidado", "⚠", 4), lista(info, "info", "·", 4));
}

/** Os valores que fizeram o ativo passar nas regras (ex.: "+3,2% da MMS 20 · IFR 14 27"). */
function blocoRegras(a) {
  if (estado.fonte !== "rastreador" || !F) return null;
  const { tf, regras } = regrasAtuais();
  const s = F.ativos[a.ticker]?.[tf];
  const valores = [...new Set(regras.map((x) => valorRegra(s, x, tf, F)).filter(Boolean))];
  return valores.length ? el("p", { class: "valores-regra mono" }, `${TF_FRASE[tf]}: ${valores.join(" · ")}`) : null;
}

function legendaExtras(extras) {
  return extras.length ? el("div", { class: "legenda-extras" }, extras.map((m) =>
    el("span", {}, el("i", { style: `background:${m.cor}` }), nomeMedia(m.id)))) : null;
}

function celula(item) {
  const a = porTicker.get(item.ticker);
  const corpo = el("div", { class: "mini-grafico" });
  const extras = estado.fonte === "rastreador" ? mediasDasRegras(regrasAtuais().regras) : [];
  const cel = el("article", { class: `celula ${item.familias?.size >= 2 ? "confluencia" : ""}` },
    el("header", {},
      el("div", {},
        el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
      el("div", { class: "celula-acoes" },
        precoComFormacao(a, "celula-preco"),
        botaoTelaCheia(() => cel),
        el("a", { class: "abrir-radar", href: `radar.html?ativo#${encodeURIComponent(item.ticker)}`, title: "Abrir no Radar com os dados deste ativo" }, "↗"))),
    item.familias ? el("div", { class: "chips" },
      item.familias.size >= 2 ? el("span", { class: "chip destaque" }, `★ ${item.familias.size}`) : null,
      chipsFamilias(item.familias, item.lado)) : null,
    item.sinais ? el("ul", { class: "motivos celula-motivos" }, item.sinais.slice(0, 3).map((s) =>
      el("li", {}, el("span", { class: "data" }, fmtData(s.data)), s.texto))) : null,
    blocoRegras(a),
    blocoContexto(a),
    chipsSimulacoes(a),
    legendaExtras(extras),
    corpo);
  corpo.abrir = () => {
    const g = new Grafico(corpo, { mini: true });
    g.sinais = R.sinais.filter((s) => s.ticker === a.ticker);
    g.definirMediasExtras(extras);
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

// ------------------------------------------------------------- menu

function renderFontes() {
  document.getElementById("f-fonte").replaceChildren(...FONTES.map((g) =>
    el("div", { class: "grupo-fonte" }, el("span", { class: "grupo-fonte-nome" }, g.grupo),
      el("div", { class: "grupo-fonte-itens" }, g.itens.map(([k, rot, dica]) =>
        el("button", { class: `fonte ${k === estado.fonte ? "ativo" : ""} fonte-${k}`, title: dica,
          onclick: () => { estado.fonte = k; estado.pagina = 0; salvar(); renderFontes(); render(); } }, rot))))));
  document.getElementById("opcoes-oportunidades").hidden = !ehOportunidade();
  document.getElementById("caixa-personalizada").hidden = estado.fonte !== "personalizada";
  document.getElementById("caixa-rastreador").hidden = estado.fonte !== "rastreador";
  if (estado.fonte === "rastreador") renderRastreador();
}

/** Um campo do editor de regras (select, número ou média = tipo + período). */
function campoRegra(x, c, aoMudar) {
  const def = CONDICOES[x.t];
  const tf = regrasAtuais().tf;
  const select = (opcoes, valor, mudar, rotulo) => el("select", { "aria-label": rotulo ?? c.k, onchange: (e) => mudar(e.target.value) },
    opcoes.map(([v, t]) => el("option", { value: v, selected: String(v) === String(valor) ? true : null }, t)));
  if (c.tipo === "media") {
    const { tipo, n } = lerMedia(x[c.k]);
    return el("span", { class: "campo-media" },
      select([["sma", "MMS"], ["ema", "MME"]], tipo, (v) => { x[c.k] = `${v}${n}`; aoMudar(); }, "Tipo de média"),
      select(F.periodos_mm.map((p) => [p, String(p)]), n, (v) => { x[c.k] = `${tipo}${v}`; aoMudar(); }, "Período"));
  }
  if (c.tipo === "num") {
    return el("span", { class: "campo-num" }, c.rot ? `${c.rot} ` : null,
      el("input", { type: "number", step: c.passo, value: x[c.k], "aria-label": c.rot || c.k,
        onchange: (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { x[c.k] = v; aoMudar(); } } }),
      c.sufixo ? ` ${c.sufixo}` : null);
  }
  const opcoes = c.opcoes ?? def.opcoes[c.k](F, tf);
  // janela que não existe neste tempo gráfico vira a mais próxima (21 pregões -> 4 semanas)
  if (c.k === "janela") x.janela = janelaProxima(opcoes.map(([v]) => +v), x.janela);
  return el("span", { class: "campo-sel" }, c.rot ? `${c.rot} ` : null,
    select(opcoes, x[c.k], (v) => { x[c.k] = Number.isNaN(+v) ? v : +v; aoMudar(); }, c.rot));
}

function renderRastreador() {
  if (!F) return;
  const r = regrasAtuais();
  const m = modeloEscolhido();
  const mudou = () => { r.editado = true; estado.pagina = 0; salvar(); renderRastreador(); render(); };

  // modelos prontos + regras salvas
  const sel = document.getElementById("f-modelo");
  sel.replaceChildren(
    ...MODELOS.map((g) => el("optgroup", { label: g.grupo }, g.itens.map((x) =>
      el("option", { value: `m:${x.id}`, selected: r.modelo === `m:${x.id}` ? true : null }, x.nome)))),
    salvos().length ? el("optgroup", { label: "Minhas regras" }, salvos().map((x) =>
      el("option", { value: `u:${x.id}`, selected: r.modelo === `u:${x.id}` ? true : null }, x.nome))) : null);
  document.getElementById("r-desc").textContent = r.editado
    ? `Regras editadas a partir de "${m?.nome ?? "modelo"}". Salve para usar de novo depois.`
    : m?.desc ?? "Suas regras salvas.";
  document.getElementById("f-vies").value = r.vies;
  document.getElementById("f-ordem").replaceChildren(...Object.entries(ORDENS).map(([k, [rot]]) =>
    el("option", { value: k, selected: k === estado.ordem ? true : null }, rot)));

  document.getElementById("r-regras").replaceChildren(...r.regras.map((x, i) => {
    const def = CONDICOES[x.t];
    return el("li", { class: "regra" },
      el("span", { class: "regra-e" }, i ? "E" : "SE"),
      el("span", { class: "regra-campos" }, def.campos.map((c) => campoRegra(x, c, mudou))),
      el("button", { class: "regra-remover", title: "Remover esta condição", "aria-label": "Remover condição",
        onclick: () => { r.regras.splice(i, 1); mudou(); } }, "×"));
  }));
  const adicionar = document.getElementById("r-adicionar");
  const grupos = [...new Set(Object.values(CONDICOES).map((c) => c.grupo))];
  adicionar.replaceChildren(el("option", { value: "" }, "+ Adicionar condição…"),
    ...grupos.map((g) => el("optgroup", { label: g }, Object.entries(CONDICOES).filter(([, c]) => c.grupo === g)
      .map(([k, c]) => el("option", { value: k }, c.nome)))));
  document.getElementById("r-excluir").hidden = !r.modelo.startsWith("u:");
  document.getElementById("r-restaurar").hidden = !r.editado;
}

function ligarRastreador() {
  segmento("f-rtf", ({ v }) => {
    const r = regrasAtuais();
    r.tf = v;
    estado.tf = v;  // o gráfico acompanha o tempo das regras (dá para trocar depois)
    document.querySelectorAll("#f-tf button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === v));
    estado.pagina = 0; salvar(); renderRastreador(); render();
  }).marcar("v", regrasAtuais().tf);
  document.getElementById("f-modelo").addEventListener("change", (e) => { escolherModelo(e.target.value); salvar(); renderRastreador(); render(); });
  document.getElementById("f-vies").addEventListener("change", (e) => { regrasAtuais().vies = e.target.value; salvar(); render(); });
  document.getElementById("f-ordem").addEventListener("change", (e) => { estado.ordem = e.target.value; estado.pagina = 0; salvar(); render(); });
  document.getElementById("r-adicionar").addEventListener("change", (e) => {
    const t = e.target.value;
    if (!t) return;
    const r = regrasAtuais();
    r.regras.push({ t, ...structuredClone(CONDICOES[t].padrao) });
    r.editado = true; estado.pagina = 0; salvar(); renderRastreador(); render();
  });
  document.getElementById("r-salvar").addEventListener("click", () => {
    const r = regrasAtuais();
    const atual = modeloEscolhido();
    const nome = prompt("Nome para estas regras:", r.modelo.startsWith("u:") ? atual?.nome : `${atual?.nome ?? "Minha regra"} (minha)`);
    if (!nome) return;
    const lista = salvos();
    const existente = r.modelo.startsWith("u:") && lista.find((x) => x.id === atual?.id && x.nome === nome);
    const id = existente ? existente.id : `${Date.now()}`;
    const novo = { id, nome, vies: r.vies, regras: structuredClone(r.regras) };
    guardar.gravar(SALVOS, [...lista.filter((x) => x.id !== id), novo]);
    r.modelo = `u:${id}`; r.editado = false; salvar(); renderRastreador();
  });
  document.getElementById("r-excluir").addEventListener("click", () => {
    const m = modeloEscolhido();
    if (!m || !confirm(`Excluir "${m.nome}"?`)) return;
    guardar.gravar(SALVOS, salvos().filter((x) => x.id !== m.id));
    escolherModelo("m:tend-alta"); salvar(); renderRastreador(); render();
  });
  document.getElementById("r-restaurar").addEventListener("click", () => { escolherModelo(regrasAtuais().modelo); salvar(); renderRastreador(); render(); });
}

function descricao(n) {
  const fonte = FONTES.flatMap((g) => g.itens).find(([k]) => k === estado.fonte);
  if (estado.fonte === "rastreador") {
    const { tf, regras } = regrasAtuais();
    return `${n} ativo(s) atendem no ${TF_FRASE[tf]}: ${regras.map((x) => textoRegra(x, tf, F)).join(" E ") || "sem regras"}`;
  }
  let txt = `${n} ativo(s) · ${fonte?.[1].replace(/^[▲▼] /, "") ?? ""}`;
  if (ehOportunidade()) {
    txt += ` no sinal ${estado.tf === "W" ? "semanal" : "diário"}` +
      `, ${estado.pregoes === "1" ? "último pregão" : "últimos 5 pregões"}${estado.confluencia ? ", só com 2+ estratégias" : ""}`;
    if (INTRADAY.has(estado.tf)) txt += " (no 60m/4h, valem os sinais do diário)";
  }
  return txt;
}

// ------------------------------------------------------------- grade

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
  const vazio = estado.fonte === "rastreador" ? (F ? "Nenhum ativo atende a todas as regras hoje. Tente afrouxar alguma condição."
      : "Não consegui carregar os indicadores do rastreador.")
    : ehOportunidade() && estado.confluencia
      ? "Nenhuma ação com 2+ estratégias no período. Desmarque \"Só com confluência\" ou aumente o período."
      : "Nenhum ativo nesta lista hoje.";
  grade.replaceChildren(...(pagina.length ? pagina.map(celula) : [el("p", { class: "vazio painel" }, vazio)]));
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
  try { F = await carregarRastreador(); } catch {}
  try { carteira = (await carregarResumo()).carteira.posicoes.map((p) => p.ticker); } catch {}
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("multitela", R);
  document.getElementById("f-descricao").after(avisoFormacao(R));
  document.getElementById("f-indicadores").replaceChildren(atalhosIndicadores({ comSinais: true, comIFR: false }));

  if (F) ligarRastreador();
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
