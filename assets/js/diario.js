/* Diário (diario.html): resumo do mês, calendário de R por dia, lista de trades, estatísticas por estratégia
 * (com curva de R) e backup. Os dados vêm de Diario (diario-dados.js); o editor do trade também. */

let R, TA = [];  // TA: trades avaliados [{...trade, av}]

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const SEMANA_LONGA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const limpo = (l) => l.flat(Infinity).filter((x) => x != null && x !== false);
const hoje = () => new Date().toLocaleDateString("sv-SE");
const $ = (id) => document.getElementById(id);
const celular = () => matchMedia("(max-width: 800px)").matches;

const estado = {
  mes: hoje().slice(0, 7), dia: null, foco: null, periodo: "mes", por: "estrategia", sel: new Set(),
  f: { estado: "", estrategia: "", setup: "", mercado: "", lado: "", periodo: "", busca: "", ordem: "recentes" }, limite: 40,
};

// ------------------------------------------------------------- utilidades

const fechado = (t) => t.av?.fechado === true && t.av.resultado_r != null;
const rDe = (t) => t.av?.resultado_r ?? null;
const somaR = (l) => l.reduce((s, t) => s + (rDe(t) ?? 0), 0);
const iso = (d) => d.toISOString().slice(0, 10);
const parseISO = (s) => new Date(`${s}T12:00:00Z`);
const somarDias = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dataCurta = (s) => (s ? fmtData(s) : "—");
const dataBR = (s) => (s ? s.split("-").reverse().join("/") : "");
const nomeSetupDe = (id) => (id ? Diario.nomeDoSetup(id) : "");
const estrategiaDe = (t) => t.estrategia || Diario.SEM_ESTRATEGIA;
const rCurto = (v) => `${v > 0 ? "+" : ""}${fmtNum(v, 1)}R`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const refData = (t) => t.av?.saiu ?? t.av?.entrou ?? t.criada;
const mesDe = (ym) => { const [a, m] = ym.split("-").map(Number); return `${MESES[m - 1]} de ${a}`; };
const limpar = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const trecho = (txt, n = 90) => { const t = limpar(txt); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function indexar() {
  const mapa = (campo) => {
    const m = new Map();
    for (const t of TA) {
      const d = campo(t);
      if (!d) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(t);
    }
    return m;
  };
  return {
    saida: mapa((t) => (fechado(t) ? t.av.saiu : null)),
    entrada: mapa((t) => t.av?.entrou),
    criada: mapa((t) => (t.av?.estado === "aguardando" ? t.criada : null)),
  };
}
let IDX = indexar();

// ------------------------------------------------------------- resumo

function limitesPeriodo() {
  if (estado.periodo === "tudo") return {};
  const m = hoje().slice(0, 7);
  return { desde: `${m}-01`, ate: `${m}-31` };
}

function renderResumo() {
  const lim = limitesPeriodo();
  const est = Diario.estatisticas(TA, lim);
  const t = est.total;
  const abertos = TA.filter((x) => x.av?.estado === "aberta" && !x.arquivado);
  const rAberto = somaR(abertos);
  const grupos = Diario.estatisticas(TA, { ...lim, por: "estrategia" }).grupos;
  const rotulo = estado.periodo === "tudo" ? "em todo o período" : `em ${MESES[+hoje().slice(5, 7) - 1]}`;
  const kpi = (rot, valor, cls, extra, dica) => el("div", { class: "kpi", title: dica },
    el("div", { class: "kpi-rotulo" }, rot),
    el("div", { class: `kpi-valor ${cls ?? ""}` }, valor),
    el("div", { class: "kpi-extra dr-kpi-ajuda" }, extra));
  const melhor = grupos[0], pior = grupos.length > 1 ? grupos.at(-1) : null;
  $("dr-kpis").replaceChildren(
    kpi(estado.periodo === "tudo" ? "R no total" : "R no mês", t.trades ? fmtR(t.r_total) : "—", t.trades ? cor(t.r_total) : "",
      `${rotulo}, soma de todos os trades encerrados`, "Soma do resultado em R dos trades encerrados no período"),
    kpi("% de acerto", t.trades ? `${fmtNum(t.pct_acerto, 0)}%` : "—", "", t.trades ? `${t.acertos} de ${t.trades} deram lucro` : "ainda sem trades encerrados",
      "Quantos trades deram lucro. Sozinho não diz tudo: veja também o R médio."),
    kpi("Trades fechados", String(t.trades), "", rotulo, "Trades que bateram alvo, stop ou foram encerrados por você"),
    kpi("Expectativa", t.trades ? fmtR(t.r_medio) : "—", t.trades ? cor(t.r_medio) : "", "R médio por trade: positivo é bom sinal",
      "Quanto, em média, você ganha (ou perde) em R a cada trade"),
    kpi("Em aberto", String(abertos.length), "", abertos.length ? `${fmtR(rAberto)} parcial agora` : "nenhum trade rodando",
      "Trades que já entraram e ainda não bateram alvo nem stop"),
    el("div", { class: "kpi", title: "Estratégia com maior e menor R total no período" },
      el("div", { class: "kpi-rotulo" }, "Melhor / pior estratégia"),
      melhor ? el("div", { class: "dr-melhor" },
        el("div", {}, el("span", { class: "alta" }, "▲ "), el("b", {}, melhor.rotulo), " ", el("span", { class: `mono ${cor(melhor.r_total)}` }, fmtR(melhor.r_total))),
        pior ? el("div", {}, el("span", { class: "baixa" }, "▼ "), el("b", {}, pior.rotulo), " ", el("span", { class: `mono ${cor(pior.r_total)}` }, fmtR(pior.r_total))) : null)
        : el("div", { class: "kpi-valor" }, "—"),
      el("div", { class: "kpi-extra dr-kpi-ajuda" }, melhor ? `por R total ${rotulo}` : "aparece com os primeiros trades")));
}

// ------------------------------------------------------------- calendário

const corCelula = (r, max) => {
  if (!r) return "";
  const a = 0.14 + 0.36 * Math.min(1, Math.abs(r) / max);  // até 0,5: o texto claro mantém contraste AA
  return r > 0 ? `rgba(34,176,125,${a.toFixed(3)})` : `rgba(229,72,77,${a.toFixed(3)})`;
};

function semanasDoMes(ym) {
  const [ano, mes] = ym.split("-").map(Number);
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const desloc = (primeiro.getUTCDay() + 6) % 7;  // segunda = 0
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const semanas = [];
  for (let s = 0; s < Math.ceil((desloc + dias) / 7); s++) {
    semanas.push(Array.from({ length: 7 }, (_, i) => {
      const n = s * 7 + i - desloc + 1;
      return n >= 1 && n <= dias ? `${ym}-${String(n).padStart(2, "0")}` : null;
    }));
  }
  return semanas;
}

const rDoDia = (d) => somaR(IDX.saida.get(d) ?? []);

function renderCalendario() {
  const ym = estado.mes;
  $("dr-cal-titulo").textContent = mesDe(ym).replace(/^./, (c) => c.toUpperCase());
  const semanas = semanasDoMes(ym);
  const diasMes = semanas.flat().filter(Boolean);
  const max = Math.max(1, ...diasMes.map((d) => Math.abs(rDoDia(d))));
  const doMes = diasMes.flatMap((d) => IDX.saida.get(d) ?? []);
  $("dr-mes-total").replaceChildren(
    "Total do mês: ", el("b", { class: `mono ${doMes.length ? cor(somaR(doMes)) : ""}` }, doMes.length ? fmtR(somaR(doMes)) : "—"),
    ` · ${plural(doMes.length, "trade encerrado", "trades encerrados")}`);
  if (!estado.foco || !estado.foco.startsWith(ym)) {
    estado.foco = estado.dia?.startsWith(ym) ? estado.dia : hoje().startsWith(ym) ? hoje() : `${ym}-01`;
  }
  const hojeIso = hoje();
  let n = 0;
  const linhas = semanas.map((sem, si) => {
    const dias = sem.filter(Boolean);
    const totalSem = dias.flatMap((d) => IDX.saida.get(d) ?? []);
    const celulas = sem.map((d, i) => {
      if (!d) return el("div", { class: "dr-cel vazia", role: "gridcell", "aria-hidden": "true" });
      const fechados = IDX.saida.get(d) ?? [];
      const abertos = (IDX.entrada.get(d) ?? []);
      const r = somaR(fechados);
      const dia = +d.slice(8);
      const rotulo = `${dia} de ${MESES[+ym.slice(5) - 1]}, ${SEMANA_LONGA[i]}: ` +
        (fechados.length ? `${fmtR(r)} em ${plural(fechados.length, "trade encerrado", "trades encerrados")}` : "sem trades encerrados") +
        (abertos.length ? `; ${plural(abertos.length, "entrada", "entradas")}` : "");
      const cl = ["dr-cel", i >= 5 ? "fds" : "", d === hojeIso ? "hoje" : "", d === estado.dia ? "sel" : "",
        fechados.length ? (r > 0 ? "ganho" : r < 0 ? "perda" : "zero") : ""].filter(Boolean).join(" ");
      return el("div", {
        class: cl, role: "gridcell", tabindex: d === estado.foco ? "0" : "-1", "data-dia": d, "data-r": fechados.length ? String(r) : null,
        "data-n": String(fechados.length), "aria-label": rotulo, "aria-selected": d === estado.dia ? "true" : "false", title: rotulo,
        style: fechados.length ? `background:${corCelula(r, max)}` : null,
        onclick: () => abrirDia(d),
      },
      el("span", { class: "dr-num" }, String(dia)),
      fechados.length ? el("span", { class: `dr-cr ${r > 0 ? "alta" : r < 0 ? "baixa" : ""}` }, rCurto(r)) : null,
      fechados.length ? el("span", { class: "dr-cq" }, plural(fechados.length, "trade", "trades")) : null,
      abertos.length ? el("i", { class: "dr-ponto", "aria-hidden": "true", title: plural(abertos.length, "entrada", "entradas") }) : null);
    });
    n++;
    return el("div", { class: "dr-linha-cal", role: "row" }, celulas,
      el("div", { class: `dr-cel semana ${totalSem.length ? (somaR(totalSem) >= 0 ? "ganho" : "perda") : ""}`, role: "gridcell",
        "data-semana": String(si + 1), "data-r": totalSem.length ? String(somaR(totalSem)) : null,
        "aria-label": `Semana ${si + 1}: ${totalSem.length ? fmtR(somaR(totalSem)) : "sem trades encerrados"}` },
      el("span", { class: "dr-num" }, `S${si + 1}`),
      el("span", { class: `dr-cr ${totalSem.length ? cor(somaR(totalSem)) : ""}` }, totalSem.length ? rCurto(somaR(totalSem)) : "—")));
  });
  $("dr-calendario").replaceChildren(
    el("div", { class: "dr-grade", role: "grid", "aria-labelledby": "dr-cal-titulo", onkeydown: tecladoCalendario },
      el("div", { class: "dr-linha-cal cab", role: "row" },
        SEMANA.map((s, i) => el("div", { class: `dr-cab-dia ${i >= 5 ? "fds" : ""}`, role: "columnheader" }, s)),
        el("div", { class: "dr-cab-dia", role: "columnheader" }, "Semana")),
      linhas));
}

function tecladoCalendario(ev) {
  const cel = ev.target.closest("[data-dia]");
  if (!cel) return;
  const d = cel.dataset.dia;
  let alvo = null;
  switch (ev.key) {
    case "ArrowLeft": alvo = somarDias(d, -1); break;
    case "ArrowRight": alvo = somarDias(d, 1); break;
    case "ArrowUp": alvo = somarDias(d, -7); break;
    case "ArrowDown": alvo = somarDias(d, 7); break;
    case "Home": alvo = somarDias(d, -((parseISO(d).getUTCDay() + 6) % 7)); break;
    case "End": alvo = somarDias(d, 6 - ((parseISO(d).getUTCDay() + 6) % 7)); break;
    case "PageUp": case "PageDown": {
      const x = parseISO(d);
      x.setUTCDate(1);
      x.setUTCMonth(x.getUTCMonth() + (ev.key === "PageUp" ? -1 : 1));
      const dias = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
      alvo = iso(x).slice(0, 8) + String(Math.min(+d.slice(8), dias)).padStart(2, "0");
      break;
    }
    case "Enter": case " ": ev.preventDefault(); abrirDia(d, { focar: true }); return;
    default: return;
  }
  ev.preventDefault();
  irParaDia(alvo);
}

function irParaDia(d) {
  estado.foco = d;
  estado.mes = d.slice(0, 7);
  renderCalendario();
  document.querySelector(`#dr-calendario [data-dia="${d}"]`)?.focus();
}

function mudarMes(n) {
  const [a, m] = estado.mes.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1 + n, 1));
  estado.mes = iso(x).slice(0, 7);
  estado.foco = null;
  renderCalendario();
}

