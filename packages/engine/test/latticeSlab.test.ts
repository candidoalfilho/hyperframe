import { describe, expect, it } from 'vitest'
import {
  crackedTSection,
  designLatticeSlab,
  latticeDesignation,
  latticeEndShares,
  latticeRibbed,
  trussLinearMass,
  type LatticeDesignInput,
} from '../src/nbr/nbr6118/latticeSlab'
import { latticeSection, ribbedGeometry, ribbedSelfWeight } from '../src/nbr/nbr6118/ribbedSlab'
import { oneWayTributaryAreas } from '../src/geometry/slabEdges'
import { LATTICE_DEFAULTS } from '../src/model/presets'
import { concreteProps } from '../src/nbr/nbr6118/materials'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { parseProject, serializeProject } from '../src/io/serialize'
import { buildMemorialPdf } from '../src/report/memorial'
import type { LatticeParams, Project } from '../src/model/types'

/** LT 16 (12+4): TR 12645, sapata 12×3, lajota cerâmica 30×12, aba 1,5 cm */
const LAT: LatticeParams = { ...LATTICE_DEFAULTS }

describe('laje treliçada — geometria e peso próprio (âncoras à mão)', () => {
  it('seção por intereixo: bw = bv − 2·ah, I = be + bv, H = he + capa', () => {
    const sec = latticeSection(LAT, 0.04)
    expect(sec.bw).toBeCloseTo(0.09, 9) // 12 − 2·1,5
    expect(sec.spacing).toBeCloseTo(0.42, 9) // 30 + 12
    expect(sec.h).toBeCloseTo(0.16, 9) // 12 + 4
    // concreto: capa 0,42·0,04 + alma 0,09·0,12 + abas da sapata 0,03·0,03
    expect(sec.concreteArea).toBeCloseTo(0.0168 + 0.0108 + 0.0009, 9)
    // enchimento: 0,42·0,12 − (0,0108 + 0,0009)
    expect(sec.fillerArea).toBeCloseTo(0.0387, 9)
    expect(latticeDesignation(LAT, 0.04)).toBe('LT 16 (12+4)')
  })

  it('peso próprio: (0,0285·25 + 0,0387·6)/0,42 = 2,249 kN/m²', () => {
    const { ribbed, thickness } = latticeRibbed(LAT, 0.04, 'x')
    expect(thickness).toBeCloseTo(0.16, 9)
    expect(ribbed.ribWidth).toBeCloseTo(0.09, 9)
    expect(ribbed.spacing).toBeCloseTo(0.42, 9)
    expect(ribbed.fillerWeight).toBe(6)
    expect(ribbedSelfWeight(thickness, ribbed, 25)).toBeCloseTo(0.9447 / 0.42, 6)
    // volume de concreto usado em quantitativos/incêndio = seção real
    expect(ribbedGeometry(thickness, ribbed).concreteThickness).toBeCloseTo(0.0285 / 0.42, 9)
  })

  it('massa linear da TR 12645 ≈ catálogo (0,886 kg/m)', () => {
    const m = trussLinearMass(LAT)
    expect(m).toBeGreaterThan(0.84)
    expect(m).toBeLessThan(0.9)
  })
})

