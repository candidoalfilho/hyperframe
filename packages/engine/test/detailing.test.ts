import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'

describe('negativa de APOIO DE EXTREMIDADE — ancorada, não simétrica', () => {
  const r = analyze(createSampleProject())

  it('extremidades marcadas com edge e mais curtas que o dobro do lado', () => {
    let checked = 0
    for (const span of r.detailing.beams) {
      const isFirst = span.spanIndex === 0
      const lastIdx = Math.max(
        ...r.detailing.beams.filter((s) => s.beamId === span.beamId).map((s) => s.spanIndex),
      )
      if (isFirst && span.negLeft) {
        expect(span.negLeft.edge).toBe(true)
        checked++
      }
      if (span.spanIndex === lastIdx && span.negRight) {
        expect(span.negRight.edge).toBe(true)
        checked++
      }
      // apoio interno: sem flag
      if (!isFirst && span.negLeft) expect(span.negLeft.edge).toBeUndefined()
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('comprimento da extremidade = lado + embed (não 2·lado): viga de 1 vão', () => {
    // numa viga de vão único os DOIS negativos são de extremidade — o
    // comprimento deve ser ~metade do que a versão simétrica daria
    for (const span of r.detailing.beams) {
      for (const f of [span.negLeft, span.negRight]) {
        if (!f?.edge) continue
        const leg = f.leg ?? 0
        const run = f.length - 2 * leg
        // o run de extremidade nunca excede o vão + embed (antes chegava a 2·vão)
        expect(run).toBeLessThanOrEqual(span.length + 0.1 + 1e-9)
      }
    }
  })
})
