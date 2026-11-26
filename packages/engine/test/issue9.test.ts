import { describe, expect, it } from 'vitest'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { polygonArea } from '../src/geometry/geometry'
import {
  beamKey,
  columnKey,
  computeLoadPath,
  foundationKey,
  loadPathOptions,
  slabKey,
  traceLoadPath,
  tributaryPolygons,
  type LoadPath,
} from '../src/analysis/loadPath'
import type { Project, Slab, SlabLoad, Vec2 } from '../src/model/types'

/** issue #9 — caminho das cargas: lajes → vigas → pilares → fundações */

const base = (floors = 1): Project => {
  const p = createEmptyProject({
    name: 't',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: floors,
    floorHeight: 3,
    wind: { enabled: false, v0: 30, s1: 1, category: 4, s3Group: 2 },
  })
  p.settings.notionalImperfections = false
  return p
}
const slab = (id: string, name: string, polygon: Vec2[], extra: Partial<Slab> = {}): Slab => ({
  id,
  name,
  polygon: polygon.map((q) => ({ ...q })),
  thickness: 0.12,
  finishLoad: 1,
  liveLoad: 2,
  liveLoadLabel: 'x',
  ...extra,
})

/** 1 painel a × b: 4 pilares 20×20, 4 vigas 15×40, laje maciça h = 12 */
const panel = (a: number, b: number, mut?: (p: Project) => void): Project => {
  const p = base()
  const lo = p.levels[0]
  const top = p.levels[p.levels.length - 1]
  const pts = [
    { x: 0, y: 0 },
    { x: a, y: 0 },
    { x: a, y: b },
    { x: 0, y: b },
  ]
  p.columns = pts.map((pos, i) => ({
    id: `c${i}`,
    name: `P${i + 1}`,
    pos,
    section: { bw: 0.2, h: 0.2 },
    rotationDeg: 0 as const,
    baseLevelId: lo.id,
    topLevelId: top.id,
  }))
  p.plans[0].beams = pts.map((q, i) => ({
    id: `b${i}`,
    name: `V${i + 1}`,
    path: [q, pts[(i + 1) % 4]],
    section: { bw: 0.15, h: 0.4 },
  }))
  p.plans[0].slabs = [slab('s', 'L1', pts)]
  mut?.(p)
  return p
}
const G = { label: 'G', factors: { G: 1 }, stiffness: 'els' as const }
const GQ = { label: 'G+Q', factors: { G: 1, Q: 1 }, stiffness: 'els' as const }
const el = (lp: LoadPath, key: string) => {
  const e = lp.elements.find((x) => x.key === key)
  if (!e) throw new Error(`sem elemento ${key}`)
  return e
}
const flow = (lp: LoadPath, from: string, to: string) =>
  lp.flows.filter((f) => f.from === from && f.to === to).reduce((s, f) => s + f.value, 0)

/** invariantes que valem para qualquer modelo, caso ou combinação */
const expectConsistent = (lp: LoadPath, tol = 1e-6) => {
  const scale = Math.max(1, Math.abs(lp.check.applied))
  expect(lp.check.residual).toBeLessThan(tol * scale)
  expect(Math.abs(lp.check.applied - lp.check.reactions)).toBeLessThan(tol * scale)
  for (const f of lp.flows) expect(f.value).toBeGreaterThan(0)
  for (const e of lp.elements) {
    // nada some nem aparece: próprio + recebido = entregue (fundação e solo só recebem)
    if (e.kind === 'beam' || e.kind === 'slab' || e.kind === 'direct' || e.kind === 'column')
      expect(Math.abs(e.own + e.received - e.delivered)).toBeLessThan(tol * scale)
  }
  let fdn = 0
  for (const e of lp.elements) if (e.kind === 'foundation' || e.kind === 'soil') fdn += e.received - e.delivered
  expect(Math.abs(fdn - lp.check.reactions)).toBeLessThan(tol * scale)
  for (const c of lp.columns) {
    c.steps.forEach((s, i) => {
      expect(Math.abs(s.fromAbove + s.fromBeams + s.fromSlabs + s.own - s.nBase)).toBeLessThan(tol * scale)
      if (i > 0) expect(Math.abs(s.fromAbove - c.steps[i - 1].nBase)).toBeLessThan(tol * scale)
    })
    // a fundação recebe o pilar e, se houver, os baldrames que chegam ao apoio
    const f = lp.elements.find((e) => e.key === foundationKey(c.columnId))
    if (c.foundation !== null && f) expect(Math.abs(c.foundation - (f.received - f.delivered))).toBeLessThan(tol * scale)
  }
}