// ------------------------------------------------------------- painel do dia

let soltarDia = null;

function fecharDia() {
  const d = estado.dia;
  estado.dia = null;
  $("dr-dia").hidden = true;
  $("dr-dia").classList.remove("folha");
  $("dr-dia").removeAttribute("aria-modal");
  $("dr-dia").removeAttribute("role");
  document.body.classList.remove("dr-travado");
  soltarDia?.();
  soltarDia = null;
  renderCalendario();
  if (d) document.querySelector(`#dr-calendario [data-dia="${d}"]`)?.focus();
}

function abrirDia(d, { focar = false } = {}) {
  estado.dia = d;
  estado.foco = d;
  estado.mes = d.slice(0, 7);
  renderCalendario();
  const painel = $("dr-dia");
  const modal = celular();
  painel.hidden = false;
  painel.classList.toggle("folha", modal);
  if (modal) {
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-modal", "true");
    document.body.classList.add("dr-travado");
    soltarDia ??= prenderFoco(painel, fecharDia);
  }
  renderDia();
  if (focar || modal) painel.querySelector("h2")?.focus();
}

function itemTrade(t, tipo) {
  const av = t.av ?? {};
  const st = ESTADO_SIM[av.estado] ?? { rot: "—", cls: "" };
  const thumb = el("div", { class: "dr-thumb", "aria-hidden": "true" }, el("span", {}, semSufixo(t.ticker).slice(0, 3)));
  if (t.fotos?.length) Diario.fotos(t.id).then((f) => {
    if (f[0]) thumb.replaceChildren(el("img", { src: f[0].url, alt: "" }));
  });
  const fotoTxt = t.fotos?.length ? ` · 📷 ${t.fotos.length}` : "";
  const texto = trecho(t.revisao || t.tese);
  const rotuloTipo = { saiu: "Encerrado neste dia", entrou: "Entrou neste dia", planejado: "Planejado neste dia" }[tipo];
  return el("button", { type: "button", class: `dr-item ${t.lado}`, "data-id": t.id, "data-tipo": tipo, onclick: () => Diario.abrir(t.id),
    "aria-label": `${semSufixo(t.ticker)}, ${t.lado === "compra" ? "compra" : "venda"}, ${st.rot}${rDe(t) != null ? `, ${fmtR(rDe(t))}` : ""}. Abrir no editor.` },
  thumb,
  el("span", { class: "dr-item-corpo" },
    el("span", { class: "dr-item-topo" }, el("b", {}, semSufixo(t.ticker)),
      el("span", { class: `dr-chip ${t.lado === "compra" ? "alta" : "baixa"}` }, t.lado === "compra" ? "▲ Compra" : "▼ Venda"),
      el("span", { class: `dr-chip estado ${st.cls}` }, st.rot)),
    el("span", { class: "dr-item-linha" }, estrategiaDe(t), t.setup && nomeSetupDe(t.setup) !== estrategiaDe(t) ? ` · ${nomeSetupDe(t.setup)}` : "", fotoTxt),
    el("span", { class: "dr-item-linha sub" }, `Criado ${dataCurta(t.criada)} · entrou ${dataCurta(av.entrou)} · saiu ${dataCurta(av.saiu)}`),
    texto ? el("span", { class: "dr-item-texto" }, `“${texto}”`) : null,
    el("span", { class: "dr-item-tipo sub" }, rotuloTipo)),
  el("span", { class: "dr-item-r" },
    el("b", { class: `mono ${av.resultado_r == null ? "" : cor(av.resultado_r)}` }, fmtR(av.resultado_r)),
    el("span", { class: "sub mono" }, av.resultado_pct != null ? fmtPct(av.resultado_pct) : "")));
}

