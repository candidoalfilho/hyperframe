import { describe, expect, it } from 'vitest'
import { designCaisson } from '../src/nbr/nbr6122/caisson'
import { checkPunching, openingPerimeterReduction, punchingK } from '../src/nbr/nbr6118/punching'
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

// ---------------------------------------------------------------------------
// Aberturas próximas ao pilar — §19.5.1 (desconto do perímetro crítico)
// ---------------------------------------------------------------------------

describe('openingPerimeterReduction (§19.5.1)', () => {
  // furo quadrado 0,4×0,4 centrado em (1; 0), pilar na origem:
  // tangentes ≈ vértices (0,8; ±0,2) → semiângulo atan(0,2/0,8) = 14,04°
  // ⇒ setor 28,07° ⇒ fração 28,07/360 = 0,078
  const hole = [
    { x: 0.8, y: -0.2 },
    { x: 1.2, y: -0.2 },
    { x: 1.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
  ]

  it('âncora manual do setor angular subtendido', () => {
    const f = openingPerimeterReduction({ x: 0, y: 0 }, [hole], 0.16) // 8d = 1,28 m
    expect(f).toBeCloseTo(0.078, 3)
  })

  it('furo além de 8d não desconta nada', () => {
    expect(openingPerimeterReduction({ x: 0, y: 0 }, [hole], 0.05)).toBe(0) // 8d = 0,40 m
  })

  it('desconto satura em 50% (vários furos ao redor)', () => {
    const ring = [0, 90, 180, 270].map((deg) => {
      const a = (deg * Math.PI) / 180
      return hole.map((p) => {
        // gira o furo p/ os 4 quadrantes
        const r = Math.hypot(p.x, p.y)
        const t = Math.atan2(p.y, p.x) + a
        return { x: r * Math.cos(t), y: r * Math.sin(t) }
      })
    })
    const f = openingPerimeterReduction({ x: 0, y: 0 }, ring, 0.2)
    expect(f).toBeGreaterThan(0.2)
    expect(f).toBeLessThanOrEqual(0.5)
  })

  it('checkPunching aplica a fração aos dois perímetros', () => {
    const base = {
      fsd: 300,
      column: { shape: 'rect', c1: 0.35, c2: 0.35 },
      d: 0.16,
      rhoX: 0.005,
      rhoY: 0.005,
      fck: 30000,
      gammaC: 1.4,
    } as const
    const cheio = checkPunching({ ...base })
    const furado = checkPunching({ ...base, openingFraction: 0.2 })
    expect(furado.u0).toBeCloseTo(cheio.u0 * 0.8, 9)
    expect(furado.u1).toBeCloseTo(cheio.u1 * 0.8, 9)
    expect(furado.tauSd1).toBeCloseTo(cheio.tauSd1 / 0.8, 6)
    expect(furado.notes.some((n) => n.includes('§19.5.1'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pilar de borda e de canto — §19.5.2 (u*, e*, K·MSd/Wp)
// ---------------------------------------------------------------------------

describe('punção §19.5.2 — borda e canto (40×40, d = 16 cm)', () => {
  const base = {
    fsd: 800,
    column: { shape: 'rect', c1: 0.4, c2: 0.4 },
    d: 0.16,
    rhoX: 0.008,
    rhoY: 0.008,
    fck: 30000,
    gammaC: 1.4,
  } as const

  it('Wp por integração bate com as fórmulas fechadas (interno)', () => {
    // extrai Wp da diferença de τ com/sem momento: parcela = K·MSd/(Wp·d)
    const semM = checkPunching({ ...base })
    const comM = checkPunching({ ...base, msd1: 100 })
    const K = 0.6 // c1/c2 = 1 (tab. 19.2)
    const wp1 = (K * 100) / ((comM.tauSd1 - semM.tauSd1) * 0.16)
    // C′: c1²/2 + c1c2 + 4c2d + 16d² + 2πdc1 = 1,3077 m²
    expect(wp1).toBeCloseTo(
      0.4 ** 2 / 2 + 0.16 + 4 * 0.4 * 0.16 + 16 * 0.16 ** 2 + 2 * Math.PI * 0.16 * 0.4,
      2,
    )
    const wp0 = (K * 100) / ((comM.tauSd0 - semM.tauSd0) * 0.16)
    // C: c1²/2 + c1c2 = 0,24 m²
    expect(wp0).toBeCloseTo(0.24, 2)
  })

  it('borda: u* = 2a + c2 + 2πd e u0 reduzido (a = mín(1,5d; 0,5c1) = 0,2)', () => {
    const e = checkPunching({ ...base, position: 'edge' })
    expect(e.position).toBe('edge')
    expect(e.u1).toBeCloseTo(2 * 0.2 + 0.4 + Math.PI * 2 * 0.16, 3) // 1,805 m
    expect(e.u0).toBeCloseTo(2 * 0.2 + 0.4, 3) // 0,80 m
    // e* > 0 (centroide do perímetro reduzido cai p/ dentro da laje)
    expect(e.eStar).toBeGreaterThan(0.25)
    expect(e.eStar!).toBeLessThan(0.4)
    // com o mesmo FSd, borda é mais crítica que interno
    const i = checkPunching({ ...base })
    expect(e.tauSd1).toBeGreaterThan(i.tauSd1)
  })

  it('borda: MSd1 = FSd·e* não gera parcela de momento (MSd corrigido = 0)', () => {
    const e0 = checkPunching({ ...base, position: 'edge' })
    const eM = checkPunching({ ...base, position: 'edge', msd1: 800 * e0.eStar! })
    expect(eM.tauSd1).toBeCloseTo(e0.tauSd1, 4)
    // acima disso o momento passa a contar
    const eM2 = checkPunching({ ...base, position: 'edge', msd1: 800 * e0.eStar! + 50 })
    expect(eM2.tauSd1).toBeGreaterThan(e0.tauSd1 + 1)
  })

  it('canto: u* = a1 + a2 + πd — o mais crítico dos três', () => {
    const c = checkPunching({ ...base, position: 'corner' })
    expect(c.u1).toBeCloseTo(0.2 + 0.2 + Math.PI * 0.16, 3) // 0,903 m
    expect(c.u0).toBeCloseTo(0.2 + 0.2, 3)
    const e = checkPunching({ ...base, position: 'edge' })
    expect(c.tauSd1).toBeGreaterThan(e.tauSd1)
  })

  it('K da tabela 19.2 interpola e clampa', () => {
    expect(punchingK(0.5)).toBeCloseTo(0.45, 9)
    expect(punchingK(1)).toBeCloseTo(0.6, 9)
    expect(punchingK(1.5)).toBeCloseTo(0.65, 9)
    expect(punchingK(2)).toBeCloseTo(0.7, 9)
    expect(punchingK(0.2)).toBeCloseTo(0.45, 9)
    expect(punchingK(5)).toBeCloseTo(0.8, 9)
  })
})