describe('painel isolado 4 × 6 m — contas à mão', () => {
  // laje: g = 0,12·25 + 1 = 4 kN/m² · q = 2 kN/m²
  // charneiras a 45°: triângulos de 4²/4 = 4 m² nos lados de 4 m e trapézios de
  // 4·(2·6 − 4)/4 = 8 m² nos de 6 m
  // vigas 15×40: 1,5 kN/m · pilares 20×20×3 m: 3 kN
  const p = panel(4, 6)
  const r = analyze(p)
  const lp = computeLoadPath(p, r, G)

  it('quinhões por borda: triângulo no lado menor, trapézio no maior', () => {
    const edges = lp.slabEdges
    expect(edges).toHaveLength(4)
    // borda 0 e 2 = 4 m; 1 e 3 = 6 m
    for (const e of [0, 2]) {
      expect(edges[e].value).toBeCloseTo(16, 6)
      expect(edges[e].perMeter).toBeCloseTo(4, 6)
      expect(edges[e].polygon).toHaveLength(3)
      expect(polygonArea(edges[e].polygon)).toBeCloseTo(4, 9)
    }
    for (const e of [1, 3]) {
      expect(edges[e].value).toBeCloseTo(32, 6)
      expect(edges[e].perMeter).toBeCloseTo(32 / 6, 6)
      expect(edges[e].polygon).toHaveLength(4)
      expect(polygonArea(edges[e].polygon)).toBeCloseTo(8, 9)
    }
    expect(edges.every((e) => e.exact && e.supported)).toBe(true)
    expect(edges[0].beamKeys).toEqual([beamKey(1, 'b0')])
  })

  it('laje entrega tudo o que carrega', () => {
    const s = el(lp, slabKey(1, 's'))
    expect(s.own).toBeCloseTo(96, 6)
    expect(s.delivered).toBeCloseTo(96, 6)
    expect(s.lost).toBeUndefined()
  })

  it('vigas: peso próprio + laje, metade para cada pilar', () => {
    const v1 = el(lp, beamKey(1, 'b0')) // 4 m
    expect(v1.parts).toEqual([{ label: 'Peso próprio', value: expect.closeTo(6, 6) }])
    expect(v1.received).toBeCloseTo(16, 6)
    expect(v1.delivered).toBeCloseTo(22, 6)
    expect(flow(lp, beamKey(1, 'b0'), columnKey('c0', 0))).toBeCloseTo(11, 4)
    expect(flow(lp, beamKey(1, 'b0'), columnKey('c1', 0))).toBeCloseTo(11, 4)
    const v2 = el(lp, beamKey(1, 'b1')) // 6 m
    expect(v2.own).toBeCloseTo(9, 6)
    expect(v2.delivered).toBeCloseTo(41, 6)
    expect(flow(lp, beamKey(1, 'b1'), columnKey('c1', 0))).toBeCloseTo(20.5, 4)
  })

  it('pilares e fundações: 11 + 20,5 das vigas + 3 de peso próprio = 34,5 kN', () => {
    expect(lp.columns).toHaveLength(4)
    for (const c of lp.columns) {
      expect(c.steps).toHaveLength(1)
      const s = c.steps[0]
      expect(s.levelName).toBe(p.levels[1].name)
      expect(s.fromAbove).toBeCloseTo(0, 9)
      expect(s.fromBeams).toBeCloseTo(31.5, 4)
      expect(s.fromSlabs).toBeCloseTo(0, 9)
      expect(s.own).toBeCloseTo(3, 6)
      expect(s.nBase).toBeCloseTo(34.5, 4)
      expect(c.foundation).toBeCloseTo(34.5, 4)
      expect(flow(lp, columnKey(c.columnId, 0), foundationKey(c.columnId))).toBeCloseTo(34.5, 4)
    }
    expect(lp.check.applied).toBeCloseTo(138, 6)
    expect(lp.check.reactions).toBeCloseTo(138, 6)
    expectConsistent(lp)
  })

  it('caso Q e combinação: superposição com os fatores', () => {
    const q = computeLoadPath(p, r, { label: 'Q', factors: { Q: 1 }, stiffness: 'els' })
    expect(q.check.applied).toBeCloseTo(48, 6) // 2 kN/m² × 24 m²
    expect(q.slabEdges[0].perMeter).toBeCloseTo(2, 6)
    for (const c of q.columns) expect(c.foundation).toBeCloseTo(12, 4)
    expectConsistent(q)
    const elu = loadPathOptions(r).find((o) => o.id === 'combo:ELU1')!
    const d = computeLoadPath(p, r, elu)
    expect(d.check.applied).toBeCloseTo(1.4 * 138 + 1.4 * 48, 6)
    expect(d.slabEdges[1].value).toBeCloseTo(1.4 * 32 + 1.4 * 16, 6)
    expectConsistent(d)
  })

  it('de onde vem e para onde vai', () => {
    const fromSlab = traceLoadPath(lp, slabKey(1, 's'))
    expect(fromSlab.up).toEqual([])
    // a laje alcança as 4 vigas, os 4 pilares e as 4 fundações
    expect(fromSlab.down).toHaveLength(12)
    const atFdn = traceLoadPath(lp, foundationKey('c0'))
    expect(atFdn.down).toEqual([])
    expect(new Set(atFdn.up)).toEqual(
      new Set([columnKey('c0', 0), beamKey(1, 'b0'), beamKey(1, 'b3'), slabKey(1, 's')]),
    )
    const atBeam = traceLoadPath(lp, beamKey(1, 'b0'))
    expect(atBeam.up).toEqual([slabKey(1, 's')])
    expect(new Set(atBeam.down)).toEqual(
      new Set([columnKey('c0', 0), columnKey('c1', 0), foundationKey('c0'), foundationKey('c1')]),
    )
  })

  it('opções: G + Q, casos e combinações', () => {
    const opts = loadPathOptions(r)
    expect(opts[0]).toMatchObject({ id: 'G+Q', group: 'Casos', factors: { G: 1, Q: 1 } })
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(['case:G', 'case:Q', 'combo:ELU1']))
    expect(opts.filter((o) => o.group === 'Combinações')).toHaveLength(r.combos.length)
  })
})

