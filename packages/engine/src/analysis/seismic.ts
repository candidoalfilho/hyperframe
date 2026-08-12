/**
 * SISMO — método das forças horizontais equivalentes (NBR 15421 §9) com o
 * período vindo da extração modal (limitado a Cup·Ta) e verificação de
 * deslocamentos (§9.5: δx = Cd·δxe/I contra os limites por categoria) e de
 * estabilidade (§9.6: θ). As forças por pavimento são aplicadas nos mestres
 * do diafragma com a K ELU fatorizada (back-substitution por direção).
 *
 * v1 = relatório de verificação (períodos, Cs, H, forças, drifts). A entrada
 * das ações sísmicas nas combinações de dimensionamento (NBR 8681,
 * combinações excepcionais) fica para a fase 2.
 */

import type { Project } from '../model/types'
import type { AnalysisModel } from './types'
import { makeNodalSolver, type NumberedSystem, type PassStiffness } from './solve'
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

export interface SeismicStoryRow {
  levelIndex: number
  levelName: string
  /** altura acima da base, m */
  h: number
  /** peso sísmico do pavimento, kN */
  w: number
  /** força sísmica Fx, kN */
  force: number
  /** cortante acumulado no pavimento, kN */
  shear: number
  /** deslocamento elástico δxe, m */
  deltaXe: number
  /** deslocamento amplificado δx = Cd·δxe/I, m */
  deltaX: number
  /** drift amplificado do pavimento Δx, m */
  drift: number
  /** limite Δx ≤ limite·hsx, m */
  driftLimit: number
  driftOk: boolean
  /** coeficiente de estabilidade θ (§9.6) */
  theta: number
  thetaOk: boolean
}

export interface SeismicDirResult {
  dir: 'X' | 'Y'
  /** período usado (modal limitado por Cup·Ta, ou Ta), s */
  T: number
  periodSource: 'modal' | 'aproximado' | 'limitado-cup'
  cs: number
  csGovernedBy: 'plato' | 'periodo' | 'minimo'
  /** força horizontal total na base, kN */
  H: number
  k: number
  rows: SeismicStoryRow[]
  maxDriftRatio: number
  allDriftsOk: boolean
  allThetaOk: boolean
}

export interface SeismicResults {
  /** parâmetros efetivos */
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
  /** método: zona 1 admite o processo simplificado Fx = 0,01·Wx */
  method: 'forcas-equivalentes' | 'simplificado' | 'isento'
  dirs: SeismicDirResult[]
  notes: string[]
}

export function runSeismic(
  project: Project,
  model: AnalysisModel,
  system: NumberedSystem,
  eluPass: PassStiffness,
  modal: ModalResults | null,
): SeismicResults | null {
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

  const base: Omit<SeismicResults, 'dirs' | 'method'> = {
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
    notes,
  }

  if (zone === 0 && !p.agOverride) {
    notes.push('Zona sísmica 0: nenhum requisito de resistência sísmica é exigido (§4).')
    return { ...base, method: 'isento', dirs: [] }
  }

  const solver = makeNodalSolver(project, model, system, eluPass)
  const driftLimitRatio = DRIFT_LIMIT[p.category]
  const dirs: SeismicDirResult[] = []

  const simplified = zone === 1 && !p.agOverride
  if (simplified) {
    notes.push('Zona 1: processo simplificado — forças horizontais de 1% do peso de cada pavimento (§8).')
  }

  for (const dir of ['X', 'Y'] as const) {
    const dof = dir === 'X' ? 0 : 1
    // período modal fundamental na direção (modo com maior massa efetiva)
    let T = Ta
    let periodSource: SeismicDirResult['periodSource'] = 'aproximado'
    if (modal && modal.modes.length > 0) {
      const best = [...modal.modes].sort((a, b) =>
        dir === 'X' ? b.effMassX - a.effMassX : b.effMassY - a.effMassY,
      )[0]
      const tModal = best.T
      const cap = CUP[zone] * Ta
      if (tModal > cap) {
        T = cap
        periodSource = 'limitado-cup'
      } else {
        T = tModal
        periodSource = 'modal'
      }
    }

    let H: number
    let cs = 0
    let governedBy: SeismicDirResult['csGovernedBy'] = 'plato'
    let k = 1
    let forces: number[]
    if (simplified) {
      forces = weights.map((w) => 0.01 * w)
      H = forces.reduce((a, b) => a + b, 0)
      cs = 0.01
      governedBy = 'minimo'
    } else {
      const r = seismicResponseCoefficient(spectrum, T, sys.R, I)
      cs = r.cs
      governedBy = r.governedBy
      H = cs * W
      const vd = verticalDistribution(weights, heights, H, T)
      k = vd.k
      forces = vd.forces
    }

    // resolve os deslocamentos elásticos com as forças sísmicas de projeto
    const loads = masters.map((m, i) => ({ node: m.id, dof, value: forces[i] }))
    const u = solver(loads)

    const rows: SeismicStoryRow[] = masters.map((m, i) => {
      const hsx = heights[i] - (heights[i - 1] ?? 0)
      const deltaXe = Math.abs(u[m.id][dof])
      const deltaXePrev = i > 0 ? Math.abs(u[masters[i - 1].id][dof]) : 0
      const deltaX = (sys.Cd * deltaXe) / I
      const drift = (sys.Cd * Math.max(deltaXe - deltaXePrev, 0)) / I
      const shear = forces.slice(i).reduce((a, b) => a + b, 0)
      const pCum = weights.slice(i).reduce((a, b) => a + b, 0)
      const st = stabilityCoefficient(pCum, drift, shear, hsx, sys.Cd)
      const driftLimit = driftLimitRatio * hsx
      return {
        levelIndex: m.levelIndex,
        levelName: levels[m.levelIndex]?.name ?? `Nível ${m.levelIndex}`,
        h: heights[i],
        w: weights[i],
        force: forces[i],
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

    dirs.push({
      dir,
      T,
      periodSource,
      cs,
      csGovernedBy: governedBy,
      H,
      k,
      rows,
      maxDriftRatio: Math.max(...rows.map((r) => (r.driftLimit > 0 ? r.drift / r.driftLimit : 0))),
      allDriftsOk: rows.every((r) => r.driftOk),
      allThetaOk: rows.every((r) => r.thetaOk),
    })
  }

  return { ...base, method: simplified ? 'simplificado' : 'forcas-equivalentes', dirs }
}
