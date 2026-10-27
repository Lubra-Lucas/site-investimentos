/* Arrastar um ativo até uma bandeja, como no iPhone: segure o card parado (no toque, 400 ms; no mouse,
 * 350 ms em qualquer ponto, até em cima do gráfico; ou arraste direto pelo cabeçalho) e os alvos aparecem nas bordas da tela: Comparar (no alto), Plano de amanhã
 * (à direita), Simular trade (à esquerda) e Anotar (canto de baixo). Soltar fora ou Esc cancela. Também aqui: o menu "⋯" de cada
 * ativo (a alternativa por teclado/mouse) e a doca no topo com o que já está nas bandejas.
 * Plano e Notas são de plano.js e notas.js; sem eles na página, os alvos deles somem. */

window.Arrastar = (() => {
  /** Onde se pode pegar um ativo. `alca`: no mouse, só por ali (o gráfico do card é para mexer no gráfico). */
  const FONTES = [
    { sel: ".celula[data-tk]", alca: "header" },                  // grade de Setups
    { sel: "#lista-ativos .item[data-tk]", alca: null },          // lista de Setups
    { sel: "#cab-ativo-id[data-tk]", alca: null },                // cabeçalho do Ativo
    { sel: "tbody tr[data-tk]:not(.sem-clique)", alca: ".ticker-cel" },  // tabelas da Carteira
  ];
  const IGNORAR = "button, input, select, textarea, label, summary, .abrir-radar, .menu-acoes, .seta-tela, .contexto-painel";
  const LIMIAR_MOUSE = 6, LIMIAR_TOQUE = 10, ESPERA_TOQUE = 400, ESPERA_MOUSE = 350, IMA = 28;
  const reduzir = matchMedia("(prefers-reduced-motion: reduce)");
  const naPagina = (nome) => location.pathname.endsWith(nome);

  let RADAR = null;
  carregarRadar().then((r) => { RADAR = r; }).catch(() => {});
  const ativo = (tk) => RADAR?.ativos.find((a) => a.ticker === tk) ?? null;
  const rotulo = (tk) => semSufixo(tk);
  const plano = () => (window.Plano && typeof window.Plano.adicionar === "function" ? window.Plano : null);
  const notas = () => (window.Notas && typeof window.Notas.abrir === "function" ? window.Notas : null);

  // ------------------------------------------------------------- contexto (o que vai para o Plano e as Notas)

  /** Origem do trade no Diário, pela página em que o ativo foi pego. */
  const origemSimulacao = () => (naPagina("setups.html") ? "setups" : naPagina("triagem.html") ? "triagem"
    : naPagina("ativo.html") ? "ativo" : "manual");

  /** { ticker, setup, tf, data, lado, preco }: a página pode dizer qual evento está em destaque
   *  (window.ctxArrasto, em Setups); senão, o evento mais recente do ativo (diário antes do semanal). */
  function contexto(tk) {
    let c = null;
    try { c = typeof window.ctxArrasto === "function" ? window.ctxArrasto(tk) : null; } catch {}
    if (!c) {
      const ev = (RADAR?.sinais ?? []).filter((s) => s.ticker === tk)
        .sort((x, y) => y.data.localeCompare(x.data) || x.tf.localeCompare(y.tf))[0];
      c = { ticker: tk, setup: ev?.setup, tf: ev?.tf, data: ev?.data, lado: ev?.lado, preco: ev?.preco ?? ativo(tk)?.ultimo };
    }
    return Object.fromEntries(Object.entries({ ...c, ticker: tk }).filter(([, v]) => v != null));
  }

  // ------------------------------------------------------------- ações

  function executar(acao, tk) {
    const rot = rotulo(tk);
    if (acao === "comparar") {
      const r = Comparar.adicionar(tk);
      const n = Comparar.itens().length;
      if (r === "ok") toast(`${rot} adicionado à comparação${n >= 2 ? ` (${n})` : ". Arraste outro para comparar"}`, n >= 2 ? ["Abrir", () => Comparar.abrir()] : null);
      else if (r === "repetido") toast(`${rot} já está na comparação`, ["Abrir", () => Comparar.abrir()]);
      else toast(`A comparação já tem ${Comparar.MAX} ativos: tire um para pôr ${rot}`, ["Abrir", () => Comparar.abrir()]);
    } else if (acao === "simular") {
      // o gráfico do card (se a página o guarda) vira a foto da entrada no Diário
      // a página do ativo simula no próprio gráfico (window.simularAqui, de ativo.js)
      try { if (typeof window.simularAqui === "function" && window.simularAqui(tk)) return; } catch {}
      let grafico = null;
      try { grafico = typeof window.graficoDoAtivo === "function" ? window.graficoDoAtivo(tk) : null; } catch {}
      simularTrade({ ...contexto(tk), origem: origemSimulacao() }, { grafico });
    } else if (acao === "plano" && plano()) {
      // adicionar é assíncrono (devolve o item); o aviso sai quando ele termina
      Promise.resolve().then(() => plano().adicionar(contexto(tk)))
        .then(() => toast(`${rot} no plano de amanhã`, typeof plano().abrir === "function" ? ["Abrir", () => plano().abrir()] : null))
        .catch((e) => { console.warn(e); toast(`Não consegui pôr ${rot} no plano`); });
    } else if (acao === "notas" && notas()) {
      notas().abrir(contexto(tk));
    } else if (acao === "ativo") {
      location.href = `ativo.html#${encodeURIComponent(tk)}`;
    }
  }

  // ------------------------------------------------------------- aviso rápido

  let caixaToast = null, tempoToast = 0;
  function toast(txt, acao) {
    // o aviso do plano.js/notas.js, quando existe, para todos os avisos terem a mesma cara
    if (typeof window.avisoRapido === "function") {
      try { window.avisoRapido(txt, acao ? { rot: acao[0], fazer: acao[1] } : undefined); return; } catch {}
    }
    caixaToast ??= document.body.appendChild(el("div", { class: "toast-arrasto", role: "status", "aria-live": "polite" }));
    caixaToast.replaceChildren(el("span", {}, txt),
      acao ? el("button", { type: "button", onclick: () => { caixaToast.classList.remove("visivel"); acao[1](); } }, acao[0]) : null);
    caixaToast.classList.remove("visivel");
    void caixaToast.offsetWidth;  // reinicia a animação
    caixaToast.classList.add("visivel");
    clearTimeout(tempoToast);
    tempoToast = setTimeout(() => caixaToast.classList.remove("visivel"), 3600);
  }

  // ------------------------------------------------------------- gesto

  let pend = null;   // toque/clique esperando virar arrasto
  let arr = null;    // arrasto em andamento
  let suprimirAte = 0;

  function fonteDe(alvo, modo) {
    if (!(alvo instanceof Element) || alvo.closest(IGNORAR) || document.documentElement.classList.contains("comparar-aberto")) return null;
    for (const f of FONTES) {
      const no = alvo.closest(f.sel);
      if (!no) continue;
      // no mouse, arrastar direto só pela alça; segurar parado ("segurar") vale no card todo
      if (modo === "mouse" && f.alca && !alvo.closest(f.alca)?.closest(f.sel)) return null;
      return no.dataset.tk ? { no, tk: no.dataset.tk } : null;
    }
    return null;
  }

  /** Mini gráfico de linha dos últimos 40 fechamentos, no fantasma. */
  function sparkline(tk, onde) {
    const a = ativo(tk);
    if (!a) return;
    carregarCandles(a.arquivo).then((d) => {
      const c = d.candles.slice(-40).map((x) => x.close);
      if (c.length < 2 || !onde.isConnected) return;
      const min = Math.min(...c), max = Math.max(...c), w = 64, h = 22;
      const pts = c.map((v, i) => `${((i / (c.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * h).toFixed(1)}`).join(" ");
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.classList.add(c.at(-1) >= c[0] ? "alta" : "baixa");
      const linha = document.createElementNS(ns, "polyline");
      linha.setAttribute("points", pts);
      svg.append(linha);
      onde.append(svg);
    }).catch(() => {});
  }

  function montarAlvos(tk) {
    const itens = Comparar.itens();
    const naComp = itens.includes(tk), cheia = itens.length >= Comparar.MAX;
    const P = plano(), N = notas();
    let nPlano = 0;
    try { nPlano = P?.itens?.().length ?? 0; } catch {}
    let noPlano = false;
    try { noPlano = !!P?.tem?.(tk); } catch {}
    const alvo = (acao, cls, icone, titulo, sub, extra) => el("div", { class: `alvo-arrasto ${cls}`, "data-acao": acao },
      el("span", { class: "alvo-icone", "aria-hidden": "true" }, icone),
      el("span", { class: "alvo-texto" }, el("b", {}, titulo), sub ? el("span", { class: "alvo-sub" }, sub) : null), extra);
    return el("div", { class: "arrasto-alvos", "aria-hidden": "true" },
      alvo("comparar", "alvo-comparar", "⇆", "Comparar",
        naComp ? "já está na comparação" : cheia ? `cheia (${itens.length}/${Comparar.MAX})` : itens.length ? `${itens.length} de ${Comparar.MAX} · solte para pôr o ${itens.length + 1}º` : "solte aqui; depois, outro",
        el("span", { class: "alvo-miniaturas" }, [...itens.map((t) => el("span", { class: "alvo-mini" }, rotulo(t))),
          !naComp && !cheia ? el("span", { class: "alvo-mini novo" }, rotulo(tk)) : null])),
      alvo("simular", "alvo-simular", "⊕", "Simular trade", "entrada, stop e alvo"),
      P ? alvo("plano", "alvo-plano", "☰", "Plano de amanhã", noPlano ? "já está no plano" : nPlano ? `${nPlano} no plano` : "entrar amanhã") : null,
      N ? alvo("notas", "alvo-notas", "✎", "Anotar", "uma nota neste ativo") : null);
  }

  function iniciar(fonte, x, y, toque) {
    pend = null;
    getSelection()?.removeAllRanges();
    const a = ativo(fonte.tk);
    const ghost = el("div", { class: `arrasto-fantasma ${toque ? "toque" : ""}`, "aria-hidden": "true" },
      el("b", { class: "mono" }, rotulo(fonte.tk)),
      a ? el("span", { class: "fantasma-preco" }, el("span", { class: "mono" }, fmtMoeda(precoAtual(a).ultimo, a.moeda)), " ",
        el("span", { class: `mono ${cor(precoAtual(a).var_pct)}` }, fmtPct(precoAtual(a).var_pct))) : null);
    sparkline(fonte.tk, ghost);
    const veu = el("div", { class: "arrasto-veu" });
    const alvos = montarAlvos(fonte.tk);
    const r = fonte.no.getBoundingClientRect();
    arr = { ...fonte, ghost, veu, alvos, alvo: null, origem: { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) }, x, y };
    fonte.no.classList.add("arrasto-fonte");
    document.documentElement.classList.add("arrastando");
    document.body.append(veu, alvos, ghost);
    posicionar(x, y);
    requestAnimationFrame(() => { veu.classList.add("visivel"); alvos.classList.add("visivel"); ghost.classList.add("visivel"); });
    if (toque) navigator.vibrate?.(12);
  }

  function posicionar(x, y) {
    arr.x = x; arr.y = y;
    arr.ghost.style.transform = `translate(${x}px, ${y}px)`;
  }

  function mover(x, y) {
    posicionar(x, y);
    let achado = null;
    for (const n of arr.alvos.querySelectorAll(".alvo-arrasto")) {
      const r = n.getBoundingClientRect();
      if (x >= r.left - IMA && x <= r.right + IMA && y >= r.top - IMA && y <= r.bottom + IMA) { achado = n; break; }
    }
    if (achado !== arr.alvo) {
      arr.alvo?.classList.remove("perto");
      achado?.classList.add("perto");
      arr.alvo = achado;
      arr.ghost.classList.toggle("sobre-alvo", !!achado);
      if (achado) navigator.vibrate?.(6);
    }
  }

  function desmontar(atraso) {
    const a = arr;
    arr = null;
    suprimirAte = performance.now() + 250;  // só o clique que o navegador manda logo depois de soltar
    a.no.classList.remove("arrasto-fonte");
    document.documentElement.classList.remove("arrastando");
    for (const n of [a.veu, a.alvos]) n.classList.remove("visivel");
    const t = reduzir.matches ? 0 : atraso;
    setTimeout(() => { a.veu.remove(); a.alvos.remove(); a.ghost.remove(); }, t);
    return a;
  }

  function soltar() {
    if (!arr) return;
    const alvo = arr.alvo, tk = arr.tk;
    if (!alvo) { cancelar(); return; }
    const r = alvo.getBoundingClientRect();
    alvo.classList.add("recebeu");
    arr.ghost.classList.add("soltou");
    arr.ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) scale(0.3)`;
    desmontar(260);
    executar(alvo.dataset.acao, tk);
  }

  function cancelar() {
    if (pend?.timer) clearTimeout(pend.timer);
    pend = null;
    if (!arr) return;
    arr.ghost.classList.add("voltando");
    arr.ghost.style.transform = `translate(${arr.origem.x}px, ${arr.origem.y}px) scale(0.6)`;
    desmontar(280);
  }

  /** O gráfico do card recebeu o clique: encerra o "arrastar o gráfico" dele antes de o card levantar. */
  function soltarGrafico(alvo) {
    for (const tipo of ["pointerup", "mouseup"]) {
      const ev = tipo === "pointerup" ? new PointerEvent(tipo, { bubbles: true, pointerType: "mouse" }) : new MouseEvent(tipo, { bubbles: true });
      alvo.dispatchEvent(ev);
    }
  }
  const pararEspera = () => { if (pend?.espera) { clearTimeout(pend.espera); pend.no.classList.remove("segurando"); } };

  // mouse e caneta: arrastar direto pelo cabeçalho (mais de 6 px) ou segurar parado 350 ms em qualquer ponto do card
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0 || arr) return;
    pararEspera();
    // com uma ferramenta de desenho ligada, segurar no gráfico é desenhar (não levanta o card)
    const desenhando = e.target instanceof Element && e.target.closest(".desenhando, .ferramentas");
    const direto = fonteDe(e.target, "mouse"), fonte = direto ?? (desenhando ? null : fonteDe(e.target, "segurar"));
    if (!fonte) { pend = null; return; }
    pend = { ...fonte, x: e.clientX, y: e.clientY, mouse: true, direto: !!direto, alvo: e.target };
    fonte.no.classList.add("segurando");
    pend.espera = setTimeout(() => {
      if (!pend?.mouse || arr) return;
      const p = pend;
      p.no.classList.remove("segurando");
      if (!p.direto) soltarGrafico(p.alvo);
      iniciar(p, p.x, p.y, false);
      mover(p.x, p.y);
    }, ESPERA_MOUSE);
  });
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    if (arr && !arr.toque) { mover(e.clientX, e.clientY); return; }
    if (!pend?.mouse || Math.hypot(e.clientX - pend.x, e.clientY - pend.y) <= LIMIAR_MOUSE) return;
    pararEspera();
    // mexeu antes do tempo: pela alça vira o arrasto; no gráfico continua sendo mexer no gráfico
    if (pend.direto) { iniciar(pend, e.clientX, e.clientY, false); mover(e.clientX, e.clientY); }
    else pend = null;
  });
  // com o card levantado, o movimento não chega ao gráfico de baixo (senão ele andaria junto)
  for (const tipo of ["pointermove", "mousemove"])
    window.addEventListener(tipo, (e) => {
      if (!arr || arr.toque || e.pointerType === "touch") return;
      if (tipo === "pointermove") mover(e.clientX, e.clientY);
      e.stopPropagation();
    }, true);
  document.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    pararEspera();
    pend = null;
    if (arr && !arr.toque) soltar();
  });
  document.addEventListener("pointercancel", (e) => { if (e.pointerType !== "touch" && arr && !arr.toque) cancelar(); });
  // links não podem virar o arrasto nativo do navegador (a Carteira pega pelo link do ticker)
  document.addEventListener("dragstart", (e) => { if (fonteDe(e.target, "mouse") || arr) e.preventDefault(); });

  // toque: segurar 400 ms parado em qualquer ponto do card
  document.addEventListener("touchstart", (e) => {
    if (arr || e.touches.length !== 1) { cancelar(); return; }
    const t = e.touches[0];
    const fonte = fonteDe(e.target, "toque");
    if (!fonte) return;
    pend = { ...fonte, x: t.clientX, y: t.clientY, timer: setTimeout(() => {
      if (!pend) return;
      iniciar(pend, pend.x, pend.y, true);
      arr.toque = true;
      mover(pend?.x ?? arr.x, pend?.y ?? arr.y);
    }, ESPERA_TOQUE) };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (arr?.toque) { if (e.cancelable) e.preventDefault(); mover(t.clientX, t.clientY); return; }
    if (pend?.timer && Math.hypot(t.clientX - pend.x, t.clientY - pend.y) > LIMIAR_TOQUE) cancelar();
  }, { passive: false });
  document.addEventListener("touchend", (e) => {
    if (pend?.timer) { clearTimeout(pend.timer); pend = null; }
    if (arr?.toque) { if (e.cancelable) e.preventDefault(); soltar(); }
  }, { passive: false });
  document.addEventListener("touchcancel", () => cancelar());
  // o toque longo abre o menu de contexto do navegador; aqui ele vira o arrasto
  document.addEventListener("contextmenu", (e) => { if (arr || pend?.timer || performance.now() < suprimirAte) e.preventDefault(); });

  // depois de um arrasto, o clique que o navegador manda não abre nada
  addEventListener("click", (e) => { if (performance.now() < suprimirAte) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (arr || pend)) { e.preventDefault(); e.stopPropagation(); cancelar(); }
  }, true);
  addEventListener("blur", () => cancelar());
  addEventListener("scroll", () => { if (pend?.timer) cancelar(); }, { passive: true });

  // ------------------------------------------------------------- menu ⋯

  let menuAberto = null;
  function fecharMenu(focar = false) {
    if (!menuAberto) return;
    const { caixa, botao, fora } = menuAberto;
    menuAberto = null;
    caixa.remove();
    botao.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", fora, true);
    if (focar) botao.focus();
  }

  function abrirMenu(botao, tk) {
    const mesmo = menuAberto?.botao === botao;
    fecharMenu();
    if (mesmo) return;
    const P = plano(), N = notas();
    let noPlano = false, etiqueta = null;
    try { noPlano = !!P?.tem?.(tk); } catch {}
    try { etiqueta = N?.etiqueta?.(tk) ?? null; } catch {}
    const naComp = Comparar.tem(tk);
    const item = (icone, txt, acao, sub) => el("button", { type: "button", role: "menuitem", class: "menu-acoes-item",
      onclick: (e) => { e.stopPropagation(); fecharMenu(); acao(); } },
    el("span", { class: "menu-acoes-icone", "aria-hidden": "true" }, icone), el("span", {}, txt), sub ? el("span", { class: "sub" }, sub) : null);
    const caixa = el("div", { class: "menu-acoes", role: "menu", "aria-label": `Ações para ${rotulo(tk)}` },
      naComp ? item("⇆", "Abrir a comparação", () => Comparar.abrir(), `${Comparar.itens().length} ativos`)
        : item("⇆", "Comparar", () => executar("comparar", tk), Comparar.itens().length ? `${Comparar.itens().length} na bandeja` : null),
      item("⊕", "Simular trade", () => executar("simular", tk), "entrada, stop e alvo"),
      P ? (noPlano && typeof P.abrir === "function" ? item("☰", "Abrir o plano de amanhã", () => P.abrir(), "já está nele")
        : item("☰", "Plano de amanhã", () => executar("plano", tk))) : null,
      N ? item("✎", "Anotar", () => executar("notas", tk), typeof etiqueta === "string" ? etiqueta : null) : null,
      naPagina("ativo.html") ? null : item("↗", "Abrir o ativo", () => executar("ativo", tk)));
    caixa.addEventListener("click", (e) => e.stopPropagation());
    caixa.addEventListener("keydown", (e) => {
      const itens = [...caixa.querySelectorAll("[role=menuitem]")];
      const i = itens.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length].focus();
      } else if (e.key === "Home" || e.key === "End") { e.preventDefault(); itens[e.key === "Home" ? 0 : itens.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharMenu(true); }
      else if (e.key === "Tab") fecharMenu();
    });
    document.body.append(caixa);
    const r = botao.getBoundingClientRect();
    const w = caixa.offsetWidth, h = caixa.offsetHeight;
    caixa.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    caixa.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    const fora = (e) => { if (!caixa.contains(e.target) && e.target !== botao) fecharMenu(); };
    document.addEventListener("pointerdown", fora, true);
    botao.setAttribute("aria-expanded", "true");
    menuAberto = { caixa, botao, fora };
    caixa.querySelector("[role=menuitem]")?.focus();
  }
  addEventListener("resize", () => fecharMenu());
  addEventListener("scroll", () => fecharMenu(), { passive: true, capture: true });

  /** O botão "⋯" de um ativo: Comparar · Simular trade · Plano de amanhã · Anotar · Abrir o ativo. */
  function menu(tk) {
    return el("button", { type: "button", class: "mais-acoes", "aria-haspopup": "menu", "aria-expanded": "false",
      title: "Mais ações: comparar, simular trade, plano de amanhã, anotar…", "aria-label": `Mais ações para ${rotulo(tk)}`,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirMenu(e.currentTarget, tk); } }, "⋯");
  }

  // ------------------------------------------------------------- doca no topo

  const doca = el("div", { class: "doca-bandejas", role: "group", "aria-label": "Bandejas", hidden: true });
  let ultimos = "";
  function atualizarDoca() {
    const itens = Comparar.itens();
    let np = 0;
    try { np = plano()?.itens?.().length ?? 0; } catch {}
    const chip = (cls, icone, txt, n, titulo, acao) => el("button", { type: "button", class: `doca-chip ${cls}`, title: titulo, onclick: acao },
      el("span", { class: "doca-icone", "aria-hidden": "true" }, icone), el("span", { class: "doca-rotulo" }, txt), el("b", { class: "doca-n" }, String(n)));
    doca.replaceChildren(...[
      itens.length ? chip("doca-comparar", "⇆", "Comparar", itens.length, `Comparar ${itens.map(rotulo).join(", ")}`, () => Comparar.abrir()) : null,
      np && typeof plano()?.abrir === "function" ? chip("doca-plano", "☰", "Plano de amanhã", np, "Abrir o plano de amanhã", () => plano().abrir()) : null,
    ].filter(Boolean));
    doca.hidden = !doca.childElementCount;
    const agora = `${itens.length}|${np}`;
    if (ultimos && agora !== ultimos && !reduzir.matches) {
      doca.classList.remove("pulso");
      void doca.offsetWidth;
      doca.classList.add("pulso");
    }
    ultimos = agora;
  }
  /** A doca mora na barra do topo (não cobre nada da página); montarTopo redesenha o topo, ela volta. */
  function encaixarDoca() {
    const topo = document.getElementById("topo");
    if (!topo || doca.parentNode === topo) return;
    topo.insertBefore(doca, topo.querySelector(".busca-topo"));
  }
  const topo = document.getElementById("topo");
  if (topo) new MutationObserver(encaixarDoca).observe(topo, { childList: true });
  encaixarDoca();
  document.addEventListener("bandejas", atualizarDoca);
  atualizarDoca();
  // plano.js pode carregar depois: confere de novo quando a página termina de carregar
  addEventListener("load", atualizarDoca);

  return { menu, contexto, executar, toast };
})();