describe('viga apoiada em viga', () => {
  // painel 6 × 4 com uma viga secundária V5 no meio (x = 3), duas lajes de 3 × 4
  const p = panel(6, 4, (pr) => {
    pr.plans[0].beams.push({
      id: 'sec',
      name: 'V5',
      path: [
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ],
      section: { bw: 0.15, h: 0.4 },
    })
    pr.plans[0].slabs = [
      slab('sa', 'L1', [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ]),
      slab('sb', 'L2', [
        { x: 3, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 4 },
        { x: 3, y: 4 },
      ]),
    ]
  })
  const r = analyze(p)
  const lp = computeLoadPath(p, r, G)

  it('a secundária entrega metade a cada viga principal', () => {
    // V5: pp 1,5·4 = 6 + 2 trapézios de 3·(8 − 3)/4 = 3,75 m² × 4 kN/m² = 30 ⇒ 36 kN
    const v5 = el(lp, beamKey(1, 'sec'))
    expect(v5.own).toBeCloseTo(6, 6)
    expect(v5.received).toBeCloseTo(30, 6)
    expect(v5.delivered).toBeCloseTo(36, 6)
    expect(flow(lp, beamKey(1, 'sec'), beamKey(1, 'b0'))).toBeCloseTo(18, 3)
    expect(flow(lp, beamKey(1, 'sec'), beamKey(1, 'b2'))).toBeCloseTo(18, 3)
    // a principal V1 recebe das duas lajes (2 triângulos de 2,25 m²) e da V5
    const v1 = el(lp, beamKey(1, 'b0'))
    expect(v1.received).toBeCloseTo(2 * 2.25 * 4 + 18, 3)
    expect(v1.delivered).toBeCloseTo(9 + 18 + 18, 3)
    expectConsistent(lp)
  })

  it('o rastro da laje passa pela secundária e chega às 4 fundações', () => {
    const t = traceLoadPath(lp, slabKey(1, 'sa'))
    expect(t.down).toEqual(expect.arrayContaining([beamKey(1, 'sec'), beamKey(1, 'b0'), beamKey(1, 'b2')]))
    for (const c of ['c0', 'c1', 'c2', 'c3']) expect(t.down).toContain(foundationKey(c))
    // a V2 (x = 6) não recebe nada da L1
    expect(t.down).not.toContain(beamKey(1, 'b1'))
    const up = traceLoadPath(lp, beamKey(1, 'b0')).up
    expect(new Set(up)).toEqual(new Set([slabKey(1, 'sa'), slabKey(1, 'sb'), beamKey(1, 'sec')]))
  })
})

