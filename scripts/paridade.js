// Avalia o catálogo de setups com as CONDICOES do site (assets/js/rastreador.js) sobre as fotos de
// data/rastreador.json e imprime {ticker: {tf: [setups que disparam no último candle]}}.
// Usado por scripts/testar_paridade.py. Uso: node scripts/paridade.js <rastreador.json> <setups.json>
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "rastreador.js"), "utf8");
const fmtNum = (v, casas = 1) => (v == null ? "—" : Number(v).toFixed(casas));
const fmtPct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const buscarJSON = () => Promise.reject(new Error("sem rede"));
const { quandoAtende } = new Function("fmtPct", "fmtNum", "buscarJSON", "document", "window",
  `${src}; return { CONDICOES, quandoAtende }`)(fmtPct, fmtNum, buscarJSON, {}, {});

const [arqFotos, arqSetups] = process.argv.slice(2);
const dados = JSON.parse(fs.readFileSync(arqFotos, "utf8"));
const catalogo = JSON.parse(fs.readFileSync(arqSetups, "utf8"));
const F = { janelas: dados.janelas, periodos_ifr: dados.periodos_ifr, periodos_mm: dados.periodos_mm };
const setups = catalogo.grupos.flatMap((g) => g.itens);

const saida = {};
for (const [tk, fotos] of Object.entries(dados.ativos)) {
  saida[tk] = {};
  for (const [tf, foto] of Object.entries(fotos ?? {})) {
    if (!foto) continue;
    saida[tk][tf] = setups.filter((s) => quandoAtende(foto, s.regras, tf, F, 1) === 0).map((s) => s.id);
  }
}
process.stdout.write(JSON.stringify(saida));
