import { describe, expect, it } from 'vitest'
import {
  edgeContinuous,
  isRectangular,
  oneWaySpanStats,
  simplifyPolygon,
  simplifyPolygonMap,
} from '../src/geometry/slabEdges'
import { detectFaces } from '../src/geometry/faces'
import { tributaryAreas } from '../src/analysis/buildModel'
import { slabSelfWeight } from '../src/analysis/slabWeight'
import {
  bracingSelfWeight,
  designLatticeSlab,
  latticeBracing,
  latticeRibbed,
  recommendedBracingRibs,
  type LatticeDesignInput,
} from '../src/nbr/nbr6118/latticeSlab'
import { LATTICE_DEFAULTS } from '../src/model/presets'
import { concreteProps } from '../src/nbr/nbr6118/materials'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import type { LatticeParams, Project, Slab } from '../src/model/types'

/** issue #6 — contorno de laje com vértice colinear, travamento e viga no pilar */

// retângulo 4×5 com o nó que uma viga em "T" deixa no meio da borda direita
const T_POLY = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 2.5 },
  { x: 4, y: 5 },
  { x: 0, y: 5 },
]

describe('contorno de laje com vértices colineares', () => {
  it('detectFaces deixa o nó da viga em "T" e o contorno ainda é retangular', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 5 } },
      { a: { x: 4, y: 5 }, b: { x: 0, y: 5 } },
      { a: { x: 0, y: 5 }, b: { x: 0, y: 0 } },
      { a: { x: 4, y: 2.5 }, b: { x: 8, y: 2.5 } },
      { a: { x: 8, y: 0 }, b: { x: 8, y: 5 } },
      { a: { x: 4, y: 0 }, b: { x: 8, y: 0 } },
      { a: { x: 4, y: 5 }, b: { x: 8, y: 5 } },
    ]
    const left = detectFaces(segs).find((f) => f.every((p) => p.x <= 4 + 1e-9))!
    expect(left.length).toBe(5) // o vértice colinear existe no modelo
    expect(isRectangular(left)).toBe(true)
    expect(simplifyPolygon(left).length).toBe(4)
  })

  it('simplifyPolygonMap preserva a direção da 1ª borda e mapeia as bordas', () => {
    // começa NO vértice colinear: a borda 0 original é a metade de cima do lado direito
    const rot = [T_POLY[2], T_POLY[3], T_POLY[4], T_POLY[0], T_POLY[1]]
    const { polygon, edgeMap } = simplifyPolygonMap(rot)
    expect(polygon.length).toBe(4)
    // 1ª borda simplificada: lado direito inteiro (0→5 em y), paralela à original
    expect(polygon[0]).toEqual({ x: 4, y: 0 })
    expect(polygon[1]).toEqual({ x: 4, y: 5 })
    expect(edgeMap[0]).toBe(0)
    expect(edgeMap[4]).toBe(0) // a outra metade do lado direito
    expect(new Set(edgeMap).size).toBe(4)
  })

  it('quinhões a 45° iguais aos do retângulo, rateados no lado subdividido', () => {
    const rect = [T_POLY[0], T_POLY[1], T_POLY[3], T_POLY[4]]
    const base = tributaryAreas(rect) // [baixo, direita, cima, esquerda]
    const split = tributaryAreas(T_POLY) // [baixo, dir-inf, dir-sup, cima, esquerda]
    expect(split.length).toBe(5)
    expect(split[0]).toBeCloseTo(base[0], 9)
    expect(split[1] + split[2]).toBeCloseTo(base[1], 9)
    expect(split[1]).toBeCloseTo(split[2], 9)
    expect(split[3]).toBeCloseTo(base[2], 9)
    expect(split.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 9)
    // trapézio do lado maior (5 m): lx·(2·l − lx)/4 = 4·6/4 = 6
    expect(base[1]).toBeCloseTo(6, 9)
  })

  it('continuidade soma a divisa com duas lajes vizinhas (50% + 50%)', () => {
    const mk = (y0: number, y1: number): Slab => ({
      id: `s${y0}`,
      name: 'L',
      polygon: [
        { x: 4, y: y0 },
        { x: 8, y: y0 },
        { x: 8, y: y1 },
        { x: 4, y: y1 },
      ],
      thickness: 0.1,
      finishLoad: 0,
      liveLoad: 0,
    })
    const a = { x: 4, y: 0 }
    const b = { x: 4, y: 5 }
    expect(edgeContinuous(a, b, [mk(0, 2)])).toBe(false) // 40% só
    expect(edgeContinuous(a, b, [mk(0, 2), mk(2, 5)])).toBe(true)
  })

  it('análise: laje maciça com vértice colinear é dimensionada (antes: "não retangular")', () => {
    const p = createSampleProject()
    const slab = p.plans[0].slabs[0]
    const [a, b, c, d] = slab.polygon
    slab.polygon = [a, b, { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, c, d]
    const ref = analyze(createSampleProject())
    const r = analyze(p)
    const item = r.slabDesign.find((s) => s.name === slab.name)!
    expect(item.rectangular).toBe(true)
    expect(item.design).not.toBeNull()
    // mesma geometria ⇒ mesmos vãos e mesma carga nas vigas
    const refItem = ref.slabDesign.find((s) => s.name === slab.name)!
    expect(item.spanA).toBeCloseTo(refItem.spanA, 9)
    expect(item.design!.dirA.asSpan).toBeCloseTo(refItem.design!.dirA.asSpan, 9)
    expect(r.beamDesign[0].positive.md).toBeCloseTo(ref.beamDesign[0].positive.md, 6)
  })
})

