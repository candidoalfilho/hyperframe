import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  createSampleProject,
  createEmptyProject,
  arrangeSheet,
  autoDimension,
  detectFaces,
  placeNewSheetItem,
  placeNewSheetItems,
  dimStyleOf,
  refreshDimensions,
  nextBeamName,
  nextColumnName,
  nextPlanName,
  nextRegionName,
  nextSlabName,
  pointInPolygon,
  runDetailing,
  runFoundationDesign,
  uid,
  REGION_PRESETS,
  type AnalysisResults,
  type Beam,
  type AutoDimOptions,
  type Column,
  type ColumnRebarOverride,
  type ColumnSection,
  type DimStyle,
  type Dimension,
  type DxfUnderlay,
  type ElementRef,
  type FloorPlan,
  type LoadRegion,
  type SlabLoad,
  type MasonryWall,
  type NewProjectParams,
  type Project,
  type ProjectSettings,
  type RebarOverride,
  type FoundationOverride,
  type SectionRect,
  type SheetItem,
  type SheetLayout,
  type SheetSource,
  type Slab,
  type Vec2,
  type WallLoad,
  type RebarCategory,
} from '@hyperframe/engine'
import { pushRecent } from '../io/fileio'
import {
  alignInProject,
  anchorOffset,
  centerFromAnchor,
  distributeInProject,
  moveInProject,
  type AlignMode,
  type ColumnAnchor,
} from './align'

/** elementos efetivamente selecionados (seleção múltipla válida ou a simples) */
export function selectedRefs(s: { selection: ElementRef | null; multi: ElementRef[] }): ElementRef[] {
  const sel = s.selection
  if (!sel) return []
  if (s.multi.length >= 2 && s.multi.some((r) => r.kind === sel.kind && r.id === sel.id)) return s.multi
  return [sel]
}

export type Tool =
  | 'select'
  | 'column'
  | 'beam'
  | 'slab'
  | 'wall'
  | 'region'
  | 'mwall'
  | 'measure'
  | 'slabload'
  | 'dim'
export type ViewMode = 'plan' | '3d' | 'split'
export type Theme = 'dark' | 'light'

const THEME_KEY = 'hyperframe-theme'

function readInitialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
}
export type ResultsTab =
  | 'estabilidade'
  | 'vigas'
  | 'pilares'
  | 'lajes'
  | 'escadas'
  | 'reservatorios'
  | 'fundacoes'
  | 'alvenaria'
  | 'incendio'
  | 'cargas'
  | 'reacoes'
  | 'quantitativos'
  | 'pranchas'
  | 'relatorio'

export type Diagram3D = 'none' | 'My' | 'Mz' | 'N'

export interface DisplayOptions {
  showAxes: boolean
  showDims: boolean
  showNames: boolean
  showLoads: boolean
  showSlabs: boolean
}

export interface D3Options {
  showSlabs: boolean
  /** sólidos das fundações (sapatas/blocos/estacas/tubulões) sob o térreo */
  showFoundations: boolean
  /** escadas e reservatórios como sólidos 3D */
  showRegions: boolean
  isolateActiveLevel: boolean
  showDeformed: boolean
  deformScale: number
  diagram: Diagram3D
  diagramScale: number
  activeComboId: string | null
  /** modo unifilar: só os eixos do pórtico (útil p/ diagramas) — PR #1 @danubiolagoa */
  wireframeMode: boolean
  /** armaduras de vigas e pilares (issue #25); o concreto vira fantasma */
  showRebar: boolean
  /** categorias de armadura visíveis */
  rebarCats: Record<RebarCategory, boolean>
  /** só as armaduras deste elemento (null = todos) */
  rebarElement: { kind: 'beam' | 'column'; id: string } | null
  /** grupo de barras selecionado (id de RebarGroup3D) */
  rebarSel: string | null
}

export interface ElementDefaults {
  columnSection: ColumnSection
  columnRotation: 0 | 90 | 180 | 270
  /** ponto da seção sob o cursor ao inserir o pilar (ausente = centro) */
  columnAnchor?: ColumnAnchor
  beamSection: SectionRect
  slabThickness: number
  slabFinish: number
  slabLive: number
  slabLiveLabel: string
  wallW: number
  wallLabel: string
  regionKind: 'escada' | 'reservatorio' | 'generica' | 'furo'
  /** carga sobre laje a inserir: pontual (1 clique) ou linear (2 cliques) */
  slabLoadKind?: 'point' | 'line'
  /** valores iniciais: kN (pontual) / kN/m (linear) */
  slabLoadG?: number
  slabLoadQ?: number
  /** cota a inserir: linear (H/V conforme o lado em que a linha é posta) ou alinhada */
  dimMode?: 'linear' | 'aligned'
  /** simples (2 pontos), em cadeia ou acumulada a partir do 1º ponto */
  dimForm?: 'single' | 'chain' | 'baseline'
  /** cadeia: linha extra com o total */
  dimTotal?: boolean
  /** prende os pontos aos elementos do modelo (padrão: sim) */
  dimAssoc?: boolean
}

/**
 * Pré-visualização fantasma de uma proposta do Copiloto aguardando aprovação:
 * desenhada no editor 2D (tracejado) p/ o usuário VER a mudança antes de aceitar.
 * mode 'add' = elemento novo proposto; 'target' = elemento existente que será
 * alterado/removido.
 */
export interface AiGhost {
  kind: 'column' | 'beam' | 'slab'
  /** column: [pos]; beam: path; slab: polígono — coords de mundo (m) */
  pts: Vec2[]
  /** largura da viga (m) p/ espessura do traço */
  bw?: number
  mode: 'add' | 'target'
  label: string
}

export interface HFState {
  // ---- projeto ----
  project: Project
  fileName: string | null
  dirty: boolean

  // ---- ui ----
  tool: Tool
  viewMode: ViewMode
  activeLevelId: string
  selection: ElementRef | null
  /**
   * seleção múltipla (Shift+clique, janela, ⌘A). Só vale quando tem ≥ 2
   * elementos e contém `selection` — use `selectedRefs(state)` p/ ler.
   */
  multi: ElementRef[]
  hoverRef: ElementRef | null
  theme: Theme
  welcomeOpen: boolean
  /** há um projeto aberto nesta sessão (permite "Continuar" na tela inicial) */
  hasOpenProject: boolean
  wizardOpen: boolean
  settingsOpen: boolean
  copilotOpen: boolean
  plansManagerOpen: boolean
  resultsOpen: boolean
  resultsTab: ResultsTab
  display: DisplayOptions
  d3: D3Options
  defaults: ElementDefaults
  /** posição do cursor em coords de mundo (m) — p/ statusbar */
  cursorWorld: Vec2 | null
  /** proposta do Copiloto em pré-visualização (aprovação pendente) */
  aiGhost: AiGhost | null

  // ---- análise ----
  results: AnalysisResults | null
  analysisStatus: 'idle' | 'running' | 'done' | 'error'
  analysisError: string | null

  // ---- ações: projeto ----
  newProject: (params: NewProjectParams) => void
  loadProject: (p: Project, fileName?: string | null) => void
  setProjectName: (name: string) => void
  /** metadados do projeto (autor, cliente, endereço…) — carimbo das pranchas */
  setProjectMeta: (
    patch: Partial<Pick<Project, 'name' | 'author' | 'city' | 'client' | 'address'>>,
  ) => void
  updateSettings: (patch: Partial<ProjectSettings>) => void
  /**
   * editor de armaduras: upsert do ajuste (sem n/φ/passo ⇒ remove). NÃO
   * invalida a análise — só o detalhamento é recalculado (é puro e rápido).
   */
  setRebarOverride: (ov: RebarOverride) => void
  /** restaura o detalhamento automático de uma viga inteira */
  clearRebarOverrides: (beamId: string) => void
  /** ajuste da armadura de um pilar (mescla; campo `undefined` volta ao automático) */
  setColumnRebarOverride: (ov: ColumnRebarOverride) => void
  clearColumnRebarOverride: (columnId: string) => void
  /** mostra a solução do programa sem apagar os ajustes (e volta à editada) */
  setRebarOverridesOff: (off: boolean) => void
  /**
   * fundação editável por pilar (tipo/dimensões/posição/cota). NÃO invalida a
   * análise — refaz só o dimensionamento das fundações (puro). Obs.: com
   * interação solo-estrutura ativa, molas seguem a geometria anterior até a
   * próxima análise completa.
   */
  setFoundationOverride: (ov: FoundationOverride) => void
  /** restaura o dimensionamento automático da fundação de um pilar */
  clearFoundationOverride: (columnId: string) => void

