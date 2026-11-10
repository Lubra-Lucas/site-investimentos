/* Compartilhar este sinal: desenha num <canvas> 1080x1350 (retrato, bom para WhatsApp e Instagram) um cartão com a marca,
 * o sinal, o histórico do setup neste ativo e um minigráfico, e abre um diálogo para compartilhar, baixar ou copiar.
 *
 * Uso (independente de outros módulos; usa `carregarCandles`, `semSufixo` e `medir` só se existirem na página):
 *   Compartilhar.sinal({ ticker, rotulo, nome, mercado, lado, setupNome, data, casos, ganhos, acerto, medio,
 *                        preco, moeda, serie, arquivo, tf })
 *     serie   : fechamentos (números) até o dia do sinal; sem ela, carrega data/ativos/<arquivo>.json ao abrir
 *     tf      : "D" (padrão, saída 10 pregões depois) ou "W" (8 semanas)
 *     casos < 10: o cartão mostra só o sinal e "histórico insuficiente", sem número inventado
 *   Compartilhar.botao(() => dados, { texto, classe })   botão com ícone que abre o diálogo (dados pode ser promessa/null)
 *   Compartilhar.deEvento(ativo, evento, nomeDoSetup)    dados a partir de um ativo do radar e um evento (bt = [casos, acerto, médio, vantagem])
 *   Compartilhar.melhorEvento(eventos)                    o evento de melhor histórico (nota de Wilson), ou null
 *   Compartilhar.desenhar(dados) -> Promise<HTMLCanvasElement>
 * Estudo estatístico, não é recomendação. Resultado passado não garante resultado futuro. */

