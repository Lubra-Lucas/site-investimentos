/* Ferramentas de desenho no gráfico: linha horizontal, segmento de reta, retângulo com
 * preenchimento e pincel. Os desenhos ficam presos a (tempo, preço), então continuam no
 * lugar ao trocar de tempo gráfico, e são salvos por ativo no navegador. */

const DESENHOS_CHAVE = "desenhos-v1";
const CORES_DESENHO = ["#f5b942", "#3be8b0", "#4aa3ff", "#f0506e", "#c77dff", "#8a94a6", "#1f2937", "#ffffff"];
const PERTO = 6;  // px de tolerância para acertar um desenho com o mouse
// Alt + letra escolhe a ferramenta (e.code, porque no Mac o Alt troca a letra digitada)
const ATALHOS_DESENHO = { KeyH: "horizontal", KeyT: "segmento", KeyR: "retangulo", KeyB: "pincel" };

const ICONES = {
  cursor: '<path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z"/>',
  horizontal: '<path d="M2 12h20" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/>',
  segmento: '<path d="M5 19L19 5" stroke-width="2"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/>',
  retangulo: '<rect x="4" y="6" width="16" height="12" rx="1" stroke-width="2" fill-opacity=".25"/>',
  pincel: '<path d="M3 17c3-1 4-6 7-6s2 5 5 5 4-4 6-6" stroke-width="2" fill="none"/>',
  desfazer: '<path d="M9 14L4 9l5-5" stroke-width="2" fill="none"/><path d="M4 9h10a6 6 0 010 12h-3" stroke-width="2" fill="none"/>',
  lixeira: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" stroke-width="2" fill="none"/>',
};
const icone = (nome) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.innerHTML = ICONES[nome];
  return s;
};

const tempoNumero = (t) => (typeof t === "number" ? t : Date.parse(`${t}T00:00:00Z`) / 1000);
const distSegmento = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const k = dx || dy ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
};

