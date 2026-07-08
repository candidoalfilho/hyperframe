/**
 * NBR 8681:2003 / NBR 6118:2023 §11 — combinações de ações.
 * Combinações últimas normais (ELU) e de serviço (ELS: quase permanente,
 * frequente e vento p/ deslocamentos laterais).
 */

import type { CaseId, LoadCombo } from '../../analysis/types'
import type { ComboGenInput } from '../api'

/** casos de vento e rótulos das direções */
const WIND_CASES: { caseId: CaseId; label: string }[] = [
  { caseId: 'WXP', label: 'Wx+' },
  { caseId: 'WXN', label: 'Wx−' },
  { caseId: 'WYP', label: 'Wy+' },
  { caseId: 'WYN', label: 'Wy−' },
]

/** formata fator com vírgula decimal pt-BR: 1.4 → "1,40" · 0.84 → "0,84" */
function fmt(v: number): string {
  return v.toFixed(2).replace('.', ',')
}

/**
 * Gera as combinações de cálculo:
 *  ELU (rigidez 'elu' — EI reduzido §15.7.3):
 *   1) γg·G + γq·Q
 *   2) γg·G + γq·Q + γq·ψ0w·W(dir)   — sobrecarga principal (4 direções)
 *   3) γg·G + γq·W(dir) + γq·ψ0q·Q   — vento principal (4)
 *   4) γg,fav·G + γq·W(dir)          — G favorável (4)
 *  ELS (rigidez 'els' — EI integral):
 *   QP:    G + ψ2q·Q
 *   FREQ:  G + ψ1q·Q
 *   VENTO: G + ψ1w·W(dir) + ψ2q·Q (4) — verificação de deslocamentos (tab. 13.3)
 * Sem vento: apenas ELU 1 + ELS QP + ELS FREQ.
 */
export function generateCombos(input: ComboGenInput): LoadCombo[] {
  const { hasWind, gammaG, gammaGFav, gammaQ, psiLive, psiWind } = input
  const combos: LoadCombo[] = []

  // --- ELU 1: permanente + sobrecarga ---
  combos.push({
    id: 'ELU1',
    label: `ELU 1: ${fmt(gammaG)}G + ${fmt(gammaQ)}Q`,
    type: 'ELU',
    factors: { G: gammaG, Q: gammaQ },
    stiffness: 'elu',
  })

  if (hasWind) {
    // --- ELU 2: sobrecarga principal, vento secundário (γq·ψ0w) ---
    for (const w of WIND_CASES) {
      const fWind = gammaQ * psiWind.psi0
      const factors: Partial<Record<CaseId, number>> = { G: gammaG, Q: gammaQ }
      factors[w.caseId] = fWind
      combos.push({
        id: `ELU2-${w.caseId}`,
        label: `ELU 2: ${fmt(gammaG)}G + ${fmt(gammaQ)}Q + ${fmt(fWind)}${w.label}`,
        type: 'ELU',
        factors,
        stiffness: 'elu',
      })
    }

    // --- ELU 3: vento principal, sobrecarga secundária (γq·ψ0q) ---
    for (const w of WIND_CASES) {
      const fLive = gammaQ * psiLive.psi0
      const factors: Partial<Record<CaseId, number>> = { G: gammaG, Q: fLive }
      factors[w.caseId] = gammaQ
      combos.push({
        id: `ELU3-${w.caseId}`,
        label: `ELU 3: ${fmt(gammaG)}G + ${fmt(gammaQ)}${w.label} + ${fmt(fLive)}Q`,
        type: 'ELU',
        factors,
        stiffness: 'elu',
      })
    }

    // --- ELU 4: permanente favorável (γg = 1,0) + vento ---
    for (const w of WIND_CASES) {
      const factors: Partial<Record<CaseId, number>> = { G: gammaGFav }
      factors[w.caseId] = gammaQ
      combos.push({
        id: `ELU4-${w.caseId}`,
        label: `ELU 4: ${fmt(gammaGFav)}G + ${fmt(gammaQ)}${w.label}`,
        type: 'ELU',
        factors,
        stiffness: 'elu',
      })
    }
  }

  // --- ELS quase permanente: G + ψ2q·Q ---
  combos.push({
    id: 'ELS-QP',
    label: `ELS QP: G + ${fmt(psiLive.psi2)}Q`,
    type: 'ELS-QP',
    factors: { G: 1, Q: psiLive.psi2 },
    stiffness: 'els',
  })

  // --- ELS frequente: G + ψ1q·Q ---
  combos.push({
    id: 'ELS-FREQ',
    label: `ELS Freq: G + ${fmt(psiLive.psi1)}Q`,
    type: 'ELS-FREQ',
    factors: { G: 1, Q: psiLive.psi1 },
    stiffness: 'els',
  })

  if (hasWind) {
    // --- ELS vento (drift, tab. 13.3): G + ψ1w·W + ψ2q·Q ---
    for (const w of WIND_CASES) {
      const factors: Partial<Record<CaseId, number>> = { G: 1, Q: psiLive.psi2 }
      factors[w.caseId] = psiWind.psi1
      combos.push({
        id: `ELS-V-${w.caseId}`,
        label: `ELS Vento: G + ${fmt(psiWind.psi1)}${w.label} + ${fmt(psiLive.psi2)}Q`,
        type: 'ELS-VENTO',
        factors,
        stiffness: 'els',
      })
    }
  }

  return combos
}