describe('lajes unidirecionais, grelha e sem apoio', () => {
  it('nervurada em X: só as bordas onde as nervuras apoiam recebem, meio a meio', () => {
    const p = panel(4, 6, (pr) => {
      pr.plans[0].slabs[0].ribbed = { dirs: 'x', ribWidth: 0.1, spacing: 0.6, topping: 0.05, fillerWeight: 0 }
    })
    const r = analyze(p)
    const lp = computeLoadPath(p, r, G)
    const st = r.model.loadTransfers.slabs[0]
    expect(st.method).toBe('unidirecional')
    const [e0, e1, e2, e3] = lp.slabEdges
    // nervuras ∥ X apoiam nas bordas verticais (1 e 3)
    expect(e0.value).toBeCloseTo(0, 9)
    expect(e2.value).toBeCloseTo(0, 9)
    expect(e1.value).toBeCloseTo(e3.value, 6)
    expect(e1.value + e3.value).toBeCloseTo(st.g, 6)
    expect(e0.polygon).toHaveLength(0)
    expect(polygonArea(e1.polygon)).toBeCloseTo(12, 9)
    expect(polygonArea(e3.polygon)).toBeCloseTo(12, 9)
    expect(e1.exact).toBe(true)
    expectConsistent(lp)
  })

  it('método da grelha: a soma das bordas é a carga da laje; figura só esquemática', () => {
    const p = panel(4, 6, (pr) => {
      pr.settings.slabMethod = 'grelha'
    })
    const r = analyze(p)
    const lp = computeLoadPath(p, r, GQ)
    expect(r.model.loadTransfers.slabs[0].method).toBe('grelha')
    expect(lp.slabEdges.reduce((s, e) => s + e.value, 0)).toBeCloseTo(144, 4)
    expect(lp.slabEdges.every((e) => !e.exact && e.polygon.length === 3)).toBe(true)
    // cunhas centroide–borda cobrem a laje inteira
    expect(lp.slabEdges.reduce((s, e) => s + polygonArea(e.polygon), 0)).toBeCloseTo(24, 9)
    // lado maior recebe mais por metro que o menor
    expect(lp.slabEdges[1].perMeter).toBeGreaterThan(lp.slabEdges[0].perMeter)
    expectConsistent(lp)
  })

  it('borda livre: o quinhão dela vai para as bordas apoiadas', () => {
    const p = panel(4, 6, (pr) => {
      pr.plans[0].beams = pr.plans[0].beams.filter((b) => b.id !== 'b0')
    })
    const r = analyze(p)
    const lp = computeLoadPath(p, r, G)
    expect(lp.slabEdges[0].supported).toBe(false)
    expect(lp.slabEdges[0].value).toBe(0)
    expect(lp.slabEdges.reduce((s, e) => s + e.value, 0)).toBeCloseTo(96, 6)
    expectConsistent(lp)
  })

  it('laje sem nenhuma viga: carga fora do pórtico, apontada como perdida', () => {
    const p = panel(4, 6, (pr) => {
      pr.plans[0].slabs.push(
        slab('solta', 'L2', [
          { x: 10, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 2 },
          { x: 10, y: 2 },
        ]),
      )
    })
    const r = analyze(p)
    const lp = computeLoadPath(p, r, G)
    const s = el(lp, slabKey(1, 'solta'))
    expect(s.lost).toBeCloseTo(16, 6)
    expect(s.own).toBeCloseTo(0, 9)
    expect(lp.check.lost).toBeCloseTo(16, 6)
    expect(lp.check.applied).toBeCloseTo(138, 6)
    expectConsistent(lp)
  })

  it('carga concentrada sobre a laje entra no total da laje e nas bordas', () => {
    const load: SlabLoad = { id: 'cp', name: 'CP1', kind: 'point', a: { x: 2, y: 3 }, g: 20, q: 0 }
    const p = panel(4, 6, (pr) => {
      pr.plans[0].slabLoads = [load]
    })
    const r = analyze(p)
    const lp = computeLoadPath(p, r, G)
    expect(el(lp, slabKey(1, 's')).own).toBeCloseTo(116, 4)
    expect(lp.slabEdges.reduce((s, e) => s + e.value, 0)).toBeCloseTo(116, 4)
    expect(lp.check.applied).toBeCloseTo(158, 4)
    for (const c of lp.columns) expect(c.foundation).toBeCloseTo(39.5, 2)
    expectConsistent(lp)
  })

  it('figuras: quadrado vira 4 triângulos; contorno em L só tem cunhas', () => {
    const sq = tributaryPolygons({
      polygon: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      method: 'charneiras',
      edges: [],
    })
    for (const s of sq) expect(polygonArea(s.polygon)).toBeCloseTo(2.25, 9)
    const L = tributaryPolygons({
      polygon: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 4 },
        { x: 0, y: 4 },
      ],
      method: 'charneiras',
      edges: [],
    })
    expect(L).toHaveLength(6)
    expect(L.every((s) => !s.exact && s.polygon.length === 3)).toBe(true)
  })
})

