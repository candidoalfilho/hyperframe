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
- [ ] **Modelos locais baixáveis no app** (llama.cpp + gerenciador de download, p/ o
  release não pesar) → v0.4
- [ ] Streaming de texto no chat + contexto de seleção (elemento selecionado vai junto) → v0.3

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
| Lajes maciças | ✅ Marcus + flechas + ELS-W | grelha própria → v0.3 |
| Lajes nervuradas | ✅ v0.2.3 (in loco, bi/uni) | vigotas/treliçadas → v0.5 |
| Lajes cogumelo/lisas | ⚠️ punção §19.5 pronta | pórtico equivalente §14.7.8 → v0.5 |
| Lajes alveolares / steel-deck | ❌ | catálogos de fornecedores → v1.x |
| Protensão (lajes) | ❌ | perdas + eq. de carga + hiperestático → v1.x |
| Sapatas | ✅ rígidas c/ excentricidade | associadas/corridas → v0.5 |
| Blocos sobre estacas | ✅ Blévot 1–5 | ≥ 6 estacas (CEB) → v0.5 |
| Tubulões | ✅ v0.2.3 | — |
| Radier / vigas sobre apoio elástico | ⚠️ molas nodais prontas no solver | baldrames Winkler → v0.3 · radier (placa) → v1.x |
| Interação solo-estrutura | ✅ SPT → CRV/CRH + recalques | molas por camada em estacas → v0.5 |
| Fundação + superestrutura integrada | ✅ 2 passes c/ molas | baldrames/travamentos → v0.3 |
| Cortinas e reservatórios enterrados | ⚠️ reservatórios elevados | empuxo de terra → v0.5 |
| Lançamento automático BIM/IFC | ⚠️ underlay DXF | import/export IFC → v1.0 |
| Cargas de paredes (BIM) | ✅ manuais (inteiras/por trecho) | do IFC → v1.0 |

## v0.3 — Beta fechado (2–3 meses)

- [ ] 10–15 calculistas convidados; telemetria de erros (opt-in) e feedback in-app
- [ ] Detalhamento de armaduras de vigas (desenho: barras, dobras, tabela de aço) → prancha DXF/PDF
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
| Quinhões de laje: uniforme equivalente (não trapezoidal) | Momentos de viga ligeiramente suavizados | Cargas trapezoidais exatas (v0.3) |
| Lajes não entram na rigidez (só carga + diafragma) | Conservador p/ vigas | Grelha/casca opcional (v0.3) |
| Apoios sempre engastados na fundação | Usual, mas não configurável | Molas/rotulado (v0.3) |
| V0 das cidades: aproximado das isopletas | Usuário confirma na UI | Mapa interativo (v0.3) |
| ~~Pilar: verificação simplificada~~ | — | ✅ resolvido (v0.2: flexo-compressão oblíqua) |
| ~~Vigas: sem flecha ELS, sem armadura de pele~~ | — | ✅ resolvido (v0.2 flechas; v0.2.1 pele/wk/torção) |
