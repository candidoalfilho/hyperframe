# HyperFrame — Roadmap

> Norte: dominar **o edifício de concreto armado de 4–15 pavimentos** de ponta a ponta
> antes de expandir para qualquer outra tipologia. Cada fase termina em algo demonstrável.

## v0.1 — Fundação técnica ✅ (hoje)

- [x] Monorepo (engine TypeScript puro + app Tauri/React/Three.js)
- [x] Modelagem 2D em planta: eixos, pilares, vigas (polilinha), lajes (detecção automática de contorno), cargas de parede
- [x] Visualização 3D com seleção sincronizada, isolamento de pavimento
- [x] Pórtico espacial (6 GDL/nó) com diafragma rígido mestre-escravo, solver skyline LDLᵀ próprio
- [x] Cargas: peso próprio, revestimento/sobrecarga NBR 6120 (quinhões 45°), alvenaria, vento NBR 6123 (S1/S2/S3, Ca)
- [x] Combinações NBR 8681 (13 ELU + 6 ELS), dois passes de rigidez (§15.7.3)
- [x] Estabilidade global: γz, α, deslocamentos limites (tab. 13.3)
- [x] Dimensionamento de vigas NBR 6118 (flexão + cisalhamento modelo I, escolha de barras)
- [x] Verificação simplificada de pilares, quantitativos, relatório imprimível
- [x] 80 testes automatizados (âncoras analíticas + equilíbrio global)

## v0.2 — Confiabilidade e detalhamento ✅ (núcleo entregue)

- [x] Dimensionamento completo de **pilares**: flexo-compressão oblíqua (curva de interação por integração da seção com bloco retangular + domínios), pilar-padrão com curvatura aproximada, αb por momentos de extremidade, momentos mínimos (§11.3.3.4.3), escolha automática de arranjo (4–20 barras, ρ 0,4–4%)
- [x] Dimensionamento de **lajes maciças** (Marcus sem redução por torção, condições de contorno automáticas por continuidade) + flechas com Branson + fluência (αf=1,32)
- [x] Flechas de vigas ELS (elástica do pórtico via Hermite + Branson + diferida) com limite L/250
- [x] Fundações: reações de serviço → **sapatas rígidas** (bielas/CG, núcleo central, presets de solo) — orientativo, exige SPT
- [x] **Detalhamento preliminar** (posições, estribos, ancoragens NBR §9.4) + tabela de aço por bitola
- [x] **Pranchas**: planta de forma, armação de vigas e seções de pilares — SVG no app + exportação **DXF** (writer R12 próprio)
- [x] **Importação DXF** como underlay do editor (parser próprio com blocos/INSERT) p/ modelar sobre a arquitetura
- [x] **Múltiplas plantas de forma** (térreo ≠ tipo ≠ cobertura) com gerenciador
- [x] Regiões de carga: **escadas e reservatório/caixa d'água** (distribuição às lajes por interseção de polígonos)
- [ ] **Validação cruzada** (ver VALIDATION.md): 5 edifícios-referência vs Ftool/Eberick/planilhas → publicar relatório — **bloqueante p/ venda**
- [x] Diagramas 2D por barra no inspetor (M, V, N com valores e seletor de combinação)
- [x] Memorial de cálculo completo em **PDF** (writer PDF próprio no engine, zero deps,
  15 seções, multipágina, pesquisável) — botão "Memorial PDF" no painel de resultados
- [x] Salvar/abrir **nativo** (plugins Tauri dialog/fs; ⌘S/⇧⌘S/⌘O; fallback browser) +
  **autosave** a cada edição com recuperação na tela inicial
- [x] Pé-direito variável por pavimento na UI (gerenciador de plantas/níveis)

## v0.2.1 — Paridade com o tour do TQS ✅ (entregue)

> Cobertura dos módulos do "Tour pelo TQS" (docs.tqs.com.br id 3124): Ações, Análise,
> Vigas, Pilares, Lajes, **Escadas**, **Reservatórios**, Fundações (**estacas**),
> **Incêndio**. 177 testes.

- [x] **Ações**: desaprumo global (§11.3.3.4.1) com θ1/θa e regra de combinação com o
  vento pelos momentos de tombamento (somente vento / somente desaprumo / soma)
- [x] **Análise**: 2ª ordem global aproximada — majoração 0,95·γz dos esforços
  horizontais ELU p/ 1,1 < γz ≤ 1,3 (§15.7.2); aviso p/ γz > 1,3
- [x] **Vigas**: torção (§17.5 — seção vazada equivalente, TRd2, estribos+longitudinal,
  interação c/ cortante), fissuração ELS-W (wk estádio II, comb. frequente, tab. 13.4)
  e armadura de pele (§17.3.5.2.3)
- [x] **Escadas**: dimensionamento do lance (laje inclinada em 1 direção — cargas NBR
  6120, flexão, flecha c/ Branson, Blondel) com parâmetros no inspetor da região
- [x] **Reservatórios**: paredes sob empuxo hidrostático (estanqueidade wk ≤ 0,2 mm),
  fundo engastado c/ coluna d'água, tampa; volume e peso em operação
- [x] **Fundações**: blocos rígidos sobre estacas pelo método das bielas (Blévot,
  1–5 estacas: tirantes, bielas no pilar/estaca, α 45–55°), presets de estacas,
  alternância sapata×estaca nas configurações
- [x] **Incêndio**: TRRF automático (NBR 14432 tab. A.1 por ocupação×altura) +
  método tabular NBR 15200 (vigas tab. 4/5, lajes tab. 6/7) + método analítico p/
  pilares (TRF ≥ TRRF) — aba própria e seção no relatório
- [x] **Escadas e reservatórios no 3D**: lance com degraus + laje inclinada + patamar
  (sentido de subida configurável) e caixa d'água com fundo/paredes/tampa — seleção
  sincronizada 2D↔3D e isolamento de pavimento
- [x] **Furos/aberturas de laje** (paridade com furos do modelador TQS): elemento
  próprio (FUR, shaft/elevador) + escada abre furo automático no pavimento
  (desligável). Desconta g/q e concreto/fôrma, vira furo real no 3D, X de vazio na
  planta (editor e DXF) e nota de reforço de borda no dimensionamento

## v0.2.2 — Paridade com o TQS Passo-a-Passo ✅ (entregue)

> Cobertura do tutorial "TQS Passo-a-Passo" (docs.tqs.com.br id 3131): elementos
> estruturais (pilares L/circulares, transferências, furos de viga, seção variável),
> interação solo-estrutura (SISES-like), cargas na fundação, desenho de formas com corte,
> plotagem com moldura/carimbo e resumo com custo. 244 testes.