function renderDia() {
  const d = estado.dia;
  const painel = $("dr-dia");
  if (!d) { painel.hidden = true; return; }
  const saiu = IDX.saida.get(d) ?? [];
  const idsSaiu = new Set(saiu.map((t) => t.id));
  const entrou = (IDX.entrada.get(d) ?? []).filter((t) => !idsSaiu.has(t.id));
  const plan = (IDX.criada.get(d) ?? []).filter((t) => !idsSaiu.has(t.id));
  const dt = parseISO(d);
  const idxSem = (dt.getUTCDay() + 6) % 7;
  const grupo = (titulo, lista, tipo) => lista.length ? el("section", { class: "dr-grupo" }, el("h3", {}, titulo), el("div", { class: "dr-itens" }, lista.map((t) => itemTrade(t, tipo)))) : null;
  painel.replaceChildren(...limpo([
    el("div", { class: "dr-dia-cab" },
      el("div", {}, el("h2", { tabindex: "-1", id: "dr-dia-titulo" }, `${SEMANA_LONGA[idxSem]}, ${dataBR(d)}`),
        el("p", { class: "sub" }, saiu.length ? "" : "Nenhum trade encerrado neste dia.",
          saiu.length ? [el("b", { class: `mono ${cor(somaR(saiu))}` }, fmtR(somaR(saiu))), ` em ${plural(saiu.length, "trade encerrado", "trades encerrados")}`] : null)),
      el("button", { class: "fechar", "aria-label": "Fechar o painel do dia", onclick: fecharDia }, "×")),
    grupo("Encerrados neste dia", saiu, "saiu"),
    grupo("Entradas neste dia", entrou, "entrou"),
    grupo("Planejados, aguardando entrada", plan, "planejado"),
    !saiu.length && !entrou.length && !plan.length
      ? el("p", { class: "vazio" }, "Nada aconteceu neste dia. Trades encerrados, entradas e ordens aguardando aparecem aqui.") : null]));
  painel.setAttribute("aria-labelledby", "dr-dia-titulo");
}

