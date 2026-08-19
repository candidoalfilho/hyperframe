/**
 * MÉTODO ESPECTRAL (NBR 15421 §10) — análise modal por espectro de resposta.
 *
 * Para cada direção de excitação: cada modo k contribui com forças de
 * pavimento p_k,i = (I/R)·Sa(T_k)·g·Γ_k·m_i·φ_k,i (nível de PROJETO — o
 * espectro é elástico e as forças são reduzidas por R/I, como no §9). Os
 * CORTANTES de pavimento por modo são somas acumuladas das forças; a resposta
 * combinada usa SRSS (§10.3: raiz quadrada da soma dos quadrados), com modos
 * suficientes para capturar ≥ 90% da massa (§10.1). As forças estáticas
 * equivalentes por pavimento saem das DIFERENÇAS dos cortantes SRSS — e são
 * aplicadas nos mesmos casos EQ± da fase 2 (com torção acidental §9.4 e
 * combinações excepcionais NBR 8681), preservando sinais coerentes.
 *
 * Regra do cortante mínimo (§10.4): se Ht < 0,85·H (H do método das forças
 * equivalentes), todas as forças são multiplicadas por 0,85·H/Ht.
 *
 * Γ e Γ·φ são invariantes à normalização da forma modal (Γ = L/Mn escala com
 * 1/c quando φ escala com c) — as formas normalizadas do runModal servem.
 */

import type { ModalMode } from './modal'

const G_ACCEL = 9.80665 // m/s²

export interface SpectralDirResult {
  /** nº de modos usados (até capturar ≥ 90% da massa na direção) */
  modesUsed: number
  /** massa efetiva capturada na direção (0–1) */
  massSum: number
  /** cortante na base combinado (SRSS), nível de projeto, kN */
  Ht: number
  /** cortante na base por modo (nível de projeto), kN */
  perModeBase: number[]
  /** forças estáticas equivalentes por pavimento (base → topo), kN */
  forces: number[]
  /** cortantes SRSS por pavimento (base → topo), kN */
  shears: number[]
}

/**
 * Resposta espectral numa direção a partir dos modos extraídos.
 * @param modes  modos do runModal (formas nos mestres, base → topo)
 * @param masses massa por pavimento, t (mesma ordem das formas)
 * @param Sa     espectro de projeto Sa(T) em fração de g
 * @param IoverR fator I/R (reduz o espectro elástico ao nível de projeto)
 * @param minMass fração de massa a capturar (§10.1: 0,90)
 */
export function spectralResponse(
  modes: ModalMode[],
  masses: number[],
  dir: 'X' | 'Y',
  Sa: (T: number) => number,
  IoverR: number,
  minMass = 0.9,
): SpectralDirResult {
  const n = masses.length
  const totalMass = masses.reduce((a, b) => a + b, 0)
  // ordena por massa efetiva decrescente na direção e acumula até minMass
  const ranked = [...modes].sort((a, b) =>
    dir === 'X' ? b.effMassX - a.effMassX : b.effMassY - a.effMassY,
  )
  const used: ModalMode[] = []
  let massSum = 0
  for (const m of ranked) {
    const eff = dir === 'X' ? m.effMassX : m.effMassY
    if (eff <= 1e-9) continue
    used.push(m)
    massSum += eff
    if (massSum >= minMass) break
  }

  // cortantes por pavimento e por modo: V_k(i) = Σ_{j ≥ i} p_k,j
  const shearsSq = new Array<number>(n).fill(0)
  const perModeBase: number[] = []
  for (const mode of used) {
    const phiD = mode.shape.map((s) => (dir === 'X' ? s.ux : s.uy))
    let L = 0
    let Mn = 0
    mode.shape.forEach((s, i) => {
      L += masses[i] * phiD[i]
      Mn += masses[i] * (s.ux * s.ux + s.uy * s.uy)
    })
    if (Mn < 1e-14 || Math.abs(L) < 1e-12) {
      perModeBase.push(0)
      continue
    }
    const gamma = L / Mn
    const sa = Sa(mode.T) * IoverR
    // forças modais de projeto por pavimento (componente na direção)
    const p = phiD.map((phi, i) => sa * G_ACCEL * gamma * masses[i] * phi)
    let v = 0
    for (let i = n - 1; i >= 0; i--) {
      v += p[i]
      shearsSq[i] += v * v
    }
    perModeBase.push(Math.abs(sa * G_ACCEL * gamma * L)) // = Sa·(I/R)·g·Meff
  }

  const shears = shearsSq.map((s) => Math.sqrt(s))
  const forces = shears.map((v, i) => v - (shears[i + 1] ?? 0))
  return {
    modesUsed: used.length,
    massSum: Math.min(massSum, 1),
    Ht: shears[0] ?? 0,
    perModeBase,
    forces,
    shears,
  }
}

/** §10.4 — fator do cortante mínimo: se Ht < 0,85·H, escala por 0,85·H/Ht. */
export function baseShearCorrection(Ht: number, Hfhe: number): number {
  if (Ht <= 0 || Hfhe <= 0) return 1
  return Ht < 0.85 * Hfhe ? (0.85 * Hfhe) / Ht : 1
}
