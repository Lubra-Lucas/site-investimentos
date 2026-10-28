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
  manual: { rot: "Encerrada por você", cls: "" },
  sem_dados: { rot: "Sem dados do ativo", cls: "aviso" },
};

/**
 * Reavalia a simulação com os candles diários posteriores à criação.
 * Entrada a mercado (até 0,2% do preço na criação) vale no próprio dia; senão é uma ordem
 * que espera o preço chegar. Se stop e alvo cabem no mesmo candle, conta o stop (conservador).
 */
function avaliarSimulacao(pos, diarios) {
  const av = avaliarPreco(pos, diarios);
  // em R: o resultado medido em unidades do risco (distância entre entrada e stop); stop = -1R
  const risco = Math.abs(pos.stop / pos.entrada - 1) * 100;
  if (av.resultado_pct != null && risco) av.resultado_r = av.resultado_pct / risco;
  return av;
}

const fmtR = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, 2)}R`);
/** "+2,00R (+8,40%)": o resultado em R com a variação ao lado. */
const fmtResultado = (av) => (av.resultado_pct == null ? "" : `${fmtR(av.resultado_r)} (${fmtPct(av.resultado_pct)})`);

function avaliarPreco(pos, diarios) {
  // saída manual (diário): vale antes do alvo/stop, a menos que um deles já tenha saído antes daquela data
  const m = pos.saida_manual;
  if (m?.data && m.preco > 0) {
    const sem = { ...pos, saida_manual: null };
    const antes = diarios.filter((c) => c.time < m.data);
    const ate = diarios.filter((c) => c.time <= m.data);
    if (antes.length) {
      const r = avaliarPreco(sem, antes);
      if (r.estado === "alvo" || r.estado === "stop") return r;
    }
    if (!ate.length) return { estado: "aguardando" };
    const r = avaliarPreco(sem, ate);
    if (r.estado === "aguardando") return r;
    const sinal = pos.lado === "compra" ? 1 : -1;
    return { estado: "manual", entrou: r.entrou, saiu: m.data, resultado_pct: sinal * (m.preco / pos.entrada - 1) * 100 };
  }
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

/** Capital inicial de uma simulação: R$ 1.000 / US$ 200, mas nunca menos que 1 unidade do ativo (senão a
 *  quantidade sai 0 e o risco em dinheiro some, como numa ação de US$ 347 com US$ 200). Cripto é fracionada. */
const capitalPadrao = (a, entrada) => {
  const base = a.mercado === "BR" ? 1000 : 200;
  return a.mercado === "CRIPTO" || !(entrada > 0) ? base : Math.max(base, Math.ceil(entrada * 1.0001 * 100) / 100);
};

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
  /** Sem boleta e botão, só desenha as simulações salvas (usado na multitela), sem arraste.
   *  opcoes.so: mostra só este trade (o editor do diário); opcoes.arrastar: arraste sem boleta;
   *  opcoes.aoMudar(p): chamado depois de cada alteração gravada (fim do arraste); opcoes.aoArrastar(p): durante. */
  constructor(grafico, corpo, boleta = null, botao = null, opcoes = {}) {
    this.g = grafico;
    this.so = opcoes.so ?? null;
    this.aoMudar = opcoes.aoMudar ?? null;
    this.aoArrastar = opcoes.aoArrastar ?? null;  // durante o arraste (para mostrar os números ao vivo)
    this.corpo = corpo;
    this.boleta = boleta;
    this.ativo = null;
    this.rascunho = null;
    this.editando = null;   // id da simulação aberta na boleta
    // contexto do diário (setup, tf, origem): objeto, ou função (rascunho) => objeto. A página define.
    this.contexto = null;
    this.linhas = [];
    this.camada = el("div", { class: "sim-camada" });
    corpo.append(this.camada);
    botao?.addEventListener("click", () => this.novo());
    grafico.aoMostrar = () => this.desenhar();
    document.addEventListener("preferencias", () => { if (!grafico.removido) this.desenhar(); });
    // o diário (editor) mudou um trade deste ativo: redesenha as linhas e a boleta
    document.addEventListener("diario", () => {
      if (grafico.removido || !this.ativo) return;
      this.desenhar();
      if (this.boleta && !this.boleta.contains(document.activeElement)) this.renderBoleta();
    });
    if (boleta || opcoes.arrastar) this.ligarArraste();
    const loop = () => { if (grafico.removido) return; this.posicionarZonas(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  visiveis() {
    if (!this.ativo) return [];
    const salvas = Simulacoes.doAtivo(this.ativo.ticker).filter((p) => !this.so || p.id === this.so);
    return this.rascunho ? [...salvas, this.rascunho] : salvas;
  }

  /** A simulação em edição (o rascunho ou a escolhida). Pelo id: cada leitura do armazenamento cria objetos novos. */
  ehAtiva(p) {
    return p === this.rascunho || (!this.rascunho && p.id === this.editando);
  }

  emEdicao() {
    if (this.rascunho) return this.rascunho;
    return this.visiveis().find((p) => p.id === this.editando) ?? null;
  }

  async definirAtivo(a) {
    this.ativo = a;
    this.rascunho = null;
    const salvas = Simulacoes.doAtivo(a.ticker);
    this.editando = this.so ?? (salvas.length ? salvas[salvas.length - 1].id : null);
    this.diarios = null;
    const diarios = (await carregarCandles(a.arquivo)).candles;
    if (this.ativo !== a) return;  // trocou de ativo enquanto carregava
    this.diarios = diarios;
    if (this.g.removido) return;
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
      capital: capitalPadrao(a, entrada), criada: a.data, preco_criacao: entrada,
    };
    this.desenhar();
    this.renderBoleta();
    // a boleta fica abaixo do gráfico: leva a tela até ela e põe o foco no primeiro campo
    if (this.boleta && !this.boleta.hidden) {
      this.boleta.scrollIntoView({ block: "nearest", behavior: "smooth" });
      this.boleta.querySelector('input[data-c="entrada"]')?.focus({ preventScroll: true });
    }
  }

  /** Exclui com desfazer (e, no diário, junto com as fotos). */
  excluirSim(p) {
    if (window.Diario) window.Diario.excluir(p.id);
    else if (window.avisoRapido) {
      const copia = { ...p };
      Simulacoes.remover(p.id);
      window.avisoRapido(`Simulação de ${semSufixo(p.ticker)} excluída.`, { rot: "Desfazer", fazer: () => {
        Simulacoes.salvar(copia); this.editando = copia.id; this.desenhar(); this.renderBoleta();
        document.dispatchEvent(new CustomEvent("simulacoes"));
      } });
    } else if (confirm("Excluir esta simulação?")) Simulacoes.remover(p.id);
    else return;
    this.editando = null; this.desenhar(); this.renderBoleta();
    document.dispatchEvent(new CustomEvent("simulacoes"));
  }

  /** Grava a alteração: rascunho só ao clicar em Salvar; simulação salva, na hora. */
  alterado(p) {
    if (p !== this.rascunho) Simulacoes.salvar(p);
    this.desenhar();
    this.renderBoleta(false);
    this.aoMudar?.(p);
  }

  /** Salva o rascunho: junta os campos do diário (se a página os conhece) e tira a foto da entrada. */
  salvarRascunho(p) {
    const ctx = typeof this.contexto === "function" ? this.contexto(p) : this.contexto;
    window.Diario?.preencher(p, ctx ?? { origem: "ativo" });
    Simulacoes.salvar(p); this.editando = p.id; this.rascunho = null;
    this.desenhar(); this.renderBoleta();
    document.dispatchEvent(new CustomEvent("simulacoes"));
    if (window.Diario) {
      window.Diario.fotografar(p.id, this.g, "entrada", { linhas: false }).catch(() => {});
      document.dispatchEvent(new CustomEvent("diario"));
      window.avisoRapido?.(`Simulação de ${semSufixo(p.ticker)} salva.`,
        { rot: "Abrir no diário", fazer: () => window.Diario.abrir(p.id, { grafico: this.ativo?.ticker === p.ticker ? this.g : null }) });
    }
  }

  /** Saída manual no último fechamento publicado. */
  encerrarAgora(p) {
    const u = this.diarios?.at(-1);
    if (!u) return;
    Simulacoes.salvar({ ...p, saida_manual: { data: u.time, preco: u.close } });
    this.desenhar(); this.renderBoleta();
    document.dispatchEvent(new CustomEvent("simulacoes"));
    document.dispatchEvent(new CustomEvent("diario"));
  }

  // ---------------------------------------------------------- desenho

  desenhar() {
    // espaço vazio à direita do último candle para a caixa de risco/retorno aparecer
    this.g.chart.timeScale().applyOptions({ rightOffset: this.visiveis().length ? 14 : 3 });
    for (const l of this.linhas) this.g.candles.removePriceLine(l.linha);
    this.linhas = [];
    const casas = casasPreco(this.ativo?.ultimo ?? 1, this.ativo?.moeda);
    // a escala do gráfico inclui entrada, stop e alvo (senão um alvo longe some acima do topo); vale até o próximo desenho,
    // para a escala não fugir do dedo durante o arraste
    this.niveisEscala = this.visiveis().flatMap((p) => [p.entrada, p.stop, p.alvo]).filter((v) => v > 0);
    this.g.candles.applyOptions({ autoscaleInfoProvider: (original) => {
      const r = original(), n = this.niveisEscala;
      if (!r?.priceRange || !n?.length) return r;
      return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...n), maxValue: Math.max(r.priceRange.maxValue, ...n) } };
    } });
    for (const p of this.visiveis()) {
      const ativa = this.ehAtiva(p);
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
          opacity: this.ehAtiva(p) ? 1 : 0.5,
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
      this.aoArrastar?.(arrastando.pos);
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
    if (!this.boleta) return;
    const a = this.ativo;
    const salvas = a ? Simulacoes.doAtivo(a.ticker) : [];
    const p = this.emEdicao();
    if (!a || (!p && !salvas.length)) {
      this.boleta.hidden = true;
      return;
    }
    this.boleta.hidden = false;
    const casas = casasPreco(a.ultimo, a.moeda);
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
        el("b", { class: st.cls }, ` ${st.rot ?? ""}${av?.resultado_pct != null ? " " + fmtResultado(av) : ""}`));
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
        campo(`Capital (${a.moeda === "BRL" ? "R$" : "US$"})`, "capital", "100"),
        el("div", { class: "boleta-acoes" },
          p === this.rascunho
            ? [el("button", { class: "botao primario", disabled: !c.valido, onclick: () => this.salvarRascunho(p) }, "Salvar"),
              el("button", { class: "botao", onclick: () => { this.rascunho = null; this.desenhar(); this.renderBoleta(); } }, "Descartar")]
            : [av?.estado === "aberta" ? el("button", { class: "botao", title: "Fecha o trade no último fechamento (saída manual)",
                onclick: () => this.encerrarAgora(p) }, "Encerrar agora") : null,
              window.Diario ? el("button", { class: "botao", onclick: () => window.Diario.abrir(p.id, { grafico: this.g }) }, "Editar no diário") : null,
              el("button", { class: "botao perigo", onclick: () => this.excluirSim(p) }, "Excluir")])) : null,
      resumo,
      av ? el("p", { class: "sub boleta-status" }, `Criada em ${fmtData(p.criada)} a ${fmtMoeda(p.preco_criacao, a.moeda)} · `,
        el("b", { class: ESTADO_SIM[av.estado].cls }, ESTADO_SIM[av.estado].rot),
        av.entrou ? ` · entrada em ${fmtData(av.entrou)}` : "",
        av.saiu ? ` · saída em ${fmtData(av.saiu)}` : "",
        av.resultado_pct != null ? el("b", { class: cor(av.resultado_pct) }, ` ${fmtResultado(av)}`) : "") : null,
      p ? el("p", { class: "sub boleta-dica" }, "Arraste as linhas de entrada, stop e alvo no gráfico.") : null,
      p && p === this.rascunho ? el("p", { class: "sub boleta-dica" },
        `Entrada a mercado: começa com o preço do último fechamento (${fmtData(p.criada)}); o resultado conta a partir dele, então o trade só “anda” nos próximos pregões. `,
        "Se mover a entrada para um preço melhor, ele fica “Aguardando entrada” até o preço chegar lá.") : null,
      p ? el("p", { class: "sub boleta-dica" }, el("b", {}, "R"), " é quanto você arrisca (da entrada até o stop): perder no stop é −1R. ",
        el("b", {}, "R:R"), " compara o ganho do alvo com esse risco: alvo em 2R = ganhar 2× o que arrisca.") : null,
      av?.estado === "aberta" ? el("p", { class: "sub boleta-dica" }, "O R de um trade em aberto é parcial: muda a cada preço novo até bater no alvo ou no stop.") : null,
    ].filter(Boolean));
  }
}

/** Chips com a situação de cada simulação salva do ativo (alvo, stop, em aberto...). */
function chipsSimulacoes(a) {
  const sims = Simulacoes.doAtivo(a.ticker).sort((x, y) => x.criada.localeCompare(y.criada) || x.id.localeCompare(y.id));
  if (!sims.length) return null;
  const caixa = el("div", { class: "chips sim-celula" });
  carregarCandles(a.arquivo).then(({ candles }) => caixa.replaceChildren(...sims.map((p) => {
    const av = avaliarSimulacao(p, candles);
    const st = ESTADO_SIM[av.estado];
    return el("span", { class: `chip sim ${p.lado}`, title: `Entrada ${fmtMoeda(p.entrada, a.moeda)} · ` +
      `stop ${fmtMoeda(p.stop, a.moeda)} · alvo ${fmtMoeda(p.alvo, a.moeda)}${av.saiu ? ` · saída em ${fmtData(av.saiu)}` : ""}` },
      `${p.lado === "compra" ? "▲" : "▼"} Simulação ${fmtData(p.criada)} · `,
      el("b", { class: st.cls }, st.rot), av.resultado_pct != null ? el("b", { class: cor(av.resultado_pct) }, ` ${fmtResultado(av)}`) : "");
  }))).catch(() => {});
  return caixa;
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
  // placar: só conta o que já entrou (encerradas + em aberto); aguardando entrada fica de fora
  const soma = (ls, k) => ls.reduce((t, l) => t + (l.av[k] ?? 0), 0);
  const encerradas = linhas.filter((l) => ["alvo", "stop", "manual"].includes(l.av.estado));
  const abertas = linhas.filter((l) => l.av.estado === "aberta");
  const contadas = [...encerradas, ...abertas];
  const totalR = soma(contadas, "resultado_r"), totalPct = soma(contadas, "resultado_pct");
  const kpi = (rot, valor, cls, extra) => el("div", { class: "kpi" }, el("div", { class: "kpi-rotulo" }, rot),
    el("div", { class: `kpi-valor ${cls}` }, valor), extra ? el("div", { class: "kpi-extra" }, extra) : null);
  const placar = contadas.length ? el("div", { class: "kpis placar-sim" },
    kpi("Resultado até agora", fmtR(totalR), cor(totalR), `${fmtPct(totalPct)} somando as variações`),
    kpi("Encerradas", fmtR(soma(encerradas, "resultado_r")), cor(soma(encerradas, "resultado_r")),
      `${n("alvo")} no alvo · ${n("stop")} no stop${n("manual") ? ` · ${n("manual")} encerrada(s) por você` : ""} · ${fmtPct(soma(encerradas, "resultado_pct"))}`),
    kpi("Em aberto (parcial)", abertas.length ? fmtR(soma(abertas, "resultado_r")) : "—", abertas.length ? cor(soma(abertas, "resultado_r")) : "",
      `${abertas.length} operação(ões) · ${fmtPct(soma(abertas, "resultado_pct"))}`),
    kpi("Média por operação", fmtR(totalR / contadas.length), cor(totalR),
      `${fmtPct(totalPct / contadas.length)} · acerto ${encerradas.length ? fmtNum(encerradas.filter((l) => l.av.resultado_r > 0).length / encerradas.length * 100, 0) + "%" : "—"}`)) : null;
  alvo.replaceChildren(
    placar,
    el("p", { class: "sub" }, `${lista.length} simulação(ões) · ${n("alvo")} no alvo · ${n("stop")} no stop · `,
      `${n("aberta")} em aberto · ${n("aguardando")} aguardando entrada. `,
      "Em R, o resultado é medido em unidades do risco: o stop vale -1R e um alvo com o dobro da distância vale +2R."),
    el("div", { class: "tabela-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Ativo", "Lado", "Criada", "Entrada", "Stop", "Alvo", "R:R", "Situação", "Resultado (R)", "Variação"]
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
        el("td", { class: `num ${cor(av.resultado_r)}` }, av.resultado_r != null ? el("b", {}, fmtR(av.resultado_r)) : "—"),
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