// ------------------------------------------------------------- lista de trades

function desdePeriodo(p) {
  const h = hoje();
  return { "": null, "7": somarDias(h, -7), "30": somarDias(h, -30), "90": somarDias(h, -90), mes: `${h.slice(0, 7)}-01`, ano: `${h.slice(0, 4)}-01-01` }[p] ?? null;
}

function filtrados() {
  const f = estado.f;
  const desde = desdePeriodo(f.periodo);
  const busca = f.busca.trim().toUpperCase();
  const lista = TA.filter((t) => {
    const e = t.av?.estado;
    if (f.estado === "arquivados") { if (!t.arquivado) return false; }
    else if (t.arquivado) return false;
    if (f.estado === "abertos" && e !== "aberta") return false;
    if (f.estado === "aguardando" && e !== "aguardando") return false;
    if (f.estado === "fechados" && !t.av?.fechado) return false;
    if (f.estrategia && estrategiaDe(t) !== f.estrategia) return false;
    if (f.setup && (t.setup ?? "") !== (f.setup === "-" ? "" : f.setup)) return false;
    if (f.mercado && t.mercado !== f.mercado) return false;
    if (f.lado && t.lado !== f.lado) return false;
    if (desde && refData(t) < desde) return false;
    if (busca && !(semSufixo(t.ticker).toUpperCase().includes(busca) || t.ticker.toUpperCase().includes(busca))) return false;
    return true;
  });
  const cmpData = (x, y) => refData(y).localeCompare(refData(x)) || y.id.localeCompare(x.id);
  const ord = {
    recentes: cmpData, antigos: (x, y) => cmpData(y, x),
    maiorR: (x, y) => (rDe(y) ?? -Infinity) - (rDe(x) ?? -Infinity), menorR: (x, y) => (rDe(x) ?? Infinity) - (rDe(y) ?? Infinity),
    ticker: (x, y) => semSufixo(x.ticker).localeCompare(semSufixo(y.ticker)) || cmpData(x, y),
  }[f.ordem];
  return lista.sort(ord);
}

