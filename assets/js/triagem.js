/* Triagem: um "Tinder" de ativos para a rotina depois do fechamento. Um card por ativo que deu sinal
 * de compra (ou de venda) no último pregão fechado do mercado dele, com o gráfico, os setups do dia,
 * o selo do histórico e o contexto. Arrastar para a direita = gostei, para a esquerda = descartar
 * (só por hoje), para cima = super. Depois, em "Hoje", as três colunas e os dias anteriores.
 * Eventos: data/radar.json (sinais: {ticker, setup, tf, data, lado, preco, bt}); nomes: data/setups.json. */

(() => {
  const CHAVE = "triagem-v1", PREFS = "triagem-prefs", MAX_SESSOES = 60;
  const BARRAS = 126;  // ~6 meses de pregões visíveis no card
  const DEC = {
    super: { icone: "★", nome: "Super", carimbo: "SUPER", dir: "cima" },
    gostei: { icone: "♥", nome: "Gostei", carimbo: "GOSTEI", dir: "direita" },
    descartado: { icone: "✗", nome: "Descartados", carimbo: "DESCARTAR", dir: "esquerda" },
  };
  const NOMES_MERCADO = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
  const reduzir = matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (id) => document.getElementById(id);

  const T = Object.assign({ lado: "compra", mercado: "", so2: false, semTendencia: true, ordem: "confluencia", visao: "baralho" },
    guardar.ler(PREFS, {}));
  const salvarPrefs = () => guardar.gravar(PREFS, T);

  let R, F = null, porTicker = new Map(), EV = new Map();
  let sessao = new Map();                       // mercado -> data da última sessão fechada
  let ITENS = { compra: [], venda: [] };        // ativos com sinal do lado na sessão do seu mercado
  const cartoes = new Map();                    // ticker -> { no, g, i, ctx } (no máximo 3 na pilha)
  const desfazer = [];                          // decisões desta visita, para o ↶
  let voltaram = [];                            // tickers devolvidos ao baralho: entram no topo
  const graficosRes = [];                       // mini gráficos do resultado (desmontados a cada desenho)

  // ------------------------------------------------------------- decisões (localStorage)

  /* Regra do "hoje": cada mercado tem a sua sessão = a data mais recente com evento diário (D) entre os
   * ativos daquele mercado (a mesma conta de sinaisDoPeriodo). B3, EUA e Macro costumam coincidir; cripto
   * tem candle no fim de semana. A decisão de um ativo é guardada na chave "AAAA-MM-DD|lado" da sessão do
   * mercado DELE ({ "2026-10-20|compra": { "PETR4.SA": {d, em, setups, preco} } }); mercados com a mesma
   * data dividem a chave sem conflito, porque cada ticker é de um mercado só. Quando o mercado ganha uma
   * sessão nova, a chave do ativo muda e ele pode voltar ao baralho: é isso que faz o descarte valer só
   * por aquele dia. Ao carregar, os descartes de sessões passadas são apagados e só as 60 datas mais
   * recentes ficam (Super e Gostei viram "Dias anteriores"). */
  let D = guardar.ler(CHAVE, {});
  const gravarD = () => guardar.gravar(CHAVE, D);
  const hojeDe = (tk) => sessao.get(porTicker.get(tk)?.mercado) ?? null;
  const chaveDe = (tk, lado) => `${hojeDe(tk)}|${lado}`;
  const decisao = (tk, lado) => D[chaveDe(tk, lado)]?.[tk] ?? null;

  function limparAntigas() {
    if (!D || typeof D !== "object" || Array.isArray(D)) D = {};
    for (const [k, m] of Object.entries(D)) {
      const data = k.split("|")[0];
      if (!m || typeof m !== "object") { delete D[k]; continue; }
      for (const [tk, x] of Object.entries(m)) {
        const h = hojeDe(tk);
        if (!DEC[x?.d] || (x.d === "descartado" && h && data < h)) delete m[tk];
      }
      if (!Object.keys(m).length) delete D[k];
    }
    const datas = [...new Set(Object.keys(D).map((k) => k.split("|")[0]))].sort().reverse();
    for (const k of Object.keys(D)) if (!datas.slice(0, MAX_SESSOES).includes(k.split("|")[0])) delete D[k];
    gravarD();
  }

  /** Grava a decisão do ativo `i` (item do baralho) ou muda a de um registro já salvo. */
  function decidir(tk, lado, d, base) {
    const k = chaveDe(tk, lado);
    const antes = D[k]?.[tk] ?? null;
    const reg = base ?? antes;
    (D[k] ??= {})[tk] = { d, em: new Date().toISOString(), setups: reg?.setups ?? [], preco: reg?.preco ?? porTicker.get(tk)?.ultimo };
    gravarD();
    desfazer.push({ k, tk, lado, antes, d });
    voltaram = voltaram.filter((t) => t !== tk);
    navigator.vibrate?.(10);
  }

  function apagar(k, tk) {
    if (!D[k]) return;
    delete D[k][tk];
    if (!Object.keys(D[k]).length) delete D[k];
  }

  // ------------------------------------------------------------- baralho

  const nomeCurto = (id) => (SETUP_POR_ID.get(id)?.nome ?? id).replace(/ de (compra|venda)\b/, "");
  const ehTendencia = (id) => SETUP_POR_ID.get(id)?.grupo === "Tendência";
  const ORDEM_CATALOGO = () => new Map([...SETUP_POR_ID.keys()].map((id, n) => [id, n]));

  function montarItens() {
    const pos = ORDEM_CATALOGO();
    const m = { compra: new Map(), venda: new Map() };
    for (const e of R.sinais) {
      if (e.tf !== "D" || !m[e.lado]) continue;
      const a = porTicker.get(e.ticker);
      if (!a || e.data !== sessao.get(a.mercado)) continue;
      let i = m[e.lado].get(e.ticker);
      if (!i) m[e.lado].set(e.ticker, (i = { ticker: e.ticker, lado: e.lado, data: e.data, preco: e.preco ?? a.ultimo, eventos: [], setups: [] }));
      i.eventos.push(e);
      if (!i.setups.includes(e.setup)) i.setups.push(e.setup);
    }
    for (const lado of ["compra", "venda"]) {
      ITENS[lado] = [...m[lado].values()];
      for (const i of ITENS[lado]) {
        // os setups que valem todo dia (grupo Tendência) vão para o fim dos chips
        i.setups.sort((x, y) => ehTendencia(x) - ehTendencia(y) || (pos.get(x) ?? 999) - (pos.get(y) ?? 999));
        i.fortes = i.setups.filter((id) => !ehTendencia(id));
        const comBt = i.eventos.filter((e) => e.bt);
        i.melhor = comBt.filter((e) => e.bt[1] != null).sort((x, y) => (y.bt[3] ?? -1e9) - (x.bt[3] ?? -1e9))[0] ?? comBt[0] ?? null;
      }
    }
  }

  const conta = (i) => (T.semTendencia ? i.fortes.length : i.setups.length);
  const melhorBt = (i) => (i.melhor?.bt?.[1] != null ? i.melhor.bt[3] ?? -1e9 : -1e9);
  const ORDENS = {
    confluencia: (x, y) => conta(y) - conta(x) || melhorBt(y) - melhorBt(x),
    historico: (x, y) => melhorBt(y) - melhorBt(x) || conta(y) - conta(x),
  };

  /** Os ativos do lado com os filtros (decididos ou não), na ordem escolhida. */
  function filtrados(lado) {
    const ordem = ORDENS[T.ordem] ?? ORDENS.confluencia;
    return ITENS[lado].filter((i) => conta(i) >= 1 && (!T.mercado || porTicker.get(i.ticker).mercado === T.mercado) && (!T.so2 || conta(i) >= 2))
      .sort((x, y) => ordem(x, y) || x.ticker.localeCompare(y.ticker));
  }

  /** O que falta decidir; os devolvidos ao baralho (↶ ou "voltar para o baralho") vêm primeiro. */
  function baralho(lado) {
    const resto = filtrados(lado).filter((i) => !decisao(i.ticker, lado));
    const prio = (i) => { const p = voltaram.indexOf(i.ticker); return p < 0 ? 1e9 : p; };
    return resto.map((i, n) => [i, n]).sort(([x, a], [y, b]) => prio(x) - prio(y) || a - b).map(([i]) => i);
  }

  // ------------------------------------------------------------- card

  function chipsSetups(setups, lado) {
    return setups.map((id) => el("span", { class: `chip setup vies-${lado} ${ehTendencia(id) ? "" : "foco"}`,
      title: `${SETUP_POR_ID.get(id)?.nome ?? id}${SETUP_POR_ID.get(id)?.desc ? `: ${SETUP_POR_ID.get(id).desc}` : ""}` }, nomeCurto(id)));
  }

  function blocoContexto(i) {
    const fotos = F?.ativos?.[i.ticker];
    if (!fotos) return [];
    const { favor, cuidado } = contextoDecisao(porTicker.get(i.ticker), fotos, "D", i.lado, EV.get(i.ticker) ?? [], nomeSetup);
    const lista = (itens, cls, simbolo) => (itens.length ? el("ul", { class: `contexto-lista ${cls}` },
      itens.slice(0, 4).map((t) => el("li", { title: t }, el("span", { class: "simbolo" }, simbolo), t))) : null);
    return [lista(favor, "favor", "✓"), lista(cuidado, "cuidado", "⚠")].filter(Boolean);
  }

  function criarCartao(i) {
    const a = porTicker.get(i.ticker);
    const corpo = el("div", { class: "tri-grafico", title: "Arraste para navegar, roda do mouse (ou pinça) dá zoom" });
    // tempo do gráfico do card (60m/4h só com intraday verificado)
    const tfs = el("div", { class: "segmento tri-tfs", "aria-label": "Tempo do gráfico" },
      [["60", "60m"], ["240", "4h"], ["D", "D"], ["W", "S"], ["M", "M"]]
        .filter(([v]) => !INTRADAY.has(v) || a.tem_intraday)
        .map(([v, rot]) => el("button", { type: "button", "data-tf": v, class: v === "D" ? "ativo" : null,
          onclick: (e) => trocarTf(c, v, e.currentTarget) }, rot)));
    const ctx = el("div", { class: "contexto-decisao tri-contexto" }, blocoContexto(i));
    const n = conta(i);
    const carimbos = Object.entries(DEC).map(([d, x]) => el("div", { class: `tri-carimbo carimbo-${d}`, "data-d": d, "aria-hidden": "true" },
      d === "super" ? "★ " : "", x.carimbo));
    const no = el("article", { class: `tri-cartao lado-${i.lado}`, "data-tk": i.ticker, "aria-label": `${semSufixo(i.ticker)}, ${a.nome}` },
      el("header", { class: "tri-cab" },
        el("div", { class: "tri-id" },
          el("b", { class: "mono tri-ticker" }, semSufixo(i.ticker)),
          el("span", { class: "tri-nome" }, a.nome),
          el("span", { class: "tag" }, NOMES_MERCADO[a.mercado] ?? a.mercado),
          window.selosBandeja?.(i.ticker)),
        precoComFormacao(a, "tri-preco"),
        el("div", { class: "tri-acoes" },
          el("a", { class: "tri-link", href: `ativo.html#${encodeURIComponent(i.ticker)}`, title: "Abrir a página do ativo" }, "↗ ver o ativo"),
          window.Arrastar?.menu(i.ticker))),
      el("div", { class: "chips tri-chips" },
        el("span", { class: `chip ctx ${i.lado === "compra" ? "alta" : "baixa"}` }, `${i.lado === "compra" ? "▲" : "▼"} ${fmtData(i.data, true)}`),
        n >= 2 ? el("span", { class: "chip destaque" }, `${n} setups`) : null,
        chipsSetups(i.setups, i.lado),
        seloHistorico(i.melhor?.bt, "D"), tfs),
      corpo, ctx, ...carimbos);
    const c = { no, corpo, ctx, i, g: null, carimbos: Object.fromEntries(carimbos.map((x) => [x.dataset.d, x])) };
    ligarGestos(c);
    return c;
  }

  /** Gráfico do card: diário, ~6 meses, setas dos eventos do lado, faixa no candle de hoje. É um gráfico de
   *  verdade (arrastar, zoom, cursor); o card se joga pelas partes fora dele. Só os dois de cima têm gráfico. */
  function abrirGrafico(c) {
    const a = porTicker.get(c.i.ticker);
    const g = new Grafico(c.corpo);
    g.sinais = (EV.get(c.i.ticker) ?? []).filter((e) => e.lado === c.i.lado).map(eventoParaGrafico);
    c.g = g;
    g.mostrar(a.arquivo, "D").then((ok) => {
      if (!ok || g.removido) return;
      g.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, g.n - BARRAS), to: g.n + 3 });
      g.destacar(c.i.data);
    }).catch(() => {});
  }

  async function trocarTf(c, tf, botao) {
    if (!c.g || c.g.tf === tf) return;
    botao.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b === botao));
    const ok = await c.g.mostrar(porTicker.get(c.i.ticker).arquivo, tf);
    if (ok && tf === "D") { c.g.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, c.g.n - BARRAS), to: c.g.n + 3 }); c.g.destacar(c.i.data); }
  }

  function soltarCartao(c) {
    c.g?.remover();
    c.g = null;
    c.no.remove();
  }

  // ------------------------------------------------------------- pilha

  function renderPilha(entrada = null) {
    const pilha = $("tri-pilha");
    const fila = baralho(T.lado);
    const topo = fila.slice(0, 3);
    const quer = new Set(topo.map((i) => i.ticker));
    for (const [tk, c] of cartoes) if (!quer.has(tk) || c.i.lado !== T.lado) { soltarCartao(c); cartoes.delete(tk); }
    topo.forEach((i, pos) => {
      let c = cartoes.get(i.ticker);
      const novo = !c;
      if (novo) { c = criarCartao(i); cartoes.set(i.ticker, c); }
      c.i = i;
      c.no.dataset.pos = pos;
      c.no.style.zIndex = String(10 - pos);
      c.no.inert = pos > 0;
      if (novo) {
        if (entrada?.tk === i.ticker && !reduzir.matches) {
          // o card desfeito volta de onde saiu
          c.no.style.transition = "none";
          c.no.style.transform = alvoVoo(entrada.d, 0, 0);
          pilha.append(c.no);
          void c.no.offsetWidth;
          c.no.style.transition = "";
          c.no.style.transform = "";
        } else pilha.append(c.no);
      }
      if (pos < 2 && !c.g) abrirGrafico(c);
    });
    const vazio = !fila.length;
    pilha.hidden = vazio;
    $("tri-fim").hidden = !vazio;
    if (vazio) renderFim();
    document.querySelectorAll("#tri-botoes [data-d]").forEach((b) => { b.disabled = vazio; });
    $("tri-desfazer").disabled = !desfazer.length;
  }

  function alvoVoo(d, dx, dy) {
    const w = innerWidth, h = innerHeight;
    if (d === "super") return `translate(${dx}px, ${-h * 1.2}px) rotate(${dx * 0.03}deg)`;
    const s = d === "gostei" ? 1 : -1;
    return `translate(${s * w * 1.25}px, ${dy + 60}px) rotate(${s * 28}deg)`;
  }

  /** Decide o card de cima e o tira da pilha voando para o lado da decisão. */
  function agir(d, dx = 0, dy = 0) {
    const c = [...cartoes.values()].find((x) => x.no.dataset.pos === "0");
    if (!c) return;
    decidir(c.i.ticker, c.i.lado, d, { setups: c.i.setups, preco: c.i.preco });
    cartoes.delete(c.i.ticker);
    const no = c.no;
    no.dataset.pos = "saindo";
    no.inert = true;
    no.style.zIndex = "20";
    Object.entries(c.carimbos).forEach(([k, x]) => { x.style.opacity = k === d ? "1" : "0"; });
    if (reduzir.matches) {
      no.style.transition = "opacity .15s linear";
      no.style.opacity = "0";
    } else {
      no.style.transition = "transform .36s cubic-bezier(.4,0,1,1), opacity .36s linear";
      no.style.transform = alvoVoo(d, dx, dy);
      no.style.opacity = "0.6";
    }
    setTimeout(() => soltarCartao(c), reduzir.matches ? 170 : 380);
    renderTudo();
  }

  function desfazerUltimo() {
    const u = desfazer.pop();
    if (!u) return;
    if (u.antes) (D[u.k] ??= {})[u.tk] = u.antes; else apagar(u.k, u.tk);
    gravarD();
    navigator.vibrate?.(10);
    if (!u.antes) {
      voltaram = [u.tk, ...voltaram.filter((t) => t !== u.tk)];
      if (T.lado !== u.lado) { T.lado = u.lado; salvarPrefs(); }
    }
    renderTudo(u.antes ? null : { tk: u.tk, d: u.d });
  }

  // ------------------------------------------------------------- gestos

  function ligarGestos(c) {
    const no = c.no;
    let g = null;
    const proximo = () => [...cartoes.values()].find((x) => x.no.dataset.pos === "1")?.no;
    const pintar = (dx, dy) => {
      const limX = g.w * 0.3, limY = g.h * 0.25;
      const cima = -dy > Math.abs(dx);
      const p = { gostei: cima ? 0 : Math.max(0, dx / limX), descartado: cima ? 0 : Math.max(0, -dx / limX), super: cima ? -dy / limY : 0 };
      for (const [d, x] of Object.entries(c.carimbos)) x.style.opacity = String(Math.min(1, p[d]));
      const t = Math.min(1, Math.max(p.gostei, p.descartado, p.super));
      const prox = proximo();
      if (prox) { prox.style.transition = "none"; prox.style.transform = `translateY(${14 * (1 - t)}px) scale(${0.95 + 0.05 * t})`; }
    };
    const voltar = () => {
      no.classList.remove("arrastando");
      no.style.transition = reduzir.matches ? "none" : "transform .32s cubic-bezier(.2,.9,.3,1.25)";
      no.style.transform = "";
      Object.values(c.carimbos).forEach((x) => { x.style.opacity = "0"; });
      const prox = proximo();
      if (prox) { prox.style.transition = ""; prox.style.transform = ""; }
    };
    no.addEventListener("pointerdown", (e) => {
      // o gráfico é para analisar (arrastar, zoom): o card se joga pelo cabeçalho, chips, contexto e bordas
      if (no.dataset.pos !== "0" || e.button > 0 || e.target.closest("a, button, select, input, summary, .menu-acoes, .tri-grafico")) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
        movendo: false, w: no.offsetWidth, h: no.offsetHeight };
      try { no.setPointerCapture(e.pointerId); } catch {}
    });
    no.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      g.dx = e.clientX - g.x0;
      g.dy = e.clientY - g.y0;
      g.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      while (g.pts.length > 2 && e.timeStamp - g.pts[0].t > 100) g.pts.shift();
      if (!g.movendo && Math.hypot(g.dx, g.dy) < 6) return;
      g.movendo = true;
      no.classList.add("arrastando");
      no.style.transition = "none";
      no.style.transform = `translate(${g.dx}px, ${g.dy}px) rotate(${Math.max(-20, Math.min(20, g.dx * 0.05))}deg)`;
      pintar(g.dx, g.dy);
      e.preventDefault();
    });
    const fim = (e, cancelado) => {
      if (!g || e.pointerId !== g.id) return;
      const { dx, dy, w, h, pts, movendo } = g;
      g = null;
      if (!movendo) return;
      if (cancelado) { voltar(); return; }
      const p0 = pts[0], p1 = pts.at(-1), dt = Math.max(1, p1.t - p0.t);
      const vx = (p1.x - p0.x) / dt, vy = (p1.y - p0.y) / dt;  // px/ms nos últimos ~100 ms
      let d = null;
      if (-dy > Math.abs(dx) && (-dy >= h * 0.25 || (vy < -0.5 && -dy > 30 && Math.abs(vy) > Math.abs(vx)))) d = "super";
      else if (Math.abs(dx) >= w * 0.3 || (Math.abs(vx) > 0.5 && Math.abs(dx) > 30 && Math.abs(vx) > Math.abs(vy))) d = dx > 0 ? "gostei" : "descartado";
      no.classList.remove("arrastando");
      if (!d) { voltar(); return; }
      const prox = proximo();
      if (prox) { prox.style.transition = ""; prox.style.transform = ""; }
      agir(d, dx, dy);
    };
    no.addEventListener("pointerup", (e) => fim(e, false));
    no.addEventListener("pointercancel", (e) => fim(e, true));
    no.addEventListener("lostpointercapture", (e) => { if (g?.movendo) fim(e, false); else g = null; });
  }

  // ------------------------------------------------------------- fim do baralho

  function decididosHoje(lado, filtro = null) {
    const out = { super: [], gostei: [], descartado: [] };
    for (const [k, m] of Object.entries(D)) {
      const [data, l] = k.split("|");
      if (l !== lado) continue;
      for (const [tk, x] of Object.entries(m)) {
        if (!porTicker.has(tk) || hojeDe(tk) !== data || !out[x.d]) continue;
        if (filtro && !filtro.has(tk)) continue;
        out[x.d].push({ tk, x, k });
      }
    }
    for (const l of Object.values(out)) l.sort((p, q) => q.x.em.localeCompare(p.x.em));
    return out;
  }

  function renderFim() {
    const todos = filtrados(T.lado);
    const outro = T.lado === "compra" ? "venda" : "compra";
    const nOutro = baralho(outro).length;
    const feitos = decididosHoje(T.lado, new Set(todos.map((i) => i.ticker)));
    const nomeLado = T.lado === "compra" ? "compra" : "venda";
    const recomecar = () => {
      for (const { k, tk } of feitos.descartado) apagar(k, tk);
      gravarD();
      renderTudo();
    };
    $("tri-fim").replaceChildren(el("div", { class: "tri-fim-caixa painel" },
      el("div", { class: "tri-fim-icone", "aria-hidden": "true" }, todos.length ? "✓" : "∅"),
      el("h2", {}, todos.length
        ? `Você triou ${todos.length === 1 ? "o único ativo" : `os ${todos.length} ativos`} de ${nomeLado} de hoje`
        : `Nenhum ativo com sinal de ${nomeLado} no último pregão${T.mercado || T.so2 ? " com estes filtros" : ""}`),
      todos.length ? el("p", { class: "tri-fim-resumo" },
        el("span", { class: "r-super" }, `★ ${feitos.super.length} super`), " · ",
        el("span", { class: "r-gostei" }, `♥ ${feitos.gostei.length} gostei`), " · ",
        el("span", { class: "r-desc" }, `✗ ${feitos.descartado.length} descartados`)) : null,
      el("div", { class: "tri-fim-botoes" },
        todos.length ? el("button", { class: "botao primario", onclick: () => mudarVisao("hoje") }, "Ver o resultado") : null,
        el("button", { class: `botao ${outro}`, onclick: () => mudarLado(outro) },
          `Trocar para ${outro === "compra" ? "▲ Compra" : "▼ Venda"}${nOutro ? ` (${nOutro})` : ""}`),
        feitos.descartado.length ? el("button", { class: "botao", onclick: recomecar, title: "Os descartados de hoje voltam para o baralho" },
          `↺ Recomeçar os ${feitos.descartado.length} descartados`) : null)));
  }

  // ------------------------------------------------------------- resultado

  /** Quanto o preço andou desde a triagem, a favor ou contra o lado. */
  function desde(tk, x, lado) {
    const a = porTicker.get(tk);
    const agora = a && precoAtual(a).ultimo;
    if (!x.preco || !agora) return null;
    const v = (lado === "venda" ? -1 : 1) * (agora / x.preco - 1) * 100;
    if (Math.abs(v) < 0.005) return null;
    return el("span", { class: "tri-desde", title: `Preço na triagem ${fmtMoeda(x.preco, a.moeda)} → agora ${fmtMoeda(agora, a.moeda)}` },
      "desde a triagem ", el("b", { class: cor(v) }, `${fmtPct(v)} ${v >= 0 ? "a favor" : "contra"}`));
  }

  function ctxDe(tk, lado, x) {
    const a = porTicker.get(tk);
    return { ticker: tk, setup: x?.setups?.[0], tf: "D", data: hojeDe(tk) ?? a?.data, lado, preco: x?.preco ?? a?.ultimo };
  }

  function acao(tipo, tk) {
    if (window.Arrastar?.executar) { window.Arrastar.executar(tipo, tk); return; }
    if (tipo === "comparar") window.Comparar?.adicionar(tk);
    else if (tipo === "plano") window.Plano?.adicionar(ctxArrasto(tk));
    else if (tipo === "notas") window.Notas?.abrir(ctxArrasto(tk));
  }

  function itemResultado({ tk, x, k }, lado, comGrafico) {
    const a = porTicker.get(tk);
    const mover = (d) => { decidir(tk, lado, d, x); renderTudo(); };
    const devolver = () => {
      desfazer.push({ k, tk, lado, antes: x, d: x.d });
      apagar(k, tk);
      gravarD();
      voltaram = [tk, ...voltaram.filter((t) => t !== tk)];
      if (T.visao !== "baralho") mudarVisao("baralho"); else renderTudo();
    };
    const corpo = comGrafico ? el("div", { class: "tri-res-grafico" }) : null;
    const li = el("li", { class: `tri-res-item dec-${x.d}`, "data-tk": tk },
      el("div", { class: "tri-res-topo" },
        el("a", { class: "mono tri-res-ticker", href: `ativo.html#${encodeURIComponent(tk)}`, title: "Abrir a página do ativo" }, semSufixo(tk)),
        el("span", { class: "cartao-nome" }, a.nome), window.selosBandeja?.(tk),
        precoComFormacao(a, "tri-res-preco")),
      corpo,
      el("div", { class: "chips" }, chipsSetups(x.setups ?? [], lado)),
      desde(tk, x, lado),
      el("div", { class: "tri-res-acoes" },
        Object.entries(DEC).filter(([d]) => d !== x.d).map(([d, def]) =>
          el("button", { class: `tri-mini mover-${d}`, title: `Mover para ${def.nome}`, "aria-label": `Mover ${semSufixo(tk)} para ${def.nome}`, onclick: () => mover(d) }, def.icone)),
        x.d === "descartado" ? el("button", { class: "tri-mini", title: "Voltar para o baralho", onclick: devolver }, "↺ baralho") : null,
        el("span", { class: "tri-sep" }),
        el("button", { class: "tri-mini", title: "Comparar", onclick: () => acao("comparar", tk) }, "⇆"),
        window.Plano ? el("button", { class: "tri-mini", title: "Plano de amanhã", onclick: () => acao("plano", tk) }, "☰") : null,
        window.Notas ? el("button", { class: "tri-mini", title: "Anotar", onclick: () => acao("notas", tk) }, "✎") : null));
    if (corpo) {
      corpo.abrir = () => {
        const g = new Grafico(corpo, { mini: true });
        g.chart.applyOptions({ handleScroll: false, handleScale: false });
        g.sinais = (EV.get(tk) ?? []).filter((e) => e.tf === "D" && e.lado === lado).map(eventoParaGrafico);
        graficosRes.push(g);
        g.mostrar(a.arquivo, "D").then((ok) => {
          if (!ok || g.removido) return;
          g.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, g.n - BARRAS), to: g.n + 3 });
          g.destacar(k.split("|")[0]);
        }).catch(() => {});
      };
    }
    return li;
  }

  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) if (e.isIntersecting) { observador.unobserve(e.target); e.target.abrir?.(); }
  }, { rootMargin: "200px" });

  async function emLote(tipo, itens) {
    const tks = itens.map((x) => x.tk);
    if (!tks.length) { window.avisoRapido?.("Nenhum ativo em Super ou Gostei ainda."); return; }
    if (tipo === "comparar") {
      let n = 0;
      for (const tk of tks) { const r = Comparar.adicionar(tk); if (r === "ok") n++; if (r === "cheio") break; }
      const total = Comparar.itens().length;
      window.avisoRapido?.(`${n} ativo(s) na comparação (${total}/${Comparar.MAX})`, { rot: "Abrir", fazer: () => Comparar.abrir() });
    } else if (tipo === "plano" && window.Plano) {
      let n = 0;
      for (const { tk, x } of itens) { try { if (await Plano.adicionar(ctxDe(tk, T.lado, x))) n++; } catch (e) { console.warn(e); } }
      window.avisoRapido?.(`${n} ativo(s) no plano de amanhã`, { rot: "Abrir plano", fazer: () => Plano.abrir() });
    }
  }

  function renderResultado() {
    observador.disconnect();
    graficosRes.splice(0).forEach((g) => g.remover());
    const caixa = $("tri-resultado");
    const fimVisivel = T.visao === "baralho" && !baralho(T.lado).length && filtrados(T.lado).length > 0;
    caixa.hidden = !(T.visao === "hoje" || fimVisivel);
    if (caixa.hidden) { caixa.replaceChildren(); return; }
    const lado = T.lado;
    const hoje = decididosHoje(lado);
    const bons = [...hoje.super, ...hoje.gostei];
    const coluna = (d) => el("section", { class: `tri-coluna col-${d}` },
      el("h3", {}, el("span", { class: "tri-col-icone" }, DEC[d].icone), DEC[d].nome, el("span", { class: "contagem" }, hoje[d].length)),
      hoje[d].length ? el("ul", { class: "tri-res-lista" }, hoje[d].map((r) => itemResultado(r, lado, d !== "descartado")))
        : el("p", { class: "sub tri-col-vazia" }, d === "super" ? "Arraste para cima os que você amou." : d === "gostei" ? "Arraste para a direita os que você gostou." : "Os descartados voltam no próximo pregão."));
    const sessoes = [...new Set([...sessao.values()])].sort().reverse();
    caixa.replaceChildren(
      el("div", { class: "tri-res-cab" },
        el("div", {}, el("h2", {}, `Hoje · ${lado === "compra" ? "▲ Compra" : "▼ Venda"}`),
          el("p", { class: "sub" }, `Sessão de ${sessoes.map((d) => fmtData(d, true)).join(" / ")} · ${hoje.super.length + hoje.gostei.length + hoje.descartado.length} decididos`)),
        el("div", { class: "tri-res-lote" },
          el("button", { class: "botao", disabled: !bons.length, title: "Põe os Super e depois os Gostei na comparação, até 4",
            onclick: () => emLote("comparar", bons) }, "⇆ Super + Gostei → Comparar (até 4)"),
          window.Plano ? el("button", { class: "botao", disabled: !bons.length, onclick: () => emLote("plano", bons) }, "☰ → Plano de amanhã") : null)),
      el("div", { class: "tri-colunas" }, coluna("super"), coluna("gostei"), coluna("descartado")),
      diasAnteriores());
    caixa.querySelectorAll(".tri-res-grafico").forEach((n) => observador.observe(n));
  }

  /** Super e Gostei das sessões passadas, com o quanto o preço andou desde a triagem. */
  function diasAnteriores() {
    const porData = new Map();
    for (const [k, m] of Object.entries(D)) {
      const [data, lado] = k.split("|");
      for (const [tk, x] of Object.entries(m)) {
        if (!porTicker.has(tk) || x.d === "descartado" || data >= (hojeDe(tk) ?? "")) continue;
        if (!porData.has(data)) porData.set(data, []);
        porData.get(data).push({ tk, x, lado });
      }
    }
    const datas = [...porData.keys()].sort().reverse();
    return el("details", { class: "painel tri-anteriores" },
      el("summary", {}, el("h2", {}, "Dias anteriores"), el("span", { class: "sub" }, datas.length ? `${datas.length} sessão(ões) com Super ou Gostei` : "nada ainda")),
      datas.length ? datas.map((data) => {
        const itens = porData.get(data).sort((p, q) => (p.x.d === "super" ? 0 : 1) - (q.x.d === "super" ? 0 : 1) || p.tk.localeCompare(q.tk));
        return el("div", { class: "tri-dia" },
          el("h4", {}, fmtData(data, true), el("span", { class: "sub" }, ` · ★ ${itens.filter((i) => i.x.d === "super").length} · ♥ ${itens.filter((i) => i.x.d === "gostei").length}`)),
          el("ul", { class: "tri-dia-lista" }, itens.map(({ tk, x, lado }) => {
            const a = porTicker.get(tk);
            return el("li", {},
              el("span", { class: `tri-dia-dec dec-${x.d}`, title: DEC[x.d].nome }, DEC[x.d].icone),
              el("span", { class: lado === "compra" ? "alta" : "baixa", title: lado }, lado === "compra" ? "▲" : "▼"),
              el("a", { class: "mono", href: `ativo.html#${encodeURIComponent(tk)}` }, semSufixo(tk)),
              el("span", { class: "mono sub" }, `${fmtMoeda(x.preco, a.moeda)} → ${fmtMoeda(precoAtual(a).ultimo, a.moeda)}`),
              desde(tk, x, lado) ?? el("span", { class: "sub" }, "sem variação"),
              el("span", { class: "tri-dia-setups sub" }, (x.setups ?? []).map(nomeCurto).join(" · ")),
              el("span", { class: "tri-dia-acoes" },
                el("button", { class: "tri-mini", title: "Comparar", onclick: () => acao("comparar", tk) }, "⇆"),
                window.Plano ? el("button", { class: "tri-mini", title: "Plano de amanhã", onclick: () => acao("plano", tk) }, "☰") : null));
          })));
      }) : el("p", { class: "sub" }, "Os Super e Gostei de hoje aparecem aqui a partir do próximo pregão, com o quanto o preço andou desde a triagem."));
  }

  // ------------------------------------------------------------- barra e ciclo

  function renderBarra() {
    for (const lado of ["compra", "venda"]) $(`n-${lado}`).textContent = baralho(lado).length;
    document.querySelectorAll(".tri-lados button").forEach((b) => {
      b.classList.toggle("ativo", b.dataset.lado === T.lado);
      b.setAttribute("aria-selected", String(b.dataset.lado === T.lado));
    });
    document.querySelectorAll("#f-visao button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === T.visao));
    document.querySelectorAll("#f-mercado button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === T.mercado));
    const h = decididosHoje(T.lado);
    $("n-hoje").textContent = h.super.length + h.gostei.length + h.descartado.length;
    const todos = filtrados(T.lado), faltam = baralho(T.lado).length;
    $("tri-progresso").textContent = !todos.length ? "" : faltam ? `${todos.length - faltam + 1} de ${todos.length}` : `${todos.length} de ${todos.length} ✓`;
    $("f-so2").checked = T.so2;
    $("f-tendencia").checked = T.semTendencia;
    $("f-ordem").value = T.ordem;
    const n2 = ITENS[T.lado].filter((i) => conta(i) >= 2 && (!T.mercado || porTicker.get(i.ticker).mercado === T.mercado)).length;
    $("rot-so2").textContent = `Só com 2+ setups (${n2})`;
    $("tri-baralho").hidden = T.visao !== "baralho";
    document.body.dataset.lado = T.lado;
  }

  function renderTudo(entrada = null) {
    renderBarra();
    if (T.visao === "baralho") renderPilha(entrada);
    else { for (const c of cartoes.values()) soltarCartao(c); cartoes.clear(); }
    renderResultado();
    encaixar();
  }

  function mudarLado(lado) { T.lado = lado; salvarPrefs(); renderTudo(); }
  function mudarVisao(v) { T.visao = v; salvarPrefs(); renderTudo(); if (v === "hoje") scrollTo({ top: 0 }); }

  /** A pilha ocupa a altura que sobra na janela (no celular, a tela toda abaixo do topo). */
  function encaixar() {
    const pilha = $("tri-pilha");
    if (T.visao !== "baralho" || pilha.hidden) return;
    const resto = $("tri-botoes").offsetHeight + ($("tri-baralho").querySelector(".tri-dica").offsetHeight || 0) + 22 + 30;
    const topo = pilha.getBoundingClientRect().top + scrollY;
    const alt = Math.max(380, Math.min(innerHeight - topo - resto, 900));
    pilha.style.height = `${alt}px`;
  }
  addEventListener("resize", encaixar);

  document.addEventListener("keydown", (e) => {
    const foco = document.activeElement;
    if (!R || /SELECT|TEXTAREA/.test(foco?.tagName) || (foco?.tagName === "INPUT" && !["checkbox", "radio"].includes(foco.type))) return;
    if (document.querySelector('[aria-modal="true"]') || document.documentElement.classList.contains("comparar-aberto")) return;
    if ((e.key === "Backspace" && !e.altKey && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z")) {
      e.preventDefault();
      if (T.visao !== "baralho") mudarVisao("baralho");
      desfazerUltimo();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || T.visao !== "baralho") return;
    const d = { ArrowRight: "gostei", ArrowLeft: "descartado", ArrowUp: "super" }[e.key];
    if (!d) return;
    e.preventDefault();
    agir(d);
  });

  /** Para arrastar.js (⋯, Plano de amanhã, Notas): o ativo com o lado e os setups da triagem. */
  window.ctxArrasto = (tk) => {
    const i = ITENS[T.lado]?.find((x) => x.ticker === tk) ?? ITENS.compra.find((x) => x.ticker === tk) ?? ITENS.venda.find((x) => x.ticker === tk);
    const lado = i?.lado ?? T.lado;
    return ctxDe(tk, lado, decisao(tk, lado) ?? (i ? { setups: i.setups, preco: i.preco } : null));
  };

  async function iniciar() {
    try {
      [R] = await Promise.all([carregarRadar(), carregarCatalogoSetups().catch(() => null)]);
    } catch (e) { montarTopo("triagem"); return erroDados(e); }
    montarTopo("triagem", R);
    porTicker = new Map(R.ativos.map((a) => [a.ticker, a]));
    for (const e of R.sinais ?? []) {
      if (!porTicker.has(e.ticker)) continue;
      if (!EV.has(e.ticker)) EV.set(e.ticker, []);
      EV.get(e.ticker).push(e);
    }
    sessao = sinaisDoPeriodo({ ativos: R.ativos, sinais: R.sinais ?? [] }, "D", 1).ultima;
    if (!["compra", "venda"].includes(T.lado)) T.lado = "compra";
    if (!ORDENS[T.ordem]) T.ordem = "confluencia";
    if (!["baralho", "hoje"].includes(T.visao)) T.visao = "baralho";
    limparAntigas();
    montarItens();

    $("lugar-aviso").replaceWith(avisoFormacao(R));
    $("tri-sessoes").textContent = `Último pregão fechado: ${[...sessao].filter(([m]) => NOMES_MERCADO[m])
      .map(([m, d]) => `${NOMES_MERCADO[m]} ${fmtData(d, true)}`).join(" · ")}`;
    document.querySelector(".tri-lados").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) mudarLado(b.dataset.lado); });
    segmento("f-visao", ({ v }) => mudarVisao(v));
    segmento("f-mercado", ({ v }) => { T.mercado = v; salvarPrefs(); renderTudo(); });
    $("f-so2").addEventListener("change", (e) => { T.so2 = e.target.checked; salvarPrefs(); renderTudo(); });
    $("f-tendencia").addEventListener("change", (e) => { T.semTendencia = e.target.checked; salvarPrefs(); renderTudo(); });
    $("f-ordem").addEventListener("change", (e) => { T.ordem = e.target.value; salvarPrefs(); renderTudo(); });
    $("tri-filtros-abrir").addEventListener("click", (e) => {
      const aberto = $("tri-barra").classList.toggle("filtros-abertos");
      e.currentTarget.setAttribute("aria-expanded", String(aberto));
      encaixar();
    });
    $("tri-botoes").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.id === "tri-desfazer") desfazerUltimo(); else agir(b.dataset.d);
    });
    // outra aba triou: acompanha
    addEventListener("storage", (e) => { if (e.key === CHAVE) { D = guardar.ler(CHAVE, {}); renderTudo(); } });
    document.addEventListener("bandejas", () => { if (T.visao === "hoje") renderBarra(); });
    renderTudo();

    // o contexto (✓ a favor / ⚠ cuidado) depende do rastreador, que é maior: entra quando chegar
    carregarRastreador().then((f) => {
      F = f;
      for (const c of cartoes.values()) c.ctx.replaceChildren(...blocoContexto(c.i));
    }).catch(() => {});
  }

  window.Triagem = { get cartoes() { return cartoes; }, get decisoes() { return D; }, desfazer: desfazerUltimo, agir };
  iniciar();
})();