const cp = concreteProps(25_000, 'granito', 1.4)
const base = (over: Partial<LatticeDesignInput> = {}): LatticeDesignInput => ({
  lattice: LAT,
  topping: 0.04,
  span: 4,
  fixedStart: false,
  fixedEnd: false,
  g: 0.9447 / 0.42 + 1.0, // peso próprio + 1,0 de revestimento
  q: 1.5,
  g0: 0.9447 / 0.42,
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

describe('laje treliçada — dimensionamento (âncoras à mão, C25, vão 4 m)', () => {
  it('flexão por vigota: Md = 1,4·(g+q)·I·L²/8 e As em CA-60', () => {
    const r = designLatticeSlab(base())
    // wd = 1,4·4,7493·0,42 = 2,7926 kN/m → Md = 2,7926·16/8 = 5,585 kN·m
    expect(r.mdSpan).toBeCloseTo(5.5852, 3)
    expect(r.d).toBeCloseTo(0.145, 9) // H − hv/2
    // x = 0,00772 m (LN na capa) → z = 0,14191 → As = 5,585/(521 739·0,14191)
    expect(r.flangeOk).toBe(true)
    expect(r.asReq * 1e4).toBeCloseTo(0.7543, 3)
    // banzo inferior 2 φ5 = 0,393 cm² não basta → adicional automática
    expect(r.asTruss * 1e4).toBeCloseTo(0.3927, 4)
    expect(r.extra?.auto).toBe(true)
    expect(r.asProvided).toBeGreaterThanOrEqual(r.asReq)
    expect(r.bars.startsWith('2 φ5 (treliça) + ')).toBe(true)
    expect(r.flexOk).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('cisalhamento sem estribos (§19.4.1) e reações por metro de apoio', () => {
    const r = designLatticeSlab(base())
    expect(r.vd).toBeCloseTo(5.5852, 3) // 0,5·wd·L
    expect(r.vrd1).toBeGreaterThan(r.vd)
    expect(r.usesDiagonals).toBe(false)
    expect(r.shearOk).toBe(true)
    // biapoiada: metade p/ cada viga — g: 0,5·3,2493·4 · q: 0,5·1,5·4
    expect(r.reactions.g[0]).toBeCloseTo(6.4986, 3)
    expect(r.reactions.g[1]).toBeCloseTo(6.4986, 3)
    expect(r.reactions.q).toEqual([3, 3])
  })

  it('armadura adicional informada e insuficiente reprova a flexão', () => {
    const r = designLatticeSlab(
      base({ lattice: { ...LAT, extraBars: { n: 1, phi: 0.005 } } }),
    )
    expect(r.extra).toEqual({ n: 1, phi: 0.005, auto: false })
    expect(r.flexOk).toBe(false)
    expect(r.ok).toBe(false)
  })

  it('continuidade em um apoio: 5/8–3/8, negativo wL²/8 e positivo 9wL²/128', () => {
    expect(latticeEndShares(true, false)).toEqual([0.625, 0.375])
    expect(latticeEndShares(false, true)).toEqual([0.375, 0.625])
    expect(latticeEndShares(true, true)).toEqual([0.5, 0.5])
    const r = designLatticeSlab(base({ fixedStart: true }))
    expect(r.fixedEnds).toBe(1)
    expect(r.mdSupport).toBeCloseTo(5.5852, 3)
    expect(r.mdSpan).toBeCloseTo((5.5852 * 8 * 9) / 128, 3)
    expect(r.vd).toBeCloseTo(0.625 * 2.79259 * 4, 3)
    expect(r.asSupportPerM).toBeGreaterThan(0)
    expect(r.supportSpec.startsWith('Q-61')).toBe(true)
    expect(r.reactions.g[0] / r.reactions.g[1]).toBeCloseTo(0.625 / 0.375, 9)
  })

  it('ELS: flecha total = imediata·(1 + 1,32); vão grande pede contraflecha ou mais altura', () => {
    const ok = designLatticeSlab(base())
    expect(ok.deflection).toBeCloseTo(ok.deflectionImmediate * 2.32, 12)
    expect(ok.deflectionLimit).toBeCloseTo(4 / 250, 12)
    const long = designLatticeSlab(base({ span: 5.5 }))
    expect(long.deflection).toBeGreaterThan(ok.deflection)
    expect(long.deflectionOk).toBe(false)
    expect(long.notes.some((n) => /contraflecha|aumente a altura/i.test(n))).toBe(true)
  })

  it('seção T fissurada: LN na mesa satisfaz o equilíbrio de momentos estáticos', () => {
    const as = 0.7854e-4
    const aE = 8.75
    const { x, i2 } = crackedTSection(0.42, 0.09, 0.04, 0.145, as, aE)
    expect(x).toBeLessThan(0.04)
    expect((0.42 * x * x) / 2).toBeCloseTo(aE * as * (0.145 - x), 9)
    expect(i2).toBeCloseTo((0.42 * x ** 3) / 3 + aE * as * (0.145 - x) ** 2, 12)
  })

  it('geometria fora da norma é apontada (capa de 3 cm)', () => {
    const r = designLatticeSlab(base({ topping: 0.03 }))
    expect(r.checks.find((c) => c.id === 'capa')?.ok).toBe(false)
    expect(r.ok).toBe(false)
  })
})

describe('quinhões unidirecionais', () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 6 },
    { x: 0, y: 6 },
  ]
  it('vigotas ∥ X: só as bordas verticais recebem (metade cada)', () => {
    const s = oneWayTributaryAreas(rect, 'x')
    expect(s[0]).toBe(0)
    expect(s[2]).toBe(0)
    expect(s[1]).toBeCloseTo(12, 9)
    expect(s[3]).toBeCloseTo(12, 9)
  })
  it('vigotas ∥ Y: só as bordas horizontais recebem', () => {
    const s = oneWayTributaryAreas(rect, 'y')
    expect(s[0]).toBeCloseTo(12, 9)
    expect(s[2]).toBeCloseTo(12, 9)
    expect(s[1]).toBe(0)
    expect(s[3]).toBe(0)
  })
  it('continuidade em um extremo: 5/8 no engastado, 3/8 no apoiado', () => {
    const s = oneWayTributaryAreas(rect, 'x', (e) => e === 1)
    expect(s[1]).toBeCloseTo(15, 9)
    expect(s[3]).toBeCloseTo(9, 9)
  })
  it('polígono em L conserva a área total', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 0, y: 6 },
    ]
    const s = oneWayTributaryAreas(lShape, 'x')
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(27, 6)
    expect(s[0]).toBe(0) // borda inferior ∥ vigotas
  })
})

