/* Rastreador da Multitela: o usuário escolhe um modelo pronto (tendência de alta, pullback na
 * MME 9, IFR sobrevendido...) ou monta as próprias regras, no diário ou no semanal, e a grade
 * mostra todos os ativos que atendem a TODAS as regras. Os indicadores vêm prontos de
 * data/rastreador.json (scripts/rastreador.py), sempre com candles fechados.
 *
 * Séries (preço, médias, osciladores) vêm com os últimos 10 valores, do mais antigo para o mais
 * recente; volume relativo, variação, máximas anteriores e percentil da Bollinger vêm como lista
 * dos últimos 5 candles. Assim dá para avaliar as regras em cada um dos 5 últimos candles
 * ("aconteceu no último pregão" ou "nos últimos N"). */

const carregarRastreador = () => buscarJSON("data/rastreador.json");

const ult = (arr, k = 0) => (arr ? arr[arr.length - 1 - k] ?? null : null);
const UNID = { D: ["pregão", "pregões"], W: ["semana", "semanas"] };
const unid = (tf, n) => `${n} ${UNID[tf][n === 1 ? 0 : 1]}`;
const TF_FRASE = { D: "diário", W: "semanal" };

// ------------------------------------------------------------- médias

/** "sma20" -> { tipo: "sma", n: 20 } */
const lerMedia = (m) => ({ tipo: m.slice(0, 3), n: +m.slice(3) });
const nomeMedia = (m) => `${m.startsWith("ema") ? "MME" : "MMS"} ${m.slice(3)}`;
const serieMedia = (s, m) => s?.[m.slice(0, 3)]?.[m.slice(3)] ?? null;
const pct = (a, b) => (a == null || b == null || !b ? null : (a / b - 1) * 100);
const br = (v, casas = 1) => fmtNum(v, casas);

/** A janela mais próxima entre as disponíveis no tempo gráfico (21 pregões ~ 4 semanas...). */
function janelaProxima(lista, v) {
  if (lista.includes(+v)) return +v;
  return lista.reduce((m, x) => (Math.abs(x - v) < Math.abs(m - v) ? x : m), lista[0]);
}

// ------------------------------------------------------------- regras

const OP = [["acima", "acima de"], ["abaixo", "abaixo de"]];
// pullback: o quanto o candle pode ficar da média, em ATR (iguais aos de scripts/estrategias.py)
const PB_TOQUE_ATR = 0.25, PB_FECHAMENTO_ATR = 1, PB_VIOLACAO_ATR = 1;
const campo = {
  media: (k, rot = "") => ({ k, tipo: "media", rot }),
  sel: (k, opcoes, rot = "") => ({ k, tipo: "sel", opcoes, rot }),
  num: (k, rot, sufixo = "", passo = 1) => ({ k, tipo: "num", rot, sufixo, passo }),
};

/**
 * Tipos de condição. Cada um: nome, grupo, campos do editor, padrão, avaliar(foto, p, tf, F)
 * -> true/false (null = sem dado), texto(p, tf, F) e valor(foto, p, tf, F) para mostrar no card.
 */
