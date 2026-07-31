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

// ---------------------------------------------------------------------------
// FASE 2: grupos por aberturas + contraventamento ao vento
// ---------------------------------------------------------------------------

import { checkMasonryShearFlex, masonryPiers } from '../src/nbr/nbr16868/masonry'

describe('masonryPiers (grupos entre aberturas)', () => {
  it('parede 6 m c/ porta central de 1 m ⇒ 2 trechos de 2,5 m, concentração 1,2', () => {
    const piers = masonryPiers(6, [{ x: 3, width: 1 }])
    expect(piers).toHaveLength(2)
    expect(piers[0].x1 - piers[0].x0).toBeCloseTo(2.5, 6)
    // tributária do 1º trecho: 0 → meio da abertura (3,0) ⇒ 3,0/2,5 = 1,2
    expect(piers[0].concentration).toBeCloseTo(1.2, 6)
    expect(piers[1].concentration).toBeCloseTo(1.2, 6)
  })
  it('sem aberturas ⇒ 1 trecho com concentração 1', () => {
    const piers = masonryPiers(4, [])
    expect(piers).toHaveLength(1)
    expect(piers[0].concentration).toBeCloseTo(1, 9)
  })
})

describe('checkMasonryShearFlex (contraventamento)', () => {
  // L=4 · t=0,14 · Gk=200 kN · Nd=350 · Md=180 · Vd=60 · fpk=6 MPa concreto:
  //   A=0,56 · W=0,3733 · σpre=0,9·200/0,56=321,4 → fvk=310,7 · fvd=155,4
  //   τd=60/0,56=107,1 OK · σmáx=625+482,2=1107,2 ≤ fd=2100 OK
  //   σmin=321,4−482,2=−160,8 <0 ⇒ Lt=0,507 m · T=5,71 kN · As=0,13 cm²
  const BASE = { length: 4, thickness: 0.14, block: 'concreto' as const, fpk: 6000 }
  it('âncora completa: cisalhamento, bordas e tração ⇒ graute + armadura', () => {
    const r = checkMasonryShearFlex({ ...BASE, vd: 60, md: 180, nd: 350, ngk: 200 })
    expect(r.fvd).toBeCloseTo(155.4, 0)
    expect(r.tauD).toBeCloseTo(107.1, 0)
    expect(r.shearOk).toBe(true)
    expect(r.sigmaMax).toBeCloseTo(1107.2, 0)
    expect(r.compressionOk).toBe(true)
    expect(r.sigmaMin).toBeCloseTo(-160.8, 0)
    expect(r.needsReinf).toBe(true)
    expect(r.tension).toBeCloseTo(5.71, 1)
    expect(r.asTie * 1e4).toBeCloseTo(0.131, 1)
    expect(r.notes.join(' ')).toMatch(/grautear/i)
  })
  it('fvk limitado a 1,4 MPa e cortante alto reprova', () => {
    const r = checkMasonryShearFlex({ ...BASE, vd: 500, md: 0, nd: 4000, ngk: 4000 })
    expect(r.fvd).toBeCloseTo(700, 0) // 1400/2
    expect(r.shearOk).toBe(false)
  })
})

describe('runMasonry F2 (vento distribuído por rigidez)', () => {
  it('paredes alinhadas recebem vento (τd > 0) e a compressão segue verificada', () => {
    const project = createSampleProject()
    project.settings.wind.enabled = true
    const plan = [...project.plans].sort((a, b) => b.slabs.length - a.slabs.length)[0]
    const sl = plan.slabs[0]
    plan.masonryWalls = [
      { id: 'mw1', name: 'PAR1', path: [sl.polygon[0], sl.polygon[1]], thickness: 0.14, block: 'concreto', fpk: 8000 },
      { id: 'mw2', name: 'PAR2', path: [sl.polygon[1], sl.polygon[2]], thickness: 0.14, block: 'concreto', fpk: 8000 },
    ]
    const items = runMasonry(project)
    const withWind = items.filter((m) => m.wind)
    expect(withWind.length).toBeGreaterThan(0)
    expect(withWind.some((m) => m.wind!.vd > 0)).toBe(true)
    // pavimento mais baixo tem mais cortante que o mais alto (acúmulo)
    const w1 = withWind.filter((m) => m.wallId === 'mw1').sort((a, b) => a.levelIndex - b.levelIndex)
    if (w1.length > 1) expect(w1[0].wind!.vd).toBeGreaterThanOrEqual(w1[w1.length - 1].wind!.vd)
  })
})