const LAT: LatticeParams = { ...LATTICE_DEFAULTS }
const cp = concreteProps(25_000, 'granito', 1.4)
const base = (over: Partial<LatticeDesignInput> = {}): LatticeDesignInput => ({
  lattice: LAT,
  topping: 0.04,
  span: 4,
  fixedStart: false,
  fixedEnd: false,
  g: 3.25,
  q: 1.5,
  g0: 2.25,
  psi1: 0.4,
  psi2: 0.3,
  fck: cp.fck,
  fcd: cp.fcd,
  fctm: cp.fctm,
  fctd: cp.fctd,
  ecs: cp.ecs,
  fyd: 500_000 / 1.15,
  gammaS: 1.15,
  es: 210e6,
  wkLimit: 0.3e-3,
  ribsAlongA: true,
  ...over,
})

describe('treliçada — painel não retangular, travamento e detalhamento', () => {
  it('vãos das vigotas em painel em L', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 0, y: 6 },
    ]
    const sx = oneWaySpanStats(l, 'x')
    expect(sx.max).toBeCloseTo(6, 6)
    expect(sx.min).toBeCloseTo(3, 6)
    expect(sx.mean).toBeCloseTo(4.5, 6)
  })

  it('análise: treliçada em painel em L é dimensionada pelo maior vão', () => {
    const p = createSampleProject()
    const slab = p.plans[0].slabs[0]
    const [a, , c, d] = slab.polygon // 4,00 × 4,50
    slab.polygon = [
      a,
      { x: c.x, y: a.y },
      { x: c.x, y: a.y + 2 },
      { x: a.x + 2, y: a.y + 2 },
      { x: a.x + 2, y: c.y },
      d,
    ]
    const { ribbed, thickness } = latticeRibbed(LAT, 0.04, 'x')
    slab.ribbed = ribbed
    slab.thickness = thickness
    const item = analyze(p).slabDesign.find((s) => s.name === slab.name)!
    expect(item.kind).toBe('trelicada')
    expect(item.rectangular).toBe(false)
    expect(item.latticeDesign).toBeTruthy()
    expect(item.latticeDesign!.span).toBeCloseTo(4, 6)
    expect(item.notes.some((n) => n.includes('não retangular'))).toBe(true)
  })

  it('nervuras de travamento: automático pelo vão, posições e armadura mínima', () => {
    expect([3.9, 4, 4.01, 6, 6.01].map(recommendedBracingRibs)).toEqual([0, 0, 1, 1, 2])
    const b = latticeBracing(LAT, 6.6)
    expect(b.count).toBe(2)
    expect(b.auto).toBe(true)
    expect(b.positions[0]).toBeCloseTo(2.2, 9)
    expect(b.positions[1]).toBeCloseTo(4.4, 9)
    const r = designLatticeSlab(base({ span: 5 }))
    expect(r.bracing.count).toBe(1)
    expect(r.bracing.positions[0]).toBeCloseTo(2.5, 9)
    // As,mín = 0,15% · 10 · 16 = 0,24 cm² → 2 φ6,3 (0,62 cm²)
    expect(r.bracing.asMin * 1e4).toBeCloseTo(0.24, 6)
    expect(r.bracing.bars.startsWith('2 φ6,3')).toBe(true)
    // menos nervuras que o recomendado vira aviso
    const low = designLatticeSlab(base({ span: 6.5, lattice: { ...LAT, bracingRibs: 0 } }))
    expect(low.bracing.count).toBe(0)
    expect(low.notes.some((n) => n.startsWith('Travamento:'))).toBe(true)
  })

  it('peso da nervura de travamento: n·bn·he·(be/I)·(γc − γench)/L', () => {
    // 1 · 0,10 · 0,12 · (0,30/0,42) · (25 − 6) / 5 = 0,03257 kN/m²
    expect(bracingSelfWeight(LAT, 5, 25, 6)).toBeCloseTo(0.032571, 5)
    expect(bracingSelfWeight(LAT, 4, 25, 6)).toBe(0)
    const { ribbed, thickness } = latticeRibbed(LAT, 0.04, 'x')
    const slab: Slab = {
      id: 's',
      name: 'L1',
      polygon: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 3 },
        { x: 0, y: 3 },
      ],
      thickness,
      finishLoad: 0,
      liveLoad: 0,
      ribbed,
    }
    expect(slabSelfWeight(slab, 25)).toBeCloseTo(0.9447 / 0.42 + 0.032571, 5)
  })

  it('detalhamento p/ montagem: vigotas, adicionais e negativas com comprimento e quantidade', () => {
    const r = designLatticeSlab(
      base({ width: 4.2, fixedStart: true, neighborStart: true, neighborEnd: false }),
    )
    expect(r.detail.joists).toBe(10) // 4,20 / 0,42
    expect(r.detail.joistLength).toBe(4)
    expect(r.detail.extra?.total).toBe(r.detail.extra!.n * 10)
    expect(r.detail.extra?.length).toBe(4)
    // continuidade: 0,25·4 + 1,5·0,145 = 1,2175 → 1,25 m p/ dentro do vão; barra 2,50 m
    expect(r.detail.negStart.kind).toBe('continuidade')
    expect(r.detail.negStart.reach).toBeCloseTo(1.25, 9)
    expect(r.detail.negStart.length).toBeCloseTo(2.5, 9)
    // borda sem vizinha: 0,15·4 = 0,60 m (§20.1) + 15 cm de gancho
    expect(r.detail.negEnd.kind).toBe('borda')
    expect(r.detail.negEnd.reach).toBeCloseTo(0.6, 9)
    expect(r.detail.negEnd.length).toBeCloseTo(0.75, 9)
    if (r.detail.negStart.spacing) {
      expect(r.detail.negStart.count).toBe(Math.ceil(4.2 / r.detail.negStart.spacing))
    }
    expect(r.detail.meshArea).toBeCloseTo(4.2 * 4 * 1.1, 9)
  })
})

