import { describe, expect, it } from 'vitest'
import { computeWind, dragCoefficient, s2Factor, s3Factor } from '../src/nbr/nbr6123/wind'
import type { WindGeometry } from '../src/nbr/api'
import type { WindParams } from '../src/model/types'

/** erro relativo |actual/expected − 1| */
function relErr(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1)
}

// ---------------------------------------------------------------------------
// S2 — tabela 1
// ---------------------------------------------------------------------------

describe('s2Factor (NBR 6123 tab. 1)', () => {
  it('âncora: categoria IV, classe B, z=23 m → S2=0,9244', () => {
    expect(relErr(s2Factor(23, 4, 'B'), 0.9244)).toBeLessThan(0.003) // ±0,3%
  })

  it('z=10 m → S2 = b·Fr (expoente anula)', () => {
    expect(s2Factor(10, 1, 'A')).toBeCloseTo(1.1 * 1.0, 9) // b=1,10, Fr=1,00
    expect(s2Factor(10, 2, 'B')).toBeCloseTo(1.0 * 0.98, 9)
    expect(s2Factor(10, 2, 'C')).toBeCloseTo(1.0 * 0.95, 9) // Fr da classe sempre aplicado
    expect(s2Factor(10, 5, 'C')).toBeCloseTo(0.71 * 0.95, 9)
  })

  it('S2 cresce com z e decresce com a rugosidade (categoria)', () => {
    expect(s2Factor(50, 4, 'B')).toBeGreaterThan(s2Factor(10, 4, 'B'))
    expect(s2Factor(20, 1, 'B')).toBeGreaterThan(s2Factor(20, 3, 'B'))
    expect(s2Factor(20, 3, 'B')).toBeGreaterThan(s2Factor(20, 5, 'B'))
  })
})

describe('s3Factor (NBR 6123 tab. 3)', () => {
  it('valores por grupo', () => {
    expect(s3Factor(1)).toBe(1.1)
    expect(s3Factor(2)).toBe(1.0)
    expect(s3Factor(3)).toBe(0.95)
    expect(s3Factor(4)).toBe(0.88)
    expect(s3Factor(5)).toBe(0.83)
  })
})

// ---------------------------------------------------------------------------
// Ca — aproximação da Fig. 4
// ---------------------------------------------------------------------------

describe('dragCoefficient (Fig. 4 digitalizada da NBR 6123)', () => {
  it('nós exatos da grade digitalizada', () => {
    expect(dragCoefficient(10, 10, 10)).toBeCloseTo(1.14, 9) // l1/l2=1, h/l1=1 (cubo≈1,1)
    expect(dragCoefficient(10, 50, 5)).toBeCloseTo(0.7, 9) // l1/l2=0,2, h/l1=0,5 (piso da figura)
    expect(dragCoefficient(40, 10, 240)).toBeCloseTo(1.6, 9) // l1/l2=4, h/l1=6
    expect(dragCoefficient(20, 10, 400)).toBeCloseTo(1.9, 9) // l1/l2=2, h/l1=20 — lâmina alta
    expect(dragCoefficient(30, 10, 1200)).toBeCloseTo(2.2, 9) // l1/l2=3, h/l1=40 — teto da figura
  })

  it('âncoras clássicas de literatura (leitura da figura, ±0,05)', () => {
    // edifício 20×10, h=30, vento na face larga: l1/l2=2, h/l1=1,5 → Ca ≈ 1,3
    const ca = dragCoefficient(20, 10, 30)
    expect(ca).toBeGreaterThan(1.25)
    expect(ca).toBeLessThan(1.38)
    // torre quadrada esbelta h/l1=10: Ca ≈ 1,35
    const torre = dragCoefficient(10, 10, 100)
    expect(torre).toBeGreaterThan(1.3)
    expect(torre).toBeLessThan(1.45)
  })

  it('interpolação LOG-bilinear (eixos da figura são logarítmicos)', () => {
    // h/l1 = √(1·2) = 1,414… fica no MEIO do trecho log 1→2 da coluna
    const mid = dragCoefficient(10, 10, Math.sqrt(2) * 10)
    expect(mid).toBeCloseTo((1.14 + 1.25) / 2, 6)
  })

  it('a favor da segurança nos extremos: teto 2,2 e piso 0,7 (contorno da figura)', () => {
    expect(dragCoefficient(40, 10, 2000)).toBeLessThanOrEqual(2.2 + 1e-9)
    expect(dragCoefficient(2, 10, 100)).toBeGreaterThanOrEqual(0.7 - 1e-9)
    // clamp fora dos limites
    expect(dragCoefficient(80, 10, 20)).toBeCloseTo(1.26, 9) // l1/l2=8→4, h/l1→0,5
    expect(dragCoefficient(10, 10, 500)).toBeCloseTo(1.9, 9) // h/l1=50→40, l1/l2=1
  })

  it('monotônico: mais alto ⇒ Ca maior; face mais larga ⇒ Ca maior', () => {
    for (const r of [0.3, 0.6, 1, 2, 4]) {
      let prev = 0
      for (const h of [0.5, 1, 2, 4, 6, 10, 20]) {
        const ca = dragCoefficient(10 * r, 10, 10 * r * h)
        expect(ca).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = ca
      }
    }
    for (const h of [1, 2, 6, 20]) {
      let prev = 0
      for (const r of [0.2, 0.4, 0.8, 1.5, 3]) {
        const ca = dragCoefficient(10 * r, 10, 10 * r * h)
        expect(ca).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = ca
      }
    }
  })
})