  // ---- ações: ui ----
  setTool: (t: Tool) => void
  setViewMode: (v: ViewMode) => void
  setActiveLevel: (id: string) => void
  select: (ref: ElementRef | null) => void
  /** Shift+clique: inclui/retira o elemento da seleção múltipla */
  toggleSelect: (ref: ElementRef) => void
  /** substitui a seleção por um conjunto (janela de seleção) */
  selectMany: (refs: ElementRef[]) => void
  /** todos os pilares + vigas, lajes e regiões da planta ativa */
  selectAll: () => void
  setHover: (ref: ElementRef | null) => void
  setAiGhost: (g: AiGhost | null) => void
  setCursorWorld: (p: Vec2 | null) => void
  setDisplay: (patch: Partial<DisplayOptions>) => void
  setD3: (patch: Partial<D3Options>) => void
  setDefaults: (patch: Partial<ElementDefaults>) => void
  setTheme: (t: Theme) => void
  setWelcomeOpen: (v: boolean) => void
  setWizardOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setCopilotOpen: (v: boolean) => void
  setPlansManagerOpen: (v: boolean) => void
  setResultsOpen: (v: boolean) => void
  setResultsTab: (t: ResultsTab) => void

  // ---- ações: modelagem (todas marcam dirty e invalidam resultados) ----
  addColumn: (pos: Vec2) => void
  updateColumn: (id: string, patch: Partial<Omit<Column, 'id'>>) => void
  /**
   * move o pilar e arrasta junto os vértices COINCIDENTES (vigas, lajes,
   * regiões e paredes, em todas as plantas) — mantém o modelo conectado
   */
  moveColumn: (id: string, pos: Vec2) => 'ok' | 'duplicate'
  /** translada a viga inteira; vértices de laje coincidentes acompanham */
  moveBeam: (id: string, delta: Vec2) => void
  moveLoadRegion: (id: string, delta: Vec2) => void
  moveMasonryWall: (id: string, delta: Vec2) => void
  /**
   * move um CONJUNTO de elementos pelo mesmo deslocamento, em um único passo
   * de desfazer. Vértices de elementos não selecionados que coincidem com os
   * pontos movidos acompanham (o modelo continua conectado).
   */
  moveElements: (refs: ElementRef[], delta: Vec2) => 'ok' | 'duplicate'
  /**
   * alinha os elementos da seleção pela âncora (o elemento selecionado por
   * último, que fica parado), em um único passo de desfazer
   */
  alignSelection: (mode: AlignMode) => 'ok' | 'none' | 'duplicate'
  /** distribui a seleção com centros igualmente espaçados; extremos parados */
  distributeSelection: (axis: 'x' | 'y') => 'ok' | 'none' | 'duplicate'
  /**
   * muda seção/rotação do pilar mantendo fixo o ponto de ancoragem (face ou
   * canto): o centro é deslocado, as vigas ficam onde estão
   */
  resizeColumn: (
    id: string,
    patch: Partial<Pick<Column, 'section' | 'rotationDeg'>>,
    anchor: ColumnAnchor,
  ) => void
  /** gira 90° os pilares indicados */
  rotateColumns: (ids: string[]) => void
  addBeamPath: (path: Vec2[]) => void
  /** parede de alvenaria estrutural (NBR 16868) na planta ativa */
  addMasonryWallPath: (path: Vec2[]) => void
  updateMasonryWall: (id: string, patch: Partial<Omit<MasonryWall, 'id'>>) => void
  deleteMasonryWall: (id: string) => void
  updateBeam: (id: string, patch: Partial<Omit<Beam, 'id'>>) => void
  /** tenta criar laje na face fechada de vigas que contém o ponto */
  addSlabAt: (point: Vec2) => 'ok' | 'no-face' | 'exists'
  updateSlab: (id: string, patch: Partial<Omit<Slab, 'id'>>) => void
  /** carga de parede na viga; `another` cria uma carga adicional (outro trecho) */
  addWallLoad: (beamId: string, another?: boolean) => void
  updateWallLoad: (id: string, patch: Partial<Omit<WallLoad, 'id'>>) => void
  /** cria região de carga (escada/reservatório) com preset do tipo padrão */
  addLoadRegion: (polygon: Vec2[]) => void
  updateLoadRegion: (id: string, patch: Partial<Omit<LoadRegion, 'id'>>) => void
  /**
   * carga sobre a laje (issue #8): 1 ponto = pontual; 2 pontos = linear.
   * Usa o tipo e os valores de `defaults`.
   */
  addSlabLoad: (pts: Vec2[]) => void
  updateSlabLoad: (id: string, patch: Partial<Omit<SlabLoad, 'id'>>) => void
  moveSlabLoad: (id: string, delta: Vec2) => void
  /**
   * cotas (issue #10) — anotação: NÃO invalidam a análise. Os pontos presos a
   * elementos são atualizados a cada edição do modelo (ver `set` abaixo).
   */
  addDimension: (d: Omit<Dimension, 'id' | 'name'>) => string | null
  updateDimension: (id: string, patch: Partial<Omit<Dimension, 'id'>>) => void
  /** cota em cadeia dos pilares/vigas indicados (padrão: a seleção) */
  autoDimension: (opts: AutoDimOptions, refs?: ElementRef[]) => 'ok' | 'none'
  setDimStyle: (patch: Partial<DimStyle>) => void
  /**
   * pranchas compostas (issue #23) — documentação: NÃO invalidam a análise.
   * `addSheet` devolve o id da prancha criada.
   */
  addSheet: () => string
  updateSheet: (id: string, patch: Partial<Pick<SheetLayout, 'name' | 'format' | 'revision'>>) => void
  deleteSheet: (id: string) => void
  /** insere o desenho no primeiro lugar livre da folha; devolve o id do item */
  addSheetItem: (sheetId: string, source: SheetSource) => string | null
  /**
   * Insere vários desenhos de uma vez (um passo de desfazer). Com `overflow`,
   * o que não cabe na folha vai para pranchas novas; sem, tudo fica nela
   * (`unplaced` = quantos entraram sobrepostos por falta de lugar).
   */
  addSheetItems: (
    sheetId: string,
    sources: SheetSource[],
    overflow?: boolean,
  ) => { ids: string[]; newSheets: string[]; unplaced: number }
  updateSheetItem: (sheetId: string, itemId: string, patch: Partial<Omit<SheetItem, 'id' | 'source'>>) => void
  removeSheetItem: (sheetId: string, itemId: string) => void
  duplicateSheetItem: (sheetId: string, itemId: string) => string | null
  /** organiza em fileiras; `shrink` reduz escalas até caber. Devolve se coube */
  arrangeSheet: (sheetId: string, shrink?: boolean) => boolean
  deleteElement: (ref: ElementRef) => void
  /** exclui vários elementos em um único passo de desfazer */
  deleteElements: (refs: ElementRef[]) => void
  deleteSelected: () => void

  updateGridAxis: (dir: 'x' | 'y', axisId: string, pos: number) => void
  addGridAxis: (dir: 'x' | 'y', pos: number) => void
  removeGridAxis: (dir: 'x' | 'y', axisId: string) => void

