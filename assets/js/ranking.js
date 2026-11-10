/* Top do dia: os sinais de hoje com melhor histórico. Dados de data/ranking.json (scripts/ranking.py).
 * Ranking estatístico do histórico de cada ativo, não recomendação. Resultado passado não garante futuro. */

const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto" };
let D, radar = null, mercado = "";

/** Dados do cartão de uma linha do Top do dia (o arquivo dos candles vem do radar, se ele carregou). */
function dadosLinha(x, lado) {
  const a = radar?.ativos.find((y) => y.ticker === x.ticker);
  return { ticker: x.ticker, rotulo: x.rotulo, nome: x.nome, mercado: x.mercado, lado, setupNome: x.setup_nome, data: x.data,
    casos: x.casos, ganhos: x.ganhos, acerto: x.acerto, medio: x.medio, moeda: a?.moeda, arquivo: a?.arquivo ?? x.ticker, tf: "D" };
}

function linha(x, i, lado) {
  const ganhos = x.ganhos ?? Math.round(x.acerto / 100 * x.casos);
  return el("li", { class: "rk-linha" },
    el("span", { class: "rk-pos" }, String(i + 1)),
    el("div", { class: "rk-corpo" },
      el("div", { class: "rk-topo" },
        el("a", { class: "rk-ativo", href: `ativo.html#${encodeURIComponent(x.ticker)}`, title: x.nome }, x.rotulo),
        el("span", { class: "pilula rk-mercado" }, NOMES_MERCADO[x.mercado] ?? x.mercado),
        el("span", { class: `rk-medio mono ${cor(x.medio)}` }, fmtPct(x.medio)),
        window.Compartilhar ? Compartilhar.botao(() => dadosLinha(x, lado), { classe: "rk-compartilhar", titulo: `Compartilhar o sinal de ${x.rotulo}: gera uma imagem com o histórico` }) : null),
      el("div", { class: "rk-setup" }, x.setup_nome,
        x.outros ? el("span", { class: "sub" }, ` · +${x.outros} ${x.outros === 1 ? "outro setup" : "outros setups"} hoje`) : null),
      el("div", { class: "rk-det sub" }, `${ganhos} de ${x.casos} vezes no lucro (${fmtNum(x.acerto, 0)}%) · média por sinal`),
      el("div", { class: "rk-nota", title: "Limite inferior do intervalo de confiança de 95% da taxa de acerto" },
        el("span", { class: "rk-barra", role: "img", "aria-label": `Nota ${fmtNum(x.nota, 1)} de 100` },
          el("i", { style: `width:${Math.max(2, Math.min(100, x.nota))}%` })),
        el("span", { class: "mono rk-nota-num" }, fmtNum(x.nota, 0)))));
}

function desenhar() {
  document.querySelectorAll("#rk-mercado button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === mercado));
  for (const lado of ["compra", "venda"]) {
    const itens = mercado ? D[lado].mercado[mercado] ?? [] : D[lado].geral;
    document.getElementById(`rk-${lado}`).replaceChildren(...(itens.length
      ? itens.map((x, i) => linha(x, i, lado))
      : [el("li", { class: "sub rk-vazio" }, `Nenhum sinal de ${lado} hoje passa nos critérios${mercado ? ` em ${NOMES_MERCADO[mercado]}` : ""}.`)]));
  }
}

async function iniciar() {
  aguardarPagina();
  let R = null;
  try { R = radar = await carregarRadar(); } catch { /* o topo funciona sem o radar */ }
  try { D = await buscarJSON("data/ranking.json"); }
  catch (e) {
    montarTopo("ranking", R);
    console.error(e);
    document.querySelector("main").append(el("div", { class: "painel vazio" }, "O Top do dia ainda não foi gerado. Ele é montado a cada atualização dos dados (scripts/ranking.py)."));
    return paginaPronta();
  }
  montarTopo("ranking", R);
  document.getElementById("rk-min").textContent = String(D.min_casos);
  document.getElementById("rk-sub").textContent = D.data
    ? `Sinais do último pregão fechado (${fmtData(D.data)}), top ${D.top} de cada lado.`
    : "Hoje nenhum sinal passou nos critérios.";
  segmento("rk-mercado", ({ v }) => { mercado = v; desenhar(); });
  desenhar();
  paginaPronta();
}

iniciar();