function renderFiltros() {
  const f = estado.f;
  const estrategias = [...new Set(TA.map(estrategiaDe))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const setups = [...new Set(TA.map((t) => t.setup).filter(Boolean))].sort((a, b) => nomeSetupDe(a).localeCompare(nomeSetupDe(b), "pt-BR"));
  const sel = (id, rot, chave, ops) => el("label", { class: "dr-filtro", for: id }, rot,
    el("select", { id, onchange: (e) => { f[chave] = e.target.value; estado.limite = 40; renderLista(); } },
      ops.map(([v, r]) => el("option", { value: v, selected: f[chave] === v }, r))));
  $("dr-filtros").replaceChildren(
    el("label", { class: "dr-filtro busca", for: "dr-f-busca" }, "Ticker",
      el("input", { id: "dr-f-busca", type: "search", placeholder: "PETR4, NVDA...", autocomplete: "off", spellcheck: "false", value: f.busca,
        oninput: (e) => { f.busca = e.target.value; estado.limite = 40; renderLista(); } })),
    sel("dr-f-estado", "Situação", "estado", [["", "Todos (sem arquivados)"], ["abertos", "Em aberto"], ["aguardando", "Aguardando entrada"], ["fechados", "Encerrados"], ["arquivados", "Arquivados"]]),
    sel("dr-f-estrategia", "Estratégia", "estrategia", [["", "Todas"], ...estrategias.map((e) => [e, e])]),
    sel("dr-f-setup", "Setup", "setup", [["", "Todos"], ["-", "Sem setup"], ...setups.map((s) => [s, nomeSetupDe(s)])]),
    sel("dr-f-mercado", "Mercado", "mercado", [["", "Todos"], ["BR", "Brasil"], ["US", "EUA"], ["CRIPTO", "Cripto"], ["MACRO", "Macro"]]),
    sel("dr-f-lado", "Lado", "lado", [["", "Ambos"], ["compra", "Compra"], ["venda", "Venda"]]),
    sel("dr-f-periodo", "Período", "periodo", [["", "Qualquer data"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["mes", "Este mês"], ["90", "Últimos 90 dias"], ["ano", "Este ano"]]),
    sel("dr-f-ordem", "Ordenar", "ordem", [["recentes", "Mais recentes"], ["antigos", "Mais antigos"], ["maiorR", "Maior R"], ["menorR", "Menor R"], ["ticker", "Ticker A–Z"]]));
}

function vazioInicial() {
  return el("div", { class: "dr-vazio-inicial" },
    el("h3", {}, "Seu diário ainda está vazio"),
    el("p", {}, "Cada trade que você simula vira uma linha aqui, e o resultado em R de cada dia aparece no calendário."),
    el("ol", {},
      el("li", {}, "Abra ", el("a", { href: "setups.html" }, "Setups"), " e escolha um ativo com sinal."),
      el("li", {}, "Clique em ", el("b", {}, "Simular trade"), ": entrada, stop e alvo já vêm sugeridos, e o gráfico é fotografado."),
      el("li", {}, "O terminal acompanha: quando bater no alvo ou no stop, o R do trade cai no dia certo do calendário.")),
    el("a", { class: "botao primario", href: "setups.html" }, "Encontre uma oportunidade e clique em Simular trade →"));
}

function renderLista() {
  const lista = filtrados();
  const total = TA.length;
  $("dr-trades-sub").textContent = total ? `${plural(lista.length, "trade", "trades")}${lista.length !== total ? ` de ${total}` : ""}. Clique para editar.` : "";
  if (!total) { $("dr-lista").replaceChildren(vazioInicial()); return; }
  if (!lista.length) {
    $("dr-lista").replaceChildren(el("p", { class: "vazio" }, "Nenhum trade com esses filtros."));
    return;
  }
  const mostrados = lista.slice(0, estado.limite);
  const colunas = ["Ativo", "Estratégia", "Lado", "Criada", "Entrou", "Saiu", "R", "%", "Situação"];
  $("dr-lista").replaceChildren(...limpo([
    el("div", { class: "tabela-wrap" }, el("table", { class: "dr-tabela" },
      el("thead", {}, el("tr", {}, colunas.map((h, i) => el("th", { class: i === 6 || i === 7 ? "num" : "" }, h)))),
      el("tbody", {}, mostrados.map((t) => {
        const av = t.av ?? {};
        const st = ESTADO_SIM[av.estado] ?? { rot: "—", cls: "" };
        return el("tr", { "data-id": t.id, class: t.arquivado ? "arquivado" : "", onclick: (e) => { if (!e.target.closest("button")) Diario.abrir(t.id); } },
          el("td", { "data-rot": "Ativo", class: "ticker-cel" },
            el("button", { type: "button", class: "dr-link", onclick: () => Diario.abrir(t.id), "aria-label": `Editar o trade de ${semSufixo(t.ticker)}` }, el("b", {}, semSufixo(t.ticker))),
            t.fotos?.length ? el("span", { class: "sub", title: plural(t.fotos.length, "foto", "fotos") }, ` 📷${t.fotos.length}`) : null,
            t.arquivado ? el("span", { class: "dr-chip aviso" }, "arquivado") : null),
          el("td", { "data-rot": "Estratégia" }, estrategiaDe(t), t.setup && nomeSetupDe(t.setup) !== estrategiaDe(t) ? el("span", { class: "sub dr-bloco" }, nomeSetupDe(t.setup)) : null),
          el("td", { "data-rot": "Lado", class: t.lado === "compra" ? "alta" : "baixa" }, t.lado === "compra" ? "▲ Compra" : "▼ Venda"),
          el("td", { "data-rot": "Criada" }, dataCurta(t.criada)),
          el("td", { "data-rot": "Entrou" }, dataCurta(av.entrou)),
          el("td", { "data-rot": "Saiu" }, dataCurta(av.saiu)),
          el("td", { "data-rot": "R", class: `num ${av.resultado_r == null ? "" : cor(av.resultado_r)}` }, av.resultado_r == null ? "—" : el("b", {}, fmtR(av.resultado_r))),
          el("td", { "data-rot": "%", class: `num ${cor(av.resultado_pct)}` }, av.resultado_pct != null ? fmtPct(av.resultado_pct) : "—"),
          el("td", { "data-rot": "Situação", class: st.cls }, st.rot));
      })))),
    lista.length > mostrados.length
      ? el("button", { class: "botao dr-mais", onclick: () => { estado.limite += 40; renderLista(); } }, `Mostrar mais (${lista.length - mostrados.length})`) : null]));
}

// ------------------------------------------------------------- estatísticas

const COLUNAS_STATS = [
  ["Trades", "Quantos trades encerrados entram na conta."],
  ["% acerto", "Parte dos trades que terminou no lucro. Sozinho engana: veja junto o R médio."],
  ["R total", "Soma do resultado de todos os trades, em R (múltiplos do risco)."],
  ["R médio", "Expectativa: quanto, em média, cada trade rende em R. Positivo = a estratégia ganha com o tempo."],
  ["Fator de lucro", "Soma dos ganhos dividida pela soma das perdas. Acima de 1 lucra; 2 ou mais é muito bom."],
  ["Maior seq. de perdas", "Mais perdas seguidas. Mostra o que você precisa aguentar sem desistir."],
  ["Drawdown máx.", "Maior queda, em R, do pico da curva até o fundo seguinte. É o pior momento da estratégia."],
  ["Duração média", "Quantos dias, em média, entre a entrada e a saída."],
];
const fmtFator = (v) => (v == null ? "—" : v === Infinity ? "∞" : fmtNum(v, 2));
const CORES_SERIE = ["#4c8dff", "#e3a23b", "#c77dff", "#2ec4b6", "#ff8fab"];

function renderStats() {
  const corpo = $("dr-stats-corpo");
  const est = Diario.estatisticas(TA, { por: estado.por });
  if (!est.total.trades) {
    corpo.replaceChildren(el("p", { class: "vazio" }, TA.length
      ? "Ainda não há trades encerrados. Quando um trade bater no alvo ou no stop (ou você encerrá-lo), as estatísticas aparecem aqui."
      : "As estatísticas aparecem com os primeiros trades encerrados."));
    return;
  }
  const chaves = new Set(est.grupos.map((g) => g.chave));
  for (const k of [...estado.sel]) if (!chaves.has(k)) estado.sel.delete(k);
  const linha = (g, total = false) => {
    const sel = !total && estado.sel.has(g.chave);
    return el("tr", { class: `${total ? "dr-total" : "dr-sel-linha"} ${sel ? "sel" : ""}`, "data-chave": total ? null : g.chave },
      el("th", { scope: "row", class: "dr-rot-estr" }, total
        ? "Total"
        : el("button", { type: "button", class: "dr-link", "aria-pressed": String(sel), title: "Mostrar a curva desta linha",
          onclick: () => { if (estado.sel.has(g.chave)) estado.sel.delete(g.chave); else if (estado.sel.size < 4) estado.sel.add(g.chave); renderStats(); } },
        sel ? el("i", { class: "dr-amostra", style: `background:${CORES_SERIE[[...estado.sel].indexOf(g.chave)]}` }) : null, g.rotulo)),
      el("td", { class: "num", "data-rot": "Trades" }, String(g.trades)),
      el("td", { class: "num", "data-rot": "% acerto" }, `${fmtNum(g.pct_acerto, 0)}%`),
      el("td", { class: `num ${cor(g.r_total)}`, "data-rot": "R total" }, el("b", {}, fmtR(g.r_total))),
      el("td", { class: `num ${cor(g.r_medio)}`, "data-rot": "R médio" }, fmtR(g.r_medio)),
      el("td", { class: "num", "data-rot": "Fator de lucro" }, fmtFator(g.fator_lucro)),
      el("td", { class: "num", "data-rot": "Maior seq. de perdas" }, String(g.maior_seq_perdas)),
      el("td", { class: "num baixa", "data-rot": "Drawdown máx." }, g.drawdown_r ? `−${fmtNum(g.drawdown_r, 2)}R` : "0,00R"),
      el("td", { class: "num", "data-rot": "Duração média" }, g.duracao_media != null ? `${fmtNum(g.duracao_media, 1)} d` : "—"));
  };
  const grafCurva = el("div", { class: "dr-curva", id: "dr-curva" });
  const grafHist = el("div", { class: "dr-hist", id: "dr-hist" });
  const grafSem = el("div", { class: "dr-hist", id: "dr-semana" });
  corpo.replaceChildren(
    el("div", { class: "tabela-wrap" }, el("table", { class: "dr-tabela dr-tabela-stats", id: "dr-tabela-stats" },
      el("thead", {}, el("tr", {}, el("th", {}, estado.por === "setup" ? "Setup" : "Estratégia"),
        COLUNAS_STATS.map(([r, ajuda], i) => el("th", { class: "num", title: ajuda }, r)))),
      el("tbody", {}, est.grupos.map((g) => linha(g)), linha({ ...est.total, rotulo: "Total" }, true)))),
    el("details", { class: "dr-explica" }, el("summary", {}, "O que significa cada coluna?"),
      el("dl", { class: "dr-glossario" }, COLUNAS_STATS.flatMap(([r, a]) => [el("dt", {}, r), el("dd", {}, a)]))),
    el("div", { class: "dr-graficos" },
      el("div", {}, el("h3", {}, "Curva de R acumulado"), el("p", { class: "sub" }, "Quanto você somou em R ao longo do tempo. Escolha linhas na tabela para comparar (até 4)."), grafCurva),
      el("div", {}, el("h3", {}, "Distribuição do R por trade"), el("p", { class: "sub" }, "Quantos trades terminaram em cada faixa de R. Quanto mais à direita do zero, melhor."), grafHist),
      el("div", {}, el("h3", {}, "R por dia da semana"), el("p", { class: "sub" }, "Soma do R dos trades encerrados em cada dia da semana."), grafSem)));
  desenharGraficos(est);
}

// ---- gráficos SVG simples

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...filhos) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const f of filhos.flat()) if (f != null) n.append(f instanceof Node ? f : document.createTextNode(f));
  return n;
};
const eixoTicks = (min, max, n = 4) => {
  const passo = [0.5, 1, 2, 5, 10, 20, 50, 100].find((p) => (max - min) / p <= n) ?? 100;
  const ticks = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + 1e-9; v += passo) ticks.push(+v.toFixed(6));
  return ticks;
};