const CONDICOES = {
  preco_media: {
    nome: "Fechamento x média", grupo: "Médias",
    campos: [campo.sel("lado", [["acima", "Fechamento acima da"], ["abaixo", "Fechamento abaixo da"]]), campo.media("media")],
    padrao: { lado: "acima", media: "sma20" },
    avaliar(s, p) {
      const c = ult(s.c), m = ult(serieMedia(s, p.media));
      return c == null || m == null ? null : p.lado === "acima" ? c > m : c < m;
    },
    texto: (p) => `Fechamento ${p.lado} da ${nomeMedia(p.media)}`,
    valor: (s, p) => `${fmtPct(pct(ult(s.c), ult(serieMedia(s, p.media))))} da ${nomeMedia(p.media)}`,
  },
  media_media: {
    nome: "Média x média", grupo: "Médias",
    campos: [campo.media("a"), campo.sel("lado", OP), campo.media("b")],
    padrao: { a: "sma20", lado: "acima", b: "sma50" },
    avaliar(s, p) {
      const a = ult(serieMedia(s, p.a)), b = ult(serieMedia(s, p.b));
      return a == null || b == null ? null : p.lado === "acima" ? a > b : a < b;
    },
    texto: (p) => `${nomeMedia(p.a)} ${p.lado} da ${nomeMedia(p.b)}`,
  },
  inclinacao: {
    nome: "Inclinação da média", grupo: "Médias",
    campos: [campo.media("media"), campo.sel("dir", [["sobe", "subindo"], ["cai", "caindo"]])],
    padrao: { media: "sma50", dir: "sobe" },
    avaliar(s, p) {
      const m = serieMedia(s, p.media);
      if (!m || ult(m, 5) == null || ult(m) == null) return null;
      return p.dir === "sobe" ? ult(m) > ult(m, 5) : ult(m) < ult(m, 5);
    },
    texto: (p, tf) => `${nomeMedia(p.media)} ${p.dir === "sobe" ? "subindo" : "caindo"} (vs. ${unid(tf, 5)} atrás)`,
    valor: (s, p, tf) => `${nomeMedia(p.media)} ${fmtPct(pct(ult(serieMedia(s, p.media)), ult(serieMedia(s, p.media), 5)))} em ${unid(tf, 5)}`,
  },
  pullback: {
    nome: "Pullback na média", grupo: "Médias",
    campos: [campo.sel("lado", [["compra", "Pullback de compra na"], ["venda", "Pullback de venda na"]]), campo.media("media"),
      campo.sel("modo", [["rejeicao", "rejeição"], ["retomada", "rejeição ou violação e retomada"]]),
      campo.sel("positivo", [["nao", "qualquer fechamento"], ["sim", "+ fechamento a favor"]])],
    padrao: { lado: "compra", media: "sma20", modo: "retomada", positivo: "nao" },
    avaliar(s, p) {
      const m = serieMedia(s, p.media);
      if (!m || ult(m) == null || ult(s.c) == null) return null;
      const compra = p.lado === "compra";
      const lado = compra ? 1 : -1;
      const favor = (c, mm) => (compra ? c > mm : c < mm);
      if (!favor(ult(s.c), ult(m))) return false;
      // o candle precisa estar NA média: a sombra encosta nela (folga de 1/4 de ATR) e o fechamento
      // fica a até 1 ATR. Sem isso, um gap que se afasta da média passaria como "retomada".
      const atr = ult(s.c) * (s.atr ?? 2) / 100;
      const sombra = compra ? ult(s.l) : ult(s.h);
      if (lado * (sombra - ult(m)) > PB_TOQUE_ATR * atr) return false;
      if (lado * (ult(s.c) - ult(m)) > PB_FECHAMENTO_ATR * atr) return false;
      // rejeição: a sombra furou a média e o candle fechou do lado certo
      const rejeicao = lado * (sombra - ult(m)) <= 0 && favor(ult(s.c, 1), ult(m, 1));
      // violação e retomada: fechou do outro lado por 1 ou 2 candles (pouco além da média),
      // vindo do lado certo antes disso. Mais tempo ou mais fundo é virada, não pullback.
      const contra = (k) => ult(m, k) != null && !favor(ult(s.c, k), ult(m, k))
        && lado * (ult(m, k) - ult(s.c, k)) <= PB_VIOLACAO_ATR * atr;
      const veioDoLado = (k) => ult(m, k) != null && favor(ult(s.c, k), ult(m, k));
      const retomada = p.modo === "retomada" && (
        (contra(1) && veioDoLado(2)) || (contra(1) && contra(2) && veioDoLado(3)));
      if (!rejeicao && !retomada) return false;
      return p.positivo !== "sim" || (compra ? ult(s.c) > ult(s.c, 1) : ult(s.c) < ult(s.c, 1));
    },
    texto: (p) => `Pullback de ${p.lado} na ${nomeMedia(p.media)} (${p.modo === "rejeicao" ? "rejeição" : "rejeição ou violação e retomada"}, candle na média` +
      `${p.positivo === "sim" ? ", + fechamento a favor" : ""})`,
    valor: (s, p) => `${fmtPct(pct(ult(s.c), ult(serieMedia(s, p.media))))} da ${nomeMedia(p.media)}`,
  },
  cruzamento: {
    nome: "Preço cruzou a média", grupo: "Médias",
    campos: [campo.sel("dir", [["cima", "Fechamento cruzou para cima a"], ["baixo", "Fechamento cruzou para baixo a"]]), campo.media("media")],
    padrao: { dir: "cima", media: "sma20" },
    avaliar(s, p) {
      const m = serieMedia(s, p.media);
      if (!m || ult(m, 1) == null) return null;
      return p.dir === "cima" ? ult(s.c, 1) <= ult(m, 1) && ult(s.c) > ult(m) : ult(s.c, 1) >= ult(m, 1) && ult(s.c) < ult(m);
    },
    texto: (p) => `Fechamento cruzou a ${nomeMedia(p.media)} para ${p.dir} no último candle`,
  },
  cruzamento_medias: {
    nome: "Média cruzou média", grupo: "Médias",
    campos: [campo.media("a"), campo.sel("dir", [["cima", "cruzou para cima a"], ["baixo", "cruzou para baixo a"]]), campo.media("b")],
    padrao: { a: "sma50", dir: "cima", b: "sma200" },
    avaliar(s, p) {
      const a = serieMedia(s, p.a), b = serieMedia(s, p.b);
      if (!a || !b || ult(a, 2) == null || ult(b, 2) == null) return null;
      // nos últimos 2 candles, para não perder o cruzamento de ontem
      const acima = (k) => ult(a, k) > ult(b, k);
      return p.dir === "cima" ? acima(0) && (!acima(1) || !acima(2)) : !acima(0) && (acima(1) || acima(2));
    },
    texto: (p) => `${nomeMedia(p.a)} cruzou a ${nomeMedia(p.b)} para ${p.dir} (últimos 2 candles)`,
  },
  distancia: {
    nome: "Distância da média", grupo: "Médias",
    campos: [campo.sel("lado", [["acima", "Fechamento acima da"], ["abaixo", "Fechamento abaixo da"]]), campo.media("media"),
      campo.num("valor", "por pelo menos", "", 0.5),
      campo.sel("modo", [["normal", "× a distância normal do ativo"], ["pct", "%"]])],
    padrao: { lado: "abaixo", media: "sma20", valor: 2.5, modo: "normal" },
    avaliar(s, p) {
      const d = pct(ult(s.c), ult(serieMedia(s, p.media)));
      if (d == null) return null;
      const lado = p.lado === "acima" ? d : -d;
      if (lado <= 0) return false;
      if (p.modo === "pct") return lado >= p.valor;
      const normal = p.media.startsWith("sma") ? s.dn?.[p.media.slice(3)] : null;
      return normal ? lado >= p.valor * normal : null;
    },
    texto: (p) => `Fechamento ${p.lado} da ${nomeMedia(p.media)} por ${br(p.valor)}${p.modo === "pct" ? "% ou mais" : "× a distância normal ou mais"}`,
    valor(s, p) {
      const d = pct(ult(s.c), ult(serieMedia(s, p.media)));
      const normal = p.media.startsWith("sma") ? s.dn?.[p.media.slice(3)] : null;
      return `${fmtPct(d)} da ${nomeMedia(p.media)}${normal ? ` (${br(Math.abs(d) / normal)}× o normal)` : ""}`;
    },
  },
  ifr: {
    nome: "IFR", grupo: "Osciladores",
    campos: [campo.sel("n", null, "IFR"), campo.sel("op", OP), campo.num("valor", "")],
    padrao: { n: 14, op: "abaixo", valor: 30 },
    opcoes: { n: (F) => F.periodos_ifr.map((n) => [n, String(n)]) },
    avaliar(s, p) {
      const v = ult(s.ifr?.[p.n]);
      return v == null ? null : p.op === "abaixo" ? v < p.valor : v > p.valor;
    },
    texto: (p) => `IFR ${p.n} ${p.op} de ${p.valor}`,
    valor: (s, p) => `IFR ${p.n} ${br(ult(s.ifr?.[p.n]), 0)}`,
  },
  estocastico: {
    nome: "Estocástico lento", grupo: "Osciladores",
    campos: [campo.sel("linha", [["k", "Estocástico %K"], ["d", "Estocástico %D"]]), campo.sel("op", OP), campo.num("valor", "")],
    padrao: { linha: "k", op: "abaixo", valor: 20 },
    avaliar(s, p) {
      const v = ult(p.linha === "d" ? s.kd : s.k);
      return v == null ? null : p.op === "abaixo" ? v < p.valor : v > p.valor;
    },
    texto: (p) => `Estocástico lento (14,3,3) %${p.linha.toUpperCase()} ${p.op} de ${p.valor}`,
    valor: (s) => `%K ${br(ult(s.k), 0)}`,
  },
  estoc_cruz: {
    nome: "Estocástico: %K cruzou a %D", grupo: "Osciladores",
    campos: [campo.sel("dir", [["cima", "%K cruzou a %D para cima"], ["baixo", "%K cruzou a %D para baixo"]]),
      campo.sel("zona", [["qualquer", "em qualquer nível"], ["extremo", "saindo da zona extrema (20/80)"]])],
    padrao: { dir: "cima", zona: "extremo" },
    avaliar(s, p) {
      const [k1, k0, d1, d0] = [ult(s.k, 1), ult(s.k), ult(s.kd, 1), ult(s.kd)];
      if ([k1, k0, d1, d0].some((v) => v == null)) return null;
      const cruzou = p.dir === "cima" ? k1 <= d1 && k0 > d0 : k1 >= d1 && k0 < d0;
      const zona = p.zona !== "extremo" || (p.dir === "cima" ? Math.min(k1, d1) < 20 : Math.max(k1, d1) > 80);
      return cruzou && zona;
    },
    texto: (p) => `%K cruzou a %D para ${p.dir}${p.zona === "extremo" ? (p.dir === "cima" ? " vindo de baixo de 20" : " vindo de cima de 80") : ""}`,
    valor: (s) => `%K ${br(ult(s.k), 0)} · %D ${br(ult(s.kd), 0)}`,
  },
  bollinger: {
    nome: "Bandas de Bollinger", grupo: "Volatilidade",
    campos: [campo.sel("pos", [
      ["fechou_abaixo", "Fechou abaixo da banda inferior"], ["fechou_acima", "Fechou acima da banda superior"],
      ["tocou_inf", "Tocou a banda inferior"], ["tocou_sup", "Tocou a banda superior"],
      ["voltou_inf", "Voltou para dentro pela inferior"], ["voltou_sup", "Voltou para dentro pela superior"]])],
    padrao: { pos: "fechou_abaixo" },
    avaliar(s, p) {
      const [c, c1, sup, inf, sup1, inf1] = [ult(s.c), ult(s.c, 1), ult(s.bbs), ult(s.bbi), ult(s.bbs, 1), ult(s.bbi, 1)];
      if ([c, sup, inf].some((v) => v == null)) return null;
      return {
        fechou_abaixo: c < inf, fechou_acima: c > sup, tocou_inf: ult(s.l) <= inf, tocou_sup: ult(s.h) >= sup,
        voltou_inf: c1 < inf1 && c >= inf, voltou_sup: c1 > sup1 && c <= sup,
      }[p.pos];
    },
    texto: (p) => ({ fechou_abaixo: "Fechou abaixo da banda inferior de Bollinger", fechou_acima: "Fechou acima da banda superior de Bollinger",
      tocou_inf: "Tocou a banda inferior de Bollinger", tocou_sup: "Tocou a banda superior de Bollinger",
      voltou_inf: "Voltou para dentro das bandas pela inferior", voltou_sup: "Voltou para dentro das bandas pela superior" })[p.pos],
    valor: (s) => `bandas ${br(ult(s.bbi), casasPreco(ult(s.c)))} – ${br(ult(s.bbs), casasPreco(ult(s.c)))}`,
  },
  comprimida: {
    nome: "Bollinger comprimida", grupo: "Volatilidade",
    campos: [campo.num("valor", "Largura das bandas entre as", "% mais estreitas dos últimos 120 candles", 5)],
    padrao: { valor: 10 },
    avaliar: (s, p) => (s.bbp == null ? null : s.bbp <= p.valor),
    texto: (p) => `Bollinger comprimida (largura entre as ${p.valor}% mais estreitas de 120 candles)`,
    valor: (s) => `largura ${br(s.bbl)}% (percentil ${br(s.bbp, 0)})`,
  },
  atr: {
    nome: "Volatilidade (ATR)", grupo: "Volatilidade",
    campos: [campo.sel("op", [["acima", "ATR 14 acima de"], ["abaixo", "ATR 14 abaixo de"]]), campo.num("valor", "", "% do preço", 0.5)],
    padrao: { op: "abaixo", valor: 3 },
    avaliar: (s, p) => (s.atr == null ? null : p.op === "acima" ? s.atr > p.valor : s.atr < p.valor),
    texto: (p) => `ATR 14 ${p.op} de ${br(p.valor)}% do preço`,
    valor: (s) => `ATR ${br(s.atr)}%`,
  },
  variacao: {
    nome: "Variação no período", grupo: "Preço",
    campos: [campo.sel("janela", null, "Variação em"), campo.sel("op", [["maior", "maior que"], ["menor", "menor que"]]),
      campo.num("valor", "", "%", 1)],
    padrao: { janela: 21, op: "menor", valor: -10 },
    opcoes: { janela: (F, tf) => F.janelas[tf].var.map((n) => [n, unid(tf, n)]) },
    avaliar(s, p, tf, F) {
      const v = s.var?.[janelaProxima(F.janelas[tf].var, p.janela)];
      return v == null ? null : p.op === "maior" ? v > p.valor : v < p.valor;
    },
    texto: (p, tf, F) => `Variação em ${unid(tf, janelaProxima(F.janelas[tf].var, p.janela))} ${p.op} que ${fmtPct(p.valor)}`,
    valor: (s, p, tf, F) => { const n = janelaProxima(F.janelas[tf].var, p.janela); return `${fmtPct(s.var?.[n])} em ${unid(tf, n)}`; },
  },
  rompimento: {
    nome: "Rompimento de máxima/mínima", grupo: "Preço",
    campos: [campo.sel("tipo", [["max", "Fechou acima da máxima dos"], ["min", "Fechou abaixo da mínima dos"]]),
      campo.sel("janela", null)],
    padrao: { tipo: "max", janela: 20 },
    opcoes: { janela: (F, tf) => F.janelas[tf].ext.map((n) => [n, `últimos ${unid(tf, n)}`]) },
    avaliar(s, p, tf, F) {
      const n = janelaProxima(F.janelas[tf].ext, p.janela);
      const ref = p.tipo === "max" ? s.max?.[n] : s.min?.[n];
      return ref == null ? null : p.tipo === "max" ? ult(s.c) > ref : ult(s.c) < ref;
    },
    texto: (p, tf, F) => `Fechou ${p.tipo === "max" ? "acima da máxima" : "abaixo da mínima"} dos últimos ${unid(tf, janelaProxima(F.janelas[tf].ext, p.janela))}`,
  },
  perto_extremo: {
    nome: "Perto da máxima/mínima de 52 semanas", grupo: "Preço",
    campos: [campo.sel("tipo", [["max", "Perto da máxima de 52 semanas"], ["min", "Perto da mínima de 52 semanas"]]),
      campo.num("valor", "até", "% de distância", 1)],
    padrao: { tipo: "max", valor: 3 },
    avaliar(s, p, tf, F) {
      const n = Math.max(...F.janelas[tf].ext);
      const ref = p.tipo === "max" ? s.max?.[n] : s.min?.[n];
      if (ref == null) return null;
      return p.tipo === "max" ? ult(s.c) >= ref * (1 - p.valor / 100) : ult(s.c) <= ref * (1 + p.valor / 100);
    },
    texto: (p) => `Até ${br(p.valor)}% da ${p.tipo === "max" ? "máxima" : "mínima"} de 52 semanas`,
    valor(s, p, tf, F) {
      const n = Math.max(...F.janelas[tf].ext);
      return `${fmtPct(pct(ult(s.c), p.tipo === "max" ? s.max?.[n] : s.min?.[n]))} da ${p.tipo === "max" ? "máxima" : "mínima"} de 52s`;
    },
  },
  candle: {
    nome: "Candle", grupo: "Preço",
    campos: [campo.sel("tipo", [["alta", "Fechou em alta (sobre o anterior)"], ["baixa", "Fechou em baixa (sobre o anterior)"],
      ["gap_alta", "Abriu com gap de alta"], ["gap_baixa", "Abriu com gap de baixa"],
      ["engolfo_alta", "Engolfo de alta"], ["engolfo_baixa", "Engolfo de baixa"]])],
    padrao: { tipo: "alta" },
    avaliar(s, p) {
      const [o, c, h, l, o1, c1, h1, l1] = [ult(s.o), ult(s.c), ult(s.h), ult(s.l), ult(s.o, 1), ult(s.c, 1), ult(s.h, 1), ult(s.l, 1)];
      if (c1 == null) return null;
      return {
        alta: c > c1, baixa: c < c1, gap_alta: o > h1, gap_baixa: o < l1,
        engolfo_alta: c1 < o1 && c > o && c >= o1 && o <= c1, engolfo_baixa: c1 > o1 && c < o && c <= o1 && o >= c1,
      }[p.tipo];
    },
    texto: (p) => ({ alta: "Fechou em alta sobre o candle anterior", baixa: "Fechou em baixa sobre o candle anterior",
      gap_alta: "Abriu com gap de alta", gap_baixa: "Abriu com gap de baixa", engolfo_alta: "Engolfo de alta", engolfo_baixa: "Engolfo de baixa" })[p.tipo],
  },
  volume: {
    nome: "Volume", grupo: "Preço",
    campos: [campo.sel("op", [["acima", "Volume acima de"], ["abaixo", "Volume abaixo de"]]), campo.num("valor", "", "× a média de 20 candles", 0.5)],
    padrao: { op: "acima", valor: 1.5 },
    avaliar: (s, p) => (s.vr == null ? null : p.op === "acima" ? s.vr > p.valor : s.vr < p.valor),
    texto: (p) => `Volume ${p.op} de ${br(p.valor)}× a média de 20 candles`,
    valor: (s) => `volume ${br(s.vr)}× a média`,
  },
};

