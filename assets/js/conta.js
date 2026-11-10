/* Conta do usuário (login com Supabase). Veja docs/login-e-pagamento.md ("Como ligar").
   Sem supabaseUrl e supabaseAnonKey em config.js: Conta.ativa = false e este arquivo não faz mais nada
   (nenhum botão, nenhum script externo, nenhuma requisição).
   Com configuração: carrega o supabase-js (CDN, versão fixa) e expõe Conta.* para o resto do site. */
(function () {
  "use strict";
  const cfg = window.CT_CONFIG || {};
  const URL_BASE = String(cfg.supabaseUrl || "").trim().replace(/\/+$/, "");
  const CHAVE = String(cfg.supabaseAnonKey || "").trim();
  const ativa = /^https:\/\/[^/\s]+$/.test(URL_BASE) && CHAVE.length > 0;

  const Conta = { ativa, googleLigado: ativa && cfg.loginGoogle === true };
  window.Conta = Conta;
  if (!ativa) return;

  // O estilo do botão do topo vem junto (as páginas do terminal não carregam conta.css por conta própria).
  try {
    if (!document.querySelector('link[href$="conta.css"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = new URL("../css/conta.css", document.currentScript?.src || new URL("assets/js/conta.js", location.href)).href;
      document.head.appendChild(css);
    }
  } catch (_) {}

  const LIB ="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const PAGINA_ENTRAR = () => new URL("entrar.html", location.href).href;

  let cliente = null, sessaoAtual = null, resolvido = false, promessaCliente = null;
  const ouvintes = new Set();
  const emitir = () => ouvintes.forEach((f) => { try { f(sessaoAtual); } catch (_) {} });

  function carregarLib() {
    if (window.supabase?.createClient) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = LIB; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => (window.supabase?.createClient ? ok() : falha(new Error("lib")));
      s.onerror = () => falha(new Error("lib"));
      document.head.appendChild(s);
    });
  }

  /** Carrega a biblioteca e cria o cliente (uma vez só). Rejeita se a biblioteca não carregar. */
  function iniciar() {
    if (promessaCliente) return promessaCliente;
    promessaCliente = carregarLib().then(async () => {
      cliente = window.supabase.createClient(URL_BASE, CHAVE, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = await cliente.auth.getSession();
      sessaoAtual = data?.session ?? null;
      resolvido = true;
      cliente.auth.onAuthStateChange((_ev, s) => { sessaoAtual = s ?? null; setTimeout(emitir, 0); });
      emitir();
      return cliente;
    }).catch((e) => { promessaCliente = null; resolvido = true; emitir(); throw e; });
    return promessaCliente;
  }

  /** Traduz erros do Supabase/rede em mensagem para a pessoa. */
  function humanizar(e) {
    const m = String(e?.message || e || "").toLowerCase(), st = e?.status;
    if (m === "lib" || m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed"))
      return "Não deu para falar com o servidor de login. Confira sua conexão e tente de novo.";
    if (st === 429 || m.includes("rate limit") || m.includes("security purposes"))
      return "Muitos pedidos seguidos. Espere um minuto e peça um novo link.";
    if (m.includes("invalid") && m.includes("email")) return "Esse e-mail não parece válido. Confira e tente de novo.";
    if (m.includes("expired") || m.includes("otp")) return "Esse link expirou ou já foi usado. Peça um novo.";
    if (m.includes("provider") && m.includes("enabled")) return "O login com Google ainda não está ligado.";
    return "Não foi possível concluir. Tente de novo em instantes.";
  }
  Conta.humanizar = humanizar;
  Conta.iniciar = iniciar;

  Conta.sessao = async () => { await iniciar(); return sessaoAtual; };
  Conta.usuario = async () => (await Conta.sessao())?.user ?? null;
  Conta.aoMudar = (fn) => {
    ouvintes.add(fn);
    iniciar().catch(() => {});
    if (resolvido) setTimeout(() => fn(sessaoAtual), 0);
    return () => ouvintes.delete(fn);
  };

  Conta.entrarComLink = async (email) => {
    const c = await iniciar();
    const { error } = await c.auth.signInWithOtp({ email: String(email).trim(), options: { emailRedirectTo: PAGINA_ENTRAR() } });
    if (error) throw Object.assign(new Error(humanizar(error)), { original: error });
  };
  Conta.entrarComGoogle = async () => {
    if (!Conta.googleLigado) throw new Error("O login com Google não está ligado.");
    const c = await iniciar();
    const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: PAGINA_ENTRAR() } });
    if (error) throw Object.assign(new Error(humanizar(error)), { original: error });
  };
  Conta.sair = async () => {
    const c = await iniciar();
    await c.auth.signOut();
    sessaoAtual = null; emitir();
  };

  /** 'inicial', 'pro' ou null (gratuito). Tolera a tabela não existir ou a leitura falhar. */
  Conta.plano = async () => {
    try {
      const u = await Conta.usuario();
      if (!u) return null;
      const { data, error } = await cliente.from("assinaturas").select("plano,status,valido_ate").eq("user_id", u.id).maybeSingle();
      if (error || !data) return null;
      if (!["ativa", "teste"].includes(data.status)) return null;
      if (data.valido_ate && new Date(data.valido_ate) < new Date()) return null;
      return data.plano === "pro" || data.plano === "inicial" ? data.plano : null;
    } catch (_) { return null; }
  };

  /* ---- Sincronização (ESQUELETO, ainda não ligado a nada) ----
     Guarda um valor JSON por usuário e chave na tabela dados_usuario. Chaves candidatas, hoje só no localStorage:
     "carteira-usuario-v1" (carteira), "multitela" (favoritos), "simulacoes-v1" (trades simulados do diário, em simulador.js; "diario-exemplo-v1" é só demonstração), "plano-v1" e "plano-config-v1" (plano de trade), "notas-v1", "desenhos-v1". */
  Conta.salvarDado = async (chave, valor) => {
    const u = await Conta.usuario();
    if (!u) return { ok: false, erro: "sem-sessao" };
    const { error } = await cliente.from("dados_usuario")
      .upsert({ user_id: u.id, chave: String(chave), valor, atualizado_em: new Date().toISOString() }, { onConflict: "user_id,chave" });
    return error ? { ok: false, erro: error.message } : { ok: true };
  };
  Conta.lerDado = async (chave) => {
    const u = await Conta.usuario();
    if (!u) return null;
    const { data, error } = await cliente.from("dados_usuario").select("valor,atualizado_em").eq("user_id", u.id).eq("chave", String(chave)).maybeSingle();
    return error || !data ? null : data;
  };

  /* ---- Botão do topo (ponto de extensão chamado por montarTopo em comum.js) ---- */
  const abrevia = (e) => { e = String(e || ""); return e.length > 22 ? e.slice(0, 10) + "…" + e.slice(e.indexOf("@")) : e; };
  Conta.botaoTopo = function () {
    const raiz = document.createElement("div");
    raiz.className = "conta-topo";
    const desenhar = (s) => {
      raiz.replaceChildren();
      if (!s) {
        const a = document.createElement("a");
        a.className = "conta-entrar"; a.href = "entrar.html"; a.textContent = "Entrar";
        raiz.append(a);
        return;
      }
      const email = s.user?.email || "";
      const b = document.createElement("button");
      b.type = "button"; b.className = "conta-menu-botao"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-haspopup", "true");
      b.title = email; b.setAttribute("aria-label", `Conta de ${email}`);
      const ini = document.createElement("span"); ini.className = "conta-inicial"; ini.textContent = (email[0] || "?").toUpperCase();
      const nome = document.createElement("span"); nome.className = "conta-nome"; nome.textContent = abrevia(email);
      b.append(ini, nome);
      const lista = document.createElement("div");
      lista.className = "conta-menu"; lista.hidden = true;
      const mail = document.createElement("p"); mail.className = "conta-menu-email"; mail.textContent = email;
      const minha = document.createElement("a"); minha.href = "entrar.html"; minha.textContent = "Minha conta";
      const sair = document.createElement("button"); sair.type = "button"; sair.textContent = "Sair";
      sair.addEventListener("click", () => { Conta.sair().catch(() => {}); });
      lista.append(mail, minha, sair);
      const abrir = (v) => { lista.hidden = !v; b.setAttribute("aria-expanded", String(v)); };
      b.addEventListener("click", (e) => { e.stopPropagation(); abrir(lista.hidden); });
      raiz.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lista.hidden) { abrir(false); b.focus(); } });
      document.addEventListener("click", (e) => { if (!raiz.contains(e.target)) abrir(false); });
      raiz.append(b, lista);
    };
    // Sem esperar a rede: se já há sessão guardada no navegador, evita piscar "Entrar" antes de saber.
    let guardada = false;
    try { guardada = Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k)); } catch (_) {}
    if (guardada) {
      raiz.classList.add("carregando");
      const p = document.createElement("span"); p.className = "conta-inicial"; p.textContent = "·"; raiz.append(p);
    } else desenhar(null);
    Conta.aoMudar((s) => { raiz.classList.remove("carregando"); desenhar(s); });
    return raiz;
  };
})();