- [x] **Pilares circulares e em L** (+ rotação 0/90/180/270°): propriedades geométricas
  exatas, flexo-compressão oblíqua por integração do contorno (polígono/48-gon), barras
  em anel/vértices+perímetro, esbeltez por raio de giração real, fôrma/3D/DXF/detalhe
- [x] **Pilar nasce/morre em qualquer nível** (UI): transferência em viga detectada
  (aviso) e validada na consistência
- [x] **Furos na alma de vigas** com verificação de dispensa da NBR 6118 §13.2.5.2
  (face, dimensão, apoio, furo vizinho) — inspetor, planta, forma e memorial
- [x] **Seção variável por trecho** da viga (corta o vão de dimensionamento na mudança)
- [x] **Carga de parede por trecho** [x₀, x₁] da viga
- [x] **Interação solo-estrutura**: sondagem SPT por camadas → Es = α·K·NSPT (Teixeira &
  Godoy), molas CRV/CRH/rotacionais de sapatas e blocos (capacidade e mola de estaca por
  **Aoki–Velloso** com F1/F2 por execução), apoios elásticos no solver (GDL com mola),
  re-análise em 2 passes, recalques ELS-QP + distorção angular (alerta > 1/500)
- [x] **Planta de cargas na fundação**: reações características por caso (G/Q/vento) e
  envoltória ELU por pilar — aba, memorial e prancha DXF
- [x] **Corte esquemático** (elevação com níveis cotados, pilares, vigas seccionadas)
- [x] **Moldura + carimbo ABNT** nas pranchas (A0–A4, escala auto/fixa, dados da obra)
- [x] **Estimativa de custo** nos quantitativos e memorial (R$/m³, R$/kg, R$/m²)
- [x] **Verificação de consistência** tipificada (grave/média/leve) com seleção do
  elemento apontado
- [x] Bordas livres de laje: quinhão redistribuído às bordas apoiadas (força conservada)

## v0.2.3 — Primeira fatia da paridade CypeCAD ✅ (entregue)

- [x] **Lajes nervuradas** moldadas in loco (bi/unidirecionais): peso próprio real
  (capa + nervuras + enchimento com presets), geometria §13.2.4.2, dimensionamento por
  nervura (Marcus × espaçamento, seção T com bloco verificado na capa), cisalhamento
  como laje (§19.4.1, dispensa de estribo p/ l0 ≤ 65 cm) ou como viga, flecha com
  inércia da seção T + Branson, incêndio simplificado, quantitativos com volume real
- [x] **Tubulões a céu aberto** (3º tipo de fundação): fuste não armado pela tensão do
  concreto, base alargada pela σadm com rasante 60°, limites executivos da NBR 6122,
  molas de ISS pela base equivalente
- [x] **Punção §19.5** (módulo verificado c/ âncoras — núcleo do futuro módulo de lajes
  lisas): contornos C/C′, τRd2/τRd1, pilares retangulares e circulares internos
- [x] Consistência aponta **laje lisa não modelada** (pilar interno sem viga) e
  **pilar-parede** (b/h ≥ 5 — §15.9)

## v0.2.4 — Copiloto IA ✅ (entregue)

- [x] **Copiloto (Claude API)**: painel de chat com ferramentas de leitura (resumo do
  projeto, elementos, consistência, resultados, rodar análise) e de mutação (adicionar/
  atualizar/remover pilares, vigas, lajes; configurações) — **toda mutação exige
  aprovação manual** (cartão aprovar/recusar) e entra no undo/redo
- [x] **Modo planejamento**: só ferramentas de leitura + plano numerado (estilo plan mode
  do Claude Code)
- [x] Chave da API por máquina (localStorage — nunca no arquivo do projeto), seleção de
  modelo (Opus 4.8 padrão, Sonnet 5, Haiku 4.5), thinking adaptativo, tratamento de
  erros/recusas, botão parar

## v0.2.5 — Copiloto local (modelos baixáveis) ✅ (entregue)

- [x] **Provedor local via Ollama**: abstração de provedores (Claude API ×
  local) com formato neutro de conversa; chat com ferramentas validado contra o
  Ollama real (tool_calls + role:"tool"/tool_call_id)
- [x] **Download de modelos DENTRO do app**: recomendados com suporte a tools
  (qwen3:4b leve, qwen3:8b recomendado, llama3.1:8b) com barra de progresso e
  cancelamento (/api/pull NDJSON); detecção automática do servidor; seleção do
  modelo padrão entre os instalados — o release continua leve (o app não embute pesos)
- [x] Painel indica o modo (local = offline/privado) e orienta instalação
  (`brew install ollama` + `ollama serve`) quando o servidor está parado
- [ ] Runtime embutido (llama.cpp sidecar, sem depender do Ollama) → v0.4
- [ ] Streaming de texto no chat + contexto de seleção (elemento selecionado vai junto) → v0.3

## v0.2.6 — Grelha de lajes + baldrames Winkler ✅ (engine entregue)

> Analogia de grelha p/ lajes maciças (contorno qualquer, furos e **lajes lisas**) e
> vigas baldrame sobre apoio elástico de Winkler. Núcleo no engine — falta expor na UI.
> 283 testes.

- [x] **Grelha de pavimento** (`analysis/grid.ts`): malha regular de barras cruzadas com
  3 GDL/nó (w, θx, θy), flexão EI + torção GJ, mesmo solver skyline LDLᵀ do pórtico —
  âncoras: faixa unidirecional = viga (exata) e placa quadrada apoiada (Timoshenko)
- [x] **`slabMethod: 'marcus' | 'grelha'`** nas configurações do projeto: no modo grelha
  os quinhões a 45° dão lugar às reações reais por borda (força conservada) e pilares
  **internos** à laje recebem carga nodal direta — laje lisa/cogumelo funciona
- [x] **Dimensionamento pela grelha**: momentos por metro (vão/apoio, X/Y), malhas
  escolhidas, flecha com I_eq (Branson) + fluência e **punção §19.5 com o Fsd real** de
  cada pilar interno; consistência orienta a troca de método (aviso vira leve na grelha)
- [x] **Baldrames sobre Winkler** (vigas no nível da fundação): ks manual > sondagem
  (Es médio) > heurística 120·σadm; refino ≤ 0,5 m com molas kz = ks·B·Ltrib em nós
  livres (solver aceita mola fora de apoio), alvenaria de embasamento no nível 0,
  pressão no solo × σadm (aviso) e baldrame dimensionado como viga
