import { describe, expect, it } from 'vitest'
import {
  assignSlabLoads,
  distributeSlabLoads,
  joistExtraEffects,
  sampleSlabLoad,
  slabConcentratedEffects,
  slabLoadG,
  slabLoadTotal,
  SLAB_LOAD_MESH,
} from '../src/analysis/slabLoads'
import { buildGridMesh, solveGridCases, spreadPointLoad } from '../src/analysis/grid'
import { WALL_CALC_DEFAULTS } from '../src/model/presets'
import type { FloorPlan, Slab, SlabLoad } from '../src/model/types'

/** issue #8 — cargas concentradas e lineares sobre lajes */

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
const slab = (id: string, polygon: { x: number; y: number }[]): Slab =>
  ({ id, name: id.toUpperCase(), polygon, thickness: 0.12, finishLoad: 1, liveLoad: 2 }) as Slab
const point = (id: string, x: number, y: number, g: number, q = 0): SlabLoad => ({
  id,
  name: id,
  kind: 'point',
  a: { x, y },
  g,
  q,
})
const line = (id: string, a: [number, number], b: [number, number], g: number, q = 0): SlabLoad => ({
  id,
  name: id,
  kind: 'line',
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  g,
  q,
})
const sumBy = (rs: { edgeIndex: number | null; g: number }[], e: number) =>
  rs.filter((r) => r.edgeIndex === e).reduce((s, r) => s + r.g, 0)

describe('discretização e atribuição às lajes', () => {
  it('linha vira forças que somam w·L; pontual é uma força só', () => {
    const l = line('w', [0, 0], [3, 4], 6, 1.5) // 5 m
    const s = sampleSlabLoad(l)
    expect(s.length).toBe(50)
    expect(s.reduce((a, x) => a + x.g, 0)).toBeCloseTo(30, 9)
    expect(s.reduce((a, x) => a + x.q, 0)).toBeCloseTo(7.5, 9)
    expect(slabLoadTotal(l)).toEqual({ g: 30, q: 7.5 })
    expect(sampleSlabLoad(point('p', 1, 1, 12, 3))).toEqual([
      { loadId: 'p', pos: { x: 1, y: 1 }, g: 12, q: 3 },
    ])
  })

  it('parede pela composição: g = (e·γ + faces·e_rev·γ_rev)·h', () => {
    const l: SlabLoad = { ...line('w', [0, 0], [4, 0], 0), calc: { ...WALL_CALC_DEFAULTS } }
    const c = WALL_CALC_DEFAULTS
    const esperado =
      (c.thickness * c.unitWeight + c.coatingFaces * c.coatingThickness * c.coatingUnitWeight) *
      c.height
    expect(slabLoadG(l)).toBeCloseTo(esperado, 9)
  })

  it('linha que cruza duas lajes é repartida; o que cai fora é contabilizado', () => {
    const plan = {
      slabs: [slab('l1', rect(0, 0, 4, 4)), slab('l2', rect(4, 0, 8, 4))],
      slabLoads: [line('w', [1, 2], [7, 2], 5), point('fora', 20, 20, 9), point('dentro', 6, 1, 4)],
    } as unknown as FloorPlan
    const a = assignSlabLoads(plan)
    const tot = (id: string) => (a.bySlab.get(id) ?? []).reduce((s, x) => s + x.g, 0)
    expect(tot('l1')).toBeCloseTo(15, 6) // 3 m × 5
    expect(tot('l2')).toBeCloseTo(15 + 4, 6)
    expect(a.outside.get('fora')).toEqual({ g: 9, q: 0 })
    expect(a.outside.has('w')).toBe(false)
  })

  it('carga sobre abertura não é atribuída', () => {
    const plan = { slabs: [slab('l1', rect(0, 0, 4, 4))], slabLoads: [point('p', 2, 2, 7)] } as unknown as FloorPlan
    const a = assignSlabLoads(plan, () => [rect(1.5, 1.5, 2.5, 2.5)])
    expect(a.bySlab.size).toBe(0)
    expect(a.outside.get('p')!.g).toBe(7)
  })
})

