import { describe, expect, it } from 'vitest'
import { generateCombos } from '../src/nbr/nbr8681/combinations'
import type { ComboGenInput } from '../src/nbr/api'

/** entrada padrão: γ da NBR 6118 §11.7 + ψ residencial/vento (tab. 11.2) */
function baseInput(over?: Partial<ComboGenInput>): ComboGenInput {
  return {
    hasWind: true,
    gammaG: 1.4,
    gammaGFav: 1.0,
    gammaQ: 1.4,
    psiLive: { psi0: 0.5, psi1: 0.4, psi2: 0.3 },
    psiWind: { psi0: 0.6, psi1: 0.3, psi2: 0 },
    ...over,
  }
}

describe('generateCombos (NBR 8681 / NBR 6118 §11)', () => {
  it('com vento: 13 ELU + 6 ELS = 19 combinações, ids únicos', () => {
    const combos = generateCombos(baseInput())
    expect(combos).toHaveLength(19)
    expect(combos.filter((c) => c.type === 'ELU')).toHaveLength(13)
    expect(combos.filter((c) => c.type !== 'ELU')).toHaveLength(6)
    expect(new Set(combos.map((c) => c.id)).size).toBe(19)
  })

  it('sem vento: apenas ELU1 + ELS-QP + ELS-FREQ', () => {
    const combos = generateCombos(baseInput({ hasWind: false }))
    expect(combos.map((c) => c.id)).toEqual(['ELU1', 'ELS-QP', 'ELS-FREQ'])
    expect(combos.filter((c) => c.type === 'ELU')).toHaveLength(1)
  })

  it('ids esperados na ordem por grupo', () => {
    const ids = generateCombos(baseInput()).map((c) => c.id)
    expect(ids).toEqual([
      'ELU1',
      'ELU2-WXP',
      'ELU2-WXN',
      'ELU2-WYP',
      'ELU2-WYN',
      'ELU3-WXP',
      'ELU3-WXN',
      'ELU3-WYP',
      'ELU3-WYN',
      'ELU4-WXP',
      'ELU4-WXN',
      'ELU4-WYP',
      'ELU4-WYN',
      'ELS-QP',
      'ELS-FREQ',
      'ELS-V-WXP',
      'ELS-V-WXN',
      'ELS-V-WYP',
      'ELS-V-WYN',
    ])
  })

  it('fatores ELU1: 1,4G + 1,4Q', () => {
    const c = generateCombos(baseInput()).find((c) => c.id === 'ELU1')!
    expect(c.factors).toEqual({ G: 1.4, Q: 1.4 })
    expect(c.stiffness).toBe('elu')
  })

  it('ELU2 (Q principal): vento secundário com γq·ψ0w', () => {
    const c = generateCombos(baseInput()).find((c) => c.id === 'ELU2-WXP')!
    expect(c.factors.G).toBeCloseTo(1.4, 9)
    expect(c.factors.Q).toBeCloseTo(1.4, 9)
    expect(c.factors.WXP).toBeCloseTo(0.84, 9) // 1,4·0,6
    expect(c.label).toBe('ELU 2: 1,40G + 1,40Q + 0,84Wx+')
  })

  it('ELU3 (vento principal): sobrecarga secundária com γq·ψ0q', () => {
    const c = generateCombos(baseInput()).find((c) => c.id === 'ELU3-WYN')!
    expect(c.factors.G).toBeCloseTo(1.4, 9)
    expect(c.factors.WYN).toBeCloseTo(1.4, 9)
    expect(c.factors.Q).toBeCloseTo(0.7, 9) // 1,4·0,5
    expect(c.factors.WXP).toBeUndefined()
  })

  it('ELU4 (G favorável): γg=1,0, vento 1,4, sem Q', () => {
    const combos = generateCombos(baseInput())
    const elu4 = combos.filter((c) => c.id.startsWith('ELU4-'))
    expect(elu4).toHaveLength(4)
    for (const c of elu4) {
      expect(c.factors.G).toBe(1.0)
      expect(c.factors.Q).toBeUndefined()
      expect(c.stiffness).toBe('elu')
    }
    expect(elu4[0].factors.WXP).toBeCloseTo(1.4, 9)
  })

  it('ELS: QP (ψ2), FREQ (ψ1) e vento (ψ1w + ψ2q), rigidez els', () => {
    const combos = generateCombos(baseInput())
    const qp = combos.find((c) => c.id === 'ELS-QP')!
    expect(qp.type).toBe('ELS-QP')
    expect(qp.factors).toEqual({ G: 1, Q: 0.3 })

    const freq = combos.find((c) => c.id === 'ELS-FREQ')!
    expect(freq.type).toBe('ELS-FREQ')
    expect(freq.factors).toEqual({ G: 1, Q: 0.4 })

    const vento = combos.find((c) => c.id === 'ELS-V-WXP')!
    expect(vento.type).toBe('ELS-VENTO')
    expect(vento.factors.G).toBe(1)
    expect(vento.factors.WXP).toBeCloseTo(0.3, 9) // ψ1w
    expect(vento.factors.Q).toBeCloseTo(0.3, 9) // ψ2q

    for (const c of combos) {
      expect(c.stiffness).toBe(c.type === 'ELU' ? 'elu' : 'els')
    }
  })

  it('labels pt-BR com vírgula decimal e direções Wx±/Wy±', () => {
    const combos = generateCombos(baseInput())
    const byId = (id: string) => combos.find((c) => c.id === id)!
    expect(byId('ELU1').label).toBe('ELU 1: 1,40G + 1,40Q')
    expect(byId('ELU3-WXN').label).toBe('ELU 3: 1,40G + 1,40Wx− + 0,70Q')
    expect(byId('ELU4-WYP').label).toBe('ELU 4: 1,00G + 1,40Wy+')
    expect(byId('ELS-QP').label).toBe('ELS QP: G + 0,30Q')
    expect(byId('ELS-FREQ').label).toBe('ELS Freq: G + 0,40Q')
    expect(byId('ELS-V-WYN').label).toBe('ELS Vento: G + 0,30Wy− + 0,30Q')
  })
})