// ------------------------------------------------------------- modelos prontos

const r = (t, p = {}) => ({ t, ...CONDICOES[t].padrao, ...p });
const MODELOS = [
  { grupo: "Tendência", itens: [
    { id: "tend-alta", nome: "Tendência de alta", vies: "compra", desc: "Fechamento acima da MMS 20 e da MMS 50 (a regra padrão do terminal).",
      regras: [r("preco_media", { media: "sma20" }), r("preco_media", { media: "sma50" })] },
    { id: "tend-baixa", nome: "Tendência de baixa", vies: "venda", desc: "Fechamento abaixo da MMS 20 e da MMS 50.",
      regras: [r("preco_media", { lado: "abaixo", media: "sma20" }), r("preco_media", { lado: "abaixo", media: "sma50" })] },
    { id: "tend-alta-forte", nome: "Alta forte (médias alinhadas)", vies: "compra",
      desc: "Fechamento acima da MMS 20, com MMS 20 > MMS 50 > MMS 200 e a MMS 50 subindo.",
      regras: [r("preco_media", { media: "sma20" }), r("media_media", { a: "sma20", b: "sma50" }), r("media_media", { a: "sma50", b: "sma200" }),
        r("inclinacao", { media: "sma50" })] },
    { id: "tend-baixa-forte", nome: "Baixa forte (médias alinhadas)", vies: "venda",
      desc: "Fechamento abaixo da MMS 20, com MMS 20 < MMS 50 < MMS 200 e a MMS 50 caindo.",
      regras: [r("preco_media", { lado: "abaixo", media: "sma20" }), r("media_media", { a: "sma20", lado: "abaixo", b: "sma50" }),
        r("media_media", { a: "sma50", lado: "abaixo", b: "sma200" }), r("inclinacao", { media: "sma50", dir: "cai" })] },
    { id: "tend-curta", nome: "Alta curta (MME 9, MMS 25, MMS 50)", vies: "compra",
      desc: "Fechamento acima da MME 9, da MMS 25 e da MMS 50.",
      regras: [r("preco_media", { media: "ema9" }), r("preco_media", { media: "sma25" }), r("preco_media", { media: "sma50" })] },
  ] },
  { grupo: "Pullback de compra", itens: [
    { id: "pb-mme9", nome: "Pullback de compra na MME 9", vies: "compra", desc: "Em alta (MMS 20 > MMS 50, fechamento acima da MMS 50), a mínima testa a MME 9 e fecha acima.",
      regras: [r("pullback", { media: "ema9" }), r("media_media", { a: "sma20", b: "sma50" }), r("preco_media", { media: "sma50" })] },
    { id: "pb-mm20", nome: "Pullback de compra na MMS 20", vies: "compra", desc: "MMS 20 acima da MMS 50 e subindo; a mínima testa a MMS 20 e fecha acima.",
      regras: [r("pullback", { media: "sma20" }), r("media_media", { a: "sma20", b: "sma50" }), r("inclinacao", { media: "sma20" })] },
    { id: "pb-mm50", nome: "Pullback de compra na MMS 50", vies: "compra", desc: "MMS 50 acima da MMS 200; a mínima testa a MMS 50 e fecha acima.",
      regras: [r("pullback", { media: "sma50" }), r("media_media", { a: "sma50", b: "sma200" })] },
  ] },
  { grupo: "Pullback de venda", itens: [
    { id: "pb-mme9-venda", nome: "Pullback de venda na MME 9", vies: "venda", desc: "Em baixa (MMS 20 < MMS 50, fechamento abaixo da MMS 50), a máxima testa a MME 9 e fecha abaixo.",
      regras: [r("pullback", { lado: "venda", media: "ema9" }), r("media_media", { a: "sma20", lado: "abaixo", b: "sma50" }),
        r("preco_media", { lado: "abaixo", media: "sma50" })] },
    { id: "pb-mm20-venda", nome: "Pullback de venda na MMS 20", vies: "venda", desc: "MMS 20 abaixo da MMS 50 e caindo; a máxima testa a MMS 20 e fecha abaixo.",
      regras: [r("pullback", { lado: "venda", media: "sma20" }), r("media_media", { a: "sma20", lado: "abaixo", b: "sma50" }),
        r("inclinacao", { media: "sma20", dir: "cai" })] },
    { id: "pb-mm50-venda", nome: "Pullback de venda na MMS 50", vies: "venda", desc: "MMS 50 abaixo da MMS 200; a máxima testa a MMS 50 e fecha abaixo.",
      regras: [r("pullback", { lado: "venda", media: "sma50" }), r("media_media", { a: "sma50", lado: "abaixo", b: "sma200" })] },
  ] },
  { grupo: "Exaustão e extremos", itens: [
    { id: "bb-inf", nome: "Fechou abaixo da Bollinger", vies: "compra", desc: "Fechamento abaixo da banda inferior (20, 2): esticado para baixo.",
      regras: [r("bollinger", { pos: "fechou_abaixo" })] },
    { id: "bb-sup", nome: "Fechou acima da Bollinger", vies: "venda", desc: "Fechamento acima da banda superior (20, 2): esticado para cima.",
      regras: [r("bollinger", { pos: "fechou_acima" })] },
    { id: "ifr-sv", nome: "IFR sobrevendido", vies: "compra", desc: "IFR 14 abaixo de 30.", regras: [r("ifr")] },
    { id: "ifr-sc", nome: "IFR sobrecomprado", vies: "venda", desc: "IFR 14 acima de 70.", regras: [r("ifr", { op: "acima", valor: 70 })] },
    { id: "ifr-estoc", nome: "IFR e estocástico sobrevendidos", vies: "compra", desc: "IFR 14 abaixo de 30 e estocástico lento %K abaixo de 20.",
      regras: [r("ifr"), r("estocastico")] },
    { id: "ifr2", nome: "IFR 2 extremo em alta longa", vies: "compra", desc: "IFR 2 abaixo de 10 com o fechamento acima da MMS 200 (queda curta dentro de alta longa).",
      regras: [r("ifr", { n: 2, valor: 10 }), r("preco_media", { media: "sma200" })] },
    { id: "longe-baixo", nome: "Muito abaixo da MMS 20", vies: "compra", desc: "Distância da MMS 20 de pelo menos 2,5× o normal do próprio ativo.",
      regras: [r("distancia")] },
    { id: "longe-cima", nome: "Muito acima da MMS 20", vies: "venda", desc: "Distância da MMS 20 de pelo menos 2,5× o normal do próprio ativo.",
      regras: [r("distancia", { lado: "acima" })] },
    { id: "queda-forte", nome: "Queda forte no mês", vies: "compra", desc: "Caiu mais de 10% em 21 pregões (4 semanas no semanal).",
      regras: [r("variacao")] },
  ] },
  { grupo: "Volatilidade e rompimento", itens: [
    { id: "comprimida", nome: "Bollinger comprimida", vies: "neutro", desc: "Largura das bandas entre as 10% mais estreitas dos últimos 120 candles.",
      regras: [r("comprimida")] },
    { id: "comprimida-alta", nome: "Compressão em tendência de alta", vies: "compra", desc: "Bandas entre as 15% mais estreitas, com fechamento acima da MMS 50.",
      regras: [r("comprimida", { valor: 15 }), r("preco_media", { media: "sma50" })] },
    { id: "romp-max", nome: "Rompeu a máxima de 20 candles", vies: "compra", desc: "Fechamento acima da máxima dos 20 candles anteriores.",
      regras: [r("rompimento")] },
    { id: "romp-max-vol", nome: "Rompimento com volume", vies: "compra", desc: "Fechou acima da máxima de 20 candles com volume 1,5× a média.",
      regras: [r("rompimento"), r("volume")] },
    { id: "perde-min", nome: "Perdeu a mínima de 20 candles", vies: "venda", desc: "Fechamento abaixo da mínima dos 20 candles anteriores.",
      regras: [r("rompimento", { tipo: "min" })] },
    { id: "max52", nome: "Perto da máxima de 52 semanas", vies: "compra", desc: "Até 3% da máxima de 52 semanas.", regras: [r("perto_extremo")] },
    { id: "cruzou-mm20", nome: "Cruzou a MMS 20 para cima", vies: "compra", desc: "Fechou acima da MMS 20 depois de fechar abaixo dela.",
      regras: [r("cruzamento")] },
    { id: "golden", nome: "MMS 50 cruzou a MMS 200 para cima", vies: "compra", desc: "Cruzamento de médias longas nos últimos 2 candles.",
      regras: [r("cruzamento_medias")] },
  ] },
];
const MODELO_POR_ID = new Map(MODELOS.flatMap((g) => g.itens).map((m) => [m.id, m]));

