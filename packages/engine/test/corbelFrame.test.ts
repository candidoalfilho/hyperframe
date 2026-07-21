import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'
import { buildColumnElevationDrawing } from '../src/drawing/columnElevation'

// ---------------------------------------------------------------------------
// Consolo → pórtico (G = Fd/1,4 + momento da excentricidade) e elevação.
// ---------------------------------------------------------------------------

describe('carga do consolo no pórtico', () => {
  const base = analyze(createSampleProject())
  const withCorbel = (() => {
    const p = createSampleProject()
    const col = p.columns[0]
    col.corbels = [
      { id: 'cb1', levelId: p.levels[1].id, rotationDeg: 0, bw: 0.3, d: 0.5, a: 0.25, fd: 140 },
    ]
    return analyze(p)
  })()

  it('ΣFz do caso G cresce exatamente Fd/1,4 = 100 kN', () => {
    const sum = (r: typeof base) => r.cases.elu.G!.reactions.reduce((s, x) => s + x.fz, 0)
    expect(sum(withCorbel) - sum(base)).toBeCloseTo(100, 0)
  })

  it('aviso no modelo + momento muda o pilar (excentricidade)', () => {
    expect(withCorbel.model.warnings.some((w) => w.includes('consolo'))).toBe(true)
    const name = (r: typeof base, i: number) => r.columnDesign[i]
    // pilar com consolo ganha momento adicional → mdU/mdV não idênticos ao base
    const c0 = base.columnDesign.find((c) => c.name === name(withCorbel, 0).name)!
    const c1 = withCorbel.columnDesign.find((c) => c.name === c0.name)!
    expect(Math.abs(c1.mdU - c0.mdU) + Math.abs(c1.mdV - c0.mdV) + Math.abs(c1.nd - c0.nd)).toBeGreaterThan(1)
  })
})

describe('consolo na elevação do pilar', () => {
  it('desenha caixa + tirante + texto com verificação §22.5', () => {
    const p = createSampleProject()
    const col = p.columns[0]
    col.corbels = [
      { id: 'cb1', levelId: p.levels[1].id, rotationDeg: 0, bw: 0.3, d: 0.5, a: 0.25, fd: 200 },
    ]
    const results = analyze(p)
    const det = results.detailing.columns.find((c) => c.columnId === col.id)!
    const d = buildColumnElevationDrawing(p, det)
    const texts = d.primitives.filter((x) => x.kind === 'text').map((x) => (x as { text: string }).text)
    const t = texts.find((x) => x.startsWith('CONSOLO'))!
    expect(t).toBeDefined()
    expect(t).toContain('tirante')
    expect(t).toContain('§22.5')
    expect(t).toContain('Fd=200')
  })
})