- [x] ~~Expor na UI~~ → entregue na v0.2.7

## v0.2.7 — Grelha e baldrames na UI ✅ (entregue)

> A grelha e os baldrames Winkler da v0.2.6 ficam acessíveis sem copiloto. 284 testes.

- [x] **Configurações**: seletor do método de lajes maciças (Marcus × grelha) na seção
  Análise; ks de Winkler dos baldrames (manual ou automático) na seção Fundações
- [x] **Aba Lajes**: tabela própria da grelha — momentos por metro (vão/apoio, X/Y),
  malhas, punção por pilar interno (τSd/τRd2 e τSd/τRd1 no hover), flecha × limite —
  + malhas da grelha no resumo do relatório imprimível
- [x] **Memorial**: título da seção 9 ciente do método, subseção **9.1 Punção** (Fsd
  real, contornos C/C′, studs × dispensada) e premissas atualizadas
- [x] **Copiloto**: resumo do projeto informa o método de lajes; exemplos da ferramenta
  de configurações incluem `slabMethod`/`groundBeamKs`

## v0.2.8 — Armação executiva de vigas (fatia 1) + acabamento de UI ✅ (entregue)

> Primeira fatia do detalhamento executivo + três correções apontadas em uso real.
> 290 testes.

- [x] **Armação de vigas rumo ao executivo**: decalagem al do diagrama (§17.4.2.2,
  função com âncora manual), negativos cobrindo 2·(0,25·ℓ + al) com **ganchos
  verticais** desenhados, positivos com ganchos nas pontas extremas (ancoragem α=0,7
  §9.4.2), **estribos na distribuição real** e **QUADRO DE FERROS na prancha**
  (N/φ/quant./C unit./C total/kg) com numeração casada entre desenho e tabela (por viga)
- [x] **Cotas proporcionais na prancha**: altura de texto explícita no `DDim` escala
  com o conteúdo (antes o piso legível saturava e a cota travava ~100 mm no papel,
  gigante em A4/A1); título da forma sem escala fixa (a real fica no carimbo)
- [x] **Furos no 3D**: furo de laje encostado na borda não some mais (encolhimento
  ~1,5 cm p/ triangulação robusta do earcut; furo fora do contorno é descartado) e
  **furos na alma de vigas** agora recortam o sólido 3D (extrusão da elevação c/ holes)
- [x] **Painel "Exibição" do 3D recolhível** (lajes/escadas/deformada/diagramas)

## v0.2.9 — Cortes reais, emendas e editor de armaduras ✅ (entregue)

> Fatia 2 do detalhamento executivo. 295 testes.

- [x] **Cortes pelo diagrama REAL**: a envoltória de Mz amostrada do vão dá o ponto de
  momento nulo e o de 50% do momento do apoio (`cutZero`/`cutHalf`); negativos cortam em
  x₀ + al + lb,nec (§18.3.2.4) e, com ≥ 4 barras, **escalonam** (metade corta a 50%)
- [x] **Emendas por traspasse** (§9.5.2): barra > 12 m divide em peças iguais com
  l0t = 2·lb,nec ≥ l0t,mín (0,6·lb; 15φ; 20 cm) — marcas de emenda no desenho e peças
  no quadro de ferros (`planSplices` com âncoras manuais)
- [x] **Editor de armaduras** (aba Pranchas → Vigas): n/φ por posição (positivo,
  negativos) e passo do estribo por vão — ajustes entram no ARQUIVO do projeto
  (`rebarOverrides`), recalculam o detalhamento ao vivo (sem invalidar a análise) e
  chip **"As!"** acusa As efetivo < calculado; "Restaurar automático" por viga
- [x] Projeto de exemplo sem `author` fixo — **RESP. TÉCNICO nunca é preenchido pelo
  software**; fica "—" até o engenheiro informar o seu nome

## v0.2.10 — Furos completos (§19.5.1/§13.2.5) + site open source ✅ (entregue)

> Fecha o tema "furos em laje" e materializa a decisão de 15/07/2026:
> **HyperFrame é 100% open source** (binários por SO + fonte no site). 302 testes.

- [x] **Punção × aberturas (§19.5.1)**: furo a menos de 8d do pilar desconta o setor
  entre as tangentes (do centro do pilar) dos perímetros C/C′ —
  `openingPerimeterReduction` com âncora manual; desconto saturado em 50%; ligado ao
  pipeline da grelha (nota por pilar afetado)
- [x] **Reforço de borda de furo dimensionado**: reposição da armadura interrompida
  (metade por lado, φ10) nas duas direções + diagonais de canto — nas notas da laje
- [x] **Dispensa §13.2.5 na consistência**: furo ≤ lx/10 → "dispensa verificação";
  maior → "exige verificação/reposição" (média no Marcus, leve na grelha)
- [x] **Site**: seção "Código aberto" + downloads por versão (dmg v0.2.9 hospedado no
  site com sha256; Windows/Linux → GitHub Releases), badge open source no hero/rodapé,
  link do repositório e **versão em inglês** (`site/en/`) com toggle PT↔EN
- [x] BUSINESS.md com o pivô open source (supera §4 — licenciamento)

## v0.2.11 — Punção de borda e canto com K·MSd (§19.5.2) ✅ (entregue)

> Fecha a lacuna nº 1 das lajes lisas. 311 testes.

- [x] **Pilar de BORDA e de CANTO** (§19.5.2.2/19.5.2.3): perímetro crítico REDUZIDO u*
  (trechos a = mín(1,5d; 0,5c) junto às bordas livres), excentricidade e* e momento
  corrigido MSd = (MSd1 − FSd·e*) ≥ 0; canto = verificação de borda nas duas direções
- [x] **Transferência de momento K·MSd** (§19.5.2.1): K interpolado da tab. 19.2
  (borda: c1/2c2), Wp = ∫|e|·dl por **integração numérica do contorno** — validada nos
  testes contra as fórmulas fechadas (interno e EC2 6.45); MSd desbalanceado tomado da
  envoltória ELU do pórtico (pilar acima × abaixo da ligação, a favor da segurança)
- [x] **Caminho de carga corrigido**: pilar sobre borda LIVRE (sem viga) agora entra na
  grelha como apoio (antes a reação dele simplesmente não existia) — classificador
  interno/borda/canto compartilhado entre análise e dimensionamento
