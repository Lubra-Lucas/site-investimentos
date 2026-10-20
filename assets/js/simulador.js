/* Simulador de posição: entrada, stop e alvo arrastáveis no gráfico, como a ferramenta de
 * risco/retorno do TradingView. As simulações ficam salvas no navegador e são reavaliadas
 * com os candles diários de cada nova atualização (deu alvo? deu stop? ainda aberta?). */

const Simulacoes = {
  chave: "simulacoes-v1",
  todas() { return guardar.ler(this.chave, []); },
  gravar(lista) { guardar.gravar(this.chave, lista); },
  salvar(pos) { this.gravar([...this.todas().filter((p) => p.id !== pos.id), pos]); },
  remover(id) { this.gravar(this.todas().filter((p) => p.id !== id)); },
  doAtivo(tk) { return this.todas().filter((p) => p.ticker === tk); },
};

const ESTADO_SIM = {
  aguardando: { rot: "Aguardando entrada", cls: "aviso" },
  aberta: { rot: "Em aberto", cls: "" },
  alvo: { rot: "Alvo atingido", cls: "alta" },
  stop: { rot: "Stop atingido", cls: "baixa" },
};

/**
 * Reavalia a simulação com os candles diários posteriores à criação.
 * Entrada a mercado (até 0,2% do preço na criação) vale no próprio dia; senão é uma ordem
 * que espera o preço chegar. Se stop e alvo cabem no mesmo candle, conta o stop (conservador).
 */
function avaliarSimulacao(pos, diarios) {
  const compra = pos.lado === "compra";
  const sinal = compra ? 1 : -1;
  const ref = pos.preco_criacao ?? pos.entrada;
  let entrou = Math.abs(pos.entrada / ref - 1) <= 0.002 ? pos.criada : null;
  for (const c of diarios) {
    if (c.time <= pos.criada) continue;
    if (!entrou) {
      const abaixo = pos.entrada < ref;
      if (!(abaixo ? c.low <= pos.entrada : c.high >= pos.entrada)) continue;
      entrou = c.time;
    }
    const stop = compra ? c.low <= pos.stop : c.high >= pos.stop;
    const alvo = compra ? c.high >= pos.alvo : c.low <= pos.alvo;
    if (stop || alvo) {
      const saida = stop ? pos.stop : pos.alvo;
      return { estado: stop ? "stop" : "alvo", entrou, saiu: c.time, resultado_pct: sinal * (saida / pos.entrada - 1) * 100 };
    }
  }
  if (!entrou) return { estado: "aguardando" };
  const atual = diarios[diarios.length - 1].close;
  return { estado: "aberta", entrou, atual, resultado_pct: sinal * (atual / pos.entrada - 1) * 100 };
}

function contasSimulacao(p) {
  const fracionado = p.mercado === "CRIPTO";
  const qtd = fracionado ? +(p.capital / p.entrada).toFixed(6) : Math.floor(p.capital / p.entrada);
  const compra = p.lado === "compra";
  const risco = Math.abs(p.entrada - p.stop) * qtd;
  const retorno = Math.abs(p.alvo - p.entrada) * qtd;
  const valido = compra ? p.stop < p.entrada && p.alvo > p.entrada : p.stop > p.entrada && p.alvo < p.entrada;
  return {
    qtd, risco, retorno, valido,
    risco_pct: Math.abs(p.stop / p.entrada - 1) * 100,
    retorno_pct: Math.abs(p.alvo / p.entrada - 1) * 100,
    rr: risco ? retorno / risco : null,
  };
}

const tempoNum = (t) => (typeof t === "number" ? t : Date.parse(`${t}T00:00:00Z`) / 1000);

