import { describe, expect, it } from 'vitest'
import { designStairLanding } from '../src/nbr/nbr6118/stairs'
import { concreteProps } from '../src/nbr/nbr6118/materials'

// ---------------------------------------------------------------------------
// Escada L/U com patamar — lance 2,40 m + patamar 1,20 m (L = 3,60 m).
// h=12, e/p = 17,5/27 (θ = 32,9°, cosθ = 0,8412), rev. 1,0, γ=25, q=2,5:
//   g_lance = 0,12/0,8412·25 + 0,0875·25 + 1,0 = 6,754 → w1 = 12,96 kN/m
//   g_pat   = 3,0 + 1,0 = 4,0                          → w2 = 9,10 kN/m
//   RA = [12,96·2,4·2,4 + 9,1·1,2·0,6]/3,6 = 22,55 kN
//   x0 = RA/w1 = 1,74 m (no lance) · Mmax = 19,6 kN·m/m
// ---------------------------------------------------------------------------

const cp = concreteProps(25_000, 'granito', 1.4)
const BASE = {
  waist: 0.12,
  riser: 0.175,
  tread: 0.27,
  finish: 1.0,
  q: 2.5,
  unitWeight: 25,
  cover: 0.025,
  fck: cp.fck,
  fcd: cp.fcd,
  fyd: 434_782.6,
  fctm: cp.fctm,
  ecs: cp.ecs,
  psi2: 0.3,
}

describe('designStairLanding (escadas L/U)', () => {
  const r = designStairLanding({ ...BASE, kind: 'U', flightSpan: 2.4, landingSpan: 1.2 })

  it('âncora: Mmax = 19,6 kN·m/m no lance (x = 1,74 m), Vd = 22,6 kN/m', () => {
    expect(r.span).toBeCloseTo(3.6, 6)
    expect(r.thetaDeg).toBeCloseTo(32.9, 0)
    expect(r.md).toBeCloseTo(19.62, 1)
    expect(r.vd).toBeCloseTo(22.55, 1)
    expect(r.ok).toBe(true)
    expect(r.as).toBeGreaterThan(r.asMin)
    expect(r.spec).toMatch(/φ/)
  })

  it('nota da DOBRA (empuxo ao vazio) e do esquema contínuo', () => {
    const txt = r.notes.join(' ')
    expect(txt).toMatch(/DOBRA/i)
    expect(txt).toMatch(/empuxo ao vazio/i)
    expect(txt).toMatch(/patamar sem apoio próprio/i)
  })

  it('blondel em cm (62 ⇒ ok) e flecha calculada', () => {
    expect(r.blondel).toBeCloseTo(62, 6)
    expect(r.blondelOk).toBe(true)
    expect(r.deflection).toBeGreaterThan(0)
    expect(r.deflectionLimit).toBeCloseTo(3.6 / 250, 6)
  })

  it('patamar maior desloca o Mmax e aumenta o vão total', () => {
    const r2 = designStairLanding({ ...BASE, kind: 'L', flightSpan: 2.4, landingSpan: 2.0 })
    expect(r2.span).toBeCloseTo(4.4, 6)
    expect(r2.md).toBeGreaterThan(r.md)
    expect(r2.notes.join(' ')).toMatch(/em L/)
  })
})