// ---------------------------------------------------------------------------
// computeWind — forças por pavimento
// ---------------------------------------------------------------------------

/** edifício exemplo: 12,5 × 9,0 m em planta, 8 pav. de 2,88 m (topo 23,04 m) */
function sampleGeo(): WindGeometry {
  const levels = []
  for (let i = 1; i <= 8; i++) {
    levels.push({ levelIndex: i, z: 2.88 * i, tributaryHeight: 2.88 })
  }
  return { lx: 12.5, ly: 9, totalHeight: 23.04, levels }
}

function sampleParams(over?: Partial<WindParams>): WindParams {
  return {
    enabled: true,
    v0: 40,
    s1: 1,
    category: 4,
    windClass: 'B',
    s3Group: 2, // S3 = 1,00
    ...over,
  }
}

describe('computeWind (NBR 6123)', () => {
  it('âncora de pressão: V0=40, S1=S3=1, cat IV B, z=23 → q=0,8383 kPa', () => {
    const geo: WindGeometry = {
      lx: 12.5,
      ly: 9,
      totalHeight: 23,
      levels: [{ levelIndex: 1, z: 23, tributaryHeight: 2.88 }],
    }
    const loads = computeWind(sampleParams({ caOverride: { x: 1, y: 1 } }), geo)
    const xp = loads.find((l) => l.dir === 'XP')!
    expect(relErr(xp.perLevel[0].q, 0.8383)).toBeLessThan(0.005) // ±0,5%
    // F = q·Ca·largura·htrib, Ca=1, fachada ly=9
    expect(relErr(xp.perLevel[0].F, 0.8383 * 1 * 9 * 2.88)).toBeLessThan(0.005)
    expect(xp.perLevel[0].area).toBeCloseTo(9 * 2.88, 9)
  })

  it('desabilitado → sem carregamentos', () => {
    expect(computeWind(sampleParams({ enabled: false }), sampleGeo())).toEqual([])
  })

  it('4 direções; ±X iguais entre si; fachadas corretas por direção', () => {
    const loads = computeWind(sampleParams(), sampleGeo())
    expect(loads.map((l) => l.dir)).toEqual(['XP', 'XN', 'YP', 'YN'])

    const xp = loads[0]
    const xn = loads[1]
    const yp = loads[2]
    const yn = loads[3]

    expect(xp.totalForce).toBeGreaterThan(0)
    expect(xp.totalForce).toBeCloseTo(xn.totalForce, 12)
    expect(yp.totalForce).toBeCloseTo(yn.totalForce, 12)

    // vento em ±X atinge a fachada de largura ly; em ±Y a de largura lx
    expect(xp.facadeWidth).toBe(9)
    expect(yp.facadeWidth).toBe(12.5)

    // Ca da Fig. 4 com (l1, l2) trocados por direção
    expect(xp.ca).toBeCloseTo(dragCoefficient(9, 12.5, 23.04), 9)
    expect(yp.ca).toBeCloseTo(dragCoefficient(12.5, 9, 23.04), 9)
  })

  it('força cresce com a cota (S2 monotônico) e todos os 8 níveis recebem força', () => {
    const loads = computeWind(sampleParams(), sampleGeo())
    for (const dir of loads) {
      expect(dir.perLevel).toHaveLength(8)
      for (let i = 1; i < dir.perLevel.length; i++) {
        expect(dir.perLevel[i].F).toBeGreaterThan(dir.perLevel[i - 1].F)
        expect(dir.perLevel[i].z).toBeGreaterThan(dir.perLevel[i - 1].z)
      }
      expect(dir.totalForce).toBeCloseTo(
        dir.perLevel.reduce((s, l) => s + l.F, 0),
        9,
      )
    }
  })

  it('nível na cota z=0 (fundação) não recebe força', () => {
    const geo = sampleGeo()
    geo.levels.unshift({ levelIndex: 0, z: 0, tributaryHeight: 1.44 })
    const loads = computeWind(sampleParams(), geo)
    expect(loads[0].perLevel).toHaveLength(8)
    expect(loads[0].perLevel[0].z).toBeCloseTo(2.88, 9)
  })

  it('caOverride substitui o Ca estimado apenas na direção correspondente', () => {
    const loads = computeWind(sampleParams({ caOverride: { x: 1.3 } }), sampleGeo())
    expect(loads[0].ca).toBe(1.3) // XP
    expect(loads[1].ca).toBe(1.3) // XN
    expect(loads[2].ca).toBeCloseTo(dragCoefficient(12.5, 9, 23.04), 9) // YP estimado
  })
})
