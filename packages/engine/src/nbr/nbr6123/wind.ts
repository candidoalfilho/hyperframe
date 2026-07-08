/**
 * NBR 6123:1988 — forças devidas ao vento em edificações.
 * Perfil de velocidade S2 (tab. 1), fator estatístico S3, pressão dinâmica
 * q(z) e coeficiente de arrasto Ca (Fig. 4) com forças por pavimento.
 * Unidades: m, m/s, kN.
 */

import type { WindCategory, WindClass, WindParams } from '../../model/types'
import type { WindGeometry } from '../api'
import type { WindDirectionLoads, WindLevelForce } from '../../analysis/types'

// ---------------------------------------------------------------------------
// S2 — rugosidade do terreno / dimensões da edificação (NBR 6123 tab. 1)
// ---------------------------------------------------------------------------

/** NBR 6123 tab. 1 — parâmetros meteorológicos (b, p) por classe e categoria */
const TABLE1: Record<WindClass, Record<WindCategory, { b: number; p: number }>> = {
  A: {
    1: { b: 1.1, p: 0.06 },
    2: { b: 1.0, p: 0.085 },
    3: { b: 0.94, p: 0.1 },
    4: { b: 0.86, p: 0.12 },
    5: { b: 0.74, p: 0.15 },
  },
  B: {
    1: { b: 1.11, p: 0.065 },
    2: { b: 1.0, p: 0.09 },
    3: { b: 0.94, p: 0.105 },
    4: { b: 0.85, p: 0.125 },
    5: { b: 0.73, p: 0.16 },
  },
  C: {
    1: { b: 1.12, p: 0.07 },
    2: { b: 1.0, p: 0.1 },
    3: { b: 0.93, p: 0.115 },
    4: { b: 0.84, p: 0.135 },
    5: { b: 0.71, p: 0.175 },
  },
}

/** NBR 6123 tab. 1 — fator de rajada Fr da classe (aplicado sempre, p/ qualquer categoria) */
const FR: Record<WindClass, number> = { A: 1.0, B: 0.98, C: 0.95 }

/** NBR 6123 §5.3 — S2(z) = b·Fr·(z/10)^p */
export function s2Factor(z: number, category: WindCategory, windClass: WindClass): number {
  const { b, p } = TABLE1[windClass][category]
  return b * FR[windClass] * Math.pow(z / 10, p)
}

// ---------------------------------------------------------------------------
// S3 — fator estatístico (NBR 6123 tab. 3)
// ---------------------------------------------------------------------------

const S3_BY_GROUP: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 1.1, // hospitais, quartéis, comunicação etc.
  2: 1.0, // residências, hotéis, comércio, indústria (alto fator de ocupação)
  3: 0.95, // indústria com baixo fator de ocupação
  4: 0.88, // vedações
  5: 0.83, // temporárias
}

/** NBR 6123 tab. 3 — fator estatístico S3 por grupo */
export function s3Factor(group: 1 | 2 | 3 | 4 | 5): number {
  return S3_BY_GROUP[group]
}

// ---------------------------------------------------------------------------
// Ca — coeficiente de arrasto (NBR 6123 Fig. 4)
// ---------------------------------------------------------------------------

// aproximação da Fig. 4 (baixa turbulência) — usuário pode sobrescrever via caOverride
const CA_L1_L2 = [0.2, 0.5, 1, 2, 4] // relação l1/l2 (largura frontal / profundidade)
const CA_H_L1 = [0.25, 0.5, 1, 2, 6] // relação h/l1
const CA_GRID: number[][] = [
  // h/l1:  0.25  0.5   1     2     6      l1/l2:
  [0.85, 0.88, 0.92, 0.97, 1.02], // 0.2
  [0.9, 0.95, 1.0, 1.05, 1.15], // 0.5
  [0.95, 1.0, 1.1, 1.2, 1.35], // 1
  [1.0, 1.1, 1.25, 1.4, 1.55], // 2
  [1.05, 1.15, 1.3, 1.5, 1.6], // 4
]

/** localiza o trecho do eixo e o parâmetro t ∈ [0,1] — clamp fora dos limites */
function bracket(axis: number[], v: number): { i: number; t: number } {
  if (v <= axis[0]) return { i: 0, t: 0 }
  const last = axis.length - 1
  if (v >= axis[last]) return { i: last - 1, t: 1 }
  let i = 0
  while (v > axis[i + 1]) i++
  return { i, t: (v - axis[i]) / (axis[i + 1] - axis[i]) }
}

/**
 * Coeficiente de arrasto estimado da Fig. 4 da NBR 6123 (vento de baixa
 * turbulência) por interpolação bilinear em (l1/l2, h/l1), com clamp na grade.
 * l1 = largura da face ⊥ ao vento · l2 = profundidade na direção do vento.
 */
export function dragCoefficient(l1: number, l2: number, h: number): number {
  const r = bracket(CA_L1_L2, l1 / l2)
  const c = bracket(CA_H_L1, h / l1)
  const rowA = CA_GRID[r.i]
  const rowB = CA_GRID[r.i + 1]
  const caA = rowA[c.i] + c.t * (rowA[c.i + 1] - rowA[c.i])
  const caB = rowB[c.i] + c.t * (rowB[c.i + 1] - rowB[c.i])
  return caA + r.t * (caB - caA)
}

// ---------------------------------------------------------------------------
// Forças por pavimento
// ---------------------------------------------------------------------------

/** NBR 6123 §4.2c — pressão dinâmica q = 0,613·Vk² [N/m²] → kN/m² */
function dynamicPressure(vk: number): number {
  return (0.613 * vk * vk) / 1000
}

/**
 * Forças de vento por pavimento nas 4 direções (X+, X−, Y+, Y−).
 * Vk = V0·S1·S2(z)·S3 · F(nível) = q(z)·Ca·(largura de fachada)·(altura tributária).
 * Vento em ±X atua na fachada de largura ly (l1 = ly, l2 = lx); em ±Y, na de
 * largura lx (l1 = lx, l2 = ly). Níveis com z ≤ 0 (fundação) não recebem força.
 */
export function computeWind(params: WindParams, geo: WindGeometry): WindDirectionLoads[] {
  if (!params.enabled) return []

  const s3 = s3Factor(params.s3Group)

  const directions: { dir: WindDirectionLoads['dir']; axis: 'x' | 'y' }[] = [
    { dir: 'XP', axis: 'x' },
    { dir: 'XN', axis: 'x' },
    { dir: 'YP', axis: 'y' },
    { dir: 'YN', axis: 'y' },
  ]

  return directions.map(({ dir, axis }) => {
    // fachada exposta ⊥ ao vento e relações da Fig. 4
    const facadeWidth = axis === 'x' ? geo.ly : geo.lx
    const l1 = facadeWidth
    const l2 = axis === 'x' ? geo.lx : geo.ly
    const ca = params.caOverride?.[axis] ?? dragCoefficient(l1, l2, geo.totalHeight)

    const perLevel: WindLevelForce[] = []
    let totalForce = 0
    for (const level of geo.levels) {
      if (level.z <= 0) continue
      const s2 = s2Factor(level.z, params.category, params.windClass)
      const vk = params.v0 * params.s1 * s2 * s3
      const q = dynamicPressure(vk)
      const area = facadeWidth * level.tributaryHeight
      const F = q * ca * area
      perLevel.push({ levelIndex: level.levelIndex, z: level.z, F, q, area })
      totalForce += F
    }

    return { dir, ca, facadeWidth, perLevel, totalForce }
  })
}
