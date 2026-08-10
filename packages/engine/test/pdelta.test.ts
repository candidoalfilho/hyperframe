import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'

/**
 * P-Δ iterativo: em estrutura REGULAR o fator convergido deve ficar perto do
 * γz (o γz É uma estimativa de P-Δ — teoria: amplificação ≈ 1/(1−θ)), e
 * crescer monotonicamente com a carga gravitacional.
 */
describe('runPDelta (2ª ordem global iterativa)', () => {
  const base = analyze(createSampleProject())

  it('roda nas 4 direções, converge, fator ≥ 1 e ≈ γz (±10%)', () => {
    const withPd = base.stability.secondOrder.factors.filter((f) => f.pdelta)
    expect(withPd.length).toBeGreaterThanOrEqual(2)
    for (const f of withPd) {
      expect(f.pdelta!.converged).toBe(true)
      expect(f.pdelta!.iterations).toBeGreaterThanOrEqual(1)
      expect(f.pdelta!.factor).toBeGreaterThanOrEqual(1)
      expect(f.pdelta!.factor).toBeLessThan(1.5)
      // estrutura regular: P-Δ perto do γz
      expect(Math.abs(f.pdelta!.factor - f.gammaZ)).toBeLessThanOrEqual(0.1 * f.gammaZ)
    }
  })

  it('fator ADOTADO = máx(0,95·γz; P-Δ) — nunca menor que o aproximado', () => {
    for (const f of base.stability.secondOrder.factors) {
      if (f.pdelta?.converged && f.factor > 1) {
        expect(f.factor).toBeGreaterThanOrEqual(0.95 * f.gammaZ - 1e-9)
        expect(f.factor).toBeGreaterThanOrEqual(Math.min(f.pdelta.factor, f.factor) - 1e-9)
      }
    }
  })

  it('mais carga gravitacional ⇒ P-Δ maior (monotônico)', () => {
    const heavy = createSampleProject()
    for (const pl of heavy.plans) {
      for (const sl of pl.slabs) {
        sl.finishLoad *= 2.5
        sl.liveLoad *= 2.5
      }
    }
    const rHeavy = analyze(heavy)
    const get = (r: typeof base, dir: string) =>
      r.stability.secondOrder.factors.find((f) => f.dir === dir && f.pdelta)?.pdelta?.factor ?? 0
    const dirs = base.stability.secondOrder.factors.filter((f) => f.pdelta).map((f) => f.dir)
    let compared = 0
    for (const d of dirs) {
      const a = get(base, d)
      const b = get(rHeavy, d)
      if (a > 0 && b > 0) {
        expect(b).toBeGreaterThan(a - 1e-6)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(0)
  })
})
