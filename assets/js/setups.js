/* Setups: une o antigo Radar e a antiga Multitela. Escolhe-se um setup do catálogo
 * (data/setups.json: lado → a favor/contra a tendência → setup) ou as "Minhas regras", e o mesmo
 * resultado aparece em duas visões: lista + gráfico grande, ou grade de gráficos para comparar.
 * Os eventos dos setups vêm de data/radar.json (sinais: {ticker, setup, tf, data, lado, preco, bt});
 * as minhas regras são avaliadas aqui mesmo, sobre as fotos de data/rastreador.json. */

const estado = Object.assign({
  mercado: "", tf: "D", periodo: 1, lado: "compra", estilo: "tendencia", setup: "todos",
  so2: false, ordem: "confluencia", visao: "lista", grade: "3", tfGrafico: "D", camadas: "condicoes",
  pagina: 0, arvore: true, verVazios: false, editando: false, minhas: null,
}, guardar.ler("setups-v1", {}));
estado.ticker = null;  // o ativo aberto vem do endereço (#PETR4.SA), não fica salvo
const salvar = () => guardar.gravar("setups-v1", { ...estado, ticker: undefined });

let R, F, porTicker, painel;
let SETUPS = [], SETUP = new Map(), NEUTROS = [], EVENTOS = [], eventosLocais = false;
let P = { eventos: [], ultima: new Map(), porSetup: new Map() };  // eventos do período escolhido
let lista = [];        // resultado filtrado e ordenado (o mesmo nas duas visões)
const abertos = [];    // gráficos da grade
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------- catálogo

const ESTILOS = [
  { chave: "tendencia", nome: "A favor da tendência",
    dica: { compra: "Comprar uma alta que continua: tendência, pullbacks nas médias, rompimentos, multitempo.",
      venda: "Vender uma baixa que continua: tendência de baixa, pullbacks, perda de mínimas, multitempo." } },
  { chave: "contra", nome: "Contra a tendência",
    dica: { compra: "Comprar a virada depois de uma queda forte: IFR extremo, fora da Bollinger, longe da média.",
      venda: "Vender a virada depois de uma alta forte: IFR extremo, fora da Bollinger, longe da média." } },
];

/** Catálogo publicado (com o resumo do backtest); sem ele, o de config/ (mesmo formato). */
const carregarCatalogo = () => buscarJSON("data/setups.json").catch(() => buscarJSON("config/setups.json"));

/** "Pullback de compra na MMS 20" -> "Pullback na MMS 20" (o lado já está na árvore). */
const nomeCurto = (x) => (x ? x.nome.replace(/ de (compra|venda)\b/, "") : "?");
const doRamo = (lado, estilo) => SETUPS.filter((x) => x.vies === lado && x.estilo === estilo);
/** Regras que o JS sabe avaliar e desenhar (boca, multitempo e ranking só existem no Python). */
const suportado = (x) => x.regras.every((r) => CONDICOES[r.t]);
const ehMinhas = () => estado.setup === "minhas";
const setupAtual = () => SETUP.get(estado.setup) ?? null;

/** Lado do contexto (a favor / cuidado) da lista atual. */
function viesAtual() {
  if (ehMinhas()) return minhas().vies;
  return setupAtual()?.vies === "neutro" ? "neutro" : estado.lado;
}

/** Setups que colocam um ativo na lista. */
function idsFoco() {
  if (ehMinhas()) return new Set();
  if (estado.setup !== "todos" && SETUP.has(estado.setup)) return new Set([estado.setup]);
  return new Set(doRamo(estado.lado, estado.estilo).map((x) => x.id));
}

/** Setups que contam como confluência ("2+ setups") e aparecem como chips no ativo. */
function idsRamo() {
  const vies = viesAtual();
  if (vies === "neutro") return new Set(NEUTROS.map((x) => x.id));
  if (ehMinhas()) return new Set(SETUPS.filter((x) => x.vies === vies).map((x) => x.id));
  return new Set(doRamo(estado.lado, estado.estilo).map((x) => x.id));
}

/** Enquanto data/radar.json não traz os eventos do catálogo, eles são calculados aqui com as
 *  regras que o JS conhece, nos últimos candles fechados das fotos. */
function calcularEventosLocais() {
  const ev = [];
  const avaliaveis = SETUPS.filter(suportado);
  for (const a of R.ativos) {
    const fotos = F?.ativos[a.ticker];
    if (!fotos || !a.liquido) continue;
    for (const tf of ["D", "W"]) {
      const s = fotos[tf];
      if (!s?.datas) continue;
      for (let k = 0; k < s.datas.length; k++) {
        const f = k ? deslocar(s, k) : atual(s);
        for (const x of avaliaveis)
          if (x.regras.every((r) => CONDICOES[r.t].avaliar(f, r, tf, F) === true))
            ev.push({ ticker: a.ticker, setup: x.id, tf, data: s.datas.at(-1 - k), lado: x.vies, preco: ult(s.c, k), bt: null });
      }
    }
  }
  return ev;
}

/** Evento no formato que o gráfico e o contexto entendem (tf "S" no semanal, nome no lugar da família). */
const paraGrafico = (e) => ({ ...e, tf: e.tf === "W" ? "S" : e.tf, familia: SETUP.has(e.setup) ? nomeCurto(SETUP.get(e.setup)) : e.setup,
  texto: SETUP.get(e.setup)?.desc ?? "" });

// ------------------------------------------------------------- período e lista

const visivel = (tk) => {
  const a = porTicker.get(tk);
  return a && (!estado.mercado || a.mercado === estado.mercado);
};

/** Eventos do período, contado por mercado (cripto tem fim de semana, a bolsa não). */
function calcularPeriodo() {
  const { sinais, ultima } = sinaisDoPeriodo({ ativos: R.ativos, sinais: EVENTOS }, estado.tf, estado.periodo);
  const eventos = sinais.filter((e) => visivel(e.ticker));
  const porSetup = new Map();
  for (const e of eventos) {
    if (!porSetup.has(e.setup)) porSetup.set(e.setup, new Set());
    porSetup.get(e.setup).add(e.ticker);
  }
  P = { eventos, ultima, porSetup };
}

/** Quantos ativos têm algum destes setups no período. */
function contar(ids) {
  const t = new Set();
  for (const id of ids) for (const tk of P.porSetup.get(id) ?? []) t.add(tk);
  return t.size;
}

function agrupar(eventos, ids) {
  const m = new Map();
  for (const e of eventos) {
    if (!ids.has(e.setup)) continue;
    let i = m.get(e.ticker);
    if (!i) m.set(e.ticker, (i = { ticker: e.ticker, eventos: [], setups: new Set(), ultima: e.data }));
    i.eventos.push(e);
    i.setups.add(e.setup);
    if (e.data > i.ultima) i.ultima = e.data;
  }
  for (const i of m.values()) i.eventos.sort((x, y) => y.data.localeCompare(x.data));
  return m;
}