describe('grelha com forças concentradas', () => {
  it('a força é repartida entre os nós da célula e conservada', () => {
    const m = buildGridMesh({ polygon: rect(0, 0, 4, 4), supportedEdges: [0, 1, 2, 3], targetSpacing: 0.5 })
    const sp = spreadPointLoad(m, 1.1, 2.3)
    expect(sp.length).toBe(4)
    expect(sp.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 12)
    // centro de gravidade dos pesos = ponto de aplicação
    expect(sp.reduce((s, x) => s + x.weight * m.nodes[x.node].x, 0)).toBeCloseTo(1.1, 9)
    expect(sp.reduce((s, x) => s + x.weight * m.nodes[x.node].y, 0)).toBeCloseTo(2.3, 9)
    // exatamente sobre um nó: tudo nele
    expect(spreadPointLoad(m, 1.5, 2).filter((x) => x.weight > 1e-9).length).toBe(1)
  })

  it('placa quadrada apoiada com força central: Σ reações = P e flecha de Timoshenko', () => {
    const a = 4
    const t = 0.12
    const E = 25e6
    const P = 10
    const m = buildGridMesh({ polygon: rect(0, 0, a, a), supportedEdges: [0, 1, 2, 3], targetSpacing: SLAB_LOAD_MESH })
    const [r] = solveGridCases(m, t, E, [{ q: 0, points: [{ x: 2, y: 2, p: P }] }])
    expect(r.totalReaction).toBeCloseTo(P, 6)
    // w = 0,0116·P·a²/D (Timoshenko, placa apoiada, carga central) — analogia: ±12%
    const D = (E * t ** 3) / 12
    const wRef = (0.0116 * P * a * a) / D
    expect(r.wMax / wRef).toBeGreaterThan(0.88)
    expect(r.wMax / wRef).toBeLessThan(1.12)
  })

  it('faixa unidirecional com linha a 1/4 do vão: reações 3/4 e 1/4 (estática)', () => {
    // 4 × 2 m apoiada só nas bordas x = 0 (3) e x = 4 (1); 10 kN/m × 2 m em x = 1
    const d = distributeSlabLoads({
      polygon: rect(0, 0, 4, 2),
      supportedEdges: [1, 3],
      thickness: 0.12,
      samples: sampleSlabLoad(line('w', [1, 0], [1, 2], 10)),
    })
    expect(d.method).toBe('grelha')
    expect(sumBy(d.reactions, 3)).toBeCloseTo(15, 6)
    expect(sumBy(d.reactions, 1)).toBeCloseTo(5, 6)
    expect(d.lostG).toBeCloseTo(0, 9)
  })

  it('placa apoiada nas 4 bordas, força no centro: 1/4 por borda', () => {
    const d = distributeSlabLoads({
      polygon: rect(0, 0, 4, 4),
      supportedEdges: [0, 1, 2, 3],
      thickness: 0.12,
      samples: sampleSlabLoad(point('p', 2, 2, 20, 8)),
    })
    for (const e of [0, 1, 2, 3]) expect(sumBy(d.reactions, e)).toBeCloseTo(5, 6)
    expect(d.reactions.reduce((s, r) => s + r.q, 0)).toBeCloseTo(8, 6)
  })

  it('força perto de uma borda carrega principalmente essa borda', () => {
    const d = distributeSlabLoads({
      polygon: rect(0, 0, 4, 4),
      supportedEdges: [0, 1, 2, 3],
      thickness: 0.12,
      samples: sampleSlabLoad(point('p', 2, 0.5, 20)),
    })
    const r0 = sumBy(d.reactions, 0)
    expect(r0).toBeGreaterThan(12) // borda y = 0, a 50 cm
    expect(sumBy(d.reactions, 2)).toBeLessThan(2) // borda oposta
    expect(d.reactions.reduce((s, r) => s + r.g, 0)).toBeCloseTo(20, 6)
    // e a reação se concentra perto da projeção da carga (x ≈ 2)
    const nearLoad = d.reactions
      .filter((r) => r.edgeIndex === 0 && Math.abs(r.pos.x - 2) <= 1)
      .reduce((s, r) => s + r.g, 0)
    expect(nearLoad / r0).toBeGreaterThan(0.8)
  })
})

