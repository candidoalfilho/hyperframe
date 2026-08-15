/**
 * SISMO — método das forças horizontais equivalentes (NBR 15421 §9).
 *
 * Fase 2: as forças sísmicas são CASOS DE CARGA reais (EQXP/EQXN/EQYP/EQYN),
 * aplicadas nos mestres do diafragma com o momento de TORÇÃO ACIDENTAL de 5%
 * da dimensão em planta perpendicular à direção (§9.4: Mta = Fx·e), resolvidas
 * junto dos demais casos e combinadas nas combinações últimas EXCEPCIONAIS da
 * NBR 8681 (§4.3.3: γg·G + E + ψ2·Q) — vigas, pilares e fundações passam a
 * ser dimensionados PELO sismo.
 *
 * `buildSeismicLoads` monta o plano (períodos modais limitados a Cup·Ta, Cs,
 * H, distribuição vertical, excentricidades); `injectSeismicLoads` grava os
 * casos nodais; `runSeismic` produz o relatório de verificação (§9.5 drifts
 * δx = Cd·δxe/I e §9.6 θ) a partir dos deslocamentos já resolvidos do passe
 * ELU (rigidez fissurada).
 */

import type { Project } from '../model/types'
import type { AnalysisModel, CaseId, CaseResult } from './types'
import type { InternalModel } from './buildModel'
import type { ModalResults } from './modal'
import {
  approxPeriod,
  CUP,
  designSpectrum,
  DRIFT_LIMIT,
  IMPORTANCE,
  SEISMIC_SYSTEMS,
  seismicResponseCoefficient,
  stabilityCoefficient,
  verticalDistribution,
  ZONE_AG,
  type SeismicZone,
} from '../nbr/nbr15421/seismic'

export interface SeismicPlanDir {
  dir: 'X' | 'Y'
  /** período usado (modal limitado por Cup·Ta, ou Ta), s */
  T: number
  periodSource: 'modal' | 'aproximado' | 'limitado-cup'
  cs: number
  csGovernedBy: 'plato' | 'periodo' | 'minimo'
  /** força horizontal total na base, kN */
  H: number
  k: number
  /** força por pavimento (alinhada aos mestres base → topo), kN */
  forces: number[]
  /** excentricidade acidental de 5% (§9.4), m */
  eTor: number
}

export interface SeismicPlan {
  ag: number
  zone: SeismicZone
  soilClass: string
  category: 1 | 2 | 3
  I: number
  R: number
  Cd: number
  omega0: number
  systemLabel: string
  ags0: number
  ags1: number
  /** peso sísmico total W, kN */
  W: number
  Ta: number
  method: 'forcas-equivalentes' | 'simplificado' | 'isento'
  /** ids dos nós mestres (base → topo) */
  masterIds: number[]
  levelIndexes: number[]
  weights: number[]
  /** alturas acima da base, m */
  heights: number[]
  notes: string[]
}

export interface SeismicStoryRow {
  levelIndex: number
  levelName: string
  h: number
  w: number
  force: number
  shear: number
  deltaXe: number
  deltaX: number
  drift: number
  driftLimit: number
  driftOk: boolean
  theta: number
  thetaOk: boolean
}

export interface SeismicDirResult {
  dir: 'X' | 'Y'
  T: number
  periodSource: 'modal' | 'aproximado' | 'limitado-cup'
  cs: number
  csGovernedBy: 'plato' | 'periodo' | 'minimo'
  H: number
  k: number
  /** excentricidade acidental aplicada, m */
  eTor: number
  rows: SeismicStoryRow[]
  maxDriftRatio: number
  allDriftsOk: boolean
  allThetaOk: boolean
}

export interface SeismicResults {
  ag: number
  zone: SeismicZone
  soilClass: string
  category: 1 | 2 | 3
  I: number
  R: number
  Cd: number
  omega0: number
  systemLabel: string
  ags0: number
  ags1: number
  W: number
  Ta: number
  method: 'forcas-equivalentes' | 'simplificado' | 'isento'
  dirs: SeismicDirResult[]
  notes: string[]
}

/** dims em planta do modelo (bounding box dos nós estruturais), m */
function planDims(model: AnalysisModel): { lx: number; ly: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of model.nodes) {
    if (n.kind !== 'structural') continue
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  return { lx: Math.max(maxX - minX, 0), ly: Math.max(maxY - minY, 0) }
}

