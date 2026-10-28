/* Ativo (ativo.html#TICKER): tudo sobre um papel. Gráfico grande (simulador, desenhos, personalizar,
 * tela cheia) e, ao lado, os setups recentes, o contexto a favor/cuidado e as simulações; embaixo,
 * como cada setup do catálogo se saiu neste ativo e o panorama dos indicadores. */

const ficha = { ticker: null, tfCtx: "D", vies: null, cond: guardar.ler("ativo-condicoes", {}).meus ? "meus" : "auto" };
let R, porTicker, painel;
let F;  // rastreador: undefined enquanto carrega (é grande, 700 KB), null se falhou

// ------------------------------------------------------------- troca de ativo

/** Abre um ativo. `historico`: grava a troca no histórico do navegador (o voltar volta ao anterior). */
function abrirAtivo(tk, historico = true) {
  const a = porTicker.get(tk);
  if (!a) return;
  const mudou = ficha.ticker !== tk;
  ficha.ticker = tk;
  if (mudou) ficha.vies = null, ficha.todos = false;  // o viés volta a ser o dos setups recentes do novo ativo
  if (mudou && ficha.cond !== "meus") ficha.cond = "auto";  // as condições voltam a ser as dos setups mais recentes do novo ativo
  guardar.gravar("ativo-ticker", tk);
  document.querySelector(".aviso-ativo")?.remove();
  const hash = `#${encodeURIComponent(tk)}`;
  if (location.hash !== hash) history[historico ? "pushState" : "replaceState"](null, "", hash);
  document.title = `${semSufixo(tk)} · ${a.nome} · Carteira Terminal`;
  document.getElementById("f-ativo").value = "";
  renderCabecalho(a);
  renderLateral(a);
  // o gráfico pede os candles antes do histórico pedir o backtest (430 KB): o gráfico é o que a pessoa veio ver
  const pronto = mudou ? painel.selecionar(a, eventosDoAtivo(R, tk).map(eventoParaGrafico)).then(() => (condicoes(), definirContextoSimulacao(a)))
    : Promise.resolve();
  renderHistorico(a);
  renderPanorama(a);
  return pronto;
}

// ------------------------------------------------------------- simular trade

/** O contexto do trade deste ativo: o evento mais recente (diário antes do semanal), ou o setup pedido no endereço. */
function ctxSimulacao(a, { setup, tf, lado } = {}) {
  const ev = eventosDoAtivo(R, a.ticker);
  const e = (setup && ev.find((x) => x.setup === setup)) || ev[0];
  const l = lado ?? (e?.lado === "venda" || e?.lado === "compra" ? e.lado : ficha.vies === "venda" ? "venda" : "compra");
  return { lado: l, ctx: { ticker: a.ticker, lado: l, setup: e?.setup, tf: tf ?? e?.tf ?? (painel?.grafico.tf === "W" ? "W" : "D"),
    data: e?.data ?? a.data, preco: e?.preco ?? a.ultimo, origem: "ativo" } };
}

/** O Simulador da página guarda de onde veio o trade (setup, tempo, origem) para o Diário. */
function definirContextoSimulacao(a, pedido) {
  const { lado, ctx } = ctxSimulacao(a, pedido);
  if (painel?.simulador) painel.simulador.contexto = { setup: ctx.setup, tf: ctx.tf, origem: "ativo" };
  return lado;
}

/** Começa uma simulação nova no gráfico desta página. true se o gráfico pôde recebê-la. */
function simularNoGrafico(tk, pedido) {
  const a = porTicker.get(tk ?? ficha.ticker);
  if (!a || !painel?.simulador) return false;
  if (a.ticker !== ficha.ticker) return false;
  const lado = definirContextoSimulacao(a, pedido);
  painel.simulador.novo(lado);
  document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("painel-grafico").querySelector(".boleta input")?.focus({ preventScroll: true });
  return true;
}
window.simularAqui = (tk) => simularNoGrafico(tk);

/** Aviso de ticker do endereço que não existe nos dados (o ativo aberto continua o mesmo). */
function avisoNaoAchado(pedido) {
  document.querySelector(".aviso-ativo")?.remove();
  document.querySelector(".cab-ativo").append(el("p", { class: "aviso-ativo" },
    `Não encontrei “${pedido}” entre os ativos publicados; mostrando ${semSufixo(ficha.ticker)}.`));
  history.replaceState(null, "", `#${encodeURIComponent(ficha.ticker)}`);
}

