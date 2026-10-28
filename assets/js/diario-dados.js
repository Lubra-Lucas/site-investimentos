/* Diário de trading: dados, fotos e o editor do trade. Um trade é um registro de `Simulacoes`
 * (simulador.js) com campos opcionais de diário (docs/diario.md). As fotos ficam no IndexedDB "diario".
 * API global: window.Diario (trades, avaliar, avaliarTodos, registrar, abrir, fotografar, salvarFoto, fotos,
 * estatisticas...) e o evento "diario" a cada mudança (além de "simulacoes").
 * Depende de comum.js e simulador.js; usa eventos.js (nomes dos setups) e plano.js (níveis sugeridos,
 * foco preso e aviso rápido) quando a página os carrega. */

(() => {
  const FECHADOS = new Set(["alvo", "stop", "manual"]);
  const SEM_ESTRATEGIA = "Sem estratégia";
  const ETIQUETAS_SUGERIDAS = ["seguiu o plano", "FOMO", "entrou cedo", "saiu cedo", "moveu o stop"];
  const limpo = (l) => l.flat(Infinity).filter((x) => x != null && x !== false);
  const hoje = () => new Date().toLocaleDateString("sv-SE");
  const avisar = () => {
    document.dispatchEvent(new CustomEvent("simulacoes"));
    document.dispatchEvent(new CustomEvent("diario"));
  };
  const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const rotuloLado = (l) => (l === "venda" ? "▼ Venda" : "▲ Compra");
  // catálogo de setups: o do eventos.js se a página o carrega; senão, o próprio (data/setups.json)
  const proprio = new Map();
  const catalogo = () => (typeof SETUP_POR_ID !== "undefined" && SETUP_POR_ID.size ? SETUP_POR_ID : proprio);
  const carregarCatalogo = () => (typeof carregarCatalogoSetups === "function" ? carregarCatalogoSetups() : buscarJSON("data/setups.json").then((c) => {
    if (!proprio.size) for (const g of c.grupos ?? []) for (const x of g.itens ?? []) proprio.set(x.id, { ...x, grupo: g.nome });
    return c;
  })).catch(() => null);
  const nomeDoSetup = (id) => (id ? catalogo().get(id)?.nome ?? id : null);

  // ---------------------------------------------------------- avisos e foco (com alternativa sem plano.js)

  let toastLocal = null;
  function aviso(msg, acao) {
    if (window.avisoRapido) return window.avisoRapido(msg, acao);
    toastLocal?.remove();
    toastLocal = el("div", { class: "aviso-rapido", role: "status" }, el("span", {}, msg),
      acao ? el("button", { class: "botao-link", onclick: () => { toastLocal.remove(); acao.fazer(); } }, acao.rot) : null);
    document.body.append(toastLocal);
    setTimeout(() => toastLocal?.remove(), 4500);
  }

  const pilha = [];
  function prender(caixa, fechar) {
    if (window.prenderFoco) return window.prenderFoco(caixa, fechar);
    const anterior = document.activeElement;
    const tecla = (e) => {
      if (pilha.at(-1) !== caixa) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); return; }
      if (e.key !== "Tab") return;
      const f = [...caixa.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      if (!caixa.contains(document.activeElement) || (e.shiftKey && document.activeElement === f[0])) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    };
    pilha.push(caixa);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      pilha.splice(pilha.indexOf(caixa), 1);
      if (anterior?.isConnected) anterior.focus?.();
    };
  }

  // ---------------------------------------------------------- IndexedDB (fotos), com alternativa em memória

  const memoria = new Map();  // se o IndexedDB não existir (navegação privada, bloqueio): as fotos valem só nesta sessão
  const urls = new Map();
  let dbp = null, avisouMemoria = false;
  function semBanco() {
    if (avisouMemoria) return;
    avisouMemoria = true;
    aviso("Este navegador não deixa guardar fotos: elas valem só até fechar a página. O resto do diário funciona normal.");
  }
  function abrirBanco() {
    dbp ??= new Promise((ok) => {
      try {
        if (!window.indexedDB) return ok(null);
        const rq = indexedDB.open("diario", 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore("fotos", { keyPath: "id" }).createIndex("trade", "trade");
        rq.onsuccess = () => ok(rq.result);
        rq.onerror = rq.onblocked = () => ok(null);
      } catch { ok(null); }
    });
    return dbp;
  }
  const promessa = (r) => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });

  async function fotoGravar(rec) {
    const db = await abrirBanco();
    if (db) {
      try {
        const tx = db.transaction("fotos", "readwrite");
        tx.objectStore("fotos").put(rec);
        await new Promise((ok, err) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => err(tx.error); });
        return;
      } catch { /* cota cheia: cai na memória */ }
    }
    semBanco();
    memoria.set(rec.id, rec);
  }
  async function fotoLer(id) {
    if (memoria.has(id)) return memoria.get(id);
    const db = await abrirBanco();
    if (!db) return null;
    try { return (await promessa(db.transaction("fotos").objectStore("fotos").get(id))) ?? null; } catch { return null; }
  }
  async function fotoApagar(id) {
    memoria.delete(id);
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    const db = await abrirBanco();
    if (db) try { db.transaction("fotos", "readwrite").objectStore("fotos").delete(id); } catch {}
  }
  const urlDa = (rec) => {
    if (!urls.has(rec.id)) urls.set(rec.id, URL.createObjectURL(rec.blob));
    return urls.get(rec.id);
  };

  // ---------------------------------------------------------- dados do ativo e candles

  let RAD = null, porTk = new Map();
  async function ativoDe(tk) {
    if (!RAD) {
      RAD = await carregarRadar();
      porTk = new Map(RAD.ativos.map((a) => [a.ticker, a]));
    }
    return porTk.get(tk) ?? null;
  }
  const candlesDe = async (t) => carregarCandles((await ativoDe(t.ticker))?.arquivo ?? t.ticker);

  const trades = () => Simulacoes.todas();
  const trade = (id) => Simulacoes.todas().find((t) => t.id === id) ?? null;

  /** Reavalia o trade com os candles diários (honra a saída manual). Acrescenta `fechado`, `dias` e `ultima`. */
  async function avaliar(t) {
    let d;
    try { d = await candlesDe(t); } catch { d = null; }
    if (!d?.candles?.length) return { estado: "sem_dados", fechado: false };
    const av = avaliarSimulacao(t, d.candles);
    av.fechado = FECHADOS.has(av.estado);
    if (av.entrou && av.saiu) av.dias = Math.max(0, diasEntre(av.entrou, av.saiu));
    const u = d.candles.at(-1);
    av.ultima = { data: u.time, preco: u.close };
    return av;
  }

  /** Todos os trades já avaliados: [{...trade, av}]. */
  async function avaliarTodos(lista = trades()) {
    return Promise.all(lista.map(async (t) => ({ ...t, av: await avaliar(t).catch(() => ({ estado: "sem_dados", fechado: false })) })));
  }

  function gravar(id, patch) {
    const t = trade(id);
    if (!t) return null;
    const novo = { ...t, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete novo[k];
    Simulacoes.salvar(novo);
    avisar();
    return novo;
  }

  const estrategias = () => [...new Set(trades().map((t) => t.estrategia).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const etiquetasUsadas = () => [...new Set([...ETIQUETAS_SUGERIDAS, ...trades().flatMap((t) => t.etiquetas ?? [])])];

  /** Preenche os campos de diário de um trade novo: setup, tf, estratégia (padrão = nome do setup) e origem. */
  function preencher(t, ctx = {}) {
    if (ctx.setup) t.setup = ctx.setup;
    t.tf = ctx.tf === "W" ? "W" : ctx.tf === "D" ? "D" : (t.tf ?? "D");
    t.estrategia = ctx.estrategia || t.estrategia || (ctx.setup && nomeDoSetup(ctx.setup)) || SEM_ESTRATEGIA;
    t.origem = ctx.origem ?? t.origem ?? "manual";
    t.fotos ??= [];
    return t;
  }

  // ---------------------------------------------------------- fotos

  const paraBlob = (canvas, tipo = "image/jpeg", q = 0.85) => new Promise((ok) => canvas.toBlob(ok, tipo, q));

  /** Foto do gráfico (Lightweight Charts). Com `linhas`, desenha entrada/stop/alvo do trade só durante a captura. */
  async function capturar(g, t, { linhas = true } = {}) {
    const tmp = [];
    // espera o gráfico assentar (logo depois de salvar, a captura síncrona travava a página)
    await new Promise((ok) => setTimeout(ok, 150));
    try {
      if (linhas && t) {
        for (const [campo, cor, rot] of [["alvo", "#26c281", "Alvo"], ["entrada", "#d7dde6", "Entrada"], ["stop", "#f0506e", "Stop"]]) {
          tmp.push(g.candles.createPriceLine({ price: t[campo], color: cor, lineWidth: 2, axisLabelVisible: true, title: rot }));
        }
      }
      return await paraBlob(g.chart.takeScreenshot());
    } finally {
      for (const l of tmp) g.candles.removePriceLine(l);
    }
  }

  /** Reduz uma imagem anexada (maior lado 1600 px, JPEG). */
  async function reduzir(arquivo, max = 1600) {
    try {
      const bmp = await createImageBitmap(arquivo);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return (await paraBlob(c)) ?? arquivo;
    } catch { return arquivo; }
  }

  const novoIdFoto = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** Guarda a foto no IndexedDB e a liga ao trade. tipo: "entrada" | "saida" | "outra". Devolve o id. */
  async function salvarFoto(tradeId, blob, tipo = "outra", extra = {}) {
    const id = extra.id ?? novoIdFoto();
    await fotoGravar({ id, trade: tradeId, tipo, blob, criada: extra.criada ?? new Date().toISOString() });
    const t = trade(tradeId);
    if (t) gravar(tradeId, { fotos: [...new Set([...(t.fotos ?? []), id])] });
    return id;
  }

  /** Fotos do trade, na ordem em que foram adicionadas: [{id, url, tipo, criada}]. */
  async function fotos(tradeId) {
    const t = trade(tradeId);
    const recs = await Promise.all((t?.fotos ?? []).map(fotoLer));
    return recs.filter(Boolean).map((r) => ({ id: r.id, url: urlDa(r), tipo: r.tipo, criada: r.criada, blob: r.blob }));
  }

  async function removerFoto(tradeId, fotoId) {
    const t = trade(tradeId);
    if (t) gravar(tradeId, { fotos: (t.fotos ?? []).filter((f) => f !== fotoId) });
    await fotoApagar(fotoId);
  }

  /** Fotografa o gráfico e guarda no trade (usado ao salvar a simulação no gráfico). */
  async function fotografar(tradeId, grafico, tipo = "entrada", opcoes = {}) {
    const t = trade(tradeId);
    if (!t || !grafico?.chart?.takeScreenshot) return null;
    const blob = await capturar(grafico, t, opcoes);
    return blob ? salvarFoto(tradeId, blob, tipo) : null;
  }

  // ---------------------------------------------------------- criar o trade

  /** Contexto {ticker, lado?, setup?, tf?, data?, preco?, entrada?, stop?, alvo?, origem?} -> trade salvo (e editor aberto). */
  async function registrar(ctx = {}, { grafico = null, abrirEditor = true } = {}) {
    const a = await ativoDe(ctx.ticker);
    if (!a) { aviso(`Não encontrei ${ctx.ticker ?? "o ativo"} nos dados publicados.`); return null; }
    if (ctx.setup) await carregarCatalogo();
    const preco = ctx.preco ?? a.ultimo;
    let niv = { lado: ctx.lado === "venda" ? "venda" : "compra", entrada: ctx.entrada, stop: ctx.stop, alvo: ctx.alvo };
    if (!(ctx.entrada && ctx.stop && ctx.alvo)) {
      const sug = window.Plano?.sugerir ? await window.Plano.sugerir(a, ctx.lado, false).catch(() => null) : null;
      if (sug) niv = { ...sug, ...Object.fromEntries(["entrada", "stop", "alvo"].filter((k) => ctx[k]).map((k) => [k, ctx[k]])) };
      else {
        const s = niv.lado === "compra" ? 1 : -1;
        niv = { lado: niv.lado, entrada: ctx.entrada ?? preco, stop: ctx.stop ?? preco * (1 - s * 0.05), alvo: ctx.alvo ?? preco * (1 + s * 0.1) };
      }
    }
    // com um lado pedido que a sugestão não seguiu, vale o pedido
    const lado = ctx.lado === "venda" || ctx.lado === "compra" ? ctx.lado : niv.lado;
    let id = `${Date.now()}`;
    while (trade(id)) id = `${+id + 1}`;
    const t = preencher({
      id, ticker: a.ticker, mercado: a.mercado, moeda: a.moeda, lado,
      entrada: niv.entrada, stop: niv.stop, alvo: niv.alvo,
      capital: capitalPadrao(a, niv.entrada),
      criada: ctx.data ?? a.data, preco_criacao: preco,
    }, { setup: ctx.setup, tf: ctx.tf, estrategia: ctx.estrategia, origem: ctx.origem ?? "manual" });
    Simulacoes.salvar(t);
    avisar();
    // a foto da entrada sai do gráfico do editor (com entrada, stop e alvo desenhados); sem editor, do gráfico da página
    if (abrirEditor) abrir(t.id, { grafico, fotoEntrada: true });
    else if (grafico) await fotografar(t.id, grafico, "entrada").catch(() => {});
    return trade(t.id) ?? t;
  }

  // ---------------------------------------------------------- estatísticas

  const porSaida = (x, y) => x.av.saiu.localeCompare(y.av.saiu) || x.id.localeCompare(y.id);

  function calcular(lista) {
    const rs = lista.map((t) => t.av.resultado_r);
    const ganhos = rs.filter((r) => r > 0), perdas = rs.filter((r) => r < 0);
    const soma = (v) => v.reduce((s, x) => s + x, 0);
    let acum = 0, pico = 0, dd = 0, seq = 0, maiorSeq = 0;
    for (const r of rs) {
      acum += r;
      pico = Math.max(pico, acum);
      dd = Math.max(dd, pico - acum);
      seq = r < 0 ? seq + 1 : 0;
      maiorSeq = Math.max(maiorSeq, seq);
    }
    const dur = lista.map((t) => t.av.dias).filter((d) => d != null);
    const n = lista.length;
    return {
      trades: n, acertos: ganhos.length, erros: perdas.length, neutros: n - ganhos.length - perdas.length,
      pct_acerto: n ? (ganhos.length / n) * 100 : null,
      r_total: soma(rs), r_medio: n ? soma(rs) / n : null,
      ganho_medio: ganhos.length ? soma(ganhos) / ganhos.length : null,
      perda_media: perdas.length ? soma(perdas) / perdas.length : null,
      fator_lucro: perdas.length ? soma(ganhos) / -soma(perdas) : ganhos.length ? Infinity : null,
      maior_seq_perdas: maiorSeq, drawdown_r: dd,
      duracao_media: dur.length ? soma(dur) / dur.length : null,
      melhor: n ? Math.max(...rs) : null, pior: n ? Math.min(...rs) : null,
    };
  }

  /**
   * Estatísticas dos trades já avaliados (`avaliarTodos`). Só entram os encerrados (alvo, stop, saída manual).
   * filtro: { por: "estrategia" | "setup", estrategia?, setup?, mercado?, lado?, desde?, ate? } (datas = data da saída).
   * Devolve { total, grupos: [{chave, rotulo, ...métricas, curva}], curva } com a curva de R acumulado.
   */
  function estatisticas(avaliados, filtro = {}) {
    const { por = "estrategia", desde, ate } = filtro;
    const chaveDe = (t) => (por === "setup" ? t.setup ?? "" : t.estrategia || SEM_ESTRATEGIA);
    const fechados = avaliados
      .filter((t) => t.av?.fechado && t.av.resultado_r != null
        && (!desde || t.av.saiu >= desde) && (!ate || t.av.saiu <= ate)
        && (filtro.estrategia == null || (t.estrategia || SEM_ESTRATEGIA) === filtro.estrategia)
        && (filtro.setup == null || (t.setup ?? "") === filtro.setup)
        && (!filtro.mercado || t.mercado === filtro.mercado)
        && (!filtro.lado || t.lado === filtro.lado))
      .sort(porSaida);
    const curvaDe = (lista) => {
      let acum = 0;
      return lista.map((t) => ({ id: t.id, data: t.av.saiu, r: t.av.resultado_r, acumulado: (acum += t.av.resultado_r) }));
    };
    const mapa = new Map();
    for (const t of fechados) {
      const k = chaveDe(t);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(t);
    }
    const grupos = [...mapa].map(([chave, lista]) => ({
      chave, rotulo: por === "setup" ? (chave ? nomeDoSetup(chave) : "Sem setup") : chave,
      ...calcular(lista), curva: curvaDe(lista),
    })).sort((x, y) => y.r_total - x.r_total || x.rotulo.localeCompare(y.rotulo, "pt-BR"));
    return { total: calcular(fechados), grupos, curva: curvaDe(fechados) };
  }

  // ---------------------------------------------------------- excluir com desfazer

  function excluir(id) {
    const copia = trade(id);
    if (!copia) return;
    Simulacoes.remover(id);
    avisar();
    let desfeito = false;
    aviso(`Trade de ${semSufixo(copia.ticker)} excluído.`, {
      rot: "Desfazer",
      fazer: () => { desfeito = true; Simulacoes.salvar(copia); avisar(); },
    });
    // as fotos só somem depois do tempo de desfazer
    setTimeout(() => { if (!desfeito && !trade(id)) (copia.fotos ?? []).forEach(fotoApagar); }, 5200);
  }

  // ---------------------------------------------------------- editor (modal)

  let ed = null;

  function fecharEditor() {
    if (!ed) return;
    const e = ed;
    e.vaiFechar = true;
    e.descarregar?.();
    e.soltar?.();
    document.body.classList.remove("dr-travado");
    ed = null;
    // trade novo sem foto: a foto da entrada sai com os níveis onde a pessoa deixou. O editor some na hora, mas o
    // gráfico só sai depois da captura (uma captura síncrona logo depois de gravar travava a página)
    const t = trade(e.id);
    if (e.fotoEntrada && t && !(t.fotos ?? []).length && e.g?.chart && !e.g.removido) {
      Object.assign(e.fundo.style, { visibility: "hidden", pointerEvents: "none" });
      capturar(e.g, t, { linhas: false })
        .then((b) => (b && trade(e.id) ? salvarFoto(e.id, b, "entrada") : null)).catch(() => {})
        .finally(() => { e.g.remover(); e.fundo.remove(); });
      return;
    }
    e.g?.remover();
    e.fundo.remove();
  }

  const chipEstado = (av) => {
    const st = ESTADO_SIM[av?.estado] ?? { rot: "…", cls: "" };
    return el("span", { class: `dr-chip estado ${st.cls}` }, st.rot);
  };

  /**
   * Abre o editor/detalhe do trade (em qualquer página). opcoes.grafico: o Grafico da página, para
   * "Capturar gráfico agora" (só quando está no mesmo ativo).
   */
  async function abrir(id, opcoes = {}) {
    const t0 = trade(id);
    if (!t0) { aviso("Não encontrei esse trade."); return; }
    fecharEditor();
    await carregarCatalogo();
    const a = await ativoDe(t0.ticker);
    if (ed) return;  // outro pedido abriu antes

    const cur = () => trade(id);
    const sid = (s) => `dr-${s}`;
    const e = { id, av: null, fundo: null, g: null, sim: null, pend: {}, timer: 0, marcas: null, inputs: {},
      fotoEntrada: !!opcoes.fotoEntrada, ultimoValido: null };
    ed = e;
    const moeda = a?.moeda ?? t0.moeda;
    const casas = (v) => casasPreco(v || 1, moeda);

    // ---- cabeçalho
    const tituloEl = el("h2", { id: sid("titulo") });
    const chipsEl = el("div", { class: "dr-chips" });
    const resultadoEl = el("div", { class: "dr-resultado" });
    const datasEl = el("p", { class: "sub dr-datas" });
    const salvoEl = el("span", { class: "dr-salvo sub", role: "status" }, "");
    const fechar = el("button", { class: "fechar", "aria-label": "Fechar editor", onclick: () => fecharEditor() }, "×");

    // ---- gráfico
    const corpoGraf = el("div", { class: "dr-grafico", role: "img", "aria-label": `Gráfico de ${semSufixo(t0.ticker)} com entrada, stop e alvo` });
    const resumoEl = el("p", { class: "sub dr-resumo-niveis" });

    // ---- fotos
    const galeria = el("div", { class: "dr-galeria" });
    const tipoFoto = el("select", { id: sid("tipo-foto"), "aria-label": "Tipo da próxima foto" },
      [["entrada", "Entrada"], ["saida", "Saída"], ["outra", "Outra"]].map(([v, r]) => el("option", { value: v }, r)));
    const arquivoEl = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: async (ev) => {
      for (const f of ev.target.files) await adicionarImagem(f);
      ev.target.value = "";
    } });
    const botaoCapturar = el("button", { class: "botao", type: "button", title: "Tira uma foto do gráfico desta página, com entrada, stop e alvo",
      onclick: async () => {
        try {
          const blob = await capturar(opcoes.grafico, cur());
          if (blob) { await salvarFoto(id, blob, tipoFoto.value); aviso("Foto do gráfico guardada."); }
        } catch { aviso("Não consegui capturar o gráfico."); }
        await vistaFotos();
      } }, "Capturar gráfico");
    async function adicionarImagem(arq) {
      if (!arq?.type?.startsWith("image/")) { aviso("Só imagens (PNG, JPG...)."); return; }
      await salvarFoto(id, await reduzir(arq), tipoFoto.value);
      await vistaFotos();
    }

    // ---- campos
    const campoTexto = (rot, chave, ajuda, linhas = 3) => {
      const ta = el("textarea", { id: sid(chave), rows: linhas, placeholder: ajuda, "aria-label": rot });
      ta.value = t0[chave] ?? "";
      ta.addEventListener("input", () => agendar(chave, ta.value));
      ta.addEventListener("blur", () => descarregar());
      return el("div", { class: "dr-campo" }, el("label", { for: sid(chave) }, rot), ta);
    };
    const datalist = el("datalist", { id: sid("estrategias") }, [...new Set([...estrategias(),
      ...[...catalogo().values()].map((s) => s.nome)])].map((n) => el("option", { value: n })));
    const inpEstrategia = el("input", { id: sid("estrategia"), type: "text", list: sid("estrategias"), maxlength: 80, autocomplete: "off",
      placeholder: "Ex.: Pullback na MME 9" });
    inpEstrategia.value = t0.estrategia ?? "";
    inpEstrategia.addEventListener("change", () => gravarCampo({ estrategia: inpEstrategia.value.trim() || SEM_ESTRATEGIA }));
    const selSetup = el("select", { id: sid("setup") }, el("option", { value: "" }, "— nenhum —"),
      (() => {
        const grupos = new Map();
        for (const s of catalogo().values()) {
          if (!grupos.has(s.grupo)) grupos.set(s.grupo, []);
          grupos.get(s.grupo).push(s);
        }
        const ops = [...grupos].map(([g, l]) => el("optgroup", { label: g }, l.map((s) => el("option", { value: s.id }, s.nome))));
        // setup que não está no catálogo (ex.: removido): continua selecionável
        if (t0.setup && !catalogo().has(t0.setup)) ops.push(el("option", { value: t0.setup }, t0.setup));
        return ops;
      })());
    selSetup.value = t0.setup ?? "";
    selSetup.addEventListener("change", () => gravarCampo({ setup: selSetup.value || undefined }));

    // nota (estrelas)
    const estrelas = el("div", { class: "dr-estrelas", role: "radiogroup", "aria-label": "Nota da execução, de 1 a 5" });
    const vistaEstrelas = () => {
      const n = cur()?.nota ?? 0;
      estrelas.replaceChildren(...[1, 2, 3, 4, 5].map((i) => el("button", {
        type: "button", role: "radio", "aria-checked": String(n === i), "aria-label": `${i} ${i === 1 ? "estrela" : "estrelas"}`,
        class: i <= n ? "on" : "", tabindex: n === i || (!n && i === 1) ? "0" : "-1",
        onclick: () => { gravarCampo({ nota: n === i ? undefined : i }); vistaEstrelas(); },
        onkeydown: (ev) => {
          const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[ev.key];
          if (!d) return;
          ev.preventDefault();
          const novo = Math.min(5, Math.max(1, i + d));
          gravarCampo({ nota: novo });
          vistaEstrelas();
          estrelas.children[novo - 1].focus();
        },
      }, i <= n ? "★" : "☆")));
    };

    // etiquetas
    const tagsEl = el("div", { class: "dr-tags" });
    const sugEl = el("div", { class: "dr-tags sugestoes" });
    const tagList = el("datalist", { id: sid("etiquetas") }, etiquetasUsadas().map((n) => el("option", { value: n })));
    const inpTag = el("input", { id: sid("tag"), type: "text", list: sid("etiquetas"), maxlength: 40, autocomplete: "off", placeholder: "Nova etiqueta" });
    const addTag = (txt) => {
      const v = txt.trim().replace(/,$/, "").trim();
      if (!v) return;
      const atuais = cur()?.etiquetas ?? [];
      if (atuais.some((x) => x.toLowerCase() === v.toLowerCase())) return;
      gravarCampo({ etiquetas: [...atuais, v] });
      vistaTags();
    };
    inpTag.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); addTag(inpTag.value); inpTag.value = ""; }
    });
    inpTag.addEventListener("change", () => { addTag(inpTag.value); inpTag.value = ""; });
    function vistaTags() {
      const atuais = cur()?.etiquetas ?? [];
      tagsEl.replaceChildren(...atuais.map((x) => el("span", { class: "dr-tag" }, x,
        el("button", { type: "button", "aria-label": `Remover a etiqueta ${x}`, onclick: () => {
          gravarCampo({ etiquetas: atuais.filter((y) => y !== x) });
          vistaTags();
        } }, "×"))));
      sugEl.replaceChildren(...ETIQUETAS_SUGERIDAS.filter((x) => !atuais.includes(x)).map((x) =>
        el("button", { type: "button", class: "dr-tag sug", onclick: () => addTag(x) }, `+ ${x}`)));
    }

    // níveis
    const msgNiveis = el("p", { class: "dr-erro", role: "alert", hidden: true });
    const nivel = (rot, chave, passo) => {
      const inp = el("input", { id: sid(`n-${chave}`), type: "number", step: passo, min: "0", inputmode: "decimal" });
      inp.value = (+t0[chave]).toFixed(chave === "capital" ? 0 : casas(t0.entrada));
      inp.addEventListener("change", () => {
        const v = parseFloat(inp.value);
        const t = cur();
        const prop = { ...t, [chave]: v };
        if (!(v > 0)) { inp.value = t[chave]; return; }
        if (chave !== "capital" && !contasSimulacao(prop).valido) {
          msgNiveis.textContent = t.lado === "compra"
            ? "Na compra, o stop fica abaixo da entrada e o alvo acima." : "Na venda, o stop fica acima da entrada e o alvo abaixo.";
          msgNiveis.hidden = false;
          inp.setAttribute("aria-invalid", "true");
          return;
        }
        msgNiveis.hidden = true;
        for (const x of e.fundo.querySelectorAll("[data-nivel]")) x.removeAttribute("aria-invalid");
        gravarCampo({ [chave]: v });
      });
      inp.dataset.nivel = chave;
      e.inputs[chave] = inp;
      return el("div", { class: "dr-campo" }, el("label", { for: inp.id }, rot), inp);
    };

    // saída manual
    const saidaEl = el("div", { class: "dr-saida" });
    function vistaSaida() {
      if (saidaEl.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
      const t = cur(), av = e.av;
      const m = t.saida_manual;
      // só refaz se algo mudou (um redesenho no meio de um clique o perderia)
      const assin = JSON.stringify([m, av?.estado, av?.saiu, av?.ultima, t.criada]);
      if (assin === e.assinSaida) return;
      e.assinSaida = assin;
      const ult = av?.ultima;
      const data = el("input", { id: sid("s-data"), type: "date", min: t.criada });
      const preco = el("input", { id: sid("s-preco"), type: "number", step: (1 / 10 ** casas(t.entrada)).toString(), min: "0", inputmode: "decimal" });
      data.value = m?.data ?? ult?.data ?? hoje();
      preco.value = m ? m.preco : ult ? (+ult.preco).toFixed(casas(ult.preco)) : "";
      const aplicar = () => {
        const p = parseFloat(preco.value);
        if (!data.value || !(p > 0)) { aviso("Informe a data e o preço da saída."); return; }
        if (data.value < t.criada) { aviso("A saída não pode ser antes da criação do trade."); return; }
        gravarCampo({ saida_manual: { data: data.value, preco: p } });
      };
      const nota = av && (av.estado === "alvo" || av.estado === "stop") && !m
        ? el("p", { class: "sub" }, `Este trade já bateu no ${av.estado === "alvo" ? "alvo" : "stop"} em ${fmtData(av.saiu)}. Uma saída manual só vale se for antes.`) : null;
      saidaEl.replaceChildren(...limpo([
        el("div", { class: "dr-linha" },
          el("div", { class: "dr-campo" }, el("label", { for: data.id }, "Data da saída"), data),
          el("div", { class: "dr-campo" }, el("label", { for: preco.id }, `Preço de saída (${moeda === "USD" ? "US$" : "R$"})`), preco)),
        el("div", { class: "dr-acoes" },
          el("button", { type: "button", class: "botao", onclick: aplicar }, m ? "Atualizar saída" : "Encerrar trade"),
          m ? el("button", { type: "button", class: "botao", onclick: () => gravarCampo({ saida_manual: undefined }) }, "Reabrir trade") : null,
          !m && ult ? el("span", { class: "sub" }, `Já preenchi com o último fechamento (${fmtData(ult.data)}).`) : null),
        nota]));
    }

    // ações
    const botArquivar = el("button", { type: "button", class: "botao", onclick: () => {
      const arq = !cur().arquivado;
      gravarCampo({ arquivado: arq ? true : undefined });
      aviso(arq ? "Trade arquivado." : "Trade desarquivado.");
      vistaAcoes();
    } });
    const confirmaEl = el("div", { class: "dr-confirma", role: "alertdialog", "aria-label": "Confirmar exclusão", hidden: true },
      el("span", {}, "Excluir este trade e as fotos dele?"),
      el("button", { type: "button", class: "botao perigo", onclick: () => { fecharEditor(); excluir(id); } }, "Sim, excluir"),
      el("button", { type: "button", class: "botao", onclick: () => { confirmaEl.hidden = true; botExcluir.focus(); } }, "Cancelar"));
    const botExcluir = el("button", { type: "button", class: "botao perigo", onclick: () => {
      confirmaEl.hidden = false;
      confirmaEl.querySelector("button").focus();
    } }, "Excluir");
    const vistaAcoes = () => { botArquivar.textContent = cur()?.arquivado ? "Desarquivar" : "Arquivar"; };

    // ---- montagem
    const dialogo = el("div", { class: "dr-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": sid("titulo"), tabindex: "-1" },
      el("header", { class: "dr-cab" },
        el("div", { class: "dr-cab-id" }, tituloEl, chipsEl, datasEl),
        resultadoEl,
        el("div", { class: "dr-cab-acoes" }, salvoEl, fechar)),
      el("div", { class: "dr-corpo" },
        el("section", { class: "dr-col-esq", "aria-label": "Gráfico e fotos" },
          corpoGraf, resumoEl,
          el("p", { class: "sub dr-dica-arraste" }, el("b", {}, "Arraste as linhas no gráfico"),
            ": entrada (branca), stop (vermelha) e alvo (verde). Também dá para digitar os valores em Níveis."),
          el("p", { class: "sub" }, "R é quanto você arrisca (entrada até o stop): perder no stop é −1R; alvo em 2R é ganhar 2× o risco. Em trades abertos o R é parcial."),
          el("div", { class: "dr-fotos-cab" },
            el("h3", {}, "Fotos"),
            el("div", { class: "dr-acoes" },
              el("label", { class: "dr-rot-tipo", for: tipoFoto.id }, "Tipo"), tipoFoto,
              opcoes.grafico && !opcoes.grafico.removido ? botaoCapturar : null,
              el("button", { type: "button", class: "botao", onclick: () => arquivoEl.click() }, "Anexar imagem"), arquivoEl)),
          galeria,
          el("p", { class: "sub" }, "Dica: com o editor aberto, cole uma imagem da área de transferência (Ctrl+V).")),
        el("section", { class: "dr-col-dir", "aria-label": "Diário do trade" },
          el("div", { class: "dr-linha" },
            el("div", { class: "dr-campo dr-grande" }, el("label", { for: sid("estrategia") }, "Estratégia"), inpEstrategia, datalist),
            el("div", { class: "dr-campo" }, el("label", { for: sid("setup") }, "Setup (opcional)"), selSetup)),
          campoTexto("Tese: por que entrei (antes do trade)", "tese", "O que você viu, onde fica o erro, o que invalida a ideia..."),
          campoTexto("Revisão: o que aprendi (depois do trade)", "revisao", "Seguiu o plano? O que faria diferente?"),
          el("div", { class: "dr-campo" }, el("span", { class: "dr-rotulo", id: sid("nota-rot") }, "Nota da execução (disciplina, não resultado)"), estrelas),
          el("div", { class: "dr-campo" }, el("label", { for: inpTag.id }, "Etiquetas"), tagsEl, inpTag, tagList, sugEl),
          el("fieldset", { class: "dr-niveis" }, el("legend", {}, "Níveis"),
            el("div", { class: "dr-linha quatro" },
              nivel("Entrada", "entrada", (1 / 10 ** casas(t0.entrada)).toString()),
              nivel("Stop", "stop", (1 / 10 ** casas(t0.entrada)).toString()),
              nivel("Alvo", "alvo", (1 / 10 ** casas(t0.entrada)).toString()),
              nivel(`Capital (${moeda === "USD" ? "US$" : "R$"})`, "capital", "100")),
            msgNiveis),
          el("fieldset", { class: "dr-niveis" }, el("legend", {}, "Saída manual"), saidaEl),
          el("div", { class: "dr-acoes dr-rodape" }, botArquivar, botExcluir,
            a ? el("a", { class: "botao", href: `ativo.html#${encodeURIComponent(t0.ticker)}` }, "Abrir o ativo") : null),
          confirmaEl)));
    const fundo = el("div", { class: "modal-fundo dr-fundo", onclick: (ev) => { if (ev.target === fundo) fecharEditor(); } }, dialogo);
    e.fundo = fundo;
    document.body.append(fundo);
    document.body.classList.add("dr-travado");
    e.soltar = prender(dialogo, fecharEditor);
    dialogo.focus();

    fundo.addEventListener("paste", async (ev) => {
      const itens = [...(ev.clipboardData?.items ?? [])].filter((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (!itens.length) return;
      ev.preventDefault();
      for (const i of itens) await adicionarImagem(i.getAsFile());
    });

    // ---- ações de gravação
    function agendar(chave, valor) {
      e.pend[chave] = valor;
      clearTimeout(e.timer);
      e.timer = setTimeout(descarregar, 600);
    }
    function descarregar() {
      clearTimeout(e.timer);
      const p = e.pend;
      e.pend = {};
      if (Object.keys(p).length) gravarCampo(p);
    }
    e.descarregar = descarregar;
    function gravarCampo(patch) {
      if (!gravar(id, patch)) return;
      salvoEl.textContent = "Salvo";
      clearTimeout(e.salvoT);
      e.salvoT = setTimeout(() => { salvoEl.textContent = ""; }, 1800);
      if (!e.vaiFechar) vista();
    }

    // ---- vista (cabeçalho, gráfico, saída) reavaliada a cada mudança
    async function vista() {
      const t = cur();
      if (!t) return;
      const av = await avaliar(t);
      if (ed !== e) return;
      e.av = av;
      const a2 = a;
      tituloEl.replaceChildren(...limpo([el("a", { href: `ativo.html#${encodeURIComponent(t.ticker)}`, class: "mono" }, semSufixo(t.ticker)),
        a2 ? el("span", { class: "sub dr-nome" }, ` ${a2.nome}`) : null]));
      chipsEl.replaceChildren(...limpo([
        el("span", { class: `dr-chip ${t.lado === "compra" ? "alta" : "baixa"}` }, rotuloLado(t.lado)),
        chipEstado(av),
        t.setup ? el("span", { class: "dr-chip" }, nomeDoSetup(t.setup)) : null,
        t.arquivado ? el("span", { class: "dr-chip aviso" }, "Arquivado") : null]));
      resultadoEl.replaceChildren(
        el("div", { class: `dr-r ${av.resultado_r == null ? "" : cor(av.resultado_r)}` }, fmtR(av.resultado_r)),
        el("div", { class: "sub" }, av.resultado_pct != null ? `${fmtPct(av.resultado_pct)}${av.estado === "aberta" ? " (parcial)" : ""}` : "sem resultado ainda"));
      datasEl.textContent = [`Criado em ${fmtData(t.criada)}`, av.entrou ? `entrou em ${fmtData(av.entrou)}` : "ainda não entrou",
        av.saiu ? `saiu em ${fmtData(av.saiu)}` : null, av.dias != null ? `${av.dias} ${av.dias === 1 ? "dia" : "dias"}` : null,
        t.origem ? `origem: ${t.origem}` : null].filter(Boolean).join(" · ");
      if (contasSimulacao(t).valido) e.ultimoValido = { entrada: t.entrada, stop: t.stop, alvo: t.alvo };
      mostrarNiveis(t);
      desenharGrafico(t, av);
      vistaSaida();
      vistaAcoes();
      // o tipo da próxima foto sugere o que falta
      if (!e.tipoDefinido) {
        e.tipoDefinido = true;
        tipoFoto.value = !(t.fotos ?? []).length ? "entrada" : av.fechado ? "saida" : "outra";
      }
    }

    /** Números de níveis e o resumo (qtd, risco, retorno, R:R): ao vivo durante o arraste. */
    function mostrarNiveis(t) {
      for (const k of ["entrada", "stop", "alvo"]) {
        const inp = e.inputs[k];
        if (inp && document.activeElement !== inp) inp.value = (+t[k]).toFixed(casas(t.entrada));
      }
      const c = contasSimulacao(t);
      resumoEl.textContent = `Qtd ${fmtNum(c.qtd, t.mercado === "CRIPTO" ? 6 : 0)} · risco ${fmtMoeda(c.risco, moeda)} (${fmtNum(c.risco_pct, 1)}%) · ` +
        `retorno ${fmtMoeda(c.retorno, moeda)} (${fmtNum(c.retorno_pct, 1)}%) · R:R ${c.rr ? `1 : ${fmtNum(c.rr, 2)}` : "—"}`;
    }

    /** Fim de um arraste no gráfico: grava (com aviso e reavaliação) ou, se ficou inválido, volta ao último válido. */
    function aposArrastar(p) {
      if (contasSimulacao(p).valido) {
        msgNiveis.hidden = true;
        gravarCampo({ entrada: p.entrada, stop: p.stop, alvo: p.alvo });
        return;
      }
      msgNiveis.textContent = (p.lado === "compra"
        ? "Na compra, o stop fica abaixo da entrada e o alvo acima." : "Na venda, o stop fica acima da entrada e o alvo abaixo.") + " Voltei a linha para onde estava.";
      msgNiveis.hidden = false;
      if (e.ultimoValido) gravarCampo(e.ultimoValido);
    }

    /** Marcas de entrada e saída; as linhas de entrada, stop e alvo (arrastáveis) e as zonas são do Simulador. */
    function desenharGrafico(t, av) {
      if (!e.g || !e.g.c) return;
      const g = e.g;
      const compra = t.lado === "compra";
      const noCandle = (d) => g.c.find((x) => String(x.time) >= d)?.time ?? g.c.at(-1).time;
      const m = [];
      if (av.entrou) m.push({ time: noCandle(av.entrou), position: compra ? "belowBar" : "aboveBar", shape: compra ? "arrowUp" : "arrowDown",
        color: "#4c8dff", text: "Entrada", size: 1.4 });
      if (av.saiu) m.push({ time: noCandle(av.saiu), position: compra ? "aboveBar" : "belowBar", shape: "circle",
        color: av.resultado_r >= 0 ? "#26c281" : "#f0506e",
        text: `${{ alvo: "Alvo", stop: "Stop", manual: "Saída" }[av.estado]} ${fmtR(av.resultado_r)}`, size: 1.4 });
      m.sort((x, y) => String(x.time).localeCompare(String(y.time)));
      if (!e.marcas) e.marcas = LWC.createSeriesMarkers(g.candles, m, { autoScale: false });
      else e.marcas.setMarkers(m);
    }

    // ---- fotos
    async function vistaFotos() {
      const lista = await fotos(id);
      if (ed !== e) return;
      e.listaFotos = lista;
      galeria.replaceChildren(...(lista.length ? lista.map((f, i) => el("button", {
        type: "button", class: "dr-foto", "aria-label": `Abrir a foto ${i + 1} (${NOME_TIPO_FOTO[f.tipo] ?? f.tipo})`,
        onclick: () => lightbox(id, () => e.listaFotos ?? [], i, vistaFotos),
      }, el("img", { src: f.url, alt: "", loading: "lazy" }), el("span", { class: "dr-foto-tipo" }, NOME_TIPO_FOTO[f.tipo] ?? f.tipo)))
        : [el("p", { class: "vazio dr-sem-foto" }, "Sem fotos ainda. Capture o gráfico, anexe um print ou cole uma imagem.")]));
    }

    vistaEstrelas();
    vistaTags();
    await vista();
    await vistaFotos();
    // o gráfico entra por último: carrega os candles do ativo
    if (a && ed === e) {
      e.g = new Grafico(corpoGraf, { mini: true });
      e.g.sinais = [];
      // o mesmo simulador da página do ativo: linhas arrastáveis e zonas de risco/retorno, só deste trade
      e.sim = new Simulador(e.g, corpoGraf, null, null, { so: id, arrastar: true,
        aoArrastar: (p) => mostrarNiveis(p), aoMudar: (p) => aposArrastar(p) });
      const ok = await e.g.mostrar(a.arquivo, "D").catch(() => false);
      if (ok && ed === e && e.av) {
        await e.sim.definirAtivo(a);
        if (ed !== e) return;
        desenharGrafico(cur(), e.av);
        // trade recente: os últimos ~3 meses, com espaço à direita para a caixa de risco/retorno; antigo: vai até a entrada
        const n = e.g.c.length, desde = e.av.entrou ?? cur().criada;
        if (n - e.g.c.findIndex((x) => String(x.time) >= desde) <= 40) e.g.chart.timeScale().setVisibleLogicalRange({ from: n - 64, to: n + 14 });
        else e.g.irPara(desde);
      }
    } else if (!a) corpoGraf.append(el("p", { class: "vazio" }, "Ativo fora dos dados publicados: sem gráfico."));
  }

  const NOME_TIPO_FOTO = { entrada: "entrada", saida: "saída", outra: "outra" };

  // ---------------------------------------------------------- lightbox das fotos

  function lightbox(tradeId, obterLista, inicio, aoMudar) {
    let i = inicio;
    const img = el("img", { alt: "" });
    const legenda = el("p", { class: "sub dr-legenda", "aria-live": "polite" });
    const sel = (d) => { const n = obterLista().length; i = (i + d + n) % n; mostrar(); };
    const prev = el("button", { type: "button", class: "botao", "aria-label": "Foto anterior", onclick: () => sel(-1) }, "‹");
    const prox = el("button", { type: "button", class: "botao", "aria-label": "Próxima foto", onclick: () => sel(1) }, "›");
    const fecharLb = () => { soltar(); caixa.remove(); };
    const excluirFoto = el("button", { type: "button", class: "botao perigo", onclick: () => {
      const f = obterLista()[i];
      if (!f) return;
      const t = trade(tradeId);
      gravar(tradeId, { fotos: (t.fotos ?? []).filter((x) => x !== f.id) });
      let desfeito = false;
      aviso("Foto excluída.", { rot: "Desfazer", fazer: () => {
        desfeito = true;
        const t2 = trade(tradeId);
        if (t2) gravar(tradeId, { fotos: [...(t2.fotos ?? []), f.id] });
        aoMudar?.();
      } });
      setTimeout(() => { if (!desfeito) fotoApagar(f.id); }, 5200);
      fecharLb();
      aoMudar?.();
    } }, "Excluir foto");
    function mostrar() {
      const lista = obterLista();
      const f = lista[i];
      if (!f) { fecharLb(); return; }
      img.src = f.url;
      img.alt = `Foto ${i + 1} de ${lista.length}, ${NOME_TIPO_FOTO[f.tipo] ?? f.tipo}`;
      legenda.textContent = `Foto ${i + 1} de ${lista.length} · ${NOME_TIPO_FOTO[f.tipo] ?? f.tipo}${f.criada ? ` · ${new Date(f.criada).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}`;
      prev.hidden = prox.hidden = lista.length < 2;
    }
    const caixa = el("div", { class: "dr-lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Foto do trade", tabindex: "-1",
      onclick: (ev) => { if (ev.target === caixa) fecharLb(); } },
      el("div", { class: "dr-lb-conteudo" }, img,
        el("div", { class: "dr-lb-barra" }, prev, legenda, prox,
          excluirFoto,
          el("button", { type: "button", class: "botao", onclick: fecharLb }, "Fechar"))));
    caixa.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") { ev.preventDefault(); sel(-1); }
      if (ev.key === "ArrowRight") { ev.preventDefault(); sel(1); }
    });
    document.body.append(caixa);
    const soltar = prender(caixa, fecharLb);
    mostrar();
    caixa.focus();
  }

  // ---------------------------------------------------------- API

  window.Diario = {
    FECHADOS, SEM_ESTRATEGIA, ETIQUETAS_SUGERIDAS,
    trades, trade, avaliar, avaliarTodos, registrar, abrir, fechar: fecharEditor,
    preencher, atualizar: gravar, excluir,
    salvarFoto, fotos, removerFoto, fotografar, capturar, reduzir,
    // usados pela página do diário (backup)
    _foto: { ler: fotoLer, gravar: fotoGravar, apagar: fotoApagar },
    estatisticas, estrategias, nomeDoSetup, carregarCatalogo, ativoDe, lightbox,
  };
})();