- [x] Composição com §19.5.1 (aberturas reduzem u e Wp), posição/MSd na aba Lajes
  (hover) e no memorial 9.1 (colunas Pos. e MSd)

## v0.2.12 — Armadura de punção dimensionada (§19.5.3.3/4) ✅ (entregue)

> Fecha o pacote "laje lisa profissional". 315 testes.

- [x] **Conectores (studs, α = 90°) dimensionados**: Asw por linha a partir de
  τRd3 = 0,10·(1+√(20/d))·(100ρfck)^⅓ + 1,5·(d/sr)·Asw·fywd/(u·d), com fywd ≤ 300 MPa
  elevado linearmente até 435 MPa p/ 15 < h ≤ 35 cm (§19.4.2) e u reduzido em
  borda/canto — âncora manual: 40×40, d=16, F=800 ⇒ 4 linhas × 14 φ8
- [x] **Extensão até o contorno C″** (§19.5.3.4): linhas adicionadas até
  τSd(C″) ≤ τRd1, com u″/Wp″/e*″ integrados no contorno a 2d da última linha
  (mesma máquina de contornos — funciona em interno/borda/canto e compõe com
  furos §19.5.1 e momento K·MSd)
- [x] **Detalhamento fig. 20.2**: s0 ≤ 0,5d, sr ≤ 0,75d, espaçamento ≤ 2d na linha
  externa; bitola escolhida (φ8–16); esmagamento em C não se "resolve" com armadura
  (nota manda p/ capitel/maior d)
- [x] Spec nas notas da laje, hover da aba Lajes e memorial 9.1 (Arm. = linhas ×
  conectores × φ; falha se C″ não dispensar)

## v0.2.13 — Colapso progressivo (§19.5.4) ✅ (entregue)

- [x] fyd·As,ccp ≥ 1,5·FSd por pilar de laje lisa: área exigida de armadura INFERIOR
  atravessando o pilar (ancorada além de C′) + sugestão em φ16 — nas notas da laje,
  no hover da aba Lajes e no memorial 9.1 (âncora: 800 kN ⇒ 27,6 cm² = 14 φ 16).
  316 testes. Módulo de lajes lisas §19.5 COMPLETO (interno/borda/canto, K·MSd,
  aberturas, studs até C″, colapso progressivo)

## v0.2.14 — PDF das pranchas + zoom acessível (feedback do smoke test Windows) ✅

- [x] **Pranchas em PDF vetorial** (`drawingPdf.ts`): MediaBox = folha exata (A0–A4 em
  pontos, 1:1 com o composeSheet ⇒ imprime NA ESCALA do carimbo), linhas por camada
  com espessura técnica, tracejados, círculos em bézier, textos rotacionados
  (`PdfDoc.textRotated` + páginas com tamanho próprio) e cotas com geometria
  COMPARTILHADA com o DXF (`drawing/dim.ts`) — botão "Baixar PDF" na aba Pranchas
- [x] **Zoom descobrível**: botões +/−/⛶ no editor 2D e no viewer de pranchas (a roda
  já funcionava, mas não era descobrível no Windows) e **zoom da interface inteira**
  com Ctrl/⌘ +/−/0, persistido por máquina (telas com escala alta)

## v0.2.15 — Zoom por botões também no 3D ✅

- [x] Botões +/−/⛶ (vista inicial) no viewer 3D via OrbitControls — fecha o feedback
  de zoom do smoke test Windows nas três superfícies (2D, pranchas e 3D)

## v0.2.16 — Identidade visual ✅

- [x] Logo oficial (pilar em planta com eixos e bolacha Ⓐ/2): remake vetorial fiel em
  `design/logo.svg`, ícones do app regenerados (`tauri icon`), marca inline `IconLogo`
  no TopBar/boas-vindas e no site (nav/rodapé/favicon, PT/EN/downloads)
- [x] `site/tools/publish.mjs`: publicação de versão automatizada com asserts
  (binários, sha256 e patch das 3 páginas) — fim dos seds manuais

## v0.2.17 — Fundações editáveis (fase 1) ✅

- [x] `FoundationOverride` no modelo (por pilar): tipo sapata/estacas/tubulão,
  a×b fixado, nº de estacas fixado, offset do CG (divisa) e prof. de assentamento
- [x] Engine em modo VERIFICAÇÃO: `designFooting({fixed})` e
  `designPileCap({nPilesFixed})` checam as dimensões do engenheiro (σ>σadm /
  sobrecarga de estaca ⇒ falha) em vez de redimensionar; offset vira momento
  N·e somado às sapatas/blocos
- [x] `foundationShape()` (geometria em planta) + **planta de fundações**
  (`buildFoundationPlanDrawing`: eixos, contornos, estacas, S#/B#/T#, cotas de
  assentamento e resumo) — nova opção em Pranchas (SVG/DXF/PDF)
- [x] Inspetor do pilar ganha seção **Fundação** (editar tipo/dimensões/nº de
  estacas/offset/cota + restaurar automático) com recálculo ao vivo sem re-análise
- [x] 2D: contornos tracejados das fundações no nível térreo (cor por status)
- [x] 3D: sólidos de sapatas/blocos/estacas/tubulões sob o térreo (checkbox
  "Fundações"), arranque quando há profundidade de assentamento
- [x] 10 testes novos (verificação fixada, N·e, geometria, planta) — 327 no total
- [ ] Fase 2: sapata de divisa com viga alavanca, sapatas associadas/corridas,
  blocos ≥ 6 estacas (CEB), armadura detalhada de sapatas/blocos em prancha

## v0.2.18 — Viga alavanca + detalhamento de fundações ✅

- [x] `designStrapBeam` (nbr6122/strapBeam.ts): modelo clássico da viga de
  equilíbrio (Alonso) — R1 = N·L/(L−e), alívio N·e/(L−e), M = N·e com tração
  superior; seção h = L/8 crescendo até caber, flexão §17 + estribos (mín. φ6,3)
- [x] `FoundationOverride.strapToColumnId`: no inspetor, sapata com offset ganha
  select "Viga alavanca até (pilar interno)" — sapata passa a ser dimensionada
  CENTRADA p/ R1 amplificada (só a componente perpendicular do offset vira N·e);
  alívio comparado com a reação real do pilar interno (>50% ⇒ atenção) e NÃO
  descontado da fundação dele (a favor da segurança)
- [x] Desenhos: planta de fundações traça o eixo da VA com bw×h; nova prancha
  **Detalhamento de fundações** (célula por fundação com armaduras da sapata
  dir. a/b, tirantes de bloco, tubulão, cotas de assentamento + QUADRO das VAs
  com seção/armadura/estribos/R1/alívio) — SVG/DXF/PDF
