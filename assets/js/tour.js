/* =========================================================
   Tour guiado da página Oportunidades (setups.html). Independente: sem biblioteca, injeta o próprio CSS.
   - Aparece sozinho só na primeira visita (localStorage "tour-v1"); depois, só pelo link
     "Ver o tour de novo" no rodapé.
   - Cada passo aponta um elemento real da página (balão + destaque). Se o elemento não existe ou está
     escondido (por exemplo, o filtro no modo trader ou o menu num celular), o passo é pulado ou usa um alvo alternativo.
   - Teclado: Esc fecha, Tab fica preso no balão, o foco vai para o balão a cada passo.
   - Medição: window.medir("tour-concluido") / window.medir("tour-pulado").
   ========================================================= */
(() => {
  "use strict";

  const CHAVE = "tour-v1";
  const lerFeito = () => { try { return !!localStorage.getItem(CHAVE); } catch (_) { return false; } };
  const gravarFeito = () => { try { localStorage.setItem(CHAVE, "1"); } catch (_) { /* sem armazenamento: o tour pode reaparecer */ } };
  const medir = (e) => { try { window.medir && window.medir(e); } catch (_) { /* medição nunca quebra a página */ } };

  /** Elemento existe e ocupa espaço na tela. */
  const visivel = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const primeiroVisivel = (...seletores) => {
    for (const s of seletores) {
      const el = Array.from(document.querySelectorAll(s)).find(visivel);
      if (el) return el;
    }
    return null;
  };

  /* Passos: `alvo()` devolve o elemento (ou null para pular). `titulo`/`texto` podem depender do alvo achado. */
  const PASSOS = [
    {
      alvo: () => primeiroVisivel("#op-nav", "#op-abrir-nav"),
      titulo: "Comece pelas perguntas",
      texto: (el) => el.id === "op-nav"
        ? "No modo Simples você responde quatro perguntas: comprar ou vender, onde, que tipo de oportunidade e com que frequência acompanha. O terminal filtra os ativos para você. O modo Trader mostra os setups pelo nome."
        : "Toque em Filtros para escolher o que procurar. No modo Simples são quatro perguntas: comprar ou vender, onde, que tipo de oportunidade e com que frequência acompanha.",
    },
    {
      alvo: () => primeiroVisivel("#grade"),
      titulo: "A grade de gráficos",
      texto: () => "Cada gráfico é um ativo em que o sinal se formou. Arraste para navegar, use a roda do mouse para dar zoom e a opção Exibição para mudar o tamanho da grade.",
    },
    {
      alvo: () => {
        // o selo de histórico pode ficar fora da área visível da fileira de chips (que rola): nesse caso aponta a fileira inteira
        const selo = Array.from(document.querySelectorAll(".celula .hist")).find((h) => {
          const r = h.getBoundingClientRect(), c = h.closest(".celula")?.getBoundingClientRect();
          return visivel(h) && c && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
        });
        return selo ?? primeiroVisivel(".celula .celula-setups");
      },
      titulo: "Quantas vezes funcionou",
      texto: () => "No card, os selos dizem qual sinal apareceu e, no histórico, quantas vezes ele já deu certo nesse ativo nos últimos 6 anos. Passe o mouse (ou toque) no selo para ver os detalhes. É um retrato do passado, não uma promessa.",
    },
    {
      alvo: () => primeiroVisivel(".celula .botao-simular-card"),
      titulo: "Simule antes de arriscar",
      texto: () => "O botão Simular monta um trade com entrada, stop e alvo sugeridos. Você ajusta arrastando no gráfico e vê o resultado em R, sem arriscar dinheiro.",
    },
    {
      alvo: () => primeiroVisivel(".topo .nav-principal", ".topo nav"),
      titulo: "O caminho completo",
      texto: () => "No menu, o Diário guarda os trades que você simulou, com o resultado em R. Em Mais ficam o Backtest, que mostra como cada setup se saiu nos últimos 6 anos, a Triagem e a Carteira.",
    },
  ];

  const CSS = `
.tour-bloqueio { position: fixed; inset: 0; z-index: 2000; }
.tour-destaque { position: fixed; z-index: 2001; pointer-events: none; border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(5, 8, 12, 0.72), 0 0 0 2px var(--acento, #4c8dff); transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease; }
.tour-balao { position: fixed; z-index: 2002; box-sizing: border-box; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto;
  padding: 16px; border-radius: 12px; background: var(--bg-elev, #19202a); color: var(--texto, #e4e7ec);
  border: 1px solid var(--borda-forte, #2d3644); box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.8); font: 400 14px/1.5 Inter, system-ui, sans-serif; }
.tour-balao:focus { outline: none; }
.tour-balao:focus-visible { outline: 2px solid var(--acento, #4c8dff); outline-offset: 2px; }
.tour-passo { margin: 0 0 4px; font-size: 12px; color: var(--texto-fraco, #8590a0); letter-spacing: .02em; }
.tour-titulo { margin: 0 0 6px; font-size: 16px; font-weight: 700; }
.tour-texto { margin: 0 0 14px; }
.tour-botoes { display: flex; gap: 8px; align-items: center; }
.tour-botoes .tour-espaco { flex: 1; }
.tour-btn { min-height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--borda-forte, #2d3644); background: transparent; color: inherit; font: 600 14px Inter, system-ui, sans-serif; cursor: pointer; }
.tour-btn:hover { border-color: var(--texto-fraco, #8590a0); }
.tour-btn:focus-visible { outline: 2px solid var(--acento, #4c8dff); outline-offset: 2px; }
.tour-btn.principal { background: var(--acento, #4c8dff); border-color: var(--acento, #4c8dff); color: #fff; }
.tour-btn.fraco { border-color: transparent; color: var(--texto-fraco, #8590a0); }
.tour-rever { margin-left: 8px; padding: 0; border: 0; background: none; color: var(--acento, #4c8dff); font: inherit; text-decoration: underline; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .tour-destaque { transition: none; } }
`;

  let ativo = null; // estado do tour em andamento

  function injetarCss() {
    if (document.getElementById("tour-css")) return;
    const st = document.createElement("style");
    st.id = "tour-css";
    st.textContent = CSS;
    document.head.append(st);
  }

  const criar = (tag, attrs = {}, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...filhos);
    return n;
  };

  function iniciar() {
    if (ativo) return;
    const passos = PASSOS.map((p) => ({ p, el: p.alvo() })).filter((x) => x.el);
    if (!passos.length) return;
    injetarCss();

    const anterior = document.activeElement;
    const bloqueio = criar("div", { class: "tour-bloqueio" });
    const destaque = criar("div", { class: "tour-destaque", "aria-hidden": "true" });
    const rotPasso = criar("p", { class: "tour-passo" });
    const titulo = criar("h2", { class: "tour-titulo", id: "tour-titulo" });
    const texto = criar("p", { class: "tour-texto", id: "tour-texto" });
    const pular = criar("button", { type: "button", class: "tour-btn fraco" }, "Pular");
    const voltar = criar("button", { type: "button", class: "tour-btn" }, "Voltar");
    const proximo = criar("button", { type: "button", class: "tour-btn principal" }, "Próximo");
    const balao = criar("div", { class: "tour-balao", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-titulo", "aria-describedby": "tour-texto", tabindex: "-1" },
      rotPasso, titulo, texto,
      criar("div", { class: "tour-botoes" }, pular, criar("span", { class: "tour-espaco" }), voltar, proximo));
    document.body.append(bloqueio, destaque, balao);

    let i = 0;

    function posicionar() {
      const { el } = passos[i];
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const r = el.getBoundingClientRect();
      // recorta o destaque ao que cabe na tela (a grade, por exemplo, é bem mais alta que o celular)
      const topo = Math.max(r.top, 6), base = Math.min(r.bottom, vh - 6);
      const esq = Math.max(r.left, 6), dir = Math.min(r.right, vw - 6);
      const pad = 6;
      const d = { x: esq - pad, y: topo - pad, w: Math.max(dir - esq, 0) + pad * 2, h: Math.max(base - topo, 0) + pad * 2 };
      Object.assign(destaque.style, { left: d.x + "px", top: d.y + "px", width: d.w + "px", height: d.h + "px" });

      const bw = balao.offsetWidth, bh = balao.offsetHeight, m = 12;
      const abaixo = vh - (d.y + d.h) - m, acima = d.y - m;
      let y;
      if (abaixo >= bh) y = d.y + d.h + m;
      else if (acima >= bh) y = d.y - bh - m;
      else y = vh - bh - m; // não cabe de nenhum lado: fixa embaixo da tela
      y = Math.min(Math.max(y, m), Math.max(vh - bh - m, m));
      const x = Math.min(Math.max(d.x + d.w / 2 - bw / 2, m), Math.max(vw - bw - m, m));
      Object.assign(balao.style, { left: x + "px", top: y + "px" });
    }

    function mostrar(n) {
      i = n;
      const { p, el } = passos[i];
      const alvo = el;
      // traz o alvo para a tela: pequeno fica no centro; grande (ou mais alto que a tela) alinha ao topo
      const r = alvo.getBoundingClientRect();
      const topoFixo = (document.querySelector(".topo")?.getBoundingClientRect().height ?? 0) + 8;
      if (r.top < topoFixo || r.bottom > window.innerHeight) {
        const y = r.height > window.innerHeight * 0.6 ? window.scrollY + r.top - topoFixo : window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
        window.scrollTo({ top: Math.max(y, 0), behavior: "auto" });
      }
      rotPasso.textContent = `Passo ${i + 1} de ${passos.length}`;
      titulo.textContent = p.titulo;
      texto.textContent = p.texto(el);
      voltar.hidden = i === 0;
      const ultimo = i === passos.length - 1;
      proximo.textContent = ultimo ? "Concluir" : "Próximo";
      pular.hidden = ultimo;
      posicionar();
      balao.focus({ preventScroll: true });
    }

    function fechar(concluiu) {
      gravarFeito();
      medir(concluiu ? "tour-concluido" : "tour-pulado");
      removeEventListener("resize", posicionar);
      removeEventListener("scroll", posicionar, true);
      document.removeEventListener("keydown", teclas, true);
      bloqueio.remove(); destaque.remove(); balao.remove();
      ativo = null;
      if (anterior && anterior.focus && document.contains(anterior)) anterior.focus({ preventScroll: true });
    }

    function teclas(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(false); return; }
      if (e.key === "Tab") {
        const foco = Array.from(balao.querySelectorAll("button")).filter((b) => !b.hidden);
        const ult = foco.length - 1;
        if (e.shiftKey && (document.activeElement === foco[0] || document.activeElement === balao)) { e.preventDefault(); foco[ult].focus(); }
        else if (!e.shiftKey && document.activeElement === foco[ult]) { e.preventDefault(); foco[0].focus(); }
        else if (!balao.contains(document.activeElement)) { e.preventDefault(); foco[0].focus(); }
      }
    }

    pular.addEventListener("click", () => fechar(false));
    voltar.addEventListener("click", () => mostrar(Math.max(i - 1, 0)));
    proximo.addEventListener("click", () => (i === passos.length - 1 ? fechar(true) : mostrar(i + 1)));
    addEventListener("resize", posicionar);
    addEventListener("scroll", posicionar, true);
    document.addEventListener("keydown", teclas, true);
    ativo = { fechar };
    mostrar(0);
  }

  /** Link discreto para rever o tour, no rodapé. */
  function linkRever() {
    const rodape = document.querySelector("footer");
    if (!rodape || rodape.querySelector(".tour-rever")) return;
    injetarCss();
    const b = criar("button", { type: "button", class: "tour-rever" }, "Ver o tour de novo");
    b.addEventListener("click", iniciar);
    rodape.append(criar("br"), b);
  }

  /** Espera a página montar os cards (os gráficos chegam depois dos dados) antes de começar. */
  function quandoPronta(fn, limite = 20000) {
    const t0 = Date.now();
    const tenta = () => {
      if (document.querySelector(".celula .botao-simular-card") && visivel(document.querySelector("#grade"))) return fn();
      if (Date.now() - t0 < limite) setTimeout(tenta, 250);
      else fn(); // sem cards (filtro vazio, por exemplo): o tour usa os passos que existirem
    };
    tenta();
  }

  const arrancar = () => {
    linkRever();
    if (!lerFeito()) quandoPronta(() => setTimeout(iniciar, 400));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