describe('edifício de exemplo — todos os casos e combinações', () => {
  const p = createSampleProject()
  const r = analyze(p)
  const opts = loadPathOptions(r)

  it('equilíbrio em cada nó, viga e pilar', () => {
    expect(opts.length).toBeGreaterThan(10)
    for (const o of opts) {
      const lp = computeLoadPath(p, r, o)
      // vento puro: não há carga vertical, mas os invariantes valem do mesmo jeito
      const scale = Math.max(1, Math.abs(lp.check.applied))
      expect(lp.check.residual).toBeLessThan(1e-6 * scale)
      expect(Math.abs(lp.check.applied - lp.check.reactions)).toBeLessThan(1e-6 * scale)
      for (const e of lp.elements) {
        if (e.kind === 'beam') expect(Math.abs(e.own + e.received - e.delivered)).toBeLessThan(1e-6 * scale)
      }
      for (const c of lp.columns) {
        for (const s of c.steps)
          expect(Math.abs(s.fromAbove + s.fromBeams + s.fromSlabs + s.own - s.nBase)).toBeLessThan(1e-6 * scale)
      }
    }
  })

  it('G + Q: carga aplicada = peso do modelo = soma das fundações (planta de cargas)', () => {
    const lp = computeLoadPath(p, r, opts[0])
    expectConsistent(lp)
    const weight = r.model.levelWeights.reduce((s, lw) => s + lw.G + lw.Q, 0)
    expect(lp.check.applied).toBeCloseTo(weight, 4)
    for (const c of lp.columns) {
      const row = r.foundationLoads.find((f) => f.columnId === c.columnId)!
      expect(c.foundation).toBeCloseTo(row.fzServ, 6)
      // um tramo por pavimento, de cima para baixo
      expect(c.steps).toHaveLength(p.levels.length - 1)
      expect(c.steps[0].fromAbove).toBeCloseTo(0, 9)
    }
    expect(lp.levels).toHaveLength(p.levels.length)
  })

  it('o que cada laje entrega soma a carga da laje, em todos os pavimentos', () => {
    const lp = computeLoadPath(p, r, opts[0])
    const slabs = lp.elements.filter((e) => e.kind === 'slab')
    expect(slabs.length).toBe(r.model.loadTransfers.slabs.length)
    for (const s of slabs) {
      const edges = lp.slabEdges.filter((e) => e.slabKey === s.key)
      expect(edges.reduce((acc, e) => acc + e.value, 0)).toBeCloseTo(s.own, 6)
      expect(s.delivered).toBeCloseTo(s.own, 6)
    }
  })
})

