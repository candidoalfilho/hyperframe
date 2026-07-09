import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { uid } from '../src/model/uid'
import { analyze } from '../src/analyze'
import { buildFormworkDrawing } from '../src/drawing/formwork'
import { buildBeamDetailDrawing } from '../src/drawing/beamDetail'
import { buildColumnDetailDrawing } from '../src/drawing/columnDetail'
import { writeDxf } from '../src/dxf/write'
import type { BeamDetailSpan, ColumnDetailInfo } from '../src/analysis/types'
import type { Drawing, DrawingLayer } from '../src/drawing/types'

const VALID_LAYERS = new Set<DrawingLayer>([
  'EIXOS',
  'PILARES',
  'VIGAS',
  'LAJES',
  'COTAS',
  'TEXTOS',
  'ARMADURA',
  'ESTRIBOS',
  'CONTORNO',
  'MARGEM',
])

/** invariantes de todo desenho: layers válidas, textos não vazios, bounds sãos, DXF fecha */
function checkDrawing(d: Drawing): void {
  expect(d.primitives.length).toBeGreaterThan(0)
  expect(d.title.trim().length).toBeGreaterThan(0)

  for (const p of d.primitives) {
    expect(VALID_LAYERS.has(p.layer)).toBe(true)
    if (p.kind === 'text' || p.kind === 'dim') {
      expect(p.text.trim().length).toBeGreaterThan(0)
    }
  }

  const { minX, minY, maxX, maxY } = d.bounds
  for (const v of [minX, minY, maxX, maxY]) expect(Number.isFinite(v)).toBe(true)
  expect(maxX).toBeGreaterThan(minX)
  expect(maxY).toBeGreaterThan(minY)

  const dxf = writeDxf(d)
  expect(typeof dxf).toBe('string')
  expect(dxf).toContain('EOF')
}

const texts = (d: Drawing): string[] =>
  d.primitives.flatMap((p) => (p.kind === 'text' ? [p.text] : []))

// ---------------------------------------------------------------------------
// planta de forma
// ---------------------------------------------------------------------------

describe('buildFormworkDrawing', () => {
  const project = createSampleProject()
  const planId = project.plans[0].id
  const d = buildFormworkDrawing(project, planId)

  it('gera prancha rica (> 30 primitivas) e válida', () => {
    expect(d.primitives.length).toBeGreaterThan(30)
    checkDrawing(d)
  })

  it('rotula pilares, vigas, lajes, eixos e título', () => {
    const ts = texts(d)
    expect(ts).toContain('P1 25x60')
    expect(ts).toContain('V1 20x50')
    expect(ts.some((t) => t.startsWith('L1'))).toBe(true)
    expect(ts).toContain('h=12')
    expect(ts).toContain('A') // bolacha do eixo A
    expect(ts).toContain('1') // bolacha do eixo 1
    expect(ts).toContain(`PLANTA DE FORMA — ${project.plans[0].name} — esc. 1:50`)
  })

  it('cota os vãos entre eixos adjacentes (em cm)', () => {
    const dims = d.primitives.filter((p) => p.kind === 'dim')
    // 4 eixos x → 3 cotas; 3 eixos y → 2 cotas
    expect(dims).toHaveLength(5)
    expect(dims.map((dm) => dm.text)).toEqual(
      expect.arrayContaining(['400', '450', '450']),
    )
  })

  it('desenha eixos tracejados com bolachas nas duas pontas', () => {
    const circles = d.primitives.filter((p) => p.kind === 'circle' && p.layer === 'EIXOS')
    expect(circles).toHaveLength(2 * (4 + 3))
    const axes = d.primitives.filter(
      (p) => p.kind === 'line' && p.layer === 'EIXOS' && p.dashed === true,
    )
    expect(axes).toHaveLength(4 + 3)
  })

  it('regiões de carga: contorno tracejado + rótulo g/q', () => {
    const p2 = createSampleProject()
    p2.plans[0].loadRegions.push({
      id: uid('rg'),
      name: 'ESC1',
      kind: 'escada',
      polygon: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 2.2 },
        { x: 1, y: 2.2 },
      ],
      g: 5,
      q: 3,
    })
    const d2 = buildFormworkDrawing(p2, p2.plans[0].id)
    checkDrawing(d2)
    expect(texts(d2)).toContain('ESC1 g=5,0 q=3,0 kN/m²')
    expect(
      d2.primitives.some(
        (p) => p.kind === 'polyline' && p.layer === 'CONTORNO' && p.closed && p.dashed,
      ),
    ).toBe(true)
  })

  it('planta inexistente → erro pt-BR', () => {
    expect(() => buildFormworkDrawing(project, 'nao-existe')).toThrow(
      'Planta de forma não encontrada',
    )
  })
})

// ---------------------------------------------------------------------------
// detalhamento com resultados reais da análise
// ---------------------------------------------------------------------------