const fotoAtual = (tk) => (F ? atual(F.ativos[tk]?.[estado.tf]) : null);
/** Melhor vantagem histórica entre os eventos do foco (só quando há casos suficientes). */
const melhorBt = (i) => Math.max(-1e9, ...i.eventos.filter((e) => i.foco.has(e.setup) && e.bt?.[1] != null).map((e) => e.bt[3] ?? -1e9));

const ORDENS = {
  confluencia: ["Mais setups juntos", (i) => -i.setups.size],
  historico: ["Melhor histórico", (i) => -melhorBt(i)],
  recente: ["Mais recente", () => 0],
  var_mes: ["Maior alta no mês", (i, a) => -(a.var_mes_pct ?? -1e9)],
  var_mes_baixa: ["Maior queda no mês", (i, a) => a.var_mes_pct ?? 1e9],
  var_ano: ["Maior alta no ano", (i, a) => -(a.var_ano_pct ?? -1e9)],
  var_dia: ["Maior alta no dia", (i, a) => -(a.var_dia_pct ?? -1e9)],
  ifr_baixo: ["IFR 14 mais baixo", (i, a, s) => ult(s?.ifr?.[14]) ?? 999],
  ifr_alto: ["IFR 14 mais alto", (i, a, s) => -(ult(s?.ifr?.[14]) ?? -999)],
  perto_mm20: ["Mais perto da MMS 20", (i, a, s) => Math.abs(pct(ult(s?.c), ult(s?.sma?.[20])) ?? 999)],
  volume: ["Maior volume relativo", (i, a, s) => -(s?.vr ?? 0)],
  nome: ["Nome", (i, a) => semSufixo(a.ticker)],
};

function listar() {
  const conf = agrupar(P.eventos, idsRamo());
  const foco = idsFoco();
  let itens;
  if (ehMinhas()) {
    const m = minhas();
    const tf = estado.tf;
    itens = !F || !m.regras.length ? [] : R.ativos.filter((a) => a.liquido && visivel(a.ticker)).map((a) => {
      const k = quandoAtende(F.ativos[a.ticker]?.[tf], m.regras, tf, F, estado.periodo);
      if (k == null) return null;
      const c = conf.get(a.ticker);
      const data = F.ativos[a.ticker][tf].datas?.at(-1 - k) ?? "";
      return { ticker: a.ticker, k, data, eventos: c?.eventos ?? [], setups: c?.setups ?? new Set(), ultima: data, foco };
    }).filter(Boolean);
  } else {
    itens = [...conf.values()].filter((i) => [...i.setups].some((id) => foco.has(id))).map((i) => ({ ...i, foco }));
  }
  if (estado.so2) itens = itens.filter((i) => i.setups.size >= 2);
  const chave = (ORDENS[estado.ordem] ?? ORDENS.confluencia)[1];
  const nota = new Map(itens.map((i) => [i.ticker, chave(i, porTicker.get(i.ticker), fotoAtual(i.ticker))]));
  const cmp = (p, q) => (typeof p === "string" ? p.localeCompare(q) : p - q);
  return itens.sort((x, y) => (ehMinhas() ? x.k - y.k : 0) || cmp(nota.get(x.ticker), nota.get(y.ticker))
    || (y.ultima ?? "").localeCompare(x.ultima ?? "") || x.ticker.localeCompare(y.ticker));
}

/** O evento que explica o ativo estar na lista (o mais recente do foco). */
const eventoFoco = (i) => i.eventos.find((e) => i.foco.has(e.setup)) ?? null;

/** Em qual dos últimos candles das fotos o setup aconteceu (0 = último fechado). */
function kDoItem(i) {
  if (i.k != null) return i.k;
  const e = eventoFoco(i);
  const datas = F?.ativos[i.ticker]?.[estado.tf]?.datas;
  const p = e && datas ? datas.lastIndexOf(e.data) : -1;
  return p < 0 ? 0 : datas.length - 1 - p;
}

/** Regras do setup que explicam o ativo (as que o JS sabe desenhar; a boca de jacaré usa a Bollinger). */
function regrasDoItem(i) {
  if (ehMinhas()) return minhas().regras;
  const x = SETUP.get(eventoFoco(i)?.setup);
  return (x?.regras ?? []).map((r) => (r.t === "boca" ? { t: "bollinger", pos: "fechou_acima" } : r)).filter((r) => CONDICOES[r.t]);
}

/** Setas no gráfico: os eventos dos setups do foco neste ativo (todas as datas publicadas). */
function sinaisGrafico(i) {
  if (!i) return [];
  const ev = EVENTOS.filter((e) => e.ticker === i.ticker && i.foco.has(e.setup)).map(paraGrafico);
  if (ehMinhas() && i.data) {
    const m = minhas();
    ev.push({ ticker: i.ticker, tf: estado.tf === "W" ? "S" : "D", data: i.data, lado: m.vies, familia: regraSalva()?.nome ?? "Minhas regras",
      texto: m.regras.map((x) => textoRegra(x, estado.tf, F)).join(" · "), bt: null });
  }
  return ev;
}

const dataFoco = (i) => (!i ? null : ehMinhas() ? i.data : eventoFoco(i)?.data) || null;

// ------------------------------------------------------------- pedaços do ativo

/** "no último pregão (20/10)" / "há 2 pregões (16/10)" */
function quandoTexto(k, data, tf) {
  const quando = k === 0 ? (tf === "W" ? "na última semana" : "no último pregão") : `há ${unid(tf, k)}`;
  return `${quando}${data ? ` (${tf === "W" ? "semana de " : ""}${fmtData(data)})` : ""}`;
}

/** Os valores que fizeram o ativo passar nas regras (ex.: "+3,2% da MMS 20 · IFR 14 27"). */
function valoresRegras(i) {
  const s = F?.ativos[i.ticker]?.[estado.tf];
  if (!s) return [];
  const k = kDoItem(i);
  return [...new Set(regrasDoItem(i).map((x) => valorRegra(s, x, estado.tf, F, k)).filter(Boolean))];
}