- [x] 2D: eixo tracejado da VA com rótulo; 3D: sólido da viga entre a sapata e o
  pilar interno (topo alinhado ao topo da sapata)
- [x] 5 testes novos com âncoras à mão (R1/alívio/M, As 19,43 cm² → 4 φ 25,
  estribo mínimo φ6,3 c/ 20, crescimento de h, e > L/4) — 332 no total
- [ ] Restante da fase 2: sapatas associadas/corridas, blocos ≥ 6 estacas (CEB)

## v0.2.19 — Sapatas associadas + blocos 6–16 estacas (CEB) ✅

- [x] `designCombinedFooting`: sapata associada p/ 2 pilares — retângulo com CG
  na resultante (σ uniforme), estática exata da viga invertida (M− máx. onde o
  cortante zera; M+ nos balanços), altura rígida §22.6.1 crescendo até a flexão
  caber, armaduras long. superior/inferior + transversal, modo verificação com
  `fixed` e avisos (A/B > 5 ⇒ baldrame; resultante perto do bordo)
- [x] `FoundationOverride.combineWithColumnId`: select "Sapata associada com" no
  inspetor; pilar parceiro vira secundário (aponta o dono, espelha status)
- [x] `designPileCap` sem clamp de 5: **6–16 estacas pelo CEB-70** (apud
  Bastos/UNESP) — malha `pileGridDims` linhas×colunas, h ≥ (a−ap)/3 (§22.7.1),
  flexão na seção S1 (0,15·ap) por direção via §17, cortante na S2 (d/2) × VRd2,
  esmagamento no apoio, armadura distribuída sobre as estacas + malha mínima
- [x] `pileLayout` estendido p/ malha retangular (n ≥ 6, linha incompleta centrada)
- [x] Geometria/desenhos: retângulo ROTACIONADO da associada na linha dos
  pilares (2D/3D/plantas), rótulo SA, célula no detalhamento com as 3 armaduras,
  resumo aponta o dono no pilar secundário
- [x] 11 testes novos (âncoras: CEB 2×3 M_S1 = 739 kN·m → As 20,6 cm²;
  associada 2×500 kN → 3,65×1,45, M− 308 kN·m) — 343 no total

## v0.2.20 — Armação de lajes em planta ✅

- [x] `buildSlabRebarDrawing` (drawing/slabRebar.ts): prancha executiva por
  planta de forma — POSITIVAS (face inferior) com barra representativa por
  direção dentro de cada laje (φ c/ s do dimensionamento + L≈ do vão, direção
  da faixa A = 1ª borda do polígono; grelha usa eixos globais X/Y);
  NEGATIVAS (face superior) detectadas por BORDAS COINCIDENTES entre lajes
  vizinhas — barra perpendicular ao apoio estendendo 0,25·ℓ p/ cada lado
  (ℓ = vão perpendicular de CADA laje), spec do lado com maior As de apoio
- [x] Fontes: Marcus (spanSpec/supportSpec), nervurada (barras por nervura +
  negativa na capa) e grelha (malhas X/Y ± superiores)
- [x] Nova opção "Armação de lajes" em Pranchas com seletor de planta —
  SVG/DXF/PDF na escala, com notas executivas (§9.4)
- [x] 4 testes novos (adjacência no projeto exemplo, positivas 2×/laje,
  negativas com 0,25·ℓ, notas) — 347 no total

## v0.2.21 — Grelha de pavimento UNIFICADA ✅

- [x] `analyzeFloorGrid` (analysis/floorGrid.ts): todas as lajes MACIÇAS da
  planta numa malha única — nós compartilhados na borda comum dão CONTINUIDADE
  real entre lajes vizinhas; VIGAS viram barras da grelha com EI real da seção
  (por trecho) e torção fissurada 0,15·GJ (§17.5.1.2); apoios verticais SÓ nos
  pilares do nível (reações diretas p/ punção)
- [x] Dois padrões de carga (g+q e quase-permanente) com UMA fatoração;
  extração POR LAJE: momentos de vão/apoio por direção (fim de barra em linha
  de viga = negativo), flecha RELATIVA ao contorno, reações por pilar
- [x] Degradação controlada: viga fora dos eixos X/Y → apoio rígido; região sem
  caminho a pilar → linhas de viga pinadas (nota); mecanismo → fallback
  automático p/ a grelha por laje (comportamento anterior)
- [x] slabRun: método "grelha" agora usa a unificada por planta quando
  disponível (punção filtrada aos pilares que apoiam a LAJE diretamente);
  Marcus continua disponível como método
- [x] Âncora analítica: 2 lajes 4×8 contínuas ⇒ M⁻ na borda comum ∈ [16;24]
  ≈ w·l²/8 = 20 kN·m/m, M+ ≈ 9/128·w·l², Σreações = carga total; a grelha
  por laje rotulada reporta < 70% do negativo real — 7 testes novos, 354 total

## v0.2.22 — Mesa colaborante (seção T §14.6.2.2) ✅

- [x] `effectiveFlange`: bf = bw + Σ mín(0,5·b2; 0,10·a) por lado com laje;
  a = l / 0,75·l / 0,60·l conforme continuidade do vão (detectada pelos
  negativos reais da envoltória)
- [x] `designTBeamFlexure` (§17): tenta retangular bf (LN na mesa); senão
  decompõe abas (Mf = 0,85·fcd·(bf−bw)·hf·(d−hf/2)) + alma retangular bw;
  x/d ≤ 0,45; As mínima na alma
- [x] analyze/designBeams: detecção automática das lajes coladas ao vão
  (borda colinear ≥ 50%, por lado; nervurada usa a capa como hf), distância
  livre b2 ≈ extensão ⊥ da laje − bw; POSITIVO usa a seção T (campo
  `flange` + nota "Mesa colaborante bf = … (§14.6.2.2)"); negativos seguem
  retangulares (mesa tracionada)
- [x] Âncoras: bf 92 cm p/ bw 20/vão 6 m contínuo; Md 200 ⇒ As 8,74 cm²
  (T) vs 9,79 cm² (retangular) — economia ~11%; LN na alma Md 420 ⇒
  As 20,44 cm² — 7 testes novos, 361 no total
- [ ] Futuro: inércia T também na ANÁLISE (rigidez do pórtico) — hoje o
  pórtico segue retangular (conservador p/ flechas)

