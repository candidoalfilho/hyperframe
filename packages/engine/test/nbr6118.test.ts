import { describe, expect, it } from 'vitest'
import { concreteProps, coverFor, fyd } from '../src/nbr/nbr6118/materials'
import { designBeamFlexure, designBeamShear, pickBars } from '../src/nbr/nbr6118/beamDesign'
import { alphaParam, gammaZ } from '../src/nbr/nbr6118/stability'
import { COVER_BY_CAA, STEEL_CA50 } from '../src/model/presets'

/** erro relativo |actual/expected − 1| */
function relErr(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1)
}

// ---------------------------------------------------------------------------
// Materiais — NBR 6118 §8.2
// ---------------------------------------------------------------------------

describe('concreteProps (NBR 6118 §8.2)', () => {
  it('C30 + granito + γc=1,4 — valores de referência', () => {
    const p = concreteProps(30_000, 'granito', 1.4)
    expect(relErr(p.fcd, 21_428.6)).toBeLessThan(1e-4)
    expect(relErr(p.fctm, 2_896.5)).toBeLessThan(1e-3) // 0,3·30^(2/3) MPa → kPa
    expect(relErr(p.fctkInf, 2_027.5)).toBeLessThan(1e-3)
    expect(relErr(p.fctd, 1_448.2)).toBeLessThan(1e-3)
    expect(relErr(p.eci, 3.06725e7)).toBeLessThan(1e-3) // αE granito = 1,0
    expect(relErr(p.ecs, 2.68384e7)).toBeLessThan(1e-3) // αi = 0,875
    expect(p.gc).toBeCloseTo(p.ecs / 2.4, 6)
    expect(p.fck).toBe(30_000)
  })

  it('αE por agregado: basalto 1,2 · granito 1,0 · calcário 0,9 · arenito 0,7', () => {
    const granito = concreteProps(30_000, 'granito', 1.4)
    expect(relErr(concreteProps(30_000, 'basalto', 1.4).eci, 1.2 * granito.eci)).toBeLessThan(1e-9)
    expect(relErr(concreteProps(30_000, 'calcario', 1.4).eci, 0.9 * granito.eci)).toBeLessThan(1e-9)
    expect(relErr(concreteProps(30_000, 'arenito', 1.4).eci, 0.7 * granito.eci)).toBeLessThan(1e-9)
  })

  it('αi capado em 1,0 (fck = 80 MPa hipotético)', () => {
    const p = concreteProps(80_000, 'granito', 1.4)
    expect(p.ecs).toBeCloseTo(p.eci, 3)
  })
})

describe('fyd / coverFor', () => {
  it('fyd CA-50 = 500000/1,15 = 434782,6 kPa', () => {
    expect(relErr(fyd(STEEL_CA50), 434_782.6)).toBeLessThan(1e-5)
  })

  it('coverFor repassa a tabela 7.2 (COVER_BY_CAA)', () => {
    expect(coverFor('I')).toEqual(COVER_BY_CAA.I)
    expect(coverFor('II')).toEqual({ slab: 0.025, beam: 0.03, column: 0.03 })
    expect(coverFor('IV').beam).toBe(0.05)
  })
})

// ---------------------------------------------------------------------------
// Flexão simples — NBR 6118 §17.2
// ---------------------------------------------------------------------------