describe('treliçadas integradas à análise global', () => {
  const withLattice = (dirs: 'x' | 'y'): Project => {
    const p = createSampleProject()
    for (const plan of p.plans) {
      for (const slab of plan.slabs) {
        const { ribbed, thickness } = latticeRibbed(LAT, 0.04, dirs)
        slab.ribbed = ribbed
        slab.thickness = thickness
      }
    }
    return p
  }
  /** maior momento positivo de cálculo entre os vãos de uma viga */
  const maxMd = (r: ReturnType<typeof analyze>, beamName: string) =>
    Math.max(...r.beamDesign.filter((b) => b.beamName === beamName).map((b) => b.positive.md))

  it('dimensiona as vigotas e leva a carga só às vigas de apoio', () => {
    const rx = analyze(withLattice('x'))
    const ry = analyze(withLattice('y'))

    const items = rx.slabDesign.filter((s) => s.kind === 'trelicada')
    expect(items.length).toBeGreaterThan(0)
    for (const s of items) {
      expect(s.latticeDesign).toBeTruthy()
      expect(s.design).toBeNull()
      expect(s.ribbedDesign).toBeNull()
    }

    // mesma carga total nos dois sentidos (só muda QUEM recebe)
    expect(rx.model.levelWeights[1].G).toBeCloseTo(ry.model.levelWeights[1].G, 6)

    // vigas INTERNAS do edifício exemplo: V2 corre ao longo de X; V5 ao longo de Y
    // (as de borda são dominadas pela alvenaria e mascaram o efeito)
    const p = createSampleProject()
    const v2 = p.plans[0].beams.find((b) => b.name === 'V2')!
    const v5 = p.plans[0].beams.find((b) => b.name === 'V5')!
    const alongX = (b: typeof v2) =>
      Math.abs(b.path[1].x - b.path[0].x) > Math.abs(b.path[1].y - b.path[0].y)
    expect(alongX(v2)).toBe(true)
    expect(alongX(v5)).toBe(false)

    // vigotas ∥ X apoiam nas vigas ∥ Y: V5 carrega mais e V2 menos do que no sentido oposto
    expect(maxMd(rx, 'V5')).toBeGreaterThan(maxMd(ry, 'V5') * 1.5)
    expect(maxMd(ry, 'V2')).toBeGreaterThan(maxMd(rx, 'V2') * 1.5)
  })
})

describe('treliçadas — arquivo e memorial', () => {
  const project = (): Project => {
    const p = createSampleProject()
    for (const slab of p.plans[0].slabs) {
      const { ribbed, thickness } = latticeRibbed(LAT, 0.04, 'x')
      slab.ribbed = ribbed
      slab.thickness = thickness
    }
    return p
  }

  it('salvar/abrir preserva a vigota (.hyperframe.json)', () => {
    const back = parseProject(serializeProject(project()))
    const r = back.plans[0].slabs[0].ribbed
    expect(r?.lattice).toEqual(LAT)
    expect(r?.dirs).toBe('x')
    expect(r?.spacing).toBeCloseTo(0.42, 9)
  })

  it('memorial PDF traz a seção de lajes treliçadas com composição e treliça', () => {
    const p = project()
    const bytes = buildMemorialPdf(p, analyze(p), { generatedAt: '10/11/2026 09:00' })
    let pdf = ''
    for (const b of bytes) pdf += String.fromCharCode(b)
    expect(pdf).toContain('Lajes treli\\347adas') // "treliçadas" (ç em octal WinAnsi)
    expect(pdf).toContain('LT 16 \\(12+4\\)')
    expect(pdf).toContain('TR 12645')
  })
})