// ------------------------------------------------------------- avaliação

/** A foto vista k candles atrás (k = 0 é o último candle fechado). */
function deslocar(s, k) {
  if (!s || !k) return s;
  const corta = (a) => (Array.isArray(a) ? a.slice(0, a.length - k) : a);
  const pega = (a) => (Array.isArray(a) ? a[a.length - 1 - k] ?? null : a);
  const mapa = (o, f) => o && Object.fromEntries(Object.entries(o).map(([n, a]) => [n, f(a)]));
  return {
    ...s, d: s.datas?.[s.datas.length - 1 - k] ?? s.d,
    o: corta(s.o), h: corta(s.h), l: corta(s.l), c: corta(s.c), sma: mapa(s.sma, corta), ema: mapa(s.ema, corta),
    ifr: mapa(s.ifr, corta), k: corta(s.k), kd: corta(s.kd), bbs: corta(s.bbs), bbi: corta(s.bbi),
    vr: pega(s.vr), bbp: pega(s.bbp), bbl: pega(s.bbl), var: mapa(s.var, pega), max: mapa(s.max, pega), min: mapa(s.min, pega),
  };
}
/** O mesmo, mas a foto do último candle (listas por candle viram o valor de hoje). */
const atual = (s) => (s && Array.isArray(s.vr) ? { ...s, ...deslocar(s, 0), vr: ult(s.vr), bbp: ult(s.bbp), bbl: ult(s.bbl),
  var: s.var && Object.fromEntries(Object.entries(s.var).map(([n, a]) => [n, ult(a)])),
  max: s.max && Object.fromEntries(Object.entries(s.max).map(([n, a]) => [n, ult(a)])),
  min: s.min && Object.fromEntries(Object.entries(s.min).map(([n, a]) => [n, ult(a)])) } : s);

