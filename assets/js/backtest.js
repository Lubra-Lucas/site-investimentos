/* Backtest: ranking das estratégias por mercado, sinal, lado e prazo, e os ativos onde cada uma
 * funcionou melhor. Os números vêm de data/backtest.json (scripts/backtest.py). */

const estado = { mercado: "BR", tf: "D", lado: "compra", h: null, escolhida: null, ...guardar.ler("backtest", {}) };
let B, R, porTicker;

const NOME_FAMILIA = (f, lado) => (f === "quedas" ? (lado === "venda" ? "Maiores altas" : "Maiores quedas") : R.familias[f]?.nome ?? f);
const nomeVariante = (x, lado) => (x.familia === "pullback" ? x.variante : NOME_FAMILIA(x.familia, lado));
const rotPrazo = (tf, h) => (tf === "D" ? `${h} pregões` : `${h} semanas`);
const salvar = () => guardar.gravar("backtest", { mercado: estado.mercado, tf: estado.tf, lado: estado.lado, h: estado.h });

function barra(valor, max, cls) {
  const larg = Math.min(100, Math.abs(valor ?? 0) / max * 100);
  return el("span", { class: `barra ${cls}` }, el("i", { style: `width:${larg}%` }));
}

function renderPrazos() {
  const hs = B.horizontes[estado.tf];
  if (!hs.includes(estado.h)) estado.h = B.principal[estado.tf];
  const seg = document.getElementById("f-prazo");
  seg.replaceChildren(...hs.map((h) => el("button", { "data-v": h, class: h === estado.h ? "ativo" : null,
    onclick: () => { estado.h = h; salvar(); renderPrazos(); render(); } }, rotPrazo(estado.tf, h))));
}

function render() {
  const linhas = B.mercados[estado.mercado]?.[estado.tf]?.[estado.lado] ?? [];
  const H = String(estado.h);
  const base = B.base[estado.mercado]?.[estado.tf]?.[H];
  const baseLado = base == null ? null : estado.lado === "compra" ? base : -base;
  document.getElementById("base").textContent = base == null ? "" :
    `Referência: ${estado.lado === "compra" ? "comprar" : "vender"} num dia qualquer e sair ${rotPrazo(estado.tf, estado.h)} depois ` +
    `rendeu ${fmtPct(baseLado)} em média neste mercado.`;
  document.getElementById("f-descricao").textContent =
    `${linhas.length} estratégias · ordenadas pela vantagem sobre um dia qualquer · menos de ${B.min_casos} casos vão para o fim`;

  const validas = linhas.map((x) => x.h[H]).filter((e) => e?.n);
  const maxRet = Math.max(1, ...validas.map((e) => Math.abs(e.medio)));
  const maxVant = Math.max(1, ...validas.map((e) => Math.abs(e.vantagem ?? 0)));
  const ordenadas = [...linhas].sort((a, b) => {
    const ea = a.h[H] ?? {}, eb = b.h[H] ?? {};
    return ((ea.n ?? 0) < B.min_casos) - ((eb.n ?? 0) < B.min_casos) || (eb.vantagem ?? -1e9) - (ea.vantagem ?? -1e9);
  });
  const tabela = document.getElementById("tabela-estrategias");
  tabela.replaceChildren(
    el("thead", {}, el("tr", {}, ["Estratégia", "Casos", "Acerto", "Retorno médio", "Vantagem", "Mediana", "Pior / melhor"].map((h, i) =>
      el("th", { class: i ? "num" : "" }, h)))),
    el("tbody", {}, ordenadas.map((x) => {
      const e = x.h[H] ?? { n: 0 };
      const poucos = e.n < B.min_casos;
      const modal = R.familias[x.familia]?.modalidade === "contra" ? "Contra a tendência" : "A favor da tendência";
      return el("tr", { class: `${poucos ? "poucos" : ""} ${estado.escolhida === x.familia ? "selecionado" : ""}`,
        onclick: () => { estado.escolhida = x.familia; render(); renderAtivos(); } },
        el("td", {}, el("span", { class: `chip fam-${x.familia}` }, nomeFamilia(x.familia, estado.lado)), " ",
          el("b", {}, nomeVariante(x, estado.lado)), el("div", { class: "sub" }, modal)),
        el("td", { class: "num" }, String(e.n)),
        el("td", { class: "num" }, poucos ? "—" : el("span", { class: "valor-barra" },
          barra(e.acerto - 50, 50, e.acerto >= 50 ? "pos" : "neg"), `${fmtNum(e.acerto, 0)}%`)),
        el("td", { class: `num ${cor(e.medio)}` }, poucos ? "—" : el("span", { class: "valor-barra" },
          barra(e.medio, maxRet, e.medio >= 0 ? "pos" : "neg"), fmtPct(e.medio))),
        el("td", { class: `num ${cor(e.vantagem)}` }, poucos ? "—" : el("span", { class: "valor-barra" },
          barra(e.vantagem, maxVant, e.vantagem >= 0 ? "pos" : "neg"), fmtPct(e.vantagem))),
        el("td", { class: `num ${cor(e.mediana)}` }, poucos ? "—" : fmtPct(e.mediana)),
        el("td", { class: "num" }, poucos ? `poucos casos` : el("span", {},
          el("span", { class: "baixa" }, fmtPct(e.pior)), " / ", el("span", { class: "alta" }, fmtPct(e.melhor)))));
    })));
}

