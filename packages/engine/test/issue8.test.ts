import { describe, expect, it } from 'vitest'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import type { Project, SlabLoad } from '../src/model/types'

/** issue #8 — cargas concentradas e lineares sobre lajes: caminho de carga */

/** pórtico de 1 painel a × b com 4 pilares, 4 vigas e 1 laje maciça */
const panel = (a: number, b: number, loads: SlabLoad[], mut?: (p: Project) => void): Project => {
  const p = createEmptyProject({
    name: 't',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 1,
    floorHeight: 3,
    wind: { enabled: false, v0: 30, s1: 1, category: 4, s3Group: 2 },
  })
  p.settings.notionalImperfections = false
  const [base, top] = p.levels
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
    baseLevelId: base.id,
    topLevelId: top.id,
  }))
  p.plans[0].beams = pts.map((q, i) => ({
    id: `b${i}`,
    name: `V${i + 1}`,
    path: [q, pts[(i + 1) % 4]],
    section: { bw: 0.15, h: 0.4 },
  }))
  p.plans[0].slabs = [
    {
      id: 's',
      name: 'L1',
      polygon: pts.map((q) => ({ ...q })),
      thickness: 0.12,
      finishLoad: 1,
      liveLoad: 2,
      liveLoadLabel: 'x',
    },
  ]
  p.plans[0].slabLoads = loads
  mut?.(p)
  return p
}
const pt = (x: number, y: number, g: number, q = 0): SlabLoad => ({
  id: `p${x}_${y}`,
  name: 'C1',
  kind: 'point',
  a: { x, y },
  g,
  q,
})
const fz = (r: ReturnType<typeof analyze>, k: 'G' | 'Q') =>
  r.cases.elu[k]!.reactions.reduce((s, q) => s + q.fz, 0)
const weight = (r: ReturnType<typeof analyze>, k: 'G' | 'Q') =>
  r.model.levelWeights.reduce((s, lw) => s + lw[k], 0)

