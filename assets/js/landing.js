/* =========================================================
   Carteira Terminal — landing page (index.html, a página inicial do site)
   GSAP + ScrollTrigger (animações no scroll), Lenis (scroll suave), canvas (velas da abertura)
   e JS puro. Técnicas reaproveitadas do site da Garnet: tilt com brilho, faixa que acelera
   com o scroll, manifesto palavra por palavra, linha das etapas, botões magnéticos.
   Os números e exemplos vêm dos dados publicados do terminal (data/*.json): nada inventado.
   ========================================================= */
(() => {
  "use strict";

  /* Configuração dos planos (detalhes no bloco "planos" mais abaixo). */
  const LISTA_ESPERA = "";   // URL de Formulário Google ou Tally para a lista de espera
  const CONTATO_EMAIL = "";  // e-mail que recebe o mini formulário (mailto:)
  const PAGAMENTO = { inicial: "", pro: "" }; // links de pagamento por plano

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mouseFino = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const temGsap = !!window.gsap;
  if (reduzido || !temGsap) document.documentElement.classList.add("reduzido");
  if (temGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
  const anima = temGsap && !reduzido;

  const fmtNum = (v, c = 0) => (v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
  const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, 2)}%`);
  const fmtData = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a.slice(2)}`; };
  const semSufixo = (tk) => tk.replace(/\.SA$/, "").replace(/-USD$/, "").replace(/^\^/, "");
  const el = (tag, attrs = {}, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (typeof v === "function" && k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) n.append(f);
    return n;
  };

  /* ---------- scroll suave (Lenis) ---------- */
  let lenis = null;
  if (anima && window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const alvo = $(a.getAttribute("href"));
    if (!alvo) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(alvo, { offset: -70, duration: 1.4 });
    else alvo.scrollIntoView({ behavior: reduzido ? "auto" : "smooth" });
    if (a.classList.contains("pular")) alvo.focus?.({ preventScroll: true });
  }));

  /* ---------- topo: some ao rolar para baixo, volta ao subir ---------- */
  (function topo() {
    const t = $(".topo");
    let ultimo = scrollY;
    addEventListener("scroll", () => {
      const y = scrollY;
      t.classList.toggle("escondido", y > 200 && y > ultimo && !t.contains(document.activeElement));
      ultimo = y;
    }, { passive: true });
  })();

  /* ---------- velas da abertura: um gráfico que se forma sozinho ao fundo ---------- */
  (function velas() {
    const c = $(".hero-velas");
    const g = c.getContext("2d");
    let w = 0, h = 0, velas = [], marcas = [], rodando = true, desloc = 0;
    const LARG = 14;
    const nova = (ant) => {
      const abre = ant ? ant.fecha : 100;
      const tendencia = Math.sin(velas.length / 37) * 0.35 + 0.08;
      const fecha = Math.max(20, abre + (Math.random() - 0.5 + tendencia * 0.3) * 4.2);
      return { abre, fecha, max: Math.max(abre, fecha) + Math.random() * 1.8, min: Math.min(abre, fecha) - Math.random() * 1.8 };
    };
    const encher = () => {
      const n = Math.ceil(w / LARG) + 4;
      while (velas.length < n) velas.push(nova(velas.at(-1)));
    };
    const tamanho = () => {
      const d = Math.min(devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * d; c.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
      encher();
    };
    const desenhar = () => {
      g.clearRect(0, 0, w, h);
      const vis = velas.slice(-Math.ceil(w / LARG) - 2);
      const lo = Math.min(...vis.map((v) => v.min)), hi = Math.max(...vis.map((v) => v.max));
      const y = (p) => h * 0.82 - ((p - lo) / (hi - lo || 1)) * h * 0.6;
      // média móvel suave por trás das velas
      g.beginPath();
      vis.forEach((v, i) => {
        const media = vis.slice(Math.max(0, i - 9), i + 1).reduce((s, x) => s + x.fecha, 0) / Math.min(i + 1, 10);
        const x = i * LARG - desloc;
        i ? g.lineTo(x, y(media)) : g.moveTo(x, y(media));
      });
      g.strokeStyle = "rgba(139,180,255,0.35)"; g.lineWidth = 2; g.stroke();
      vis.forEach((v, i) => {
        const x = i * LARG - desloc, alta = v.fecha >= v.abre;
        g.strokeStyle = alta ? "rgba(76,141,255,0.9)" : "rgba(120,132,150,0.55)";
        g.fillStyle = alta ? "rgba(76,141,255,0.85)" : "rgba(40,48,60,0.9)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + LARG / 2 - 0.5, y(v.max)); g.lineTo(x + LARG / 2 - 0.5, y(v.min)); g.stroke();
        const topo = y(Math.max(v.abre, v.fecha)), alt = Math.max(1.5, Math.abs(y(v.abre) - y(v.fecha)));
        g.fillRect(x + 2, topo, LARG - 5, alt);
        if (!alta) g.strokeRect(x + 2.5, topo + 0.5, LARG - 6, alt - 1);
      });
      // marcas de setup que aparecem e somem
      for (const m of marcas) {
        const i = vis.indexOf(m.vela);
        if (i < 0) continue;
        const x = i * LARG - desloc + LARG / 2, yy = y(m.vela.min) + 16;
        g.globalAlpha = Math.min(1, m.vida / 40);
        g.fillStyle = "#22b07d";
        g.beginPath(); g.moveTo(x, yy - 8); g.lineTo(x - 6, yy + 2); g.lineTo(x + 6, yy + 2); g.fill();
        g.font = "600 11px 'JetBrains Mono', monospace"; g.fillText(m.txt, x - 20, yy + 18);
        g.globalAlpha = 1;
      }
      // preço atual com brilho
      const u = vis.at(-1), yu = y(u.fecha);
      g.setLineDash([4, 4]); g.strokeStyle = "rgba(76,141,255,0.5)";
      g.beginPath(); g.moveTo(0, yu); g.lineTo(w, yu); g.stroke(); g.setLineDash([]);
    };
    const NOMES = ["Pullback MME 9", "IFR 2", "Rompimento", "Bollinger", "Multitempo"];
    tamanho();
    addEventListener("resize", tamanho);
    if (!anima) { desenhar(); return; }
    new IntersectionObserver(([e]) => { rodando = e.isIntersecting; }).observe(c);
    gsap.ticker.add(() => {
      if (!rodando || document.hidden) return;
      desloc += 0.35;
      if (desloc >= LARG) { desloc -= LARG; velas.push(nova(velas.at(-1))); if (velas.length > 400) velas.splice(0, 100); }
      if (Math.random() < 0.006 && marcas.length < 3) marcas.push({ vela: velas.at(-3), vida: 0, txt: NOMES[Math.floor(Math.random() * NOMES.length)] });
      for (const m of marcas) m.vida++;
      marcas = marcas.filter((m) => m.vida < 520);
      desenhar();
    });
  })();

  /* ---------- dados reais do terminal ---------- */
  const buscar = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };

  Promise.all([buscar("data/radar.json"), buscar("data/setups.json")]).then(([R, C]) => {
    if (!Array.isArray(R.sinais)) { // eventos colunares (ver compactar_sinais em scripts/atualizar_dados.py)
      const t = R.sinais;
      const [A, B, C, D, E, P, I] = t.e;
      R.sinais = A.map((a, k) => ({ ticker: t.tickers[a], setup: t.setups[B[k]], tf: t.tfs[C[k]], data: t.datas[D[k]],
        lado: t.lados[E[k]], preco: P[k], bt: I[k] >= 0 ? t.bt[I[k]] : null }));
    }
    const porTk = new Map(R.ativos.map((a) => [a.ticker, a]));
    const itens = C.grupos.flatMap((g) => g.itens.map((x) => ({ ...x, grupo: g.nome })));
    const porSetup = new Map(itens.map((x) => [x.id, x]));
    const nomeCurto = (id) => (porSetup.get(id)?.nome ?? id).replace(/ de (compra|venda)\b/, "");
    // setups de entrada (o grupo "Tendência" é um estado, não um ponto de entrada)
    const entrada = (id) => { const x = porSetup.get(id); return x && x.grupo !== "Tendência" && x.vies !== "neutro"; };

    // último pregão fechado de cada mercado, no diário
    const ultima = new Map();
    for (const s of R.sinais) {
      if (s.tf !== "D") continue;
      const m = porTk.get(s.ticker)?.mercado;
      if (m && s.data > (ultima.get(m) ?? "")) ultima.set(m, s.data);
    }
    const hoje = R.sinais.filter((s) => s.tf === "D" && entrada(s.setup) && porTk.get(s.ticker)?.liquido !== false
      && s.data === ultima.get(porTk.get(s.ticker)?.mercado));
    const porAtivo = new Map();
    for (const s of hoje) {
      const k = `${s.ticker}|${s.lado}`;
      if (!porAtivo.has(k)) porAtivo.set(k, { ticker: s.ticker, lado: s.lado, setups: new Map() });
      porAtivo.get(k).setups.set(s.setup, s);
    }
    const lista = [...porAtivo.values()];
    const nCompra = lista.filter((x) => x.lado === "compra").length, nVenda = lista.filter((x) => x.lado === "venda").length;
    const casos = itens.reduce((t, x) => t + (x.bt?.D?.n ?? 0) + (x.bt?.W?.n ?? 0), 0);
    const numeros = { ativos: R.ativos.length, setups: itens.length, casos, compra: nCompra, venda: nVenda };

    $$("[data-vivo]").forEach((n) => { const v = numeros[n.dataset.vivo]; if (v != null) n.textContent = fmtNum(v); });
    $$("[data-contar]").forEach((n) => { const v = numeros[n.dataset.contar]; if (v != null) n.dataset.fim = v; });
    contadores();
    const datas = [...ultima.entries()].filter(([m]) => NOMES_MERCADO[m]).map(([m, d]) => `${NOMES_MERCADO[m]} ${fmtData(d).slice(0, 5)}`);
    $("#selo-vivo").textContent = `Ao vivo: ${fmtNum(nCompra)} sinais de compra e ${fmtNum(nVenda)} de venda hoje`;
    $(".terminal-rodape").textContent = `Dados reais do último pregão fechado: ${datas.join(" · ")}.`;

    // os ativos com mais setups de compra apontando
    const top = lista.filter((x) => x.lado === "compra").sort((a, b) => b.setups.size - a.setups.size || a.ticker.localeCompare(b.ticker));
    $("#terminal-lista").replaceChildren(...top.slice(0, 4).map((x) => {
      const a = porTk.get(x.ticker);
      return el("li", {},
        el("span", { class: "tk" }, a.rotulo ?? semSufixo(a.ticker)),
        el("span", { class: "nome" }, a.nome),
        el("span", { class: "n" }, `${x.setups.size} setups`),
        el("span", { class: "chips" }, [...x.setups.keys()].slice(0, 3).map((id) => el("span", { class: "chip" }, nomeCurto(id)))));
    }));

    // faixa: ativos e setups de hoje, compra e venda misturados
    const faixa = $("#faixa-linha");
    const mistura = [...lista].sort((a, b) => b.setups.size - a.setups.size).slice(0, 28);
    if (mistura.length) faixa.replaceChildren(...mistura.map((x) => {
      const a = porTk.get(x.ticker);
      return el("span", { class: x.lado }, el("b", {}, a.rotulo ?? semSufixo(a.ticker)), ` · ${nomeCurto([...x.setups.keys()][0])}`);
    }));
    faixaAnimada();

    // contagem até a próxima publicação de sinais
    contagem(R);

    // prova: até 4 ativos de hoje (um por mercado primeiro), cada um com o setup de melhor histórico nele
    const candidatos = [...lista].sort((p, q) => q.setups.size - p.setups.size)
      .map((x) => ({ x, s: [...x.setups.values()].filter((s) => s.bt && s.bt[0] >= 8 && s.bt[1] != null).sort((p, q) => q.bt[1] - p.bt[1])[0] }))
      .filter((c) => c.s);
    const escolhidos = [];
    for (const m of ["BR", "US", "CRIPTO", "MACRO"]) {
      const c = candidatos.find((c) => porTk.get(c.x.ticker)?.mercado === m && !escolhidos.includes(c));
      if (c) escolhidos.push(c);
    }
    for (const c of candidatos) if (escolhidos.length < 4 && !escolhidos.includes(c)) escolhidos.push(c);
    if (escolhidos.length) provas(escolhidos, porTk, porSetup, nomeCurto);
    else $("#prova-cartao").replaceChildren(el("p", { class: "carregando" }, "Sem um sinal com histórico suficiente hoje. Abra o terminal para ver todos."));
  }).catch(() => {
    $("#terminal-lista").replaceChildren(el("li", { class: "carregando" }, "Não consegui carregar os sinais agora."));
    $("#prova-cartao").replaceChildren(el("p", { class: "carregando" }, "Não consegui carregar um exemplo agora. Abra o terminal para ver os sinais de hoje."));
    contadores();
    faixaAnimada();
  });

  /* ---------- prova: sinais reais de hoje, cada um com o histórico do setup naquele ativo, em abas ---------- */
  function provas(escolhidos, porTk, porSetup, nomeCurto) {
    const abas = $("#prova-abas");
    const cache = new Map();
    const mostrar = async (i) => {
      abas.querySelectorAll("button").forEach((b, j) => { b.setAttribute("aria-selected", String(i === j)); b.tabIndex = i === j ? 0 : -1; });
      const c = escolhidos[i];
      const caixa = $("#prova-cartao");
      if (anima) gsap.fromTo(caixa, { opacity: 0.35, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" });
      if (!cache.has(i)) cache.set(i, prova(c, porTk.get(c.x.ticker), porSetup, nomeCurto));
      mostrar.atual = i;
      caixa.replaceChildren(el("p", { class: "carregando" }, "Carregando o histórico…"));
      const conteudo = await cache.get(i);
      if (mostrar.atual === i) caixa.replaceChildren(conteudo);  // outra aba escolhida enquanto carregava: fica a dela
      magneticos(caixa);
    };
    abas.replaceChildren(...escolhidos.map((c, i) => {
      const a = porTk.get(c.x.ticker);
      return el("button", { type: "button", role: "tab", "aria-controls": "prova-cartao", onclick: () => mostrar(i),
        onkeydown: (e) => {
          const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!d) return;
          const j = (i + d + escolhidos.length) % escolhidos.length;
          abas.children[j].focus(); mostrar(j);
        } },
      el("b", {}, a.rotulo ?? semSufixo(a.ticker)), el("span", {}, `${NOMES_MERCADO[a.mercado] ?? a.mercado} · ${fmtNum(c.s.bt[1], 0)}% com lucro`));
    }));
    mostrar(0);
  }

  async function prova({ x, s }, a, porSetup, nomeCurto) {
    const caixa = el("div", { class: "prova-conteudo" });
    const [velas, casos] = await Promise.all([
      buscar(`data/ativos/${a.arquivo}.json`).catch(() => null),
      buscar(`data/casos/${a.arquivo}.json`).catch(() => null)]);
    const lista = casos?.casos?.D?.[s.setup] ?? [];
    const [n, acerto, medio] = s.bt;
    const setup = porSetup.get(s.setup);
    const c = (velas?.c ?? []).slice(-260);
    const grafico = c.length ? miniGrafico(c, s.data, lista) : null;
    const tk = a.rotulo ?? semSufixo(a.ticker);
    caixa.replaceChildren(
      el("div", {},
        el("div", { class: "prova-cab" }, el("span", { class: "tk" }, tk), el("span", { class: "rotulo" }, a.nome),
          el("span", { class: "preco" }, `${a.moeda === "USD" ? "US$" : "R$"} ${fmtNum(a.ultimo, 2)}`,
            " ", el("span", { class: a.var_dia_pct >= 0 ? "alta" : "baixa" }, fmtPct(a.var_dia_pct)))),
        el("div", { class: "prova-chips" }, el("span", { class: "chip", style: "border-color:rgba(227,162,59,.5);color:#f1cf95;background:rgba(227,162,59,.1)" }, `${x.setups.size} setups hoje`),
          [...x.setups.keys()].map((id) => el("span", { class: "chip" }, nomeCurto(id)))),
        grafico),
      el("div", {},
        el("p", { class: "prova-setup" }, "Histórico de ", el("b", {}, setup?.nome ?? s.setup), ` em ${tk}, saindo 10 pregões depois:`),
        el("div", { class: "prova-stats" },
          el("div", {}, el("span", { class: "rotulo" }, "Casos"), el("b", {}, fmtNum(n))),
          el("div", {}, el("span", { class: "rotulo" }, "Com lucro"), el("b", { class: acerto >= 50 ? "alta" : "baixa" }, `${fmtNum(acerto, 0)}%`)),
          el("div", {}, el("span", { class: "rotulo" }, "Médio"), el("b", { class: medio >= 0 ? "alta" : "baixa" }, fmtPct(medio)))),
        lista.length ? el("table", { class: "prova-tabela" },
          el("thead", {}, el("tr", {}, el("th", {}, "Sinal"), el("th", { class: "num" }, "Entrada"), el("th", { class: "num" }, "Saída"), el("th", { class: "num" }, "Resultado"))),
          el("tbody", {}, lista.slice(-5).reverse().map(([sinal, ent, , sai, r]) => el("tr", {},
            el("td", {}, fmtData(sinal)), el("td", { class: "num" }, fmtNum(ent, 2)), el("td", { class: "num" }, fmtNum(sai, 2)),
            el("td", { class: `num ${r >= 0 ? "alta" : "baixa"}` }, fmtPct(r)))))) : null,
        el("div", { class: "prova-acoes" },
          el("a", { class: "botao botao-primario magnetico", href: `ativo.html#${encodeURIComponent(a.ticker)}` }, `Ver ${tk} no terminal →`),
          el("a", { class: "botao botao-fantasma", href: "setups.html" }, "Ver todos os sinais de hoje"))));
    return caixa;
  }

  /** Mini gráfico de velas em SVG, com cada caso anterior do setup (verde = lucro, vermelho = prejuízo) e o sinal de hoje. */
  function miniGrafico(c, dataSinal, casos = []) {
    const W = 560, H = 200, n = c.length, lw = W / n;
    const lo = Math.min(...c.map((v) => v[3])), hi = Math.max(...c.map((v) => v[2]));
    const y = (p) => 8 + (1 - (p - lo) / (hi - lo || 1)) * (H - 30);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "prova-grafico");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Gráfico dos últimos pregões, com o sinal de hoje marcado");
    let partes = "";
    c.forEach(([d, ab, mx, mn, fe], i) => {
      const x = i * lw, alta = fe >= ab, cor = alta ? "#4c8dff" : "#8591a3";
      partes += `<line x1="${x + lw / 2}" y1="${y(mx)}" x2="${x + lw / 2}" y2="${y(mn)}" stroke="${cor}" stroke-width="1"/>`;
      partes += `<rect x="${x + 1}" y="${y(Math.max(ab, fe))}" width="${Math.max(1, lw - 2)}" height="${Math.max(1, Math.abs(y(ab) - y(fe)))}" fill="${alta ? cor : "#1b222c"}" stroke="${cor}" stroke-width="${alta ? 0 : 1}"/>`;
    });
    const idx = new Map(c.map((v, k) => [v[0], k]));
    for (const [sinal, , , , r] of casos) {
      const k = idx.get(sinal);
      if (k == null) continue;
      const x = k * lw + lw / 2, yy = y(c[k][3]) + 9, cor = r >= 0 ? "#22b07d" : "#f06a6e";
      partes += `<circle cx="${x}" cy="${Math.min(yy, H - 6)}" r="4.5" fill="${cor}" opacity=".9"><title>${fmtData(sinal)}: ${fmtPct(r)}</title></circle>`;
    }
    const i = c.findIndex((v) => v[0] === dataSinal);
    if (i >= 0) {
      const x = i * lw + lw / 2, yy = y(c[i][3]) + 14;
      partes += `<path d="M${x} ${yy - 8} l-6 10 h12 z" fill="#8bb4ff"/><text x="${Math.min(x - 14, W - 50)}" y="${Math.min(yy + 16, H - 2)}" fill="#8bb4ff" font-size="11" font-family="JetBrains Mono, monospace">hoje</text>`;
    }
    svg.innerHTML = partes;
    return svg;
  }

  /* ---------- números que contam ao aparecer ---------- */
  function contadores() {
    const nums = $$("[data-contar]");
    const final = (n) => { n.textContent = fmtNum(Number(n.dataset.fim ?? n.textContent.replace(/\D/g, ""))); };
    if (!anima) { nums.forEach(final); return; }
    nums.forEach((n) => {
      const fim = Number(n.dataset.fim ?? n.textContent.replace(/\D/g, ""));
      const o = { v: n.hasAttribute("data-fixo") ? fim : Math.round(fim * 0.6) };
      n.textContent = fmtNum(o.v);
      ScrollTrigger.create({ trigger: n, start: "top 88%", once: true,
        onEnter: () => gsap.to(o, { v: fim, duration: 2.2, ease: "power2.out", onUpdate: () => { n.textContent = fmtNum(Math.round(o.v)); } }) });
    });
  }

  /* ---------- faixa que acelera com a velocidade do scroll ---------- */
  function faixaAnimada() {
    const trilho = $(".faixa-trilho"), linha = $("#faixa-linha");
    if (trilho.dataset.pronta) return;
    trilho.dataset.pronta = "1";
    for (let i = 0; i < 2; i++) { const copia = linha.cloneNode(true); copia.removeAttribute("id"); copia.setAttribute("aria-hidden", "true"); trilho.append(copia); }
    if (!anima) return;
    let x = 0, empurrao = 0, visivel = true;
    new IntersectionObserver(([e]) => { visivel = e.isIntersecting; }).observe(trilho);
    gsap.ticker.add(() => {
      if (!visivel) return;
      const v = lenis ? lenis.velocity : 0;
      empurrao += (Math.min(Math.abs(v) * 0.35, 30) - empurrao) * 0.1;
      x -= 0.7 + empurrao;
      const largura = linha.offsetWidth;
      if (largura) x %= largura;
      trilho.style.transform = `translate3d(${x}px,0,0) skewX(${Math.max(-6, Math.min(6, -v * 0.2))}deg)`;
    });
  }

  /* ---------- contagem até os próximos sinais (rodada da noite: 22:30 UTC, 19h30 em Brasília) ---------- */
  function contagem(R) {
    const alvos = [$("#contagem"), ...$$("[data-contagem]")].filter(Boolean);
    const proxima = () => {
      const formacao = Object.values(R.em_formacao ?? {}).map((f) => Date.parse(f.sinais_em)).filter((t) => t > Date.now());
      const d = new Date(); d.setUTCHours(22, 30, 0, 0);
      if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
      return Math.min(d.getTime(), ...formacao);
    };
    const tick = () => {
      const ms = proxima() - Date.now(), min = Math.max(1, Math.round(ms / 60000));
      const hora = new Date(proxima()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const txt = `${min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`} (≈ ${hora})`;
      alvos.forEach((a) => { a.textContent = txt; });
    };
    tick();
    setInterval(tick, 30000);
  }

  /* ---------- tilt 3D + brilho que segue o mouse ---------- */
  if (mouseFino && !reduzido) {
    $$("[data-tilt]").forEach((n) => {
      const max = Number(n.dataset.tiltMax || 6);
      n.addEventListener("pointermove", (e) => {
        const r = n.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
        n.style.setProperty("--mx", `${nx * 100}%`);
        n.style.setProperty("--my", `${ny * 100}%`);
        n.classList.add("inclinando");
        n.style.transform = `perspective(900px) rotateY(${(nx - 0.5) * 2 * max}deg) rotateX(${(0.5 - ny) * 2 * max}deg)`;
      });
      n.addEventListener("pointerleave", () => { n.classList.remove("inclinando"); n.style.transform = ""; });
    });
  }

  /* ---------- manifesto palavra por palavra ---------- */
  (function manifesto() {
    const p = $("[data-palavras]");
    const destaques = ["matemática.", "passado,", "ativo.", "decide"];
    p.innerHTML = p.textContent.trim().split(/\s+/)
      .map((w) => `<span class="p${destaques.includes(w) ? " destaque" : ""}">${w}</span>`).join(" ");
    if (!anima) return;
    gsap.to($$(".p", p), { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: p, start: "top 80%", end: "bottom 45%", scrub: true } });
  })();

  /* ---------- etapas: a linha enche e cada passo acende ---------- */
  (function passos() {
    const itens = $$(".passos li");
    if (!anima) { itens.forEach((li) => li.classList.add("aceso")); return; }
    gsap.to(".passos-linha line", { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: ".passos", start: "top 65%", end: "bottom 65%", scrub: true } });
    itens.forEach((li) => ScrollTrigger.create({ trigger: li, start: "top 66%",
      onEnter: () => li.classList.add("aceso"), onLeaveBack: () => li.classList.remove("aceso") }));
  })();

  /* ---------- o filtro: ranking do mês de data/resultados.json (some se o arquivo falhar) ---------- */
  (function filtro() {
    const sec = $("#filtro");
    if (!sec) return;
    buscar("data/resultados.json").then((D) => {
      const mercado = ["BR", "US", "CRIPTO"].find((m) => D.ranking?.[m]?.itens?.length >= 5);
      if (!mercado) return;
      const itens = D.ranking[mercado].itens;
      const nomes = new Map(D.setups.map(([id, nome, lado]) => [id, { nome, lado }]));
      const melhores = itens.slice(0, 3), piores = itens.slice(-2);
      const linha = (x) => {
        const s = nomes.get(x.setup) ?? { nome: x.setup, lado: "" };
        return el("li", { class: "filtro-item" },
          el("span", { class: "filtro-nome" }, el("b", {}, s.nome), el("small", {}, s.lado === "venda" ? "▼ venda" : "▲ compra")),
          el("span", { class: `filtro-med ${x.medio >= 0 ? "alta" : "baixa"}` }, fmtPct(x.medio)),
          el("span", { class: "filtro-det" }, `${fmtNum(x.acerto, 0)}% no lucro · ${fmtNum(x.n)} casos`));
      };
      $("#filtro-melhores").replaceChildren(...melhores.map(linha));
      $("#filtro-piores").replaceChildren(...piores.map(linha));
      const r = D.resumo?.[mercado];
      const tot = r?.n ? ` Somando todos os sinais, só ${fmtNum(r.acerto, 0)}% terminaram no lucro (${fmtNum(r.n)} sinais, retorno médio ${fmtPct(r.medio)}): o valor está em saber quais setups funcionam.` : "";
      $("#filtro-sub").textContent = `${NOMES_MERCADO[mercado]}, sinais encerrados de ${fmtData(D.ranking[mercado].desde)} a ${fmtData(D.ranking[mercado].ate)}, em setups com pelo menos ${D.min_ranking} casos.${tot}`;
      sec.hidden = false;
      if (anima && window.ScrollTrigger) {
        const blocos = $$(".filtro-bloco", sec);
        blocos.forEach((b) => b.classList.add("revelar"));
        ScrollTrigger.refresh();
        ScrollTrigger.batch(blocos, { start: "top 90%", once: true,
          onEnter: (els) => gsap.to(els, { opacity: 1, translate: "0px 0px", duration: 1.1, ease: "expo.out", stagger: 0.12 }) });
      }
    }).catch(() => { /* sem o arquivo, a seção continua escondida */ });
  })();

  /* ---------- Top do dia: top 3 de compra e de venda de data/ranking.json (some se o arquivo falhar) ---------- */
  (function topDoDia() {
    const sec = $("#topdia");
    if (!sec) return;
    buscar("data/ranking.json").then((D) => {
      const compra = D.compra?.geral?.slice(0, 3) ?? [], venda = D.venda?.geral?.slice(0, 3) ?? [];
      if (!compra.length && !venda.length) return;
      const linha = (x) => el("li", { class: "filtro-item" },
        el("span", { class: "filtro-nome" }, el("b", {}, x.rotulo ?? semSufixo(x.ticker)), el("small", {}, `${NOMES_MERCADO[x.mercado] ?? x.mercado} · ${x.setup_nome}`)),
        el("span", { class: `filtro-med ${x.medio >= 0 ? "alta" : "baixa"}` }, fmtPct(x.medio)),
        el("span", { class: "filtro-det" }, `${fmtNum(x.ganhos)} de ${fmtNum(x.casos)} vezes no lucro`));
      const vazio = (l) => el("li", { class: "carregando" }, `Nenhum sinal de ${l} passa nos critérios hoje.`);
      $("#topdia-compra").replaceChildren(...(compra.length ? compra.map(linha) : [vazio("compra")]));
      $("#topdia-venda").replaceChildren(...(venda.length ? venda.map(linha) : [vazio("venda")]));
      $("#topdia-sub").textContent = `Sinais do último pregão fechado${D.data ? ` (${fmtData(D.data)})` : ""}, com pelo menos ${D.min_casos} casos no histórico do ativo. À direita, o retorno médio dos casos anteriores, saindo 10 pregões depois.`;
      sec.hidden = false;
      if (anima && window.ScrollTrigger) {
        const blocos = $$(".filtro-bloco", sec);
        blocos.forEach((b) => b.classList.add("revelar"));
        ScrollTrigger.refresh();
        ScrollTrigger.batch(blocos, { start: "top 90%", once: true,
          onEnter: (els) => gsap.to(els, { opacity: 1, translate: "0px 0px", duration: 1.1, ease: "expo.out", stagger: 0.12 }) });
      }
    }).catch(() => { /* sem o arquivo, a seção continua escondida */ });
  })();

  /* ---------- canal do Telegram: só aparece com URL em assets/js/config.js ---------- */
  (function canal() {
    const url = ((window.CT_CONFIG && window.CT_CONFIG.canalTelegram) || "").trim();
    if (!/^https:\/\//i.test(url)) return;
    const clique = () => { window.medir && window.medir("canal-telegram"); };
    const botao = $("#canal-botao");
    botao.href = url;
    botao.addEventListener("click", clique);
    $("#canal").hidden = false;
    const rod = $("#rodape-canal");
    $("a", rod).href = url;
    $("a", rod).addEventListener("click", clique);
    rod.hidden = false;
    if (anima && window.ScrollTrigger) ScrollTrigger.refresh();
  })();

  /* ---------- revelações ao rolar ---------- */
  if (anima) {
    $$(".secao h2, .secao .sobretitulo, .secao-sub, .dor-card, .recurso, .perfil, .lado, .numero, .acordeao details, .prova-cartao, .final-cartao, .plano-cartao")
      .forEach((n) => n.classList.add("revelar"));
    ScrollTrigger.batch(".revelar", { start: "top 88%", once: true,
      onEnter: (els) => gsap.to(els, { opacity: 1, translate: "0px 0px", duration: 1.1, ease: "expo.out", stagger: 0.08 }) });
    gsap.from(".hero h1, .hero-sub, .hero-acoes, .hero-garantias, .selo", { y: 40, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08 });
    gsap.from(".hero-terminal", { y: 60, opacity: 0, rotateX: 8, duration: 1.4, ease: "expo.out", delay: 0.25 });
  }

  /* ---------- planos: pagamento, lista de espera ou mini formulário ----------
     Configuração (o fundador preenche depois, sem mexer no resto do código):
       PAGAMENTO     link de pagamento de cada plano. Se houver, o botão abre o pagamento.
       LISTA_ESPERA  URL de um Formulário Google ou Tally. Sem link de pagamento, abre em nova aba
                     (se o link não tiver "?", acrescenta ?plano=inicial|pro).
       CONTATO_EMAIL e-mail que recebe os inscritos do mini formulário. Sem backend, o envio abre o
                     app de e-mail do visitante (mailto:). Se estiver vazio, o contato fica salvo só
                     no navegador (localStorage) e a página avisa que a lista abre em breve.
     Se nada estiver preenchido, o botão mostra o mini formulário dentro de #planos-aviso. */
  const NOME_PLANO = { inicial: "Inicial", pro: "Pro" };

  function formularioEspera(aviso, plano) {
    const nome = NOME_PLANO[plano] || plano;
    const email = el("input", { type: "email", id: "espera-email", name: "email", required: true, autocomplete: "email", placeholder: "voce@email.com", inputmode: "email" });
    const zap = el("input", { type: "tel", id: "espera-zap", name: "whatsapp", autocomplete: "tel", placeholder: "(11) 99999-9999", inputmode: "tel" });
    const msg = el("p", { class: "espera-msg", role: "status" });
    const form = el("form", { class: "espera-form", novalidate: true },
      el("p", { class: "espera-titulo" }, `Lista de espera do plano ${nome}`),
      el("p", { class: "espera-texto" }, "Preço de fundador para os primeiros inscritos. Deixe seu contato e avisamos quando as assinaturas abrirem."),
      el("label", { for: "espera-email" }, "E-mail"), email,
      el("label", { for: "espera-zap" }, "WhatsApp (opcional)"), zap,
      el("button", { type: "submit", class: "botao botao-primario" }, "Entrar na lista com preço de fundador"),
      msg,
      el("p", { class: "espera-link" }, "Enquanto isso, o terminal está liberado: ", el("a", { href: "setups.html" }, "ver as oportunidades de hoje →")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const em = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(em)) { msg.textContent = "Digite um e-mail válido."; msg.className = "espera-msg erro"; email.focus(); return; }
      const wa = zap.value.trim();
      window.medir && window.medir("lista-espera-" + plano);
      if (CONTATO_EMAIL) {
        const corpo = `Quero entrar na lista de espera do plano ${nome}.\nE-mail: ${em}\nWhatsApp: ${wa || "não informado"}`;
        location.href = `mailto:${CONTATO_EMAIL}?subject=${encodeURIComponent("Lista de espera: plano " + nome)}&body=${encodeURIComponent(corpo)}`;
        msg.textContent = "Abrimos o seu app de e-mail. É só enviar a mensagem para entrar na lista.";
      } else {
        try {
          const lista = JSON.parse(localStorage.getItem("lista-espera") || "[]");
          lista.push({ plano, email: em, whatsapp: wa, em: new Date().toISOString() });
          localStorage.setItem("lista-espera", JSON.stringify(lista));
        } catch (_) { /* navegador sem armazenamento: segue só com o agradecimento */ }
        msg.textContent = "Obrigado! A lista de espera abre em breve; guardamos o seu interesse neste navegador.";
      }
      msg.className = "espera-msg ok";
    });
    aviso.replaceChildren(form);
    return email;
  }

  $$("[data-plano]").forEach((b) => b.addEventListener("click", (e) => {
    const plano = b.dataset.plano;
    const link = PAGAMENTO[plano];
    if (link) { location.href = link; return; }
    e.preventDefault();
    if (LISTA_ESPERA) {
      window.medir && window.medir("lista-espera-" + plano);
      const url = LISTA_ESPERA.includes("?") ? LISTA_ESPERA : `${LISTA_ESPERA}?plano=${plano}`;
      window.open(url, "_blank", "noopener");
      return;
    }
    const aviso = $("#planos-aviso");
    aviso.classList.add("com-form");
    const campo = formularioEspera(aviso, plano);
    aviso.hidden = false;
    if (anima) gsap.fromTo(aviso, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
    aviso.scrollIntoView({ block: "center", behavior: reduzido ? "auto" : "smooth" });
    campo.focus({ preventScroll: true });
  }));

  /* ---------- perguntas com abertura suave ---------- */
  $$(".acordeao details").forEach((d) => {
    const s = $("summary", d), conteudo = $("div", d);
    s.addEventListener("click", (e) => {
      if (!anima) return;
      e.preventDefault();
      if (d.open) gsap.to(conteudo, { height: 0, duration: 0.4, ease: "power3.inOut", onComplete: () => { d.open = false; gsap.set(conteudo, { clearProps: "height" }); } });
      else { d.open = true; gsap.from(conteudo, { height: 0, duration: 0.5, ease: "power3.out", clearProps: "height" }); }
    });
  });

  /* ---------- barra fixa embaixo: aparece depois da abertura e some na chamada final ---------- */
  (function barraFixa() {
    const b = $(".barra-fixa");
    const atualizar = () => {
      const hero = $(".hero").getBoundingClientRect(), final = $(".final").getBoundingClientRect();
      b.classList.toggle("visivel", hero.bottom < 0 && final.top > innerHeight);
    };
    addEventListener("scroll", atualizar, { passive: true });
    addEventListener("resize", atualizar);
    atualizar();
  })();

  /* ---------- botões magnéticos ---------- */
  function magneticos(raiz = document) {
    if (!mouseFino || !anima) return;
    $$(".magnetico", raiz).forEach((m) => {
      if (m.dataset.mag) return;
      m.dataset.mag = "1";
      const mx = gsap.quickTo(m, "x", { duration: 0.6, ease: "elastic.out(1,.4)" });
      const my = gsap.quickTo(m, "y", { duration: 0.6, ease: "elastic.out(1,.4)" });
      m.addEventListener("pointermove", (e) => {
        const r = m.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.3);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      m.addEventListener("pointerleave", () => { mx(0); my(0); });
    });
  }
  magneticos();
})();