/**
 * Em qual dos últimos `periodos` candles TODAS as regras foram atendidas: devolve k (0 = último
 * candle fechado, 1 = o anterior...) do mais recente, ou null.
 */
function quandoAtende(s, regras, tf, F, periodos = 1) {
  if (!s) return null;
  const n = Math.min(periodos, s.datas?.length ?? 1);
  for (let k = 0; k < n; k++) {
    const x = k ? deslocar(s, k) : atual(s);
    if (regras.every((r) => CONDICOES[r.t]?.avaliar(x, r, tf, F) === true)) return k;
  }
  return null;
}
const atende = (s, regras, tf, F) => quandoAtende(s, regras, tf, F) != null;

const textoRegra = (x, tf, F) => CONDICOES[x.t].texto(x, tf, F);
const valorRegra = (s, x, tf, F, k = 0) => (s && CONDICOES[x.t].valor ? CONDICOES[x.t].valor(k ? deslocar(s, k) : atual(s), x, tf, F) : null);

/**
 * O que desenhar no gráfico para o usuário ver a condição: as médias citadas nas regras
 * (MMS 20/50/200 com as cores de sempre), a Bollinger, o IFR/estocástico no painel de baixo
 * e os níveis de rompimento ou de 52 semanas. null = a regra não tem nada para desenhar.
 */