function desenharGraficos(est) {
  const larg = (id) => Math.max(260, $(id)?.clientWidth || 600);
  curva(est, larg("dr-curva"));
  histograma(est, larg("dr-hist"));
  semana(est, larg("dr-semana"));
}

function curva(est, larg) {
  const alvo = $("dr-curva");
  if (!alvo) return;
  const H = 240, m = { e: 44, d: 12, t: 12, b: 28 };
  const series = [{ rot: "Todos os trades", cor: css("--texto-fraco") || "#8590a0", pts: est.curva, geral: true }];
  [...estado.sel].forEach((k, i) => {
    const g = est.grupos.find((x) => x.chave === k);
    if (g) series.push({ rot: g.rotulo, cor: CORES_SERIE[i], pts: g.curva });
  });
  const todos = est.curva;
  const t0 = Date.parse(`${todos[0].data}T00:00:00Z`), t1 = Date.parse(`${todos.at(-1).data}T00:00:00Z`);
  const vals = series.flatMap((s) => s.pts.map((p) => p.acumulado)).concat(0);
  let ymin = Math.min(...vals), ymax = Math.max(...vals);
  if (ymax - ymin < 1) { ymax += 0.5; ymin -= 0.5; }
  const pad = (ymax - ymin) * 0.08;
  ymin -= pad; ymax += pad;
  const X = (d) => m.e + (t1 === t0 ? 0.5 : (Date.parse(`${d}T00:00:00Z`) - t0) / (t1 - t0)) * (larg - m.e - m.d);
  const Y = (v) => m.t + (1 - (v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const caminho = (pts, geral) => {
    const primeiro = pts[0];
    const ds = [`M${X(primeiro.data).toFixed(1)},${Y(0).toFixed(1)}`];
    for (const p of pts) ds.push(`L${X(p.data).toFixed(1)},${Y(p.acumulado).toFixed(1)}`);
    return ds.join(" ");
  };
  const fim = est.curva.at(-1).acumulado;
  const s = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img",
    "aria-label": `Curva de R acumulado: ${est.curva.length} trades, de ${dataBR(todos[0].data)} a ${dataBR(todos.at(-1).data)}, terminando em ${fmtR(fim)}.` },
  eixoTicks(ymin, ymax).map((v) => svg("g", {},
    svg("line", { x1: m.e, x2: larg - m.d, y1: Y(v), y2: Y(v), class: v === 0 ? "dr-zero" : "dr-grade-h" }),
    svg("text", { x: m.e - 6, y: Y(v) + 4, "text-anchor": "end", class: "dr-eixo" }, `${v > 0 ? "+" : ""}${fmtNum(v, v % 1 ? 1 : 0)}R`))),
  [[todos[0].data, "start"], [todos.at(-1).data, "end"]].map(([d, a]) =>
    svg("text", { x: a === "start" ? m.e : larg - m.d, y: H - 8, "text-anchor": a, class: "dr-eixo" }, dataBR(d).slice(0, 5) + (a === "end" ? `/${d.slice(2, 4)}` : `/${d.slice(2, 4)}`))),
  series.map((sr) => svg("path", { d: caminho(sr.pts, sr.geral), fill: "none", stroke: sr.cor, "stroke-width": sr.geral ? 2.5 : 2,
    "stroke-linejoin": "round", "stroke-dasharray": sr.geral && series.length > 1 ? "5 3" : null })),
  series.map((sr) => { const u = sr.pts.at(-1); return svg("circle", { cx: X(u.data), cy: Y(u.acumulado), r: 3.5, fill: sr.cor }); }));
  const legenda = el("ul", { class: "dr-legenda-serie" }, series.map((sr) => el("li", {},
    el("i", { class: "dr-amostra", style: `background:${sr.cor}` }), `${sr.rot}: `, el("b", { class: `mono ${cor(sr.pts.at(-1).acumulado)}` }, fmtR(sr.pts.at(-1).acumulado)))));
  alvo.replaceChildren(s, legenda);
}