function vizinho(passo) {
  const i = R.ativos.findIndex((a) => a.ticker === ficha.ticker);
  const n = R.ativos.length;
  abrirAtivo(R.ativos[(i + passo + n) % n].ticker);
}

/** Ticker do endereço (#PETR4.SA ou #PETR4); null se não houver ou não existir. */
const tickerDoEndereco = () => acharAtivo(R.ativos, decodeURIComponent(location.hash.slice(1).split("?")[0]));

// ------------------------------------------------------------- cabeçalho

function renderCabecalho(a) {
  const p = precoAtual(a);
  const variacao = (rot, v) => el("span", { class: "cab-ativo-var" }, rot, " ", el("b", { class: cor(v) }, fmtPct(v)));
  const tend = (rot, t) => el("span", { class: `tend-pilula ${t}` }, rot, " ",
    el("b", {}, t === "alta" ? "▲ alta" : t === "baixa" ? "▼ baixa" : "▬ lateral"));
  document.getElementById("cab-ativo-id").dataset.tk = a.ticker;  // arrastar.js: segurar o cabeçalho leva o ativo
  document.getElementById("cab-ativo-id").replaceChildren(
    el("div", { class: "cab-ativo-nome" },
      el("h1", { class: "mono" }, semSufixo(a.ticker)), el("span", {}, a.nome), el("span", { class: "tag" }, a.mercado), selosBandeja(a.ticker)),
    el("div", { class: "cab-ativo-preco" },
      p.parcial ? el("span", { class: "ponto-formacao", title: `Pregão de ${fmtData(a.parcial.data)} em andamento` }, "● ") : null,
      el("b", { class: "mono" }, fmtMoeda(p.ultimo, a.moeda)), " ",
      el("b", { class: `mono ${cor(p.var_pct)}` }, fmtPct(p.var_pct)),
      el("span", { class: "sub" }, p.parcial ? ` hoje, em formação (fechamento de ${fmtData(a.data)}: ${fmtMoeda(a.ultimo, a.moeda)})` : ` fechamento de ${fmtData(a.data, true)}`)),
    el("div", { class: "cab-ativo-extra" },
      variacao("Mês", a.var_mes_pct), variacao("Ano", a.var_ano_pct),
      tend("Diário", a.tend_d), tend("Semanal", a.tend_s), seloVerificacao(a)));
  document.getElementById("cab-ativo-links").replaceChildren(
    el("button", { type: "button", class: "botao primario botao-simular-ativo", id: "simular-trade",
      title: "Simular um trade neste ativo: arraste entrada, stop e alvo no gráfico e acompanhe o resultado em R no Diário",
      onclick: () => simularNoGrafico(a.ticker) }, "⊕ Simular trade"),
    Plano.botao(() => ctxBandeja(a)), Notas.botao(() => ctxBandeja(a)),
    el("a", { class: "botao", href: `setups.html#${encodeURIComponent(a.ticker)}`, title: "Abrir este ativo na página de oportunidades (grade de setups)" }, "Ver nas oportunidades →"),
    el("a", { class: "botao", href: "carteira.html", title: "Posições, minha lista e plano de amanhã" }, "Carteira"),
    window.Arrastar?.menu(a.ticker));
}

/** O ativo aberto no formato do plano e das anotações: lado e setup dos eventos mais recentes, tempo do gráfico. */
function ctxBandeja(a) {
  const ev = eventosDoAtivo(R, a.ticker);
  return { ticker: a.ticker, setup: ev[0]?.setup, tf: painel?.grafico.tf === "W" ? "W" : "D", data: a.data,
    lado: ficha.vies ?? viesDosEventos(ev), preco: a.ultimo };
}

// ------------------------------------------------------------- lateral: setups, contexto, simulações

const tituloBloco = (txt, extra) => el("p", { class: "ficha-titulo" }, txt, extra ? el("span", {}, extra) : null);

/** Quanto o preço andou do fechamento do evento até hoje, a favor ou contra o lado dele. */
function desdeOSinal(e, a) {
  if (!e.preco || !a.ultimo || (e.lado !== "compra" && e.lado !== "venda")) return null;
  const v = ((e.lado === "compra" ? 1 : -1) * (a.ultimo / e.preco - 1)) * 100;
  return el("div", { class: "ficha-sinal-desde" }, `Desde ${fmtData(e.data)} (${fmtMoeda(e.preco, a.moeda)}): `,
    el("b", { class: cor(v) }, `${fmtPct(v)} ${v >= 0 ? "a favor" : "contra"}`));
}