/** Se o sismo está habilitado e NÃO isento (zona 0 sem ag do mapa é isenta §4). */
export function seismicActive(project: Project): boolean {
  const p = project.settings.seismic
  if (!p?.enabled) return false
  return p.zone !== 0 || p.agOverride !== undefined
}

/** Monta o plano de forças sísmicas (períodos, Cs, H, Fx por pavimento). */
export function buildSeismicLoads(
  project: Project,
  model: AnalysisModel,
  modal: ModalResults | null,
): { plan: SeismicPlan; dirs: SeismicPlanDir[] } | null {
  const p = project.settings.seismic
  if (!p?.enabled) return null

  const zone = p.zone as SeismicZone
  const ag = p.agOverride ?? ZONE_AG[zone]
  const sys = SEISMIC_SYSTEMS[p.system]
  const I = IMPORTANCE[p.category]
  const spectrum = designSpectrum(ag, p.soilClass)
  const notes: string[] = []

  const masters = model.nodes
    .filter((n) => n.kind === 'master')
    .sort((a, b) => a.levelIndex - b.levelIndex)
  if (masters.length === 0) return null

  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const baseZ = levels[0]?.elevation ?? 0
  const weights = masters.map((m) => {
    const lw = model.levelWeights.find((l) => l.levelIndex === m.levelIndex)
    return (lw?.G ?? 0) + p.liveFraction * (lw?.Q ?? 0)
  })
  const heights = masters.map((m) => levels[m.levelIndex].elevation - baseZ)
  const W = weights.reduce((a, b) => a + b, 0)
  const hn = Math.max(...heights)
  const Ta = approxPeriod(hn, p.system)
  const { lx, ly } = planDims(model)

  const isento = zone === 0 && p.agOverride === undefined
  const simplified = zone === 1 && p.agOverride === undefined

  const plan: SeismicPlan = {
    ag,
    zone,
    soilClass: p.soilClass,
    category: p.category,
    I,
    R: sys.R,
    Cd: sys.Cd,
    omega0: sys.omega0,
    systemLabel: sys.label,
    ags0: spectrum.ags0,
    ags1: spectrum.ags1,
    W,
    Ta,
    method: isento ? 'isento' : simplified ? 'simplificado' : 'forcas-equivalentes',
    masterIds: masters.map((m) => m.id),
    levelIndexes: masters.map((m) => m.levelIndex),
    weights,
    heights,
    notes,
  }

  if (isento) {
    notes.push('Zona sísmica 0: nenhum requisito de resistência sísmica é exigido (§4).')
    return { plan, dirs: [] }
  }
  if (simplified) {
    notes.push(
      'Zona 1: processo simplificado — forças horizontais de 1% do peso de cada pavimento (§8).',
    )
  }
  notes.push(
    'Torção acidental (§9.4): momento Mta = Fx·0,05·L⊥ aplicado no diafragma com sinal único por caso — a envoltória ±X/±Y cobre os dois giros em plantas ~simétricas.',
  )

  const dirs: SeismicPlanDir[] = []
  for (const dir of ['X', 'Y'] as const) {
    let T = Ta
    let periodSource: SeismicPlanDir['periodSource'] = 'aproximado'
    if (modal && modal.modes.length > 0) {
      const best = [...modal.modes].sort((a, b) =>
        dir === 'X' ? b.effMassX - a.effMassX : b.effMassY - a.effMassY,
      )[0]
      const cap = CUP[zone] * Ta
      if (best.T > cap) {
        T = cap
        periodSource = 'limitado-cup'
      } else {
        T = best.T
        periodSource = 'modal'
      }
    }

    let cs = 0.01
    let governedBy: SeismicPlanDir['csGovernedBy'] = 'minimo'
    let H: number
    let k = 1
    let forces: number[]
    if (simplified) {
      forces = weights.map((w) => 0.01 * w)
      H = forces.reduce((a, b) => a + b, 0)
    } else {
      const r = seismicResponseCoefficient(spectrum, T, sys.R, I)
      cs = r.cs
      governedBy = r.governedBy
      H = cs * W
      const vd = verticalDistribution(weights, heights, H, T)
      k = vd.k
      forces = vd.forces
    }

    dirs.push({
      dir,
      T,
      periodSource,
      cs,
      csGovernedBy: governedBy,
      H,
      k,
      forces,
      // §9.4: 5% da dimensão em planta PERPENDICULAR à direção das forças
      eTor: 0.05 * (dir === 'X' ? ly : lx),
    })
  }
  return { plan, dirs }
}