## v0.2.23 — Pilar-parede / núcleo rígido (§15.9 + §18.5) ✅

- [x] `designWallColumn`: parede (maior dimensão > 5× espessura) decomposta em
  LÂMINAS de ≈ 3·h (§15.9.3); N por lâmina pela distribuição linear
  σ = N/A ± M_forte·y/I (flexão forte vira diferença de normais); esbeltez
  local λi = 3,46·le/h na espessura com momento mínimo + pilar-padrão; quinhão
  do momento fraco por largura; lâmina TRACIONADA vira tirante (As = |N|/fyd)
- [x] Mínimos §18.5: malha vertical por face (passo ≤ mín(20 cm; 2·h)) e
  horizontal ≥ máx(25% da vertical; 0,15%·Ac) por metro — specs prontas
- [x] columnRun: detecção automática (retangular com razão > 5); As das
  lâminas vira PISO do dimensionamento à flexo-composta oblíqua (interação
  continua valendo p/ desenho); λ > 90 ⇒ método rigoroso (nota); seção L com
  aba > 5× ganha alerta p/ verificação por abas
- [x] UI: tag "PAREDE" na aba Pilares com tooltip (lâminas, λ, malhas)
- [x] Âncoras: parede 150×25 ⇒ 2 lâminas de 75 com N 2400/600 (Σ ✓),
  λ = 38,8, tirante de borda −1500 kN — 6 testes novos, 367 no total

## v0.2.24 — Pilares executivos (elevação) ✅

- [x] `buildColumnElevationDrawing`: elevação executiva por pilar —
  fundação esquemática com ARRANQUES (l0 acima da fundação + gancho),
  emendas por TRASPASSE em cada pavimento (§9.5.2; comprimento = lb, a favor
  da segurança p/ emenda comprimida), estribos na distribuição real por
  tramo, cotas de nível e pé-direito, gancho no topo (10φ), seção
  transversal em escala real com as barras e QUADRO DE FERROS (C por tramo,
  kg por posição, arranques, total)
- [x] Pranchas: nova opção "Pilar — elevação" com seletor de pilar
  (SVG/DXF/PDF na escala, carimbo)
- [x] 5 testes (traspasse = tramos − 1, estribos ≥ Σ real, pontos da seção
  = barsN, C = pé-direito + lap) — 372 no total

## v0.2.25 — Refinamentos de análise (item 7) ✅

- [x] **Inércia T no pórtico** (§14.6.2.2): vigas com laje colada ganham
  `props` com Iz da seção T bruta (a = 0,75·l típico; área p/ peso próprio
  segue retangular — a laje já pesa por conta própria); flechas e
  distribuição de esforços mais realistas (aviso no modelo)
- [x] **Excentricidade do vento 7,5% da face** (NBR 6123 §6.6): momento
  torsor no nó mestre do diafragma por pavimento (sinal único por caso; a
  envoltória ±X/±Y cobre os dois giros em plantas ~simétricas — nota p/
  plantas muito assimétricas); teste do diafragma atualizado p/ cinemática
  de corpo rígido COM rotação
- [x] **Redistribuição de M⁻ das vigas** (§14.6.4.3): δ ∈ [0,75; 1] nas
  configurações (padrão = sem); alívio médio volta ao vão (equilíbrio) e
  x/d ≤ (δ − 0,44)/1,25 verificado por apoio (falha se violado)
- [x] γz > 1,30 já tinha guarda ('inválido' + aviso de P-Δ rigoroso) ✓
- [x] 6 testes novos (I_T = 0,006473 m⁴ = 1,80× retangular; δ = 0,85 nos
  negativos com alívio no vão; rz ≠ 0 no diafragma) — 377 no total
- [ ] Fica p/ o futuro: P-Δ iterativo por combinação (γz cobre §15.7.2 até
  1,30), Ca da Fig. 4 digitalizado, quinhão trapezoidal explícito no Marcus

## v0.2.26 — Escadas em L e U com patamar ✅

- [x] `StairParams.kind` (reto/L/U) + `landingDepth`; select no inspetor
- [x] `designStairLanding`: lance + patamar CONTÍNUOS (patamar sem apoio
  próprio — esquema conservador clássico): cargas por trecho (lance ×1/cosθ
  + meia altura de degraus; patamar plano), reações exatas e Mmax onde
  V = 0; flecha Branson, Blondel, nota da DOBRA (barras cruzando o canto —
  empuxo ao vazio)
- [x] 3D: U = dois lances paralelos (sobe/volta) + patamar a meia altura;
  L = lance no lado maior + patamar de canto + lance ⊥ — degraus e mísulas
  reais nos dois lances
- [x] Âncora: lance 2,40 + patamar 1,20 ⇒ RA = 22,55 kN, Mmax = 19,6 kN·m/m
  em x = 1,74 m — 4 testes novos, 381 no total
- [ ] Futuro: autoportante, viga central, caracol; patamar com apoio próprio

## v0.2.27 — Vigas-parede e consolos (§22.4/§22.5) ✅

- [x] `designDeepBeam`: detecção l/h < 2 (biap.)/< 3 (contínua); tirante
  CEB (z = 0,2·(l+2h) | 0,6·l | 0,2·(l+1,5h)) concentrado na base com
  ancoragem total, malha de alma 0,075%·b/face e biela do apoio ≤ 0,85·αv·fcd
- [x] Integração automática no designBeams: viga curta e alta troca a flexão
  pelo tirante (As = máx) com notas §22.4 no vão
- [x] `designCorbel`: curto (biela-tirante z = 0,8·d, Hd ≥ 0,2·Fd, costura
  0,4·As em estribos horizontais), muito curto (atrito-cisalhamento μ = 1,4)
  e a/d > 1 vira balanço comum — exportado p/ uso via Copiloto/API (UI de
  consolo como elemento fica p/ o futuro)
- [x] 6 testes com âncoras à mão — 387 no total

## v0.2.28 — Consolo como elemento do pilar ✅

- [x] `CorbelDef` no modelo (nível, face 0/90/180/270, b×d, a, Fd, Hd)
- [x] Inspetor do pilar: seção "Consolos" com adicionar/editar/remover e
  VERIFICAÇÃO AO VIVO via designCorbel (tirante, costura, biela OK/FALHA)
- [x] 3D: caixa do consolo na face do pilar com topo no nível escolhido
- [x] Nota honesta: Fd é de cálculo e não entra no pórtico automaticamente
- [ ] Futuro: consolo na prancha do pilar (elevação) e carga → pórtico

