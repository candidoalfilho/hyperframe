import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  createSampleProject,
  createEmptyProject,
  detectFaces,
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
  type Column,
  type ColumnSection,
  type DxfUnderlay,
  type ElementRef,
  type FloorPlan,
  type LoadRegion,
  type NewProjectParams,
  type Project,
  type ProjectSettings,
  type RebarOverride,
  type FoundationOverride,
  type SectionRect,
  type Slab,
  type Vec2,
  type WallLoad,
} from '@hyperframe/engine'

export type Tool = 'select' | 'column' | 'beam' | 'slab' | 'wall' | 'region'
export type ViewMode = 'plan' | '3d' | 'split'
export type ResultsTab =
  | 'estabilidade'
  | 'vigas'
  | 'pilares'
  | 'lajes'
  | 'escadas'
  | 'reservatorios'
  | 'fundacoes'
  | 'incendio'
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
}

export interface ElementDefaults {
  columnSection: ColumnSection
  columnRotation: 0 | 90 | 180 | 270
  beamSection: SectionRect
  slabThickness: number
  slabFinish: number
  slabLive: number
  slabLiveLabel: string
  wallW: number
  wallLabel: string
  regionKind: 'escada' | 'reservatorio' | 'generica' | 'furo'
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
  hoverRef: ElementRef | null
  welcomeOpen: boolean
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
  setHover: (ref: ElementRef | null) => void
  setCursorWorld: (p: Vec2 | null) => void
  setDisplay: (patch: Partial<DisplayOptions>) => void
  setD3: (patch: Partial<D3Options>) => void
  setDefaults: (patch: Partial<ElementDefaults>) => void
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
  addBeamPath: (path: Vec2[]) => void
  updateBeam: (id: string, patch: Partial<Omit<Beam, 'id'>>) => void
  /** tenta criar laje na face fechada de vigas que contém o ponto */
  addSlabAt: (point: Vec2) => 'ok' | 'no-face' | 'exists'
  updateSlab: (id: string, patch: Partial<Omit<Slab, 'id'>>) => void
  addWallLoad: (beamId: string) => void
  updateWallLoad: (id: string, patch: Partial<Omit<WallLoad, 'id'>>) => void
  /** cria região de carga (escada/reservatório) com preset do tipo padrão */
  addLoadRegion: (polygon: Vec2[]) => void
  updateLoadRegion: (id: string, patch: Partial<Omit<LoadRegion, 'id'>>) => void
  deleteElement: (ref: ElementRef) => void
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

const initialProject = createSampleProject()

export const useStore = create<HFState>()(
  temporal(
    (set, get) => ({
      project: initialProject,
      fileName: null,
      dirty: false,

      tool: 'select',
      viewMode: 'split',
      activeLevelId: firstEditableLevel(initialProject),
      selection: null,
      hoverRef: null,
      welcomeOpen: true,
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
        })
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
          const list = (s.project.rebarOverrides ?? []).filter(
            (o) => !(o.beamId === ov.beamId && o.spanIndex === ov.spanIndex && o.slot === ov.slot),
          )
          if (ov.n !== undefined || ov.phi !== undefined || ov.spacing !== undefined) list.push(ov)
          const project = { ...s.project, rebarOverrides: list }
          return {
            project,
            dirty: true,
            // detalhamento é função pura do projeto + dimensionamento: recalcula
            // em linha p/ prancha/quadro/quantitativos seguirem o ajuste ao vivo
            results: s.results
              ? {
                  ...s.results,
                  detailing: runDetailing(project, s.results.beamDesign, s.results.columnDesign),
                }
              : s.results,
          }
        }),
      clearRebarOverrides: (beamId) =>
        set((s) => {
          const list = (s.project.rebarOverrides ?? []).filter((o) => o.beamId !== beamId)
          const project = { ...s.project, rebarOverrides: list }
          return {
            project,
            dirty: true,
            results: s.results
              ? {
                  ...s.results,
                  detailing: runDetailing(project, s.results.beamDesign, s.results.columnDesign),
                }
              : s.results,
          }
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
      select: (selection) => set({ selection }),
      setHover: (hoverRef) => set({ hoverRef }),
      setCursorWorld: (cursorWorld) => set({ cursorWorld }),
      setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
      setD3: (patch) => set((s) => ({ d3: { ...s.d3, ...patch } })),
      setDefaults: (patch) => set((s) => ({ defaults: { ...s.defaults, ...patch } })),
      setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
      setWizardOpen: (wizardOpen) => set({ wizardOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
      setPlansManagerOpen: (plansManagerOpen) => set({ plansManagerOpen }),
      setResultsOpen: (resultsOpen) => set({ resultsOpen }),
      setResultsTab: (resultsTab) => set({ resultsTab }),

      // ---- modelagem ----
      addColumn: (pos) => {
        const s = get()
        const p = s.project
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
      addWallLoad: (beamId) => {
        const s = get()
        const plan = s.project.plans.find((pl) => pl.beams.some((b) => b.id === beamId))
        if (!plan) return
        // uma carga de parede por viga (edita a existente)
        const existing = plan.wallLoads.find((w) => w.beamId === beamId)
        if (existing) {
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
      deleteElement: (ref) => {
        const s = get()
        let project = s.project
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
      deleteSelected: () => {
        const sel = get().selection
        if (sel) get().deleteElement(sel)
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

      // ---- arquivo ----
      markSaved: (fileName) => set({ fileName, dirty: false }),

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
    }),
    {
      partialize: (state) => ({ project: state.project }),
      limit: 64,
      equality: (a, b) => a.project === b.project,
    },
  ),
)

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
