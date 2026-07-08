# HyperFrame

**Análise e dimensionamento estrutural de edifícios de concreto armado — normas ABNT.**
macOS + Windows (Tauri) e navegador. Concorrente moderno de TQS/Eberick.

![status](https://img.shields.io/badge/vers%C3%A3o-0.1.0-orange) ![tests](https://img.shields.io/badge/testes-80%20passando-brightgreen)

## O que já faz (v0.1)

- **Modelagem 2D em planta** (estilo planta de forma): eixos com bulbos, pilares, vigas em
  polilinha com snap/orto, lajes com detecção automática de contorno fechado, cargas de
  alvenaria — com undo/redo, atalhos (V/P/B/L/W) e cotas automáticas
- **3D sincronizado**: seleção cruzada 2D↔3D, isolamento de pavimento, sombras, deformada
  (interpolação de Hermite) e diagramas N/My/Mz em fita sobre as barras
- **Análise**: pórtico espacial (6 GDL/nó) gerado automaticamente, diafragma rígido
  mestre-escravo por pavimento, solver skyline LDLᵀ próprio, dois passes de rigidez
  (ELU com 0,4/0,8·Eci·Ic — NBR 6118 §15.7.3 — e ELS integral)
- **Cargas e combinações**: peso próprio, NBR 6120 (presets), quinhões de laje a 45°,
  vento NBR 6123 (S1/S2/S3, Ca estimado da Fig. 4, editável), 13 combinações ELU + 6 ELS
  (NBR 8681)
- **Verificações**: γz e parâmetro α (§15.5), deslocamentos laterais limites (tab. 13.3),
  dimensionamento de vigas à flexão e cisalhamento com escolha de barras (NBR 6118),
  verificação simplificada de pilares, quantitativos (concreto/forma/aço) e relatório
  imprimível (memória de cálculo resumida)

## Rodar

```bash
npm install

# navegador (mais rápido p/ desenvolver)
npm run dev              # → http://localhost:5183

# app desktop (requer Rust: https://rustup.rs)
npm run tauri dev        # janela nativa
npm run tauri build      # gera .app/.dmg em apps/desktop/src-tauri/target/release/bundle/

# testes e verificação de tipos
npm test
npm run typecheck
```

Na tela inicial, use **“Abrir projeto de exemplo”** (edifício residencial de 8 pavimentos)
e clique **Analisar**.

## Estrutura

```
packages/engine     # núcleo puro TypeScript (zero dependências)
  src/model         # tipos do edifício, presets NBR 6120/6123, projeto exemplo
  src/geometry      # geometria 2D + detecção de faces (painéis de laje)
  src/analysis      # pórtico espacial: geração, rigidez, skyline LDLᵀ, diagramas
  src/nbr           # NBR 6118 (materiais, vigas, estabilidade) · 6123 (vento) · 8681 (combinações)
  test              # 80 testes (âncoras analíticas, normas, equilíbrio global)
apps/desktop        # Tauri 2 + React 19 + three.js
  src/editor2d      # editor de planta SVG (snap, ferramentas, camadas)
  src/viewer3d      # visualizador 3D (R3F): edifício, deformada, diagramas
  src/panels        # inspetor, resultados, relatório, configurações
  src/wizard        # assistente de novo projeto
  src/store         # Zustand + zundo (undo/redo)
  src-tauri         # shell nativo (Rust)
```

## Documentos

- [ROADMAP.md](./ROADMAP.md) — fases até o lançamento comercial e dívidas técnicas
- [BUSINESS.md](./BUSINESS.md) — mercado, preços (pesquisa jul/2026), licenciamento, go-to-market
- [VALIDATION.md](./VALIDATION.md) — política de validação e o que falta p/ uso em projeto real

## ⚠️ Aviso

Software **em desenvolvimento (v0.1)**. Os resultados ainda não passaram por validação
cruzada com softwares consagrados (ver VALIDATION.md) e **não substituem a análise e a
responsabilidade técnica de um engenheiro habilitado (ART/CREA)**.