/** Onde a estratégia escolhida funcionou melhor (e pior), ativo por ativo, no prazo principal. */
function renderAtivos() {
  const alvo = document.getElementById("ativos");
  const f = estado.escolhida;
  if (!f) return;
  const prazo = rotPrazo(estado.tf, B.principal[estado.tf]);
  document.getElementById("ativos-titulo").textContent = `${NOME_FAMILIA(f, estado.lado)} · por ativo`;
  document.getElementById("ativos-sub").textContent =
    `${estado.lado === "compra" ? "Compra" : "Venda"} no sinal ${estado.tf === "D" ? "diário" : "semanal"}, saída em ${prazo}. ` +
    `Só ativos com ${B.min_casos} ou mais casos.`;
  const lista = Object.entries(B.ativos)
    .filter(([tk]) => porTicker.get(tk)?.mercado === estado.mercado)
    .map(([tk, a]) => ({ tk, e: a[estado.tf]?.[f]?.[estado.lado] }))
    .filter((x) => x.e && x.e.n >= B.min_casos)
    .sort((a, b) => (b.e.vantagem ?? -1e9) - (a.e.vantagem ?? -1e9));
  if (!lista.length) { alvo.replaceChildren(el("p", { class: "vazio" }, "Nenhum ativo com casos suficientes.")); return; }
  const linha = ({ tk, e }) => el("li", { class: "bt-ativo" },
    el("a", { href: `radar.html#${encodeURIComponent(tk)}`, title: "Abrir no Radar" },
      el("b", { class: "mono" }, semSufixo(tk)), " ", el("span", { class: "cartao-nome" }, porTicker.get(tk)?.nome ?? "")),
    el("span", { class: "bt-numeros" },
      el("span", {}, `${e.n} casos`),
      el("span", {}, `${fmtNum(e.acerto, 0)}%`),
      el("b", { class: cor(e.medio) }, fmtPct(e.medio)),
      el("span", { class: cor(e.vantagem), title: "Vantagem sobre um dia qualquer neste ativo" }, `vant. ${fmtPct(e.vantagem)}`)));
  alvo.replaceChildren(
    el("p", { class: "rotulo-lista" }, "Onde mais funcionou"),
    el("ol", { class: "bt-lista" }, lista.slice(0, 15).map(linha)),
    lista.length > 15 ? el("p", { class: "rotulo-lista" }, "Onde menos funcionou") : null,
    lista.length > 15 ? el("ol", { class: "bt-lista" }, lista.slice(-5).reverse().map(linha)) : null);
}

async function iniciar() {
  try { [B, R] = await Promise.all([carregarBacktest(), carregarRadar()]); }
  catch (e) { montarTopo("backtest"); return erroDados(e); }
  porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
  montarTopo("backtest", R);
  for (const [id, chave] of [["f-mercado", "mercado"], ["f-tf", "tf"], ["f-lado", "lado"]]) {
    segmento(id, ({ v }) => { estado[chave] = v; salvar(); renderPrazos(); render(); renderAtivos(); }).marcar("v", estado[chave]);
  }
  renderPrazos();
  render();
  // abre com a melhor estratégia já detalhada
  const primeira = (B.mercados[estado.mercado]?.[estado.tf]?.[estado.lado] ?? [])[0];
  if (primeira) { estado.escolhida = primeira.familia; render(); renderAtivos(); }
}

iniciar();
