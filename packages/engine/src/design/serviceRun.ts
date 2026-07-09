import type { Project } from '../model/types'
import type {
  AnalysisModel,
  BeamServiceResult,
  BeamSpanDesign,
  CaseId,
  CaseResult,
  LoadCombo,
} from '../analysis/types'
import { concreteProps, coverFor } from '../nbr/nbr6118/materials'
import {
  bransonInertia,
  crackedInertia,
  crackingMoment,
  creepFactor,
} from '../nbr/nbr6118/deflections'

/**
 * Flechas de vigas em serviço (combinação quase-permanente):
 * flecha elástica extraída do próprio pórtico (interpolação de Hermite entre
 * nós, relativa à corda do vão) × amplificação de Branson × (1 + αf).
 */
export function runBeamService(
  project: Project,
  model: AnalysisModel,
  combos: LoadCombo[],
  casesEls: Partial<Record<CaseId, CaseResult>>,
  beamDesign: BeamSpanDesign[],
): BeamServiceResult[] {
  const qp = combos.find((c) => c.id === 'ELS-QP')
  if (!qp) return []
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const cover = coverFor(project.settings.caa).beam
  const alphaE = project.settings.steel.Es / cp.ecs

  // deslocamentos e diagramas superpostos da QP
  const nNodes = model.nodes.length
  const disp: number[][] = Array.from({ length: nNodes }, () => [0, 0, 0, 0, 0, 0])
  const nMembers = model.members.length
  const mz: number[][] = Array.from({ length: nMembers }, () => [])
  for (const [caseId, factor] of Object.entries(qp.factors)) {
    const cr = casesEls[caseId as CaseId]
    if (!cr) continue
    for (let i = 0; i < nNodes; i++) {
      for (let d = 0; d < 6; d++) disp[i][d] += factor * cr.displacements[i][d]
    }
    for (let m = 0; m < nMembers; m++) {
      const dg = cr.memberDiagrams[m]
      if (mz[m].length === 0) mz[m] = dg.Mz.map((v) => factor * v)
      else for (let s = 0; s < dg.Mz.length; s++) mz[m][s] += factor * dg.Mz[s]
    }
  }

  // agrupa vãos como no dimensionamento (pavimento representativo por planta)
  const groups = new Map<string, number[]>()
  const seenLevelByBeam = new Map<string, number>()
  model.members.forEach((m, mi) => {
    if (m.ref.kind !== 'beam') return
    const li = model.nodes[m.ni].levelIndex
    const seen = seenLevelByBeam.get(m.ref.sourceId)
    if (seen === undefined) seenLevelByBeam.set(m.ref.sourceId, li)
    else if (seen !== li) return
    const key = `${m.ref.sourceId}|${m.ref.spanIndex}`
    const list = groups.get(key) ?? []
    list.push(mi)
    groups.set(key, list)
  })

  const designByKey = new Map(beamDesign.map((d) => [`${d.beamId}|${d.spanIndex}`, d]))
  const out: BeamServiceResult[] = []

  for (const [key, memberIds] of groups) {
    memberIds.sort((a, b) => a - b)
    const first = model.members[memberIds[0]]
    const last = model.members[memberIds[memberIds.length - 1]]
    const { bw, h } = first.section
    const length = memberIds.reduce((s, mi) => s + model.members[mi].length, 0)
    if (length < 0.2) continue

    // corda entre os nós extremos do vão (deslocamento vertical global)
    const z0 = disp[first.ni][2]
    const z1 = disp[last.nj][2]

    let deltaMax = 0
    let maQp = 0
    let x0 = 0
    for (const mi of memberIds) {
      const m = model.members[mi]
      const un = disp[m.ni]
      const uj = disp[m.nj]
      // GDL locais do plano vertical (y local = Z global p/ vigas)
      const v1 = un[0] * m.yLocal[0] + un[1] * m.yLocal[1] + un[2] * m.yLocal[2]
      const v2 = uj[0] * m.yLocal[0] + uj[1] * m.yLocal[1] + uj[2] * m.yLocal[2]
      const t1 = un[3] * m.zLocal[0] + un[4] * m.zLocal[1] + un[5] * m.zLocal[2]
      const t2 = uj[3] * m.zLocal[0] + uj[4] * m.zLocal[1] + uj[5] * m.zLocal[2]
      const L = m.length
      for (let k = 0; k <= 8; k++) {
        const xi = k / 8
        const n1 = 1 - 3 * xi ** 2 + 2 * xi ** 3
        const n2 = xi - 2 * xi ** 2 + xi ** 3
        const n3 = 3 * xi ** 2 - 2 * xi ** 3
        const n4 = -(xi ** 2) + xi ** 3
        const v = n1 * v1 + n2 * L * t1 + n3 * v2 + n4 * L * t2
        const sSpan = (x0 + xi * L) / length
        const chord = z0 + (z1 - z0) * sSpan
        deltaMax = Math.max(deltaMax, Math.abs(v - chord))
      }
      for (const v of mz[mi]) maQp = Math.max(maQp, Math.abs(v))
      x0 += L
    }

    // Branson com a armadura positiva dimensionada
    const design = designByKey.get(key)
    const asProvided = design?.positive.asProvided ?? 0
    const d = Math.max(h - cover - 0.0063 - 0.008, 0.5 * h)
    const ic = (bw * h ** 3) / 12
    const mr = crackingMoment(bw, h, cp.fctm)
    const iii = crackedInertia(bw, d, asProvided, alphaE)
    const ieq = bransonInertia(mr, maQp, ic, iii)
    const crackFactor = ic / ieq
    const deltaTotal = deltaMax * crackFactor * (1 + creepFactor())
    const limit = length / 250

    const [beamId] = key.split('|')
    out.push({
      beamId,
      beamName: first.ref.sourceName,
      spanIndex: first.ref.spanIndex,
      length,
      deltaElastic: deltaMax,
      crackFactor,
      deltaTotal,
      limit,
      ok: deltaTotal <= limit,
    })
  }
  return out.sort(
    (a, b) =>
      a.beamName.localeCompare(b.beamName, 'pt-BR', { numeric: true }) ||
      a.spanIndex - b.spanIndex,
  )
}
