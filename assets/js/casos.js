/* Casos de um setup num ativo (Backtest e Ativo): janela com o gráfico do ativo, cada entrada (▲/▼) e saída (● verde ou
 * vermelha com o %) marcadas, e a lista caso a caso. Os casos vêm de data/casos/<arquivo>.json
 * ({ticker, principal, casos: {D|W: {setupId: [[sinal, entrada, saida_data, saida_preco, resultado_pct], ...]}}}).
 * Sem dependência das páginas: usa só os ajudantes de comum.js. */

/** O que o setup usa (médias, Bollinger, IFR/estocástico), para desenhar no histórico inteiro. Os níveis de rompimento
 *  ficam de fora: mudam a cada candle. Precisa de rastreador.js (CONDICOES, sobreposicaoDasRegras). */
async function sobreposicaoDoSetup(setupId, tf) {
  if (typeof sobreposicaoDasRegras !== "function" || typeof CONDICOES === "undefined") return null;
  const cat = await buscarJSON("data/setups.json").catch(() => null);
  const x = (cat?.grupos ?? []).flatMap((g) => g.itens).find((i) => i.id === setupId);
  if (!x) return null;
  const regras = x.regras.map((r) => (r.t === "boca" ? { t: "bollinger", pos: "fechou_acima" } : r))
    .filter((r) => CONDICOES[r.t] && r.t !== "rompimento" && r.t !== "perto_extremo");
  return regras.length ? sobreposicaoDasRegras(regras, null, tf, null) : null;
}

/**
 * Abre a janela. `ativo`: o ativo do radar ({ticker, arquivo, nome, moeda}); `resumo`: {n, acerto, medio} do backtest
 * (opcional); `principal`: quantos candles depois o trade sai; `vies`: "compra" | "venda".
 */