class Desenhos {
  constructor(grafico, corpo) {
    this.g = grafico;
    this.corpo = corpo;
    this.ticker = null;
    this.lista = [];
    this.ferramenta = "cursor";
    this.selecionado = null;
    this.estilo = { cor: CORES_DESENHO[0], opacidade: 0.2 };
    this.historico = [];  // estados anteriores da lista, para o Ctrl+Z
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("desenhos-camada");
    corpo.append(this.svg, this.montarBarra());
    this.ligarMouse();
    document.addEventListener("keydown", (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && ATALHOS_DESENHO[e.code]) {
        e.preventDefault();
        const f = ATALHOS_DESENHO[e.code];
        this.escolher(this.ferramenta === f ? "cursor" : f);  // repetir o atalho volta ao cursor
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") { e.preventDefault(); this.desfazer(); return; }
      if (e.key === "Escape") { this.escolher("cursor"); this.selecionar(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && this.selecionado) { e.preventDefault(); this.apagarSelecionado(); }
    });
    const loop = () => { this.renderizar(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------- dados

  definirAtivo(ticker) {
    this.ticker = ticker;
    this.lista = guardar.ler(DESENHOS_CHAVE, {})[ticker] ?? [];
    this.historico = [];
    this.selecionar(null);
  }

  /** Guarda o estado atual antes de uma alteração, para o Ctrl+Z voltar a ele. */
  registrar() {
    const atual = JSON.stringify(this.lista);
    if (this.historico[this.historico.length - 1] !== atual) this.historico.push(atual);
    if (this.historico.length > 100) this.historico.shift();
    this.atualizarBarra();
  }

  desfazer() {
    if (!this.historico.length) return;
    this.lista = JSON.parse(this.historico.pop());
    this.selecionar(null);
    this.salvar();
  }

  salvar() {
    const todos = guardar.ler(DESENHOS_CHAVE, {});
    if (this.lista.length) todos[this.ticker] = this.lista; else delete todos[this.ticker];
    guardar.gravar(DESENHOS_CHAVE, todos);
  }

  // ---------------------------------------------------------- barra

  montarBarra() {
    const botao = (nome, titulo, acao) => {
      const b = el("button", { class: "ferr", "data-f": nome, title: titulo, "aria-label": titulo, onclick: acao });
      b.append(icone(nome));
      return b;
    };
    this.botaoCor = el("button", { class: "ferr ferr-cor", title: "Cor e opacidade", "aria-label": "Cor e opacidade",
      onclick: () => { this.paleta.hidden = !this.paleta.hidden; } }, el("span", { class: "bolinha" }));
    this.opacidade = el("input", { type: "range", min: "5", max: "80", step: "5", value: "20",
      oninput: (e) => this.mudarEstilo({ opacidade: e.target.value / 100 }) });
    this.paleta = el("div", { class: "paleta", hidden: true },
      el("div", { class: "cores" }, CORES_DESENHO.map((c) =>
        el("button", { class: "cor", style: `background:${c}`, title: c, onclick: () => this.mudarEstilo({ cor: c }) }))),
      el("label", { class: "opacidade" }, "Preenchimento do retângulo", this.opacidade));
    this.barra = el("div", { class: "ferramentas", role: "toolbar", "aria-label": "Ferramentas de desenho" },
      botao("cursor", "Cursor: selecionar e mover (Esc)", () => this.escolher("cursor")),
      botao("horizontal", "Linha horizontal (Alt+H)", () => this.escolher("horizontal")),
      botao("segmento", "Segmento de reta (Alt+T)", () => this.escolher("segmento")),
      botao("retangulo", "Retângulo (Alt+R)", () => this.escolher("retangulo")),
      botao("pincel", "Pincel (Alt+B): continua ligado até apertar Esc ou escolher outra ferramenta", () => this.escolher("pincel")),
      el("span", { class: "ferr-sep" }),
      this.botaoCor,
      this.botaoDesfazer = botao("desfazer", "Desfazer (Ctrl+Z)", () => this.desfazer()),
      botao("lixeira", "Apagar o selecionado (Delete) ou, sem seleção, todos deste ativo", () => this.apagarSelecionado(true)),
      this.paleta);
    this.atualizarBarra();
    return this.barra;
  }

  escolher(f) {
    this.ferramenta = f;
    if (f !== "cursor") this.selecionar(null);
    this.atualizarBarra();
  }

  atualizarBarra() {
    this.barra.querySelectorAll(".ferr[data-f]").forEach((b) => b.classList.toggle("ativo", b.dataset.f === this.ferramenta));
    const cor = this.selecionado?.cor ?? this.estilo.cor;
    this.botaoCor.querySelector(".bolinha").style.background = cor;
    this.opacidade.value = Math.round((this.selecionado?.opacidade ?? this.estilo.opacidade) * 100);
    this.corpo.classList.toggle("desenhando", this.ferramenta !== "cursor");
    if (this.botaoDesfazer) this.botaoDesfazer.disabled = !this.historico.length;
  }

  mudarEstilo(m) {
    Object.assign(this.estilo, m);
    if (this.selecionado) {
      // arrastar a opacidade gera vários eventos seguidos: um só passo no Ctrl+Z
      if (Date.now() - (this.ultimoEstilo ?? 0) > 800) this.registrar();
      this.ultimoEstilo = Date.now();
      Object.assign(this.selecionado, m);
      this.salvar();
    }
    this.atualizarBarra();
  }

  selecionar(d) {
    this.selecionado = d;
    this.atualizarBarra();
  }

  apagarSelecionado(lixeira = false) {
    const antes = JSON.stringify(this.lista);
    if (this.selecionado) {
      this.lista = this.lista.filter((d) => d !== this.selecionado);
      this.selecionar(null);
    } else if (lixeira && this.lista.length && confirm(`Apagar todos os ${this.lista.length} desenhos de ${semSufixo(this.ticker)}?`)) {
      this.lista = [];
    } else return;
    this.historico.push(antes);
    this.salvar();
    this.atualizarBarra();
  }

  // ---------------------------------------------------------- coordenadas

  /** Tempo -> índice lógico (com interpolação entre candles e extrapolação para a direita). */
  logico(t) {
    const c = this.g.c;
    if (!c?.length) return null;
    const n = c.length, tn = (i) => tempoNumero(c[i].time);
    const passo = n > 1 ? (tn(n - 1) - tn(Math.max(0, n - 6))) / Math.min(5, n - 1) : 86400;
    if (t >= tn(n - 1)) return n - 1 + (t - tn(n - 1)) / passo;
    if (t <= tn(0)) return (t - tn(0)) / passo;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tn(m) <= t) lo = m; else hi = m; }
    return lo + (t - tn(lo)) / (tn(hi) - tn(lo));
  }

  tempo(l) {
    const c = this.g.c;
    const n = c.length, tn = (i) => tempoNumero(c[i].time);
    const passo = n > 1 ? (tn(n - 1) - tn(Math.max(0, n - 6))) / Math.min(5, n - 1) : 86400;
    if (l >= n - 1) return tn(n - 1) + (l - (n - 1)) * passo;
    if (l <= 0) return tn(0) + l * passo;
    const i = Math.floor(l);
    return tn(i) + (l - i) * (tn(i + 1) - tn(i));
  }

  paraTela(p) {
    const l = this.logico(p.t);
    const x = l == null ? null : this.g.chart.timeScale().logicalToCoordinate(l);
    const y = this.g.candles.priceToCoordinate(p.p);
    return x == null || y == null ? null : { x, y };
  }

  doMouse(e) {
    const r = this.corpo.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const l = this.g.chart.timeScale().coordinateToLogical(x);
    const p = this.g.candles.coordinateToPrice(y);
    return { x, y, ponto: l == null || p == null ? null : { t: this.tempo(l), p } };
  }

  /** Só a área de preço do painel principal (fora da escala de preço e do painel do IFR). */
  dentroDoGrafico(x, y) {
    return x < this.g.chart.timeScale().width() && y < (this.g.chart.panes()[0]?.getHeight() ?? Infinity);
  }

  // ---------------------------------------------------------- acerto

  acertar(x, y) {
    for (const d of [...this.lista].reverse()) {
      if (d.tipo === "horizontal") {
        const yy = this.g.candles.priceToCoordinate(d.p);
        if (yy != null && Math.abs(yy - y) <= PERTO) return { d, parte: "tudo" };
        continue;
      }
      const pts = (d.tipo === "pincel" ? d.pontos : [d.a, d.b]).map((p) => this.paraTela(p));
      if (pts.some((p) => !p)) continue;
      if (d === this.selecionado && d.tipo !== "pincel") {
        if (Math.hypot(pts[0].x - x, pts[0].y - y) <= PERTO + 2) return { d, parte: "a" };
        if (Math.hypot(pts[1].x - x, pts[1].y - y) <= PERTO + 2) return { d, parte: "b" };
      }
      if (d.tipo === "retangulo") {
        const [x1, x2] = [pts[0].x, pts[1].x].sort((m, n) => m - n), [y1, y2] = [pts[0].y, pts[1].y].sort((m, n) => m - n);
        const naBorda = x >= x1 - PERTO && x <= x2 + PERTO && y >= y1 - PERTO && y <= y2 + PERTO &&
          (Math.abs(x - x1) <= PERTO || Math.abs(x - x2) <= PERTO || Math.abs(y - y1) <= PERTO || Math.abs(y - y2) <= PERTO);
        const dentro = x > x1 && x < x2 && y > y1 && y < y2;
        // dentro só pega se já estiver selecionado (senão atrapalharia arrastar o gráfico)
        if (naBorda || (dentro && d === this.selecionado)) return { d, parte: "tudo" };
        continue;
      }
      for (let i = 1; i < pts.length; i++)
        if (distSegmento(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= PERTO) return { d, parte: "tudo" };
    }
    return null;
  }

  // ---------------------------------------------------------- mouse

  ligarMouse() {
    let acao = null;
    const bloquear = (sim) => this.g.chart.applyOptions({ handleScroll: !sim, handleScale: !sim });

    const naBarra = (e) => this.barra.contains(e.target);
    this.corpo.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (naBarra(e)) { e.stopImmediatePropagation(); return; }  // clique na barra é só da barra
      this.paleta.hidden = true;
      const { x, y, ponto } = this.doMouse(e);
      if (!ponto || !this.dentroDoGrafico(x, y)) return;
      let novo = null;
      const antes = JSON.stringify(this.lista);
      if (this.ferramenta === "cursor") {
        const alvo = this.acertar(x, y);
        if (!alvo) { this.selecionar(null); return; }  // deixa o gráfico (e o simulador) tratar o clique
        this.selecionar(alvo.d);
        acao = { tipo: "mover", d: alvo.d, parte: alvo.parte, inicio: ponto, original: JSON.parse(JSON.stringify(alvo.d)), antes };
      } else {
        const base = { id: `${Date.now()}`, cor: this.estilo.cor, tipo: this.ferramenta };
        if (this.ferramenta === "horizontal") novo = { ...base, p: ponto.p };
        else if (this.ferramenta === "pincel") novo = { ...base, pontos: [ponto] };
        else novo = { ...base, a: ponto, b: { ...ponto }, ...(this.ferramenta === "retangulo" ? { opacidade: this.estilo.opacidade } : {}) };
        this.lista.push(novo);
        acao = { tipo: "criar", d: novo, antes };
      }
      e.preventDefault();
      e.stopImmediatePropagation();  // o gráfico não arrasta e o simulador não vê este clique
      bloquear(true);
      this.corpo.setPointerCapture(e.pointerId);
    }, true);

    this.corpo.addEventListener("pointermove", (e) => {
      if (!acao && naBarra(e)) { e.stopImmediatePropagation(); this.corpo.style.cursor = ""; return; }
      const { x, y, ponto } = this.doMouse(e);
      if (!acao) {
        if (this.ferramenta === "cursor") {
          const alvo = this.dentroDoGrafico(x, y) && this.acertar(x, y);
          if (alvo) { this.corpo.style.cursor = alvo.parte === "tudo" ? "move" : "grab"; e.stopImmediatePropagation(); }
          else if (this.corpo.style.cursor === "move" || this.corpo.style.cursor === "grab") this.corpo.style.cursor = "";
        }
        return;
      }
      e.stopImmediatePropagation();
      if (!ponto) return;
      const d = acao.d;
      if (acao.tipo === "criar") {
        if (d.tipo === "pincel") d.pontos.push(ponto);
        else if (d.tipo === "horizontal") d.p = ponto.p;
        else d.b = ponto;
        return;
      }
      if (acao.parte === "a" || acao.parte === "b") { d[acao.parte] = ponto; return; }
      const dt = ponto.t - acao.inicio.t, dp = ponto.p - acao.inicio.p, o = acao.original;
      const mover = (p) => ({ t: p.t + dt, p: p.p + dp });
      if (d.tipo === "horizontal") d.p = o.p + dp;
      else if (d.tipo === "pincel") d.pontos = o.pontos.map(mover);
      else { d.a = mover(o.a); d.b = mover(o.b); }
    }, true);

    const soltar = (e) => {
      if (!acao) return;
      const d = acao.d;
      // clique sem arrastar não cria segmento/retângulo vazio
      const vazio = acao.tipo === "criar" && d.tipo !== "horizontal" &&
        (d.tipo === "pincel" ? d.pontos.length < 2 : d.a.t === d.b.t && d.a.p === d.b.p);
      if (vazio) this.lista = this.lista.filter((x) => x !== d);
      // o pincel continua ligado para o próximo traço; as outras ferramentas voltam ao cursor
      else if (acao.tipo === "criar" && d.tipo !== "pincel") { this.escolher("cursor"); this.selecionar(d); }
      // só entra no Ctrl+Z o que de fato mudou (um clique sem arrastar não conta)
      if (JSON.stringify(this.lista) !== acao.antes) { this.historico.push(acao.antes); this.atualizarBarra(); }
      acao = null;
      bloquear(false);
      this.corpo.releasePointerCapture?.(e.pointerId);
      this.salvar();
    };
    this.corpo.addEventListener("pointerup", soltar, true);
    this.corpo.addEventListener("pointercancel", soltar, true);
  }

  // ---------------------------------------------------------- desenho

  renderizar() {
    if (!this.g.c) return;
    const NS = "http://www.w3.org/2000/svg";
    const largura = this.g.chart.timeScale().width();
    const altura = this.g.chart.panes()[0]?.getHeight() ?? this.corpo.clientHeight;
    this.svg.setAttribute("width", largura);
    this.svg.setAttribute("height", altura);
    const partes = [];
    const novo = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      partes.push(n);
      return n;
    };
    for (const d of this.lista) {
      const sel = d === this.selecionado;
      const traco = { stroke: d.cor, "stroke-width": sel ? 2.5 : 2, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
      if (d.tipo === "horizontal") {
        const y = this.g.candles.priceToCoordinate(d.p);
        if (y == null) continue;
        novo("line", { x1: 0, x2: largura, y1: y, y2: y, ...traco });
        if (sel) novo("circle", { cx: largura - 14, cy: y, r: 4, fill: d.cor });
        continue;
      }
      const pts = (d.tipo === "pincel" ? d.pontos : [d.a, d.b]).map((p) => this.paraTela(p));
      if (pts.some((p) => !p)) continue;
      if (d.tipo === "segmento") novo("line", { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, ...traco });
      else if (d.tipo === "retangulo") {
        novo("rect", {
          x: Math.min(pts[0].x, pts[1].x), y: Math.min(pts[0].y, pts[1].y),
          width: Math.abs(pts[1].x - pts[0].x), height: Math.abs(pts[1].y - pts[0].y),
          ...traco, "stroke-width": sel ? 2 : 1.5, fill: d.cor, "fill-opacity": d.opacidade ?? 0.2,
        });
      } else novo("polyline", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), ...traco });
      if (sel && d.tipo !== "pincel")
        for (const p of pts) novo("circle", { cx: p.x, cy: p.y, r: 4.5, fill: "#fff", stroke: d.cor, "stroke-width": 2 });
    }
    this.svg.replaceChildren(...partes);
  }
}
