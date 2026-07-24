import { describe, expect, it } from 'vitest'
import { checkFloorVibration, fcritForUse } from '../src/nbr/nbr6118/vibration'
import { runSlabDesign } from '../src/design/slabRun'
import { createSampleProject } from '../src/model/factory'

describe('vibração de piso §23.3', () => {
  it('âncora: δ = 4 mm ⇒ f1 = 18/√4 = 9 Hz; limite 1,2·fcrit', () => {
    const r = checkFloorVibration({ deltaQpImmediate: 0.004, fcrit: 3.5 })
    expect(r.f1).toBeCloseTo(9, 6)
    expect(r.limit).toBeCloseTo(4.2, 6)
    expect(r.ok).toBe(true)
  })
  it('piso mole reprova: δ = 30 mm ⇒ f1 = 3,29 < 4,2', () => {
    const r = checkFloorVibration({ deltaQpImmediate: 0.03, fcrit: 3.5 })
    expect(r.f1).toBeCloseTo(18 / Math.sqrt(30), 3)
    expect(r.ok).toBe(false)
  })
  it('fcrit por uso: academia 8 · dança 7 · escritório 4 · default 3,5', () => {
    expect(fcritForUse('Academia de ginástica')).toBe(8)
    expect(fcritForUse('Salão de dança')).toBe(7)
    expect(fcritForUse('Escritórios')).toBe(4)
    expect(fcritForUse('Residencial — dormitórios')).toBe(3.5)
    expect(fcritForUse(undefined)).toBe(3.5)
  })
  it('integração: lajes do projeto exemplo ganham f1 e nota §23.3', () => {
    const items = runSlabDesign(createSampleProject())
    const withVib = items.filter((i) => i.vibration)
    expect(withVib.length).toBeGreaterThan(0)
    for (const i of withVib) {
      expect(i.vibration!.f1).toBeGreaterThan(0)
      expect(i.notes.some((n) => n.includes('23.3'))).toBe(true)
    }
  })
})
