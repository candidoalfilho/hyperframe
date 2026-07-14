import { describe, expect, it } from 'vitest'
import { analyzeSlabGrid, buildGridMesh, solveGrid } from '../src/analysis/grid'
import type { Vec2 } from '../src/model/types'

const E = 25_000_000 // kPa
const rect = (lx: number, ly: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: lx, y: 0 },
  { x: lx, y: ly },
  { x: 0, y: ly },
]

describe('grelha — faixa unidirecional (âncora exata de viga)', () => {
  // retângulo 6×3 apoiado só nas bordas x=0 (índice 3) e x=6 (índice 1):
  // flexão cilíndrica → cada faixa é uma viga biapoiada de 6 m
  const t = 0.15
  const q = 10
  const L = 6
  const out = analyzeSlabGrid({
    polygon: rect(L, 3),
    supportedEdges: [1, 3],
    thickness: t,
    e: E,
    q,
    targetSpacing: 0.25,
  })

  it('flecha central = 5qL⁴/(384EI) por metro de faixa', () => {
    const I = t ** 3 / 12
    const wExact = (5 * q * L ** 4) / (384 * E * I)
    expect(out.result.wMax).toBeGreaterThan(0.97 * wExact)
    expect(out.result.wMax).toBeLessThan(1.03 * wExact)
  })

  it('momento máximo no vão ≈ qL²/8 por metro', () => {
    const mExact = (q * L * L) / 8 // 45 kN·m/m
    expect(out.result.mxSpanMax).toBeGreaterThan(0.95 * mExact)
    expect(out.result.mxSpanMax).toBeLessThan(1.05 * mExact)
    // direção transversal não trabalha
    expect(out.result.mySpanMax).toBeLessThan(0.1 * mExact)
  })

  it('reações se dividem meio a meio entre as duas bordas', () => {
    const total = q * L * 3
    expect(out.result.totalReaction).toBeCloseTo(total, 1)
    expect(out.edgeShares.get(1)!).toBeCloseTo(0.5, 2)
    expect(out.edgeShares.get(3)!).toBeCloseTo(0.5, 2)
  })
})

describe('grelha — placa quadrada simplesmente apoiada (Timoshenko)', () => {
  // w_max = 0,00406·q·a⁴/D; analogia de grelha ≈ placa com ν=0 → D = Et³/12
  const a = 4
  const t = 0.12
  const q = 5
  const out = analyzeSlabGrid({
    polygon: rect(a, a),
    supportedEdges: [0, 1, 2, 3],
    thickness: t,
    e: E,
    q,
    targetSpacing: 0.25,
  })

  it('flecha central na faixa da solução de placa (±12%)', () => {
    const D = (E * t ** 3) / 12
    const wPlate = (0.00406 * q * a ** 4) / D
    expect(out.result.wMax).toBeGreaterThan(0.88 * wPlate)
    expect(out.result.wMax).toBeLessThan(1.12 * wPlate)
  })

  it('momentos iguais nas duas direções (simetria) e conservação', () => {
    expect(out.result.mxSpanMax).toBeCloseTo(out.result.mySpanMax, 1)
    expect(out.result.totalReaction).toBeCloseTo(q * a * a, 1)
    // 4 bordas ≈ 25% cada
    for (const e of [0, 1, 2, 3]) {
      expect(out.edgeShares.get(e)!).toBeGreaterThan(0.2)
      expect(out.edgeShares.get(e)!).toBeLessThan(0.3)
    }
  })
})

describe('grelha — furos e lajes lisas', () => {
  it('furo remove nós e a carga total cai de acordo', () => {
    const out = analyzeSlabGrid({
      polygon: rect(6, 6),
      holes: [
        [
          { x: 2.5, y: 2.5 },
          { x: 3.5, y: 2.5 },
          { x: 3.5, y: 3.5 },
          { x: 2.5, y: 3.5 },
        ],
      ],
      supportedEdges: [0, 1, 2, 3],
      thickness: 0.12,
      e: E,
      q: 5,
      targetSpacing: 0.25,
    })
    const gross = 5 * 36
    expect(out.result.totalReaction).toBeLessThan(gross)
    expect(out.result.totalReaction).toBeGreaterThan(0.9 * gross - 5 * 1.0 /* furo 1 m² */ - 2)
  })

  it('laje lisa: 4 pilares internos carregam tudo (¼ cada por simetria)', () => {
    const out = analyzeSlabGrid({
      polygon: rect(6, 6),
      supportedEdges: [], // NENHUMA viga — cogumelo puro
      interiorColumns: [
        { id: 'c1', pos: { x: 1.5, y: 1.5 } },
        { id: 'c2', pos: { x: 4.5, y: 1.5 } },
        { id: 'c3', pos: { x: 4.5, y: 4.5 } },
        { id: 'c4', pos: { x: 1.5, y: 4.5 } },
      ],
      thickness: 0.18,
      e: E,
      q: 8,
      targetSpacing: 0.25,
    })
    const total = 8 * 36
    expect(out.result.totalReaction).toBeCloseTo(total, 0)
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      expect(out.columnLoads.get(id)!).toBeGreaterThan(0.23 * total)
      expect(out.columnLoads.get(id)!).toBeLessThan(0.27 * total)
    }
    // momento negativo sobre o pilar maior que o positivo no vão (cogumelo)
    expect(out.result.mxSupportMax).toBeGreaterThan(out.result.mxSpanMax)
  })
})

describe('grelha — malha', () => {
  it('malha respeita contorno e marca apoios nas bordas certas', () => {
    const model = buildGridMesh({
      polygon: rect(4, 2),
      supportedEdges: [0, 2],
      targetSpacing: 0.5,
    })
    expect(model.nodes.length).toBeGreaterThan(20)
    const supports = model.nodes.filter((n) => n.support)
    expect(supports.length).toBeGreaterThan(0)
    for (const s of supports) {
      expect(Math.min(Math.abs(s.y - 0), Math.abs(s.y - 2))).toBeLessThan(0.3)
    }
  })

  it('mecanismo (placa sem apoio) é rejeitado com erro claro de matriz singular', () => {
    const model = buildGridMesh({ polygon: rect(2, 2), supportedEdges: [], targetSpacing: 0.5 })
    expect(() => solveGrid({ model, thickness: 0.1, e: E, q: 1 })).toThrow(/apoio|singular/i)
  })
})
