import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'
import { buildColumnElevationDrawing } from '../src/drawing/columnElevation'

// ---------------------------------------------------------------------------
// Pilar executivo — elevação: arranques, traspasse por tramo, estribos, seção
// e quadro de ferros a partir do detailing real do projeto exemplo.
// ---------------------------------------------------------------------------

describe('buildColumnElevationDrawing', () => {
  const project = createSampleProject()
  const results = analyze(project)
  const det = results.detailing.columns[0]
  const d = buildColumnElevationDrawing(project, det)
  const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)

  it('título, arranques, tramos e quadro presentes', () => {
    expect(d.title).toBe(`PILAR ${det.name} — ELEVAÇÃO`)
    expect(texts.some((t) => t.startsWith('ARRANQUES'))).toBe(true)
    expect(texts.some((t) => t.startsWith('TRAMO 1:'))).toBe(true)
    expect(texts.some((t) => t.startsWith(`TRAMO ${det.storyHeights.length}:`))).toBe(true)
    expect(texts.some((t) => t.includes('QUADRO DE FERROS'))).toBe(true)
    expect(texts.some((t) => t.startsWith('TOTAL'))).toBe(true)
  })

  it('um traspasse por emenda (tramos − 1), com l0 em cm e §9.5.2', () => {
    const spl = texts.filter((t) => t.startsWith('traspasse'))
    expect(spl).toHaveLength(det.storyHeights.length - 1)
    expect(spl[0]).toContain(`${Math.round(det.lapLength * 100)} cm`)
    expect(spl[0]).toContain('9.5.2')
  })

  it('estribos desenhados na distribuição real (≥ Σ por tramo)', () => {
    const nSt = det.storyHeights.reduce(
      (s, h) => s + Math.max(2, Math.ceil(h / det.stirrupSpacing)),
      0,
    )
    const drawn = d.primitives.filter((p) => p.kind === 'line' && p.layer === 'ESTRIBOS').length
    expect(drawn).toBeGreaterThanOrEqual(nSt)
  })

  it('seção transversal com todas as barras (pontos = barsN)', () => {
    const dots = d.primitives.filter((p) => p.kind === 'circle' && p.layer === 'ARMADURA').length
    expect(dots).toBe(det.barsN)
  })

  it('quadro: uma linha por tramo com C = pé-direito + traspasse', () => {
    const t1 = texts.find((t) => t.startsWith('T1:'))!
    expect(t1).toBeDefined()
    const expectedLen = Math.round((det.storyHeights[0] + det.lapLength) * 100)
    expect(t1).toContain(`C=${expectedLen}`)
    expect(t1).toContain('kg')
  })
})
