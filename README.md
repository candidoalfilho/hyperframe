# HyperFrame

**Análise e dimensionamento estrutural de edifícios de concreto armado — normas ABNT.**
macOS + Windows (Tauri) e navegador. Alternativa moderna e aberta aos softwares
estruturais tradicionais do mercado — **100% open source**, com binários por
sistema e código-fonte no site.

![status](https://img.shields.io/badge/vers%C3%A3o-0.2.13-orange) ![tests](https://img.shields.io/badge/testes-316%20passando-brightgreen)

## O que já faz (v0.2.13)

- **Modelagem 2D em planta** (estilo planta de forma): eixos com bulbos, pilares
  (**retangulares, circulares e em L**, rotação 0/90/180/270°, **nascendo/morrendo em
  qualquer nível — transferência em viga**), vigas em polilinha com snap/orto (**seção
  variável por trecho** e **furos na alma**), lajes com detecção automática de contorno
  fechado, cargas de alvenaria (**inteiras ou por trecho**), **regiões de
  escada/reservatório**, **furos/aberturas de laje** (shaft, elevador — escadas abrem furo
  automático, com X de vazio na planta), **underlay de DXF de arquitetura**, **múltiplas
  plantas de forma** (térreo ≠ tipo ≠ cobertura) — com undo/redo, atalhos e **verificação
  de consistência** (avisos graves/médios/leves antes da análise)
- **3D sincronizado**: seleção cruzada 2D↔3D, isolamento de pavimento, sombras, deformada
  (interpolação de Hermite), diagramas N/My/Mz em fita sobre as barras, **escadas e
  reservatórios como sólidos** (lance com degraus, laje inclinada e patamar; caixa com
  paredes e tampa), **lajes com furos reais** sobre as escadas/aberturas e **furos na
  alma das vigas** recortados no sólido (§13.2.5)
- **Análise**: pórtico espacial (6 GDL/nó) gerado automaticamente, diafragma rígido
  mestre-escravo por pavimento, solver skyline LDLᵀ próprio, dois passes de rigidez
  (ELU com 0,4/0,8·Eci·Ic — NBR 6118 §15.7.3 — e ELS integral)
- **Cargas e combinações**: peso próprio, NBR 6120 (presets), quinhões de laje a 45°
  **ou pelas reações da grelha** (método selecionável), vento NBR 6123 (S1/S2/S3, Ca estimado da Fig. 4, editável), **desaprumo global**
  (§11.3.3.4.1, combinado ao vento pela regra da norma), 13 combinações ELU + 6 ELS
  (NBR 8681)
- **Estabilidade e serviço**: γz e parâmetro α (§15.5), **2ª ordem global aproximada
  0,95·γz** (§15.7.2), deslocamentos laterais (tab. 13.3), **flechas de vigas e lajes**
  (Branson + fluência, L/250), **fissuração ELS-W** (wk vs tab. 13.4)
- **Dimensionamento NBR 6118**: vigas (flexão + cisalhamento + **torção §17.5** +
  **armadura de pele** + barras), **pilares a flexo-compressão oblíqua** (integração da
  seção + pilar-padrão), **lajes maciças** (Marcus ou **analogia de grelha** — contorno
  qualquer, furos e **lajes lisas** com pilar interno), **lajes nervuradas** (§13.2.4.2 —
  peso real com enchimento, seção T por nervura, cisalhamento §19.4.1), **punção §19.5**
  (pilares **internos, de borda e de canto** com transferência de momento K·MSd,
  perímetros reduzidos u*, reação real da grelha, desconto por aberturas §19.5.1 e ARMADURA DE PUNÇÃO dimensionada — linhas de conectores até o contorno C″ §19.5.3.4 e colapso progressivo §19.5.4),
  **escadas** (lance como laje inclinada) e
  **reservatórios** (paredes/fundo/tampa com estanqueidade wk ≤ 0,2 mm)
- **Fundações**: **sapatas rígidas** (bielas/CG com presets de solo), **blocos sobre
  estacas** (método das bielas — Blévot, 1–5 estacas, presets) ou **tubulões a céu
  aberto** (fuste + base alargada, NBR 6122), **planta de cargas** (reações
  características por pilar p/ o projetista de fundações), **baldrames sobre apoio
  elástico de Winkler** (ks manual, da sondagem ou 120·σadm; pressão no solo × σadm)
- **Interação solo-estrutura**: sondagem SPT por camadas → **molas de apoio CRV/CRH**
  (Es = α·K·NSPT — Teixeira & Godoy p/ sapatas; **Aoki–Velloso** p/ estacas), re-análise
  do pórtico sobre apoios elásticos, **recalques ELS-QP** e distorções angulares
- **Incêndio (NBR 14432 + NBR 15200)**: TRRF automático por ocupação×altura, método
  tabular p/ vigas e lajes, método analítico p/ pilares — aba própria e relatório
- **Pranchas e detalhamento**: planta de forma (cotas entre eixos), **corte
  esquemático** (níveis, pilares, vigas seccionadas e pé-direito cotado), **planta de
  cargas**, **armação de vigas executiva** (ganchos desenhados, **cortes pelo diagrama
  real** com decalagem al §17.4.2.2 e escalonamento, **emendas por traspasse** §9.5.2,
  estribos na distribuição real, **QUADRO DE FERROS** por posição e **editor de
  armaduras** com aviso de As insuficiente), seções de pilares —
  SVG no app, **exportação DXF** (writer R12 próprio), **moldura + carimbo ABNT**
  (A0–A4, escala automática ou fixa; cotas proporcionais à escala), tabela de aço por
  bitola, relatório imprimível e **memorial de cálculo completo em PDF** (writer PDF
  próprio, 15 seções + furos/solo/custo, multipágina)
- **Quantitativos com custo**: concreto, fôrma e aço por elemento + **estimativa de
  custo** (R$/m³, R$/kg, R$/m² editáveis) e custo por m² de laje
- **Produtividade**: **diagramas N/V/M por barra no inspetor** (com valores e combinação
  selecionável), **salvar/abrir nativos** (diálogos do SO no desktop, ⌘S/⌘O), **autosave
  com recuperação**, **pé-direito variável por pavimento** no gerenciador de níveis
- **Copiloto IA**: chat integrado que lê o modelo, verifica consistência, roda a análise
  e **edita a estrutura com aprovação manual** de cada mudança (estilo Claude Code) —
  **modo planejamento** (só leitura + plano), mudanças no undo/redo. Dois provedores:
  **Claude (API)** com chave local, ou **modelos locais via Ollama** (offline/privado)
  com **download dos modelos dentro do app** (qwen3, llama3.1 — barra de progresso)

## Rodar

```bash
npm install

# navegador (mais rápido p/ desenvolver)
npm run dev              # → http://localhost:5183

# app desktop (requer Rust: https://rustup.rs)
npm run tauri dev        # janela nativa
npm run tauri build      # gera .app/.dmg em apps/desktop/src-tauri/target/release/bundle/

# instalador WINDOWS a partir do macOS (cross-compile):
#   brew install llvm lld nsis && cargo install --locked cargo-xwin
#   rustup target add x86_64-pc-windows-msvc
PATH="/opt/homebrew/opt/llvm/bin:$PATH" npm run tauri build -- \
  --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
# → target/x86_64-pc-windows-msvc/release/bundle/nsis/HyperFrame_*_x64-setup.exe
# (CI: .github/workflows/release.yml builda mac/win/linux ao criar tag v*)

# testes e verificação de tipos
npm test
npm run typecheck
```

Na tela inicial, use **“Abrir projeto de exemplo”** (edifício residencial de 8 pavimentos)
e clique **Analisar**.

## Estrutura

```
packages/engine     # núcleo puro TypeScript (zero dependências)
  src/model         # tipos do edifício, presets NBR 6120/6123, solo, projeto exemplo
  src/geometry      # geometria 2D, detecção de faces, recorte de polígonos
  src/analysis      # pórtico espacial: geração, rigidez, skyline LDLᵀ, diagramas
  src/nbr           # NBR 6118 (materiais, vigas, pilares, lajes, sapatas, flechas,
                    #   ancoragem, estabilidade) · 6123 (vento) · 8681 (combinações)
  src/design        # laços de dimensionamento + detalhamento (tabela de aço)
  src/drawing       # pranchas (primitivas neutras → SVG/DXF)
  src/dxf           # parser (underlay) e writer (R12) de DXF próprios
  src/report        # memorial de cálculo em PDF (writer PDF próprio, zero deps)
  test              # 316 testes (âncoras analíticas, normas, equilíbrio global)
apps/desktop        # Tauri 2 + React 19 + three.js
  src/editor2d      # editor de planta SVG (snap, ferramentas, camadas, underlay)
  src/viewer3d      # visualizador 3D (R3F): edifício, deformada, diagramas
  src/panels        # inspetor, resultados, relatório, plantas, configurações
  src/drawings      # visualizador de pranchas (SVG) + exportação DXF
  src/wizard        # assistente de novo projeto
  src/store         # Zustand + zundo (undo/redo)
  src-tauri         # shell nativo (Rust)
site/               # landing page (lista de espera) — ver site/README.md
```

## Documentos

- [ROADMAP.md](./ROADMAP.md) — fases até o lançamento comercial e dívidas técnicas
- [BUSINESS.md](./BUSINESS.md) — mercado, preços (pesquisa jul/2026), licenciamento, go-to-market
- [VALIDATION.md](./VALIDATION.md) — política de validação e o que falta p/ uso em projeto real

## ⚠️ Aviso

Software **em desenvolvimento (v0.1)**. Os resultados ainda não passaram por validação
cruzada com softwares consagrados (ver VALIDATION.md) e **não substituem a análise e a
responsabilidade técnica de um engenheiro habilitado (ART/CREA)**.
