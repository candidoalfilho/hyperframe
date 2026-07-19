import { describe, expect, it } from 'vitest'
import { designDeepBeam, designCorbel } from '../src/nbr/nbr6118/deepBeam'

const MAT = { fck: 25_000, fcd: 17_857.1, fyd: 434_782.6 }

describe('designDeepBeam (§22.4)', () => {
  it('âncora CEB: l=3, h=2 biapoiada ⇒ z = 0,2·(3+4) = 1,4; Md=500 ⇒ 8,2 cm²', () => {
    const r = designDeepBeam({ span: 3, h: 2, bw: 0.2, md: 500, vd: 400, continuous: false, ...MAT })
    expect(r.isDeep).toBe(true)
    expect(r.z).toBeCloseTo(1.4, 6)
    expect(r.asTie).toBeCloseTo(500 / (1.4 * MAT.fyd), 6)
    expect(r.notes.join(' ')).toMatch(/VIGA-PAREDE/)
    expect(r.notes.join(' ')).toMatch(/ancoragem TOTAL/i)
    expect(r.asWebPerM).toBeCloseTo(2 * 0.00075 * 0.2, 9)
  })
  it('l/h < 1 usa z = 0,6·l; contínua usa limite 3 e z = 0,2·(l+1,5h)', () => {
    expect(designDeepBeam({ span: 1.5, h: 2, bw: 0.2, md: 100, vd: 100, continuous: false, ...MAT }).z).toBeCloseTo(0.9, 6)
    const c = designDeepBeam({ span: 5, h: 2, bw: 0.2, md: 100, vd: 100, continuous: true, ...MAT })
    expect(c.isDeep).toBe(true)
    expect(c.z).toBeCloseTo(0.2 * (5 + 3), 6)
  })
  it('viga comum (l/h ≥ 2 biapoiada) não é parede', () => {
    expect(designDeepBeam({ span: 5, h: 2, bw: 0.2, md: 100, vd: 100, continuous: false, ...MAT }).isDeep).toBe(false)
  })
})

describe('designCorbel (§22.5)', () => {
  it('curto (a/d = 0,6): z = 0,8d, tirante com Hd mínimo 0,2·Fd, costura 40%', () => {
    const r = designCorbel({ fd: 300, a: 0.3, d: 0.5, bw: 0.4, ...MAT })
    expect(r.kind).toBe('curto')
    // As = Fd·a/(0,8d·fyd) + 0,2Fd/fyd = 5,175 + 1,38 = 6,55 cm²
    expect(r.asTie).toBeCloseTo(6.55e-4, 4)
    expect(r.asStitch).toBeCloseTo(0.4 * r.asTie, 9)
    expect(r.ok).toBe(true)
    expect(r.notes.join(' ')).toMatch(/HORIZONTAIS/)
  })
  it('muito curto (a/d < 0,5): atrito-cisalhamento μ = 1,4', () => {
    const r = designCorbel({ fd: 300, a: 0.15, d: 0.5, bw: 0.4, ...MAT })
    expect(r.kind).toBe('muito-curto')
    expect(r.asTie).toBeCloseTo(300 / (1.4 * MAT.fyd) + 60 / MAT.fyd, 6)
  })
  it('a/d > 1 vira balanço comum', () => {
    expect(designCorbel({ fd: 100, a: 0.8, d: 0.5, bw: 0.3, ...MAT }).kind).toBe('balanco')
  })
})