  // ---- plantas de forma ----
  addPlan: (copyFromId?: string) => void
  renamePlan: (planId: string, name: string) => void
  assignPlanToLevel: (levelId: string, planId: string | null) => void
  /** remove planta se nenhum nível a usa */
  deletePlan: (planId: string) => void

  // ---- níveis ----
  /** altera o pé-direito do nível (desloca este nível e todos acima) */
  setStoryHeight: (levelId: string, height: number) => void
  renameLevel: (levelId: string, name: string) => void
  /**
   * insere um nível novo em projeto existente.
   * - sucessivo (padrão): acima do nível indicado, deslocando os superiores
   *   pelo pé-direito; com aboveLevelId null, abaixo do nível mais baixo.
   * - independente (`independent: true`): cota = cota do nível de referência
   *   (aboveLevelId) + height (pode ser negativo), SEM deslocar nenhum outro
   *   nível; exige ≥ MIN_LEVEL_GAP de distância a qualquer nível existente.
   * extendColumns estende até o novo topo os pilares que terminavam no antigo.
   */
  addLevel: (opts: {
    aboveLevelId: string | null
    height: number
    extendColumns?: boolean
    independent?: boolean
  }) => 'ok' | 'invalid'
  /**
   * move só este nível para a cota indicada (os demais ficam onde estão);
   * precisa continuar entre os vizinhos, a ≥ MIN_LEVEL_GAP de cada um
   */
  setLevelElevation: (levelId: string, elevation: number) => void
  /**
   * remove um nível sem pilares/consolos ancorados nele; exige ≥ 2 níveis
   * restantes. Por padrão os superiores descem pelo pé-direito removido;
   * com keepElevations os demais níveis mantêm a cota.
   */
  deleteLevel: (levelId: string, opts?: { keepElevations?: boolean }) => void

  // ---- arquivo ----
  /** registra salvamento bem-sucedido (caminho/nome) e limpa dirty */
  markSaved: (fileName: string | null) => void

  // ---- underlay DXF ----
  setUnderlay: (underlay: DxfUnderlay | null) => void
  updateUnderlay: (patch: Partial<DxfUnderlay>) => void

  // ---- ações: análise ----
  runAnalysis: () => void
  invalidateResults: () => void
}

// ---------------------------------------------------------------------------

function activePlanOf(project: Project, activeLevelId: string): FloorPlan | null {
  const level = project.levels.find((l) => l.id === activeLevelId)
  if (!level || !level.planId) return null
  return project.plans.find((p) => p.id === level.planId) ?? null
}

/**
 * projeto novo + detalhamento refeito em linha (é função pura do projeto e do
 * dimensionamento): prancha, quadro de ferros, quantitativos e as verificações
 * da armadura adotada seguem o ajuste ao vivo, sem invalidar a análise
 */
function withDetailing(s: HFState, project: Project): Partial<HFState> {
  return {
    project,
    dirty: true,
    results: s.results
      ? {
          ...s.results,
          detailing: runDetailing(
            project,
            s.results.beamDesign,
            s.results.columnDesign,
            s.results.beamService,
          ),
        }
      : s.results,
  }
}

/** retorna projeto novo com a planta substituída */
function withPlan(project: Project, planId: string, fn: (plan: FloorPlan) => FloorPlan): Project {
  return {
    ...project,
    plans: project.plans.map((p) => (p.id === planId ? fn(p) : p)),
  }
}

function firstEditableLevel(p: Project): string {
  const lvl = p.levels.find((l) => l.planId !== null) ?? p.levels[p.levels.length - 1]
  return lvl.id
}

let worker: Worker | null = null

/** distância mínima entre dois níveis (m) — abaixo disso o tramo de pilar degenera */
export const MIN_LEVEL_GAP = 0.5

const initialProject = createSampleProject()

