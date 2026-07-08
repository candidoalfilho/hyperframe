import type { Project } from '../model/types'
import { concreteProps } from '../nbr/nbr6118/materials'
import { SkylineMatrix, buildProfile } from './skyline'
import {
  equivalentNodalLoads,
  globalStiffness,
  localStiffness,
  rectSectionProps,
  rotationMatrix,
  sampleDiagrams,
  toGlobal,
  toLocal,
} from './frame3d'
import type { InternalModel } from './buildModel'
import type { AnalysisModel, CaseId, CaseResult, Reaction } from './types'

/** termo de mapeamento: GDL global + fator (restrições mestre-escravo) */
interface DofTerm {
  g: number
  f: number
}

export interface NumberedSystem {
  /** por nó, por gdl local (0..5): lista de termos globais (vazia = prescrito) */
  map: DofTerm[][][]
  nDofs: number
}

/**
 * Numeração de GDL com diafragma rígido: nós escravos têm ux/uy/rz expressos
 * em função do mestre do pavimento (ux_m, uy_m, rz_m) com braços de alavanca.
 * Apoios (base) totalmente engastados. Mestres têm apenas ux, uy, rz.
 */
export function numberDofs(model: AnalysisModel): NumberedSystem {
  const masterByLevel = new Map(model.masters.map((m) => [m.levelIndex, m.nodeId]))
  const order = [...model.nodes].sort(
    (a, b) =>
      a.levelIndex - b.levelIndex ||
      (a.kind === 'master' ? 1 : 0) - (b.kind === 'master' ? 1 : 0) ||
      a.id - b.id,
  )
  const map: DofTerm[][][] = model.nodes.map(() => [[], [], [], [], [], []])
  let n = 0
  // primeiro numera os GDL próprios na ordem por pavimento
  const masterDofs = new Map<number, { ux: number; uy: number; rz: number }>()
  for (const node of order) {
    if (node.support) continue
    if (node.kind === 'master') {
      const ux = n++
      const uy = n++
      const rz = n++
      masterDofs.set(node.id, { ux, uy, rz })
      map[node.id][0] = [{ g: ux, f: 1 }]
      map[node.id][1] = [{ g: uy, f: 1 }]
      map[node.id][5] = [{ g: rz, f: 1 }]
      continue
    }
    const masterId = masterByLevel.get(node.levelIndex)
    if (masterId !== undefined && masterId !== node.id) {
      // escravo: uz, rx, ry próprios (numerados aqui); ux/uy/rz virão do mestre
      map[node.id][2] = [{ g: n++, f: 1 }]
      map[node.id][3] = [{ g: n++, f: 1 }]
      map[node.id][4] = [{ g: n++, f: 1 }]
    } else {
      for (let d = 0; d < 6; d++) map[node.id][d] = [{ g: n++, f: 1 }]
    }
  }
  // agora liga escravos aos mestres (já numerados)
  for (const node of model.nodes) {
    if (node.support || node.kind === 'master') continue
    const masterId = masterByLevel.get(node.levelIndex)
    if (masterId === undefined || masterId === node.id) continue
    const md = masterDofs.get(masterId)
    if (!md) continue
    const master = model.nodes[masterId]
    const dx = node.x - master.x
    const dy = node.y - master.y
    map[node.id][0] = [
      { g: md.ux, f: 1 },
      { g: md.rz, f: -dy },
    ]
    map[node.id][1] = [
      { g: md.uy, f: 1 },
      { g: md.rz, f: dx },
    ]
    map[node.id][5] = [{ g: md.rz, f: 1 }]
  }
  return { map, nDofs: n }
}

export interface PassStiffness {
  /** multiplicador de EI p/ vigas e pilares (não-linearidade física aprox.) */
  beams: number
  columns: number
  /** usa Eci (ELU §15.7.3) ou Ecs (ELS) como base da flexão */
  useEci: boolean
}