describe('fundação em desnível, baldrames e molas', () => {
  it('sapata rebaixada: o tramo de arranque entra na descida e a fundação fecha', () => {
    const p = createSampleProject()
    const col = p.columns[0]
    p.foundationOverrides = [{ columnId: col.id, depth: 1.5 }]
    const r = analyze(p)
    const lp = computeLoadPath(p, r, GQ)
    expectConsistent(lp)
    const c = lp.columns.find((x) => x.columnId === col.id)!
    const plain = lp.columns.find((x) => x.columnId === p.columns[1].id)!
    expect(c.steps).toHaveLength(plain.steps.length + 1)
    const arranque = c.steps[c.steps.length - 1]
    expect(arranque.key).toBe(columnKey(col.id, -1))
    expect(arranque.levelIndex).toBe(0)
    // 1,5 m de pilar a mais: peso próprio do arranque
    const sec = col.section as { bw: number; h: number }
    expect(arranque.own).toBeCloseTo(sec.bw * sec.h * 1.5 * p.settings.concreteUnitWeight, 6)
    expect(c.foundation).toBeCloseTo(arranque.nBase, 6)
    expect(flow(lp, columnKey(col.id, -1), foundationKey(col.id))).toBeCloseTo(arranque.nBase, 6)
  })

  it('baldrames sobre o solo: parte da carga vai direto ao terreno', () => {
    const p = createSampleProject()
    const lv0 = [...p.levels].sort((a, b) => a.elevation - b.elevation)[0]
    const xs = [...new Set(p.columns.map((c) => c.pos.x))].sort((a, b) => a - b)
    const y0 = Math.min(...p.columns.map((c) => c.pos.y))
    p.plans.push({
      id: 'fund',
      name: 'Fundação',
      beams: [
        {
          id: 'vb',
          name: 'VB1',
          path: [
            { x: xs[0], y: y0 },
            { x: xs[xs.length - 1], y: y0 },
          ],
          section: { bw: 0.2, h: 0.5 },
        },
      ],
      slabs: [],
      wallLoads: [{ id: 'wb', beamId: 'vb', w: 8 }],
      loadRegions: [],
    })
    lv0.planId = 'fund'
    p.settings.groundBeamKs = 20000
    const r = analyze(p)
    expect(r.model.winkler).not.toBeNull()
    const lp = computeLoadPath(p, r, G)
    expectConsistent(lp)
    const soil = lp.elements.find((e) => e.kind === 'soil')!
    const vb = el(lp, beamKey(0, 'vb'))
    const len = xs[xs.length - 1] - xs[0]
    expect(vb.parts).toEqual([
      { label: 'Peso próprio', value: expect.closeTo(0.2 * 0.5 * len * p.settings.concreteUnitWeight, 6) },
      { label: 'Paredes', value: expect.closeTo(8 * len, 6) },
    ])
    expect(soil.received).toBeGreaterThan(0)
    // a reação do apoio soma o pilar e o baldrame que chega nele
    const c0 = lp.columns.find((c) => Math.abs(c.pos.y - y0) < 1e-6)!
    expect(c0.foundation!).toBeCloseTo(
      c0.steps[c0.steps.length - 1].nBase + flow(lp, beamKey(0, 'vb'), foundationKey(c0.columnId)),
      6,
    )
    // o baldrame entrega ao solo e às fundações dos pilares em que se apoia
    expect(flow(lp, beamKey(0, 'vb'), soil.key)).toBeGreaterThan(0)
    expect(traceLoadPath(lp, beamKey(0, 'vb')).down.some((k) => k.startsWith('f|'))).toBe(true)
  })

  it('interação solo–estrutura (apoios sobre molas): equilíbrio continua fechando', () => {
    const p = createSampleProject()
    p.settings.soilInteraction.enabled = true
    const r = analyze(p)
    for (const o of loadPathOptions(r).slice(0, 4)) expectConsistent(computeLoadPath(p, r, o))
  })

  it('vento puro: pilares de barlavento tracionam, a descida continua fechando com sinal', () => {
    const p = createSampleProject()
    const r = analyze(p)
    const lp = computeLoadPath(p, r, loadPathOptions(r).find((o) => o.id === 'case:WXP')!)
    expectConsistent(lp)
    const fz = lp.columns.map((c) => c.foundation ?? 0)
    expect(Math.min(...fz)).toBeLessThan(-1)
    expect(Math.max(...fz)).toBeGreaterThan(1)
    expect(fz.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6)
  })
})