export const useStore = create<HFState>()(
  temporal(
    (rawSet, get) => {
      // toda edição do projeto passa por aqui: as cotas presas a elementos são
      // reposicionadas no MESMO passo (e no mesmo passo de desfazer)
      const set: typeof rawSet = ((partial: unknown, replace?: false) =>
        rawSet((s) => {
          const next = (
            typeof partial === 'function' ? (partial as (st: HFState) => Partial<HFState>)(s) : partial
          ) as Partial<HFState>
          if (next.project && next.project !== s.project) {
            const project = refreshDimensions(next.project)
            return project === next.project ? next : { ...next, project }
          }
          return next
        }, replace)) as typeof rawSet
      return {
      project: initialProject,
      fileName: null,
      dirty: false,

      tool: 'select',
      viewMode: 'split',
      activeLevelId: firstEditableLevel(initialProject),
      selection: null,
      multi: [],
      hoverRef: null,
      aiGhost: null,
      theme: readInitialTheme(),
      welcomeOpen: true,
      hasOpenProject: false,
      wizardOpen: false,
      settingsOpen: false,
      copilotOpen: false,
      plansManagerOpen: false,
      resultsOpen: false,
      resultsTab: 'estabilidade',
      display: { showAxes: true, showDims: true, showNames: true, showLoads: true, showSlabs: true },
      d3: {
        showSlabs: true,
        showFoundations: true,
        showRegions: true,
        isolateActiveLevel: false,
        showDeformed: false,
        deformScale: 200,
        diagram: 'none',
        diagramScale: 1,
        activeComboId: null,
        wireframeMode: false,
        showRebar: false,
        rebarCats: {
          'viga-positiva': true,
          'viga-negativa': true,
          'viga-estribo': true,
          'pilar-barra': true,
          'pilar-estribo': true,
        },
        rebarElement: null,
        rebarSel: null,
      },
      defaults: {
        columnSection: { bw: 0.25, h: 0.6 },
        columnRotation: 0,
        beamSection: { bw: 0.2, h: 0.5 },
        slabThickness: 0.12,
        slabFinish: 1.5,
        slabLive: 1.5,
        slabLiveLabel: 'Residencial — dormitórios/salas/cozinhas',
        wallW: 6.0,
        wallLabel: 'Alvenaria bloco 14 cm',
        regionKind: 'escada',
      },
      cursorWorld: null,

      results: null,
      analysisStatus: 'idle',
      analysisError: null,

      // ---- projeto ----
      newProject: (params) => {
        const p = createEmptyProject({ ...params, createdAt: new Date().toISOString() })
        set({
          project: p,
          fileName: null,
          dirty: false,
          activeLevelId: firstEditableLevel(p),
          selection: null,
          results: null,
          analysisStatus: 'idle',
          welcomeOpen: false,
          hasOpenProject: true,
          wizardOpen: false,
        })
        useStore.temporal.getState().clear()
      },
      loadProject: (p, fileName = null) => {
        set({
          project: p,
          fileName,
          dirty: false,
          activeLevelId: firstEditableLevel(p),
          selection: null,
          results: null,
          analysisStatus: 'idle',
          welcomeOpen: false,
          hasOpenProject: true,
        })
        pushRecent(fileName, p.name)
        useStore.temporal.getState().clear()
      },
      setProjectName: (name) =>
        set((s) => ({ project: { ...s.project, name }, dirty: true })),
      setProjectMeta: (patch) =>
        set((s) => ({ project: { ...s.project, ...patch }, dirty: true })),
      updateSettings: (patch) =>
        set((s) => ({
          project: { ...s.project, settings: { ...s.project.settings, ...patch } },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })),
      setRebarOverride: (ov) =>
        set((s) => {
          const same = (o: RebarOverride) =>
            o.beamId === ov.beamId && o.spanIndex === ov.spanIndex && o.slot === ov.slot
          // mescla com o ajuste que já existe na posição; campo `undefined` é removido
          const prev = (s.project.rebarOverrides ?? []).find(same)
          const merged = { ...prev, ...ov } as RebarOverride
          for (const k of Object.keys(merged) as (keyof RebarOverride)[]) {
            if (merged[k] === undefined || merged[k] === false) delete merged[k]
          }
          const list = (s.project.rebarOverrides ?? []).filter((o) => !same(o))
          // sobrou só a identificação ⇒ a posição volta ao automático
          if (Object.keys(merged).length > 3) list.push(merged)
          return withDetailing(s, { ...s.project, rebarOverrides: list })
        }),
      clearRebarOverrides: (beamId) =>
        set((s) =>
          withDetailing(s, {
            ...s.project,
            rebarOverrides: (s.project.rebarOverrides ?? []).filter((o) => o.beamId !== beamId),
          }),
        ),
      setColumnRebarOverride: (ov) =>
        set((s) => {
          const prev = (s.project.columnRebarOverrides ?? []).find((o) => o.columnId === ov.columnId)
          const merged = { ...prev, ...ov } as ColumnRebarOverride
          for (const k of Object.keys(merged) as (keyof ColumnRebarOverride)[]) {
            if (merged[k] === undefined) delete merged[k]
          }
          const list = (s.project.columnRebarOverrides ?? []).filter((o) => o.columnId !== ov.columnId)
          if (Object.keys(merged).length > 1) list.push(merged)
          return withDetailing(s, { ...s.project, columnRebarOverrides: list })
        }),
      clearColumnRebarOverride: (columnId) =>
        set((s) =>
          withDetailing(s, {
            ...s.project,
            columnRebarOverrides: (s.project.columnRebarOverrides ?? []).filter(
              (o) => o.columnId !== columnId,
            ),
          }),
        ),
      setRebarOverridesOff: (off) =>
        set((s) => {
          const project = { ...s.project }
          if (off) project.rebarOverridesOff = true
          else delete project.rebarOverridesOff
          return withDetailing(s, project)
        }),
      setFoundationOverride: (ov) =>
        set((s) => {
          const list = (s.project.foundationOverrides ?? []).filter(
            (o) => o.columnId !== ov.columnId,
          )
          const hasContent =
            ov.kind !== undefined ||
            ov.a !== undefined ||
            ov.b !== undefined ||
            ov.nPiles !== undefined ||
            ov.offset !== undefined ||
            ov.depth !== undefined ||
            ov.strapToColumnId !== undefined ||
            ov.combineWithColumnId !== undefined
          if (hasContent) list.push(ov)
          const project = { ...s.project, foundationOverrides: list }
          return {
            project,
            dirty: true,
            results: s.results
              ? {
                  ...s.results,
                  foundations: runFoundationDesign(project, s.results.model, s.results.cases.els),
                }
              : s.results,
          }
        }),
      clearFoundationOverride: (columnId) =>
        set((s) => {
          const list = (s.project.foundationOverrides ?? []).filter(
            (o) => o.columnId !== columnId,
          )
          const project = { ...s.project, foundationOverrides: list }
          return {
            project,
            dirty: true,
            results: s.results
              ? {
                  ...s.results,
                  foundations: runFoundationDesign(project, s.results.model, s.results.cases.els),
                }
              : s.results,
          }
        }),

      // ---- ui ----
      setTool: (tool) => set({ tool }),
      setViewMode: (viewMode) => set({ viewMode }),
      setActiveLevel: (activeLevelId) => set({ activeLevelId }),
      select: (selection) => set({ selection, multi: selection ? [selection] : [] }),
      toggleSelect: (ref) =>
        set((s) => {
          const cur = selectedRefs(s)
          const has = cur.some((r) => r.kind === ref.kind && r.id === ref.id)
          const multi = has
            ? cur.filter((r) => !(r.kind === ref.kind && r.id === ref.id))
            : [...cur, ref]
          return { multi, selection: has ? (multi[multi.length - 1] ?? null) : ref }
        }),
      selectMany: (refs) => set({ multi: refs, selection: refs[refs.length - 1] ?? null }),
      selectAll: () => {
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        const refs: ElementRef[] = [
          ...s.project.columns.map((c) => ({ kind: 'column' as const, id: c.id })),
          ...(plan?.beams ?? []).map((b) => ({ kind: 'beam' as const, id: b.id })),
          ...(plan?.slabs ?? []).map((x) => ({ kind: 'slab' as const, id: x.id })),
          ...(plan?.loadRegions ?? []).map((r) => ({ kind: 'loadRegion' as const, id: r.id })),
          ...(plan?.slabLoads ?? []).map((l) => ({ kind: 'slabLoad' as const, id: l.id })),
          ...(plan?.dimensions ?? []).map((d) => ({ kind: 'dimension' as const, id: d.id })),
        ]
        set({ multi: refs, selection: refs[refs.length - 1] ?? null })
      },
      setHover: (hoverRef) => set({ hoverRef }),
      setAiGhost: (aiGhost) => set({ aiGhost }),
      setCursorWorld: (cursorWorld) => set({ cursorWorld }),
      setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
      setD3: (patch) => set((s) => ({ d3: { ...s.d3, ...patch } })),
      setDefaults: (patch) => set((s) => ({ defaults: { ...s.defaults, ...patch } })),
      setTheme: (theme) => {
        try {
          localStorage.setItem(THEME_KEY, theme)
        } catch {
          // melhor esforço
        }
        applyTheme(theme)
        set({ theme })
      },
      setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
      setWizardOpen: (wizardOpen) => set({ wizardOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
      setPlansManagerOpen: (plansManagerOpen) => set({ plansManagerOpen }),
      setResultsOpen: (resultsOpen) => set({ resultsOpen }),
      setResultsTab: (resultsTab) => set({ resultsTab }),

      // ---- modelagem ----
      addColumn: (point) => {
        const s = get()
        const p = s.project
        // o ponto clicado é a âncora escolhida (centro, face ou canto) da seção
        const pos = centerFromAnchor(
          { section: s.defaults.columnSection, rotationDeg: s.defaults.columnRotation },
          s.defaults.columnAnchor ?? 'c',
          point,
        )
        // evita pilar duplicado no mesmo ponto
        const exists = p.columns.some(
          (c) => Math.hypot(c.pos.x - pos.x, c.pos.y - pos.y) < 0.05,
        )
        if (exists) return
        const col: Column = {
          id: uid('col'),
          name: nextColumnName(p),
          pos,
          section: { ...s.defaults.columnSection },
          rotationDeg: s.defaults.columnRotation,
          baseLevelId: p.levels[0].id,
          topLevelId: p.levels[p.levels.length - 1].id,
        }
        set({
          project: { ...p, columns: [...p.columns, col] },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'column', id: col.id },
        })
      },
      updateColumn: (id, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            columns: s.project.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })),
      moveColumn: (id, pos) => {
        const s = get()
        const col = s.project.columns.find((c) => c.id === id)
        if (!col) return 'ok'
        const dx = pos.x - col.pos.x
        const dy = pos.y - col.pos.y
        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 'ok'
        if (
          s.project.columns.some(
            (c) => c.id !== id && Math.hypot(c.pos.x - pos.x, c.pos.y - pos.y) < 0.05,
          )
        )
          return 'duplicate'
        // vértices coincidentes com a posição ANTIGA acompanham o pilar
        const near = (p: Vec2) => Math.hypot(p.x - col.pos.x, p.y - col.pos.y) < 0.02
        const mv = (p: Vec2) => (near(p) ? { x: p.x + dx, y: p.y + dy } : p)
        set({
          project: {
            ...s.project,
            columns: s.project.columns.map((c) => (c.id === id ? { ...c, pos } : c)),
            plans: s.project.plans.map((pl) => ({
              ...pl,
              beams: pl.beams.map((b) => ({ ...b, path: b.path.map(mv) })),
              slabs: pl.slabs.map((sl) => ({ ...sl, polygon: sl.polygon.map(mv) })),
              loadRegions: pl.loadRegions.map((r) => ({ ...r, polygon: r.polygon.map(mv) })),
              ...(pl.masonryWalls
                ? { masonryWalls: pl.masonryWalls.map((w) => ({ ...w, path: w.path.map(mv) })) }
                : {}),
            })),
          },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
        return 'ok'
      },
      moveBeam: (id, delta) =>
        set((s) => {
          if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) return {}
          const plan = s.project.plans.find((pl) => pl.beams.some((b) => b.id === id))
          const beam = plan?.beams.find((b) => b.id === id)
          if (!plan || !beam) return {}
          const orig = beam.path
          const near = (p: Vec2) =>
            orig.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.02)
          const mv = (p: Vec2) => (near(p) ? { x: p.x + delta.x, y: p.y + delta.y } : p)
          return {
            project: withPlan(s.project, plan.id, (pl) => ({
              ...pl,
              beams: pl.beams.map((b) =>
                b.id === id
                  ? { ...b, path: b.path.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) }
                  : b,
              ),
              slabs: pl.slabs.map((sl) => ({ ...sl, polygon: sl.polygon.map(mv) })),
            })),
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        }),
      moveLoadRegion: (id, delta) =>
        set((s) => {
          const plan = s.project.plans.find((pl) => pl.loadRegions.some((r) => r.id === id))
          if (!plan) return {}
          return {
            project: withPlan(s.project, plan.id, (pl) => ({
              ...pl,
              loadRegions: pl.loadRegions.map((r) =>
                r.id === id
                  ? { ...r, polygon: r.polygon.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) }
                  : r,
              ),
            })),
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        }),
      moveMasonryWall: (id, delta) =>
        set((s) => {
          const plan = s.project.plans.find((pl) => pl.masonryWalls?.some((w) => w.id === id))
          if (!plan) return {}
          return {
            project: withPlan(s.project, plan.id, (pl) => ({
              ...pl,
              masonryWalls: pl.masonryWalls!.map((w) =>
                w.id === id
                  ? { ...w, path: w.path.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) }
                  : w,
              ),
            })),
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        }),
      moveElements: (refs, delta) => {
        const next = moveInProject(get().project, refs, delta)
        if (next === 'duplicate') return 'duplicate'
        if (next === get().project) return 'ok'
        // só cotas: é anotação, a análise continua valendo
        if (refs.every((r) => r.kind === 'dimension')) set({ project: next, dirty: true })
        else set({ project: next, dirty: true, results: null, analysisStatus: 'idle' })
        return 'ok'
      },
      alignSelection: (mode) => {
        const s = get()
        const refs = selectedRefs(s)
        if (refs.length < 2 || !s.selection) return 'none'
        const r = alignInProject(s.project, refs, s.selection, mode)
        if (r === 'duplicate' || r === 'none') return r
        set({ project: r.project, dirty: true, results: null, analysisStatus: 'idle' })
        return 'ok'
      },
      distributeSelection: (axis) => {
        const s = get()
        const r = distributeInProject(s.project, selectedRefs(s), axis)
        if (r === 'duplicate' || r === 'none') return r
        set({ project: r.project, dirty: true, results: null, analysisStatus: 'idle' })
        return 'ok'
      },
      resizeColumn: (id, patch, anchor) =>
        set((s) => {
          const c = s.project.columns.find((x) => x.id === id)
          if (!c) return {}
          const next = { ...c, ...patch }
          const o0 = anchorOffset(c, anchor)
          const o1 = anchorOffset(next, anchor)
          // o ponto de ancoragem não se move: centro novo = âncora − offset novo
          const pos = { x: c.pos.x + o0.x - o1.x, y: c.pos.y + o0.y - o1.y }
          const clash = s.project.columns.some(
            (o) => o.id !== id && Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) < 0.05,
          )
          return {
            project: {
              ...s.project,
              columns: s.project.columns.map((x) =>
                x.id === id ? { ...next, pos: clash ? c.pos : pos } : x,
              ),
            },
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        }),
      rotateColumns: (ids) =>
        set((s) => ({
          project: {
            ...s.project,
            columns: s.project.columns.map((c) =>
              ids.includes(c.id)
                ? { ...c, rotationDeg: ((c.rotationDeg + 90) % 360) as Column['rotationDeg'] }
                : c,
            ),
          },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })),
      addBeamPath: (path) => {
        if (path.length < 2) return
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan) return
        const beam: Beam = {
          id: uid('bm'),
          name: nextBeamName(s.project, plan.id),
          path,
          section: { ...s.defaults.beamSection },
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({ ...pl, beams: [...pl.beams, beam] })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'beam', id: beam.id },
        })
      },
      addMasonryWallPath: (path) => {
        if (path.length < 2) return
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan) return
        const n = (plan.masonryWalls?.length ?? 0) + 1
        const wall: MasonryWall = {
          id: uid('mw'),
          name: `PAR${n}`,
          path,
          thickness: 0.14,
          block: 'concreto',
          fpk: 6000,
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            masonryWalls: [...(pl.masonryWalls ?? []), wall],
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      updateMasonryWall: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.masonryWalls?.some((w) => w.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            masonryWalls: (pl.masonryWalls ?? []).map((w) => (w.id === id ? { ...w, ...patch } : w)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      deleteMasonryWall: (id) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.masonryWalls?.some((w) => w.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            masonryWalls: (pl.masonryWalls ?? []).filter((w) => w.id !== id),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      updateBeam: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.beams.some((b) => b.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            beams: pl.beams.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      addSlabAt: (point) => {
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan) return 'no-face'
        // já existe laje neste ponto?
        if (plan.slabs.some((sl) => pointInPolygon(point, sl.polygon))) return 'exists'
        const segments = plan.beams.flatMap((b) => {
          const segs = []
          for (let i = 0; i + 1 < b.path.length; i++) {
            segs.push({ a: b.path[i], b: b.path[i + 1] })
          }
          return segs
        })
        const faces = detectFaces(segments)
        const face = faces.find((f) => pointInPolygon(point, f))
        if (!face) return 'no-face'
        const slab: Slab = {
          id: uid('sl'),
          name: nextSlabName(s.project, plan.id),
          polygon: face,
          thickness: s.defaults.slabThickness,
          finishLoad: s.defaults.slabFinish,
          liveLoad: s.defaults.slabLive,
          liveLoadLabel: s.defaults.slabLiveLabel,
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({ ...pl, slabs: [...pl.slabs, slab] })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'slab', id: slab.id },
        })
        return 'ok'
      },
      updateSlab: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.slabs.some((x) => x.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            slabs: pl.slabs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      addWallLoad: (beamId, another) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.beams.some((b) => b.id === beamId))
        if (!plan) return
        // ferramenta de carga: uma por viga (edita a existente); `another`
        // permite outras cargas na mesma viga (trechos/paredes diferentes)
        const existing = plan.wallLoads.find((w) => w.beamId === beamId)
        if (existing && !another) {
          set({ selection: { kind: 'wallLoad', id: existing.id } })
          return
        }
        const wl: WallLoad = {
          id: uid('wl'),
          beamId,
          w: s.defaults.wallW,
          label: s.defaults.wallLabel,
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            wallLoads: [...pl.wallLoads, wl],
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'wallLoad', id: wl.id },
        })
      },
      updateWallLoad: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.wallLoads.some((w) => w.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            wallLoads: pl.wallLoads.map((w) => (w.id === id ? { ...w, ...patch } : w)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      addLoadRegion: (polygon) => {
        if (polygon.length < 3) return
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan) return
        const preset =
          REGION_PRESETS.find((p) => p.kind === s.defaults.regionKind) ?? REGION_PRESETS[0]
        const region: LoadRegion = {
          id: uid('rg'),
          name: nextRegionName(s.project, plan.id, preset.kind),
          kind: preset.kind,
          polygon,
          g: preset.g,
          q: preset.q,
          label: preset.label,
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            loadRegions: [...pl.loadRegions, region],
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'loadRegion', id: region.id },
        })
      },
      addSlabLoad: (pts) => {
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan || pts.length === 0) return
        const kind = pts.length >= 2 ? 'line' : 'point'
        if (kind === 'line' && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 0.05) return
        const prefix = kind === 'line' ? 'CL' : 'CP'
        const used = new Set((plan.slabLoads ?? []).map((l) => l.name))
        let n = 1
        while (used.has(`${prefix}${n}`)) n++
        const load: SlabLoad = {
          id: uid('sl'),
          name: `${prefix}${n}`,
          kind,
          a: pts[0],
          ...(kind === 'line' ? { b: pts[1] } : {}),
          g: s.defaults.slabLoadG ?? (kind === 'line' ? 5 : 10),
          q: s.defaults.slabLoadQ ?? 0,
        }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            slabLoads: [...(pl.slabLoads ?? []), load],
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: { kind: 'slabLoad', id: load.id },
          multi: [],
        })
      },
      updateSlabLoad: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.slabLoads?.some((l) => l.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            slabLoads: (pl.slabLoads ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      moveSlabLoad: (id, delta) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.slabLoads?.some((l) => l.id === id))
        if (!plan) return
        const mv = (p: Vec2) => ({ x: p.x + delta.x, y: p.y + delta.y })
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            slabLoads: (pl.slabLoads ?? []).map((l) =>
              l.id === id ? { ...l, a: mv(l.a), ...(l.b ? { b: mv(l.b) } : {}) } : l,
            ),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      updateLoadRegion: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.loadRegions.some((r) => r.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            loadRegions: pl.loadRegions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          })),
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })
      },
      addDimension: (d) => {
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan || d.points.length < 2) return null
        const used = new Set((plan.dimensions ?? []).map((x) => x.name))
        let n = 1
        while (used.has(`Cota ${n}`)) n++
        const dim: Dimension = { ...d, id: uid('dim'), name: `Cota ${n}` }
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            dimensions: [...(pl.dimensions ?? []), dim],
          })),
          dirty: true,
          selection: { kind: 'dimension', id: dim.id },
          multi: [],
        })
        return dim.id
      },
      updateDimension: (id, patch) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.dimensions?.some((d) => d.id === id))
        if (!plan) return
        set({
          project: withPlan(s.project, plan.id, (pl) => ({
            ...pl,
            dimensions: (pl.dimensions ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
          })),
          dirty: true,
        })
      },
      autoDimension: (opts, refs) => {
        const s = get()
        const plan = activePlanOf(s.project, s.activeLevelId)
        if (!plan) return 'none'
        const d = autoDimension(s.project, plan, refs ?? selectedRefs(s), opts)
        if (!d) return 'none'
        return get().addDimension(d) ? 'ok' : 'none'
      },
      setDimStyle: (patch) =>
        set((s) => ({
          project: { ...s.project, dimStyle: { ...dimStyleOf(s.project), ...patch } },
          dirty: true,
        })),
      addSheet: () => {
        const s = get()
        const sheets = s.project.sheets ?? []
        const used = new Set(sheets.map((x) => x.name))
        let n = sheets.length + 1
        const nameOf = (k: number) => `Prancha ${String(k).padStart(2, '0')}`
        while (used.has(nameOf(n))) n++
        const sheet: SheetLayout = { id: uid('sh'), name: nameOf(n), format: 'A1', items: [] }
        set({ project: { ...s.project, sheets: [...sheets, sheet] }, dirty: true })
        return sheet.id
      },
      updateSheet: (id, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            sheets: (s.project.sheets ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
          },
          dirty: true,
        })),
      deleteSheet: (id) =>
        set((s) => ({
          project: { ...s.project, sheets: (s.project.sheets ?? []).filter((x) => x.id !== id) },
          dirty: true,
        })),
      addSheetItem: (sheetId, source) => {
        const s = get()
        const sheet = s.project.sheets?.find((x) => x.id === sheetId)
        if (!sheet) return null
        const item = placeNewSheetItem(s.project, s.results, sheet, source, uid('si'))
        set({
          project: {
            ...s.project,
            sheets: s.project.sheets!.map((x) => (x.id === sheetId ? { ...x, items: [...x.items, item] } : x)),
          },
          dirty: true,
        })
        return item.id
      },
      addSheetItems: (sheetId, sources, overflow = false) => {
        const s = get()
        const sheets = s.project.sheets ?? []
        const sheet = sheets.find((x) => x.id === sheetId)
        if (!sheet || sources.length === 0) return { ids: [], newSheets: [], unplaced: 0 }
        const placed = placeNewSheetItems(s.project, s.results, sheet, sources, () => uid('si'), { overflow })
        const used = new Set(sheets.map((x) => x.name))
        let n = sheets.length + 1
        const nameOf = (k: number) => `Prancha ${String(k).padStart(2, '0')}`
        const created: SheetLayout[] = placed.extra.map((items) => {
          while (used.has(nameOf(n))) n++
          used.add(nameOf(n))
          return { id: uid('sh'), name: nameOf(n), format: sheet.format, items }
        })
        set({
          project: {
            ...s.project,
            sheets: [
              ...sheets.map((x) => (x.id === sheetId ? { ...x, items: [...x.items, ...placed.items] } : x)),
              ...created,
            ],
          },
          dirty: true,
        })
        return {
          ids: [...placed.items, ...placed.extra.flat()].map((it) => it.id),
          newSheets: created.map((x) => x.id),
          unplaced: placed.unplaced,
        }
      },
      updateSheetItem: (sheetId, itemId, patch) =>
        set((s) => ({
          project: {
            ...s.project,
            sheets: (s.project.sheets ?? []).map((x) =>
              x.id === sheetId
                ? { ...x, items: x.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
                : x,
            ),
          },
          dirty: true,
        })),
      removeSheetItem: (sheetId, itemId) =>
        set((s) => ({
          project: {
            ...s.project,
            sheets: (s.project.sheets ?? []).map((x) =>
              x.id === sheetId ? { ...x, items: x.items.filter((it) => it.id !== itemId) } : x,
            ),
          },
          dirty: true,
        })),
      duplicateSheetItem: (sheetId, itemId) => {
        const s = get()
        const sheet = s.project.sheets?.find((x) => x.id === sheetId)
        const src = sheet?.items.find((it) => it.id === itemId)
        if (!sheet || !src) return null
        // a cópia mantém escala e rotação e vai para o primeiro lugar livre
        const placed = placeNewSheetItem(s.project, s.results, sheet, src.source, uid('si'))
        const copy: SheetItem = { ...placed, scale: src.scale, ...(src.rotation ? { rotation: src.rotation } : {}) }
        set({
          project: {
            ...s.project,
            sheets: s.project.sheets!.map((x) => (x.id === sheetId ? { ...x, items: [...x.items, copy] } : x)),
          },
          dirty: true,
        })
        return copy.id
      },
      arrangeSheet: (sheetId, shrink = false) => {
        const s = get()
        const sheet = s.project.sheets?.find((x) => x.id === sheetId)
        if (!sheet) return false
        const r = arrangeSheet(s.project, s.results, sheet, { shrink })
        set({
          project: { ...s.project, sheets: s.project.sheets!.map((x) => (x.id === sheetId ? r.layout : x)) },
          dirty: true,
        })
        return r.fits
      },
      deleteElement: (ref) => {
        const s = get()
        let project = s.project
        if (ref.kind === 'dimension') {
          // anotação: sai sem invalidar a análise
          set({
            project: {
              ...project,
              plans: project.plans.map((pl) =>
                pl.dimensions?.some((d) => d.id === ref.id)
                  ? { ...pl, dimensions: pl.dimensions.filter((d) => d.id !== ref.id) }
                  : pl,
              ),
            },
            dirty: true,
            selection: s.selection?.id === ref.id ? null : s.selection,
            multi: s.multi.filter((r) => r.id !== ref.id),
          })
          return
        }
        if (ref.kind === 'column') {
          project = { ...project, columns: project.columns.filter((c) => c.id !== ref.id) }
        } else {
          project = {
            ...project,
            plans: project.plans.map((pl) => {
              if (ref.kind === 'beam') {
                return {
                  ...pl,
                  beams: pl.beams.filter((b) => b.id !== ref.id),
                  wallLoads: pl.wallLoads.filter((w) => w.beamId !== ref.id),
                }
              }
              if (ref.kind === 'slab') {
                return { ...pl, slabs: pl.slabs.filter((x) => x.id !== ref.id) }
              }
              if (ref.kind === 'loadRegion') {
                return { ...pl, loadRegions: pl.loadRegions.filter((r) => r.id !== ref.id) }
              }
              if (ref.kind === 'slabLoad') {
                return pl.slabLoads
                  ? { ...pl, slabLoads: pl.slabLoads.filter((l) => l.id !== ref.id) }
                  : pl
              }
              return { ...pl, wallLoads: pl.wallLoads.filter((w) => w.id !== ref.id) }
            }),
          }
        }
        set({
          project,
          dirty: true,
          results: null,
          analysisStatus: 'idle',
          selection: s.selection?.id === ref.id ? null : s.selection,
        })
      },
      deleteElements: (refs) => {
        if (refs.length === 0) return
        const s = get()
        const ids = (kind: ElementRef['kind']) =>
          new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))
        const cols = ids('column')
        const beams = ids('beam')
        const slabs = ids('slab')
        const regions = ids('loadRegion')
        const walls = ids('wallLoad')
        const sLoads = ids('slabLoad')
        const dims = ids('dimension')
        // só cotas na seleção: a análise continua valendo
        const onlyDims = refs.every((r) => r.kind === 'dimension')
        set({
          project: {
            ...s.project,
            columns: s.project.columns.filter((c) => !cols.has(c.id)),
            plans: s.project.plans.map((pl) => ({
              ...pl,
              beams: pl.beams.filter((b) => !beams.has(b.id)),
              slabs: pl.slabs.filter((x) => !slabs.has(x.id)),
              loadRegions: pl.loadRegions.filter((r) => !regions.has(r.id)),
              wallLoads: pl.wallLoads.filter((w) => !walls.has(w.id) && !beams.has(w.beamId)),
              ...(pl.slabLoads
                ? { slabLoads: pl.slabLoads.filter((l) => !sLoads.has(l.id)) }
                : {}),
              ...(pl.dimensions
                ? { dimensions: pl.dimensions.filter((d) => !dims.has(d.id)) }
                : {}),
            })),
          },
          dirty: true,
          ...(onlyDims ? {} : { results: null, analysisStatus: 'idle' as const }),
          selection: null,
          multi: [],
        })
      },
      deleteSelected: () => {
        const refs = selectedRefs(get())
        if (refs.length > 1) get().deleteElements(refs)
        else if (refs.length === 1) get().deleteElement(refs[0])
      },

      updateGridAxis: (dir, axisId, pos) =>
        set((s) => ({
          project: {
            ...s.project,
            grid: {
              ...s.project.grid,
              [dir === 'x' ? 'xAxes' : 'yAxes']: (dir === 'x'
                ? s.project.grid.xAxes
                : s.project.grid.yAxes
              ).map((a) => (a.id === axisId ? { ...a, pos } : a)),
            },
          },
          dirty: true,
        })),
      addGridAxis: (dir, pos) =>
        set((s) => {
          const axes = dir === 'x' ? s.project.grid.xAxes : s.project.grid.yAxes
          const label =
            dir === 'x'
              ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[axes.length] ?? `X${axes.length + 1}`
              : `${axes.length + 1}`
          const list = [...axes, { id: uid(dir === 'x' ? 'ax' : 'ay'), label, pos }].sort(
            (a, b) => a.pos - b.pos,
          )
          return {
            project: {
              ...s.project,
              grid: { ...s.project.grid, [dir === 'x' ? 'xAxes' : 'yAxes']: list },
            },
            dirty: true,
          }
        }),
      removeGridAxis: (dir, axisId) =>
        set((s) => ({
          project: {
            ...s.project,
            grid: {
              ...s.project.grid,
              [dir === 'x' ? 'xAxes' : 'yAxes']: (dir === 'x'
                ? s.project.grid.xAxes
                : s.project.grid.yAxes
              ).filter((a) => a.id !== axisId),
            },
          },
          dirty: true,
        })),

      // ---- plantas de forma ----
      addPlan: (copyFromId) => {
        const s = get()
        const src = copyFromId ? s.project.plans.find((p) => p.id === copyFromId) : null
        const plan: FloorPlan = src
          ? {
              id: uid('pl'),
              name: `${src.name} (cópia)`,
              beams: src.beams.map((b) => ({ ...b, id: uid('bm'), path: b.path.map((p) => ({ ...p })) })),
              slabs: src.slabs.map((sl) => ({
                ...sl,
                id: uid('sl'),
                polygon: sl.polygon.map((p) => ({ ...p })),
              })),
              wallLoads: [],
              loadRegions: src.loadRegions.map((r) => ({
                ...r,
                id: uid('rg'),
                polygon: r.polygon.map((p) => ({ ...p })),
              })),
            }
          : {
              id: uid('pl'),
              name: nextPlanName(s.project),
              beams: [],
              slabs: [],
              wallLoads: [],
              loadRegions: [],
            }
        // cargas de parede referenciam vigas — remapeia na cópia
        if (src) {
          const beamIdMap = new Map(src.beams.map((b, i) => [b.id, plan.beams[i].id]))
          plan.wallLoads = src.wallLoads.map((w) => ({
            ...w,
            id: uid('wl'),
            beamId: beamIdMap.get(w.beamId) ?? w.beamId,
          }))
          // cotas vão junto; as presas a vigas passam a apontar para as vigas da cópia
          if (src.dimensions && src.dimensions.length > 0) {
            plan.dimensions = src.dimensions.map((d) => ({
              ...d,
              id: uid('dim'),
              points: d.points.map((pt) => ({
                p: { ...pt.p },
                ...(pt.ref
                  ? {
                      ref:
                        pt.ref.kind === 'beam'
                          ? { ...pt.ref, id: beamIdMap.get(pt.ref.id) ?? pt.ref.id }
                          : { ...pt.ref },
                    }
                  : {}),
              })),
            }))
          }
        }
        set({ project: { ...s.project, plans: [...s.project.plans, plan] }, dirty: true })
      },
      renamePlan: (planId, name) =>
        set((s) => ({
          project: withPlan(s.project, planId, (pl) => ({ ...pl, name })),
          dirty: true,
        })),
      assignPlanToLevel: (levelId, planId) =>
        set((s) => ({
          project: {
            ...s.project,
            levels: s.project.levels.map((l) => (l.id === levelId ? { ...l, planId } : l)),
          },
          dirty: true,
          results: null,
          analysisStatus: 'idle',
        })),
      deletePlan: (planId) => {
        const s = get()
        if (s.project.levels.some((l) => l.planId === planId)) return
        set({
          project: { ...s.project, plans: s.project.plans.filter((p) => p.id !== planId) },
          dirty: true,
        })
      },

      // ---- níveis ----
      setStoryHeight: (levelId, height) => {
        if (!(height > 0.5) || height > 10) return
        set((s) => {
          const sorted = [...s.project.levels].sort((a, b) => a.elevation - b.elevation)
          const idx = sorted.findIndex((l) => l.id === levelId)
          if (idx <= 0) return {}
          const oldH = sorted[idx].elevation - sorted[idx - 1].elevation
          const delta = height - oldH
          if (Math.abs(delta) < 1e-9) return {}
          // desloca o nível editado e todos os que estão acima dele
          const newElev = new Map<string, number>()
          sorted.forEach((l, i) => newElev.set(l.id, l.elevation + (i >= idx ? delta : 0)))
          return {
            project: {
              ...s.project,
              levels: s.project.levels.map((l) => ({
                ...l,
                elevation: newElev.get(l.id) ?? l.elevation,
              })),
            },
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        })
      },
      renameLevel: (levelId, name) =>
        set((s) => ({
          project: {
            ...s.project,
            levels: s.project.levels.map((l) => (l.id === levelId ? { ...l, name } : l)),
          },
          dirty: true,
        })),
      addLevel: ({ aboveLevelId, height, extendColumns, independent }) => {
        if (independent) {
          if (!Number.isFinite(height) || Math.abs(height) > 60) return 'invalid'
        } else if (!(height >= 1) || height > 10) return 'invalid'
        let outcome: 'ok' | 'invalid' = 'invalid'
        set((s) => {
          const sorted = [...s.project.levels].sort((a, b) => a.elevation - b.elevation)
          const below = aboveLevelId ? sorted.find((l) => l.id === aboveLevelId) : null
          if (aboveLevelId && !below) return {}
          if (independent && !below) return {}
          const top = sorted[sorted.length - 1]
          const elevation = below ? below.elevation + height : sorted[0].elevation - height
          // nível independente: não pode coincidir (nem quase) com um existente
          if (
            independent &&
            sorted.some((l) => Math.abs(l.elevation - elevation) < MIN_LEVEL_GAP - 1e-9)
          )
            return {}
          const newLevel = { id: uid('lv'), name: 'Novo nível', elevation, planId: null }
          // inserção sucessiva intermediária desloca os níveis acima pelo pé-direito novo
          const shifted = independent
            ? s.project.levels
            : s.project.levels.map((l) =>
                below && l.elevation > below.elevation + 1e-9
                  ? { ...l, elevation: l.elevation + height }
                  : l,
              )
          // o array de níveis é mantido ordenado por cota (invariante do modelo)
          const levels = [...shifted, newLevel].sort((a, b) => a.elevation - b.elevation)
          const becomesTop = independent ? elevation > top.elevation : below?.id === top.id
          let columns = s.project.columns
          if (extendColumns && becomesTop) {
            columns = columns.map((c) =>
              c.topLevelId === top.id ? { ...c, topLevelId: newLevel.id } : c,
            )
          }
          outcome = 'ok'
          return {
            project: { ...s.project, levels, columns },
            activeLevelId: newLevel.id,
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        })
        return outcome
      },
      setLevelElevation: (levelId, elevation) => {
        if (!Number.isFinite(elevation)) return
        set((s) => {
          const sorted = [...s.project.levels].sort((a, b) => a.elevation - b.elevation)
          const idx = sorted.findIndex((l) => l.id === levelId)
          if (idx < 0) return {}
          if (Math.abs(sorted[idx].elevation - elevation) < 1e-9) return {}
          // continua entre os vizinhos: a ordem dos níveis não muda
          const lo = idx > 0 ? sorted[idx - 1].elevation + MIN_LEVEL_GAP : -Infinity
          const hi = idx < sorted.length - 1 ? sorted[idx + 1].elevation - MIN_LEVEL_GAP : Infinity
          if (elevation < lo - 1e-9 || elevation > hi + 1e-9) return {}
          return {
            project: {
              ...s.project,
              levels: s.project.levels.map((l) => (l.id === levelId ? { ...l, elevation } : l)),
            },
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        })
      },
      deleteLevel: (levelId, opts) =>
        set((s) => {
          const sorted = [...s.project.levels].sort((a, b) => a.elevation - b.elevation)
          if (sorted.length <= 2) return {}
          const idx = sorted.findIndex((l) => l.id === levelId)
          if (idx < 0) return {}
          const referenced = s.project.columns.some(
            (c) =>
              c.baseLevelId === levelId ||
              c.topLevelId === levelId ||
              c.corbels?.some((cb) => cb.levelId === levelId),
          )
          if (referenced) return {}
          const drop =
            idx > 0 && !opts?.keepElevations ? sorted[idx].elevation - sorted[idx - 1].elevation : 0
          const removedElev = sorted[idx].elevation
          const levels = sorted
            .filter((l) => l.id !== levelId)
            .map((l) =>
              l.elevation > removedElev + 1e-9 ? { ...l, elevation: l.elevation - drop } : l,
            )
          return {
            project: { ...s.project, levels },
            activeLevelId:
              s.activeLevelId === levelId ? levels[levels.length - 1].id : s.activeLevelId,
            dirty: true,
            results: null,
            analysisStatus: 'idle',
          }
        }),

      // ---- arquivo ----
      markSaved: (fileName) => {
        set({ fileName, dirty: false })
        pushRecent(fileName, get().project.name)
      },

      // ---- underlay DXF ----
      setUnderlay: (underlay) =>
        set((s) => ({ project: { ...s.project, underlay }, dirty: true })),
      updateUnderlay: (patch) =>
        set((s) => ({
          project: {
            ...s.project,
            underlay: s.project.underlay ? { ...s.project.underlay, ...patch } : s.project.underlay,
          },
          dirty: true,
        })),

      // ---- análise ----
      runAnalysis: () => {
        const s = get()
        if (s.analysisStatus === 'running') return
        worker?.terminate()
        worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
          type: 'module',
        })
        set({ analysisStatus: 'running', analysisError: null })
        worker.onmessage = (
          e: MessageEvent<{ ok: boolean; results?: AnalysisResults; error?: string }>,
        ) => {
          if (e.data.ok && e.data.results) {
            const combos = e.data.results.combos
            const firstElu = combos.find((c) => c.type === 'ELU')
            set((st) => ({
              results: e.data.results ?? null,
              analysisStatus: 'done',
              resultsOpen: true,
              d3: {
                ...st.d3,
                activeComboId: st.d3.activeComboId ?? firstElu?.id ?? null,
              },
            }))
          } else {
            set({ analysisStatus: 'error', analysisError: e.data.error ?? 'Erro desconhecido' })
          }
        }
        worker.onerror = (e) => {
          set({ analysisStatus: 'error', analysisError: e.message || 'Falha no worker de análise' })
        }
        worker.postMessage(s.project)
      },
      invalidateResults: () => set({ results: null, analysisStatus: 'idle' }),
      }
    },
    {
      partialize: (state) => ({ project: state.project }),
      limit: 64,
      equality: (a, b) => a.project === b.project,
    },
  ),
)

// nível ativo sempre válido: desfazer a criação de um nível (ou refazer a
// remoção) deixava activeLevelId apontando para um nível que não existe mais
useStore.subscribe((s, prev) => {
  if (s.project.levels === prev.project.levels) return
  if (s.project.levels.some((l) => l.id === s.activeLevelId)) return
  const sorted = [...s.project.levels].sort((a, b) => a.elevation - b.elevation)
  const fallback = [...sorted].reverse().find((l) => l.planId) ?? sorted[sorted.length - 1]
  if (fallback) useStore.setState({ activeLevelId: fallback.id })
})

// aplica o tema salvo antes do primeiro paint (tokens em data-theme no <html>)
if (typeof document !== 'undefined') applyTheme(useStore.getState().theme)

/** planta ativa (null p/ fundação) — helper usado pelos editores */
export function useActivePlan(): FloorPlan | null {
  return useStore((s) => {
    const level = s.project.levels.find((l) => l.id === s.activeLevelId)
    if (!level || !level.planId) return null
    return s.project.plans.find((p) => p.id === level.planId) ?? null
  })
}

export function useActiveLevel() {
  return useStore((s) => s.project.levels.find((l) => l.id === s.activeLevelId) ?? null)
}