async function irParaSinal(e, item, grupo) {
  document.querySelectorAll(".ficha-sinal.ativo, .data-evento.ativo").forEach((n) => n.classList.remove("ativo"));
  item.classList.add("ativo");
  if (grupo) ficha.cond = chaveGrupo(grupo);  // o setup clicado passa a ser o que o gráfico explica
  condicoes();
  await painel.irPara(e.data, e.tf === "W" ? "W" : "D");  // se muda o tempo gráfico, aoMostrar refaz as condições
  condicoes();
  if (window.innerWidth < 1100) document.getElementById("painel-grafico").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Setups recentes: um item por setup e tempo gráfico, com as datas em que disparou (cada data leva o gráfico até lá). */
const VISIVEIS_SETUPS = 6;
function blocoSetups(a) {
  const grupos = agruparPorSetup(eventosDoAtivo(R, a.ticker));
  const desde = R.sinais.reduce((m, s) => (s.data < m ? s.data : m), "9999");
  const unidade = (tf, n) => (tf === "W" ? (n === 1 ? "semana" : "semanas") : n === 1 ? "pregão" : "pregões");
  return el("li", { class: "ficha-bloco" },
    tituloBloco("Setups recentes", R.sinais.length ? `${grupos.length} desde ${fmtData(desde)}` : null),
    grupos.length ? el("p", { class: "sub" }, "Clique num setup (ou numa data) para ver no gráfico o que o preço fez depois.") : null,
    grupos.length ? el("ul", { class: "ficha-sinais" }, grupos.map((g, i) => {
      const ultimo = g.eventos[0], primeiro = g.eventos.at(-1);
      const s = SETUP_POR_ID.get(g.setup);
      return el("li", { class: `ficha-sinal ${g.lado}${ficha.cond === chaveGrupo(g) ? " cond-ativa" : ""}`, tabindex: "0", "data-grupo": chaveGrupo(g),
        title: "Ver no gráfico, com as condições deste setup", hidden: i >= VISIVEIS_SETUPS && !ficha.todos,
        onclick: (ev) => { if (!ev.target.closest(".data-evento")) irParaSinal(ultimo, ev.currentTarget, g); },
        onkeydown: (ev) => ev.key === "Enter" && ev.target === ev.currentTarget && irParaSinal(ultimo, ev.currentTarget, g) },
        el("div", { class: "ficha-sinal-topo" },
          el("span", { class: "data" }, fmtData(g.ultima)),
          el("span", { class: "chip ctx", title: g.tf === "W" ? "Setup no semanal" : "Setup no diário" }, NOME_TF_EVENTO[g.tf] ?? g.tf),
          el("b", { class: classeLado(g.lado) }, setaLado(g.lado), nomeSetup(g.setup)),
          seloEvento(ultimo)),
        s?.desc ? el("div", { class: "ficha-sinal-texto" }, s.desc) : null,
        el("div", { class: "datas-evento" },
          g.eventos.length > 1 ? el("span", { class: "sub" }, `${g.eventos.length} ${unidade(g.tf, g.eventos.length)}:`) : null,
          g.eventos.map((e) => el("button", { class: "data-evento", title: `Ver ${fmtData(e.data)} no gráfico`,
            onclick: (ev) => irParaSinal(e, ev.currentTarget, g) }, fmtData(e.data)))),
        desdeOSinal(primeiro, a));
    })) : null,
    grupos.length > VISIVEIS_SETUPS ? el("button", { class: "botao ver-mais", onclick: () => { ficha.todos = !ficha.todos; renderLateral(a); } },
      ficha.todos ? "Mostrar menos" : `Ver mais ${grupos.length - VISIVEIS_SETUPS} setups`) : null,
    grupos.length ? null
      : el("p", { class: "sub" }, "Nenhum setup disparou neste ativo no período publicado."));
}

/** Viés padrão do contexto: o lado da maioria dos setups do dia mais recente (diário, senão semanal). */
function viesDosEventos(eventos) {
  for (const tf of ["D", "W"]) {
    const doTf = eventos.filter((e) => e.tf === tf);
    if (!doTf.length) continue;
    const doDia = doTf.filter((e) => e.data === doTf[0].data);
    const c = doDia.filter((e) => e.lado === "compra").length, v = doDia.filter((e) => e.lado === "venda").length;
    return c > v ? "compra" : v > c ? "venda" : "neutro";
  }
  return "neutro";
}

function blocoContexto(a) {
  const eventos = eventosDoAtivo(R, a.ticker);
  const vies = ficha.vies ?? viesDosEventos(eventos);
  const fotos = F?.ativos?.[a.ticker];
  const opcoes = (itens, atualV, aoMudar) => el("div", { class: "segmento segmento-mini" }, itens.map(([v, rot]) =>
    el("button", { class: v === atualV ? "ativo" : null, onclick: () => aoMudar(v) }, rot)));
  const controles = el("div", { class: "contexto-controles" },
    opcoes([["D", "Diário"], ["W", "Semanal"]], ficha.tfCtx, (v) => { ficha.tfCtx = v; renderLateral(a); }),
    opcoes([["compra", "▲ Compra"], ["neutro", "Neutro"], ["venda", "▼ Venda"]], vies, (v) => { ficha.vies = v; renderLateral(a); }));
  if (!fotos) return el("li", { class: "ficha-bloco" }, tituloBloco("Contexto"),
    el("p", { class: "sub contexto-carregando" }, F === undefined ? "Carregando os indicadores do rastreador…"
      : F ? "Sem os indicadores do rastreador para este ativo." : "Indicadores do rastreador indisponíveis."));
  const { favor, cuidado, info } = contextoDecisao(a, fotos, ficha.tfCtx, vies, eventos, nomeSetup);
  const lista = (titulo, itens, cls, simbolo) => (itens.length ? el("div", { class: `contexto-grupo ${cls}` },
    el("h4", {}, titulo),
    el("ul", { class: `contexto-lista ${cls}` }, itens.map((t) => el("li", {}, el("span", { class: "simbolo" }, simbolo), t)))) : null);
  return el("li", { class: "ficha-bloco" },
    tituloBloco("Contexto", vies === "neutro" ? "sem lado" : `para ${vies}`),
    controles,
    el("p", { class: "sub" }, vies === "neutro"
      ? "Sem lado escolhido: tendência e osciladores entram como informação."
      : `O que ajuda e o que pede cuidado numa ${vies}${ficha.vies ? "" : " (o lado dos setups mais recentes)"}.`),
    el("div", { class: "contexto-decisao contexto-ativo" },
      lista("A favor", favor, "favor", "✓"), lista("Cuidado", cuidado, "cuidado", "⚠"), lista("Informações", info, "info", "·")));
}

function blocoSimulacoes(a) {
  return el("li", { class: "ficha-bloco" }, tituloBloco("Minhas simulações", el("a", { href: "diario.html" }, "todas no Diário →")),
    chipsSimulacoes(a) ?? el("p", { class: "sub" }, "Nenhuma simulação neste ativo. Use ", el("b", {}, "⊕ Simular trade"), " acima."));
}

function renderLateral(a) {
  document.getElementById("ficha-lateral").replaceChildren(blocoSetups(a), blocoContexto(a), blocoSimulacoes(a), Notas.bloco(a.ticker));
}

// ------------------------------------------------------------- condições dos setups no gráfico

/*
 * Com o gráfico limpo (padrão), nada explica por que o ativo apareceu. Aqui o gráfico desenha o que os setups recentes usam
 * (médias, Bollinger, IFR...), com a mesma sobreposição das Oportunidades (sobreposicaoDasRegras). ficha.cond:
 * "auto" = setups do pregão (ou semana) mais recente, do lado da maioria; "<tf>|<setup>|<lado>" = só aquele setup;
 * "meus" = os indicadores do ⚙ Personalizar. Só vale em Diário e Semanal (as fotos do rastreador não têm outros tempos).
 */
const GRUPO_ESTADO = "Tendência";  // setups de estado (disparam em todo candle de uma tendência): não explicam uma entrada
const chaveGrupo = (g) => `${g.tf}|${g.setup}|${g.lado}`;
let barraCond, prefsVistas;

/** Regras do setup que o JS sabe desenhar (a boca de jacaré usa a Bollinger; multitempo e ranking não têm desenho). */
function regrasDoSetup(id) {
  return (SETUP_POR_ID.get(id)?.regras ?? []).map((r) => (r.t === "boca" ? { t: "bollinger", pos: "fechou_acima" } : r))
    .filter((r) => CONDICOES[r.t] && r.t !== "multitempo" && r.t !== "ranking");
}

/** Quais setups o gráfico explica agora: {grupos, uteis, auto, dia}. */
function gruposEmFoco(a, tf) {
  const todos = agruparPorSetup(eventosDoAtivo(R, a.ticker)).filter((g) => g.tf === tf);
  const uteis = todos.filter((g) => regrasDoSetup(g.setup).length);
  const entradas = uteis.filter((g) => SETUP_POR_ID.get(g.setup)?.grupo !== GRUPO_ESTADO);
  const base = entradas.length ? entradas : uteis;
  const dia = base[0]?.ultima;  // agruparPorSetup ordena pelo mais recente
  const escolhido = uteis.find((g) => chaveGrupo(g) === ficha.cond);
  if (escolhido) return { grupos: [escolhido], uteis, auto: false, dia };
  if (!base.length) return { grupos: [], uteis, auto: true };
  const doDia = base.filter((g) => g.ultima === dia);
  const c = doDia.filter((g) => g.lado === "compra").length, v = doDia.filter((g) => g.lado === "venda").length;
  const lado = c > v ? "compra" : v > c ? "venda" : doDia[0].lado;
  return { grupos: doDia.filter((g) => g.lado === lado || g.lado === "neutro"), uteis, auto: true, dia };
}

/** Atualiza a sobreposição do gráfico, a legenda e a barra de escolha conforme ficha.cond e o tempo gráfico. */
function condicoes() {
  const a = porTicker?.get(ficha.ticker);
  if (!a || !painel || !barraCond) return;
  const g = painel.grafico, tf = g.tf;
  const pode = tf === "D" || tf === "W";
  const { grupos, uteis, auto, dia } = pode ? gruposEmFoco(a, tf) : { grupos: [], uteis: [], auto: true };
  const meus = ficha.cond === "meus";
  let sob = null;
  if (!meus && grupos.length && F) {
    try {
      const regras = grupos.flatMap((x) => regrasDoSetup(x.setup));
      const datas = F.ativos?.[a.ticker]?.[tf]?.datas;
      const p = datas ? datas.lastIndexOf(grupos[0].ultima) : -1;
      sob = sobreposicaoDasRegras(regras, F.ativos?.[a.ticker]?.[tf], tf, F, p < 0 ? 0 : datas.length - 1 - p);
    } catch { sob = null; }
  }
  g.definirSobreposicao(sob);
  prefsVistas = JSON.stringify(Preferencias.ler());

  const foco = barraCond.contains(document.activeElement) ? document.activeElement.dataset.k : null;
  barraCond.hidden = !uteis.length;
  const botao = (k, rot, ativo, titulo) => el("button", { type: "button", class: "chip-cond", "data-k": k, "aria-pressed": String(ativo), title: titulo,
    onclick: () => { ficha.cond = k; guardar.gravar("ativo-condicoes", { meus: k === "meus" }); condicoes(); } }, rot);
  const entradas = uteis.filter((x) => SETUP_POR_ID.get(x.setup)?.grupo !== GRUPO_ESTADO);
  const chips = (entradas.length ? entradas : uteis).slice(0, 6);
  const escolhido = !auto && grupos[0];
  if (escolhido && !chips.includes(escolhido)) chips.push(escolhido);
  const legenda = sob ? legendaSobreposicao(sob) : [];
  barraCond.replaceChildren(...[
    el("span", { class: "cond-rotulo" }, "Condições no gráfico"),
    el("div", { class: "cond-opcoes", role: "group", "aria-label": "Condições dos setups no gráfico" },
      botao("auto", dia ? `Setups de ${fmtData(dia)}` : "Setups recentes", !meus && auto, "Desenha o que os setups mais recentes deste ativo usam, no lado da maioria"),
      chips.map((x) => botao(chaveGrupo(x), `${setaLado(x.lado)}${nomeSetup(x.setup)}`, !meus && !auto && chaveGrupo(x) === ficha.cond,
        `Desenhar só as condições de ${nomeSetup(x.setup)}`)),
      botao("meus", "Meus indicadores", meus, "Volta aos indicadores escolhidos em ⚙ Personalizar")),
    !meus && !sob ? el("span", { class: "sub cond-nota" }, F === undefined ? "Carregando as condições…" : F ? "Estes setups não têm indicador para desenhar." : "Condições indisponíveis.") : null,
    legenda.length ? el("div", { class: "legenda-extras cond-legenda" }, legenda.map((x) =>
      el("span", {}, el("i", { class: x.pontilhado ? "pontilhado" : null, style: `--cor:${x.cor}` }), x.txt))) : null].filter(Boolean));
  if (foco) barraCond.querySelector(`[data-k="${CSS.escape(foco)}"]`)?.focus({ preventScroll: true });
  document.querySelectorAll("#ficha-lateral .ficha-sinal[data-grupo]").forEach((n) => {
    const on = !meus && !auto && n.dataset.grupo === ficha.cond;
    n.classList.toggle("cond-ativa", on);
    if (on) n.setAttribute("aria-current", "true"); else n.removeAttribute("aria-current");
  });
}

function prepararCondicoes() {
  barraCond = el("div", { class: "cond-grafico", hidden: true });
  document.getElementById("painel-grafico").querySelector(".barra-grafico").after(barraCond);
  const g = painel.grafico, anterior = g.aoMostrar;  // o Simulador também usa este gancho
  g.aoMostrar = () => { anterior?.(); condicoes(); };
  prefsVistas = JSON.stringify(Preferencias.ler());
  // mexer nos indicadores em ⚙ Personalizar ou nas caixas acima do gráfico devolve o gráfico aos indicadores do usuário
  document.addEventListener("preferencias", () => {
    if (JSON.stringify(Preferencias.ler()) === prefsVistas || ficha.cond === "meus") return;
    ficha.cond = "meus";
    condicoes();
  });
}

// ------------------------------------------------------------- histórico dos setups neste ativo

/** Como cada setup do catálogo se saiu neste ativo (backtest), do de maior vantagem para o de menor. */
function renderHistorico(a) {
  const caixa = document.getElementById("bloco-historico");
  const cab = (sub) => el("div", { class: "painel-cab" }, el("div", {}, el("h2", {}, "Histórico dos setups neste ativo"),
    sub ? el("p", { class: "sub" }, sub) : null));
  caixa.replaceChildren(cab("Carregando…"));
  carregarBacktest().then((B) => {
    if (ficha.ticker !== a.ticker) return;
    const min = B.min_casos ?? 5;
    const linhas = [];
    for (const [tf, setups] of Object.entries(B.ativos?.[a.ticker] ?? {}))
      for (const [id, e] of Object.entries(setups ?? {})) if (e && typeof e.n === "number") linhas.push({ tf, id, e, poucos: e.n < min });
    linhas.sort((x, y) => x.poucos - y.poucos || (y.e.vantagem ?? -1e9) - (x.e.vantagem ?? -1e9));
    const prazo = B.principal ? ` Saída ${B.principal.D ?? 10} pregões depois no diário e ${B.principal.W ?? B.principal.S ?? 8} semanas no semanal.` : "";
    const validos = linhas.filter((l) => !l.poucos).length;
    if (!linhas.length) { caixa.replaceChildren(cab(), el("p", { class: "vazio" }, "Nenhum setup com histórico neste ativo.")); return; }
    const sinal = (v) => el("span", { class: cor(v) }, fmtPct(v));
    caixa.replaceChildren(
      cab(`${validos} setup(s) com ${min} ou mais casos nos últimos 6 anos, entrando na abertura seguinte ao setup.${prazo} ` +
        "Vantagem: quanto rendeu a mais que entrar num dia qualquer. Clique num setup para ver todos os casos no gráfico."),
      el("div", { class: "tabela-wrap" }, el("table", { class: "tabela-bt tabela-historico" },
        el("thead", {}, el("tr", {}, ["Setup", "Tempo", "Casos", "Acerto", "Médio", "Mediana", "Pior", "Melhor", "Vantagem"]
          .map((h, i) => el("th", { class: i >= 2 ? "num" : "" }, h)))),
        el("tbody", {}, linhas.map(({ tf, id, e, poucos }) => {
          const s = SETUP_POR_ID.get(id);
          const href = `setups.html?setup=${encodeURIComponent(id)}`;
          const abrir = () => abrirCasos({ ativo: a, setupId: id, nomeSetup: s?.nome ?? id, vies: s?.vies, tf, resumo: e,
            principal: B.principal?.[tf] ?? (tf === "W" ? B.principal?.S ?? 8 : 10) });
          return el("tr", { class: poucos ? "poucos" : null, title: poucos ? `Só ${e.n} caso(s): pouco para tirar conclusão` : s?.desc ?? null,
            onclick: (ev) => { if (!ev.target.closest("a, button")) abrir(); } },
            el("td", {}, el("b", { class: classeLado(s?.vies) }, setaLado(s?.vies)),
              el("button", { type: "button", class: "link-setup botao-casos", title: `Ver os ${e.n} casos de ${s?.nome ?? id} no gráfico`, onclick: abrir }, s?.nome ?? id),
              " ", el("a", { class: "bt-ver", href, title: "Ver os ativos neste setup agora" }, "hoje →")),
            el("td", {}, NOME_TF_EVENTO[tf] ?? tf),
            el("td", { class: "num" }, el("span", { class: "bt-casos-link" }, `${e.n} ›`)),
            el("td", { class: "num" }, e.acerto == null ? "—" : `${fmtNum(e.acerto, 0)}%`),
            el("td", { class: "num" }, sinal(e.medio)),
            el("td", { class: "num" }, sinal(e.mediana)),
            el("td", { class: "num" }, sinal(e.pior)),
            el("td", { class: "num" }, sinal(e.melhor)),
            el("td", { class: "num" }, el("b", {}, sinal(e.vantagem))));
        })))));
  }).catch(() => caixa.replaceChildren(cab(), el("p", { class: "vazio" }, "Backtest indisponível.")));
}

// ------------------------------------------------------------- panorama

/** Os números do ativo agrupados por assunto (o cartão do Panorama do antigo Radar). */
function renderPanorama(a) {
  const v = (x) => (x == null ? "—" : fmtNum(x, 0));
  const ifrCls = (x) => (x == null ? "" : x < 30 ? "alta" : x > 70 ? "baixa" : "");
  const metrica = (rot, valor, cls = "") => el("div", { class: "metrica" }, el("span", {}, rot), el("b", { class: cls }, valor));
  const bloco = (titulo, ...metricas) => el("div", { class: "bloco-metricas" }, el("p", {}, titulo), el("div", { class: "metricas-linha" }, metricas));
  const bb = a.bb_tf?.D;
  document.getElementById("bloco-panorama").replaceChildren(
    el("div", { class: "painel-cab" }, el("div", {}, el("h2", {}, "Panorama"),
      el("p", { class: "sub" }, a.tendencia_desde ? `Tendência forte de ${a.tendencia_forte} há ${a.tendencia_pregoes} pregões (desde ${fmtData(a.tendencia_desde)})` : "Indicadores do último fechamento"))),
    el("div", { class: "panorama" },
      bloco("Variação", metrica("Dia", fmtPct(a.var_dia_pct), cor(a.var_dia_pct)),
        metrica("Mês", fmtPct(a.var_mes_pct), cor(a.var_mes_pct)), metrica("Ano", fmtPct(a.var_ano_pct), cor(a.var_ano_pct)),
        metrica("Da máx. 52s", fmtPct(a.dist_max52_pct), cor(a.dist_max52_pct))),
      bloco("IFR 14", metrica("60 min", v(a.ifr_60), ifrCls(a.ifr_60)), metrica("Diário", v(a.ifr_d), ifrCls(a.ifr_d)),
        metrica("Semanal", v(a.ifr_s), ifrCls(a.ifr_s)), metrica("Mensal", v(a.ifr_m), ifrCls(a.ifr_m))),
      bloco("Distância das médias", metrica("MM20", fmtPct(a.dist_mm20_pct), cor(a.dist_mm20_pct)),
        metrica("MM50", fmtPct(a.dist_mm50_pct), cor(a.dist_mm50_pct)), metrica("MM200", fmtPct(a.dist_mm200_pct), cor(a.dist_mm200_pct))),
      bloco("Bollinger diário",
        metrica("Largura", bb ? `${fmtNum(bb.largura_pct, 1)}%` : "—"),
        metrica("Situação", bb?.comprimida ? "Comprimida" : bb ? "Normal" : "—", bb?.comprimida ? "aviso" : ""),
        metrica("Desde", bb?.desde ? fmtData(bb.desde.slice(0, 10)) : "—")),
      bloco("Liquidez", metrica("Volume médio 20d", a.volume_financeiro_20d != null ? fmtCompacto(a.volume_financeiro_20d) : "—"),
        metrica("Situação", a.liquido ? "Líquido" : "Pouca liquidez", a.liquido ? "" : "aviso"))));
}

// ------------------------------------------------------------- início

document.addEventListener("keydown", (e) => {
  if (!R || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.fullscreenElement) return;
  if (document.body.classList.contains("dr-travado")) return;  // janela dos casos aberta
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); vizinho(e.key === "ArrowRight" ? 1 : -1); }
});