class Simulador {
  constructor(grafico, corpo, boleta, botao) {
    this.g = grafico;
    this.corpo = corpo;
    this.boleta = boleta;
    this.ativo = null;
    this.rascunho = null;
    this.editando = null;   // id da simulação aberta na boleta
    this.linhas = [];
    this.camada = el("div", { class: "sim-camada" });
    corpo.append(this.camada);
    botao.addEventListener("click", () => this.novo());
    grafico.aoMostrar = () => this.desenhar();
    document.addEventListener("preferencias", () => this.desenhar());
    this.ligarArraste();
    const loop = () => { this.posicionarZonas(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  visiveis() {
    if (!this.ativo) return [];
    const salvas = Simulacoes.doAtivo(this.ativo.ticker);
    return this.rascunho ? [...salvas, this.rascunho] : salvas;
  }

  emEdicao() {
    if (this.rascunho) return this.rascunho;
    return this.visiveis().find((p) => p.id === this.editando) ?? null;
  }

  async definirAtivo(a) {
    this.ativo = a;
    this.rascunho = null;
    const salvas = Simulacoes.doAtivo(a.ticker);
    this.editando = salvas.length ? salvas[salvas.length - 1].id : null;
    this.diarios = null;
    const diarios = (await carregarCandles(a.arquivo)).candles;
    if (this.ativo !== a) return;  // trocou de ativo enquanto carregava
    this.diarios = diarios;
    this.desenhar();
    this.renderBoleta();
  }

  novo(lado = "compra") {
    const a = this.ativo;
    if (!a) return;
    const entrada = a.ultimo;
    const s = lado === "compra" ? 1 : -1;
    this.rascunho = {
      id: `${Date.now()}`, ticker: a.ticker, mercado: a.mercado, moeda: a.moeda, lado,
      entrada, stop: entrada * (1 - s * 0.05), alvo: entrada * (1 + s * 0.10),
      capital: a.mercado === "BR" ? 1000 : 200, criada: a.data, preco_criacao: entrada,
    };
    this.desenhar();
    this.renderBoleta();
  }

  /** Grava a alteração: rascunho só ao clicar em Salvar; simulação salva, na hora. */
  alterado(p) {
    if (p !== this.rascunho) Simulacoes.salvar(p);
    this.desenhar();
    this.renderBoleta(false);
  }

  // ---------------------------------------------------------- desenho

  desenhar() {
    // espaço vazio à direita do último candle para a caixa de risco/retorno aparecer
    this.g.chart.timeScale().applyOptions({ rightOffset: this.visiveis().length ? 14 : 3 });
    for (const l of this.linhas) this.g.candles.removePriceLine(l.linha);
    this.linhas = [];
    const casas = casasPreco(this.ativo?.ultimo ?? 1);
    for (const p of this.visiveis()) {
      const ativa = p === this.emEdicao();
      const c = contasSimulacao(p);
      const opac = ativa ? 1 : 0.45;
      const nivel = (campo, cor, titulo) => {
        const linha = this.g.candles.createPriceLine({
          price: p[campo], color: cor, lineWidth: ativa ? 2 : 1, lineStyle: LWC.LineStyle.Solid,
          axisLabelVisible: ativa, title: ativa ? titulo : "",
        });
        this.linhas.push({ linha, pos: p, campo });
      };
      nivel("alvo", `rgba(38,194,129,${opac})`, `Alvo ${fmtPct((p.lado === "compra" ? 1 : -1) * c.retorno_pct)}`);
      const corEntrada = Preferencias.derivadas().claro ? `rgba(55,65,81,${opac})` : `rgba(215,221,230,${opac})`;
      nivel("entrada", corEntrada, `${p.lado === "compra" ? "Compra" : "Venda"} ${fmtNum(p.entrada, casas)}`);
      nivel("stop", `rgba(240,80,110,${opac})`, `Stop ${fmtPct((p.lado === "compra" ? -1 : 1) * c.risco_pct)}`);
    }
    this.zonas = this.visiveis().map((p) => ({
      p, ganho: el("div", { class: "sim-zona ganho" }), perda: el("div", { class: "sim-zona perda" }),
      // a zona termina no dia em que a simulação bateu alvo ou stop
      av: this.diarios && p !== this.rascunho ? avaliarSimulacao(p, this.diarios) : null,
    }));
    this.camada.replaceChildren(...this.zonas.flatMap((z) => [z.ganho, z.perda]));
  }

  indiceAte(data) {
    const c = this.g.c ?? [];
    const limite = tempoNum(data) + 86399;
    let i = c.length - 1;
    while (i > 0 && tempoNum(c[i].time) > limite) i--;
    return i;
  }

  posicionarZonas() {
    if (!this.zonas?.length || !this.g.c) return;
    const ts = this.g.chart.timeScale();
    const largura = ts.width();
    for (const z of this.zonas) {
      const { p, av } = z;
      // como no TradingView, a caixa começa alguns candles antes para ficar visível mesmo se criada hoje
      const x0 = ts.logicalToCoordinate(this.indiceAte(p.criada) - 6);
      const x1 = av?.saiu ? ts.logicalToCoordinate(this.indiceAte(av.saiu)) : largura;
      const y = (v) => this.g.candles.priceToCoordinate(v);
      const [ye, ys, ya] = [y(p.entrada), y(p.stop), y(p.alvo)];
      const ok = [x0, x1, ye, ys, ya].every((v) => v != null);
      for (const [div, y1, y2] of [[z.ganho, ye, ya], [z.perda, ye, ys]]) {
        if (!ok) { div.style.display = "none"; continue; }
        const esq = Math.max(0, Math.min(x0, largura)), dir = Math.max(esq, Math.min(x1, largura));
        Object.assign(div.style, {
          display: "block", left: `${esq}px`, width: `${dir - esq}px`,
          top: `${Math.min(y1, y2)}px`, height: `${Math.abs(y2 - y1)}px`,
          opacity: p === this.emEdicao() ? 1 : 0.5,
        });
      }
    }
  }

  // ---------------------------------------------------------- arraste

  ligarArraste() {
    let arrastando = null;
    const yRel = (e) => e.clientY - this.corpo.getBoundingClientRect().top;
    const xRel = (e) => e.clientX - this.corpo.getBoundingClientRect().left;
    const acertar = (e) => {
      if (xRel(e) > this.g.chart.timeScale().width()) return null;  // em cima da escala de preço
      const y = yRel(e);
      let melhor = null;
      for (const l of this.linhas) {
        const c = this.g.candles.priceToCoordinate(l.pos[l.campo]);
        if (c != null && Math.abs(c - y) <= 6 && (!melhor || Math.abs(c - y) < melhor.d)) melhor = { ...l, d: Math.abs(c - y) };
      }
      return melhor;
    };
    const bloquear = (sim) => this.g.chart.applyOptions({ handleScroll: !sim, handleScale: !sim });

    this.corpo.addEventListener("pointerdown", (e) => {
      const alvo = acertar(e);
      if (!alvo) return;
      e.preventDefault();
      e.stopPropagation();
      arrastando = alvo;
      if (alvo.pos !== this.rascunho) this.editando = alvo.pos.id;
      bloquear(true);
      this.corpo.setPointerCapture(e.pointerId);
    }, true);
    this.corpo.addEventListener("pointermove", (e) => {
      if (!arrastando) {
        this.corpo.style.cursor = acertar(e) ? "ns-resize" : "";
        return;
      }
      const preco = this.g.candles.coordinateToPrice(yRel(e));
      if (preco == null || preco <= 0) return;
      arrastando.pos[arrastando.campo] = preco;
      for (const l of this.linhas) if (l.pos === arrastando.pos && l.campo === arrastando.campo) l.linha.applyOptions({ price: preco });
      this.renderBoleta(false);
    }, true);
    const soltar = (e) => {
      if (!arrastando) return;
      const p = arrastando.pos;
      arrastando = null;
      bloquear(false);
      this.corpo.releasePointerCapture?.(e.pointerId);
      this.alterado(p);
    };
    this.corpo.addEventListener("pointerup", soltar, true);
    this.corpo.addEventListener("pointercancel", soltar, true);
  }

  // ---------------------------------------------------------- boleta

  renderBoleta(refazerCampos = true) {
    const a = this.ativo;
    const salvas = a ? Simulacoes.doAtivo(a.ticker) : [];
    const p = this.emEdicao();
    if (!a || (!p && !salvas.length)) {
      this.boleta.hidden = true;
      return;
    }
    this.boleta.hidden = false;
    const casas = casasPreco(a.ultimo);
    const c = p ? contasSimulacao(p) : null;
    const resumo = p && el("div", { class: "boleta-resumo" },
      el("span", {}, "Qtd ", el("b", {}, fmtNum(c.qtd, a.mercado === "CRIPTO" ? 6 : 0))),
      el("span", {}, "Risco ", el("b", { class: "baixa" }, `${fmtMoeda(c.risco, a.moeda)} (${fmtNum(c.risco_pct, 1)}%)`)),
      el("span", {}, "Retorno ", el("b", { class: "alta" }, `${fmtMoeda(c.retorno, a.moeda)} (${fmtNum(c.retorno_pct, 1)}%)`)),
      el("span", {}, "R:R ", el("b", {}, c.rr ? `1 : ${fmtNum(c.rr, 2)}` : "—")),
      !c.valido ? el("span", { class: "baixa" }, p.lado === "compra"
        ? "Na compra, o stop fica abaixo da entrada e o alvo acima." : "Na venda, o stop fica acima da entrada e o alvo abaixo.") : null);

    if (!refazerCampos && this.boleta.querySelector(".boleta-resumo") && p) {
      this.boleta.querySelector(".boleta-resumo").replaceWith(resumo);
      for (const campo of ["entrada", "stop", "alvo"]) {
        const inp = this.boleta.querySelector(`input[data-c="${campo}"]`);
        if (inp && document.activeElement !== inp) inp.value = p[campo].toFixed(casas);
      }
      return;
    }

    const campo = (rot, chave, passo) => el("label", { class: "boleta-campo" }, rot,
      el("input", { type: "number", step: passo, "data-c": chave, value: (+p[chave]).toFixed(chave === "capital" ? 0 : casas),
        onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) { p[chave] = v; this.alterado(p); } } }));
    const passo = (1 / 10 ** casas).toString();
    const chipsSalvas = salvas.map((s) => {
      const av = this.diarios ? avaliarSimulacao(s, this.diarios) : null;
      const st = ESTADO_SIM[av?.estado] ?? {};
      return el("button", { class: `sim-chip ${s.id === this.editando && !this.rascunho ? "ativo" : ""}`,
        onclick: () => { this.rascunho = null; this.editando = s.id; this.desenhar(); this.renderBoleta(); } },
        `${s.lado === "compra" ? "▲" : "▼"} ${fmtData(s.criada)}`,
        el("b", { class: st.cls }, ` ${st.rot ?? ""}${av?.resultado_pct != null ? " " + fmtPct(av.resultado_pct) : ""}`));
    });

    const av = p && p !== this.rascunho && this.diarios ? avaliarSimulacao(p, this.diarios) : null;
    this.boleta.replaceChildren(...[
      el("div", { class: "boleta-topo" },
        el("b", {}, p === this.rascunho ? "Nova simulação" : "Simulação salva"),
        el("div", { class: "sim-chips" }, chipsSalvas)),
      p ? el("div", { class: "boleta-linha" },
        el("div", { class: "segmento" }, ["compra", "venda"].map((l) =>
          el("button", { class: p.lado === l ? "ativo" : null, onclick: () => {
            if (p.lado === l) return;
            // inverte stop e alvo em volta da entrada
            p.lado = l; [p.stop, p.alvo] = [2 * p.entrada - p.stop, 2 * p.entrada - p.alvo];
            this.alterado(p); this.renderBoleta();
          } }, l === "compra" ? "▲ Compra" : "▼ Venda"))),
        campo("Entrada", "entrada", passo), campo("Stop", "stop", passo), campo("Alvo", "alvo", passo),
        campo(`Capital (${a.moeda === "USD" ? "US$" : "R$"})`, "capital", "100"),
        el("div", { class: "boleta-acoes" },
          p === this.rascunho
            ? [el("button", { class: "botao primario", disabled: !c.valido, onclick: () => {
                Simulacoes.salvar(p); this.editando = p.id; this.rascunho = null;
                this.desenhar(); this.renderBoleta(); document.dispatchEvent(new CustomEvent("simulacoes"));
              } }, "Salvar"),
              el("button", { class: "botao", onclick: () => { this.rascunho = null; this.desenhar(); this.renderBoleta(); } }, "Descartar")]
            : el("button", { class: "botao perigo", onclick: () => {
                Simulacoes.remover(p.id); this.editando = null; this.desenhar(); this.renderBoleta();
                document.dispatchEvent(new CustomEvent("simulacoes"));
              } }, "Excluir"))) : null,
      resumo,
      av ? el("p", { class: "sub boleta-status" }, `Criada em ${fmtData(p.criada)} a ${fmtMoeda(p.preco_criacao, a.moeda)} · `,
        el("b", { class: ESTADO_SIM[av.estado].cls }, ESTADO_SIM[av.estado].rot),
        av.entrou ? ` · entrada em ${fmtData(av.entrou)}` : "",
        av.saiu ? ` · saída em ${fmtData(av.saiu)}` : "",
        av.resultado_pct != null ? el("b", { class: cor(av.resultado_pct) }, ` ${fmtPct(av.resultado_pct)}`) : "") : null,
      p ? el("p", { class: "sub boleta-dica" }, "Arraste as linhas de entrada, stop e alvo no gráfico.") : null,
    ].filter(Boolean));
  }
}

/** Tabela com todas as simulações salvas e o resultado de cada uma. */
async function renderListaSimulacoes(alvo, porTicker, aoAbrir) {
  const lista = Simulacoes.todas().filter((p) => porTicker.has(p.ticker))
    .sort((a, b) => b.criada.localeCompare(a.criada) || b.id.localeCompare(a.id));
  if (!lista.length) {
    alvo.replaceChildren(el("p", { class: "vazio" },
      "Nenhuma simulação ainda. Abra um ativo no gráfico e clique em ", el("b", {}, "⊕ Simular"), "."));
    return;
  }
  const linhas = await Promise.all(lista.map(async (p) => {
    const a = porTicker.get(p.ticker);
    const av = avaliarSimulacao(p, (await carregarCandles(a.arquivo)).candles);
    return { p, a, av, c: contasSimulacao(p) };
  }));
  const st = (av) => ESTADO_SIM[av.estado];
  const n = (e) => linhas.filter((l) => l.av.estado === e).length;
  alvo.replaceChildren(
    el("p", { class: "sub" }, `${lista.length} simulação(ões) · ${n("alvo")} no alvo · ${n("stop")} no stop · `,
      `${n("aberta")} em aberto · ${n("aguardando")} aguardando entrada`),
    el("div", { class: "tabela-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Ativo", "Lado", "Criada", "Entrada", "Stop", "Alvo", "R:R", "Situação", "Resultado"]
        .map((h, i) => el("th", { class: i >= 3 && i !== 7 ? "num" : "" }, h)))),
      el("tbody", {}, linhas.map(({ p, a, av, c }) => el("tr", { "data-tk": p.ticker, onclick: () => aoAbrir(p.ticker) },
        el("td", { class: "ticker-cel" }, el("b", {}, semSufixo(p.ticker)), el("span", {}, a.nome)),
        el("td", { class: p.lado === "compra" ? "alta" : "baixa" }, p.lado === "compra" ? "▲ Compra" : "▼ Venda"),
        el("td", {}, fmtData(p.criada)),
        el("td", { class: "num" }, fmtMoeda(p.entrada, a.moeda)),
        el("td", { class: "num baixa" }, fmtMoeda(p.stop, a.moeda)),
        el("td", { class: "num alta" }, fmtMoeda(p.alvo, a.moeda)),
        el("td", { class: "num" }, c.rr ? `1 : ${fmtNum(c.rr, 1)}` : "—"),
        el("td", { class: st(av).cls }, st(av).rot, av.saiu ? ` em ${fmtData(av.saiu)}` : ""),
        el("td", { class: `num ${cor(av.resultado_pct)}` }, av.resultado_pct != null ? fmtPct(av.resultado_pct) : "—")))))));
}

/** Exporta/importa as simulações (para levar a outro navegador ou guardar backup). */
function exportarSimulacoes() {
  const blob = new Blob([JSON.stringify(Simulacoes.todas(), null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `simulacoes-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importarSimulacoes(arquivo, depois) {
  arquivo.text().then((txt) => {
    const novas = JSON.parse(txt);
    if (!Array.isArray(novas)) throw new Error("formato inválido");
    const atuais = new Map(Simulacoes.todas().map((p) => [p.id, p]));
    for (const p of novas) if (p.id && p.ticker && p.entrada) atuais.set(p.id, p);
    Simulacoes.gravar([...atuais.values()]);
    depois();
  }).catch((e) => alert(`Não consegui importar: ${e.message}`));
}