## v0.2.29 — Consolo no pórtico + elevação do pilar ✅

- [x] buildModel: carga do consolo entra no caso G como Fd/1,4 (característica)
  no nó do pilar do nível, COM o momento da excentricidade (e = meia seção + a)
  — o consolo flete o pilar; aviso no modelo; ΣFz fecha exato no teste
- [x] Elevação do pilar: caixa do consolo (face ±) com face inclinada, tirante
  com alça desenhado e texto de verificação (tirante + costura + regime §22.5,
  alerta de biela)
- [x] 3 testes (equilíbrio +100 kN exato, momento no pilar, desenho) — 390

## v0.2.30 — Muro de arrimo + radier (engine) ✅

- [x] `designRetainingWall`: Rankine (Ka), tombamento/deslizamento FS ≥ 1,5,
  σ na base (núcleo central), fuste/talão como balanços por metro, notas de
  drenagem (barbacãs) e face tracionada — âncora Ea = 37 kN/m, FS tomb = 3,0
- [x] `designRaft` (rígido): planta pelos eixos + balanço, pressão linear
  pela resultante (ex/ey), punção §19.5 com a carga real de cada pilar,
  flexão por faixas (M ≈ σd·l²/10) com malha dupla — nota honesta de
  pré-dimensionamento (flexível/Winkler no futuro)
- [x] Exportados p/ Copiloto/API; 7 testes — 397 no total
- [ ] Futuro: muro/radier como ELEMENTOS desenháveis (2D/3D/prancha) e
  radier flexível sobre Winkler

## v0.2.31 — Geometrias reais: sapata piramidal e consolo trapezoidal ✅

- [x] `FootingResult.h0` = máx(h/3; 15 cm): sapata TRONCOPIRAMIDAL por padrão
  (rodapé h0 + faces inclinadas até h junto ao pilar) com nota executiva;
  select "Forma da sapata" (piramidal/reta) no inspetor
- [x] 3D: FrustumMesh (tronco de pirâmide real sobre o rodapé) p/ sapatas
- [x] Consolo: `CorbelDef.tipH` (altura da ponta ≥ h/2, §22.5) com campo no
  inspetor; 3D com WedgeMesh (perfil trapezoidal — retângulo + mísula)
- [x] 398 testes

## v0.2.32 — Radier visível no modelo ✅

- [x] `FoundationParams.raft` (espessura + balanço) nas Configurações de
  fundação: liga o radier sob todo o edifício
- [x] 3D: placa do radier (bounding dos pilares + balanço) substitui os
  sólidos das fundações diretas quando ativa
- [x] Cálculo continua via `designRaft` (rígido, punção por pilar) —
  Copiloto/API; card na aba Fundações e muro DESENHÁVEL ficam p/ a próxima

## v0.2.33 — Modo unifilar no 3D (PR #1 — @danubiolagoa) ✅

- [x] PRIMEIRA CONTRIBUIÇÃO EXTERNA: modo unifilar (só os eixos do pórtico)
  p/ visualizar diagramas — obrigado @danubiolagoa!
- [x] Aplicado sobre o main atual (o branch estava 15 versões atrás) com
  co-autoria no commit; ajustes de review: checkbox só com análise rodada
  (evitava cena vazia), acesso O(1) aos nós, linewidth removido (WebGL ignora)

## v0.2.34 — Vibração de piso (§23.3) ✅

- [x] `checkFloorVibration`: f₁ = 18/√δ (Rayleigh; δ = flecha IMEDIATA
  quase-permanente — fluência removida, fissuração mantida a favor da
  segurança) ≥ 1,2·fcrit; `fcritForUse` pelo rótulo NBR 6120 (academia 8 ·
  dança 7 · escritório 4 · demais 3,5 Hz — Tabela 23.1, valores adotados)
- [x] Integrado ao runSlabDesign p/ TODOS os métodos (Marcus, grelha
  unificada, nervurada): campo `vibration`, nota §23.3 e status atenção
- [x] UI: coluna f₁ (Hz) na aba Lajes com chip ok/err e tooltip do limite
- [x] 4 testes (âncora 18/√4 = 9 Hz) — 402 no total

## v0.2.35 — Pacote de geometria curva ✅

- [x] `arcPoints`/`arcLength` (corda + flecha, R = c²/8s + s/2): discretização
  com erro de corda ≤ 2 cm (2–24 subdivisões automáticas)
- [x] Inspetor da VIGA: "Curvar trecho" (nº + flecha em cm, + = esquerda do
  sentido) — o trecho vira polilinha em arco; seções por trecho preservadas;
  a torção da viga curva o pórtico já captura (§17.5 dimensiona)
- [x] Inspetor da LAJE: "Curvar borda" (+ = p/ FORA, detecção automática do
  lado pelo centróide) — Marcus sai (não retangular) e a grelha assume
- [x] Tudo desfazível (⌘Z); 4 testes de âncora geométrica — 406 no total
- [ ] Futuro: ferramenta de arco no ato do desenho + arco reeditável (metadado)

## Backlog técnico consolidado (18/07/2026 — direcionamentos do Cândido)

> Prioridade nova: **fundações como ELEMENTOS do modelo** (hoje são só resultado
> de cálculo — sem edição de geometria, posição, planta ou 3D). Vibração (§23.3)
> explicitamente adiada p/ o futuro.

1. **Fundações editáveis**: ✅ COMPLETO — v0.2.17 (edição por pilar + planta),
   v0.2.18 (viga alavanca + detalhamento) e v0.2.19 (sapatas associadas +
   blocos 6–16 estacas CEB). Sobrou só sapata corrida sob alinhamento de
   pilares (caso raro em edifícios — baldrame de Winkler já cobre parcial)
2. ✅ Armação de LAJES em planta (v0.2.20)
3. ✅ Grelha de pavimento unificada (v0.2.21) — continuidade real entre lajes
   + vigas flexíveis; restam nervuradas na unificada (hoje seguem por laje)
4. ✅ Mesa colaborante das vigas (v0.2.22) — falta só a inércia T na análise
5. ✅ Núcleo rígido / pilar-parede (v0.2.23) — restam abas de L como paredes
6. ✅ Pilares executivos (v0.2.24)
7. ✅ Refinamentos de análise (v0.2.25): inércia T no pórtico, vento c/
   excentricidade 7,5%, redistribuição §14.6.4.3. Futuro: P-Δ iterativo,
   Ca Fig. 4 digitalizado, trapezoidal no Marcus