describe('designBeamFlexure (NBR 6118 §17.2)', () => {
  const base = {
    bw: 0.2,
    h: 0.5,
    d: 0.45,
    fcd: 17_857.1, // C25/1,4
    fyd: 434_782.6, // CA-50
    fck: 25_000,
  }

  it('âncora: Md=100 kN·m, 20×50, C25 → As=5,612 cm², x/d=0,2233', () => {
    const out = designBeamFlexure({ md: 100, ...base })
    expect(relErr(out.as, 5.612e-4)).toBeLessThan(0.01) // ±1%
    expect(relErr(out.xd, 0.2233)).toBeLessThan(0.005)
    expect(out.asMin).toBeCloseTo(1.5e-4, 8) // 0,15%·bw·h (C25 ≤ C30)
    expect(out.ok).toBe(true)
    expect(out.note).toBeUndefined()
  })

  it('ρmin da tab. 17.3: interpolação por fck e clamp', () => {
    const asMinAt = (fck: number) => designBeamFlexure({ md: 100, ...base, fck }).asMin
    expect(asMinAt(20_000)).toBeCloseTo(0.0015 * 0.2 * 0.5, 9) // clamp inferior
    expect(asMinAt(35_000)).toBeCloseTo(0.00164 * 0.2 * 0.5, 9)
    expect(asMinAt(37_500)).toBeCloseTo(0.001715 * 0.2 * 0.5, 9) // meio de 35→40
    expect(asMinAt(50_000)).toBeCloseTo(0.00208 * 0.2 * 0.5, 9)
    expect(asMinAt(60_000)).toBeCloseTo(0.00208 * 0.2 * 0.5, 9) // clamp superior
  })

  it('Md ≈ 0 → as=0, ok=true, sem nota (mínimo fica a cargo do chamador)', () => {
    const out = designBeamFlexure({ md: 0.05, ...base })
    expect(out.as).toBe(0)
    expect(out.xd).toBe(0)
    expect(out.ok).toBe(true)
    expect(out.note).toBeUndefined()
    expect(out.asMin).toBeCloseTo(1.5e-4, 8)
  })

  it('x/d > 0,45 → ok=false com nota e As de melhor esforço (x=0,45d)', () => {
    const out = designBeamFlexure({ md: 300, ...base })
    expect(out.ok).toBe(false)
    expect(out.xd).toBeGreaterThan(0.45)
    expect(out.note).toBe('seção insuficiente — aumente a seção ou use armadura dupla')
    // As(melhor esforço) = Md/(fyd·(d − 0,4·0,45d)) = Md/(fyd·0,82d)
    expect(relErr(out.as, 300 / (434_782.6 * 0.82 * 0.45))).toBeLessThan(1e-6)
  })

  it('discriminante < 0 (Md muito acima da capacidade) → ok=false com nota', () => {
    const out = designBeamFlexure({ md: 500, ...base })
    expect(out.ok).toBe(false)
    expect(out.note).toBe('seção insuficiente — aumente a seção ou use armadura dupla')
    expect(relErr(out.as, 500 / (434_782.6 * 0.82 * 0.45))).toBeLessThan(1e-6)
  })
})

// ---------------------------------------------------------------------------
// Cisalhamento — NBR 6118 §17.4.2 (modelo I)
// ---------------------------------------------------------------------------

