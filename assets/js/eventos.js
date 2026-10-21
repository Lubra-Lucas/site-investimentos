/* Eventos dos setups (data/radar.json -> sinais: {ticker, setup, tf: "D"|"W", data, lado, preco, bt})
 * com os nomes do catálogo (data/setups.json). Usado pela Carteira e pela página do Ativo. */

const SETUP_POR_ID = new Map();
const carregarCatalogoSetups = () => buscarJSON("data/setups.json").then((c) => {
  if (!SETUP_POR_ID.size) for (const g of c.grupos ?? []) for (const s of g.itens ?? []) SETUP_POR_ID.set(s.id, { ...s, grupo: g.nome });
  return c;
});

const nomeSetup = (id) => SETUP_POR_ID.get(id)?.nome ?? id;
const NOME_TF_EVENTO = { D: "Diário", W: "Semanal" };
const setaLado = (lado) => (lado === "compra" ? "▲ " : lado === "venda" ? "▼ " : "◆ ");
const classeLado = (lado) => (lado === "compra" ? "alta" : lado === "venda" ? "baixa" : "fraco");

/** Eventos de um ativo, do mais recente para o mais antigo. */
const eventosDoAtivo = (R, tk) => R.sinais.filter((e) => e.ticker === tk)
  .sort((x, y) => y.data.localeCompare(x.data) || x.tf.localeCompare(y.tf) || x.lado.localeCompare(y.lado));

/**
 * Junta os eventos repetidos do mesmo setup no mesmo tempo gráfico (setups de estado, como "Tendência
 * de alta", disparam em todo candle): [{setup, tf, lado, eventos (mais recentes primeiro), ultima}].
 */
function agruparPorSetup(eventos) {
  const grupos = new Map();
  for (const e of eventos) {
    const k = `${e.tf}|${e.setup}|${e.lado}`;
    if (!grupos.has(k)) grupos.set(k, { setup: e.setup, tf: e.tf, lado: e.lado, eventos: [] });
    grupos.get(k).eventos.push(e);
  }
  const lista = [...grupos.values()];
  for (const g of lista) { g.eventos.sort((x, y) => y.data.localeCompare(x.data)); g.ultima = g.eventos[0].data; }
  return lista.sort((x, y) => y.ultima.localeCompare(x.ultima) || x.tf.localeCompare(y.tf) ||
    y.eventos.length - x.eventos.length || nomeSetup(x.setup).localeCompare(nomeSetup(y.setup)));
}

/** O evento no formato que o gráfico (setas e balão) e o contexto leem: semanal = "S", nome do setup em `familia`. */
const eventoParaGrafico = (e) => ({ ...e, tf: e.tf === "W" ? "S" : "D", familia: nomeSetup(e.setup), texto: SETUP_POR_ID.get(e.setup)?.desc ?? "" });

/** Selo do histórico do setup neste ativo ([casos, acerto, médio, vantagem]). */
const seloEvento = (e) => seloHistorico(e.bt, e.tf === "W" ? "S" : "D");

/**
 * Eventos recentes de cada ativo: os do último pregão (ou semana) com evento no mercado do ativo e
 * nos `n` anteriores. Devolve Map ticker -> eventos (mais recentes primeiro).
 */
function eventosRecentes(R, tf = "D", n = 5) {
  const mercado = new Map(R.ativos.map((a) => [a.ticker, a.mercado]));
  const datas = new Map();
  for (const e of R.sinais) {
    if (e.tf !== tf) continue;
    const m = mercado.get(e.ticker);
    if (!datas.has(m)) datas.set(m, new Set());
    datas.get(m).add(e.data);
  }
  const desde = new Map([...datas].map(([m, d]) => [m, [...d].sort().reverse()[Math.min(n, d.size) - 1]]));
  const porTicker = new Map();
  for (const e of R.sinais) {
    if (e.tf !== tf || e.data < desde.get(mercado.get(e.ticker))) continue;
    if (!porTicker.has(e.ticker)) porTicker.set(e.ticker, []);
    porTicker.get(e.ticker).push(e);
  }
  for (const l of porTicker.values()) l.sort((x, y) => y.data.localeCompare(x.data) || x.lado.localeCompare(y.lado));
  return porTicker;
}

/** Lista "Minha lista" (a mesma da antiga Multitela: chave "multitela", campo `tickers`, texto separado por vírgulas). */
const MinhaLista = {
  chave: "multitela",
  padrao: "PETR4, GOOGL, VALE3, NVDA",
  ler() {
    const txt = guardar.ler(this.chave, {}).tickers ?? this.padrao;
    return [...new Set(String(txt).split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  },
  gravar(rotulos) {
    const atual = guardar.ler(this.chave, {});
    guardar.gravar(this.chave, { ...(atual && typeof atual === "object" ? atual : {}), tickers: rotulos.join(", ") });
  },
};
