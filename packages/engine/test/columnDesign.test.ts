import { describe, expect, it } from 'vitest'
import {
  designColumnSection,
  interactionCurve,
  minimumMoment,
  placeBars,
  radialUtilization,
  slenderness,
  squashLoad,
  type BarArrangement,
  type ColumnSectionDef,
} from '../src/nbr/nbr6118/columnDesign'

// C30: fcd = 21428,6 kPa · CA-50: fyd = 434782,6 kPa
const sec: ColumnSectionDef = {
  bw: 0.25,
  h: 0.6,
  cover: 0.03,
  fcd: 21428.6,
  fyd: 434782.6,
  es: 210_000_000,
}

function arrangement(n: number, phi: number): BarArrangement {
  const positions = placeBars(sec, n, phi)!
  return {
    n,
    phi,
    positions,
    as: (n * Math.PI * phi * phi) / 4,
    spec: `${n} φ ${phi * 1000}`,
  }
}

describe('flexo-compressão oblíqua — seção', () => {
  it('posiciona barras simétricas dentro da seção', () => {
    const pos = placeBars(sec, 8, 0.016)!
    expect(pos).toHaveLength(8)
    // simetria: soma dos momentos estáticos ≈ 0
    const sx = pos.reduce((s, p) => s + p.x, 0)
    const sy = pos.reduce((s, p) => s + p.y, 0)
    expect(sx).toBeCloseTo(0, 9)
    expect(sy).toBeCloseTo(0, 9)
    for (const p of pos) {
      expect(Math.abs(p.x)).toBeLessThan(sec.bw / 2)
      expect(Math.abs(p.y)).toBeLessThan(sec.h / 2)
    }
  })

  it('carga de esmagamento bate com a fórmula fechada', () => {
    const arr = arrangement(8, 0.016)
    // NRd,max = 0,85·fcd·(Ac − As) + σs(2‰)·As, σs = min(fyd, Es·0,002) = 420 MPa
    const ac = 0.25 * 0.6
    const expected = 0.85 * 21428.6 * (ac - arr.as) + 420_000 * arr.as
    expect(squashLoad(sec, arr)).toBeCloseTo(expected, 0)
  })

  it('curva de interação é simétrica e não degenerada p/ ν moderado', () => {
    const arr = arrangement(8, 0.016)
    const nd = 0.5 * squashLoad(sec, arr)
    const curve = interactionCurve(sec, arr, nd, 24)!
    expect(curve).toHaveLength(24)
    // momento resistente máximo em torno do eixo forte > eixo fraco
    const maxMv = Math.max(...curve.map((p) => Math.abs(p.y)))
    const maxMu = Math.max(...curve.map((p) => Math.abs(p.x)))
    expect(maxMv).toBeGreaterThan(maxMu) // h > bw
    expect(maxMv).toBeGreaterThan(50) // ordem de grandeza: dezenas de kN·m
    // simetria de seção simétrica: capacidade +v ≈ capacidade −v
    const capPlus = radialUtilization(curve, 0, 1)
    const capMinus = radialUtilization(curve, 0, -1)
    expect(capPlus).toBeCloseTo(capMinus, 2)
  })

  it('utilização cresce com o momento e detecta ponto fora da curva', () => {
    const arr = arrangement(8, 0.016)
    const nd = 1000
    const curve = interactionCurve(sec, arr, nd, 24)!
    const u1 = radialUtilization(curve, 0, 20)
    const u2 = radialUtilization(curve, 0, 40)
    expect(u2).toBeCloseTo(2 * u1, 5) // razão radial é linear no momento
    const uHuge = radialUtilization(curve, 0, 100000)
    expect(uHuge).toBeGreaterThan(1)
  })

  it('Nd acima do esmagamento → curva nula', () => {
    const arr = arrangement(4, 0.0125)
    expect(interactionCurve(sec, arr, squashLoad(sec, arr) * 1.01)).toBeNull()
  })
})

describe('esbeltez (pilar-padrão)', () => {
  it('λ e λ1 conforme fórmulas', () => {
    // le=2,88, h=0,25 → λ = 3,464·2,88/0,25 = 39,9
    const r = slenderness({
      le: 2.88,
      hDir: 0.25,
      nd: 800,
      ac: 0.15,
      fcd: 21428.6,
      ma: 20,
      mb: 20, // curvatura simples, αb = 1
    })
    expect(r.lambda).toBeCloseTo(39.9, 1)
    expect(r.alphaB).toBeCloseTo(1, 6)
    // e1/h = (20/800)/0,25 = 0,1 → λ1 = 25 + 1,25 = 26,25 → clampa em 35
    expect(r.lambda1).toBeCloseTo(35, 6)
    expect(r.m2).toBeGreaterThan(0) // λ > λ1 → 2ª ordem local
    expect(r.needsRigorous).toBe(false)
  })

  it('curvatura dupla reduz αb', () => {
    const r = slenderness({
      le: 2.88,
      hDir: 0.25,
      nd: 800,
      ac: 0.15,
      fcd: 21428.6,
      ma: 20,
      mb: -20,
    })
    expect(r.alphaB).toBeCloseTo(0.4, 6)
  })

  it('momento mínimo — §11.3.3.4.3', () => {
    expect(minimumMoment(1000, 0.6)).toBeCloseTo(1000 * (0.015 + 0.018), 6)
  })
})

describe('laço de dimensionamento', () => {
  it('dimensiona um pilar típico com utilização ≤ 1', () => {
    const out = designColumnSection(
      sec,
      [
        { label: 'ELU', nd: 1800, mu: 15, mv: 60 },
        { label: 'ELU vento', nd: 1200, mu: 30, mv: 90 },
      ],
      0.004 * 0.25 * 0.6,
    )
    expect(out.ok).toBe(true)
    expect(out.utilization).toBeLessThanOrEqual(1.0001)
    expect(out.arrangement!.n).toBeGreaterThanOrEqual(4)
    expect(out.rho).toBeGreaterThanOrEqual(0.004 - 1e-9)
    expect(out.stirrups.spec).toContain('c/')
  })

  it('solicitação impossível → falha com nota', () => {
    const out = designColumnSection(
      sec,
      [{ label: 'impossível', nd: 12000, mu: 500, mv: 900 }],
      0.004 * 0.25 * 0.6,
    )
    expect(out.ok).toBe(false)
    expect(out.notes.join(' ')).toContain('aumente a seção')
  })
})