describe('caminho de carga: laje → vigas → pilares', () => {
  const ref = analyze(panel(4, 4, []))

  it('sem cargas concentradas o modelo não muda (regressão)', () => {
    const r = analyze(panel(4, 4, []))
    expect(r.model.members.length).toBe(ref.model.members.length)
    expect(r.model.warnings.some((w) => w.startsWith('Cargas concentradas'))).toBe(false)
  })

  it('a força chega inteira às reações (G e Q separados)', () => {
    const r = analyze(panel(4, 4, [pt(2, 2, 20, 8)]))
    expect(fz(r, 'G') - fz(ref, 'G')).toBeCloseTo(20, 4)
    expect(fz(r, 'Q') - fz(ref, 'Q')).toBeCloseTo(8, 4)
    expect(fz(r, 'G')).toBeCloseTo(weight(r, 'G'), 4)
    expect(fz(r, 'Q')).toBeCloseTo(weight(r, 'Q'), 4)
    expect(r.model.warnings.some((w) => w.startsWith('Cargas concentradas/lineares sobre lajes em 1'))).toBe(true)
  })

  it('força no centro: 1/4 para cada pilar (simetria)', () => {
    const r = analyze(panel(4, 4, [pt(2, 2, 20)]))
    const d = r.cases.elu.G!.reactions.map(
      (q, i) => q.fz - ref.cases.elu.G!.reactions[i].fz,
    )
    for (const v of d) expect(v).toBeCloseTo(5, 3)
  })

  it('força perto de um canto: o pilar desse canto recebe a maior parte', () => {
    const r = analyze(panel(4, 4, [pt(0.5, 0.5, 20)]))
    const byCol = new Map(
      r.cases.elu.G!.reactions.map((q, i) => {
        const n = r.model.nodes[q.nodeId]
        return [`${n.x},${n.y}`, q.fz - ref.cases.elu.G!.reactions[i].fz]
      }),
    )
    expect(byCol.get('0,0')!).toBeGreaterThan(13)
    expect(byCol.get('4,4')!).toBeLessThan(1.5)
    expect([...byCol.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(20, 4)
  })

  it('as vigas sob a laje carregada são subdivididas e o momento reflete a posição da carga', () => {
    const r = analyze(panel(4, 4, [pt(2, 0.4, 30)]))
    // vigas de 4 m em barras ≤ 0,5 m
    const v1 = r.model.members.filter((m) => m.ref.kind === 'beam' && m.ref.sourceId === 'b0')
    expect(v1.length).toBe(8)
    expect(v1.every((m) => m.length <= 0.5 + 1e-9)).toBe(true)
    // continua um único vão de dimensionamento por viga
    expect(r.beamDesign.filter((b) => b.beamName === 'V1').length).toBe(1)
    // V1 (y = 0, a 40 cm da carga) ganha muito mais momento que V3 (y = 4)
    const md = (n: string, x: ReturnType<typeof analyze>) =>
      x.beamDesign.find((b) => b.beamName === n)!.positive.md
    const dV1 = md('V1', r) - md('V1', ref)
    const dV3 = md('V3', r) - md('V3', ref)
    expect(dV1).toBeGreaterThan(5 * Math.max(dV3, 0.01))
    // e mais que a mesma reação espalhada uniformemente (carga no meio do vão)
    const rV1 = 30 * 0.75 // ordem de grandeza da parcela que vai p/ V1
    expect(dV1).toBeGreaterThan((1.4 * rV1 * 4) / 12)
  })

  it('a rigidez da viga não muda por causa da subdivisão (mesa colaborante pelo vão original)', () => {
    // carga desprezável: os esforços devem coincidir com os da referência
    const r = analyze(panel(4, 4, [pt(2, 2, 1e-6)]))
    expect(r.model.members.length).toBeGreaterThan(ref.model.members.length)
    for (const b of ref.beamDesign) {
      const n = r.beamDesign.find((x) => x.beamName === b.beamName && x.spanIndex === b.spanIndex)!
      expect(n.positive.md / b.positive.md).toBeGreaterThan(0.985)
      expect(n.positive.md / b.positive.md).toBeLessThan(1.015)
    }
  })

  it('parede sobre a laje (linear) pela composição entra como permanente', () => {
    const wall: SlabLoad = {
      id: 'w',
      name: 'PAR1',
      kind: 'line',
      a: { x: 1, y: 2 },
      b: { x: 3, y: 2 },
      g: 5,
      q: 0,
    }
    const r = analyze(panel(4, 4, [wall]))
    expect(fz(r, 'G') - fz(ref, 'G')).toBeCloseTo(10, 4)
    expect(fz(r, 'Q') - fz(ref, 'Q')).toBeCloseTo(0, 6)
  })

  it('carga fora de qualquer laje é avisada e não entra', () => {
    const r = analyze(panel(4, 4, [pt(9, 9, 15)]))
    expect(fz(r, 'G')).toBeCloseTo(fz(ref, 'G'), 6)
    expect(r.model.warnings.some((w) => w.includes('fora de qualquer laje'))).toBe(true)
  })

  it('laje treliçada (unidirecional): a carga vai só para as vigas onde as vigotas apoiam', async () => {
    const { LATTICE_DEFAULTS } = await import('../src/model/presets')
    const { latticeRibbed } = await import('../src/nbr/nbr6118/latticeSlab')
    const mk = (loads: SlabLoad[]) =>
      panel(4, 4, loads, (p) => {
        const s = p.plans[0].slabs[0]
        const rb = latticeRibbed({ ...LATTICE_DEFAULTS }, 0.04, 'x')
        s.ribbed = rb.ribbed
        s.thickness = rb.thickness
      })
    const r0 = analyze(mk([]))
    const r = analyze(mk([pt(1, 2, 24)]))
    expect(fz(r, 'G') - fz(r0, 'G')).toBeCloseTo(24, 4)
    // vigotas ∥ X: apoiam em V4 (x = 0) e V2 (x = 4); alavanca 3/4 e 1/4
    const sumLoad = (x: ReturnType<typeof analyze>, id: string) =>
      x.model.members
        .filter((m) => m.ref.kind === 'beam' && m.ref.sourceId === id)
        .reduce((s, m) => s + m.length, 0)
    expect(sumLoad(r, 'b3')).toBeCloseTo(4, 6)
    const col = (x: ReturnType<typeof analyze>, cx: number) =>
      x.cases.elu.G!.reactions
        .filter((q) => Math.abs(x.model.nodes[q.nodeId].x - cx) < 1e-6)
        .reduce((s, q) => s + q.fz, 0)
    expect(col(r, 0) - col(r0, 0)).toBeCloseTo(18, 2)
    expect(col(r, 4) - col(r0, 4)).toBeCloseTo(6, 2)
  })

  it('edifício exemplo com cargas em vários pavimentos: equilíbrio e sem NaN', () => {
    const p = createSampleProject()
    const sl = p.plans[0].slabs[0]
    const cx = sl.polygon.reduce((s, q) => s + q.x, 0) / sl.polygon.length
    const cy = sl.polygon.reduce((s, q) => s + q.y, 0) / sl.polygon.length
    p.plans[0].slabLoads = [
      pt(cx, cy, 25, 10),
      { id: 'w', name: 'PAR1', kind: 'line', a: { x: cx - 1, y: cy + 0.6 }, b: { x: cx + 1.2, y: cy + 0.6 }, g: 6, q: 0 },
    ]
    const base = analyze(createSampleProject())
    const r = analyze(p)
    const nLevels = p.levels.filter((l) => l.planId === p.plans[0].id).length
    expect(fz(r, 'G') - fz(base, 'G')).toBeCloseTo(nLevels * (25 + 6 * 2.2), 3)
    expect(fz(r, 'Q') - fz(base, 'Q')).toBeCloseTo(nLevels * 10, 3)
    expect(fz(r, 'G')).toBeCloseTo(weight(r, 'G'), 3)
    for (const c of Object.values(r.cases.elu))
      for (const d of c.displacements) for (const v of d) expect(Number.isFinite(v)).toBe(true)
    expect(r.beamDesign.every((b) => Number.isFinite(b.positive.md))).toBe(true)
  })
})

describe('verificação da laje com cargas concentradas', () => {
  const slabOf = (r: ReturnType<typeof analyze>) => r.slabDesign[0]

  it('sem cargas: nenhum bloco de concentradas no resultado', () => {
    expect(slabOf(analyze(panel(4, 4, []))).concentrated).toBeUndefined()
  })

  it('maciça (Marcus): momentos amplificados e punção verificada sob a carga', () => {
    const ref = slabOf(analyze(panel(4, 4, [])))
    const r = slabOf(analyze(panel(4, 4, [pt(2, 2, 15, 5)])))
    const c = r.concentrated!
    expect(c.totalG).toBeCloseTo(15, 9)
    expect(c.totalQ).toBeCloseTo(5, 9)
    expect(c.kx!).toBeCloseTo(c.ky!, 6) // simetria
    expect(c.factor).toBeGreaterThan(1.3)
    // dimensionamento com a carga uniforme equivalente: Md cresce na mesma razão
    expect(r.design!.dirA.mSpanD / ref.design!.dirA.mSpanD).toBeCloseTo(c.factor, 3)
    expect(r.design!.dirA.asSpan).toBeGreaterThanOrEqual(ref.design!.dirA.asSpan)
    // punção: FSd = 1,4 × 20 = 28 kN em 20×20 cm
    expect(c.punching.length).toBe(1)
    expect(c.punching[0].fsd).toBeCloseTo(28, 9)
    expect(c.punching[0].check.okC).toBe(true)
    expect(r.notes.some((n) => n.startsWith('Punção sob C1'))).toBe(true)
    expect(r.notes.some((n) => n.startsWith('Cargas concentradas'))).toBe(true)
  })

  it('punção: contorno C′ a 2d — u1 = 2(bx+by) + 4πd e τSd = FSd/(u1·d)', () => {
    const r = slabOf(analyze(panel(4, 4, [pt(2, 2, 20)])))
    const p = r.concentrated!.punching[0]
    // CAA II: cobrimento da laje 2,5 cm ⇒ d = 0,12 − 0,025 − 0,015 = 0,08 m
    const d = 0.08
    const u1 = 2 * (0.2 + 0.2) + 4 * Math.PI * d
    expect(p.check.u1).toBeCloseTo(u1, 6)
    expect(p.check.tauSd1).toBeCloseTo((1.4 * 20) / (u1 * d), 3)
  })

  it('carga pesada em área pequena reprova a laje por punção', () => {
    const heavy: SlabLoad = { ...pt(2, 2, 160), size: { bx: 0.1, by: 0.1 } }
    const r = slabOf(analyze(panel(4, 4, [heavy])))
    expect(r.status).toBe('falha')
    expect(r.notes.some((n) => n.startsWith('Punção sob C1') && n.includes('>'))).toBe(true)
  })

  it('método da grelha: momentos por direção amplificados', () => {
    const grid = (loads: SlabLoad[]) =>
      slabOf(analyze(panel(4, 4, loads, (p) => (p.settings.slabMethod = 'grelha'))))
    const ref = grid([])
    // parede paralela a Y: carrega as faixas em X
    const r = grid([{ id: 'w', name: 'PAR1', kind: 'line', a: { x: 2, y: 0.5 }, b: { x: 2, y: 3.5 }, g: 8, q: 0 }])
    const c = r.concentrated!
    expect(c.kx!).toBeGreaterThan(c.ky!)
    expect(r.gridDesign!.mxSpan / ref.gridDesign!.mxSpan).toBeCloseTo(c.kx!, 3)
    expect(r.gridDesign!.mySpan / ref.gridDesign!.mySpan).toBeCloseTo(c.ky!, 3)
    expect(c.punching.length).toBe(0) // carga linear não tem punção
  })

  describe('laje treliçada', () => {
    const lattice = async (loads: SlabLoad[]) => {
      const { LATTICE_DEFAULTS } = await import('../src/model/presets')
      const { latticeRibbed } = await import('../src/nbr/nbr6118/latticeSlab')
      return slabOf(
        analyze(
          panel(4, 4, loads, (p) => {
            const s = p.plans[0].slabs[0]
            const rb = latticeRibbed({ ...LATTICE_DEFAULTS }, 0.04, 'x')
            s.ribbed = rb.ribbed
            s.thickness = rb.thickness
          }),
        ),
      )
    }

    it('parede ao longo das vigotas: pede vigotas justapostas sob a parede', async () => {
      const ref = await lattice([])
      const r = await lattice([
        { id: 'w', name: 'PAR1', kind: 'line', a: { x: 0.2, y: 2 }, b: { x: 3.8, y: 2 }, g: 6, q: 0 },
      ])
      const j = r.concentrated!.joist!
      expect(j.spread).toBe(false)
      // parede de 6 kN/m em 3,6 m centrada num vão de 4 m: M = R·2 − 6·1,8·0,9
      expect(j.m).toBeCloseTo(10.8 * 2 - 6 * 1.8 * 0.9, 1)
      expect(j.v).toBeCloseTo(10.8, 1)
      expect(j.juxtaposed).toBeGreaterThanOrEqual(2)
      expect(r.status).not.toBe('ok')
      expect(r.notes.some((n) => n.includes('JUSTAPOSTAS'))).toBe(true)
      // o painel em si não é redimensionado por uma carga localizada
      expect(r.latticeDesign!.mdSpan).toBeCloseTo(ref.latticeDesign!.mdSpan, 9)
    })

    it('parede atravessando as vigotas: todas recebem, o painel é redimensionado', async () => {
      const ref = await lattice([])
      const r = await lattice([
        { id: 'w', name: 'PAR1', kind: 'line', a: { x: 2, y: 0 }, b: { x: 2, y: 4 }, g: 6, q: 0 },
      ])
      const c = r.concentrated!
      expect(c.joist!.spread).toBe(true)
      expect(c.joist!.juxtaposed).toBe(1)
      expect(c.factor).toBeGreaterThan(1.2)
      expect(r.latticeDesign!.mdSpan / ref.latticeDesign!.mdSpan).toBeCloseTo(c.factor, 3)
      // P por vigota = 6 kN/m × intereixo; no meio do vão de 4 m: M = P·L/4, V = P/2
      const { LATTICE_DEFAULTS } = await import('../src/model/presets')
      const { latticeRibbed } = await import('../src/nbr/nbr6118/latticeSlab')
      const sp = latticeRibbed({ ...LATTICE_DEFAULTS }, 0.04, 'x').ribbed.spacing
      expect(c.joist!.m / ((6 * sp * 4) / 4)).toBeGreaterThan(0.99)
      expect(c.joist!.m / ((6 * sp * 4) / 4)).toBeLessThan(1.01)
      expect(c.joist!.v / ((6 * sp) / 2)).toBeGreaterThan(0.99)
      expect(c.joist!.v / ((6 * sp) / 2)).toBeLessThan(1.01)
    })

    it('carga pequena: a vigota dimensionada resiste sem reforço', async () => {
      const r = await lattice([pt(0.3, 2, 0.5)])
      expect(r.concentrated!.joist!.juxtaposed).toBe(1)
      expect(r.notes.some((n) => n.includes('resiste sem reforço'))).toBe(true)
    })
  })
})