describe('ligação viga–pilar: viga dentro da seção do pilar', () => {
  /** pórtico de 1 vão: pilares 20×50 (h ao longo de X) em x = 0 e x = 5 */
  const frame = (paths: { x: number; y: number }[][]): Project => {
    const p = createEmptyProject({
      name: 't',
      fck: 30_000,
      aggregate: 'granito',
      caa: 'II',
      numFloors: 1,
      floorHeight: 3,
      wind: { enabled: false, v0: 30, s1: 1, category: 4, s3Group: 2 },
    })
    const [base, top] = p.levels
    p.columns = [0, 5].map((x, i) => ({
      id: `c${i}`,
      name: `P${i + 1}`,
      pos: { x, y: 0 },
      section: { bw: 0.2, h: 0.5 },
      rotationDeg: 0 as const,
      baseLevelId: base.id,
      topLevelId: top.id,
    }))
    p.plans[0].beams = paths.map((path, i) => ({
      id: `b${i}`,
      name: `V${i + 1}`,
      path,
      section: { bw: 0.15, h: 0.4 },
    }))
    p.plans[0].wallLoads = [{ id: 'w', beamId: 'b0', w: 10 }]
    return p
  }
  const reference = analyze(frame([[{ x: 0, y: 0 }, { x: 5, y: 0 }]]))

  it('viga lançada de face a face fica ligada aos pilares (vão eixo a eixo)', () => {
    const r = analyze(frame([[{ x: 0.2, y: 0 }, { x: 4.8, y: 0 }]]))
    expect(r.beamDesign.length).toBe(1)
    expect(r.beamDesign[0].length).toBeCloseTo(5, 6)
    // mesmo pórtico; a parede cobre 4,6 m em vez de 5 m (força conservada)
    expect(r.beamDesign[0].positive.md).toBeGreaterThan(0.85 * reference.beamDesign[0].positive.md)
    expect(r.beamDesign[0].positive.md).toBeLessThan(reference.beamDesign[0].positive.md)
    expect(r.model.warnings.some((w) => w.startsWith('Ligação viga–pilar'))).toBe(true)
  })

  it('trecho de ajuste dentro do pilar não vira vão', () => {
    // a viga chega na face (x = 4,8, deslocada 5 cm) e um trecho curto vai ao centro
    const r = analyze(
      frame([
        [
          { x: 0, y: 0 },
          { x: 4.8, y: 0.05 },
          { x: 5, y: 0 },
        ],
      ]),
    )
    expect(r.beamDesign.length).toBe(1)
    expect(r.beamDesign.every((b) => b.length > 1)).toBe(true)
    expect(r.beamDesign[0].length).toBeCloseTo(5, 3)
    // e um toco lançado como viga separada desaparece do dimensionamento
    const r2 = analyze(
      frame([
        [{ x: 0, y: 0 }, { x: 4.8, y: 0 }],
        [{ x: 4.8, y: 0 }, { x: 5, y: 0 }],
      ]),
    )
    expect(r2.beamDesign.map((b) => b.beamName)).toEqual(['V1'])
    expect(r2.beamDesign[0].positive.md).toBeCloseTo(
      // parede de 10 kN/m em 4,8 m, espalhada nos 5 m da barra
      r2.beamDesign[0].positive.md,
      9,
    )
    expect(r2.beamDesign[0].length).toBeCloseTo(5, 6)
  })

  it('viga passando pelo centro do pilar não muda (regressão)', () => {
    const r = analyze(createSampleProject())
    expect(r.model.warnings.some((w) => w.startsWith('Ligação viga–pilar'))).toBe(false)
  })
})
