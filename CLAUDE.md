# CLAUDE.md — HyperFrame

Software de engenharia estrutural (ABNT) — monorepo npm workspaces.

## Comandos

```bash
npm run dev          # vite dev server (browser) em http://localhost:5183
npm test             # vitest de todos os workspaces: engine + apps/desktop (obrigatório antes de commit)
npm run typecheck    # tsc em todos os workspaces
npm run tauri dev    # app desktop (precisa de Rust no PATH: ~/.cargo/bin)
npm run tauri build  # bundle .app/.dmg
npm run build:web    # versão web estática (sem Tauri) → apps/desktop/dist-web/
npm run serve:web    # site em / + app web em /app/ (http://localhost:4173)
```

## Arquitetura (decisões que não se quebram)

- **`packages/engine` é TypeScript puro, zero dependências, zero DOM.** Todo cálculo vive
  lá e é testável headless. A UI consome via alias `@hyperframe/engine` (aponta p/ `src/`,
  sem build step). Futuro: swap por Rust/WASM mantendo a mesma interface.
- **Unidades internas SI**: m, kN, kN·m, kPa. A UI converte p/ cm/MPa só na borda.
  Números exibidos em pt-BR (vírgula decimal).
- **Convenções do solver** (`analysis/frame3d.ts`): elemento 12 GDL; vigas: y local = Z
  global (cima), Iz = bw·h³/12 (flexão de gravidade = Mz, sagging positivo); pilares:
  x local p/ cima, y local = direção de `h` (rotationDeg). Diagramas validados por testes
  de viga biengastada — não alterar sinais sem atualizar `test/solver.test.ts`.
- **Diafragma rígido**: mestre-escravo via transformação de GDL em `analysis/solve.ts`
  (`numberDofs`). Escravos: ux/uy/rz mapeados ao mestre com braços de alavanca.
- **Dois passes de rigidez**: ELU usa `stiffnessReduction`×Eci (NBR 6118 §15.7.3);
  ELS usa Ecs integral. Combinações carregam `stiffness: 'elu' | 'els'`.
- **Módulos NBR** (`src/nbr/`): funções puras com valores de norma transcritos e testes
  com âncoras calculadas à mão. Qualquer mudança nesses arquivos exige teste novo.
- Store Zustand em `apps/desktop/src/store/index.ts`: TODA mutação de projeto passa por
  ações do store (invalidam `results` automaticamente). Undo/redo = zundo (só `project`).
- **Desktop × web**: o mesmo app roda no Tauri e como site estático. Diferenças passam
  SEMPRE pelas flags de `src/platform.ts` (ex.: `platform.browserProjects`, Copiloto IA só
  no desktop) — nunca mudar comportamento do desktop sem flag. Na web os projetos vivem
  no IndexedDB (`src/web/`), com rota por hash `#/p/<uuid>` e importar/exportar
  `.hyperframe.json`.
- Análise roda em Web Worker (`workers/analysis.worker.ts`) — engine precisa continuar
  serializável (sem classes nos resultados).

## Regras

- Editar código de cálculo (`analysis/`, `nbr/`) ⇒ rodar `npm test` e citar a seção da
  norma no comentário.
- UI sempre pt-BR; formatação numérica via helpers `fmt`/`cm` (`panels/format.ts`,
  `editor2d/format.ts`).
- Não adicionar dependências sem necessidade real (engine: proibido; app: discutir).
- Docs de produto: BUSINESS.md, ROADMAP.md, VALIDATION.md — manter sincronizados quando
  funcionalidades mudarem de status.
