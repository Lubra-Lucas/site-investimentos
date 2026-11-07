/* Histórico dos sinais: os sinais dos últimos ~60 pregões e como cada um terminou.
 * Os dados vêm de data/resultados.json (scripts/resultados.py). Resultado passado não garante futuro. */

const PASSO = 40;
const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto" };
const filtro = { mercado: "", lado: "", situacao: "", res: "" };
let D, ativos, setups, linhas, visiveis = PASSO, filtradas = [];

const dataDe = (dia) => {
  const d = new Date(Date.UTC(...D.base.split("-").map((x, i) => (i === 1 ? +x - 1 : +x))) + dia * 864e5);
  return d.toISOString().slice(0, 10);
};
const kpi = (rot, valor, cls, nota) => el("div", { class: "res-kpi" },
  el("span", { class: "sub" }, rot), el("b", { class: `res-kpi-valor ${cls ?? ""}` }, valor), nota ? el("span", { class: "sub" }, nota) : null);

function estat(rets) {
  const n = rets.length;
  if (!n) return { n: 0 };
  return { n, acerto: rets.filter((r) => r > 0).length / n * 100, medio: rets.reduce((a, b) => a + b, 0) / n };
}

function renderKpis(base) {
  const enc = base.filter((l) => !l.aberto && l.ret != null).map((l) => l.ret);
  const ab = base.filter((l) => l.aberto).length;
  const e = estat(enc);
  const alvo = document.getElementById("res-kpis");
  if (!e.n) { alvo.replaceChildren(el("p", { class: "sub" }, "Nenhum sinal encerrado neste filtro.")); return; }
  const perdas = enc.filter((r) => r <= 0).length;
  alvo.replaceChildren(
    kpi("Sinais encerrados", fmtNum(e.n, 0), "", `${fmtNum(ab, 0)} em aberto`),
    kpi("Terminaram no lucro", `${fmtNum(e.acerto, 0)}%`, "", `${fmtNum(perdas, 0)} sem lucro (${fmtNum(100 - e.acerto, 0)}%)`),
    kpi("Retorno médio", fmtPct(e.medio), cor(e.medio), "por sinal, em 10 pregões"),
    kpi("Pior e melhor", `${fmtPct(Math.min(...enc))} / ${fmtPct(Math.max(...enc))}`, "", "extremos do período"));
}

