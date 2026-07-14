import { describe, expect, it } from 'vitest'
import { designCaisson } from '../src/nbr/nbr6122/caisson'
import { checkPunching } from '../src/nbr/nbr6118/punching'
import { checkConsistency } from '../src/model/consistency'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { uid } from '../src/model/uid'

describe('tubulões — âncoras manuais', () => {
  it('N=1200 kN, σadm=400 kPa, σc=5 MPa: fuste 0,70 (mínimo) e base 1,95+rasante 60°', () => {
    const r = designCaisson({ nServ: 1200, sigmaAdm: 400, sigmaConcrete: 5000 })
    // fuste: √(4·1200/(π·5000)) = 0,553 → mínimo 0,70
    expect(r.shaftD).toBeCloseTo(0.7, 9)
    // base: √(4·1200/(π·400)) = 1,954 → arredonda p/ CIMA no passo de 5 cm = 2,00
    expect(r.baseD).toBeCloseTo(2.0, 9)
    // rasante 60°: (2,00−0,70)/2·tan60 = 1,126
    expect(r.baseH).toBeCloseTo(((2.0 - 0.7) / 2) * Math.tan(Math.PI / 3), 6)
    expect(r.sigmaBase).toBeLessThanOrEqual(400)
    expect(r.sigmaShaft).toBeLessThanOrEqual(5000)
    expect(r.status).toBe('ok')
  })

  it('carga alta governa o fuste pela tensão do concreto', () => {
    const r = designCaisson({ nServ: 4000, sigmaAdm: 500, sigmaConcrete: 5000 })
    // fuste: √(4·4000/(π·5000)) = 1,009 → 1,05 (passo 5 cm)
    expect(r.shaftD).toBeCloseTo(1.05, 9)
    expect(r.sigmaShaft).toBeLessThanOrEqual(5000)
  })

  it('base muito alta (> 1,80 m) vira atenção', () => {
    const r = designCaisson({ nServ: 3000, sigmaAdm: 120, sigmaConcrete: 5000 })
    // base ≈ √(4·3000/(π·120)) = 5,64 → rasante enorme
    expect(r.baseH).toBeGreaterThan(1.8)
    expect(r.status).toBe('atencao')
  })

  it('análise completa com fundação em tubulão preenche a tabela', () => {
    const p = createSampleProject()
    p.settings.foundation.type = 'tubulao'
    p.settings.foundation.caissonSigmaConcrete = 5000
    const r = analyze(p)
    expect(r.foundations.length).toBeGreaterThan(0)
    for (const f of r.foundations) {
      expect(f.kind).toBe('tubulao')
      expect(f.caisson).not.toBeNull()
      expect(f.caisson!.baseD).toBeGreaterThanOrEqual(f.caisson!.shaftD)
    }
  })

  it('interação solo-estrutura funciona sobre tubulões (molas da base)', () => {
    const p = createSampleProject()
    p.settings.foundation.type = 'tubulao'
    p.settings.soilInteraction.enabled = true
    const r = analyze(p)
    expect(r.soilInteraction.items).toHaveLength(p.columns.length)
    expect(r.soilInteraction.items[0].kind).toBe('tubulao')
    expect(r.soilInteraction.maxSettlement).toBeGreaterThan(0)
  })
})

describe('punção §19.5 — âncora manual (pilar interno 40×40, d=16 cm)', () => {
  const out = checkPunching({
    fsd: 800,
    column: { shape: 'rect', c1: 0.4, c2: 0.4 },
    d: 0.16,
    rhoX: 0.008,
    rhoY: 0.008,
    fck: 30000,
    gammaC: 1.4,
  })

  it('perímetros C e C′ (u0 = 1,6; u1 = 1,6 + 4πd)', () => {
    expect(out.u0).toBeCloseTo(1.6, 9)
    expect(out.u1).toBeCloseTo(1.6 + 4 * Math.PI * 0.16, 6)
  })

  it('τSd0 = 3125 kPa ≤ τRd2 = 0,27·0,88·fcd = 5091 kPa', () => {
    expect(out.tauSd0).toBeCloseTo(800 / (1.6 * 0.16), 3)
    expect(out.tauRd2).toBeCloseTo(0.27 * (1 - 30 / 250) * (30000 / 1.4), 3)
    expect(out.okC).toBe(true)
  })

  it('τRd1 = 0,13·(1+√(20/16))·(100·0,008·30)^{1/3} = 0,794 MPa — exige armadura', () => {
    const expected = 0.13 * (1 + Math.sqrt(20 / 16)) * Math.cbrt(24) * 1000
    expect(out.tauRd1).toBeCloseTo(expected, 3)
    expect(out.tauSd1).toBeCloseTo(800 / (out.u1 * 0.16), 6)
    expect(out.okC1).toBe(false)
    expect(out.needsShearReinf).toBe(true)
  })

  it('pilar circular usa perímetros circulares', () => {
    const c = checkPunching({
      fsd: 400,
      column: { shape: 'circle', d: 0.5 },
      d: 0.18,
      rhoX: 0.006,
      rhoY: 0.006,
      fck: 30000,
      gammaC: 1.4,
    })
    expect(c.u0).toBeCloseTo(Math.PI * 0.5, 9)
    expect(c.u1).toBeCloseTo(Math.PI * (0.5 + 4 * 0.18), 9)
  })
})

describe('consistência — laje lisa e pilar-parede', () => {
  it('pilar interno à laje sem viga é apontado (laje lisa não modelada)', () => {
    const p = createSampleProject()
    p.columns.push({
      id: uid('col'),
      name: 'P99',
      pos: { x: 2, y: 2 }, // dentro da laje L1 (célula 0–4 × 0–4,5), longe das vigas
      section: { bw: 0.3, h: 0.3 },
      rotationDeg: 0,
      baseLevelId: p.levels[0].id,
      topLevelId: p.levels[p.levels.length - 1].id,
    })
    const issues = checkConsistency(p)
    expect(
      issues.some((i) => i.message.includes('P99') && i.message.includes('GRELHA')),
    ).toBe(true)
    // com o método da grelha o apontamento vira informativo (leve)
    p.settings.slabMethod = 'grelha'
    const issues2 = checkConsistency(p)
    const flat = issues2.find((i) => i.message.includes('P99') && i.message.includes('punção'))
    expect(flat?.severity).toBe('leve')
  })

  it('pilar-parede (b/h ≥ 5) recebe aviso do §15.9', () => {
    const p = createSampleProject()
    p.columns[0].section = { bw: 0.2, h: 1.2 }
    const issues = checkConsistency(p)
    expect(issues.some((i) => i.message.includes('pilar-parede'))).toBe(true)
  })
})