async function abrirCasos({ ativo, setupId, nomeSetup: nomeDoSetup, vies, tf, resumo: e, principal: P }) {
  fecharCasos();
  const a = ativo, tk = a.ticker, id = setupId;
  const rotPrazo = `${P} ${tf === "D" ? "pregões" : "semanas"}`;
  const anterior = document.activeElement;
  const corpoGraf = el("div", { class: "bt-casos-grafico", role: "img", "aria-label": `Gráfico de ${semSufixo(tk)} com os casos marcados` });
  const lista = el("div", { class: "bt-casos-lista" }, el("p", { class: "sub" }, "Carregando os casos…"));
  const caixa = el("div", { class: "bt-casos", role: "dialog", "aria-modal": "true", "aria-labelledby": "bt-casos-titulo", tabindex: "-1" },
    el("header", { class: "bt-casos-cab" },
      el("div", {},
        el("h2", { id: "bt-casos-titulo" }, el("span", { class: "mono" }, semSufixo(tk)), ` · ${nomeDoSetup}`),
        el("p", { class: "sub" }, `${a?.nome ?? ""} · sinal ${tf === "D" ? "diário" : "semanal"} · entrada na abertura do candle seguinte, ` +
          `saída no fechamento ${rotPrazo} depois` + (e ? ` · ${e.n} casos, ${fmtNum(e.acerto, 0)}% com lucro, média ${fmtPct(e.medio)}` : ""))),
      el("button", { type: "button", class: "fechar", "aria-label": "Fechar", onclick: fecharCasos }, "×")),
    corpoGraf,
    el("div", { class: "legenda-extras bt-casos-indicadores", hidden: true }),
    el("p", { class: "sub bt-casos-legenda" }, "▲/▼ entrada · ● saída (verde = lucro, vermelho = prejuízo). Clique num caso para ir até ele no gráfico."),
    lista,
    el("div", { class: "bt-casos-pe" },
      /ativo(\.html)?$/.test(location.pathname) ? null : el("a", { class: "botao", href: `ativo.html#${encodeURIComponent(tk)}` }, "Abrir o ativo"),
      el("a", { class: "botao", href: `setups.html?setup=${encodeURIComponent(id)}` }, "Ver este setup hoje")));
  const fundo = el("div", { class: "modal-fundo bt-casos-fundo", onclick: (ev) => { if (ev.target === fundo) fecharCasos(); } }, caixa);
  const tecla = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); fecharCasos(); }
    else if (ev.key === "Tab") {  // o foco fica dentro da janela
      const f = [...caixa.querySelectorAll("button, a[href], [tabindex='0']")].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); }
      else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener("keydown", tecla, true);
  casosAbertos = { fundo, tecla, anterior, g: null };
  document.body.append(fundo);
  document.body.classList.add("dr-travado");
  caixa.focus();

  let dados;
  try { dados = await buscarJSON(`data/casos/${a?.arquivo ?? tk}.json`); } catch { dados = null; }
  if (casosAbertos?.fundo !== fundo) return;
  const casos = dados?.casos?.[tf]?.[id] ?? [];
  if (!casos.length) {
    lista.replaceChildren(el("p", { class: "vazio" }, dados
      ? "Nenhum caso deste setup neste ativo." : "Os casos um a um ainda não foram publicados: aparecem depois da próxima atualização dos dados."));
  }
  const g = new Grafico(corpoGraf);
  g.sinais = [];
  casosAbertos.g = g;
  // o indicador que o setup usa (ex.: a MMS 50 do pullback na MMS 50), para ver cada caso no contexto dele
  const sob = await sobreposicaoDoSetup(id, tf);
  if (casosAbertos?.fundo !== fundo) return;
  if (sob) {
    g.definirSobreposicao(sob);
    const leg = caixa.querySelector(".bt-casos-indicadores");
    leg.replaceChildren(el("span", { class: "rotulo-mini" }, "No gráfico:"), ...legendaSobreposicao(sob).map((x) =>
      el("span", {}, el("i", { class: x.pontilhado ? "pontilhado" : null, style: `--cor:${x.cor}` }), x.txt)));
    leg.hidden = false;
  }
  const ok = a ? await g.mostrar(a.arquivo, tf).catch(() => false) : false;
  if (casosAbertos?.fundo !== fundo || !ok) return;
  // o candle de cada data: o último até ela (no semanal o Python rotula a semana pela sexta e o gráfico pela segunda)
  const ateData = (d) => { let i = g.c.length - 1; while (i > 0 && String(g.c[i].time) > d) i--; return i; };
  const compra = vies !== "venda";
  const marcas = [];
  const itens = casos.map(([sinal, entrada, saida, preco, r]) => {
    const iE = Math.min(ateData(sinal) + 1, g.c.length - 1), iS = ateData(saida);
    marcas.push({ time: g.c[iE].time, position: compra ? "belowBar" : "aboveBar", shape: compra ? "arrowUp" : "arrowDown", color: "#2962ff", size: 1 });
    marcas.push({ time: g.c[iS].time, position: compra ? "aboveBar" : "belowBar", shape: "circle", color: r >= 0 ? "#089981" : "#f23645", size: 1,
      text: `${r > 0 ? "+" : ""}${fmtNum(r, 1)}%` });
    return { sinal, entrada, saida, preco, r, tEntrada: g.c[iE].time };
  });
  marcas.sort((x, y) => String(x.time).localeCompare(String(y.time)));
  LWC.createSeriesMarkers(g.candles, marcas);
  const moeda = a.moeda;
  const ir = (it, linha) => {
    g.irPara(it.tEntrada);
    lista.querySelectorAll("tr.ativo").forEach((n) => n.classList.remove("ativo"));
    linha.classList.add("ativo");
  };
  const acertos = itens.filter((x) => x.r > 0).length;
  const tabela = el("table", { class: "bt-casos-tabela" },
    el("thead", {}, el("tr", {}, ["Sinal", "Entrada", "Saída", "Resultado"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
    el("tbody", {}, [...itens].reverse().map((it) => {
      const linha = el("tr", { tabindex: "0", title: "Ver este caso no gráfico",
        onclick: () => ir(it, linha), onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ir(it, linha); } } },
      el("td", {}, dataComAno(it.sinal)),
      el("td", { class: "num" }, fmtMoeda(it.entrada, moeda)),
      el("td", { class: "num" }, `${fmtMoeda(it.preco, moeda)} `, el("span", { class: "sub bt-casos-data" }, dataComAno(it.saida))),
      el("td", { class: `num ${cor(it.r)}` }, el("b", {}, fmtPct(it.r))));
      return linha;
    })));
  if (casos.length) lista.replaceChildren(
    el("p", { class: "bt-casos-resumo" }, `${itens.length} casos · `, el("b", { class: "alta" }, `${acertos} com lucro`), " · ",
      el("b", { class: "baixa" }, `${itens.length - acertos} com prejuízo`), " · do mais recente para o mais antigo"),
    el("div", { class: "tabela-wrap" }, tabela));
  // abre no caso mais recente
  if (itens.length) g.irPara(itens.at(-1).tEntrada);
}

let casosAbertos = null;
/** "26/08/24": os casos cobrem anos, então a data leva o ano. */
const dataComAno = (iso) => `${fmtData(iso)}/${iso.slice(2, 4)}`;
function fecharCasos() {
  if (!casosAbertos) return;
  const { fundo, tecla, anterior, g } = casosAbertos;
  casosAbertos = null;
  document.removeEventListener("keydown", tecla, true);
  g?.remover();
  fundo.remove();
  document.body.classList.remove("dr-travado");
  anterior?.focus?.();
}

