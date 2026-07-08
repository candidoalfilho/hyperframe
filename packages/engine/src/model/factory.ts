import type {
  Beam,
  Column,
  FloorPlan,
  Grid,
  Level,
  Project,
  ProjectSettings,
  Slab,
  WallLoad,
} from './types'
import { uid } from './uid'
import { PSI_PRESETS, STEEL_CA50 } from './presets'

export interface NewProjectParams {
  name: string
  author?: string
  city?: string
  fck: number // kPa
  aggregate: 'basalto' | 'granito' | 'calcario' | 'arenito'
  caa: 'I' | 'II' | 'III' | 'IV'
  numFloors: number
  floorHeight: number // m
  wind: {
    enabled: boolean
    v0: number
    s1: number
    category: 1 | 2 | 3 | 4 | 5
    s3Group: 1 | 2 | 3 | 4 | 5
  }
  createdAt?: string
}

export function defaultSettings(p: NewProjectParams): ProjectSettings {
  return {
    concrete: { fck: p.fck, aggregate: p.aggregate, gammaC: 1.4 },
    steel: { ...STEEL_CA50 },
    caa: p.caa,
    wind: {
      enabled: p.wind.enabled,
      v0: p.wind.v0,
      s1: p.wind.s1,
      category: p.wind.category,
      windClass: 'B',
      s3Group: p.wind.s3Group,
    },
    stiffnessReduction: { beams: 0.4, columns: 0.8 },
    torsionFactor: 0.05,
    considerSelfWeight: true,
    concreteUnitWeight: 25,
    psiLive: { ...PSI_PRESETS.residencial },
    psiWind: { ...PSI_PRESETS.vento },
  }
}

const AXIS_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function makeGrid(xPositions: number[], yPositions: number[]): Grid {
  return {
    xAxes: xPositions.map((x, i) => ({ id: uid('ax'), label: AXIS_LETTERS[i] ?? `X${i + 1}`, pos: x })),
    yAxes: yPositions.map((y, i) => ({ id: uid('ay'), label: `${i + 1}`, pos: y })),
  }
}

export function createEmptyProject(params: NewProjectParams): Project {
  const planTipo: FloorPlan = {
    id: uid('pl'),
    name: 'Pavimento Tipo',
    beams: [],
    slabs: [],
    wallLoads: [],
  }
  const levels: Level[] = [
    { id: uid('lv'), name: 'Fundação', elevation: 0, planId: null },
  ]
  for (let i = 1; i <= params.numFloors; i++) {
    levels.push({
      id: uid('lv'),
      name: i === params.numFloors ? 'Cobertura' : `${i}º Pavimento`,
      elevation: i * params.floorHeight,
      planId: planTipo.id,
    })
  }
  return {
    schemaVersion: 1,
    id: uid('prj'),
    name: params.name,
    author: params.author,
    city: params.city,
    createdAt: params.createdAt ?? '',
    grid: makeGrid([0, 5, 10], [0, 5, 10]),
    levels,
    plans: [planTipo],
    columns: [],
    settings: defaultSettings(params),
  }
}

/**
 * Projeto de exemplo: edifício residencial de 8 pavimentos, grelha 4×3,
 * pilares 25×60, vigas 20×50, lajes maciças h=12.
 */
export function createSampleProject(): Project {
  const params: NewProjectParams = {
    name: 'Edifício Exemplo — Residencial 8 pav.',
    author: 'HyperFrame',
    city: 'São Paulo — SP',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 8,
    floorHeight: 2.88,
    wind: { enabled: true, v0: 40, s1: 1.0, category: 4, s3Group: 2 },
  }
  const project = createEmptyProject(params)
  project.grid = makeGrid([0, 4.0, 8.5, 12.5], [0, 4.5, 9.0])

  const xs = project.grid.xAxes.map((a) => a.pos)
  const ys = project.grid.yAxes.map((a) => a.pos)
  const base = project.levels[0]
  const top = project.levels[project.levels.length - 1]

  // pilares em todas as interseções, orientação alternada p/ equilibrar rigidez
  const columns: Column[] = []
  let pIdx = 1
  for (const y of ys) {
    for (const x of xs) {
      const isEdgeX = x === xs[0] || x === xs[xs.length - 1]
      columns.push({
        id: uid('col'),
        name: `P${pIdx++}`,
        pos: { x, y },
        section: { bw: 0.25, h: 0.6 },
        rotationDeg: isEdgeX ? 90 : 0,
        baseLevelId: base.id,
        topLevelId: top.id,
      })
    }
  }
  project.columns = columns

  const plan = project.plans[0]
  const beams: Beam[] = []
  let vIdx = 1
  // vigas horizontais (ao longo de x) em cada eixo y
  for (const y of ys) {
    beams.push({
      id: uid('bm'),
      name: `V${vIdx++}`,
      path: [
        { x: xs[0], y },
        { x: xs[xs.length - 1], y },
      ],
      section: { bw: 0.2, h: 0.5 },
    })
  }
  // vigas verticais (ao longo de y) em cada eixo x
  for (const x of xs) {
    beams.push({
      id: uid('bm'),
      name: `V${vIdx++}`,
      path: [
        { x, y: ys[0] },
        { x, y: ys[ys.length - 1] },
      ],
      section: { bw: 0.2, h: 0.5 },
    })
  }
  plan.beams = beams

  // lajes: células da grelha
  const slabs: Slab[] = []
  let lIdx = 1
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      slabs.push({
        id: uid('sl'),
        name: `L${lIdx++}`,
        polygon: [
          { x: xs[i], y: ys[j] },
          { x: xs[i + 1], y: ys[j] },
          { x: xs[i + 1], y: ys[j + 1] },
          { x: xs[i], y: ys[j + 1] },
        ],
        thickness: 0.12,
        finishLoad: 1.5,
        liveLoad: 1.5,
        liveLoadLabel: 'Residencial — dormitórios/salas/cozinhas',
      })
    }
  }
  plan.slabs = slabs

  // alvenaria no perímetro (bloco 14 + revest., pé-direito líquido ~2,38 m → ~6 kN/m)
  const wallLoads: WallLoad[] = []
  const perimeterBeamIds = new Set<string>()
  for (const b of beams) {
    const onYEdge =
      (b.path[0].y === ys[0] && b.path[1].y === ys[0]) ||
      (b.path[0].y === ys[ys.length - 1] && b.path[1].y === ys[ys.length - 1])
    const onXEdge =
      (b.path[0].x === xs[0] && b.path[1].x === xs[0]) ||
      (b.path[0].x === xs[xs.length - 1] && b.path[1].x === xs[xs.length - 1])
    if (onYEdge || onXEdge) perimeterBeamIds.add(b.id)
  }
  for (const id of perimeterBeamIds) {
    wallLoads.push({
      id: uid('wl'),
      beamId: id,
      w: 6.0,
      label: 'Alvenaria bloco 14 cm (fachada)',
    })
  }
  // paredes internas nas vigas internas
  for (const b of beams) {
    if (!perimeterBeamIds.has(b.id)) {
      wallLoads.push({ id: uid('wl'), beamId: b.id, w: 3.0, label: 'Alvenaria interna' })
    }
  }
  plan.wallLoads = wallLoads

  return project
}
