import { describe, expect, it } from 'vitest'
import { checkMasonryWall } from '../src/nbr/nbr16868/masonry'
import { runMasonry } from '../src/design/masonryRun'
import { createSampleProject } from '../src/model/factory'

// Parede bloco de concreto 14, pé-direito 2,80, fpk = 6 MPa:
//   λ = 2,8/0,14 = 20 ≤ 24 · R = 1 − (20/40)³ = 0,875
//   fk = 0,7·6 = 4,2 MPa · fd = 2,1 · NRd = 2100·0,14·0,875 = 257,25 kN/m
describe('checkMasonryWall (NBR 16868 — compressão simples)', () => {
  const BASE = { thickness: 0.14, height: 2.8, block: 'concreto' as const, fpk: 6000 }

  it('âncora: λ=20, R=0,875, NRd=257,25 kN/m; uso 70% p/ Nd=180', () => {
    const r = checkMasonryWall({ ...BASE, nd: 180 })
    expect(r.lambda).toBeCloseTo(20, 6)
    expect(r.r).toBeCloseTo(0.875, 6)
    expect(r.fk).toBeCloseTo(4200, 6)
    expect(r.nRd).toBeCloseTo(257.25, 2)
    expect(r.utilization).toBeCloseTo(180 / 257.25, 4)
    expect(r.ok).toBe(true)
    // fpk nec. = 1,05·180·2/(0,7·0,14·0,875) = 4408 kPa
    expect(r.fpkRequired).toBeCloseTo(4408.2, 0)
  })

  it('cerâmico usa 0,6·fpk; λ > 24 reprova alvenaria não armada', () => {
    const cer = checkMasonryWall({ ...BASE, block: 'ceramico', nd: 100 })
    expect(cer.fk).toBeCloseTo(3600, 6)
    const slender = checkMasonryWall({ ...BASE, height: 3.6, nd: 50 })
    expect(slender.lambda).toBeGreaterThan(24)
    expect(slender.slendernessOk).toBe(false)
    expect(slender.ok).toBe(false)
    expect(slender.notes.join(' ')).toMatch(/λ/)
  })

  it('sobrecarga: Nd > NRd ⇒ falha com fpk sugerido maior que o atual', () => {
    const r = checkMasonryWall({ ...BASE, nd: 300 })
    expect(r.ok).toBe(false)
    expect(r.fpkRequired).toBeGreaterThan(6000)
  })
})

describe('runMasonry (acúmulo vertical por pavimento)', () => {
  it('parede no plano tipo acumula do topo p/ a base (Nd base > Nd topo)', () => {
    const project = createSampleProject()
    const plan = [...project.plans].sort((a, b) => b.slabs.length - a.slabs.length)[0]
    const sl = plan.slabs[0]
    plan.masonryWalls = [
      {
        id: 'mw1',
        name: 'PAR1',
        path: [sl.polygon[0], sl.polygon[1]],
        thickness: 0.14,
        block: 'concreto',
        fpk: 8000,
      },
    ]
    const items = runMasonry(project)
    expect(items.length).toBeGreaterThan(1) // um por pavimento que usa a planta
    const sorted = [...items].sort((a, b) => a.levelIndex - b.levelIndex)
    expect(sorted[0].nd).toBeGreaterThan(sorted[sorted.length - 1].nd)
    // peso próprio mínimo por pavimento: 1,4·0,14·h·14 > 0
    expect(sorted[sorted.length - 1].nd).toBeGreaterThan(5)
    expect(sorted[0].notes.join(' ')).toMatch(/prisma/i)
  })
})
