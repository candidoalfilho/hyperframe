import { describe, expect, it } from 'vitest'
import { designBeamTorsion, skinReinforcement } from '../src/nbr/nbr6118/beamDesign'
import { crackLimit, crackWidth, stadium2NeutralAxis } from '../src/nbr/nbr6118/cracking'
import { shiftAl } from '../src/nbr/nbr6118/anchorage'

function relErr(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1)
}

// ---------------------------------------------------------------------------
// Torção — NBR 6118 §17.5 (âncoras à mão: 20×50, C25, c1 = 4,43 cm)
// ---------------------------------------------------------------------------

const TORSION_BASE = {
  vd: 50,
  vrd2: 390.5, // 0,27·0,9·17857·0,2·0,45
  bw: 0.2,
  h: 0.5,
  c1: 0.0443,
  fck: 25_000,
  fcd: 17_857.1,
  fctd: 1_282.4,
  fywd: 434_782.6,
  fyd: 434_782.6,
}

describe('designBeamTorsion (NBR 6118 §17.5)', () => {
  it('âncora Td = 10 kN·m: he, Ae, TRd2, A90/s e Asl', () => {
    const r = designBeamTorsion({ td: 10, ...TORSION_BASE })
    // he = max(A/u = 0,0714; 2c1 = 0,0886) = 0,0886 m
    expect(relErr(r.he, 0.0886)).toBeLessThan(1e-3)
    // Ae = (0,2−he)(0,5−he) = 0,04583 m²
    expect(relErr(r.ae, 0.04583)).toBeLessThan(2e-3)
    // TRd2 = 0,5·0,9·fcd·Ae·he = 32,6 kN·m
    expect(relErr(r.trd2, 32.63)).toBeLessThan(5e-3)
    // A90/s = Td/(2·Ae·fywd) = 2,509 cm²/m
    expect(relErr(r.a90S, 2.509e-4)).toBeLessThan(5e-3)
    // Asl = Td·ue/(2·Ae·fyd), ue = 1,0456 m → 2,624 cm²
    expect(relErr(r.asl, 2.624e-4)).toBeLessThan(5e-3)
    // interação: 50/390,5 + 10/32,63 = 0,4345
    expect(relErr(r.interaction, 0.4345)).toBeLessThan(5e-3)
    expect(r.ok).toBe(true)
    expect(r.negligible).toBe(false)
  })

  it('torção de compatibilidade pequena é desprezível (sem armadura extra)', () => {
    const r = designBeamTorsion({ td: 1.0, ...TORSION_BASE })
    expect(r.negligible).toBe(true)
    expect(r.a90S).toBe(0)
    expect(r.asl).toBe(0)
  })

  it('interação > 1 → falha da biela', () => {
    const r = designBeamTorsion({ td: 30, ...TORSION_BASE, vd: 200 })
    // 200/390,5 + 30/32,63 = 1,43
    expect(r.interaction).toBeGreaterThan(1)
    expect(r.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Armadura de pele — §17.3.5.2.3
// ---------------------------------------------------------------------------

describe('skinReinforcement (§17.3.5.2.3)', () => {
  it('h ≤ 60 cm → dispensada', () => {
    const r = skinReinforcement(0.2, 0.5)
    expect(r.required).toBe(false)
    expect(r.asPerFace).toBe(0)
  })
  it('h = 80 cm, bw = 25 → 0,10%·bw·h = 2,0 cm² por face (4 φ 8)', () => {
    const r = skinReinforcement(0.25, 0.8)
    expect(r.required).toBe(true)
    expect(relErr(r.asPerFace, 2.0e-4)).toBeLessThan(1e-9)
    expect(r.spec).toBe('4 φ 8 por face')
  })
})

// ---------------------------------------------------------------------------
// Fissuração ELS-W — §17.3.3.2 (âncora: 20×50, C25, As = 5 cm², Ms = 60 kN·m)
// ---------------------------------------------------------------------------

describe('crackWidth (§17.3.3.2)', () => {
  const inp = {
    ms: 60,
    bw: 0.2,
    h: 0.5,
    d: 0.45,
    as: 5e-4,
    phi: 0.0125,
    alphaE: 8.6957, // 210000/24150 (C25 granito)
    es: 210_000_000,
    fctm: 2565,
  }

  it('LN do estádio II: x = 0,1198 m', () => {
    expect(relErr(stadium2NeutralAxis(0.2, 0.45, 5e-4, 8.6957), 0.11982)).toBeLessThan(1e-3)
  })

  it('σs = 292,6 MPa · w1 = 0,212 mm · w2 = 0,152 mm → wk = 0,152 mm', () => {
    const r = crackWidth(inp)
    expect(relErr(r.sigmaS, 292_641)).toBeLessThan(3e-3)
    expect(relErr(r.rhoRi, 0.02)).toBeLessThan(2e-3)
    expect(relErr(r.w1, 2.12e-4)).toBeLessThan(0.01)
    expect(relErr(r.w2, 1.5174e-4)).toBeLessThan(0.01)
    expect(r.wk).toBeCloseTo(r.w2, 12)
  })

  it('momento nulo ou sem armadura → wk = 0', () => {
    expect(crackWidth({ ...inp, ms: 0 }).wk).toBe(0)
    expect(crackWidth({ ...inp, as: 0 }).wk).toBe(0)
  })

  it('limites da tab. 13.4: CAA I 0,4 · II/III 0,3 · IV 0,2 mm', () => {
    expect(crackLimit('I')).toBeCloseTo(0.4e-3, 12)
    expect(crackLimit('II')).toBeCloseTo(0.3e-3, 12)
    expect(crackLimit('III')).toBeCloseTo(0.3e-3, 12)
    expect(crackLimit('IV')).toBeCloseTo(0.2e-3, 12)
  })
})

// ---------------------------------------------------------------------------
// Decalagem al — NBR 6118 §17.4.2.2.c (modelo I, estribos a 90°)
// ---------------------------------------------------------------------------

describe('decalagem al do diagrama (§17.4.2.2)', () => {
  it('âncora manual: d=0,45 m, VSd=200 kN, Vc=80 kN → al = 0,45·200/(2·120) = 0,375 m', () => {
    expect(shiftAl(0.45, 200, 80)).toBeCloseTo(0.375, 9)
  })

  it('clampa no teto d quando VSd se aproxima de Vc', () => {
    // 0,45·100/(2·20) = 1,125 m > d ⇒ al = d
    expect(shiftAl(0.45, 100, 80)).toBeCloseTo(0.45, 9)
  })

  it('piso 0,5·d quando VSd ≤ Vc (ou nulo)', () => {
    expect(shiftAl(0.45, 70, 80)).toBeCloseTo(0.225, 9)
    expect(shiftAl(0.45, 0, 80)).toBeCloseTo(0.225, 9)
  })
})
