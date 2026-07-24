import { describe, expect, it } from 'vitest'
import { arcPoints, arcLength } from '../src/geometry/arc'

// corda 4 m, flecha 0,5 m ⇒ R = 16/(8·0,5) + 0,25 = 4,25 m; centro (2; −3,75)
describe('arcPoints (corda + flecha)', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 4, y: 0 }

  it('todos os pontos no círculo R = 4,25 e ápice em (2; 0,5)', () => {
    const pts = arcPoints(a, b, 0.5, 8)
    expect(pts).toHaveLength(7)
    for (const p of pts) {
      expect(Math.hypot(p.x - 2, p.y + 3.75)).toBeCloseTo(4.25, 9)
      expect(p.y).toBeGreaterThan(0) // abaúla p/ a esquerda de a→b (+y)
    }
    const apex = pts[3] // n=8 ⇒ ponto do meio
    expect(apex.x).toBeCloseTo(2, 9)
    expect(apex.y).toBeCloseTo(0.5, 9)
  })

  it('flecha negativa espelha (+y → −y); flecha < 5 mm não curva', () => {
    const pts = arcPoints(a, b, -0.5, 8)
    expect(pts[3].y).toBeCloseTo(-0.5, 9)
    expect(arcPoints(a, b, 0.004)).toHaveLength(0)
  })

  it('subdivisão automática respeita 2..24 e erro de corda pequeno', () => {
    const few = arcPoints(a, b, 0.05)
    const many = arcPoints(a, b, 1.9)
    expect(few.length + 1).toBeGreaterThanOrEqual(2)
    expect(many.length + 1).toBeLessThanOrEqual(24)
    expect(many.length).toBeGreaterThan(few.length)
  })

  it('arcLength: L = 2R·asin(c/2R) = 4,1646 m p/ corda 4/flecha 0,5', () => {
    expect(arcLength(4, 0.5)).toBeCloseTo(4.1646, 3)
    expect(arcLength(4, 0)).toBeCloseTo(4, 9)
  })
})
