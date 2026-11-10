/* Favoritos: a estrela ☆/★ que põe um ativo na "Minha lista" (a lista que a Carteira mostra) e o aviso de dados
 * mais claro. Carregue depois de comum.js.
 *
 * Armazenamento: a MESMA chave e o MESMO formato da Minha lista da Carteira (carteira.js / eventos.js,
 * MinhaLista): localStorage "multitela", campo `tickers` = texto "PETR4, GOOGL, VALE3" (rótulos separados por
 * vírgula). Sem nada salvo, vale a lista padrão da Carteira. Os outros campos do objeto são preservados.
 *
 * Uso:
 *   Favoritos.definirAtivos(R.ativos);          // para casar "PETR4" com "PETR4.SA"
 *   Favoritos.botao(ticker)                      // <button class="fav-estrela">; todos os do mesmo ativo ficam em sincronia
 *   Favoritos.tem(ticker) / Favoritos.alternar(ticker) / Favoritos.quantos()
 *   document.addEventListener("favoritos", ...)  // depois de qualquer mudança (nesta ou em outra aba)
 */
window.Favoritos = (() => {
  const CHAVE = "multitela", PADRAO = "PETR4, GOOGL, VALE3, NVDA";
  let ativos = [], conjunto = null;

  const ler = () => {
    const txt = guardar.ler(CHAVE, {}).tickers ?? PADRAO;
    return [...new Set(String(txt).split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  };
  const gravar = (rotulos) => {
    const atual = guardar.ler(CHAVE, {});
    guardar.gravar(CHAVE, { ...(atual && typeof atual === "object" ? atual : {}), tickers: rotulos.join(", ") });
    conjunto = null;
  };
  const rotuloDe = (tk) => {
    const a = ativos.find((x) => x.ticker === tk);
    return (a?.rotulo ?? semSufixo(tk)).toUpperCase();
  };
  /** Tickers (como nos dados) que estão na lista; entradas que não existem nos dados ficam de fora. */
  const tickers = () => {
    if (!conjunto) conjunto = new Set(ler().map((t) => acharAtivo(ativos, t)).filter(Boolean));
    return conjunto;
  };
  const tem = (tk) => tickers().has(tk);
  const quantos = () => ler().length;

  function sincronizar() {
    const nomeAtivo = (b) => b.dataset.tk;
    document.querySelectorAll(".fav-estrela[data-tk]").forEach((b) => {
      const on = tem(nomeAtivo(b)), rot = semSufixo(nomeAtivo(b));
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "★" : "☆";
      b.title = on ? "Remover da minha lista" : "Adicionar à minha lista";
      b.setAttribute("aria-label", `${on ? "Remover" : "Adicionar"} ${rot} ${on ? "da" : "à"} minha lista`);
    });
    document.querySelectorAll(".celula[data-tk], .tri-cartao[data-tk]").forEach((c) => c.classList.toggle("na-lista", tem(c.dataset.tk)));
  }
  const avisar = () => { sincronizar(); document.dispatchEvent(new CustomEvent("favoritos")); };

  /** Aviso rápido: o toast do site (arrastar.js) ou o aviso do Diário, se a página tiver um deles. */
  function toast(msg, acao) {
    if (window.Arrastar?.toast) return window.Arrastar.toast(msg, acao);
    if (window.avisoRapido) return window.avisoRapido(msg, acao ? { rot: acao[0], fazer: acao[1] } : undefined);
    return null;
  }

  function alternar(tk, { silencioso = false } = {}) {
    const rot = semSufixo(tk), atual = ler();
    if (tem(tk)) {
      const antes = atual;
      gravar(atual.filter((r) => acharAtivo(ativos, r) !== tk));
      avisar();
      if (!silencioso) toast(`${rot} removido da sua lista`, ["Desfazer", () => { gravar(antes); avisar(); }]);
      return false;
    }
    gravar([...atual, rotuloDe(tk)]);
    avisar();
    if (!silencioso) toast(`${rot} adicionado à sua lista`, ["Ver lista", () => { location.href = "carteira.html"; }]);
    return true;
  }

  function botao(tk, classe = "") {
    const b = el("button", { type: "button", class: `fav-estrela ${classe}`, "data-tk": tk,
      onclick: (e) => { e.stopPropagation(); alternar(tk); } });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());  // não inicia o arrastar do card
    // preenche já com o estado atual
    const on = tem(tk);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "★" : "☆";
    b.title = on ? "Remover da minha lista" : "Adicionar à minha lista";
    b.setAttribute("aria-label", `${on ? "Remover" : "Adicionar"} ${semSufixo(tk)} ${on ? "da" : "à"} minha lista`);
    return b;
  }

  // outra aba mexeu na lista: acompanha
  addEventListener("storage", (e) => { if (e.key === CHAVE || e.key === null) { conjunto = null; avisar(); } });

  /** Linhas extras para o painel "?" do topo (Atalhos), sem mexer no comum.js. */
  function ajudaAtalhos(itens, dicas = []) {
    const painel = document.getElementById("painel-ajuda");
    if (!painel) return;
    const dl = painel.querySelector("dl.atalhos");
    if (dl) for (const [teclas, texto] of itens)
      dl.append(el("dt", {}, teclas.flatMap((t, i) => [i ? " " : null, el("kbd", {}, t)]).filter(Boolean)), el("dd", {}, texto));
    const ul = painel.querySelector("ul");
    if (ul) for (const d of dicas) ul.append(el("li", {}, d));
  }

  /**
   * Aviso de dados: mesma regra de `avisoFormacao` (comum.js: pregão em andamento e a hora prevista dos sinais),
   * com texto para leigo e visual discreto. Quando a hora passa, oferece "Atualizar" (recarrega a página).
   */
  function avisoDados(R) {
    const caixa = el("div", { class: "aviso-dados", hidden: true });
    const nomes = { BR: "Brasil", US: "EUA", CRIPTO: "Cripto", MACRO: "Macro" };
    const lista = (m) => (m.length > 1 ? `${m.slice(0, -1).join(", ")} e ${m.at(-1)}` : m[0]);
    const atualizar = () => {
      const grupos = new Map();
      for (const [m, f] of Object.entries(R.em_formacao ?? {})) {
        // os que já deviam ter saído viram um aviso só ("Novos sinais de Macro e Cripto..."); os demais, um por horário
        const chave = Date.parse(f.sinais_em) > Date.now() ? `${f.data}|${f.sinais_em}` : "ja-saiu";
        if (!grupos.has(chave)) grupos.set(chave, { ...f, mercados: [] });
        else if (f.sinais_em > grupos.get(chave).sinais_em) grupos.get(chave).sinais_em = f.sinais_em;
        grupos.get(chave).mercados.push(nomes[m] ?? m);
      }
      caixa.hidden = !grupos.size;
      caixa.replaceChildren(...[...grupos.values()].sort((a, b) => a.sinais_em.localeCompare(b.sinais_em)).map((g) => {
        const falta = Date.parse(g.sinais_em) - Date.now();
        const hora = new Date(g.sinais_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const onde = lista(g.mercados);
        const dica = `O pregão de ${fmtData(g.data)} ainda não fechou: o candle aparece no gráfico como "em formação", ` +
          `mas só gera sinais depois do fechamento, na atualização prevista para ${hora}.`;
        return falta > 0
          ? el("span", { class: "aviso-dados-item", title: dica }, el("i", { class: "aviso-dados-ponto", "aria-hidden": "true" }),
            `${onde}: os sinais de ${fmtData(g.data)} saem em ${fmtDuracao(falta)} (≈ ${hora})`)
          : el("span", { class: "aviso-dados-item", title: `Os sinais de ${fmtData(g.data)} (${onde}) já deviam ter saído; recarregue a página para ver.` },
            el("i", { class: "aviso-dados-ponto", "aria-hidden": "true" }),
            `Novos sinais de ${onde} devem estar disponíveis `,
            el("button", { type: "button", class: "botao-link aviso-dados-atualizar", onclick: () => location.reload() }, "Atualizar"));
      }));
    };
    atualizar();
    setInterval(atualizar, 30000);
    return caixa;
  }

  return { ler, gravar, tem, quantos, alternar, botao, sincronizar, toast, tickers,
    definirAtivos(a) { ativos = a ?? []; conjunto = null; }, ajudaAtalhos, avisoDados, CHAVE };
})();