describe('laje unidirecional: regra da alavanca', () => {
  it('força a 1 m do apoio em vão de 4 m: 3/4 e 1/4, na posição da vigota', () => {
    const d = distributeSlabLoads({
      polygon: rect(0, 0, 4, 3),
      supportedEdges: [1, 3],
      thickness: 0.16,
      samples: sampleSlabLoad(point('p', 1, 2.2, 12)),
      oneWayAxis: 'x',
    })
    expect(d.method).toBe('unidirecional')
    expect(sumBy(d.reactions, 3)).toBeCloseTo(9, 9)
    expect(sumBy(d.reactions, 1)).toBeCloseTo(3, 9)
    for (const r of d.reactions) expect(r.pos.y).toBeCloseTo(2.2, 9)
  })

  it('só um apoio com viga: tudo nele; nenhum: carga perdida é informada', () => {
    const one = distributeSlabLoads({
      polygon: rect(0, 0, 4, 3),
      supportedEdges: [3],
      thickness: 0.16,
      samples: sampleSlabLoad(point('p', 1, 1, 12)),
      oneWayAxis: 'x',
    })
    expect(sumBy(one.reactions, 3)).toBeCloseTo(12, 9)
    const none = distributeSlabLoads({
      polygon: rect(0, 0, 4, 3),
      supportedEdges: [0, 2],
      thickness: 0.16,
      samples: sampleSlabLoad(point('p', 1, 1, 12)),
      oneWayAxis: 'x',
    })
    expect(none.reactions.length).toBe(0)
    expect(none.lostG).toBeCloseTo(12, 9)
  })

  it('esforços na vigota crítica: P·L/4 no meio; w·L²/8 com parede ao longo da vigota', () => {
    const poly = rect(0, 0, 4, 3)
    const mid = joistExtraEffects({ polygon: poly, axis: 'x', spacing: 0.42, psi2: 0.3, samples: sampleSlabLoad(point('p', 2, 1.5, 8, 4)) })!
    expect(mid.m).toBeCloseTo((12 * 4) / 4, 9)
    expect(mid.v).toBeCloseTo(6, 9)
    expect(mid.mQp).toBeCloseTo(((8 + 0.3 * 4) * 4) / 4, 9)
    expect(mid.span).toBeCloseTo(4, 9)
    expect(mid.spread).toBe(false)
    const wall = joistExtraEffects({ polygon: poly, axis: 'x', spacing: 0.42, psi2: 0.3, samples: sampleSlabLoad(line('w', [0, 1.5], [4, 1.5], 5)) })!
    expect(wall.m / ((5 * 16) / 8)).toBeGreaterThan(0.99)
    expect(wall.m / ((5 * 16) / 8)).toBeLessThan(1.001)
    expect(wall.v).toBeCloseTo(10, 6)
    expect(wall.spread).toBe(false)
  })

  it('parede perpendicular às vigotas: cada vigota recebe w × intereixo', () => {
    const poly = rect(0, 0, 4, 3)
    // parede em x = 1 de borda a borda; vigotas a cada 42 cm ⇒ P = 6 × 0,42 por vigota
    const e = joistExtraEffects({ polygon: poly, axis: 'x', spacing: 0.42, psi2: 0.3, samples: sampleSlabLoad(line('w', [1, 0], [1, 3], 6)) })!
    const p = 6 * 0.42
    expect(e.spread).toBe(true)
    // M = P·a·b/L = P × 1 × 3 / 4
    expect(e.m / ((p * 1 * 3) / 4)).toBeGreaterThan(0.99)
    expect(e.m / ((p * 1 * 3) / 4)).toBeLessThan(1.01)
    expect(e.v / ((p * 3) / 4)).toBeGreaterThan(0.99)
    expect(e.v / ((p * 3) / 4)).toBeLessThan(1.01)
  })
})

describe('amplificação p/ o dimensionamento', () => {
  const base = {
    polygon: rect(0, 0, 4, 4),
    supportedEdges: [0, 1, 2, 3],
    thickness: 0.12,
    g: 4,
    q: 2,
    psi2: 0.3,
  }
  it('sem carga concentrada: nada a amplificar', () => {
    expect(slabConcentratedEffects({ ...base, samples: [] })).toBeNull()
  })
  it('força central: kx = ky > 1 por simetria, e cresce com a força', () => {
    const k10 = slabConcentratedEffects({ ...base, samples: sampleSlabLoad(point('p', 2, 2, 10)) })!
    const k20 = slabConcentratedEffects({ ...base, samples: sampleSlabLoad(point('p', 2, 2, 20)) })!
    expect(k10.kx).toBeGreaterThan(1.2)
    expect(k10.kx).toBeCloseTo(k10.ky, 6)
    expect(k20.kx).toBeGreaterThan(k10.kx)
    expect(k10.kw).toBeGreaterThan(1)
    expect(k10.mxCombined).toBeGreaterThan(k10.mxUniform)
    // momento uniforme da grelha ≈ placa apoiada (0,0479·p·a², ν = 0,3 → 0,0368 com ν = 0): faixa larga
    expect(k10.mxUniform).toBeGreaterThan(0.03 * 6 * 16)
    expect(k10.mxUniform).toBeLessThan(0.055 * 6 * 16)
  })
  it('parede paralela a Y amplifica mais a direção X (faixas que a carregam)', () => {
    const k = slabConcentratedEffects({ ...base, samples: sampleSlabLoad(line('w', [2, 0.5], [2, 3.5], 8)) })!
    expect(k.kx).toBeGreaterThan(k.ky)
  })
})
