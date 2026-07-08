/**
 * NBR 6118:2023 §15 — estabilidade global de edifícios:
 * coeficiente γz (§15.5.3) e parâmetro de instabilidade α (§15.5.2).
 */

import type { AlphaInput, GammaZInput } from '../api'

/**
 * NBR 6118 §15.5.3 — γz = 1/(1 − ΔM,tot,d/M1,tot,d).
 * Classificação: γz ≤ 1,10 → nós fixos; 1,10 < γz ≤ 1,30 → nós móveis
 * (válido p/ majoração 0,95·γz); γz > 1,30 → fora do campo de validade.
 * Se M1 ≤ 0 ou ΔM/M1 ≥ 1 a estrutura é instável pelo modelo → valor capado em 99.
 */
export function gammaZ(input: GammaZInput): {
  value: number
  classification: 'nos-fixos' | 'nos-moveis' | 'invalido'
} {
  const { m1, deltaM } = input
  if (m1 <= 0) return { value: 99, classification: 'invalido' }
  const ratio = deltaM / m1
  if (ratio >= 1) return { value: 99, classification: 'invalido' }
  const value = 1 / (1 - ratio)
  const classification = value <= 1.1 ? 'nos-fixos' : value <= 1.3 ? 'nos-moveis' : 'invalido'
  return { value, classification }
}

/**
 * NBR 6118 §15.5.2 — parâmetro de instabilidade:
 *   α = Htot·√(Nk/EIeq)
 * Limite α1 = 0,2 + 0,1·n para n ≤ 3; α1 = 0,6 para n ≥ 4
 * (contraventamento por pórticos). ok = α ≤ α1 (nós fixos).
 */
export function alphaParam(input: AlphaInput): { value: number; limit: number; ok: boolean } {
  const { totalHeight, nk, eiEq, n } = input
  const limit = n <= 3 ? 0.2 + 0.1 * n : 0.6
  const value = eiEq > 0 ? totalHeight * Math.sqrt(nk / eiEq) : Number.POSITIVE_INFINITY
  return { value, limit, ok: value <= limit }
}