/** resolve todos os casos de carga p/ um passe de rigidez */
export function solvePass(
  project: Project,
  model: AnalysisModel,
  internal: InternalModel,
  system: NumberedSystem,
  pass: PassStiffness,
  cases: CaseId[],
): Partial<Record<CaseId, CaseResult>> {
  const { map, nDofs } = system
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )

  // pré-computa matrizes por membro
  const memberData = model.members.map((m) => {
    const { A, Iy, Iz, J } = rectSectionProps(m.section.bw, m.section.h)
    const isBeam = m.ref.kind === 'beam'
    const eBase = pass.useEci ? cp.eci : cp.ecs
    const eFactor = isBeam ? pass.beams : pass.columns
    const EA = cp.ecs * A
    const EIy = eBase * eFactor * Iy
    const EIz = eBase * eFactor * Iz
    const GJ = cp.gc * J * (isBeam ? project.settings.torsionFactor : 1)
    const kl = localStiffness({ L: m.length, EA, EIy, EIz, GJ })
    const r = rotationMatrix(m.xLocal, m.yLocal, m.zLocal)
    const kg = globalStiffness(r, kl)
    // termos globais dos 12 gdl do elemento
    const terms: DofTerm[][] = []
    for (const nodeId of [m.ni, m.nj]) {
      for (let d = 0; d < 6; d++) terms.push(map[nodeId][d])
    }
    return { kl, r, kg, terms }
  })

  // perfil + montagem
  const minRow = buildProfile(nDofs, (cb) => {
    for (const md of memberData) {
      const dofs: number[] = []
      for (const termList of md.terms) for (const t of termList) dofs.push(t.g)
      cb(dofs)
    }
  })
  const K = new SkylineMatrix(minRow)
  for (const md of memberData) {
    const { kg, terms } = md
    for (let a = 0; a < 12; a++) {
      const ta = terms[a]
      if (ta.length === 0) continue
      for (let b = 0; b < 12; b++) {
        const tb = terms[b]
        if (tb.length === 0) continue
        const kab = kg[a * 12 + b]
        if (kab === 0) continue
        for (const x of ta) {
          for (const y of tb) {
            if (x.g <= y.g) K.add(x.g, y.g, x.f * y.f * kab)
          }
        }
      }
    }
  }
  K.factorize()

  const results: Partial<Record<CaseId, CaseResult>> = {}
  for (const caseId of cases) {
    // vetor de cargas
    const F = new Float64Array(nDofs)
    const loads = internal.memberLoads[caseId]
    model.members.forEach((m, mi) => {
      const { wx, wy, wz } = loads[mi]
      if (wx === 0 && wy === 0 && wz === 0) return
      const feq = equivalentNodalLoads(m.length, wx, wy, wz)
      const fg = toGlobal(memberData[mi].r, feq)
      const terms = memberData[mi].terms
      for (let k = 0; k < 12; k++) {
        for (const t of terms[k]) F[t.g] += t.f * fg[k]
      }
    })
    for (const nl of internal.nodalLoads[caseId]) {
      for (const t of map[nl.node][nl.dof]) F[t.g] += t.f * nl.value
    }

    const U = K.solve(F)

    // deslocamentos nodais globais
    const displacements: number[][] = model.nodes.map((node) => {
      const u = [0, 0, 0, 0, 0, 0]
      for (let d = 0; d < 6; d++) {
        let s = 0
        for (const t of map[node.id][d]) s += t.f * U[t.g]
        u[d] = s
      }
      return u
    })

    // esforços por membro + reações
    const reactionsByNode = new Map<number, Reaction>()
    const memberDiagrams = model.members.map((m, mi) => {
      const ug = new Float64Array(12)
      const un = displacements[m.ni]
      const uj = displacements[m.nj]
      for (let d = 0; d < 6; d++) {
        ug[d] = un[d]
        ug[6 + d] = uj[d]
      }
      const { kl, r } = memberData[mi]
      const ul = toLocal(r, ug)
      const { wx, wy, wz } = loads[mi]
      const feq = equivalentNodalLoads(m.length, wx, wy, wz)
      // f local = k·u − f_eq
      const fl = new Float64Array(12)
      for (let i = 0; i < 12; i++) {
        let s = 0
        for (let j = 0; j < 12; j++) s += kl[i * 12 + j] * ul[j]
        fl[i] = s - feq[i]
      }
      // reações (extremidades apoiadas)
      for (const [end, nodeId] of [
        [0, m.ni],
        [6, m.nj],
      ] as const) {
        if (!model.nodes[nodeId].support) continue
        const fg = toGlobal(r, fl)
        const rx = reactionsByNode.get(nodeId) ?? {
          nodeId,
          fx: 0,
          fy: 0,
          fz: 0,
          mx: 0,
          my: 0,
          mz: 0,
        }
        rx.fx += fg[end + 0]
        rx.fy += fg[end + 1]
        rx.fz += fg[end + 2]
        rx.mx += fg[end + 3]
        rx.my += fg[end + 4]
        rx.mz += fg[end + 5]
        reactionsByNode.set(nodeId, rx)
      }
      return sampleDiagrams(fl, m.length, wx, wy, wz)
    })

    results[caseId] = {
      displacements,
      memberDiagrams,
      reactions: [...reactionsByNode.values()].sort((a, b) => a.nodeId - b.nodeId),
    }
  }
  return results
}
