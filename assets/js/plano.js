/* Plano de amanhã: os ativos que eu quero operar no próximo pregão, com entrada, stop e alvo
 * sugeridos (editáveis), a quantidade pelo risco por operação e a situação de cada um (entrei,
 * não entrei, cancelado). Fica salvo no navegador. API: window.Plano (adicionar, remover, abrir,
 * itens, tem) e o evento "bandejas" a cada mudança. Depende de comum.js e simulador.js. */

(() => {
  const CHAVE = "plano-v1", CHAVE_CFG = "plano-config-v1";
  const hoje = () => new Date().toLocaleDateString("sv-SE");  // AAAA-MM-DD no fuso local
  const ler = () => { const l = guardar.ler(CHAVE, []); return Array.isArray(l) ? l : []; };
  const avisar = (origem) => document.dispatchEvent(new CustomEvent("bandejas", { detail: { origem } }));
  const gravar = (l, origem = "plano") => { guardar.gravar(CHAVE, l); avisar(origem); };
  const mudar = (id, f, origem) => gravar(ler().map((i) => (i.id === id ? { ...i, ...f(i) } : i)), origem);
  const config = () => ({ modo: "valor", valor: 100, pct: 1, capital: 10000, ...guardar.ler(CHAVE_CFG, {}) });

  // ---------------------------------------------------------- dados (radar e catálogo, com cache)

  let R = null, porTk = new Map(), nomes = new Map();
  async function carregar() {
    if (!R) {
      R = await carregarRadar();
      porTk = new Map(R.ativos.map((a) => [a.ticker, a]));
    }
    if (!nomes.size) await buscarJSON("data/setups.json").then((c) => {
      for (const g of c.grupos ?? []) for (const s of g.itens ?? []) nomes.set(s.id, s.nome);
    }).catch(() => {});
    return R;
  }
  const nomeDoSetup = (id) => (id ? nomes.get(id) ?? id : null);

  /** Próximo pregão depois de `iso`: ações pulam sábado e domingo (feriados não entram); cripto, qualquer dia. */
  function proximoPregao(iso, mercado) {
    const d = new Date(`${iso}T12:00:00Z`);
    do d.setUTCDate(d.getUTCDate() + 1); while (mercado !== "CRIPTO" && [0, 6].includes(d.getUTCDay()));
    return d.toISOString().slice(0, 10);
  }

  /** Candles fechados (sem o do pregão em andamento). */
  const fechados = (d) => (d.parcial && d.candles.at(-1)?.time === d.parcial ? d.candles.slice(0, -1) : d.candles);

  /** ATR 14 (Wilder) em preço. */
  function atrPreco(c, n = 14) {
    let v = null;
    for (let i = 1; i < c.length; i++) {
      const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
      v = i <= n ? ((v ?? 0) * (i - 1) + tr) / i : (v * (n - 1) + tr) / n;
    }
    return v;
  }

  const arred = (v, a) => +v.toFixed(casasPreco(v, a.moeda));

  /**
   * Níveis sugeridos. Com uma simulação salva do ativo, usa a dela. Senão: entrada no rompimento da
   * máxima (compra) ou da mínima (venda) do último candle fechado; stop no mais próximo entre a MMS 20
   * (¼ de ATR além dela) e 1,5 ATR da entrada, nunca a menos de ½ ATR; alvo a 2R.
   */
  async function sugerir(a, lado, usarSimulacao = true) {
    const sim = usarSimulacao && Simulacoes.doAtivo(a.ticker).sort((x, y) => x.criada.localeCompare(y.criada) || x.id.localeCompare(y.id)).at(-1);
    if (sim && (!lado || lado === "neutro" || sim.lado === lado)) return { lado: sim.lado, entrada: sim.entrada, stop: sim.stop, alvo: sim.alvo,
      porque: `Níveis da sua simulação de ${fmtData(sim.criada)}.` };
    const c = fechados(await carregarCandles(a.arquivo));
    const u = c.at(-1), A = atrPreco(c) ?? u.close * 0.02, m20 = sma(c, 20).at(-1)?.value;
    const s = lado === "venda" ? -1 : 1;
    const entrada = s > 0 ? u.high : u.low;
    const porAtr = entrada - s * 1.5 * A;
    const naMedia = m20 != null && s * (entrada - m20) > 0 ? m20 - s * 0.25 * A : null;
    let stop = porAtr, origem = "a 1,5 ATR da entrada";
    if (naMedia != null && s * (naMedia - porAtr) > 0) { stop = naMedia; origem = `logo ${s > 0 ? "abaixo" : "acima"} da MMS 20 (¼ ATR)`; }
    if (s * (entrada - stop) < 0.5 * A) { stop = entrada - s * 0.5 * A; origem = "a ½ ATR (a MMS 20 estava colada)"; }
    const alvo = entrada + s * 2 * Math.abs(entrada - stop);
    return {
      lado: s > 0 ? "compra" : "venda", entrada: arred(entrada, a), stop: arred(stop, a), alvo: arred(alvo, a),
      porque: `Entrada no rompimento da ${s > 0 ? "máxima" : "mínima"} de ${fmtData(u.time)}; stop ${origem}; alvo a 2R. ` +
        `ATR 14: ${fmtMoeda(A, a.moeda)}.`,
    };
  }

  // ---------------------------------------------------------- contas

  /** Risco por operação em R$ (valor fixo ou % do capital). */
  const riscoBRL = (cfg = config()) => (cfg.modo === "pct" ? (cfg.capital * cfg.pct) / 100 : cfg.valor);
  const cambio = (a) => (a.moeda === "USD" ? R?.usdbrl ?? 5 : 1);

  function contas(i, a, cfg = config()) {
    const fx = cambio(a), dist = Math.abs(i.entrada - i.stop), ganho = Math.abs(i.alvo - i.entrada);
    const bruta = dist ? riscoBRL(cfg) / (dist * fx) : 0;
    const qtd = a.mercado === "CRIPTO" ? +bruta.toFixed(6) : Math.floor(bruta);
    const compra = i.lado !== "venda";
    return {
      qtd, fx, risco: qtd * dist * fx, retorno: qtd * ganho * fx, volume: qtd * i.entrada * fx,
      rr: dist ? ganho / dist : null,
      valido: compra ? i.stop < i.entrada && i.alvo > i.entrada : i.stop > i.entrada && i.alvo < i.entrada,
    };
  }
  const fmtQtd = (q, a) => fmtNum(q, a.mercado === "CRIPTO" ? 6 : 0);
  const rotuloLado = (l) => (l === "venda" ? "▼ Venda" : l === "neutro" ? "◆ Neutro" : "▲ Compra");

  // ---------------------------------------------------------- aviso rápido (toast)

  let toast = null, tempo = 0;
  function avisoRapido(msg, acao) {
    toast?.remove();
    toast = el("div", { class: "aviso-rapido", role: "status" }, el("span", {}, msg),
      acao ? el("button", { class: "botao-link", onclick: () => { toast.remove(); acao.fazer(); } }, acao.rot) : null);
    document.body.append(toast);
    clearTimeout(tempo);
    tempo = setTimeout(() => toast?.remove(), 4500);
  }

  // ---------------------------------------------------------- foco preso em diálogos (gaveta e modal)

  /** Tab circula dentro de `caixa`, Esc fecha e as teclas não vazam para os atalhos da página. Devolve o "soltar". */
  function prenderFoco(caixa, fechar) {
    const anterior = document.activeElement;
    const focaveis = () => [...caixa.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => n.offsetParent !== null);
    // escuta no documento (captura): funciona mesmo se o foco cair no body depois de um redesenho
    const tecla = (e) => {
      if (dialogos.at(-1) !== caixa) return;  // só o diálogo de cima (modal sobre a gaveta)
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); return; }
      if (e.key !== "Tab") return;
      const f = focaveis();
      if (!f.length) return;
      const dentro = caixa.contains(document.activeElement);
      if (!dentro || (e.shiftKey && document.activeElement === f[0])) { e.preventDefault(); (e.shiftKey ? f.at(-1) : f[0]).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    };
    // as outras teclas não chegam aos atalhos da página (← → trocam de ativo, / busca...)
    const conter = (e) => e.stopPropagation();
    dialogos.push(caixa);
    document.addEventListener("keydown", tecla, true);
    caixa.addEventListener("keydown", conter);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      caixa.removeEventListener("keydown", conter);
      dialogos.splice(dialogos.indexOf(caixa), 1);
      if (anterior?.isConnected) anterior.focus?.();
    };
  }
  const dialogos = [];

  // ---------------------------------------------------------- gráfico com entrada, stop e alvo

  /** O mesmo desenho do simulador (linhas e zonas de risco/retorno), só com os níveis do item do plano. */
  class NiveisPlano extends Simulador {
    constructor(g, corpo, pos) { super(g, corpo); this.pos = pos; }
    visiveis() { return this.pos ? [this.pos] : []; }
    emEdicao() { return this.pos; }
  }

  // ---------------------------------------------------------- API

  const pendentes = () => ler().filter((i) => i.status === "pendente" && i.para >= hoje());
  const doTicker = (tk) => pendentes().filter((i) => i.ticker === tk);

  async function adicionar(ctx = {}) {
    await carregar();
    const a = porTk.get(ctx.ticker);
    if (!a) { avisoRapido(`Não encontrei ${ctx.ticker ?? "o ativo"} nos dados publicados.`); return null; }
    const base = a.parcial?.data ?? a.data;
    const para = proximoPregao(base, a.mercado);
    const existente = ler().find((i) => i.ticker === a.ticker && i.para === para && i.status === "pendente");
    if (existente) {
      avisoRapido(`${semSufixo(a.ticker)} já está no plano de ${fmtData(para, true)}.`, { rot: "Abrir plano", fazer: abrir });
      return existente;
    }
    const niv = await sugerir(a, ctx.lado);
    const item = {
      id: `${Date.now()}-${a.ticker}`, ticker: a.ticker, adicionadoEm: new Date().toISOString(), para, base,
      setup: ctx.setup ?? null, tf: ctx.tf === "W" ? "W" : "D", ladoSinal: ctx.lado ?? null,
      lado: niv.lado, preco: ctx.preco ?? a.ultimo, entrada: niv.entrada, stop: niv.stop, alvo: niv.alvo,
      porque: niv.porque, notas: "", status: "pendente",
    };
    gravar([...ler(), item]);
    avisoRapido(`${semSufixo(a.ticker)} entrou no plano de ${fmtData(para, true)}.`, { rot: "Abrir plano", fazer: abrir });
    return item;
  }

  function remover(tk) { gravar(ler().filter((i) => !(i.ticker === tk && i.status === "pendente" && i.para >= hoje()))); }

  // ---------------------------------------------------------- gaveta

  let gaveta = null, soltarFoco = null, graficosGaveta = [];

  function fechar() {
    graficosGaveta.splice(0).forEach((g) => g.remover());
    gaveta?.remove();
    gaveta = null;
    document.body.classList.remove("com-gaveta");
    soltarFoco?.();
    soltarFoco = null;
  }

  async function abrir() {
    if (!gaveta) {
      gaveta = el("div", { class: "gaveta-fundo", onclick: (e) => { if (e.target === e.currentTarget) fechar(); } },
        el("aside", { class: "gaveta", role: "dialog", "aria-modal": "true", "aria-labelledby": "gaveta-plano-titulo", tabindex: "-1" }));
      document.body.append(gaveta);
      document.body.classList.add("com-gaveta");
      soltarFoco = prenderFoco(gaveta, fechar);
    }
    await carregar();
    renderGaveta();
    gaveta.querySelector(".gaveta-fechar")?.focus();
  }

  function campoConfig() {
    const cfg = config();
    const salvar = (m) => { guardar.gravar(CHAVE_CFG, { ...config(), ...m }); avisar("plano-config"); atualizarContas(); };
    const num = (k, rot, passo) => el("label", { class: "plano-cfg-campo" }, rot,
      el("input", { type: "number", min: "0", step: passo, value: cfg[k], inputmode: "decimal",
        onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) salvar({ [k]: v }); } }));
    const modo = el("select", { "aria-label": "Como medir o risco por operação",
      onchange: (e) => { salvar({ modo: e.target.value }); renderGaveta(); } },
      el("option", { value: "valor", selected: cfg.modo === "valor" }, "valor fixo"),
      el("option", { value: "pct", selected: cfg.modo === "pct" }, "% do capital"));
    return el("div", { class: "plano-cfg" }, el("span", {}, "Risco por operação"), modo,
      cfg.modo === "pct" ? [num("pct", "%", "0.1"), num("capital", "de R$", "100")] : num("valor", "R$", "10"),
      el("span", { class: "sub plano-cfg-total" }, `= ${fmtBRL.format(riscoBRL(cfg))}`));
  }

  /** Atualiza só os números (quantidade, risco...) sem redesenhar a gaveta (o foco fica no campo). */
  function atualizarContas() {
    if (!gaveta) return;
    gaveta.querySelector(".plano-cfg-total")?.replaceChildren(`= ${fmtBRL.format(riscoBRL())}`);
    for (const i of ler()) {
      const n = gaveta.querySelector(`.plano-item[data-id="${CSS.escape(i.id)}"] .plano-contas`);
      if (n) n.replaceWith(blocoContas(i, porTk.get(i.ticker)));
    }
  }

  function blocoContas(i, a) {
    const c = contas(i, a);
    return el("div", { class: "plano-contas" },
      el("span", {}, "Qtd ", el("b", {}, fmtQtd(c.qtd, a))),
      el("span", {}, "Risco ", el("b", { class: "baixa" }, fmtBRL.format(c.risco))),
      el("span", {}, "Retorno ", el("b", { class: "alta" }, fmtBRL.format(c.retorno))),
      el("span", {}, "R:R ", el("b", {}, c.rr ? `1 : ${fmtNum(c.rr, 1)}` : "—")),
      c.qtd ? el("span", { class: "sub" }, `posição ${fmtBRL.format(c.volume)}`) : el("span", { class: "baixa" }, "risco por operação pequeno demais para 1 unidade"),
      c.valido ? null : el("span", { class: "baixa" }, i.lado === "venda" ? "Na venda, o stop fica acima da entrada e o alvo abaixo." : "Na compra, o stop fica abaixo da entrada e o alvo acima."));
  }

  const STATUS = { pendente: "Pendente", entrei: "Entrei", nao_entrei: "Não entrei", cancelado: "Cancelado" };

  function itemPlano(i) {
    const a = porTk.get(i.ticker);
    if (!a) return el("article", { class: "plano-item" }, el("b", {}, semSufixo(i.ticker)), " não está mais nos dados publicados.",
      el("button", { class: "botao-remover", "aria-label": "Remover do plano", onclick: () => gravar(ler().filter((x) => x.id !== i.id)) }, "×"));
    const casas = casasPreco(a.ultimo, a.moeda), passo = (1 / 10 ** casas).toString();
    const pos = { id: i.id, ticker: i.ticker, mercado: a.mercado, moeda: a.moeda, lado: i.lado, entrada: i.entrada, stop: i.stop,
      alvo: i.alvo, criada: i.base, preco_criacao: i.preco, capital: 1 };
    const corpo = el("div", { class: "plano-grafico" });
    let niveis = null;
    const ultimo = precoAtual(a).ultimo;
    const distEntrada = el("span", { class: "sub" });
    const atualizarDist = () => distEntrada.replaceChildren(` · entrada a ${fmtPct((i.entrada / ultimo - 1) * 100)} do último`);
    atualizarDist();
    const campo = (rot, k, cls) => el("label", { class: `plano-campo ${cls}` }, rot,
      el("input", { type: "number", step: passo, min: "0", inputmode: "decimal", value: (+i[k]).toFixed(casas), "data-k": k,
        onchange: (e) => {
          const v = parseFloat(e.target.value);
          if (!(v > 0)) { e.target.value = (+i[k]).toFixed(casas); return; }
          i[k] = v; pos[k] = v;
          mudar(i.id, () => ({ [k]: v }), "plano-campo");
          art.querySelector(".plano-contas").replaceWith(blocoContas(i, a));
          atualizarDist();
          niveis?.desenhar();
        } }));
    const status = (k, rot) => el("button", { class: `botao status-${k} ${i.status === k ? "ativo" : ""}`, "aria-pressed": String(i.status === k),
      onclick: () => mudar(i.id, (x) => ({ status: x.status === k ? "pendente" : k })) }, rot);
    const art = el("article", { class: `plano-item lado-${i.lado} st-${i.status}`, "data-id": i.id },
      el("header", { class: "plano-item-topo" },
        el("a", { class: "plano-ticker", href: `ativo.html#${encodeURIComponent(i.ticker)}`, title: "Abrir a página do ativo" },
          el("b", { class: "mono" }, semSufixo(i.ticker)), " ", el("span", { class: "cartao-nome" }, a.nome)),
        el("button", { class: "botao-remover", title: "Tirar do plano", "aria-label": `Tirar ${semSufixo(i.ticker)} do plano`,
          onclick: () => gravar(ler().filter((x) => x.id !== i.id)) }, "×")),
      el("div", { class: "chips" },
        el("span", { class: `chip evento ${i.lado}` }, rotuloLado(i.lado)),
        i.setup ? el("span", { class: "chip" }, `${nomeDoSetup(i.setup)} · ${i.tf === "W" ? "semanal" : "diário"}`) : null,
        i.ladoSinal === "neutro" ? el("span", { class: "chip", title: "Sem lado definido ao adicionar; os níveis foram sugeridos para compra" }, "sem lado definido") : null,
        el("button", { class: "botao-link plano-inverter", title: "Trocar o lado e sugerir os níveis de novo",
          onclick: async () => { const n = await sugerir(a, i.lado === "venda" ? "compra" : "venda", false); mudar(i.id, () => ({ ...n, ladoSinal: null })); } },
          `⇅ ${i.lado === "venda" ? "compra" : "venda"}`),
        i.status !== "pendente" ? el("span", { class: `chip st-chip st-${i.status}` }, STATUS[i.status]) : null),
      el("p", { class: "plano-preco" }, "Último ", el("b", { class: "mono" }, fmtMoeda(ultimo, a.moeda)), distEntrada),
      el("div", { class: "plano-campos" }, campo("Entrada", "entrada", ""), campo("Stop", "stop", "baixa"), campo("Alvo", "alvo", "alta")),
      blocoContas(i, a),
      i.porque ? el("p", { class: "sub plano-porque" }, el("b", {}, "Por quê: "), i.porque) : null,
      corpo,
      el("input", { class: "plano-obs", type: "text", placeholder: "Observação (opcional)", "aria-label": "Observação", value: i.notas ?? "",
        onchange: (e) => mudar(i.id, () => ({ notas: e.target.value }), "plano-campo") }),
      el("div", { class: "plano-acoes" },
        status("entrei", "Entrei"), status("nao_entrei", "Não entrei"), status("cancelado", "Cancelar"),
        i.simulacao && Simulacoes.todas().some((s) => s.id === i.simulacao)
          ? el("a", { class: "botao", href: `ativo.html#${encodeURIComponent(i.ticker)}`, title: "A simulação é reavaliada a cada atualização" }, "✓ Simulação criada")
          : el("button", { class: "botao", title: "Cria uma simulação com estes níveis (acompanhada em Minhas simulações)",
            onclick: () => virarSimulacao(i, a) }, "Virar simulação")));
    // o gráfico só nasce com a gaveta na tela (precisa de largura)
    requestAnimationFrame(() => {
      if (!corpo.isConnected) return;
      const g = new Grafico(corpo, { mini: true });
      graficosGaveta.push(g);
      niveis = new NiveisPlano(g, corpo, pos);
      niveis.definirAtivo(a);
      g.mostrar(a.arquivo, "D");
    });
    return art;
  }

  function virarSimulacao(i, a) {
    const c = contas(i, a);
    const sim = {
      id: `${Date.now()}`, ticker: i.ticker, mercado: a.mercado, moeda: a.moeda, lado: i.lado,
      entrada: i.entrada, stop: i.stop, alvo: i.alvo,
      capital: c.qtd ? Math.ceil(c.qtd * i.entrada * 1.0001 * 100) / 100 : a.mercado === "BR" ? 1000 : 200,
      criada: i.base, preco_criacao: i.preco, origem: "plano",
    };
    Simulacoes.salvar(sim);
    document.dispatchEvent(new CustomEvent("simulacoes"));
    mudar(i.id, () => ({ simulacao: sim.id }));
    avisoRapido(`Simulação de ${semSufixo(i.ticker)} criada: aparece em Minhas simulações.`);
  }

  /** Item de um plano que já passou: situação marcada e o que o preço fez desde então. */
  function itemAnterior(i) {
    const a = porTk.get(i.ticker);
    const fez = el("span", { class: "sub" });
    if (a) carregarCandles(a.arquivo).then(({ candles }) => {
      const av = avaliarSimulacao({ ...i, criada: i.base, preco_criacao: i.preco }, fechados({ candles, parcial: null }));
      const st = ESTADO_SIM[av.estado];
      fez.replaceChildren("O preço: ", el("b", { class: st.cls }, st.rot), av.resultado_pct != null ? el("b", { class: cor(av.resultado_pct) }, ` ${fmtResultado(av)}`) : "");
    }).catch(() => {});
    return el("li", { class: `plano-anterior st-${i.status}` },
      el("a", { href: `ativo.html#${encodeURIComponent(i.ticker)}`, class: "mono" }, el("b", {}, semSufixo(i.ticker))), " ",
      el("span", { class: classeDoLado(i.lado) }, rotuloLado(i.lado)), " ",
      el("span", { class: `chip st-chip st-${i.status}` }, STATUS[i.status]), " ",
      a ? el("span", { class: "sub" }, `E ${fmtMoeda(i.entrada, a.moeda)} · S ${fmtMoeda(i.stop, a.moeda)} · A ${fmtMoeda(i.alvo, a.moeda)} · `) : null,
      fez,
      el("button", { class: "botao-remover", "aria-label": "Apagar do histórico", title: "Apagar do histórico",
        onclick: () => gravar(ler().filter((x) => x.id !== i.id)) }, "×"));
  }
  const classeDoLado = (l) => (l === "venda" ? "baixa" : "alta");

  function renderGaveta() {
    if (!gaveta) return;
    graficosGaveta.splice(0).forEach((g) => g.remover());
    const caixa = gaveta.querySelector(".gaveta");
    const todos = ler(), h = hoje();
    const futuros = todos.filter((i) => i.para >= h), passados = todos.filter((i) => i.para < h);
    const datas = [...new Set(futuros.map((i) => i.para))].sort();
    caixa.replaceChildren(...[
      el("div", { class: "gaveta-cab" },
        el("h2", { id: "gaveta-plano-titulo" }, "Plano de amanhã"),
        el("div", { class: "controles" },
          el("button", { class: "botao", onclick: copiar, disabled: !futuros.length, title: "Copia um resumo em texto" }, "Copiar plano"),
          el("button", { class: "fechar gaveta-fechar", "aria-label": "Fechar o plano (Esc)", title: "Fechar (Esc)", onclick: fechar }, "×"))),
      campoConfig(),
      futuros.length ? null : el("p", { class: "vazio" }, "Nada planejado. Arraste um card da página Setups para “Plano de amanhã” ou use ",
        el("b", {}, "+ Plano de amanhã"), " na página do ativo."),
      ...datas.map((d) => {
        const doDia = futuros.filter((i) => i.para === d).sort((x, y) => x.adicionadoEm.localeCompare(y.adicionadoEm));
        return el("section", { class: "plano-dia" },
          el("h3", {}, `Plano para ${fmtData(d, true)}`, el("span", { class: "contagem" }, doDia.filter((i) => i.status === "pendente").length)),
          doDia.map(itemPlano));
      }),
      passados.length ? el("details", { class: "plano-anteriores" },
        el("summary", {}, `Planos anteriores (${passados.length})`),
        [...new Set(passados.map((i) => i.para))].sort().reverse().map((d) => el("div", {},
          el("h4", {}, fmtData(d, true)), el("ul", {}, passados.filter((i) => i.para === d).map(itemAnterior))))) : null,
      el("p", { class: "sub" }, "O próximo pregão pula sábado e domingo (feriados não); cripto opera todo dia. Fica salvo neste navegador."),
    ].filter(Boolean));
    // o elemento com foco pode ter sumido no redesenho: o foco volta para a gaveta (não para o body)
    if (dialogos.at(-1) === gaveta && !caixa.contains(document.activeElement)) caixa.focus({ preventScroll: true });
  }

  function textoPlano() {
    const futuros = ler().filter((i) => i.para >= hoje() && i.status !== "cancelado");
    const linhas = [];
    for (const d of [...new Set(futuros.map((i) => i.para))].sort()) {
      linhas.push(`Plano para ${fmtData(d, true)}`);
      for (const i of futuros.filter((x) => x.para === d)) {
        const a = porTk.get(i.ticker);
        if (!a) continue;
        const c = contas(i, a);
        linhas.push(`${i.lado === "venda" ? "▼" : "▲"} ${semSufixo(i.ticker)} (${a.nome})${i.setup ? ` · ${nomeDoSetup(i.setup)} (${i.tf})` : ""}` +
          `${i.status !== "pendente" ? ` [${STATUS[i.status]}]` : ""}`);
        linhas.push(`  Entrada ${fmtMoeda(i.entrada, a.moeda)} · Stop ${fmtMoeda(i.stop, a.moeda)} · Alvo ${fmtMoeda(i.alvo, a.moeda)} · R:R 1:${fmtNum(c.rr ?? 0, 1)}`);
        linhas.push(`  Qtd ${fmtQtd(c.qtd, a)} · risco ${fmtBRL.format(c.risco)} · retorno ${fmtBRL.format(c.retorno)}${i.notas ? ` · ${i.notas}` : ""}`);
      }
      linhas.push("");
    }
    return linhas.join("\n").trim();
  }

  async function copiar() {
    const txt = textoPlano();
    try { await navigator.clipboard.writeText(txt); }
    catch {
      const t = el("textarea", { style: "position:fixed;opacity:0" }, txt);
      document.body.append(t); t.select();
      try { document.execCommand("copy"); } catch {}
      t.remove();
    }
    avisoRapido("Plano copiado.");
  }

  document.addEventListener("bandejas", (e) => {
    if (gaveta && !["plano-campo", "plano-config"].includes(e.detail?.origem)) renderGaveta();
  });

  // ---------------------------------------------------------- selo, botão e seção da Carteira

  /** Marcador pequeno para os cards: o ativo está no plano (null se não está). */
  function selo(tk) {
    const i = doTicker(tk)[0];
    if (!i) return null;
    return el("button", { class: "selo-plano", type: "button", title: `No plano de ${fmtData(i.para, true)}. Clique para abrir o plano.`,
      "aria-label": `${semSufixo(tk)} está no plano de ${fmtData(i.para, true)}`,
      onclick: (e) => { e.stopPropagation(); abrir(); } }, "📌");
  }

  /** Botão da página do ativo: põe no plano (e abre), ou mostra que já está. */
  function botao(obterCtx) {
    const ctx = obterCtx();
    const i = doTicker(ctx.ticker)[0];
    return el("button", { class: `botao botao-plano ${i ? "no-plano" : ""}`, title: i ? "Abrir o plano de amanhã" : "Pôr este ativo no plano do próximo pregão",
      onclick: async () => { if (!i) await adicionar(obterCtx()); abrir(); } },
      i ? `✓ No plano · ${fmtData(i.para, true)}` : "+ Plano de amanhã");
  }

  async function renderSecao() {
    const alvo = document.getElementById("plano-resumo");
    if (!alvo) return;
    await carregar().catch(() => null);
    const itens = pendentes().sort((x, y) => x.para.localeCompare(y.para) || x.adicionadoEm.localeCompare(y.adicionadoEm));
    if (!itens.length) {
      alvo.replaceChildren(el("p", { class: "vazio" }, "Nenhum item pendente. Na página Setups, arraste um card para “Plano de amanhã”, ou use ",
        el("b", {}, "+ Plano de amanhã"), " na página do ativo."));
      return;
    }
    alvo.replaceChildren(el("div", { class: "tabela-wrap" }, el("table", { class: "tabela-plano" },
      el("thead", {}, el("tr", {}, ["Ativo", "Para", "Lado", "Último", "Entrada", "Stop", "Alvo", "Qtd", "Risco", "R:R"]
        .map((t, k) => el("th", { class: k >= 3 ? "num" : "" }, t)))),
      el("tbody", {}, itens.map((i) => {
        const a = porTk.get(i.ticker);
        if (!a) return null;
        const c = contas(i, a);
        return el("tr", { onclick: (e) => { if (!e.target.closest("a")) abrir(); }, title: "Abrir o plano" },
          el("td", {}, el("a", { class: "ticker-cel", href: `ativo.html#${encodeURIComponent(i.ticker)}` }, el("b", {}, semSufixo(i.ticker)), el("span", {}, a.nome))),
          el("td", {}, fmtData(i.para, true)),
          el("td", { class: classeDoLado(i.lado) }, rotuloLado(i.lado)),
          el("td", { class: "num" }, fmtMoeda(precoAtual(a).ultimo, a.moeda)),
          el("td", { class: "num" }, fmtMoeda(i.entrada, a.moeda)),
          el("td", { class: "num baixa" }, fmtMoeda(i.stop, a.moeda)),
          el("td", { class: "num alta" }, fmtMoeda(i.alvo, a.moeda)),
          el("td", { class: "num" }, fmtQtd(c.qtd, a)),
          el("td", { class: "num" }, fmtBRL.format(c.risco)),
          el("td", { class: "num" }, c.rr ? `1 : ${fmtNum(c.rr, 1)}` : "—"));
      })))),
      el("p", { class: "sub" }, `${itens.length} pendente(s) · risco total ${fmtBRL.format(itens.reduce((t, i) => t + (porTk.get(i.ticker) ? contas(i, porTk.get(i.ticker)).risco : 0), 0))}`));
  }
  if (document.getElementById("plano-resumo")) {
    document.getElementById("plano-abrir")?.addEventListener("click", abrir);
    renderSecao();
    document.addEventListener("bandejas", renderSecao);
  }

  window.Plano = {
    adicionar, remover, abrir, fechar,
    itens: () => ler(),
    tem: (tk) => doTicker(tk).length > 0,
    selo, botao,
    // usados pela exportação conjunta (notas.js)
    _exportar: () => ({ itens: ler(), config: config() }),
    _importar(d) {
      if (!d || !Array.isArray(d.itens)) return 0;
      const atuais = new Map(ler().map((i) => [i.id, i]));
      let n = 0;
      for (const i of d.itens) if (i?.id && i.ticker && i.para && i.entrada) { atuais.set(i.id, i); n++; }
      if (d.config && typeof d.config === "object") guardar.gravar(CHAVE_CFG, { ...config(), ...d.config });
      gravar([...atuais.values()]);
      return n;
    },
  };
  window.avisoRapido = avisoRapido;
  window.prenderFoco = prenderFoco;
})();