describe('designBeamShear (NBR 6118 §17.4.2 — modelo I)', () => {
  const base = {
    bw: 0.2,
    d: 0.45,
    fck: 25_000,
    fcd: 17_857.1,
    fctd: 1_282.5,
    fywd: 434_782.6,
    fctm: 2_565,
    fywk: 500_000,
  }

  it('âncora: Vd=120 kN, 20×(d=45), C25', () => {
    const out = designBeamShear({ vd: 120, ...base })
    expect(relErr(out.vrd2, 390.5)).toBeLessThan(0.005) // 0,27·0,9·fcd·bw·d
    expect(relErr(out.vc, 69.3)).toBeLessThan(0.005) // 0,6·fctd·bw·d
    expect(relErr(out.aswS, 2.879e-4)).toBeLessThan(0.01) // ±1%
    expect(relErr(out.aswSMin, 2.052e-4)).toBeLessThan(0.005) // 0,2·fctm/fywk·bw
    expect(out.sMax).toBeCloseTo(0.27, 9) // Vd ≤ 0,67·VRd2 → min(0,6d; 0,30)
    expect(out.ok).toBe(true)
  })

  it('Vd ≤ Vc → armadura calculada nula (usa a mínima)', () => {
    const out = designBeamShear({ vd: 50, ...base })
    expect(out.aswS).toBe(0)
    expect(out.ok).toBe(true)
  })

  it('fywd capado em 435 MPa', () => {
    const out = designBeamShear({ vd: 120, ...base, fywd: 500_000 })
    const expected = (120 - out.vc) / (0.9 * 0.45 * 435_000)
    expect(relErr(out.aswS, expected)).toBeLessThan(1e-9)
  })

  it('Vd > 0,67·VRd2 → sMax = min(0,3d; 0,20)', () => {
    const out = designBeamShear({ vd: 300, ...base })
    expect(out.sMax).toBeCloseTo(0.135, 9)
    expect(out.ok).toBe(true)
  })

  it('Vd > VRd2 → esmagamento da biela (ok=false)', () => {
    const out = designBeamShear({ vd: 400, ...base })
    expect(out.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Escolha de barras
// ---------------------------------------------------------------------------

describe('pickBars', () => {
  it('As=5,612 cm² em bw=20, cobrimento 3,0 cm → 3 φ 16 (menor área que cabe)', () => {
    const out = pickBars(5.612e-4, 0.2, 0.03)
    expect(out.spec).toBe('3 φ 16')
    expect(out.n).toBe(3)
    expect(out.phi).toBe(0.016)
    expect(relErr(out.asProvided, 3 * (Math.PI * 0.016 ** 2) / 4)).toBeLessThan(1e-9)
  })

  it('mínimo de 2 barras mesmo para As pequena', () => {
    const out = pickBars(0.3e-4, 0.2, 0.03) // 0,30 cm²
    expect(out.n).toBe(2)
    expect(out.spec).toBe('2 φ 6.3')
  })

  it('viga estreita força 2 camadas', () => {
    const out = pickBars(8e-4, 0.14, 0.03) // 8 cm² em bw=14
    expect(out.spec).toContain('(2 camadas)')
    expect(out.spec).toBe('4 φ 16 (2 camadas)')
    expect(out.asProvided).toBeGreaterThanOrEqual(8e-4)
  })

  it('As ≤ 0 → sem barras', () => {
    expect(pickBars(0, 0.2, 0.03)).toEqual({ spec: '—', asProvided: 0, n: 0, phi: 0 })
    expect(pickBars(-1e-4, 0.2, 0.03).spec).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// Estabilidade global — NBR 6118 §15.5
// ---------------------------------------------------------------------------

describe('gammaZ (NBR 6118 §15.5.3)', () => {
  it('M1=10000, ΔM=800 → γz=1,0870 (nós fixos)', () => {
    const r = gammaZ({ m1: 10_000, deltaM: 800 })
    expect(relErr(r.value, 1.087)).toBeLessThan(1e-3)
    expect(r.classification).toBe('nos-fixos')
  })

  it('M1=10000, ΔM=1500 → γz=1,1765 (nós móveis)', () => {
    const r = gammaZ({ m1: 10_000, deltaM: 1_500 })
    expect(relErr(r.value, 1.1765)).toBeLessThan(1e-3)
    expect(r.classification).toBe('nos-moveis')
  })

  it('γz > 1,30 → inválido (fora do campo de validade)', () => {
    const r = gammaZ({ m1: 10_000, deltaM: 2_800 }) // 1/(1−0,28) = 1,3889
    expect(r.classification).toBe('invalido')
    expect(relErr(r.value, 1.3889)).toBeLessThan(1e-3)
  })

  it('M1 ≤ 0 ou ΔM/M1 ≥ 1 → valor capado 99, inválido', () => {
    expect(gammaZ({ m1: 0, deltaM: 100 })).toEqual({ value: 99, classification: 'invalido' })
    expect(gammaZ({ m1: 100, deltaM: 100 })).toEqual({ value: 99, classification: 'invalido' })
    expect(gammaZ({ m1: 100, deltaM: 150 })).toEqual({ value: 99, classification: 'invalido' })
  })
})

describe('alphaParam (NBR 6118 §15.5.2)', () => {
  it('H=23,04 m, Nk=7000 kN, EI=4e6 kN·m² → α=0,9640, limite 0,6, não ok', () => {
    const r = alphaParam({ totalHeight: 23.04, nk: 7_000, eiEq: 4e6, n: 8 })
    expect(relErr(r.value, 0.964)).toBeLessThan(0.005) // ±0,5%
    expect(r.limit).toBe(0.6)
    expect(r.ok).toBe(false)
  })

  it('limite α1 = 0,2 + 0,1·n para n ≤ 3; 0,6 para n ≥ 4', () => {
    expect(alphaParam({ totalHeight: 3, nk: 100, eiEq: 1e6, n: 1 }).limit).toBeCloseTo(0.3, 9)
    expect(alphaParam({ totalHeight: 6, nk: 100, eiEq: 1e6, n: 2 }).limit).toBeCloseTo(0.4, 9)
    expect(alphaParam({ totalHeight: 9, nk: 100, eiEq: 1e6, n: 3 }).limit).toBeCloseTo(0.5, 9)
    expect(alphaParam({ totalHeight: 12, nk: 100, eiEq: 1e6, n: 4 }).limit).toBe(0.6)
    expect(alphaParam({ totalHeight: 30, nk: 100, eiEq: 1e6, n: 10 }).limit).toBe(0.6)
  })

  it('estrutura rígida → ok=true', () => {
    const r = alphaParam({ totalHeight: 10, nk: 1_000, eiEq: 1e7, n: 4 })
    expect(r.value).toBeCloseTo(10 * Math.sqrt(1e-4), 9) // 0,1
    expect(r.ok).toBe(true)
  })
})