async function iniciar() {
  aguardarPagina();
  const catalogo = carregarCatalogoSetups().catch(() => null);  // em paralelo com o radar, não depois dele
  try { R = await carregarRadar(); } catch (e) { montarTopo("ativo"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("ativo", R);
  document.querySelector(".cab-ativo").append(avisoFormacao(R));
  await catalogo;
  painel = painelGrafico(document.getElementById("painel-grafico"), { simular: true });
  prepararCondicoes();
  // diário: o trade salvo no gráfico leva o setup mais recente do mesmo lado e o tempo do gráfico
  if (painel.simulador) painel.simulador.contexto = (p) => {
    const ev = eventosDoAtivo(R, p.ticker).filter((e) => e.lado === p.lado);
    return { setup: ev[0]?.setup, tf: painel.grafico.tf === "W" ? "W" : ev[0]?.tf ?? "D", origem: "ativo" };
  };

  document.getElementById("lista-tickers").replaceChildren(...R.ativos.map((a) =>
    el("option", { value: a.rotulo ?? semSufixo(a.ticker) }, a.nome)));
  const campo = document.getElementById("f-ativo");
  campo.addEventListener("change", () => {
    const tk = acharAtivo(R.ativos, campo.value);
    if (tk) { abrirAtivo(tk); campo.blur(); }
    else campo.setCustomValidity("Ativo não encontrado"), campo.reportValidity(), campo.setCustomValidity("");
  });
  document.getElementById("ativo-anterior").addEventListener("click", () => vizinho(-1));
  document.getElementById("ativo-seguinte").addEventListener("click", () => vizinho(1));
  const doEndereco = () => {
    const tk = tickerDoEndereco();
    if (tk && tk !== ficha.ticker) abrirAtivo(tk, false);
    else if (!tk && location.hash.length > 1) avisoNaoAchado(decodeURIComponent(location.hash.slice(1)));
  };
  window.addEventListener("hashchange", doEndereco);
  window.addEventListener("popstate", doEndereco);
  // salvar/excluir uma simulação no gráfico atualiza os chips
  document.addEventListener("simulacoes", () => { const a = porTicker.get(ficha.ticker); if (a) renderLateral(a); });
  // plano de amanhã e anotações: botões do cabeçalho e bloco de anotações
  document.addEventListener("bandejas", () => { const a = porTicker.get(ficha.ticker); if (a) { renderCabecalho(a); renderLateral(a); } });

  const pedido = decodeURIComponent(location.hash.slice(1).split("?")[0]), achado = tickerDoEndereco();
  const inicial = achado ?? [guardar.ler("ativo-ticker", null), R.ativos.find((a) => a.carteira)?.ticker, R.ativos[0].ticker]
    .find((t) => porTicker.has(t));
  await abrirAtivo(inicial, false);
  if (pedido && !achado) avisoNaoAchado(pedido);
  paginaPronta();
  // o rastreador (700 KB) só alimenta o bloco "Contexto": pede-se depois dos candles do gráfico e o bloco se refaz quando ele chega
  carregarRastreador().catch(() => null).then((f) => {
    F = f;
    const a = porTicker.get(ficha.ticker);
    if (a) renderLateral(a);
    condicoes();
  });
  await abrirSimulacaoDoEndereco();
}

iniciar();

/**
 * ativo.html?simular=compra|venda|1&setup=<id>&tf=D|W#TICKER abre direto no modo simular (links de Oportunidades,
 * do Início e da Triagem quando o Diário não está na página). O pedido sai do endereço para o recarregar não repetir.
 */
async function abrirSimulacaoDoEndereco() {
  const q = new URLSearchParams(location.search);
  if (!q.has("simular") || !ficha.ticker) return;
  const v = q.get("simular");
  const pedido = { setup: q.get("setup") || undefined, tf: ["D", "W"].includes(q.get("tf")) ? q.get("tf") : undefined,
    lado: v === "compra" || v === "venda" ? v : undefined };
  history.replaceState(null, "", `${location.pathname}#${encodeURIComponent(ficha.ticker)}`);
  simularNoGrafico(ficha.ticker, pedido);
}