describe('pranchas a partir de analyze(createSampleProject())', () => {
  const results = analyze(createSampleProject())

  it('detalhamento de viga real: vãos, barras, estribos, cotas e corte', () => {
    // filtra por beamId — o mesmo nome (V1) pode repetir em plantas distintas
    const first = results.detailing.beams[0]
    const spans = results.detailing.beams.filter((b) => b.beamId === first.beamId)
    expect(spans.length).toBeGreaterThan(0)

    const d = buildBeamDetailDrawing(first.beamName, spans)
    checkDrawing(d)
    expect(d.title).toContain(`VIGA ${first.beamName}`)
    expect(texts(d).some((t) => /^N1 \d+ φ /.test(t))).toBe(true)
    // uma cota por vão
    expect(d.primitives.filter((p) => p.kind === 'dim')).toHaveLength(spans.length)
    // corte da seção: barras positivas como círculos preenchidos
    const dots = d.primitives.filter(
      (p) => p.kind === 'circle' && p.layer === 'ARMADURA' && p.filled,
    )
    expect(dots.length).toBeGreaterThanOrEqual(spans[0].positive.n)
  })

  it('prancha de pilares real: 12 seções, barras e textos', () => {
    const cols = results.detailing.columns
    expect(cols).toHaveLength(12)

    const d = buildColumnDetailDrawing(cols)
    checkDrawing(d)
    const dots = d.primitives.filter(
      (p) => p.kind === 'circle' && p.layer === 'ARMADURA' && p.filled,
    )
    expect(dots).toHaveLength(cols.reduce((s, c) => s + c.barsN, 0))
    // nome de cada pilar presente
    const ts = texts(d)
    for (const c of cols) expect(ts).toContain(c.name)
    expect(ts).toContain('PILARES — SEÇÕES E ARMADURAS (PRELIMINAR)')
  })
})

// ---------------------------------------------------------------------------
// detalhamento com dados fabricados (casos de borda)
// ---------------------------------------------------------------------------

describe('buildBeamDetailDrawing — dados fabricados', () => {
  const span: BeamDetailSpan = {
    beamId: 'b1',
    beamName: 'V9',
    spanIndex: 0,
    length: 4.2,
    section: { bw: 0.2, h: 0.5 },
    positive: { n: 3, phi: 0.0125, length: 4.8 },
    negLeft: null,
    negRight: { n: 2, phi: 0.01, length: 2.4 },
    stirrup: { phi: 0.005, spacing: 0.15, count: 29, unitLength: 1.35 },
  }

  it('vão único sem negativo à esquerda', () => {
    const d = buildBeamDetailDrawing('V9', [span])
    checkDrawing(d)
    const ts = texts(d)
    expect(ts).toContain('N1 3 φ 12,5 C=480')
    expect(ts).toContain('N2 2 φ 10 C=240')
    expect(ts).toContain('29×φ5 c/15')
    expect(ts).toContain('SEÇÃO 20x50')
    expect(d.primitives.find((p) => p.kind === 'dim')?.text).toBe('420')
  })

  it('escala do corte configurável (sectionScale)', () => {
    const d2 = buildBeamDetailDrawing('V9', [span], 4)
    checkDrawing(d2)
    // com escala maior o desenho fica mais alto (corte com h×4 = 2 m)
    expect(d2.bounds.maxY).toBeGreaterThan(buildBeamDetailDrawing('V9', [span]).bounds.maxY)
  })

  it('lista vazia de vãos não degenera', () => {
    checkDrawing(buildBeamDetailDrawing('V1', []))
  })
})

describe('buildColumnDetailDrawing — dados fabricados', () => {
  const col: ColumnDetailInfo = {
    columnId: 'c1',
    name: 'P99',
    section: { bw: 0.25, h: 0.6 },
    barsN: 6,
    barsPhi: 0.016,
    barPositions: [
      { x: -0.08, y: -0.24 },
      { x: 0.08, y: -0.24 },
      { x: -0.08, y: 0 },
      { x: 0.08, y: 0 },
      { x: -0.08, y: 0.24 },
      { x: 0.08, y: 0.24 },
    ],
    stirrupPhi: 0.005,
    stirrupSpacing: 0.19,
    storyHeights: [2.88, 2.88],
    lapLength: 0.6,
  }

  it('grade 4 por linha com textos de seção/estribo/traspasse', () => {
    const five = [0, 1, 2, 3, 4].map((i) => ({ ...col, name: `P${i + 1}` }))
    const d = buildColumnDetailDrawing(five)
    checkDrawing(d)
    const ts = texts(d)
    expect(ts).toContain('25×60 cm · 6 φ 16')
    expect(ts).toContain('estribo φ5 c/19 · traspasse 60')
    // 5ª seção quebra p/ a 2ª linha (y menor que a 1ª)
    const rects = d.primitives.filter((p) => p.kind === 'polyline' && p.layer === 'PILARES')
    expect(rects).toHaveLength(5)
    const ys = rects.map((r) => (r.kind === 'polyline' ? r.points[0].y : 0))
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys))
  })

  it('lista vazia não degenera', () => {
    checkDrawing(buildColumnDetailDrawing([]))
  })
})