function renderRanking(m) {
  const r = D.ranking[m];
  document.querySelectorAll("#r-mercado button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === m));
  const sub = document.getElementById("res-rank-sub");
  const alvo = document.getElementById("res-rank");
  if (!r || !r.itens.length) {
    sub.textContent = `${NOMES_MERCADO[m]}: sem setups com pelo menos ${D.min_ranking} sinais encerrados nos últimos ${D.dias_ranking} dias.`;
    alvo.replaceChildren(el("p", { class: "sub" }, m === "CRIPTO"
      ? "Cripto ainda não tem ativos líquidos o bastante no backtest para formar um ranking."
      : "Ainda não há casos suficientes."));
    return;
  }
  sub.textContent = `Sinais que terminaram entre ${fmtData(r.desde)} e ${fmtData(r.ate)} (${D.dias_ranking} dias), em setups com pelo menos ${D.min_ranking} casos. Fatia curta: pode mudar de um mês para o outro.`;
  const nome = (id) => setups.get(id)?.nome ?? id;
  const lado = (id) => (setups.get(id)?.lado === "venda" ? "▼" : "▲");
  const linha = (x, i) => el("li", { class: "res-rank-item" },
    el("span", { class: "res-pos" }, String(i)),
    el("span", { class: "res-rank-nome" }, el("b", {}, nome(x.setup)), el("span", { class: "sub" }, ` ${lado(x.setup)} ${setups.get(x.setup)?.lado ?? ""}`)),
    el("span", { class: `res-rank-med mono ${cor(x.medio)}` }, fmtPct(x.medio)),
    el("span", { class: "res-rank-det sub" }, `${fmtNum(x.acerto, 0)}% no lucro · ${x.n} casos · pior ${fmtPct(x.pior)}`));
  const todos = r.itens;
  const melhores = todos.slice(0, 5), piores = todos.length > 8 ? todos.slice(-3) : [];
  const bloco = (titulo, itens, ini) => el("div", {}, el("h3", { class: "res-sub-tit" }, titulo), el("ol", { class: "res-rank-lista", start: ini }, itens.map((x, i) => linha(x, ini + i))));
  alvo.replaceChildren(bloco("Os que mais funcionaram", melhores, 1),
    piores.length ? bloco("Os que menos funcionaram (para comparar)", piores, todos.length - piores.length + 1) : "");
}

function aplicar() {
  filtradas = linhas.filter((l) =>
    (!filtro.mercado || l.mercado === filtro.mercado)
    && (!filtro.lado || l.lado === filtro.lado)
    && (!filtro.situacao || (filtro.situacao === "aberto") === l.aberto)
    && (!filtro.res || (l.ret != null && (filtro.res === "ganho" ? l.ret > 0 : l.ret <= 0))));
  visiveis = PASSO;
  renderKpis(filtradas);
  const nome = filtro.mercado ? NOMES_MERCADO[filtro.mercado] : "todos os mercados";
  document.getElementById("res-resumo-sub").textContent =
    `Filtro atual (${nome}${filtro.lado ? `, ${filtro.lado}` : ""}): só os sinais encerrados entram na taxa de acerto e na média.`;
  renderLista();
}

function celulaRes(l) {
  if (l.ret == null) return el("span", { class: "res-ret sub" }, "entra no próximo pregão");
  return el("span", { class: `res-ret mono ${cor(l.ret)}` }, fmtPct(l.ret));
}

function renderLista() {
  const alvo = document.getElementById("res-lista");
  document.getElementById("res-lista-sub").textContent =
    `${fmtNum(filtradas.length, 0)} sinais nos últimos ${D.pregoes} pregões, do mais recente para o mais antigo. Em aberto: retorno até o último fechamento, ainda pode mudar.`;
  if (!filtradas.length) { alvo.replaceChildren(el("p", { class: "sub" }, "Nenhum sinal com esses filtros.")); }
  else {
    alvo.replaceChildren(...filtradas.slice(0, visiveis).map((l) => el("div", { class: `res-linha ${l.aberto ? "aberto" : ""}`, role: "listitem" },
      el("span", { class: "res-data mono" }, fmtData(l.data)),
      el("a", { class: "res-ativo", href: `ativo.html#${encodeURIComponent(l.ticker)}` }, l.rotulo),
      el("span", { class: "res-setup" }, el("span", { class: l.lado === "venda" ? "baixa" : "alta" }, l.lado === "venda" ? "▼ " : "▲ "), l.setup),
      el("span", { class: "res-sit" }, celulaRes(l), el("span", { class: "pilula res-selo" }, l.aberto ? "em aberto" : "encerrado")))));
  }
  const mais = document.getElementById("res-mais");
  mais.hidden = filtradas.length <= visiveis;
  mais.textContent = `Mostrar mais (${fmtNum(filtradas.length - visiveis, 0)} restantes)`;
}

async function iniciar() {
  aguardarPagina();
  let R = null;
  try { R = await carregarRadar(); } catch { /* o topo funciona sem o radar */ }
  try { D = await buscarJSON("data/resultados.json"); }
  catch (e) {
    montarTopo("resultados", R);
    console.error(e);
    document.querySelector("main").append(el("div", { class: "painel vazio" }, "O histórico dos sinais ainda não foi gerado. Ele é montado a cada atualização dos dados (scripts/resultados.py)."));
    return paginaPronta();
  }
  montarTopo("resultados", R);
  ativos = D.ativos.map(([ticker, rotulo, mercado]) => ({ ticker, rotulo, mercado }));
  setups = new Map(D.setups.map(([id, nome, lado]) => [id, { nome, lado }]));
  linhas = D.linhas.map(([dia, a, s, ret, aberto]) => {
    const at = ativos[a], st = D.setups[s];
    return { data: dataDe(dia), ticker: at.ticker, rotulo: at.rotulo, mercado: at.mercado, setup: st[1], lado: st[2], ret, aberto: !!aberto };
  });
  for (const [id, chave] of [["f-mercado", "mercado"], ["f-lado", "lado"], ["f-situacao", "situacao"], ["f-res", "res"]]) {
    segmento(id, ({ v }) => { filtro[chave] = v; aplicar(); }).marcar("v", "");
  }
  segmento("r-mercado", ({ v }) => renderRanking(v));
  document.getElementById("res-mais").addEventListener("click", () => { visiveis += PASSO * 2; renderLista(); });
  renderRanking("BR");
  aplicar();
  paginaPronta();
}

iniciar();
