import type { Project } from '../model/types'
import type { AnalysisModel, CaseId, CaseResult, LoadCombo } from './types'
import { makeNodalSolver, type NumberedSystem, type PassStiffness } from './solve'

/**
 * P-Δ ITERATIVO (2ª ordem global "real") por direção de vento:
 * método das FORÇAS LATERAIS FICTÍCIAS — na combinação ELU governante da
 * direção, os drifts de pavimento geram cortantes fictícios
 *   V_i = P_i,acum · (δ_i − δ_{i−1}) / h_i
 * aplicados nos nós mestres do diafragma; re-resolve (K do passe ELU já
 * fatorizada — cada iteração é um back-substitution) até o topo convergir.
 * O fator P-Δ = δ_topo,final / δ_topo,1ª ordem é comparado ao 0,95·γz
 * (§15.7.2) e o MAIOR dos dois amplifica as combinações — válido também
 * além do limite γz = 1,30 do método aproximado.
 */
export interface PDeltaDirResult {
  dir: 'X+' | 'X-' | 'Y+' | 'Y-'
  comboLabel: string
  factor: number
  iterations: number
  converged: boolean
  /** deslocamento de topo 1ª ordem e final, m */
  top1: number
  topFinal: number
}

const DIR_CASE: Record<PDeltaDirResult['dir'], CaseId> = {
  'X+': 'WXP',
  'X-': 'WXN',
  'Y+': 'WYP',
  'Y-': 'WYN',
}

export function runPDelta(
  project: Project,
  model: AnalysisModel,
  system: NumberedSystem,
  eluPass: PassStiffness,
  casesElu: Partial<Record<CaseId, CaseResult>>,
  combos: LoadCombo[],
): PDeltaDirResult[] {
  const masters = model.nodes
    .filter((n) => n.kind === 'master')
    .sort((a, b) => a.levelIndex - b.levelIndex)
  if (masters.length === 0 || !model.wind || model.wind.length === 0) return []

  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const solver = makeNodalSolver(project, model, system, eluPass)
  const out: PDeltaDirResult[] = []

  for (const dir of Object.keys(DIR_CASE) as PDeltaDirResult['dir'][]) {
    const caseId = DIR_CASE[dir]
    if (!casesElu[caseId]) continue
    // combinação ELU governante: maior fator de vento nesta direção
    let combo: LoadCombo | null = null
    for (const c of combos) {
      if (c.type !== 'ELU') continue
      const f = c.factors[caseId]
      if (f !== undefined && f > (combo?.factors[caseId] ?? 0)) combo = c
    }
    if (!combo) continue

    const dof = dir.startsWith('X') ? 0 : 1
    // deslocamento 1ª ordem da combinação nos mestres
    const u0 = masters.map((m) => {
      let u = 0
      for (const [cid, f] of Object.entries(combo!.factors)) {
        const cr = casesElu[cid as CaseId]
        if (cr) u += f * cr.displacements[m.id][dof]
      }
      return u
    })
    // carga gravitacional ACUMULADA acima de cada pavimento (fatores da combinação)
    const fG = combo.factors.G ?? 0
    const fQ = combo.factors.Q ?? 0
    const pLevel = model.levelWeights.map((lw) => fG * lw.G + fQ * lw.Q)
    const pCum = masters.map((m) =>
      model.levelWeights.reduce((s, lw) => (lw.levelIndex >= m.levelIndex ? s + pLevel[model.levelWeights.indexOf(lw)] : s), 0),
    )
    const hStory = masters.map((m) => {
      const li = m.levelIndex
      const below = levels[li - 1]?.elevation ?? 0
      return Math.max(levels[li].elevation - below, 0.1)
    })

    const top1 = Math.abs(u0[u0.length - 1])
    if (top1 < 1e-9) continue
    let u = [...u0]
    let iterations = 0
    let converged = false
    for (let it = 1; it <= 12; it++) {
      iterations = it
      // cortantes fictícios por pavimento e forças nos mestres
      const v = masters.map((_, i) => (pCum[i] * (u[i] - (u[i - 1] ?? 0))) / hStory[i])
      const loads = masters.map((m, i) => ({
        node: m.id,
        dof,
        value: v[i] - (v[i + 1] ?? 0),
      }))
      const du = solver(loads)
      const uNew = masters.map((m, i) => u0[i] + du[m.id][dof])
      const delta = Math.max(...uNew.map((x, i) => Math.abs(x - u[i])))
      u = uNew
      if (delta < 0.005 * Math.max(Math.abs(u[u.length - 1]), 1e-6)) {
        converged = true
        break
      }
      if (Math.abs(u[u.length - 1]) > 5 * top1) break // divergindo (instável)
    }
    out.push({
      dir,
      comboLabel: combo.label,
      factor: Math.abs(u[u.length - 1]) / top1,
      iterations,
      converged,
      top1,
      topFinal: Math.abs(u[u.length - 1]),
    })
  }
  return out
}