8. FUTURO (decisão 18/07): vibração de piso §23.3, vento dinâmico (cap. 9),
   sismo NBR 15421, treliçadas, protensão, aço NBR 8800

## Paridade com o CypeCAD — mapa de módulos e fases

> Referência: lista de módulos do CypeCAD (multiplus.com) + recursos do pacote.
> Estado em v0.2.3 e fase planejada p/ cada lacuna.

| Módulo CypeCAD | HyperFrame hoje | Fase |
|---|---|---|
| Núcleo (modelagem, normas, análise) | ✅ pórtico 3D + NBR 6118/6120/6123/8681 | — |
| Pilares de concreto (ret./circ./seção genérica) | ✅ ret., circular, L (0–270°) | seções poligonais genéricas → v0.4 |
| Pilares-parede (MEF) | ⚠️ barra + aviso §15.9 | cascas/pórtico equivalente → v0.4 |
| Pilares metálicos / mistos / madeira | ❌ | NBR 8800 (aço) → v0.4 · mistos/NBR 7190 → v1.x |
| Vigas de concreto | ✅ flexão/corte/torção/pele/furos | — |
| Vigas metálicas e mistas | ❌ | NBR 8800 + conectores → v0.4 |
| Lajes maciças | ✅ Marcus ou grelha (v0.2.6/7) + flechas + ELS-W | — |
| Lajes nervuradas | ✅ v0.2.3 (in loco, bi/uni) | vigotas/treliçadas → v0.5 |
| Lajes cogumelo/lisas | ✅ grelha c/ pilar interno + punção §19.5 (v0.2.6) | faixas §14.7.8 + armadura de punção detalhada → v0.5 |
| Lajes alveolares / steel-deck | ❌ | catálogos de fornecedores → v1.x |
| Protensão (lajes) | ❌ | perdas + eq. de carga + hiperestático → v1.x |
| Sapatas | ✅ rígidas c/ excentricidade | associadas/corridas → v0.5 |
| Blocos sobre estacas | ✅ Blévot 1–5 | ≥ 6 estacas (CEB) → v0.5 |
| Tubulões | ✅ v0.2.3 | — |
| Radier / vigas sobre apoio elástico | ✅ baldrames Winkler (v0.2.6) | radier (placa) → v1.x |
| Interação solo-estrutura | ✅ SPT → CRV/CRH + recalques | molas por camada em estacas → v0.5 |
| Fundação + superestrutura integrada | ✅ 2 passes c/ molas + baldrames (v0.2.6) | — |
| Cortinas e reservatórios enterrados | ⚠️ reservatórios elevados | empuxo de terra → v0.5 |
| Lançamento automático BIM/IFC | ⚠️ underlay DXF | import/export IFC → v1.0 |
| Cargas de paredes (BIM) | ✅ manuais (inteiras/por trecho) | do IFC → v1.0 |

## v0.3 — Beta fechado (2–3 meses)

- [ ] 10–15 calculistas convidados; telemetria de erros (opt-in) e feedback in-app
- [x] Detalhamento de armaduras de vigas — v0.2.8 (ganchos, al, quadro de ferros) +
  v0.2.9 (cortes pelo diagrama real c/ escalonamento, emendas §9.5.2, editor de
  armaduras); refinamentos futuros: 2ª camada desenhada, emendas alternadas (α0t=1,3)
- [ ] Núcleo rígido / pilares-parede (elemento de casca simplificado ou pórtico equivalente)
- [x] ~~Torção de compatibilidade~~ (v0.2.1) · [ ] redistribuição de momentos
- [x] ~~Desaprumo global (§11.3.3.4.1)~~ (v0.2.1) · [ ] excentricidade de vento (±7,5%)
- [ ] Performance: solver em **Rust/WASM** (mesma interface, 10–50× mais rápido, base da proteção anticópia)
- [ ] Instaladores assinados: notarização macOS (Apple Developer R$ 500/ano) + Authenticode Windows; CI GitHub Actions com matriz mac/win

## v1.0 — Lançamento comercial (6–9 meses)

- [ ] Licenciamento: conta cloud + ativação Ed25519 + graça offline 30 dias (ver BUSINESS.md §4)
- [ ] Site + checkout (Stripe/Pagar.me: Pix, boleto, cartão) + área do assinante
- [ ] Auto-update (plugin updater do Tauri)
- [ ] Versão Estudante (marca d'água, limite 4 pavimentos)
- [ ] Documentação pública + 10 vídeos tutoriais + 3 projetos-exemplo completos
- [ ] IFC import/export (OpenBIM) — paridade com o argumento BIM do Eberick

## v1.x — Expansão

- [ ] IA nativa: "lançar estrutura a partir da planta de arquitetura", crítica automática de modelo ("L3 sem apoio", "P12 esbelto"), memorial redigido por IA
- [ ] Protensão (lajes/vigas), pré-moldados, alvenaria estrutural (NBR 16868), aço (NBR 8800 — reaproveitar know-how do vigaframe/mixlab)
- [ ] Análise dinâmica (vento dinâmico NBR 6123, sismo NBR 15421)
- [x] ~~Interação solo-estrutura (molas de fundação)~~ (v0.2.2 — evoluir p/ molas por
  camada ao longo de estacas e sondagens múltiplas por região)
- [ ] Colaboração em nuvem (projetos compartilhados, versionamento)

## Dívidas técnicas conhecidas (v0.1)

| Item | Impacto | Plano |
|---|---|---|
| Ca do vento: grade aproximada da Fig. 4 | ±10% na força de vento; usuário pode sobrescrever | Digitalizar a figura da norma (v0.3) |
| Quinhões de laje: uniforme equivalente (não trapezoidal) | Momentos de viga ligeiramente suavizados | Atenuado (v0.2.6): grelha dá o quinhão exato por borda; trapezoidal no Marcus (v0.3) |
| Lajes não entram na rigidez (só carga + diafragma) | Conservador p/ vigas | Grelha (v0.2.6) cobre distribuição/flechas; rigidez no pórtico → casca (v0.4) |
| Apoios sempre engastados na fundação | Usual, mas não configurável | Molas/rotulado (v0.3) |
| V0 das cidades: aproximado das isopletas | Usuário confirma na UI | Mapa interativo (v0.3) |
| ~~Pilar: verificação simplificada~~ | — | ✅ resolvido (v0.2: flexo-compressão oblíqua) |
| ~~Vigas: sem flecha ELS, sem armadura de pele~~ | — | ✅ resolvido (v0.2 flechas; v0.2.1 pele/wk/torção) |
