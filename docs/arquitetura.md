# Arquitetura: um motor de setups, três páginas

## Ideia

Antes havia dois motores com definições diferentes: as estratégias do Radar (`scripts/estrategias.py`) e
os modelos do rastreador da Multitela (`assets/js/rastreador.js`). Agora:

- **`config/setups.json` é o catálogo único de setups.** Cada setup é uma lista de regras (as mesmas
  condições do editor de regras), com todos os parâmetros explícitos. Serve aos menus do site, ao cálculo
  dos eventos e ao backtest.
- **Python é a fonte da verdade dos setups do catálogo** (`scripts/setups.py`): avalia as regras em todo o
  histórico (diário e semanal), gera os eventos datados e alimenta o backtest.
- **JS avalia só as regras personalizadas** do usuário (`assets/js/rastreador.js`, `CONDICOES`), sobre as
  fotos de `data/rastreador.json`. As duas implementações das condições são conferidas por um teste de
  paridade (`scripts/testar_paridade.py`): para cada setup do catálogo e cada ativo, o último candle tem
  que dar o mesmo resultado em Python e em JS.

## Condições (tipos de regra)

`preco_media, media_media, inclinacao, pullback, cruzamento, cruzamento_medias, distancia, ifr,
estocastico, estoc_cruz, bollinger, comprimida, atr, variacao, rompimento, perto_extremo, candle, volume`
(já existentes em JS) e três novas:

- `boca` `{lado: compra|venda}`: Bollinger comprimida que abre (superior sobe, inferior desce) com
  fechamento fora da banda (acima na compra, abaixo na venda). Mesma regra de `estrategias._boca`.
- `multitempo` `{lado: compra|venda}`: a estratégia multitempo atual (tendência no tempo do sinal +
  exaustão no tempo menor). Precisa do intraday, então o Python calcula e publica o resultado por candle
  nas fotos; o JS só lê.
- `ranking` `{lado: quedas|altas}`: entre as 8% maiores quedas (altas) do mesmo mercado em 21 pregões
  (13 semanas), com pelo menos 8% (12%). Depende de todos os ativos: calculado no fim de
  `atualizar_dados.py` e publicado por candle nas fotos. Sem backtest.

## Dados publicados

- `data/setups.json`: o catálogo (mesmo formato de `config/setups.json`), com o resumo do backtest de cada
  setup quando houver: `item.bt = {"D": {...}, "W": {...}}`.
- `data/radar.json`: como antes (`ativos`, `retidos`, `em_formacao`, `verificacao`...), mas `familias` sai e
  `sinais` passa a ser a lista de eventos dos setups:
  `{"ticker", "setup", "tf": "D"|"W", "data": "AAAA-MM-DD", "lado": "compra"|"venda"|"neutro", "preco",
  "bt": [casos, acerto %, retorno médio %, vantagem %] | null}`.
  Janela: últimos 15 pregões (D) e 8 semanas (W), só candles fechados. Tempo gráfico é sempre `D`/`W`.
  **Formato no arquivo (colunar, para pesar menos):** os eventos eram 3,3 MB dos 3,8 MB do `radar.json`
  (474 KB com gzip). Agora `sinais` é `{"v": 2, "tickers", "setups", "tfs", "datas", "lados", "bt", "e"}`:
  as listas guardam cada texto uma vez, `bt` guarda cada resumo de backtest uma vez (ele é igual para todos
  os eventos do mesmo ativo+setup+tempo) e `e` são 7 colunas paralelas de índices
  `[ticker, setup, tf, data, lado, preco, bt]` (bt `-1` = sem backtest), na mesma ordem de antes. Resultado:
  1,25 MB / 194 KB com gzip, com os mesmos números. Quem lê expande para a lista de objetos acima:
  `expandirSinais` em `assets/js/comum.js` (dentro de `carregarRadar`, então as páginas continuam vendo
  `R.sinais` como lista), um trecho igual em `assets/js/landing.js` (que não carrega o `comum.js`) e
  `descompactar_sinais` em `scripts/conteudo.py`. O encoder é `compactar_sinais` em `scripts/atualizar_dados.py`.
  Os leitores também aceitam a lista antiga, então um `radar.json` velho em cache do navegador não quebra o site.
  Não há `radar.json` "leve" separado: toda página usa `R.sinais` ao abrir, então separar só adiaria o download.
