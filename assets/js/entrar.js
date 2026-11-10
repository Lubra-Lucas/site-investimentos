// Página "Entrar" / "Minha conta". Depende de conta.js (window.Conta) e comum.js (el, montarTopo).
montarTopo("entrar");

(function () {
  const raiz = document.getElementById("conta-raiz");
  const PLANOS = [
    { id: null, nome: "Gratuito", texto: "Top do dia, histórico dos sinais, guia e uma amostra das oportunidades." },
    { id: "inicial", nome: "Inicial", texto: "Oportunidades do dia no modo simples, histórico de cada setup no ativo, simulador e Diário." },
    { id: "pro", nome: "Pro", texto: "Tudo do Inicial, mais modo trader, seus próprios setups, backtest completo e estatísticas por estratégia." },
  ];
  const NOME_PLANO = { inicial: "Inicial", pro: "Pro" };

  const aviso = (tipo, ...filhos) => el("div", { class: `conta-aviso ${tipo}`, role: tipo === "erro" ? "alert" : "status" }, el("p", {}, filhos));
  const mostrar = (...nos) => raiz.replaceChildren(...nos);

  // O Supabase devolve o resultado do link na URL: sucesso (#access_token=...) ou erro (#error=...&error_code=otp_expired).
  function lerRetorno() {
    const h = new URLSearchParams(location.hash.replace(/^#/, "")), q = new URLSearchParams(location.search);
    const pega = (k) => h.get(k) || q.get(k);
    const erro = pega("error"), codigo = pega("error_code");
    const chegando = h.has("access_token") || q.has("code");
    if (erro) {
      try { history.replaceState(null, "", location.pathname); } catch (_) {}
      const expirou = codigo === "otp_expired" || /expired|invalid/i.test(pega("error_description") || "");
      return { erro: expirou ? "Esse link expirou ou já foi usado. Peça um novo abaixo." : "Não foi possível entrar com esse link. Peça um novo abaixo." };
    }
    return { chegando };
  }
  const retorno = lerRetorno();

  if (!window.Conta?.ativa) {
    mostrar(el("section", { class: "conta-cartao" },
      el("h1", {}, "O login ainda não está disponível"),
      el("p", {}, "Enquanto isso, o terminal está liberado, sem precisar de conta."),
      el("a", { class: "conta-btn primario", href: "painel.html" }, "Abrir o Painel"),
      el("p", { class: "conta-leitura" }, el("a", { href: "termos.html" }, "Termos de uso"), " · ", el("a", { href: "privacidade.html" }, "Política de privacidade"))));
    return;
  }

  let avisoInicial = retorno.erro ? aviso("erro", retorno.erro) : null;
  let mostrando = null; // "form" | "enviado" | "conta"

  function formulario(emailInicial = "") {
    mostrando = "form";
    const campo = el("input", { type: "email", id: "campo-email", name: "email", autocomplete: "email", inputmode: "email",
      required: true, placeholder: "voce@exemplo.com", value: emailInicial });
    const msg = el("div", {});
    if (avisoInicial) { msg.append(avisoInicial); avisoInicial = null; }
    const botao = el("button", { type: "submit", class: "conta-btn primario" }, "Receber link de acesso");
    const form = el("form", { class: "conta-form", novalidate: true }, el("label", { for: "campo-email" }, "Seu e-mail"), campo, botao);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = campo.value.trim();
      msg.replaceChildren();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        campo.setAttribute("aria-invalid", "true");
        msg.append(aviso("erro", "Esse e-mail não parece válido. Confira e tente de novo."));
        campo.focus();
        return;
      }
      campo.removeAttribute("aria-invalid");
      botao.disabled = true; botao.textContent = "Enviando…";
      try {
        await Conta.entrarComLink(email);
        enviado(email);
      } catch (err) {
        msg.append(aviso("erro", err.message || Conta.humanizar(err)));
        botao.disabled = false; botao.textContent = "Receber link de acesso";
      }
    });
    const nos = [el("h1", {}, "Entrar"),
      el("p", { class: "conta-sub" }, "Sem senha: enviamos um link para o seu e-mail e basta clicar nele. Se for o seu primeiro acesso, a conta é criada na hora."),
      msg, form];
    if (Conta.googleLigado) {
      const g = el("button", { type: "button", class: "conta-btn" }, "Entrar com Google");
      g.addEventListener("click", async () => {
        g.disabled = true;
        try { await Conta.entrarComGoogle(); }
        catch (err) { g.disabled = false; msg.replaceChildren(aviso("erro", err.message)); }
      });
      nos.push(el("div", { class: "conta-ou" }, "ou"), g);
    }
    nos.push(el("p", { class: "conta-leitura" }, "Ao entrar, você concorda com os ", el("a", { href: "termos.html" }, "Termos de uso"),
      " e a ", el("a", { href: "privacidade.html" }, "Política de privacidade"), "."));
    mostrar(el("section", { class: "conta-cartao" }, nos));
    if (emailInicial) campo.focus({ preventScroll: true });
  }

  function enviado(email) {
    mostrando = "enviado";
    const reenviar = el("button", { type: "button", class: "conta-btn pequeno" }, "Reenviar o link");
    const msg = el("div", {});
    reenviar.addEventListener("click", async () => {
      reenviar.disabled = true; msg.replaceChildren();
      try { await Conta.entrarComLink(email); msg.append(aviso("ok", "Link reenviado.")); }
      catch (err) { msg.append(aviso("erro", err.message)); }
      setTimeout(() => { reenviar.disabled = false; }, 30000);
    });
    const outro = el("button", { type: "button", class: "conta-btn pequeno" }, "Usar outro e-mail");
    outro.addEventListener("click", () => formulario(""));
    mostrar(el("section", { class: "conta-cartao conta-enviado" },
      el("div", { class: "grande", "aria-hidden": "true" }, "✉"),
      el("h1", {}, "Confira seu e-mail"),
      el("p", {}, "Enviamos um link para ", el("b", {}, email), ". Clique nele para entrar; vale por pouco tempo."),
      el("p", { class: "conta-sub" }, "Não chegou? Veja a caixa de spam e a aba Promoções."),
      msg, el("div", { class: "conta-acoes" }, reenviar, outro)));
  }

  function minhaConta(sessao) {
    mostrando = "conta";
    const email = sessao.user?.email || "";
    const planoEl = el("b", {}, "Gratuito");
    const resumo = el("div", { class: "conta-planos" });
    const desenharPlanos = (atual) => {
      planoEl.textContent = NOME_PLANO[atual] || "Gratuito";
      resumo.replaceChildren(...PLANOS.map((p) => el("div", { class: `conta-plano ${p.id === (atual || null) ? "atual" : ""}` },
        el("h3", {}, p.nome, p.id === (atual || null) ? el("span", { class: "etiqueta" }, "Seu plano") : null), el("p", {}, p.texto))));
    };
    desenharPlanos(null);
    Conta.plano().then(desenharPlanos).catch(() => {});
    const sair = el("button", { type: "button", class: "conta-btn conta-sair" }, "Sair");
    sair.addEventListener("click", async () => { sair.disabled = true; try { await Conta.sair(); } catch (_) { sair.disabled = false; } });
    mostrar(
      el("section", { class: "conta-cartao" },
        el("h1", {}, "Minha conta"),
        avisoInicial, retorno.chegando ? aviso("ok", "Pronto, você entrou.") : null,
        el("div", { class: "conta-linha" }, el("span", {}, "E-mail"), el("b", {}, email)),
        el("div", { class: "conta-linha" }, el("span", {}, "Plano atual"), planoEl),
        sair),
      el("section", { class: "conta-cartao" },
        el("h2", {}, "O que cada plano terá"),
        el("p", { class: "conta-sub" }, "As assinaturas ainda não abriram: por enquanto o terminal está liberado para todos."),
        resumo,
        el("p", { class: "conta-leitura" }, "Sua carteira, diário e favoritos continuam guardados só neste navegador.")),
      el("p", { class: "conta-leitura" }, el("a", { href: "painel.html" }, "← Voltar ao Painel"), " · ", el("a", { href: "termos.html" }, "Termos de uso"),
        " · ", el("a", { href: "privacidade.html" }, "Política de privacidade")));
    avisoInicial = null;
  }

  if (retorno.chegando) mostrar(el("p", { class: "conta-carregando" }, "Confirmando seu acesso…"));
  let temporizador = null;
  Conta.aoMudar((sessao) => {
    clearTimeout(temporizador);
    if (sessao) return minhaConta(sessao);
    const mostrarForm = () => { if (mostrando !== "form" && mostrando !== "enviado") formulario(); };
    // Com link na URL, a sessão pode demorar a chegar: espera um pouco antes de mostrar o formulário.
    if (retorno.chegando && !mostrando) {
      temporizador = setTimeout(() => { avisoInicial = aviso("erro", "Não foi possível confirmar o acesso. Peça um novo link."); mostrarForm(); }, 6000);
    } else mostrarForm();
  });
  // biblioteca de login fora do ar: mostra o formulário com explicação em vez de ficar carregando
  Conta.iniciar().catch((e) => { avisoInicial = aviso("erro", Conta.humanizar(e)); if (!mostrando) formulario(); });
})();
