/**
 * ANÁLISE MODAL nos graus de liberdade laterais dos mestres de diafragma
 * (ux, uy por pavimento). Método da FLEXIBILIDADE: com a K do passe ELS já
 * fatorizada, cada carga unitária num mestre é um back-substitution; a matriz
 * de flexibilidade condensada F (2n×2n) resolve o autoproblema generalizado
 *   K·φ = ω²·M·φ  ⇔  M^{1/2}·F·M^{1/2}·y = (1/ω²)·y,  φ = M^{-1/2}·y
 * com massas concentradas m_i = W_i/g nos pavimentos (condensação estática
 * exata para massa apenas nos mestres). Autovalores por Jacobi cíclico.
 *
 * Torção (rz) fica fora do modal v1 — o efeito é coberto pelo momento
 * acidental de 5% do método das forças equivalentes (NBR 15421 §9.4).
 */

import type { Project } from '../model/types'
import type { AnalysisModel } from './types'
import { makeNodalSolver, type NumberedSystem, type PassStiffness } from './solve'

export interface ModalMode {
  /** nº do modo (1 = fundamental) */
  n: number
  /** período, s */
  T: number
  /** frequência, Hz */
  freq: number
  /** forma modal nos mestres, [ux, uy] por pavimento (base → topo), normalizada |max| = 1 */
  shape: { levelIndex: number; ux: number; uy: number }[]
  /** massa modal efetiva / massa total, por direção (0–1) */
  effMassX: number
  effMassY: number
}

export interface ModalResults {
  modes: ModalMode[]
  /** massa total considerada, t */
  totalMass: number
  /** fração de Q incluída no peso sísmico */
  liveFraction: number
  /** somatório de massa efetiva capturada (0–1) por direção */
  sumEffX: number
  sumEffY: number
}

const G_ACCEL = 9.80665 // m/s²

/** Jacobi cíclico p/ matriz simétrica densa — autovalores + autovetores.
 *  Suficiente e robusto para os 2n GDL condensados (n ≤ dezenas de pavimentos). */
export function jacobiEig(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const n = Ain.length
  const A = Ain.map((r) => [...r])
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q]
    if (off < 1e-24) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-18) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  return { values: A.map((_, i) => A[i][i]), vectors: V }
}

/** Autoproblema modal a partir de flexibilidade condensada F (m/kN) e massas
 *  m (t) — exportado para os testes ancorarem com soluções fechadas. */
export function modalFromFlexibility(
  F: number[][],
  masses: number[],
): { omega2: number[]; shapes: number[][] } {
  const n = F.length
  // simetriza (Maxwell-Betti garante simetria teórica; limpa ruído numérico)
  const Fs = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => 0.5 * (F[i][j] + F[j][i])),
  )
  const sqm = masses.map((m) => Math.sqrt(Math.max(m, 1e-12)))
  const B = Fs.map((row, i) => row.map((f, j) => f * sqm[i] * sqm[j]))
  const { values, vectors } = jacobiEig(B)
  // λ = 1/ω² — maiores λ = modos fundamentais
  const order = values
    .map((v, i) => ({ v, i }))
    .filter((e) => e.v > 1e-14)
    .sort((a, b) => b.v - a.v)
  return {
    omega2: order.map((e) => 1 / e.v),
    shapes: order.map((e) => masses.map((_, k) => vectors[k][e.i] / sqm[k])),
  }
}

export function runModal(
  project: Project,
  model: AnalysisModel,
  system: NumberedSystem,
  elsPass: PassStiffness,
  liveFraction: number,
  nModes = 12,
): ModalResults | null {
  const masters = model.nodes
    .filter((n) => n.kind === 'master')
    .sort((a, b) => a.levelIndex - b.levelIndex)
  if (masters.length === 0) return null

  // massas por pavimento: W = G + f·Q (kN) → m = W/g (t)
  const masses: number[] = []
  for (const m of masters) {
    const lw = model.levelWeights.find((l) => l.levelIndex === m.levelIndex)
    const W = (lw?.G ?? 0) + liveFraction * (lw?.Q ?? 0)
    masses.push(Math.max(W, 1e-6) / G_ACCEL)
  }
  const totalMass = masses.reduce((a, b) => a + b, 0)
  if (totalMass < 1e-9) return null

  // flexibilidade condensada 2n×2n (ux, uy por mestre) via cargas unitárias
  const solver = makeNodalSolver(project, model, system, elsPass)
  const n2 = masters.length * 2
  const F: number[][] = []
  for (let j = 0; j < n2; j++) {
    const mj = masters[j >> 1]
    const dof = j & 1
    const u = solver([{ node: mj.id, dof, value: 1 }])
    F.push(masters.flatMap((mi) => [u[mi.id][0], u[mi.id][1]]))
  }
  // F veio por colunas (carga j → linha de respostas); transpõe p/ F[i][j]
  const Ft = Array.from({ length: n2 }, (_, i) => Array.from({ length: n2 }, (_, j) => F[j][i]))
  const mass2 = masters.flatMap((_, i) => [masses[i], masses[i]])

  const { omega2, shapes } = modalFromFlexibility(Ft, mass2)

  const modes: ModalMode[] = []
  let sumEffX = 0
  let sumEffY = 0
  for (let k = 0; k < Math.min(nModes, omega2.length); k++) {
    const w2 = omega2[k]
    if (!(w2 > 0) || !isFinite(w2)) continue
    const phi = shapes[k]
    // participação por direção: Γ = φᵀMr/φᵀMφ; massa efetiva = (φᵀMr)²/φᵀMφ
    let mPhi = 0, lX = 0, lY = 0
    for (let i = 0; i < n2; i++) {
      mPhi += mass2[i] * phi[i] * phi[i]
      if ((i & 1) === 0) lX += mass2[i] * phi[i]
      else lY += mass2[i] * phi[i]
    }
    if (mPhi < 1e-14) continue
    const effX = (lX * lX) / mPhi / totalMass
    const effY = (lY * lY) / mPhi / totalMass
    sumEffX += effX
    sumEffY += effY
    const maxAbs = Math.max(...phi.map((p) => Math.abs(p)), 1e-12)
    modes.push({
      n: k + 1,
      T: (2 * Math.PI) / Math.sqrt(w2),
      freq: Math.sqrt(w2) / (2 * Math.PI),
      shape: masters.map((m, i) => ({
        levelIndex: m.levelIndex,
        ux: phi[2 * i] / maxAbs,
        uy: phi[2 * i + 1] / maxAbs,
      })),
      effMassX: effX,
      effMassY: effY,
    })
  }
  if (modes.length === 0) return null
  return { modes, totalMass, liveFraction, sumEffX, sumEffY }
}