/** Chips dos setups do ativo (o do foco primeiro), com a data mais recente de cada um, e o selo do histórico. */
function linhaSetups(i, compacta) {
  const porSetup = new Map();
  for (const e of i.eventos) (porSetup.get(e.setup) ?? porSetup.set(e.setup, []).get(e.setup)).push(e);
  const ordem = [...porSetup.keys()].sort((a, b) => i.foco.has(b) - i.foco.has(a) || SETUPS.indexOf(SETUP.get(a)) - SETUPS.indexOf(SETUP.get(b)));
  const tfSelo = estado.tf === "W" ? "S" : "D";
  const chips = ordem.map((id) => {
    const evs = porSetup.get(id), x = SETUP.get(id);
    return el("span", { class: `chip setup vies-${x?.vies ?? evs[0].lado} ${i.foco.has(id) ? "foco" : ""}`,
      title: `${x?.nome ?? id}${x?.desc ? `: ${x.desc}` : ""}\n${evs.map((e) => fmtData(e.data)).join(", ")}` },
    x ? nomeCurto(x) : id, " ", el("span", { class: "data" }, fmtData(evs[0].data)));
  });
  const ev = eventoFoco(i);
  const selo = ev ? seloHistorico(ev.bt, tfSelo) : null;
  const n = i.setups.size;
  const destaque = n >= 2 ? el("span", { class: "chip destaque" }, `${n} setups`) : null;
  if (ehMinhas()) {
    const valores = valoresRegras(i);
    const quando = el("span", { class: `quando ${i.k === 0 ? "hoje" : ""}` }, `Atendeu ${quandoTexto(i.k, i.data, estado.tf)}`);
    return compacta
      ? el("p", { class: "valores-regra celula-setups" }, quando, valores.length ? ` · ${valores.join(" · ")}` : "")
      : el("div", {}, el("p", { class: "valores-regra" }, quando, valores.length ? ` · ${valores.join(" · ")}` : ""),
        chips.length ? el("div", { class: "chips" }, el("span", { class: "chip ctx" }, "também:"), chips) : null);
  }
  return el("div", { class: `chips ${compacta ? "celula-setups" : ""}` }, destaque, chips, selo);
}

/** A favor / cuidado / informações do ativo para o lado da lista (mesma conta da antiga Multitela). */
function blocoContexto(a) {
  const fotos = F?.ativos[a.ticker];
  if (!fotos) return null;
  const sinais = EVENTOS.filter((e) => e.ticker === a.ticker);
  const { favor, cuidado, info } = contextoDecisao(a, fotos, estado.tf, viesAtual(), sinais,
    (id) => (SETUP.has(id) ? nomeCurto(SETUP.get(id)) : id));
  const lista = (itens, cls, simbolo, max) => (itens.length ? el("ul", { class: `contexto-lista ${cls}` },
    itens.slice(0, max).map((t) => el("li", { title: t }, el("span", { class: "simbolo" }, simbolo), t)),
    itens.length > max ? el("li", { class: "mais", title: itens.slice(max).join("\n") }, `+${itens.length - max} outros`) : null) : null);
  const enxuto = el("div", { class: "contexto-decisao" },
    lista(favor, "favor", "✓", 4), lista(cuidado, "cuidado", "⚠", 4),
    info.length ? el("details", { class: "contexto-mais" }, el("summary", {}, "Mais informações"), lista(info, "info", "·", 8)) : null);
  // grade larga: o card é só gráfico e o contexto entra deslizando ao passar o mouse, um item de cada vez (--i)
  let n = 0;
  const grupo = (titulo, itens, cls, simbolo) => (itens.length ? el("section", { class: `painel-grupo ${cls}` },
    el("h4", { style: `--i:${n++}` }, titulo),
    el("ul", { class: `contexto-lista ${cls}` }, itens.map((t) =>
      el("li", { style: `--i:${n++}` }, el("span", { class: "simbolo" }, simbolo), t)))) : null);
  const painelCtx = favor.length + cuidado.length + info.length ? el("aside", { class: "contexto-painel", "aria-label": "Contexto" },
    grupo("A favor", favor, "favor", "✓"), grupo("Cuidado", cuidado, "cuidado", "⚠"), grupo("Informações", info, "info", "·")) : null;
  const dica = favor.length + cuidado.length ? el("span", { class: "contexto-dica", title: "Passe o mouse no gráfico para ver o contexto" },
    favor.length ? el("span", { class: "favor" }, `✓ ${favor.length}`) : null,
    cuidado.length ? el("span", { class: "cuidado" }, `⚠ ${cuidado.length}`) : null) : null;
  return { enxuto, painel: painelCtx, dica };
}

const linkAtivo = (tk, txt = "↗") => el("a", { class: "abrir-radar", href: `ativo.html#${encodeURIComponent(tk)}`,
  title: "Abrir a página do ativo", onclick: (e) => e.stopPropagation() }, txt);

// ------------------------------------------------------------- visão: lista + gráfico

