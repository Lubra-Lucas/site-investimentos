/* Versão enxuta (app.html): as oportunidades de hoje como um baralho, uma carta por ativo, para quem
 * quer olhar rápido, de preferência no celular. Só o essencial: o ativo, o gráfico dos últimos meses,
 * quantas vezes o sinal deu certo naquele ativo e, em português simples, por que ele apareceu.
 *
 * Mesmos dados e mesmas regras do terminal completo:
 *  - sinais de entrada (sem o grupo Tendência e sem os neutros) do gráfico diário, no último pregão
 *    fechado de cada mercado (B3, EUA, Cripto), só de ativos líquidos;
 *  - histórico = backtest do mesmo setup no mesmo ativo (bt = [casos, acerto %, média %, vantagem %]),
 *    entrada na abertura seguinte e saída 10 pregões depois;
 *  - ordem = a do Top do dia: mínimo de 10 casos, média positiva, nota pelo limite inferior de Wilson
 *    (95%), desempate pela média. Quem não passa não entra no baralho (o fim do baralho diz quantos são).
 * Salvar também põe o ativo na "Minha lista" do terminal (localStorage "multitela"). */
(() => {
  "use strict";
  const CHAVE = "app-v1", INTRO = "app-intro-v1", MIN_CASOS = 10, PONTOS = 70, TOPO = 20;
  const MERCADOS = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto" };
  const $ = (id) => document.getElementById(id);
  const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Nome e explicação sem jargão de cada setup de entrada (o nome técnico fica no terminal completo). */
  const SIMPLES = {
    "pb-mme9": ["Pequena correção numa alta", "Vinha subindo, recuou até a média curta e fechou acima dela."],
    "pb-mm20": ["Correção numa alta", "Vinha subindo, recuou até a média de 20 dias e fechou acima dela."],
    "pb-mm50": ["Correção maior numa alta", "Recuou até a média de 50 dias, que está acima da de 200, e fechou acima dela."],
    "pb-mm200": ["Correção até a média longa", "Recuou até a média de 200 dias, que vem subindo, e fechou acima dela."],
    "pb-mme9-venda": ["Pequeno repique numa queda", "Vinha caindo, subiu até a média curta e fechou abaixo dela."],
    "pb-mm20-venda": ["Repique numa queda", "Vinha caindo, subiu até a média de 20 dias e fechou abaixo dela."],
    "pb-mm50-venda": ["Repique maior numa queda", "Subiu até a média de 50 dias, que está abaixo da de 200, e fechou abaixo dela."],
    "pb-mm200-venda": ["Repique até a média longa", "Subiu até a média de 200 dias, que vem caindo, e fechou abaixo dela."],
    "mtf-compra": ["Respiro numa alta", "Está em alta e teve uma queda curta e forte no prazo menor."],
    "mtf-venda": ["Esticada numa queda", "Está em queda e teve uma alta curta e forte no prazo menor."],
    "bb-inf": ["Caiu além do normal", "Fechou abaixo da faixa em que o preço costuma oscilar."],
    "bb-sup": ["Subiu além do normal", "Fechou acima da faixa em que o preço costuma oscilar."],
    "ifr-sv": ["Caiu muito em pouco tempo", "O medidor de força das quedas (IFR) passou do ponto de exagero."],
    "ifr-sc": ["Subiu muito em pouco tempo", "O medidor de força das altas (IFR) passou do ponto de exagero."],
    "ifr-estoc": ["Queda exagerada, dois sinais", "Dois medidores de exagero (IFR e estocástico) apontam queda forte."],
    "ifr2": ["Queda curta numa alta longa", "Caiu forte em poucos dias, mas segue acima da média de 200 dias."],
    "longe-baixo": ["Muito abaixo da média", "Está bem mais abaixo da média de 20 dias do que costuma ficar."],
    "longe-cima": ["Muito acima da média", "Está bem mais acima da média de 20 dias do que costuma ficar."],
    "maiores-quedas": ["Entre as maiores quedas", "Um dos ativos que mais caíram no último mês no seu mercado."],
    "maiores-altas": ["Entre as maiores altas", "Um dos ativos que mais subiram no último mês no seu mercado."],
    "boca-alta": ["Saiu da calmaria para cima", "Depois de dias andando de lado, disparou para cima."],
    "boca-baixa": ["Saiu da calmaria para baixo", "Depois de dias andando de lado, despencou."],
    "comprimida-alta": ["Calmaria dentro de uma alta", "Está em alta e oscilando pouco, como quem junta força."],
    "romp-max": ["Bateu a máxima do mês", "Fechou acima do maior preço dos últimos 20 pregões."],
    "romp-max-vol": ["Bateu a máxima com volume", "Fechou acima da máxima do mês, com volume bem acima do normal."],
    "perde-min": ["Perdeu a mínima do mês", "Fechou abaixo do menor preço dos últimos 20 pregões."],
    "max52": ["Perto da máxima do ano", "Está a menos de 3% do maior preço das últimas 52 semanas."],
    "cruzou-mm20": ["Voltou para cima da média", "Fechou acima da média de 20 dias depois de estar abaixo dela."],
    "golden": ["Virada de longo prazo", "A média de 50 dias cruzou para cima a de 200 dias."],
  };
  const nomeSimples = (id) => SIMPLES[id]?.[0] ?? NOMES.get(id) ?? id;

  // ------------------------------------------------------------- utilidades

  const guardar = {
    ler(k, p) { try { return JSON.parse(localStorage.getItem(k)) ?? p; } catch { return p; } },
    gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  function el(tag, attrs = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat(Infinity)) if (f != null && f !== false) n.append(f instanceof Node ? f : String(f));
    return n;
  }
  const num = (v, c = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
  const pct = (v, c = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, c)}%`);
  const casas = (v) => (Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6);
  const preco = (v, moeda) => `${{ BRL: "R$ ", USD: "US$ " }[moeda] ?? ""}${num(v, casas(v))}`;
  const dataCurta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  function wilson(ganhos, n, z = 1.96) {
    if (n <= 0) return 0;
    const p = ganhos / n, z2 = z * z;
    return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n) * 100);
  }
  const historico = (bt) => {
    if (!bt || bt[1] == null) return null;
    const [n, acerto, medio] = bt;
    return { n, ganhos: Math.round(acerto / 100 * n), acerto, medio: medio ?? 0 };
  };
  const precoAtual = (a) => (a.parcial ? { v: a.parcial.ultimo, var: a.parcial.var_pct } : { v: a.ultimo, var: a.var_dia_pct });
  function expandir(t) {
    if (!t || Array.isArray(t)) return t ?? [];
    const [A, B, C, D, E, P, I] = t.e;
    return A.map((a, k) => ({ ticker: t.tickers[a], setup: t.setups[B[k]], tf: t.tfs[C[k]], data: t.datas[D[k]],
      lado: t.lados[E[k]], preco: P[k], bt: I[k] >= 0 ? t.bt[I[k]] : null }));
  }
  const vibrar = () => navigator.vibrate?.(8);

  // ------------------------------------------------------------- estado

  const P = Object.assign({ lado: "compra", mercado: "" }, guardar.ler(CHAVE + "-prefs", {}));
  let E = guardar.ler(CHAVE, {});
  if (!E || typeof E !== "object") E = {};
  E.decisoes ??= {}; E.salvos ??= [];
  const gravarE = () => guardar.gravar(CHAVE, E) || aviso("Não deu para salvar neste navegador (armazenamento cheio ou bloqueado).");

  let R = null, NOMES = new Map(), porTicker = new Map(), sessao = {}, ITENS = { compra: [], venda: [] }, foraDoBaralho = { compra: 0, venda: 0 };
  let baralho = [], historicoAcoes = [], verTodos = false, restantes = 0;
  const velas = new Map();   // ticker -> Promise<[fechamentos]>

  const chaveDecisao = (i) => `${i.data}|${i.lado}|${i.ticker}`;

  // ------------------------------------------------------------- dados

  async function carregar() {
    const [radar, setups] = await Promise.all(["data/radar.json", "data/setups.json"].map((u) =>
      fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })));
    R = radar;
    R.sinais = expandir(R.sinais);
    const entrada = new Set();
    for (const g of setups.grupos ?? []) for (const s of g.itens ?? []) {
      NOMES.set(s.id, s.nome);
      if (g.nome !== "Tendência" && s.vies !== "neutro") entrada.add(s.id);
    }
    for (const a of R.ativos) porTicker.set(a.ticker, a);
    const ok = (e) => e.tf === "D" && entrada.has(e.setup) && (e.lado === "compra" || e.lado === "venda") &&
      MERCADOS[porTicker.get(e.ticker)?.mercado] && porTicker.get(e.ticker)?.liquido !== false;
    const sinais = R.sinais.filter(ok);
    for (const e of sinais) {
      const m = porTicker.get(e.ticker).mercado;
      if (!sessao[m] || e.data > sessao[m]) sessao[m] = e.data;
    }
    const mapa = { compra: new Map(), venda: new Map() };
    for (const e of sinais) {
      const a = porTicker.get(e.ticker);
      if (e.data !== sessao[a.mercado]) continue;
      let i = mapa[e.lado].get(e.ticker);
      if (!i) mapa[e.lado].set(e.ticker, (i = { ticker: e.ticker, lado: e.lado, data: e.data, eventos: [] }));
      if (!i.eventos.some((x) => x.setup === e.setup)) i.eventos.push(e);
    }
    for (const lado of ["compra", "venda"]) {
      const lista = [];
      let fora = 0;
      for (const i of mapa[lado].values()) {
        // o melhor setup do ativo pela regra do Top do dia; os outros viram "também hoje"
        let melhor = null;
        for (const e of i.eventos) {
          const h = historico(e.bt);
          if (!h || h.n < MIN_CASOS || h.medio <= 0) continue;
          const nota = wilson(h.ganhos, h.n);
          if (!melhor || nota > melhor.nota || (nota === melhor.nota && h.medio > melhor.h.medio)) melhor = { nota, h, e };
        }
        if (!melhor) { fora++; continue; }
        i.melhor = melhor;
        i.outros = i.eventos.filter((e) => e !== melhor.e)
          .map((e) => ({ e, h: historico(e.bt) }))
          .sort((x, y) => (y.h?.n >= MIN_CASOS) - (x.h?.n >= MIN_CASOS) || (y.h?.acerto ?? -1) - (x.h?.acerto ?? -1));
        lista.push(i);
      }
      lista.sort((x, y) => y.melhor.nota - x.melhor.nota || y.melhor.h.medio - x.melhor.h.medio || x.ticker.localeCompare(y.ticker));
      lista.forEach((i, k) => { i.rank = k + 1; });
      ITENS[lado] = lista;
      foraDoBaralho[lado] = fora;
    }
  }

  /** Fechamentos dos últimos PONTOS pregões (arquivo do ativo, baixado só para as cartas da vez). */
  function fechamentos(tk) {
    if (!velas.has(tk)) {
      const a = porTicker.get(tk);
      velas.set(tk, fetch(`data/ativos/${encodeURIComponent(a?.arquivo ?? tk)}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.c ?? []).slice(-PONTOS).map((v) => v[4]).filter((v) => v != null))
        .catch(() => []));
    }
    return velas.get(tk);
  }

  // ------------------------------------------------------------- baralho

  /** As TOPO melhores do dia (menos é mais); o resto só se a pessoa pedir no fim do baralho. */
  function montarBaralho() {
    const todas = ITENS[P.lado].filter((i) => !P.mercado || porTicker.get(i.ticker).mercado === P.mercado);
    const lista = verTodos ? todas : todas.slice(0, TOPO);
    restantes = todas.length - lista.length;
    baralho = lista.filter((i) => !E.decisoes[chaveDecisao(i)]);
    return lista.length;
  }

  function desenhar() {
    const total = montarBaralho();
    const palco = $("palco");
    palco.replaceChildren();
    $("acoes").hidden = !baralho.length;
    $("btn-voltar").disabled = !historicoAcoes.length;
    if (!baralho.length) return palco.append(fimDoBaralho(total));
    const vistos = total - baralho.length;
    palco.append(el("div", { class: "ap-progresso" },
      el("span", {}, `${vistos + 1} de ${total}`),
      el("div", { class: "ap-barra" }, el("i", { style: `width:${(vistos / total) * 100}%` }))));
    // até 3 cartas na pilha; só a de cima é interativa
    const pilha = el("div", { class: "ap-pilha" });
    baralho.slice(0, 3).reverse().forEach((i, k, arr) => {
      const topo = k === arr.length - 1;
      const c = carta(i, topo);
      c.style.setProperty("--fundo", String(arr.length - 1 - k));
      pilha.append(c);
      if (topo) arrastavel(c, i);
    });
    palco.append(pilha);
    $("btn-grafico").href = `ativo.html#${encodeURIComponent(baralho[0].ticker)}`;
    baralho.slice(1, 4).forEach((i) => fechamentos(i.ticker));   // pré-carrega as próximas
  }

  function carta(i, topo) {
    const a = porTicker.get(i.ticker), { h, e } = i.melhor, compra = i.lado === "compra";
    const p = precoAtual(a);
    const pontos = el("div", { class: "ap-pontos", "aria-hidden": "true" });
    if (h.n <= 40) for (let k = 0; k < h.n; k++) pontos.append(el("i", { class: k < h.ganhos ? "sim" : "nao" }));
    else pontos.append(el("div", { class: "ap-medidor" }, el("i", { style: `width:${h.acerto}%` })));
    const simples = SIMPLES[e.setup];
    const grafico = el("div", { class: "ap-grafico-mini" });
    const c = el("article", { class: `ap-carta ${compra ? "compra" : "venda"}`, "data-tk": i.ticker, "aria-hidden": topo ? null : "true" },
      el("div", { class: "ap-carta-topo" },
        el("span", { class: "ap-rank" }, `#${i.rank}`),
        el("span", { class: "ap-tag" }, `${compra ? "▲ Compra" : "▼ Venda"} · ${MERCADOS[a.mercado]} · sinal de ${dataCurta(i.data)}`)),
      el("div", { class: "ap-ativo" },
        el("div", {},
          el("h2", { class: "ap-ticker" }, a.rotulo ?? i.ticker),
          el("div", { class: "ap-nome" }, a.nome)),
        el("div", { class: "ap-preco" },
          el("b", {}, preco(p.v, a.moeda)),
          el("span", { class: p.var >= 0 ? "alta" : "baixa" }, `${pct(p.var, 2)} hoje`))),
      grafico,
      el("section", { class: "ap-stat" },
        el("div", { class: "ap-stat-num" }, el("b", {}, `${h.ganhos}`), el("span", {}, ` de ${h.n}`)),
        el("div", { class: "ap-stat-txt" },
          `vezes deu certo${compra ? "" : " (o preço caiu)"} quando este sinal apareceu em ${a.rotulo ?? i.ticker}`),
        pontos,
        el("div", { class: "ap-stat-media" },
          "Em média ", el("b", { class: h.medio >= 0 ? "alta" : "baixa" }, pct(h.medio)), compra ? " em 10 pregões" : " a favor em 10 pregões")),
      el("section", { class: "ap-porque" },
        el("h3", {}, simples?.[0] ?? nomeSimples(e.setup)),
        el("p", {}, simples?.[1] ?? "")),
      i.outros.length ? el("section", { class: "ap-outros" },
        el("h3", {}, `Também deu sinal hoje`),
        el("ul", {}, i.outros.slice(0, 3).map(({ e: o, h: ho }) => el("li", {},
          el("span", {}, nomeSimples(o.setup)),
          ho && ho.n >= MIN_CASOS ? el("b", { class: ho.acerto >= 50 ? "alta" : "baixa" }, `${ho.ganhos} de ${ho.n}`)
            : el("em", {}, "poucos casos"))))) : null,
      el("div", { class: "ap-carimbo pular" }, "PULAR"),
      el("div", { class: "ap-carimbo salvar" }, "SALVAR"));
    if (topo) fechamentos(i.ticker).then((v) => grafico.append(sparkline(v, compra)));
    return c;
  }

  function sparkline(v, compra) {
    if (!v || v.length < 2) return el("span", { class: "ap-sem-grafico" }, "");
    const W = 300, H = 72, lo = Math.min(...v), hi = Math.max(...v), d = hi - lo || 1;
    const xy = v.map((p, k) => [(k / (v.length - 1)) * W, H - 4 - ((p - lo) / d) * (H - 8)]);
    const linha = xy.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const subiu = v[v.length - 1] >= v[0];
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Preço nos últimos ${v.length} pregões: ${subiu ? "subiu" : "caiu"} ${num(Math.abs(v[v.length - 1] / v[0] - 1) * 100, 1)}%`);
    const area = document.createElementNS(ns, "path");
    area.setAttribute("d", `${linha}L${W},${H}L0,${H}Z`); area.setAttribute("class", `area ${subiu ? "alta" : "baixa"}`);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", linha); path.setAttribute("class", `linha ${subiu ? "alta" : "baixa"}`);
    const [ux, uy] = xy[xy.length - 1];
    const ponto = document.createElementNS(ns, "circle");
    ponto.setAttribute("cx", ux); ponto.setAttribute("cy", uy); ponto.setAttribute("r", 3.5); ponto.setAttribute("class", `ponto ${compra ? "alta" : "baixa"}`);
    svg.append(area, path, ponto);
    return el("div", { class: "ap-spark" }, svg, el("span", {}, `últimos ${v.length} pregões`));
  }

  function fimDoBaralho(total) {
    const fora = foraDoBaralho[P.lado];
    const nSalvos = E.salvos.length;
    const pulados = ITENS[P.lado].filter((i) => (!P.mercado || porTicker.get(i.ticker).mercado === P.mercado) &&
      E.decisoes[chaveDecisao(i)] === "pulou");
    return el("div", { class: "ap-fim" },
      el("div", { class: "ap-fim-icone" }, total ? "✓" : "☕"),
      el("h2", {}, total ? (restantes ? `Você viu as ${total} melhores de hoje` : "Você viu tudo de hoje")
        : `Nenhuma ${P.lado === "compra" ? "compra" : "venda"} com bom histórico hoje`),
      el("p", {}, total
        ? `${restantes ? "As de melhor histórico" : `Eram ${total}`} entre as ${P.lado === "compra" ? "compras" : "vendas"} com pelo menos ${MIN_CASOS} casos e média positiva.`
        : "Nem todo dia tem sinal com histórico bom. Esperar também é uma decisão."),
      fora ? el("p", { class: "ap-fim-sub" }, `Outros ${fora} ativos deram sinal, mas com pouco histórico ou média negativa. Eles estão no terminal completo.`) : null,
      el("div", { class: "ap-fim-botoes" },
        nSalvos ? el("button", { class: "primario", onclick: abrirSalvos }, `Ver salvos (${nSalvos})`) : null,
        restantes ? el("button", { onclick: () => { verTodos = true; desenhar(); } }, `Ver mais ${restantes}, com histórico menor`) : null,
        pulados.length ? el("button", { onclick: () => { pulados.forEach((i) => delete E.decisoes[chaveDecisao(i)]); gravarE(); desenhar(); } },
          `Rever os ${pulados.length} pulados`) : null,
        el("button", { onclick: () => trocarLado(P.lado === "compra" ? "venda" : "compra") }, `Ver ${P.lado === "compra" ? "vendas" : "compras"}`),
        el("a", { class: "botao", href: "setups.html" }, "Terminal completo")),
      el("a", { class: "ap-fim-canal", href: "https://t.me/canalterminalbot", target: "_blank", rel: "noopener" },
        "Receba o Top do dia no Telegram →"));
  }

  // ------------------------------------------------------------- decisões

  function decidir(d) {
    const i = baralho[0];
    if (!i) return;
    E.decisoes[chaveDecisao(i)] = d;
    historicoAcoes.push({ i, d });
    if (d === "salvou") {
      const a = porTicker.get(i.ticker), { h, e } = i.melhor;
      E.salvos = E.salvos.filter((s) => !(s.ticker === i.ticker && s.lado === i.lado && s.data === i.data));
      E.salvos.unshift({ ticker: i.ticker, lado: i.lado, data: i.data, setup: e.setup, ganhos: h.ganhos, n: h.n,
        medio: h.medio, preco: precoAtual(a).v, em: new Date().toISOString() });
      E.salvos = E.salvos.slice(0, 200);
      naMinhaLista(i.ticker);
    }
    // descartes antigos não precisam ficar guardados
    const datas = new Set(Object.values(sessao));
    for (const k of Object.keys(E.decisoes)) if (!datas.has(k.split("|")[0])) delete E.decisoes[k];
    gravarE();
    vibrar();
    contarSalvos();
    desenhar();
  }

  function voltar() {
    const u = historicoAcoes.pop();
    if (!u) return;
    delete E.decisoes[chaveDecisao(u.i)];
    if (u.d === "salvou") E.salvos = E.salvos.filter((s) => !(s.ticker === u.i.ticker && s.lado === u.i.lado && s.data === u.i.data));
    gravarE();
    contarSalvos();
    if (u.i.lado !== P.lado) trocarLado(u.i.lado); else desenhar();
  }

  /** Mesma lista ("multitela", rótulos separados por vírgula) que a estrela ☆ do terminal completo. */
  function naMinhaLista(tk) {
    const atual = guardar.ler("multitela", {});
    const obj = atual && typeof atual === "object" ? atual : {};
    const rot = (porTicker.get(tk)?.rotulo ?? tk).toUpperCase();
    const lista = String(obj.tickers ?? "").split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!lista.includes(rot)) guardar.gravar("multitela", { ...obj, tickers: [...lista, rot].join(", ") });
  }

  // ------------------------------------------------------------- arrastar

  function arrastavel(c, i) {
    let x0 = 0, y0 = 0, dx = 0, ativo = false, id = null, t0 = 0;
    const limite = () => Math.min(120, innerWidth * 0.28);
    c.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || ev.target.closest("a, button")) return;
      ativo = true; id = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; dx = 0; t0 = performance.now();
      c.setPointerCapture(id);
      c.classList.add("arrastando");
    });
    c.addEventListener("pointermove", (ev) => {
      if (!ativo || ev.pointerId !== id) return;
      dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.abs(dy) > Math.abs(dx) * 1.4 && Math.abs(dx) < 12) return;   // rolagem vertical
      c.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      c.style.setProperty("--salvar", String(Math.max(0, Math.min(1, dx / limite()))));
      c.style.setProperty("--pular", String(Math.max(0, Math.min(1, -dx / limite()))));
    });
    const soltar = (ev) => {
      if (!ativo || ev.pointerId !== id) return;
      ativo = false;
      c.classList.remove("arrastando");
      const rapido = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.6 && Math.abs(dx) > 40;
      if (Math.abs(dx) > limite() || rapido) jogar(c, dx > 0 ? "salvou" : "pulou");
      else { c.style.transform = ""; c.style.setProperty("--salvar", "0"); c.style.setProperty("--pular", "0"); }
    };
    c.addEventListener("pointerup", soltar);
    c.addEventListener("pointercancel", soltar);
  }

  function jogar(c, d) {
    if (!c || c.dataset.saindo) return;
    c.dataset.saindo = "1";
    if (reduzir) return decidir(d);
    c.style.setProperty(d === "salvou" ? "--salvar" : "--pular", "1");
    c.style.transition = "transform .28s ease-in, opacity .28s ease-in";
    c.style.transform = `translateX(${d === "salvou" ? "" : "-"}${innerWidth}px) rotate(${d === "salvou" ? 18 : -18}deg)`;
    c.style.opacity = "0";
    setTimeout(() => decidir(d), 240);
  }
  const cartaDoTopo = () => document.querySelector(".ap-pilha .ap-carta:last-child");

  // ------------------------------------------------------------- salvos

  function contarSalvos() { $("n-salvos").textContent = String(E.salvos.length); }

  function abrirSalvos() {
    const lista = $("lista-salvos");
    lista.replaceChildren();
    if (!E.salvos.length) lista.append(el("li", { class: "ap-vazio" }, "Nada salvo ainda. Arraste uma carta para a direita para salvar."));
    for (const s of E.salvos) {
      const a = porTicker.get(s.ticker);
      const agora = a ? precoAtual(a).v : null;
      let desde = agora && s.preco ? (agora / s.preco - 1) * 100 : null;
      if (desde != null && s.lado === "venda") desde = -desde;
      lista.append(el("li", {},
        el("a", { class: "ap-item", href: `ativo.html#${encodeURIComponent(s.ticker)}` },
          el("div", {},
            el("b", {}, a?.rotulo ?? s.ticker), " ",
            el("span", { class: `ap-lado ${s.lado}` }, s.lado === "compra" ? "▲ compra" : "▼ venda"),
            el("div", { class: "ap-item-sub" }, `${nomeSimples(s.setup)} · deu certo ${s.ganhos} de ${s.n}`)),
          el("div", { class: "ap-item-dir" },
            desde == null ? null : el("b", { class: desde >= 0 ? "alta" : "baixa" }, pct(desde)),
            el("div", { class: "ap-item-sub" }, `desde ${dataCurta(s.em?.slice(0, 10))}`))),
        el("button", { class: "ap-remover", "aria-label": `Remover ${a?.rotulo ?? s.ticker}`, onclick: () => {
          E.salvos = E.salvos.filter((x) => x !== s); gravarE(); contarSalvos(); abrirSalvos();
        } }, "✕")));
    }
    $("folha").hidden = false;
    $("folha").querySelector(".ap-fechar").focus();
  }
  const fecharSalvos = () => { $("folha").hidden = true; $("btn-salvos").focus(); };

  // ------------------------------------------------------------- controles

  function trocarLado(lado) {
    P.lado = lado; verTodos = false;
    guardar.gravar(CHAVE + "-prefs", P);
    document.querySelectorAll(".ap-lados button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.lado === lado)));
    document.body.dataset.lado = lado;
    desenhar();
  }
  function trocarMercado(m) {
    P.mercado = m; verTodos = false;
    guardar.gravar(CHAVE + "-prefs", P);
    document.querySelectorAll(".ap-mercados button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mercado === m)));
    desenhar();
  }

  let _aviso;
  function aviso(msg) {
    clearTimeout(_aviso);
    let t = document.querySelector(".ap-aviso");
    if (!t) document.body.append((t = el("div", { class: "ap-aviso", role: "status" })));
    t.textContent = msg; t.hidden = false;
    _aviso = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function intro() {
    if (guardar.ler(INTRO, false)) return;
    const caixa = $("intro"), passos = [...caixa.querySelectorAll(".ap-intro-passo")], pts = [...caixa.querySelectorAll(".ap-intro-pontos i")];
    let k = 0;
    const mostrar = () => {
      passos.forEach((p, j) => { p.hidden = j !== k; });
      pts.forEach((p, j) => p.classList.toggle("on", j === k));
      $("intro-btn").textContent = k === passos.length - 1 ? "Começar" : "Continuar";
    };
    $("intro-btn").addEventListener("click", () => {
      if (k < passos.length - 1) { k++; mostrar(); return; }
      caixa.hidden = true; guardar.gravar(INTRO, true);
    });
    mostrar();
    caixa.hidden = false;
    $("intro-btn").focus();
  }

  function ligar() {
    document.querySelectorAll(".ap-lados button").forEach((b) => b.addEventListener("click", () => trocarLado(b.dataset.lado)));
    document.querySelectorAll(".ap-mercados button").forEach((b) => b.addEventListener("click", () => trocarMercado(b.dataset.mercado)));
    $("btn-pular").addEventListener("click", () => jogar(cartaDoTopo(), "pulou"));
    $("btn-salvar").addEventListener("click", () => jogar(cartaDoTopo(), "salvou"));
    $("btn-voltar").addEventListener("click", voltar);
    $("btn-salvos").addEventListener("click", abrirSalvos);
    $("folha").addEventListener("click", (ev) => { if (ev.target.closest("[data-fechar]")) fecharSalvos(); });
    document.addEventListener("keydown", (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (!$("folha").hidden) { if (ev.key === "Escape") fecharSalvos(); return; }
      if (!$("intro").hidden || /input|select|textarea/i.test(ev.target.tagName)) return;
      if (ev.key === "ArrowLeft") { ev.preventDefault(); jogar(cartaDoTopo(), "pulou"); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); jogar(cartaDoTopo(), "salvou"); }
      else if (ev.key === "Backspace" || ev.key === "z") voltar();
    });
  }

  async function iniciar() {
    ligar();
    document.querySelectorAll(".ap-lados button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.lado === P.lado)));
    document.querySelectorAll(".ap-mercados button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mercado === P.mercado)));
    document.body.dataset.lado = P.lado;
    contarSalvos();
    intro();
    try {
      await carregar();
    } catch (e) {
      $("palco").replaceChildren(el("div", { class: "ap-fim" }, el("h2", {}, "Não consegui carregar os dados"),
        el("p", {}, "Confira a conexão e tente de novo."), el("button", { class: "primario", onclick: () => location.reload() }, "Tentar de novo")));
      return;
    }
    desenhar();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