const CORES_EXTRAS = ["#e879f9", "#22d3ee", "#fb923c", "#a3e635", "#f472b6"];
function sobreposicaoDasRegras(regras, s0, tf, F, k = 0) {
  const s = k ? deslocar(s0, k) : atual(s0);
  const cores = { sma20: css("--mm20"), sma50: css("--mm50"), sma200: css("--mm200") };
  const ids = [...new Set(regras.flatMap((x) => [x.media, x.a, x.b]).filter(Boolean))];
  let extra = 0;
  const medias = ids.map((m) => ({ ...lerMedia(m), id: m, cor: cores[m] ?? CORES_EXTRAS[extra++ % CORES_EXTRAS.length] }));
  const tipos = new Set(regras.map((x) => x.t));
  const bb = tipos.has("bollinger") || tipos.has("comprimida");
  const ifrRegra = regras.find((x) => x.t === "ifr");
  const estoc = tipos.has("estocastico") || tipos.has("estoc_cruz");
  const osc = ifrRegra || estoc ? { ifr: ifrRegra?.n ?? null, estoc } : null;
  const niveis = [];
  const unidade = UNID[tf][1];
  for (const x of regras) {
    if (x.t === "rompimento" && s) {
      const n = janelaProxima(F.janelas[tf].ext, x.janela);
      const preco = x.tipo === "max" ? s.max?.[n] : s.min?.[n];
      if (preco != null) niveis.push({ preco, rotulo: `${x.tipo === "max" ? "Máx." : "Mín."} ${n} ${unidade}` });
    }
    if (x.t === "perto_extremo" && s) {
      const n = Math.max(...F.janelas[tf].ext);
      const preco = x.tipo === "max" ? s.max?.[n] : s.min?.[n];
      if (preco != null) niveis.push({ preco, rotulo: `${x.tipo === "max" ? "Máx." : "Mín."} 52 semanas` });
    }
  }
  if (!medias.length && !bb && !osc && !niveis.length) return null;
  return { medias, bb, osc, niveis };
}