function itemLista(i) {
  const a = porTicker.get(i.ticker);
  return el("li", { class: `item ${i.setups.size >= 2 ? "confluencia" : ""}`, "data-tk": i.ticker, onclick: () => selecionar(i.ticker) },
    el("div", { class: "item-topo" },
      el("div", { class: "item-nome" }, el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
      precoComFormacao(a, "cartao-preco")),
    linhaSetups(i, false));
}

/** Contexto do ativo selecionado, aberto dentro do item da lista. */
function contextoNoItem() {
  document.querySelectorAll(".item-contexto").forEach((n) => n.remove());
  const li = document.querySelector(`#lista-ativos [data-tk="${CSS.escape(estado.ticker ?? "")}"]`);
  const a = porTicker.get(estado.ticker);
  if (!li || !a) return;
  const i = lista.find((x) => x.ticker === a.ticker);
  const ctx = blocoContexto(a);
  const valores = i && !ehMinhas() ? valoresRegras(i) : [];
  li.append(el("div", { class: "item-contexto" },
    valores.length ? el("p", { class: "valores-regra" }, valores.join(" · ")) : null,
    ctx?.enxuto, chipsSimulacoes(a), el("p", { class: "item-links" }, linkAtivo(a.ticker, "Abrir a página do ativo ↗"))));
}

function marcarSelecionado() {
  document.querySelectorAll("[data-tk]").forEach((n) => n.classList.toggle("selecionado", n.dataset.tk === estado.ticker));
}

let tickerNoPainel = null;
async function selecionar(tk, rolar = true) {
  const a = porTicker.get(tk);
  if (!a) return;
  estado.ticker = tk;
  atualizarURL();
  marcarSelecionado();
  if (estado.visao !== "lista") return;
  contextoNoItem();
  const i = lista.find((x) => x.ticker === tk);
  painel.grafico.sinais = sinaisGrafico(i);
  if (tickerNoPainel === tk) {
    // mesmo ativo: só atualiza as setas e o destaque, sem reenquadrar o gráfico
    if (painel.grafico.c) painel.grafico.marcar(painel.grafico.c);
    destacarNoPainel();
  } else {
    tickerNoPainel = tk;
    await painel.selecionar(a, painel.grafico.sinais);
  }
  // no desktop a lista fica ao lado do gráfico; só no celular é preciso rolar até ele
  if (rolar && innerWidth < 1100) $("painel-grafico").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Marca o candle do setup (quando o gráfico está no mesmo tempo do sinal). */
function destacarNoPainel() {
  const g = painel.grafico;
  const data = dataFoco(lista.find((x) => x.ticker === estado.ticker));
  if (data && g.tf === estado.tf) g.destacar(data);
  else { g.dataDestaque = null; g.destaque.hidden = true; }
}

function mover(passo) {
  if (!lista.length) return;
  const i = lista.findIndex((x) => x.ticker === estado.ticker);
  const prox = lista[Math.max(0, Math.min(lista.length - 1, i < 0 ? 0 : i + passo))];
  selecionar(prox.ticker, false);
  document.querySelector(`#lista-ativos [data-tk="${CSS.escape(prox.ticker)}"]`)?.scrollIntoView({ block: "nearest" });
}

function tituloLista() {
  const x = setupAtual();
  const t = $("titulo-lista");
  if (ehMinhas()) {
    const m = minhas();
    t.textContent = `✎ ${regraSalva()?.nome ?? "Minhas regras"}${m.editado ? " (editado)" : ""}`;
    t.className = m.vies;
    $("cat-descricao").replaceChildren(m.regras.map((r) => textoRegra(r, estado.tf, F)).join(" · ") || "Nenhuma condição.");
    return;
  }
  const lado = estado.lado === "compra" ? "▲ Compra" : "▼ Venda";
  const estilo = estado.estilo === "tendencia" ? "a favor da tendência" : "contra a tendência";
  if (x?.vies === "neutro") { t.textContent = `◆ ${x.nome}`; t.className = "neutro"; }
  else { t.textContent = `${lado} ${estilo}${x ? ` · ${nomeCurto(x)}` : ""}`; t.className = estado.lado; }
  const copiar = x && suportado(x) ? el("button", { class: "botao-link", title: "Copiar estas regras para Minhas regras e ajustar",
    onclick: () => copiarParaMinhas(x) }, "✎ ajustar as regras") : null;
  $("cat-descricao").replaceChildren(x ? x.desc : `Ativos com algum setup de ${estado.lado} ${estado.estilo === "tendencia" ? "a favor" : "contra"} da tendência no período.`,
    copiar ? " " : "", copiar ?? "");
}

function renderLista() {
  tituloLista();
  $("n-lista").textContent = lista.length;
  const vazio = ehMinhas()
    ? (F ? "Nenhum ativo atende a todas as regras no período. Tente afrouxar alguma condição ou aumentar o período." : "Não consegui carregar os indicadores das regras.")
    : estado.so2 ? "Nenhum ativo com 2+ setups no período. Desmarque a opção ou aumente o período."
      : "Nenhum ativo com este setup no período. Tente outro período ou outro mercado.";
  $("lista-ativos").replaceChildren(...(lista.length ? lista.map(itemLista) : [el("li", { class: "vazio" }, vazio)]));
  marcarSelecionado();
}

// ------------------------------------------------------------- visão: grade

const LINHAS = { 1: 1, 2: 2, 3: 3, 4: 3 };
const POR_PAGINA = { 1: 1, 2: 4, 3: 9, 4: 12 };
const porPagina = () => POR_PAGINA[estado.grade] ?? 9;

function celula(i) {
  const a = porTicker.get(i.ticker);
  const corpo = el("div", { class: "mini-grafico" });
  const k = kDoItem(i);
  const sob = estado.camadas === "condicoes" && F ? sobreposicaoDasRegras(regrasDoItem(i), F.ativos[a.ticker]?.[estado.tf], estado.tf, F, k) : null;
  const ctx = blocoContexto(a) ?? {};
  const cel = el("article", { class: `celula ${i.setups.size >= 2 ? "confluencia" : ""}`, "data-tk": i.ticker },
    el("header", {},
      el("div", { class: "celula-nome", title: "Abrir o gráfico em tela cheia",
        onclick: () => (document.fullscreenElement ? document.exitFullscreen() : cel.requestFullscreen?.()) },
      el("b", { class: "mono" }, semSufixo(a.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
      el("div", { class: "celula-acoes" }, ctx.dica, precoComFormacao(a, "celula-preco"), botaoTelaCheia(() => cel), linkAtivo(a.ticker))),
    linhaSetups(i, true),
    corpo,
    sob ? el("div", { class: "legenda-extras" }, legendaSobreposicao(sob).map((x) =>
      el("span", {}, el("i", { class: x.pontilhado ? "pontilhado" : null, style: `--cor:${x.cor}` }), x.txt))) : null,
    ctx.painel,
    ctx.enxuto,
    chipsSimulacoes(a));
  // clicar no card escolhe o ativo (é ele que abre ao voltar para a lista); mexer no gráfico recolhe o painel
  cel.addEventListener("pointerdown", () => { if (estado.ticker !== i.ticker) { estado.ticker = i.ticker; atualizarURL(); marcarSelecionado(); } });
  corpo.addEventListener("pointerdown", () => cel.classList.add("sem-painel"));
  cel.addEventListener("mouseleave", () => cel.classList.remove("sem-painel"));
  corpo.abrir = () => {
    const g = new Grafico(corpo, { mini: true });
    g.sinais = sinaisGrafico(i);
    g.definirSobreposicao(sob);
    abertos.push(g);
    new Desenhos(g, corpo, { compacta: true }).definirAtivo(a.ticker);
    if (Simulacoes.doAtivo(a.ticker).length) new Simulador(g, corpo).definirAtivo(a);
    const tf = INTRADAY.has(estado.tfGrafico) && !a.tem_intraday ? "D" : estado.tfGrafico;  // sem intraday verificado, diário
    g.mostrar(a.arquivo, tf).then((ok) => {
      const data = dataFoco(i);
      if (ok && data && tf === estado.tf) g.destacar(data);
    });
  };
  return cel;
}

// cada gráfico só é criado quando a célula aparece na tela
const observador = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    observador.unobserve(e.target);
    e.target.abrir();
  }
}, { rootMargin: "200px" });

let totalPaginas = 1;
function renderGrade() {
  observador.disconnect();
  abertos.splice(0).forEach((g) => g.remover());
  const grade = $("grade");
  if (estado.visao !== "grade") { grade.replaceChildren(); $("paginacao").replaceChildren(); return; }
  const n = porPagina();
  totalPaginas = Math.max(1, Math.ceil(lista.length / n));
  estado.pagina = Math.max(0, Math.min(estado.pagina, totalPaginas - 1));
  const pagina = lista.slice(estado.pagina * n, (estado.pagina + 1) * n);
  grade.dataset.grade = estado.grade;
  const vazio = ehMinhas() ? (F ? "Nenhum ativo atende a todas as regras no período. Tente afrouxar alguma condição." : "Não consegui carregar os indicadores das regras.")
    : estado.so2 ? "Nenhum ativo com 2+ setups no período. Desmarque a opção ou aumente o período." : "Nenhum ativo com este setup no período.";
  grade.replaceChildren(...(pagina.length ? pagina.map(celula) : [el("p", { class: "vazio painel" }, vazio)]));
  marcarSelecionado();
  encaixar();
  grade.querySelectorAll(".mini-grafico").forEach((c) => observador.observe(c));

  // paginação compacta: primeira, vizinhas da atual e última
  const p = estado.pagina;
  const mostrar = [...new Set([0, p - 2, p - 1, p, p + 1, p + 2, totalPaginas - 1])].filter((x) => x >= 0 && x < totalPaginas).sort((x, y) => x - y);
  $("paginacao").replaceChildren(...(totalPaginas > 1 ? mostrar.flatMap((x, j) => [
    j && x - mostrar[j - 1] > 1 ? el("span", { class: "reticencias" }, "…") : null,
    el("button", { class: x === p ? "ativo" : null, onclick: () => irParaPagina(x, true) }, String(x + 1)),
  ]).filter(Boolean) : []));
  // em 1 tela, setas grandes nas laterais do gráfico
  if (estado.grade === "1" && pagina.length) {
    grade.querySelector(".celula").append(
      el("button", { class: "seta-tela anterior", disabled: p === 0, "aria-label": "Ativo anterior (←)", title: "Anterior (←)", onclick: () => irParaPagina(p - 1) }, "‹"),
      el("button", { class: "seta-tela proxima", disabled: p >= totalPaginas - 1, "aria-label": "Próximo ativo (→)", title: "Próximo (→)", onclick: () => irParaPagina(p + 1) }, "›"));
  }
  $("paginacao-topo").replaceChildren(...(totalPaginas > 1 ? [
    el("button", { disabled: p === 0, title: "Página anterior (←)", onclick: () => irParaPagina(p - 1) }, "‹"),
    el("span", { class: "mono" }, `${p + 1}/${totalPaginas}`),
    el("button", { disabled: p === totalPaginas - 1, title: "Próxima página (→)", onclick: () => irParaPagina(p + 1) }, "›"),
  ] : []));
}

function irParaPagina(x, topo = false) {
  if (x < 0 || x >= totalPaginas || x === estado.pagina) return;
  estado.pagina = x;
  // o ativo escolhido acompanha a página (é ele que abre ao voltar para a lista)
  const n = porPagina();
  const naPagina = lista.slice(x * n, (x + 1) * n);
  if (naPagina.length && !naPagina.some((i) => i.ticker === estado.ticker)) { estado.ticker = naPagina[0].ticker; atualizarURL(); }
  salvar();
  renderGrade();
  if (topo) scrollTo({ top: 0 });
}

/** Página da grade em que está o ativo escolhido. */
function paginaDoAtivo() {
  const p = lista.findIndex((i) => i.ticker === estado.ticker);
  if (p >= 0) estado.pagina = Math.floor(p / porPagina());
}

// ------------------------------------------------------------- encaixe na janela

const telaLarga = matchMedia("(min-width: 1101px)");
/** Em telas largas, a visão ocupa a altura que sobra abaixo do menu: a grade inteira cabe sem rolar
 *  (zoom 100%) e a lista rola por dentro. Em telas estreitas, a página rola normalmente. */
function encaixar() {
  const grade = $("grade"), area = $("vista-lista");
  const larga = telaLarga.matches;
  const sobra = (alvo) => Math.floor(innerHeight - (alvo.getBoundingClientRect().top + scrollY) - 12);
  const naGrade = larga && estado.visao === "grade" && !!grade.querySelector(".celula");
  grade.classList.toggle("encaixar", naGrade);
  if (naGrade) {
    const linhas = LINHAS[estado.grade] ?? 3;
    grade.style.setProperty("--altura-grade", `${Math.max(sobra(grade), linhas * (estado.grade === "1" ? 300 : 112))}px`);
    grade.style.setProperty("--linhas", linhas);
  }
  if (larga && estado.visao === "lista") area.style.height = `${Math.max(sobra(area), 380)}px`;
  else area.style.height = "";
}
addEventListener("resize", () => { aplicarCompacto(); encaixar(); });
telaLarga.addEventListener("change", encaixar);
// o menu muda de altura (editor de regras, árvore recolhida, aviso de formação): a visão acompanha
new ResizeObserver(() => encaixar()).observe($("menu-setups"));

// ------------------------------------------------------------- árvore de setups

/** Mini gráfico do estilo: alta que continua (a favor) ou queda que vira (contra). Na venda, o CSS espelha. */
function iconeEstilo(chave) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const pontos = chave === "tendencia" ? ["3,19 9,12 13,15 21,5", "15,5 21,5 21,11"] : ["3,4 8,12 12,19 16,13 21,9", "15.5,8 21,9 19.5,14.5"];
  for (const p of pontos) {
    const linha = document.createElementNS(ns, "polyline");
    linha.setAttribute("points", p);
    svg.append(linha);
  }
  return svg;
}

const ids = (xs) => xs.map((x) => x.id);

function escolherRamo(lado, estilo) {
  estado.lado = lado;
  estado.estilo = estilo;
  estado.setup = "todos";
  mudou();
}

function escolherSetup(v) {
  const x = SETUP.get(v);
  if (x && x.vies !== "neutro") { estado.lado = x.vies; estado.estilo = x.estilo; }
  estado.setup = v;
  if (v === "minhas") estado.editando = estado.editando || !salvos().length;
  mudou();
}

function renderArvore() {
  const ramo = doRamo(estado.lado, estado.estilo);
  for (const lado of ["compra", "venda"]) $(`n-${lado}`).textContent = contar(ids(doRamo(lado, estado.estilo)));
  document.querySelectorAll(".abas-lado button").forEach((b) => {
    b.classList.toggle("ativo", b.dataset.lado === estado.lado);
    b.setAttribute("aria-selected", b.dataset.lado === estado.lado);
  });

  // 1) estilo: a favor ou contra a tendência, como braços do lado escolhido
  const fluxo = $("fluxo-op");
  const novo = fluxo.dataset.lado !== estado.lado || fluxo.dataset.estilo !== estado.estilo;
  fluxo.dataset.lado = estado.lado;
  fluxo.dataset.estilo = estado.estilo;
  fluxo.querySelector(".barra").classList.toggle("on", (estado.lado === "compra") !== (estado.estilo === "tendencia"));
  fluxo.querySelectorAll(".braco").forEach((b) => b.classList.toggle("on", b.classList.contains("b-" + estado.estilo)));
  $("f-estilo").replaceChildren(...ESTILOS.map((x) => {
    const ativo = x.chave === estado.estilo;
    const doEstilo = doRamo(estado.lado, x.chave);
    return el("button", { class: `estilo-card ${ativo ? "ativo" : ""} ${ativo && novo ? "pulso" : ""}`, role: "tab",
      "aria-selected": ativo, "data-estilo": x.chave, title: x.dica[estado.lado], onclick: () => escolherRamo(estado.lado, x.chave) },
    el("span", { class: "estilo-topo" }, el("span", { class: "estilo-icone" }, iconeEstilo(x.chave)),
      el("b", {}, x.nome), el("span", { class: "contagem" }, contar(ids(doEstilo)))),
    el("span", { class: "estilo-dica" }, x.dica[estado.lado]),
    el("span", { class: "estilo-fams" }, [...new Set(doEstilo.map((s) => s.grupo))].map((g) => el("span", {}, g))));
  }));

  // 2) setups do estilo (os sem evento no período ficam recolhidos), os neutros e as minhas regras
  const chip = (valor, rotulo, n, cls, titulo) => el("button", {
    class: `cat ${cls} ${estado.setup === valor ? "ativo" : ""}`, title: titulo, "aria-pressed": estado.setup === valor,
    onclick: () => escolherSetup(valor) }, rotulo, n != null ? [" ", el("span", { class: "contagem" }, n)] : null);
  const semEvento = ramo.filter((x) => !contar([x.id]));
  const visiveis = ramo.filter((x) => estado.verVazios || contar([x.id]) || x.id === estado.setup);
  const lado = estado.lado === "compra" ? "compra" : "venda";
  $("categorias").replaceChildren(el("div", { class: "grupo-cat" },
    chip("todos", "Todos os setups", contar(ids(ramo)), "cat-todos", `Todos os setups de ${lado} ${estado.estilo === "tendencia" ? "a favor" : "contra"} da tendência`),
    ...visiveis.map((x) => chip(x.id, nomeCurto(x), contar([x.id]), suportado(x) ? "" : "so-python", x.desc)),
    semEvento.length ? el("button", { class: "cat cat-mais", onclick: () => { estado.verVazios = !estado.verVazios; salvar(); renderArvore(); } },
      estado.verVazios ? "− esconder os sem evento" : `+${semEvento.length} sem evento`) : null,
    el("span", { class: "sep-cat", "aria-hidden": "true" }),
    ...NEUTROS.map((x) => chip(x.id, `◆ ${x.nome}`, contar([x.id]), "cat-neutro", `Sem lado: ${x.desc}`)),
    chip("minhas", "✎ Minhas regras", null, "cat-minhas", "Monte as suas regras (salvas neste navegador)"),
    el("button", { class: "recolher", title: "Recolher a árvore", "aria-label": "Recolher a árvore",
      onclick: () => { estado.arvore = false; salvar(); renderArvore(); } }, "▴")));

  // árvore recolhida: só o caminho até o setup
  $("menu-op").hidden = !estado.arvore;
  $("trilha").hidden = estado.arvore;
  if (!estado.arvore) {
    const x = setupAtual();
    const passos = ehMinhas() ? ["✎ Minhas regras", regraSalva()?.nome ?? "regras em edição"]
      : x?.vies === "neutro" ? [`◆ ${x.nome}`]
        : [estado.lado === "compra" ? "▲ Compra" : "▼ Venda", ESTILOS.find((e) => e.chave === estado.estilo).nome, x ? nomeCurto(x) : "Todos os setups"];
    $("trilha").replaceChildren(el("span", { class: `trilha-passos ${ehMinhas() ? "minhas" : x?.vies === "neutro" ? "neutro" : estado.lado}` },
      passos.flatMap((p, j) => [j ? el("span", { class: "trilha-sep" }, "›") : null, el("b", {}, p)])),
    el("button", { class: "botao", onclick: () => { estado.arvore = true; salvar(); renderArvore(); } }, "▾ Trocar setup"));
  }
}

// ------------------------------------------------------------- minhas regras

const SALVOS = "rastreador-salvos";  // as mesmas regras salvas na antiga Multitela
const salvos = () => guardar.ler(SALVOS, []);

function minhas() {
  const m = (estado.minhas ??= {});
  if (!Array.isArray(m.regras)) {
    const s = salvos()[0];
    Object.assign(m, s ? { modelo: `u:${s.id}`, regras: structuredClone(s.regras), vies: s.vies ?? "compra" }
      : { modelo: "novo", regras: structuredClone(SETUP.get("tend-alta")?.regras ?? [{ t: "preco_media", ...CONDICOES.preco_media.padrao }]), vies: "compra" },
    { editado: false });
  }
  m.regras = m.regras.filter((x) => CONDICOES[x.t]);
  m.vies ??= "compra";
  return m;
}
function regraSalva() {
  const mo = estado.minhas?.modelo ?? "";
  return mo.startsWith("u:") ? salvos().find((x) => x.id === mo.slice(2)) ?? null : null;
}
function abrirSalva(s) {
  estado.minhas = s ? { modelo: `u:${s.id}`, regras: structuredClone(s.regras), vies: s.vies ?? "compra", editado: false }
    : { modelo: "novo", regras: [{ t: "preco_media", ...structuredClone(CONDICOES.preco_media.padrao) }], vies: estado.lado, editado: false };
  if (!s) estado.editando = true;
}
function copiarParaMinhas(x) {
  estado.minhas = { modelo: "novo", regras: structuredClone(x.regras), vies: x.vies, editado: true, base: x.nome };
  estado.setup = "minhas";
  estado.editando = true;
  mudou();
}

/** Um campo do editor de regras (select, número ou média = tipo + período). */
function campoRegra(x, c, aoMudar) {
  const def = CONDICOES[x.t];
  const tf = estado.tf;
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

function renderRegras() {
  const caixa = $("caixa-regras");
  caixa.hidden = !ehMinhas();
  if (!ehMinhas()) return;
  if (!F) { caixa.replaceChildren(el("p", { class: "sub" }, "Não consegui carregar data/rastreador.json: as minhas regras precisam dele.")); return; }
  const m = minhas();
  const editou = () => { m.editado = true; estado.pagina = 0; salvar(); renderRegras(); atualizar(); };
  const lista = salvos();
  $("r-salvos").replaceChildren(
    ...lista.map((s) => el("button", { class: `chip-modelo vies-${s.vies} ${m.modelo === `u:${s.id}` ? "ativo" : ""}`,
      onclick: () => { abrirSalva(s); mudou(); } }, s.vies === "compra" ? "▲ " : s.vies === "venda" ? "▼ " : "◆ ", s.nome)),
    el("button", { class: `chip-modelo nova ${m.modelo === "novo" ? "ativo" : ""}`, title: "Começar regras novas",
      onclick: () => { abrirSalva(null); mudou(); } }, m.modelo === "novo" ? `+ ${m.base ? `Baseada em ${m.base}` : "Nova regra"}` : "+ Nova regra"));
  document.querySelectorAll("#r-vies button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === m.vies));
  const s = regraSalva();
  $("r-resumo").replaceChildren(el("b", {}, `${s?.nome ?? "Regras novas"}${m.editado && s ? " (editado)" : ""}`), ": ",
    m.regras.length ? m.regras.map((x) => textoRegra(x, estado.tf, F)).join(" · ") : "nenhuma condição");
  $("r-editor").hidden = !estado.editando;
  $("r-editar").setAttribute("aria-expanded", String(!!estado.editando));
  $("r-editar").textContent = estado.editando ? "✓ Fechar editor" : "✎ Editar regras";
  $("r-excluir").hidden = !s;
  $("r-restaurar").hidden = !(m.editado && s);
  if (!estado.editando) return;
  $("r-regras").replaceChildren(...m.regras.map((x, i) => el("li", { class: "regra" },
    el("span", { class: "regra-e" }, i ? "E" : "SE"),
    el("span", { class: "regra-campos" }, CONDICOES[x.t].campos.map((c) => campoRegra(x, c, editou))),
    el("button", { class: "regra-remover", title: "Remover esta condição", "aria-label": "Remover condição",
      onclick: () => { m.regras.splice(i, 1); editou(); } }, "×"))));
  const grupos = [...new Set(Object.values(CONDICOES).map((c) => c.grupo))];
  $("r-adicionar").replaceChildren(el("option", { value: "" }, "+ Adicionar condição…"),
    ...grupos.map((g) => el("optgroup", { label: g }, Object.entries(CONDICOES).filter(([, c]) => c.grupo === g)
      .map(([k, c]) => el("option", { value: k }, c.nome)))));
  $("r-base").replaceChildren(el("option", { value: "" }, "⧉ Copiar regras de um setup…"),
    ...[...new Set(SETUPS.map((x) => x.grupo))].map((g) => el("optgroup", { label: g },
      SETUPS.filter((x) => x.grupo === g && suportado(x)).map((x) => el("option", { value: x.id }, x.nome)))));
}

function ligarRegras() {
  segmento("r-vies", ({ v }) => { minhas().vies = v; salvar(); renderRegras(); atualizar(); });
  $("r-editar").addEventListener("click", () => { estado.editando = !estado.editando; salvar(); renderRegras(); });
  $("r-adicionar").addEventListener("change", (e) => {
    const t = e.target.value;
    if (!t) return;
    const m = minhas();
    m.regras.push({ t, ...structuredClone(CONDICOES[t].padrao) });
    m.editado = true; estado.pagina = 0; salvar(); renderRegras(); atualizar();
  });
  $("r-base").addEventListener("change", (e) => {
    const x = SETUP.get(e.target.value);
    if (!x) return;
    const m = minhas();
    Object.assign(m, { regras: structuredClone(x.regras), vies: x.vies, editado: true, base: x.nome });
    estado.pagina = 0; salvar(); renderRegras(); atualizar();
  });
  $("r-salvar").addEventListener("click", () => {
    const m = minhas();
    const atualS = regraSalva();
    const nome = prompt("Nome para estas regras:", atualS?.nome ?? m.base ?? "Minha regra");
    if (!nome) return;
    const lista = salvos();
    const id = atualS && atualS.nome === nome ? atualS.id : `${Date.now()}`;
    guardar.gravar(SALVOS, [...lista.filter((x) => x.id !== id), { id, nome, vies: m.vies, regras: structuredClone(m.regras) }]);
    Object.assign(m, { modelo: `u:${id}`, editado: false, base: undefined });
    salvar(); renderRegras(); renderArvore(); tituloLista();
  });
  $("r-excluir").addEventListener("click", () => {
    const s = regraSalva();
    if (!s || !confirm(`Excluir "${s.nome}"?`)) return;
    guardar.gravar(SALVOS, salvos().filter((x) => x.id !== s.id));
    estado.minhas = null;
    mudou();
  });
  $("r-restaurar").addEventListener("click", () => { abrirSalva(regraSalva()); mudou(); });
}

// ------------------------------------------------------------- barra do resultado

function renderBarra() {
  const rot = estado.tf === "D" ? "pregão" : "semana";
  document.querySelectorAll("#f-periodo button").forEach((b) => {
    const n = +b.dataset.v;
    b.textContent = n === 1 ? (estado.tf === "D" ? "Último pregão" : "Última semana") : `${n} ${rot}s`;
  });
  const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
  const n = lista.length;
  let txt;
  if (ehMinhas()) {
    const quando = estado.periodo === 1 ? (estado.tf === "W" ? "na última semana fechada" : "no último pregão fechado")
      : `${estado.tf === "W" ? "nas últimas" : "nos últimos"} ${unid(estado.tf, estado.periodo)}`;
    txt = `${n} ${n === 1 ? "ativo atendeu" : "ativos atenderam"} ${quando}`;
  } else {
    const mercados = [...P.ultima.keys()].filter((m) => nomes[m] && (!estado.mercado || m === estado.mercado));
    txt = `${n} ${n === 1 ? "ativo" : "ativos"} · ${estado.periodo === 1 ? `último ${rot}` : `últimos ${estado.periodo} ${rot}s`}` +
      (mercados.length ? ` · ${mercados.map((m) => `${nomes[m]} ${fmtData(P.ultima.get(m), estado.tf === "D")}`).join(" · ")}` : "") +
      (eventosLocais ? " · eventos calculados no navegador" : "");
  }
  $("f-descricao").textContent = txt;
  $("f-descricao").title = eventosLocais ? "data/radar.json ainda não traz os eventos do catálogo: calculei aqui, com as regras que o navegador conhece, nos últimos 5 candles fechados." : "";
  const so2 = lista.filter((i) => i.setups.size >= 2).length;
  $("rot-so2").textContent = estado.so2 ? "Só com 2+ setups" : `Só com 2+ setups (${so2})`;
  $("f-so2").checked = estado.so2;
  $("f-ordem").replaceChildren(...Object.entries(ORDENS).map(([k, [r]]) => el("option", { value: k, selected: k === estado.ordem ? true : null }, r)));
  const grade = estado.visao === "grade";
  document.querySelectorAll(".so-grade").forEach((x) => { x.hidden = !grade; });
  $("f-indicadores").hidden = !grade || estado.camadas === "condicoes";
  $("f-grade").hidden = !grade;
  aplicarCompacto();
}

/** Árvore compacta (sem as dicas dos estilos) na grade e em telas baixas, para a visão caber na janela. */
const aplicarCompacto = () => $("menu-setups").classList.toggle("compacto", estado.visao === "grade" || innerHeight < 1000);

// ------------------------------------------------------------- ciclo

function atualizarURL() {
  const q = new URLSearchParams(location.search);
  q.delete("visao");
  if (SETUP.has(estado.setup)) q.set("setup", estado.setup); else q.delete("setup");
  const busca = q.toString();
  history.replaceState(null, "", `${location.pathname}${busca ? `?${busca}` : ""}${estado.ticker ? `#${encodeURIComponent(estado.ticker)}` : ""}`);
}

/** Recalcula o resultado e redesenha a visão (menu já atualizado). */
function atualizar() {
  lista = listar();
  renderBarra();
  $("vista-lista").hidden = estado.visao !== "lista";
  $("vista-grade").hidden = estado.visao !== "grade";
  if (estado.visao === "lista") {
    renderLista();
    renderGrade();  // desmonta a grade
    encaixar();
    // o ativo aberto continua se ainda estiver na lista; senão, abre o primeiro
    const tk = lista.some((i) => i.ticker === estado.ticker) || manterTicker ? estado.ticker : lista[0]?.ticker ?? estado.ticker;
    manterTicker = false;
    if (tk) selecionar(tk, false);
  } else {
    paginaDoAtivo();
    renderGrade();
  }
}
let manterTicker = false;  // o ativo do endereço abre mesmo fora da lista

/** Mudou o setup, o período, o mercado...: árvore, regras e resultado. */
function mudou() {
  estado.pagina = 0;
  calcularPeriodo();
  salvar();
  atualizarURL();
  renderArvore();
  renderRegras();
  atualizar();
}

function renderRetidos() {
  const ret = R.retidos ?? [];
  $("retidos-resumo").textContent = `${ret.length} ativo(s)`;
  $("lista-retidos").replaceChildren(...(ret.length
    ? ret.map((r) => el("li", {}, el("b", { class: "mono" }, r.rotulo ?? semSufixo(r.ticker)), ` ${r.nome}: `, el("span", { class: "sub" }, r.motivo)))
    : [el("li", { class: "sub" }, "Nenhum. Todos os ativos passaram na verificação.")]));
}

/** Acha o ativo pelo que veio no endereço: PETR4.SA, PETR4, BTC, BRK.B... */
function acharTicker(txt) {
  const t = decodeURIComponent(txt).trim().toUpperCase();
  if (!t) return null;
  const porRotulo = new Map(R.ativos.map((a) => [(a.rotulo ?? semSufixo(a.ticker)).toUpperCase(), a.ticker]));
  return [t, `${t}.SA`, t.replace(".", "-"), `${t}-USD`, porRotulo.get(t)].find((x) => x && porTicker.has(x)) ?? null;
}

document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (estado.visao === "lista" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    mover(e.key === "ArrowDown" ? 1 : -1);
  } else if (estado.visao === "grade" && !e.shiftKey && !document.fullscreenElement && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    e.preventDefault();
    irParaPagina(estado.pagina + (e.key === "ArrowRight" ? 1 : -1));
  }
});

async function iniciar() {
  let C;
  try { [R, C] = await Promise.all([carregarRadar(), carregarCatalogo()]); } catch (e) { montarTopo("setups"); return erroDados(e); }
  try { F = await carregarRastreador(); } catch {}
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("setups", R);
  SETUPS = C.grupos.flatMap((g) => g.itens.map((x) => ({ ...x, grupo: g.nome })));
  SETUP = new Map(SETUPS.map((x) => [x.id, x]));
  NEUTROS = SETUPS.filter((x) => x.vies === "neutro");
  EVENTOS = (R.sinais ?? []).filter((s) => s.setup && porTicker.has(s.ticker));
  if (!EVENTOS.length && F) { EVENTOS = calcularEventosLocais(); eventosLocais = true; }

  // estado salvo que deixou de existir
  if (!["todos", "minhas"].includes(estado.setup) && !SETUP.has(estado.setup)) estado.setup = "todos";
  if (!ORDENS[estado.ordem]) estado.ordem = "confluencia";
  if (!["D", "W"].includes(estado.tf)) estado.tf = "D";
  // endereço: ?setup=pb-mm20 escolhe o setup, ?visao=grade a visão, #PETR4.SA o ativo
  const q = new URLSearchParams(location.search);
  if (SETUP.has(q.get("setup"))) {
    const x = SETUP.get(q.get("setup"));
    estado.setup = x.id;
    if (x.vies !== "neutro") { estado.lado = x.vies; estado.estilo = x.estilo; }
  }
  if (["lista", "grade"].includes(q.get("visao"))) estado.visao = q.get("visao");
  const doHash = location.hash.length > 1 ? acharTicker(location.hash.slice(1)) : null;
  if (doHash) { estado.ticker = doHash; manterTicker = true; }

  $("lugar-aviso").replaceWith(avisoFormacao(R));
  $("f-indicadores").replaceChildren(atalhosIndicadores({ comSinais: true, comIFR: false }));
  painel = painelGrafico($("painel-grafico"), { simular: true });
  // o simulador usa o aoMostrar; o destaque do candle do setup vem depois dele
  const antes = painel.grafico.aoMostrar;
  painel.grafico.aoMostrar = () => { antes?.(); destacarNoPainel(); };

  const ligar = (id, chave, conv, depois) =>
    segmento(id, ({ v }) => { estado[chave] = conv(v); depois(); }).marcar("v", String(estado[chave]));
  ligar("f-mercado", "mercado", String, mudou);
  ligar("f-periodo", "periodo", Number, mudou);
  ligar("f-tf", "tf", String, () => {
    estado.tfGrafico = estado.tf;  // o gráfico acompanha o tempo do sinal (dá para trocar depois)
    document.querySelectorAll("#f-tf-grafico button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === estado.tf));
    painel.mudarTf(estado.tf);
    mudou();
  });
  ligar("f-visao", "visao", String, () => { salvar(); renderArvore(); atualizar(); });
  ligar("f-grade", "grade", String, () => { salvar(); paginaDoAtivo(); atualizar(); });
  ligar("f-tf-grafico", "tfGrafico", String, () => { salvar(); renderGrade(); });
  ligar("f-camadas", "camadas", String, () => { salvar(); renderBarra(); renderGrade(); });
  $("f-so2").addEventListener("change", (e) => { estado.so2 = e.target.checked; estado.pagina = 0; salvar(); atualizar(); });
  $("f-ordem").addEventListener("change", (e) => { estado.ordem = e.target.value; estado.pagina = 0; salvar(); atualizar(); });
  document.querySelector(".abas-lado").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) escolherRamo(b.dataset.lado, estado.estilo);
  });
  ligarRegras();
  renderRetidos();

  calcularPeriodo();
  atualizarURL();
  renderArvore();
  renderRegras();
  atualizar();
  if (!estado.ticker) { estado.ticker = lista[0]?.ticker ?? R.ativos[0]?.ticker; atualizarURL(); }
}

iniciar();