function histograma(est, larg) {
  const alvo = $("dr-hist");
  if (!alvo) return;
  const rs = est.curva.map((p) => p.r);
  const LO = -3, HI = 5, passo = 0.5;
  const nb = Math.round((HI - LO) / passo);
  const bins = Array.from({ length: nb }, () => 0);
  for (const r of rs) bins[Math.min(nb - 1, Math.max(0, Math.floor((r - LO) / passo)))]++;
  const H = 180, m = { e: 28, d: 8, t: 16, b: 28 };
  const maxN = Math.max(...bins, 1);
  const w = (larg - m.e - m.d) / nb;
  const Y = (n) => m.t + (1 - n / maxN) * (H - m.t - m.b);
  const s = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img",
    "aria-label": `Distribuição do R: ${rs.length} trades, ${rs.filter((r) => r > 0).length} no lucro e ${rs.filter((r) => r < 0).length} no prejuízo.` },
  bins.map((n, i) => {
    const de = LO + i * passo, ate = de + passo;
    const cls = ate <= 0 ? "dr-barra perda" : de >= 0 ? "dr-barra ganho" : "dr-barra zero";
    return svg("g", {},
      svg("rect", { x: m.e + i * w + 1, y: Y(n), width: Math.max(1, w - 2), height: H - m.b - Y(n), class: cls, rx: 2 },
        svg("title", {}, `${fmtNum(de, 1)}R a ${fmtNum(ate, 1)}R: ${plural(n, "trade", "trades")}`)),
      n ? svg("text", { x: m.e + i * w + w / 2, y: Y(n) - 3, "text-anchor": "middle", class: "dr-eixo" }, String(n)) : null);
  }),
  svg("line", { x1: m.e + (-LO / passo) * w, x2: m.e + (-LO / passo) * w, y1: m.t, y2: H - m.b, class: "dr-zero" }),
  [-3, -2, -1, 0, 1, 2, 3, 4, 5].map((v) => svg("text", { x: m.e + ((v - LO) / passo) * w, y: H - 10, "text-anchor": "middle", class: "dr-eixo" },
    v === LO ? "≤−3R" : v === HI ? "≥5R" : `${v > 0 ? "+" : ""}${v}R`)));
  alvo.replaceChildren(s);
}

function semana(est, larg) {
  const alvo = $("dr-semana");
  if (!alvo) return;
  const soma = Array(7).fill(0), qtd = Array(7).fill(0);
  for (const p of est.curva) {
    const i = (parseISO(p.data).getUTCDay() + 6) % 7;
    soma[i] += p.r;
    qtd[i]++;
  }
  const H = 180, m = { e: 8, d: 8, t: 20, b: 28 };
  const maxAbs = Math.max(1, ...soma.map(Math.abs));
  const w = (larg - m.e - m.d) / 7;
  const meio = m.t + (H - m.t - m.b) / 2, esc = (H - m.t - m.b) / 2 / maxAbs;
  const s = svg("svg", { width: larg, height: H, viewBox: `0 0 ${larg} ${H}`, role: "img",
    "aria-label": `R por dia da semana: ${soma.map((v, i) => `${SEMANA[i]} ${fmtR(v)}`).join(", ")}.` },
  svg("line", { x1: m.e, x2: larg - m.d, y1: meio, y2: meio, class: "dr-zero" }),
  soma.map((v, i) => {
    const h = Math.abs(v) * esc;
    return svg("g", {},
      qtd[i] ? svg("rect", { x: m.e + i * w + 6, y: v >= 0 ? meio - h : meio, width: Math.max(1, w - 12), height: Math.max(1, h), rx: 2,
        class: `dr-barra ${v >= 0 ? "ganho" : "perda"}` }, svg("title", {}, `${SEMANA_LONGA[i]}: ${fmtR(v)} em ${plural(qtd[i], "trade", "trades")}`)) : null,
      qtd[i] ? svg("text", { x: m.e + i * w + w / 2, y: v >= 0 ? meio - h - 4 : meio + h + 12, "text-anchor": "middle", class: "dr-eixo" }, rCurto(v)) : null,
      svg("text", { x: m.e + i * w + w / 2, y: H - 10, "text-anchor": "middle", class: "dr-eixo" }, SEMANA[i]));
  }));
  alvo.replaceChildren(s);
}

// ------------------------------------------------------------- exportar e importar