/** Legenda curta do que a sobreposição desenha. */
function legendaSobreposicao(sob) {
  return [
    ...sob.medias.map((m) => ({ cor: m.cor, txt: nomeMedia(m.id) })),
    sob.bb ? { cor: css("--bb"), txt: "Bollinger (20, 2)", pontilhado: true } : null,
    sob.osc?.ifr ? { cor: Preferencias.derivadas().ifr, txt: `IFR ${sob.osc.ifr}` } : null,
    sob.osc?.estoc ? { cor: "#4aa3ff", txt: "Estocástico %K/%D" } : null,
    ...sob.niveis.map((n) => ({ cor: css("--aviso"), txt: n.rotulo, pontilhado: true })),
  ].filter(Boolean);
}

// ------------------------------------------------------------- contexto do card

/**
 * Informações que ajudam a decidir entre os ativos que passaram no filtro: o que está a favor
 * (tendência no outro tempo gráfico, força no ano, perto da máxima, volume, sinais das
 * estratégias) e o que pede cuidado (IFR/estocástico esticados, longe da média, fora da
 * Bollinger, contra o tempo maior, volume fraco, dado não conferido).
 */
function contextoDecisao(a, fotos0, tf, vies, sinais) {
  const favor = [], cuidado = [], info = [];
  const fotos = fotos0 && { D: atual(fotos0.D), W: atual(fotos0.W) };
  const s = fotos?.[tf], outroTf = tf === "D" ? "W" : "D", o = fotos?.[outroTf];
  const compra = vies === "compra", venda = vies === "venda";
  const nomeTf = (t) => (t === "D" ? "Diário" : "Semanal");

  // tendência (regra padrão: fechamento x MMS 20 e MMS 50) no tempo da regra e no outro
  for (const [t, f] of [[tf, s], [outroTf, o]]) {
    if (!f) continue;
    const quanto = (x) => `há ${unid(t, x.n)} (desde ${fmtData(x.desde)})`;
    if (f.alta) (venda ? cuidado : compra ? favor : info).push(`${nomeTf(t)} em alta ${quanto(f.alta)}`);
    else if (f.baixa) (compra ? cuidado : venda ? favor : info).push(`${nomeTf(t)} em baixa ${quanto(f.baixa)}`);
    else info.push(`${nomeTf(t)} sem tendência definida`);
  }

  // desempenho
  const vAno = a.var_ano_pct, vMes = a.var_mes_pct;
  info.push(`Mês ${fmtPct(vMes)} · ano ${fmtPct(vAno)}${s?.var?.[252] != null && tf === "D" ? ` · 12 meses ${fmtPct(s.var[252])}` : ""}`);

  // máxima/mínima de 52 semanas
  const d = fotos?.D;
  if (d?.max?.[252] && d?.min?.[252]) {
    const dMax = pct(ult(d.c), d.max[252]), dMin = pct(ult(d.c), d.min[252]);
    if (dMax >= 0) (venda ? cuidado : favor).push("Na máxima de 52 semanas");
    else if (dMax > -5) (venda ? info : favor).push(`A ${br(-dMax)}% da máxima de 52 semanas`);
    if (dMin <= 0) (compra ? cuidado : favor).push("Na mínima de 52 semanas");
    else if (dMin < 5) (compra ? cuidado : info).push(`A ${br(dMin)}% da mínima de 52 semanas`);
  }

  if (s) {
    // osciladores esticados contra o lado da operação
    for (const [t, f] of [[tf, s], [outroTf, o]]) {
      const v = ult(f?.ifr?.[14]), k = ult(f?.k);
      if (v > 70) (compra ? cuidado : venda ? favor : info).push(`IFR 14 ${nomeTf(t).toLowerCase()} sobrecomprado (${br(v, 0)})`);
      if (v < 30) (venda ? cuidado : compra ? favor : info).push(`IFR 14 ${nomeTf(t).toLowerCase()} sobrevendido (${br(v, 0)})`);
      if (k > 80) (compra ? cuidado : info).push(`Estocástico ${nomeTf(t).toLowerCase()} acima de 80 (${br(k, 0)})`);
      if (k < 20) (venda ? cuidado : info).push(`Estocástico ${nomeTf(t).toLowerCase()} abaixo de 20 (${br(k, 0)})`);
    }
    if (a.ifr_m > 80 || a.ifr_m < 20) (a.ifr_m > 80 ? (compra ? cuidado : info) : (venda ? cuidado : info)).push(`IFR mensal ${br(a.ifr_m, 0)}`);

    // esticado em relação à MMS 20
    const dist = pct(ult(s.c), ult(s.sma?.[20])), normal = s.dn?.[20];
    if (dist != null && normal && Math.abs(dist) >= 2 * normal)
      ((dist > 0 && compra) || (dist < 0 && venda) ? cuidado : info).push(
        `Esticado: ${fmtPct(dist)} da MMS 20 (${br(Math.abs(dist) / normal)}× o normal)`);
    if (ult(s.c) > ult(s.bbs)) (compra ? cuidado : info).push("Fechou acima da Bollinger superior");
    if (ult(s.c) < ult(s.bbi)) (venda ? cuidado : info).push("Fechou abaixo da Bollinger inferior");
    if (s.bbp != null && s.bbp <= 10) info.push(`Bollinger comprimida (largura ${br(s.bbl)}%)`);

    // onde ficaria um stop técnico: médias do lado oposto ao da operação (útil para pensar em R)
    if (compra || venda) {
      const abaixo = compra;
      const stops = [20, 50, 200].map((n) => [n, pct(ult(s.sma?.[n]), ult(s.c))])
        .filter(([, v]) => v != null && (abaixo ? v < 0 : v > 0)).slice(0, 2);
      if (stops.length) info.push(`Stop técnico: ${stops.map(([n, v]) => `MMS ${n} a ${fmtPct(v)}`).join(" · ")}`);
    }
    if (s.atr != null) info.push(`ATR ${br(s.atr)}% por ${UNID[tf][0]}`);

    // volume e gap
    if (s.vr != null) {
      if (s.vr >= 1.5) favor.push(`Volume ${br(s.vr)}× a média`);
      else if (s.vr <= 0.5) cuidado.push(`Volume fraco (${br(s.vr)}× a média)`);
    }
    if (ult(s.o) > ult(s.h, 1)) (venda ? cuidado : info).push(`Gap de alta de ${fmtPct(pct(ult(s.o), ult(s.h, 1)))}`);
    if (ult(s.o) < ult(s.l, 1)) (compra ? cuidado : info).push(`Gap de baixa de ${fmtPct(pct(ult(s.o), ult(s.l, 1)))}`);
  }

  // sinais das estratégias do radar nos últimos dias
  const tfSinal = tf === "W" ? "S" : "D";
  const recentes = (sinais ?? []).filter((x) => x.tf === tfSinal).sort((x, y) => y.data.localeCompare(x.data));
  const vistos = new Set();
  for (const x of recentes) {
    const chave = `${x.lado}:${x.familia}`;
    if (vistos.has(chave) || vistos.size >= 3) continue;
    vistos.add(chave);
    const aFavor = !vies || vies === "neutro" || x.lado === vies;
    (aFavor ? favor : cuidado).push(`Sinal de ${x.lado}: ${nomeFamilia(x.familia, x.lado)} (${fmtData(x.data)})`);
  }

  if (!a.liquido) cuidado.push("Pouca liquidez");
  // índices, moedas e commodities não têm fonte oficial gratuita para conferir: não é alerta
  if (a.verificacao?.status !== "conferido" && a.mercado !== "MACRO") cuidado.push("Último fechamento não conferido com fonte oficial");
  return { favor, cuidado, info };
}
