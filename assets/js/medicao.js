// Medição de uso com GoatCounter (sem cookies, sem dado pessoal). Veja docs/medicao.md.
// Vazio = desligado: nada é carregado nem requisitado. Para ligar, coloque o código do site
// (a parte antes de ".goatcounter.com") aqui.
const GOATCOUNTER = "";

(function () {
  "use strict";
  const ligado = !!GOATCOUNTER;

  // Registra um evento (não conta como página vista). Seguro de chamar com a medição desligada.
  function medir(evento) {
    try {
      if (!ligado || !window.goatcounter || typeof window.goatcounter.count !== "function") return;
      window.goatcounter.count({ path: String(evento), title: String(evento), event: true });
    } catch (_) { /* medição nunca pode quebrar a página */ }
  }
  window.medir = medir;
  if (!ligado) return;

  // Carrega o count.js do GoatCounter (conta a visualização de página sozinho)
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = "https://" + GOATCOUNTER + ".goatcounter.com/count";
  document.head.appendChild(s);

  // Eventos por delegação de cliques, sem mexer nos outros scripts
  document.addEventListener("click", (e) => {
    const alvo = e.target && e.target.closest ? e.target : null;
    if (!alvo) return;
    const plano = alvo.closest("[data-plano]");
    if (plano) return medir("plano-" + (plano.getAttribute("data-plano") || "?"));
    if (alvo.closest(".botao-simular-card")) return medir("simular-card");
    if (alvo.closest(".hero-acoes .botao-primario")) return medir("hero-cta");
  });
})();