describe('robustez — modelos mexidos ao acaso', () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (const seed of [1, 2, 3]) {
    for (const method of ['marcus', 'grelha'] as const) {
      it(`semente ${seed}, lajes por ${method}`, () => {
        const rnd = rng(seed)
        const p = createSampleProject()
        p.settings.slabMethod = method
        p.settings.rigidEndZones = seed % 2 === 0
        // pilares de seção variada e deslocados do eixo das vigas (braço rígido)
        for (const c of p.columns) {
          if (rnd() < 0.5) c.section = { bw: 0.2 + 0.1 * Math.floor(rnd() * 3), h: 0.4 + 0.2 * Math.floor(rnd() * 3) }
          if (rnd() < 0.3) c.pos = { x: c.pos.x + (rnd() - 0.5) * 0.2, y: c.pos.y + (rnd() - 0.5) * 0.2 }
        }
        const plan = p.plans[0]
        // paredes em trechos e cargas sobre as lajes
        plan.wallLoads = plan.beams.slice(0, 6).map((b, i) => ({
          id: `w${i}`,
          beamId: b.id,
          w: 2 + 8 * rnd(),
          ...(rnd() < 0.5 ? { x0: 0.3, x1: 1.5 + rnd() } : {}),
        }))
        plan.slabLoads = plan.slabs.slice(0, 4).map((sl, i) => {
          const xs = sl.polygon.map((q) => q.x)
          const ys = sl.polygon.map((q) => q.y)
          const x = Math.min(...xs) + (0.2 + 0.6 * rnd()) * (Math.max(...xs) - Math.min(...xs))
          const y = Math.min(...ys) + (0.2 + 0.6 * rnd()) * (Math.max(...ys) - Math.min(...ys))
          return { id: `sl${i}`, name: `C${i}`, kind: 'point' as const, a: { x, y }, g: 5 + 20 * rnd(), q: 5 * rnd() }
        })
        const r = analyze(p)
        for (const o of loadPathOptions(r).filter((x) => ['G+Q', 'case:G', 'case:Q', 'combo:ELU1'].includes(x.id))) {
          const lp = computeLoadPath(p, r, o)
          const scale = Math.max(1, lp.check.applied)
          expect(lp.check.residual).toBeLessThan(1e-6 * scale)
          expect(Math.abs(lp.check.applied - lp.check.reactions)).toBeLessThan(1e-6 * scale)
          for (const e of lp.elements) {
            if (e.kind === 'beam' || e.kind === 'slab')
              expect(Math.abs(e.own + e.received - e.delivered)).toBeLessThan(1e-6 * scale)
          }
        }
        // o registro confere com o peso por nível usado na estabilidade
        const lp = computeLoadPath(p, r, { label: 'G', factors: { G: 1 }, stiffness: 'els' })
        const weightG = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
        const lostG = r.model.loadTransfers.slabs.reduce((s, st) => s + st.lostG, 0)
        expect(lostG).toBeLessThan(1e-6)
        // os baldrames do nível 0 pesam, mas não entram em levelWeights
        const level0 = lp.elements.filter((e) => e.levelIndex === 0 && e.kind === 'beam').reduce((s, e) => s + e.own, 0)
        expect(lp.check.applied - level0).toBeCloseTo(weightG, 3)
      })
    }
  }
})