window.Compartilhar = (() => {
  const L = 1080, A = 1350, M = 80;
  const MIN_CASOS = 10, PUBLICO = "lubra-lucas.github.io/site-investimentos";
  const COR = { bg: "#0c1016", painel: "#12171f", elev: "#19202a", borda: "#222a35", texto: "#e9eef6", mudo: "#8591a3",
    acento: "#4c8dff", verde: "#22b07d", vermelho: "#f06a6e", ambar: "#e3a23b" };
  const FAMILIA = 'Inter, "Inter Fallback", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
  const AVISO = "Estudo estatístico, não é recomendação. Resultado passado não garante resultado futuro. Sem custos e impostos.";
  const medir = (nome) => { try { window.medir && window.medir(nome); } catch { /* medição é opcional */ } };

  // ------------------------------------------------------------- formatação

  const num = (v, c = 0) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
  const pct = (v, c = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), c)}%`;
  const data4 = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return a && m && d ? `${d}/${m}/${a}` : ""; };
  const moedaTxt = (v, moeda) => {
    const c = v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
    return `${moeda === "USD" ? "US$ " : moeda === "BRL" ? "R$ " : ""}${num(v, c)}`;
  };
  const rotuloDe = (d) => d.rotulo || (typeof semSufixo === "function" ? semSufixo(d.ticker) : String(d.ticker).replace(/\.SA$/, ""));
  const temHistorico = (d) => Number.isFinite(d.casos) && d.casos >= MIN_CASOS && Number.isFinite(d.acerto);
  const ganhosDe = (d) => (Number.isFinite(d.ganhos) ? d.ganhos : Math.round(d.acerto / 100 * d.casos));
  const prazoDe = (d) => (d.tf === "W" ? "8 semanas" : "10 pregões");
  const ROTULO_LADO = { compra: "compra", venda: "venda" };

  /** Endereço público para mostrar na imagem: o do site; em localhost/arquivo local, o endereço real do site. */
  function siteVisivel() {
    const h = location.hostname;
    if (!h || h === "localhost" || h === "127.0.0.1" || location.protocol === "file:") return PUBLICO;
    return h + location.pathname.replace(/[^/]*$/, "").replace(/\/$/, "");
  }
  /** Link da página do ativo, montado a partir do endereço atual (funciona em qualquer domínio). */
  function linkDoAtivo(ticker) {
    const base = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
    return `${base}ativo.html#${encodeURIComponent(ticker)}`;
  }
  function textoCurto(d) {
    const lado = ROTULO_LADO[d.lado];
    const partes = [`${rotuloDe(d)}: ${d.setupNome ?? "sinal"}${lado ? ` (possível oportunidade de ${lado})` : ""}.`];
    if (temHistorico(d)) partes.push(`Neste ativo, nos últimos 6 anos, terminou no lucro ${ganhosDe(d)} de ${d.casos} vezes (${num(d.acerto, 0)}%).`);
    partes.push("Estudo estatístico, não é recomendação.");
    return partes.join(" ");
  }

  // ------------------------------------------------------------- dados

  /** Nota de Wilson (limite inferior de 95%) da taxa de acerto: o mesmo critério do Top do dia e do card. */
  function wilson(ganhos, n, z = 1.96) {
    if (n <= 0) return 0;
    const p = ganhos / n, z2 = z * z;
    return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n) * 100);
  }
  function melhorEvento(eventos) {
    let m = null;
    for (const e of eventos ?? []) {
      const bt = e.bt;
      if (!bt || bt[1] == null || bt[0] < MIN_CASOS) continue;
      const nota = wilson(Math.round(bt[1] / 100 * bt[0]), bt[0]);
      if (!m || nota > m.nota || (nota === m.nota && (bt[2] ?? 0) > (m.e.bt[2] ?? 0))) m = { e, nota };
    }
    return m?.e ?? null;
  }
  /** Dados do cartão a partir de um ativo do radar e de um evento (sinal). */
  function deEvento(a, e, setupNome) {
    const bt = e?.bt && e.bt[1] != null && e.bt[0] >= MIN_CASOS ? e.bt : null;
    return { ticker: a.ticker, rotulo: a.rotulo, nome: a.nome, mercado: a.mercado, lado: e?.lado, setupNome: setupNome ?? e?.setup,
      data: e?.data ?? a.data, casos: bt?.[0], ganhos: bt ? Math.round(bt[1] / 100 * bt[0]) : undefined, acerto: bt?.[1], medio: bt?.[2],
      preco: e?.preco ?? a.ultimo, moeda: a.moeda, arquivo: a.arquivo ?? a.ticker, tf: e?.tf === "W" ? "W" : "D" };
  }
  /** Fechamentos até a data do sinal (no máximo 120), do arquivo do ativo. */
  async function carregarSerie(d) {
    if (typeof carregarCandles !== "function") return null;
    const cand = (await carregarCandles(d.arquivo ?? d.ticker)).candles;
    const ate = d.data ? cand.filter((c) => c.time <= d.data) : cand;
    return (ate.length >= 5 ? ate : cand).slice(-120).map((c) => c.close);
  }

  // ------------------------------------------------------------- desenho

  /** Quebra um texto simples em linhas que cabem em `max` px com a fonte atual do contexto. */
  function quebrar(c, texto, max) {
    const linhas = [];
    let atual = "";
    for (const p of String(texto).split(/\s+/).filter(Boolean)) {
      const t = atual ? `${atual} ${p}` : p;
      if (c.measureText(t).width <= max || !atual) atual = t; else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }
  /** Maior tamanho (de `ini` até `min`) em que o texto cabe em até `maxLinhas` linhas; devolve {px, linhas}. */
  function ajustar(c, texto, peso, ini, min, max, maxLinhas) {
    for (let px = ini; px >= min; px -= 2) {
      c.font = `${peso} ${px}px ${FAMILIA}`;
      const linhas = quebrar(c, texto, max);
      if (linhas.length <= maxLinhas && linhas.every((l) => c.measureText(l).width <= max)) return { px, linhas };
    }
    c.font = `${peso} ${min}px ${FAMILIA}`;
    let linhas = quebrar(c, texto, max);
    if (linhas.length > maxLinhas) {  // último recurso: reticências na última linha permitida
      linhas = linhas.slice(0, maxLinhas);
      let u = linhas[maxLinhas - 1];
      while (u.length > 1 && c.measureText(`${u}…`).width > max) u = u.slice(0, -1);
      linhas[maxLinhas - 1] = `${u}…`;
    }
    return { px: min, linhas };
  }
  /** Parágrafo de trechos [{t, peso, cor}] com quebra por palavras; devolve as linhas (cada uma, uma lista de trechos). */
  function quebrarRico(c, trechos, px, max) {
    const linhas = [[]];
    let x = 0;
    for (const tr of trechos) {
      c.font = `${tr.peso ?? 500} ${px}px ${FAMILIA}`;
      const espaco = c.measureText(" ").width;
      for (const pal of tr.t.split(/([ \t\n]+)/)) {
        if (!pal) continue;
        const w = c.measureText(pal).width;
        if (/^[ \t\n]+$/.test(pal)) { if (x > 0) { linhas.at(-1).push({ ...tr, t: " ", w: espaco }); x += espaco; } continue; }
        if (x + w > max && x > 0) {
          const u = linhas.at(-1);
          if (u.length && u.at(-1).t === " ") u.pop();
          linhas.push([]);
          x = 0;
        }
        linhas.at(-1).push({ ...tr, t: pal, w });
        x += w;
      }
    }
    return linhas;
  }
  function rect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }

  function marca(c, x, y) {  // as três barras do topo do site + nome
    c.fillStyle = COR.acento;
    for (const [bx, by, bh] of [[0, 14, 16], [9, 4, 28], [18, 18, 10]]) { rect(c, x + bx * 1.3, y + (by - 4) * 1.3, 8, bh * 1.3, 2.5); c.fill(); }
    c.textBaseline = "alphabetic";
    c.font = `700 40px ${FAMILIA}`;
    c.fillStyle = COR.texto;
    c.fillText("Carteira ", x + 52, y + 40);
    const w = c.measureText("Carteira ").width;
    c.fillStyle = COR.acento;
    c.fillText("Terminal", x + 52 + w, y + 40);
  }

  function minigrafico(c, serie, x, y, w, h, cor, d) {
    rect(c, x, y, w, h, 28); c.fillStyle = COR.painel; c.fill();
    c.lineWidth = 2; c.strokeStyle = COR.borda; c.stroke();
    const n = serie.length;
    c.textBaseline = "alphabetic";
    c.font = `600 26px ${FAMILIA}`; c.fillStyle = COR.mudo; c.textAlign = "left";
    c.fillText(`Últimos ${n} ${d.tf === "W" ? "fechamentos" : "pregões"}`, x + 36, y + 56);
    const lp = serie.at(-1);
    c.font = `700 30px ${FAMILIA}`; c.fillStyle = COR.texto; c.textAlign = "right";
    c.fillText(moedaTxt(d.preco ?? lp, d.moeda), x + w - 36, y + 56);
    c.textAlign = "left";
    const px0 = x + 36, px1 = x + w - 36, py0 = y + 100, py1 = y + h - 40;
    let lo = Math.min(...serie), hi = Math.max(...serie);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    lo -= pad; hi += pad;
    const X = (i) => px0 + (n === 1 ? 0 : i / (n - 1)) * (px1 - px0 - 18);
    const Y = (v) => py0 + (1 - (v - lo) / (hi - lo)) * (py1 - py0);
    c.strokeStyle = "rgba(255,255,255,0.06)"; c.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) { const gy = py0 + (py1 - py0) * k / 3; c.beginPath(); c.moveTo(px0, gy); c.lineTo(px1, gy); c.stroke(); }
    const g = c.createLinearGradient(0, py0, 0, py1);
    g.addColorStop(0, `${cor}55`); g.addColorStop(1, `${cor}00`);
    c.beginPath(); c.moveTo(X(0), py1);
    serie.forEach((v, i) => c.lineTo(X(i), Y(v)));
    c.lineTo(X(n - 1), py1); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath();
    serie.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.lineWidth = 4.5; c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = cor; c.stroke();
    const ex = X(n - 1), ey = Y(serie[n - 1]);
    c.beginPath(); c.arc(ex, ey, 17, 0, 7); c.fillStyle = `${cor}33`; c.fill();
    c.beginPath(); c.arc(ex, ey, 9, 0, 7); c.fillStyle = cor; c.fill();
    c.lineWidth = 3; c.strokeStyle = COR.painel; c.stroke();
  }

  async function esperarFontes() {
    try {
      if (document.fonts?.load) await Promise.all(["500", "600", "700", "800"].map((p) => document.fonts.load(`${p} 40px Inter`, "Ação 0123")));
      await document.fonts?.ready;
    } catch { /* sem fontes web: cai nas do sistema */ }
  }

  async function desenhar(d) {
    await esperarFontes();
    const cv = document.createElement("canvas");
    cv.width = L; cv.height = A;
    const c = cv.getContext("2d");
    const lado = d.semSinal ? "neutro" : d.lado === "venda" ? "venda" : d.lado === "compra" ? "compra" : "neutro";
    const corLado = lado === "compra" ? COR.verde : lado === "venda" ? COR.vermelho : COR.acento;
    const cheio = temHistorico(d);
    const max = L - 2 * M;

    // fundo: escuro, com um brilho da cor do lado e outro da marca
    c.fillStyle = COR.bg; c.fillRect(0, 0, L, A);
    let g = c.createRadialGradient(L, 0, 0, L, 0, 900);
    g.addColorStop(0, `${corLado}30`); g.addColorStop(1, `${corLado}00`);
    c.fillStyle = g; c.fillRect(0, 0, L, A);
    g = c.createRadialGradient(0, A, 0, 0, A, 800);
    g.addColorStop(0, `${COR.acento}22`); g.addColorStop(1, `${COR.acento}00`);
    c.fillStyle = g; c.fillRect(0, 0, L, A);
    c.fillStyle = corLado; c.fillRect(0, 0, L, 10);

    c.textBaseline = "alphabetic"; c.textAlign = "left";
    // topo: marca e data
    marca(c, M, 64);
    const nomeMercado = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" }[d.mercado] ?? d.mercado;
    const dataTxt = [nomeMercado, d.data ? `Sinal de ${data4(d.data)}` : ""].filter(Boolean).join(" · ");
    if (dataTxt) {
      c.font = `600 26px ${FAMILIA}`;
      const pw = c.measureText(dataTxt).width + 44;
      rect(c, L - M - pw, 66, pw, 52, 26); c.fillStyle = COR.painel; c.fill(); c.lineWidth = 2; c.strokeStyle = COR.borda; c.stroke();
      c.fillStyle = COR.mudo; c.textAlign = "center"; c.fillText(dataTxt, L - M - pw / 2, 101); c.textAlign = "left";
    }

    // selo do lado
    const selo = d.semSinal ? "sem sinal recente" : lado === "compra" ? "possível oportunidade de compra" : lado === "venda" ? "possível oportunidade de venda" : "possível oportunidade";
    c.font = `700 30px ${FAMILIA}`;
    const sw = c.measureText(selo).width + (lado === "neutro" || d.semSinal ? 56 : 112);
    let y = 150;
    rect(c, M, y, sw, 64, 32); c.fillStyle = `${corLado}26`; c.fill(); c.lineWidth = 2.5; c.strokeStyle = `${corLado}99`; c.stroke();
    let tx = M + 28;
    if (lado !== "neutro" && !d.semSinal) {  // triângulo desenhado (não depende de a fonte ter ▲ e ▼)
      const cx = M + 50, cy = y + 34;
      c.beginPath();
      if (lado === "compra") { c.moveTo(cx, cy - 12); c.lineTo(cx + 13, cy + 10); c.lineTo(cx - 13, cy + 10); }
      else { c.moveTo(cx, cy + 12); c.lineTo(cx + 13, cy - 10); c.lineTo(cx - 13, cy - 10); }
      c.closePath(); c.fillStyle = corLado; c.fill();
      tx = M + 80;
    }
    c.fillStyle = corLado; c.fillText(selo, tx, y + 46);

    // ticker e nome
    y += 64;
    const tk = ajustar(c, rotuloDe(d), 800, 150, 80, max, 1);
    c.font = `800 ${tk.px}px ${FAMILIA}`; c.fillStyle = COR.texto;
    y += tk.px * 0.98;
    c.fillText(tk.linhas[0], M - 4, y);
    if (d.nome) {
      const nm = ajustar(c, d.nome, 500, 38, 28, max, 2);
      c.font = `500 ${nm.px}px ${FAMILIA}`; c.fillStyle = COR.mudo;
      for (const ln of nm.linhas) { y += nm.px * 1.3; c.fillText(ln, M, y); }
    }
    // nome do setup
    y += 34;
    const st = ajustar(c, d.setupNome ?? "Sinal", 700, 52, 34, max, 2);
    c.font = `700 ${st.px}px ${FAMILIA}`; c.fillStyle = COR.acento;
    for (const ln of st.linhas) { y += st.px * 1.2; c.fillText(ln, M, y); }
    const fimTopo = y;

    // rodapé (medido antes para o gráfico ocupar o que sobra)
    c.font = `500 25px ${FAMILIA}`;
    const aviso = quebrar(c, AVISO, max);
    const rodapeH = 26 + aviso.length * 34 + 14 + 34;
    const rodapeTopo = A - 52 - rodapeH;

    // frase central
    const px = 40, lh = 56;
    let frase, barra = null, nota = null;
    if (cheio) {
      const gan = ganhosDe(d), ac = Math.round(d.acerto), med = d.medio;
      frase = [
        quebrarRico(c, [{ t: "Este setup apareceu " }, { t: `${num(d.casos)} vezes`, peso: 800, cor: COR.texto }, { t: " neste ativo em 6\u00a0anos." }], px, max),
        quebrarRico(c, [{ t: `${num(gan)} terminaram no lucro (${num(ac)}%)`, peso: 800, cor: ac >= 50 ? COR.verde : COR.vermelho },
          { t: " · retorno médio de\u00a0" }, ...(Number.isFinite(med) ? [{ t: pct(med), peso: 800, cor: med >= 0 ? COR.verde : COR.vermelho }] : [{ t: "—" }]),
          { t: ` em ${prazoDe(d).replace(" ", "\u00a0")}` }], px, max)];
      barra = d.acerto;
      if (lado === "venda") nota = "Na venda, lucro é o preço cair.";
    } else {
      frase = [quebrarRico(c, [{ t: "Histórico insuficiente neste ativo", peso: 800, cor: COR.ambar }], px, max),
        quebrarRico(c, [{ t: `Menos de ${MIN_CASOS} casos deste setup nos últimos 6 anos: pouco para tirar conclusão.` }], 36, max)];
    }
    const paragrafos = frase.map((linhas, k) => {
      const pequeno = k > 0 && !cheio;
      return { linhas, tam: pequeno ? 36 : px, alt: pequeno ? 50 : lh, depois: k === 0 && cheio ? 14 : 0 };
    });
    const alturaFrase = paragrafos.reduce((t, q) => t + q.linhas.length * q.alt + q.depois, 0) + (barra != null ? 46 : 0) + (nota ? 40 : 0);

    // minigráfico: ocupa o espaço entre o setup e a frase
    const serie = Array.isArray(d.serie) ? d.serie.filter(Number.isFinite) : [];
    const livre = rodapeTopo - 30 - alturaFrase - 30 - (fimTopo + 34);
    if (serie.length >= 5 && livre >= 170) {
      const h = Math.min(440, livre);
      minigrafico(c, serie, M, fimTopo + 34 + Math.max(0, (livre - h) / 2), max, h, corLado === COR.acento ? COR.acento : corLado, d);
    }

    // texto da frase, de baixo para cima na área acima do rodapé
    let fy = rodapeTopo - 30 - alturaFrase;
    c.textAlign = "left";
    paragrafos.forEach((q, k) => {
      for (const ln of q.linhas) {
        fy += q.alt;
        let fx = M;
        for (const tr of ln) {
          c.font = `${tr.peso ?? 500} ${q.tam}px ${FAMILIA}`;
          c.fillStyle = tr.cor ?? (k && !cheio ? COR.mudo : "#c6cfdd");
          c.fillText(tr.t, fx, fy - 16);
          fx += tr.w ?? c.measureText(tr.t).width;
        }
      }
      fy += q.depois;
    });
    if (barra != null) {
      const by = fy + 20;
      rect(c, M, by, max, 18, 9); c.fillStyle = `${COR.vermelho}66`; c.fill();
      c.save(); rect(c, M, by, max, 18, 9); c.clip();
      c.fillStyle = COR.verde; c.fillRect(M, by, max * Math.max(0, Math.min(100, barra)) / 100, 18);
      c.restore();
    }
    if (nota) { c.font = `500 26px ${FAMILIA}`; c.fillStyle = COR.mudo; c.fillText(nota, M, fy + 20 + 18 + 30); }

    // rodapé: aviso e endereço
    c.strokeStyle = COR.borda; c.lineWidth = 2;
    c.beginPath(); c.moveTo(M, rodapeTopo); c.lineTo(L - M, rodapeTopo); c.stroke();
    c.font = `500 25px ${FAMILIA}`; c.fillStyle = COR.mudo;
    aviso.forEach((ln, i) => c.fillText(ln, M, rodapeTopo + 26 + 24 + i * 34));
    c.font = `700 32px ${FAMILIA}`; c.fillStyle = COR.acento;
    c.fillText(siteVisivel(), M, A - 52);
    cv.dataset.fonte = lado;
    return cv;
  }

  // ------------------------------------------------------------- diálogo

  const el = (tag, attrs = {}, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat(Infinity)) if (f != null && f !== false) n.append(f instanceof Node ? f : document.createTextNode(f));
    return n;
  };
  const ICONES = {
    compartilhar: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    baixar: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    whatsapp: '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.3 18.7L4 20z"/><path d="M9 9.2c.2 2.6 2.3 4.7 5 5.3l1.1-1.2-1.6-.9-.7.5c-.8-.4-1.5-1.1-1.9-1.9l.5-.7-.9-1.6z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const icone = (nome) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "cp-icone");
    s.innerHTML = ICONES[nome];
    return s;
  };
  const paraBlob = (cv) => new Promise((ok, erro) => cv.toBlob((b) => (b ? ok(b) : erro(new Error("sem imagem"))), "image/png"));

  let aberto = null;
  async function sinal(dados) {
    if (!dados) return;
    aberto?.close();
    medir("compartilhar-sinal");
    const d = { ...dados };
    const abridor = document.activeElement;
    const titulo = el("h2", { id: "cp-titulo", class: "cp-titulo" }, "Compartilhar este sinal");
    const previa = el("div", { class: "cp-previa", "aria-busy": "true" }, el("div", { class: "cp-carregando" }, "Montando a imagem…"));
    const status = el("p", { class: "cp-status sub", role: "status", "aria-live": "polite" });
    const mensagem = (t) => { status.textContent = t; };
    const botao = (nome, rot, fn, cls = "") => el("button", { type: "button", class: `cp-acao ${cls}`, disabled: true, onclick: fn }, icone(nome), el("span", {}, rot));
    let blob = null, url = null, arquivo = null;
    const nomeArquivo = `${rotuloDe(d)}-${d.data ?? "sinal"}.png`.replace(/[^\w.-]+/g, "_");
    const link = linkDoAtivo(d.ticker);
    const texto = `${textoCurto(d)}\n${link}`;

    const bNativo = botao("compartilhar", "Compartilhar", async () => {
      medir("compartilhar-sistema");
      try {
        const base = { title: `${rotuloDe(d)} · Carteira Terminal`, text: texto };
        if (arquivo && navigator.canShare?.({ files: [arquivo] })) await navigator.share({ ...base, files: [arquivo] });
        else await navigator.share({ ...base, url: link, text: textoCurto(d) });
      } catch (e) { if (e?.name !== "AbortError") mensagem("Não foi possível abrir o compartilhamento. Use Baixar imagem."); }
    }, "primario");
    const bBaixar = botao("baixar", "Baixar imagem", () => {
      medir("compartilhar-baixar");
      const a = el("a", { href: url, download: nomeArquivo });
      document.body.append(a); a.click(); a.remove();
      mensagem("Imagem baixada.");
    });
    const bCopiarImg = botao("copiar", "Copiar imagem", async () => {
      medir("compartilhar-copiar-imagem");
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); mensagem("Imagem copiada. Cole na conversa."); }
      catch { mensagem("Não consegui copiar a imagem. Use Baixar imagem."); }
    });
    const bWhats = botao("whatsapp", "WhatsApp", () => {
      medir("compartilhar-whatsapp");
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
      mensagem("A imagem vai pelo botão Compartilhar ou Baixar imagem.");
    });
    const bLink = botao("link", "Copiar link", async () => {
      medir("compartilhar-copiar-link");
      try { await navigator.clipboard.writeText(link); mensagem("Link copiado."); }
      catch {
        const t = el("textarea", { class: "cp-oculto", "aria-hidden": "true" }); t.value = link;
        document.body.append(t); t.select();
        try { document.execCommand("copy"); mensagem("Link copiado."); } catch { mensagem(link); }
        t.remove();
      }
    });
    // o que o navegador não faz, não aparece
    bNativo.hidden = typeof navigator.share !== "function";
    bCopiarImg.hidden = !(window.ClipboardItem && navigator.clipboard?.write);
    bLink.disabled = false;
    bWhats.disabled = false;

    const dlg = el("dialog", { class: "cp-dialogo", "aria-labelledby": "cp-titulo" },
      el("div", { class: "cp-caixa" },
        el("header", { class: "cp-cab" }, titulo,
          el("button", { type: "button", class: "cp-fechar", "aria-label": "Fechar", title: "Fechar (Esc)", onclick: () => dlg.close() }, icone("fechar"))),
        el("div", { class: "cp-corpo" }, previa,
          el("div", { class: "cp-lado" },
            el("p", { class: "cp-ajuda sub" }, "Uma imagem pronta para o WhatsApp e as redes, com o histórico deste sinal neste ativo."),
            el("div", { class: "cp-acoes" }, bNativo, bBaixar, bCopiarImg, bWhats, bLink), status,
            el("p", { class: "cp-aviso sub" }, "Estudo estatístico, não é recomendação. Resultado passado não garante resultado futuro.")))));
    document.body.append(dlg);
    aberto = dlg;
    dlg.addEventListener("close", () => {
      if (url) URL.revokeObjectURL(url);
      dlg.remove();
      if (aberto === dlg) aberto = null;
      try { abridor?.isConnected && abridor.focus({ preventScroll: true }); } catch { /* o foco volta sozinho */ }
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });  // clique no fundo escuro
    dlg.addEventListener("keydown", (e) => {  // foco preso dentro do diálogo
      if (e.key !== "Tab") return;
      const itens = [...dlg.querySelectorAll("button:not([disabled]):not([hidden])")];
      if (!itens.length) return;
      const i = itens.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); itens.at(-1).focus(); }
      else if (!e.shiftKey && (i === itens.length - 1)) { e.preventDefault(); itens[0].focus(); }
    });
    dlg.showModal();
    bLink.focus();

    try {
      if (!Array.isArray(d.serie) && !d.semSerie) d.serie = await carregarSerie(d).catch(() => null);
      if (!dlg.isConnected) return;
      const cv = await desenhar(d);
      blob = await paraBlob(cv);
      if (!dlg.isConnected) return;
      url = URL.createObjectURL(blob);
      try { arquivo = new File([blob], nomeArquivo, { type: "image/png" }); } catch { arquivo = null; }
      const alt = `Cartão do sinal ${d.setupNome ?? ""} em ${rotuloDe(d)}${temHistorico(d) ? `: ${ganhosDe(d)} de ${d.casos} no lucro` : ", histórico insuficiente"}.`;
      previa.replaceChildren(el("img", { src: url, alt, width: L, height: A }));
      previa.removeAttribute("aria-busy");
      for (const b of [bBaixar, bCopiarImg, bNativo]) b.disabled = false;
      bNativo.focus();
    } catch (e) {
      console.error(e);
      previa.replaceChildren(el("div", { class: "cp-carregando" }, "Não consegui montar a imagem."));
      previa.removeAttribute("aria-busy");
      mensagem("Não consegui montar a imagem. O link e o WhatsApp continuam disponíveis.");
    }
    dlg._canvasPronto = true;
  }

  /** Botão com ícone que abre o diálogo. `obter` devolve os dados (ou uma promessa deles; null cancela). */
  function botao(obter, { texto = null, classe = "", titulo = "Compartilhar este sinal: gera uma imagem com o histórico" } = {}) {
    return el("button", { type: "button", class: `cp-botao ${texto ? "com-texto" : ""} ${classe}`, title: titulo, "aria-label": "Compartilhar este sinal",
      onclick: async (e) => { e.preventDefault(); e.stopPropagation(); sinal(await obter()); } }, icone("compartilhar"), texto ? el("span", {}, texto) : null);
  }

  return { sinal, botao, desenhar, deEvento, melhorEvento, linkDoAtivo, textoCurto };
})();