function baixarArquivo(conteudo, nome, tipo) {
  const a = el("a", { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const numBR = (v, casas = 2) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(casas).replace(".", ","));

/** Uma linha por trade. Datas dd/mm/aaaa, decimais com vírgula, separador ";" e BOM: o Excel em português abre direto. */
function linhasCSV() {
  return [...TA].sort((a, b) => refData(a).localeCompare(refData(b)) || a.id.localeCompare(b.id)).map((t) => {
    const av = t.av ?? {};
    return {
      "ID": t.id, "Ativo": semSufixo(t.ticker), "Mercado": t.mercado, "Lado": t.lado === "compra" ? "Compra" : "Venda",
      "Estratégia": estrategiaDe(t), "Setup": nomeSetupDe(t.setup), "Tempo": t.tf === "W" ? "Semanal" : t.tf === "D" ? "Diário" : "",
      "Origem": t.origem ?? "", "Criada": dataBR(t.criada), "Entrou": dataBR(av.entrou), "Saiu": dataBR(av.saiu),
      "Situação": ESTADO_SIM[av.estado]?.rot ?? "", "Entrada": numBR(t.entrada, 4), "Stop": numBR(t.stop, 4), "Alvo": numBR(t.alvo, 4),
      "Capital": numBR(t.capital, 2), "R": numBR(av.resultado_r, 2), "Resultado %": numBR(av.resultado_pct, 2),
      "Dias": av.dias ?? "", "Nota": t.nota ?? "", "Etiquetas": (t.etiquetas ?? []).join(" | "),
      "Tese": limpar(t.tese), "Revisão": limpar(t.revisao), "Arquivado": t.arquivado ? "Sim" : "Não", "Fotos": (t.fotos ?? []).length,
    };
  });
}

function exportarCSV() {
  const linhas = linhasCSV();
  if (!linhas.length) { avisoRapido("Nenhum trade para baixar ainda."); return; }
  const cols = Object.keys(linhas[0]);
  const cel = (v) => { const t = String(v ?? ""); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [cols.join(";"), ...linhas.map((l) => cols.map((c) => cel(l[c])).join(";"))].join("\r\n");
  baixarArquivo(csv, `diario-${hoje()}.csv`, "text/csv;charset=utf-8");
  avisoRapido(`${plural(linhas.length, "trade baixado", "trades baixados")} (planilha).`);
}

const paraDataUrl = (blob) => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => err(r.error); r.readAsDataURL(blob); });

async function exportarJSON() {
  const trades = Diario.trades();
  const comFotos = $("dr-fotos-json").checked;
  const fotos = [];
  if (comFotos) {
    for (const t of trades) for (const id of t.fotos ?? []) {
      const rec = await Diario._foto.ler(id);
      if (rec?.blob) fotos.push({ id: rec.id, trade: rec.trade, tipo: rec.tipo, criada: rec.criada, dataUrl: await paraDataUrl(rec.blob) });
    }
  }
  const dados = { formato: "diario-trading", versao: 1, exportado_em: new Date().toISOString(), trades, fotos };
  baixarArquivo(JSON.stringify(dados), `diario-backup-${hoje()}.json`, "application/json");
  avisoRapido(`Backup: ${plural(trades.length, "trade", "trades")}${comFotos ? ` e ${plural(fotos.length, "foto", "fotos")}` : " (sem fotos)"}.`);
}

async function importarJSON(arquivo) {
  try {
    const dados = JSON.parse(await arquivo.text());
    const novos = Array.isArray(dados) ? dados : dados?.trades;
    if (!Array.isArray(novos)) throw new Error("formato inválido");
    const atuais = new Map(Simulacoes.todas().map((p) => [p.id, p]));
    let nt = 0;
    for (const p of novos) if (p?.id && p.ticker && p.entrada) { atuais.set(String(p.id), { ...p, id: String(p.id) }); nt++; }
    Simulacoes.gravar([...atuais.values()]);
    let nf = 0;
    for (const f of dados.fotos ?? []) {
      if (!f?.id || !f.dataUrl) continue;
      const blob = await (await fetch(f.dataUrl)).blob();
      await Diario._foto.gravar({ id: f.id, trade: f.trade, tipo: f.tipo ?? "outra", blob, criada: f.criada ?? new Date().toISOString() });
      nf++;
    }
    document.dispatchEvent(new CustomEvent("simulacoes"));
    document.dispatchEvent(new CustomEvent("diario"));
    avisoRapido(`Importado: ${plural(nt, "trade", "trades")} e ${plural(nf, "foto", "fotos")}.`);
  } catch (e) {
    avisoRapido(`Não consegui importar: ${e.message}`);
  }
}

// ------------------------------------------------------------- ciclo

function renderTudo() {
  IDX = indexar();
  const naGrade = document.activeElement?.closest?.("#dr-calendario") ? document.activeElement.dataset?.dia : null;
  renderResumo();
  renderCalendario();
  if (naGrade) document.querySelector(`#dr-calendario [data-dia="${naGrade}"]`)?.focus();
  if (estado.dia) renderDia();
  renderFiltros();
  renderLista();
  renderStats();
}

let pendente = 0;
function recarregar() {
  clearTimeout(pendente);
  pendente = setTimeout(async () => {
    TA = await Diario.avaliarTodos();
    renderTudo();
  }, 40);
}

function ligar() {
  $("dr-mes-ant").addEventListener("click", () => mudarMes(-1));
  $("dr-mes-prox").addEventListener("click", () => mudarMes(1));
  $("dr-hoje").addEventListener("click", () => { estado.mes = hoje().slice(0, 7); estado.foco = hoje(); renderCalendario(); abrirDia(hoje()); });
  const segmentoEl = (id, aoMudar) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    $(id).querySelectorAll("button").forEach((x) => { x.classList.toggle("ativo", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    aoMudar(b.dataset.v);
  });
  segmentoEl("dr-periodo", (v) => { estado.periodo = v; renderResumo(); });
  segmentoEl("dr-por", (v) => { estado.por = v; estado.sel.clear(); renderStats(); });
  $("dr-csv").addEventListener("click", exportarCSV);
  $("dr-json").addEventListener("click", exportarJSON);
  $("dr-importar").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await importarJSON(f); });
  document.addEventListener("diario", recarregar);
  document.addEventListener("simulacoes", recarregar);
  window.addEventListener("storage", (e) => { if (e.key === Simulacoes.chave) recarregar(); });
  let larguraAnt = 0, rz = 0;
  new ResizeObserver(() => {
    const l = $("dr-curva")?.clientWidth;
    if (!l || Math.abs(l - larguraAnt) < 4) return;
    larguraAnt = l;
    clearTimeout(rz);
    rz = setTimeout(() => { if ($("dr-curva")) desenharGraficos(Diario.estatisticas(TA, { por: estado.por })); }, 100);
  }).observe($("dr-stats"));
}

async function iniciar() {
  try { R = await carregarRadar(); } catch (e) { montarTopo("diario"); return erroDados(e); }
  montarTopo("diario", R);
  await carregarCatalogoSetups().catch(() => null);
  ligar();
  TA = await Diario.avaliarTodos();
  renderTudo();
  const h = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(h)) abrirDia(h);
}

iniciar();