- `data/rastreador.json`: as fotos de sempre (para regras personalizadas, contexto e valores do card),
  mais os campos por candle das condições novas.
- `data/backtest.json`: por setup (id do catálogo) em vez de família.
- `data/casos/<arquivo>.json`: o backtest caso a caso de cada ativo, no prazo principal (10 pregões / 8 semanas):
  `{"ticker", "principal", "casos": {"D"|"W": {setup: [[data do sinal, entrada (abertura seguinte), data da saída, saída, resultado %], ...]}}}`.
  A página Backtest carrega ao clicar num ativo e mostra os casos no gráfico e numa lista.
- `data/paridade.json`: os setups que disparam no último candle de cada ativo segundo o Python (D e W),
  para o teste de paridade.

## Testes

- `scripts/testar_paridade.py`: compara `data/paridade.json` com `quandoAtende(foto, regras, tf, F, 1) === 0`
  rodado no node (`scripts/paridade.js`) sobre `data/rastreador.json`. Tem que dar zero diferenças.
- `scripts/rodar_offline.py`: o pipeline inteiro sem rede, com dados sintéticos determinísticos.
- `.github/workflows/testes.yml`: roda os dois em todo push e pull request (não publica nada).

## Páginas

- **Oportunidades** (`setups.html`): substitui Radar e Multitela. Navegação lateral em 4 passos (no celular e no tablet,
  uma folha que abre em "☰ Filtros"), em dois modos (`estado.modo` em `setups-v1`):
  - **Simples** (padrão, para quem não é trader): **1 Quero** comprar/vender → **2 Onde** (mercado) → **3 Que tipo de
    oportunidade?** (comprar: "Ações que estão subindo" = a favor da tendência, "Ações com preço descontado" = contra;
    vender: "Ações que estão caindo" / "Ações que subiram demais") → **4 Com que frequência você acompanha?** ("Olho todo
    dia" = sinais do diário, "Uma vez por semana" = semanal). Sempre o último pregão (ou semana), todos os setups do tipo.
    Um link com `?setup=` mostra só aquele setup, com "Ver todos deste tipo".
  - **Trader**: **3 Quando** (gráfico diário ou semanal; último pregão, 2, 3, 5) → **4 Qual setup** (do catálogo, agrupado
    em a favor/contra a tendência e por família, com a contagem de ativos; "Sem lado"; "Meus setups" = regras do usuário).
  - **Só com preço atualizado** (ligado por padrão, `soAtualizados`): esconde os ativos cujo último pregão não chegou
    completo da fonte (`verificacao.pendente` mais novo que `data`) ou que estão atrás do último pregão do mercado (Brasil e
    EUA). Desligado, eles aparecem com a etiqueta "⚠ preço de dd/mm". **Minhas buscas** (`buscas-v1`) guarda os filtros com
  um nome ("☆ Salvar busca") e traz sugestões para quem está começando. Em cima da grade, uma frase diz o que está na tela
  ("229 ativos para comprar · A favor da tendência › todos os setups"), com Ordenar, "Só com 2+ setups", Baixar e
  ⚙ Exibição (grade 1, 2×2, 3×3, 4×3; tempo do gráfico; condições ou meus indicadores). `radar.html` e `multitela.html`
  redirecionam para cá.
- **Conheça o terminal** (`index.html`, `assets/css/landing.css`, `assets/js/landing.js`): a página inicial do site, uma landing
  page com os sinais e exemplos reais do dia, os perfis, os planos e as perguntas. `conheca.html` só redireciona para ela.
- **Guia** (`guia.html`, `assets/js/inicio.js`; era o Início): o manual do terminal, para quem já entrou. O texto fixo está no HTML:
  hero (títulos e CTAs para Oportunidades e Diário) com os 3 recursos, "Para cada tipo de investidor" (iniciante, longo prazo,
  trader, quem quer disciplina; cada um com dor, ajuda, exemplo ilustrativo sem promessa de retorno e CTA), "Como funciona, em 3
  passos" com as 4 palavras-chave, e perguntas frequentes com o aviso de ferramenta de estudo. O `inicio.js` preenche só o que
  tem dados: o selo do topo (ativos e mercados), a vitrine "Veja ao vivo: os ativos com mais setups apontando hoje" (de
  `radar.json`, `tf: "D"`, último pregão fechado de cada mercado; setups de entrada, excluindo o grupo "Tendência", que é estado;
  filtro de mercado e compra/venda em `inicio-v1`; "Ver gráfico" e "Simular trade") e a faixa "Seus trades" (`#inicio-trades`,
  oculta para quem não tem trades; abertos e R do mês, por `Diario` ou, sem ele, `Simulacoes`).
- **Navegação** (`montarTopo`/`navegacao` em `comum.js`): Guia (`guia.html`) · Oportunidades (`setups.html`) · Diário (`diario.html`) · Mais
  (Triagem, Backtest, Carteira, Conheça o terminal). O logotipo leva à página inicial (a landing). No celular o mesmo `<nav>` vira barra de abas na base da tela (só CSS).
- **Simular trade** (`simularTrade(ctx, {grafico})` em `comum.js`): `Diario.registrar` se existir (carregado sob demanda de
  `assets/js/diario-dados.js`), senão `ativo.html?simular=compra|venda&setup=ID&tf=D#TICKER`, que abre um rascunho no gráfico
  do ativo (`simulador.contexto = {setup, tf, origem}`). Pontos de entrada: botão do card, menu ⋯ e alvo de arrastar
  (`arrastar.js`), cabeçalho do Ativo, Triagem (Hoje) e Início.
- **Triagem** (`triagem.html`): um "Tinder" dos setups do dia. Baralho de compra ou de venda com os ativos que
  deram sinal no último pregão do seu mercado; → gostei, ↑ super, ← descartar (só naquele pregão). As decisões
  ficam no navegador (`triagem-v1`, por data do pregão e lado), com o resultado do dia e os dias anteriores.
- **Carteira** (`carteira.html`, em "Mais"; era o `index.html`): posições, simulações e a minha lista (o que eu tenho e acompanho).
- **Ativo** (`ativo.html#TICKER`): tudo sobre um papel. Gráfico, setups recentes, simulações, como cada
  setup se saiu nele e contexto. Clicar num ticker em qualquer página abre aqui.
  O gráfico desenha as condições dos setups recentes (`sobreposicaoDasRegras`, só D e W; escolha por setup ou "Meus indicadores");
  clicar num setup do histórico abre a janela de casos (`assets/js/casos.js`, a mesma do Backtest, com `data/casos/<arquivo>.json`).
- **Backtest** (`backtest.html`): o histórico de cada setup do catálogo.
- **Top do dia** (`ranking.html`, `assets/js/ranking.js`, `assets/css/ranking.css`; em "Mais"): os sinais de hoje com melhor histórico, top 10 de compra e de venda, com filtro de mercado. Dados de `data/ranking.json`, gerado por `scripts/ranking.py` (reusa as regras de `conteudo.py`): mínimo de 10 casos, retorno médio > 0, nota = limite inferior de Wilson 95% da taxa de acerto, um setup por ativo. O top 3 vai também ao Telegram (`docs/telegram.md`).
- **Histórico dos sinais** (`resultados.html`, `assets/js/resultados.js`, `assets/css/resultados.css`; em "Mais"): os sinais de entrada do diário dos últimos 60 pregões e como terminaram, mais o "Ranking do mês" por mercado. Os dados vêm de `data/resultados.json`, gerado por `scripts/resultados.py` (passo opcional do workflow, depois do conteúdo para redes): encerrados = casos de `data/casos/` com sinal na janela; em aberto = primeiro sinal de `radar.json` que o backtest aproveitaria e que ainda não completou 10 pregões (retorno até o último fechamento). Linhas compactas `[dia desde base, ativo, setup, ret %, 1 se aberto]`. Taxa de acerto e média só dos encerrados; ranking = casos que terminaram nos últimos 30 dias, mínimo de 5 por setup.