const DIR_CASES: Record<'X' | 'Y', [CaseId, CaseId]> = {
  X: ['EQXP', 'EQXN'],
  Y: ['EQYP', 'EQYN'],
}

/** Grava os casos EQ* nas cargas nodais (substitui os existentes — seguro
 *  para o re-cálculo após as molas de fundação). */
export function injectSeismicLoads(
  internal: InternalModel,
  plan: SeismicPlan,
  dirs: SeismicPlanDir[],
): void {
  for (const ids of Object.values(DIR_CASES)) for (const id of ids) internal.nodalLoads[id] = []
  for (const d of dirs) {
    const dof = d.dir === 'X' ? 0 : 1
    for (const [caseId, sign] of [
      [DIR_CASES[d.dir][0], 1],
      [DIR_CASES[d.dir][1], -1],
    ] as const) {
      plan.masterIds.forEach((node, i) => {
        const F = sign * d.forces[i]
        if (F === 0) return
        internal.nodalLoads[caseId].push({ node, dof, value: F })
        if (d.eTor > 0) internal.nodalLoads[caseId].push({ node, dof: 5, value: F * d.eTor })
      })
    }
  }
}

/** Relatório §9.5/§9.6 a partir dos deslocamentos do passe ELU (fissurado). */
export function runSeismic(
  project: Project,
  model: AnalysisModel,
  built: { plan: SeismicPlan; dirs: SeismicPlanDir[] } | null,
  casesElu: Partial<Record<CaseId, CaseResult>>,
): SeismicResults | null {
  if (!built) return null
  const { plan, dirs } = built
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const driftLimitRatio = DRIFT_LIMIT[plan.category]

  const out: SeismicDirResult[] = []
  for (const d of dirs) {
    const dof = d.dir === 'X' ? 0 : 1
    const cr = casesElu[DIR_CASES[d.dir][0]]
    if (!cr) continue
    const rows: SeismicStoryRow[] = plan.masterIds.map((nodeId, i) => {
      const hsx = plan.heights[i] - (plan.heights[i - 1] ?? 0)
      const deltaXe = Math.abs(cr.displacements[nodeId][dof])
      const deltaXePrev =
        i > 0 ? Math.abs(cr.displacements[plan.masterIds[i - 1]][dof]) : 0
      const deltaX = (plan.Cd * deltaXe) / plan.I
      const drift = (plan.Cd * Math.max(deltaXe - deltaXePrev, 0)) / plan.I
      const shear = d.forces.slice(i).reduce((a, b) => a + b, 0)
      const pCum = plan.weights.slice(i).reduce((a, b) => a + b, 0)
      const st = stabilityCoefficient(pCum, drift, shear, hsx, plan.Cd)
      const driftLimit = driftLimitRatio * hsx
      const li = plan.levelIndexes[i]
      return {
        levelIndex: li,
        levelName: levels[li]?.name ?? `Nível ${li}`,
        h: plan.heights[i],
        w: plan.weights[i],
        force: d.forces[i],
        shear,
        deltaXe,
        deltaX,
        drift,
        driftLimit,
        driftOk: drift <= driftLimit + 1e-9,
        theta: st.theta,
        thetaOk: st.theta <= st.thetaMax + 1e-9,
      }
    })
    out.push({
      dir: d.dir,
      T: d.T,
      periodSource: d.periodSource,
      cs: d.cs,
      csGovernedBy: d.csGovernedBy,
      H: d.H,
      k: d.k,
      eTor: d.eTor,
      rows,
      maxDriftRatio: Math.max(
        ...rows.map((r) => (r.driftLimit > 0 ? r.drift / r.driftLimit : 0)),
        0,
      ),
      allDriftsOk: rows.every((r) => r.driftOk),
      allThetaOk: rows.every((r) => r.thetaOk),
    })
  }

  return {
    ag: plan.ag,
    zone: plan.zone,
    soilClass: plan.soilClass,
    category: plan.category,
    I: plan.I,
    R: plan.R,
    Cd: plan.Cd,
    omega0: plan.omega0,
    systemLabel: plan.systemLabel,
    ags0: plan.ags0,
    ags1: plan.ags1,
    W: plan.W,
    Ta: plan.Ta,
    method: plan.method,
    dirs: out,
    notes: plan.notes,
  }
}
