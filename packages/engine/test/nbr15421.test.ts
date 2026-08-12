import { describe, expect, it } from 'vitest'
import {
  approxPeriod,
  designSpectrum,
  distributionExponent,
  DRIFT_LIMIT,
  IMPORTANCE,
  seismicAmplification,
  seismicResponseCoefficient,
  SEISMIC_SYSTEMS,
  stabilityCoefficient,
  verticalDistribution,
  ZONE_AG,
} from '../src/nbr/nbr15421/seismic'

/**
 * Âncoras calculadas à mão sobre a NBR 15421 (tab. 1, tab. 3, §5.3, §9).
 * Valores de Ca/Cv conferidos com a transcrição da tabela 3 (UFMG/UFRGS):
 * A 0,8/0,8 · B 1,0/1,0 · C 1,2/1,7 · D 1,6→1,5/2,4→2,2 · E 2,5→2,1/3,5→3,4.
 */
describe('NBR 15421 — amplificação e espectro', () => {
  it('tab. 3: valores diretos por classe (ag ≤ 0,10g)', () => {
    expect(seismicAmplification(0.1, 'A')).toEqual({ Ca: 0.8, Cv: 0.8 })
    expect(seismicAmplification(0.1, 'B')).toEqual({ Ca: 1.0, Cv: 1.0 })
    expect(seismicAmplification(0.1, 'C')).toEqual({ Ca: 1.2, Cv: 1.7 })
    expect(seismicAmplification(0.1, 'D')).toEqual({ Ca: 1.6, Cv: 2.4 })
    expect(seismicAmplification(0.1, 'E')).toEqual({ Ca: 2.5, Cv: 3.5 })
  })

  it('tab. 3: coluna ag = 0,15g e interpolação linear em 0,125g', () => {
    expect(seismicAmplification(0.15, 'D')).toEqual({ Ca: 1.5, Cv: 2.2 })
    expect(seismicAmplification(0.15, 'E')).toEqual({ Ca: 2.1, Cv: 3.4 })
    // 0,125g = meio do intervalo → média das colunas
    const d = seismicAmplification(0.125, 'D')
    expect(d.Ca).toBeCloseTo(1.55, 10)
    expect(d.Cv).toBeCloseTo(2.3, 10)
  })

  it('espectro ag=0,10g solo C: ags0=0,12, ags1=0,17, ramos conferidos à mão', () => {
    const s = designSpectrum(0.1, 'C')
    expect(s.ags0).toBeCloseTo(0.12, 10)
    expect(s.ags1).toBeCloseTo(0.17, 10)
    // limites dos ramos: 0,08·Cv/Ca = 0,11333 s; 0,4·Cv/Ca = 0,56667 s
    expect(s.t0).toBeCloseTo(0.08 * (1.7 / 1.2), 10)
    expect(s.t1).toBeCloseTo(0.4 * (1.7 / 1.2), 10)
    // T = 0: Sa = ags0
    expect(s.Sa(0)).toBeCloseTo(0.12, 10)
    // ramo linear em T = 0,05 s: 0,12·(18,75·0,05·1,2/1,7 + 1) = 0,199411…
    expect(s.Sa(0.05)).toBeCloseTo(0.12 * (18.75 * 0.05 * (1.2 / 1.7) + 1), 10)
    // platô: 2,5·ags0 = 0,30
    expect(s.Sa(0.3)).toBeCloseTo(0.3, 10)
    // ramo descendente: Sa(1,0) = ags1 = 0,17; Sa(2,0) = 0,085
    expect(s.Sa(1.0)).toBeCloseTo(0.17, 10)
    expect(s.Sa(2.0)).toBeCloseTo(0.085, 10)
    // continuidade nos limites
    expect(s.Sa(s.t0)).toBeCloseTo(2.5 * s.ags0, 6)
    expect(s.Sa(s.t1)).toBeCloseTo(s.ags1 / s.t1, 6)
  })

  it('zonas da tab. 1', () => {
    expect(ZONE_AG[0]).toBe(0.025)
    expect(ZONE_AG[1]).toBe(0.05)
    expect(ZONE_AG[2]).toBe(0.1)
    expect(ZONE_AG[3]).toBe(0.15)
    expect(ZONE_AG[4]).toBe(0.15)
  })
})

describe('NBR 15421 §9 — forças horizontais equivalentes', () => {
  const s = designSpectrum(0.1, 'C') // ags0 = 0,12; ags1 = 0,17

  it('Cs no platô: 2,5·0,12/(3/1) = 0,10', () => {
    const r = seismicResponseCoefficient(s, 0.3, 3, 1)
    expect(r.cs).toBeCloseTo(0.1, 10)
    expect(r.governedBy).toBe('plato')
  })

  it('Cs limitado pelo período: T=1,0s → 0,17/(1·3) = 0,056667', () => {
    const r = seismicResponseCoefficient(s, 1.0, 3, 1)
    expect(r.cs).toBeCloseTo(0.17 / 3, 10)
    expect(r.governedBy).toBe('periodo')
  })

  it('Cs piso 0,01 (zona fraca, R alto, T longo)', () => {
    const weak = designSpectrum(0.025, 'A')
    const r = seismicResponseCoefficient(weak, 3.0, 8, 1)
    expect(r.cs).toBe(0.01)
    expect(r.governedBy).toBe('minimo')
  })

  it('fator de importância entra a favor: I=1,5 aumenta Cs em 50%', () => {
    const r1 = seismicResponseCoefficient(s, 0.3, 3, 1)
    const r15 = seismicResponseCoefficient(s, 0.3, 3, 1.5)
    expect(r15.cs / r1.cs).toBeCloseTo(1.5, 10)
  })

  it('expoente k: 1 abaixo de 0,5s; (T+1,5)/2 no meio; 2 acima de 2,5s', () => {
    expect(distributionExponent(0.3)).toBe(1)
    expect(distributionExponent(1.5)).toBeCloseTo(1.5, 10)
    expect(distributionExponent(3)).toBe(2)
  })

  it('distribuição vertical: ΣFx = H; k=1 é proporcional a w·h', () => {
    const weights = [1000, 1000, 800]
    const heights = [3, 6, 9]
    const { k, forces } = verticalDistribution(weights, heights, 500, 0.4)
    expect(k).toBe(1)
    expect(forces.reduce((a, b) => a + b, 0)).toBeCloseTo(500, 8)
    // à mão: Σw·h = 3000+6000+7200 = 16200 → F1 = 500·3000/16200
    expect(forces[0]).toBeCloseTo((500 * 3000) / 16200, 8)
    expect(forces[2]).toBeCloseTo((500 * 7200) / 16200, 8)
  })

  it('período aproximado: pórtico de concreto, hn=30 m → 0,0466·30^0,9 ≈ 0,995 s', () => {
    const ta = approxPeriod(30, 'portico-concreto-usual')
    expect(ta).toBeCloseTo(0.0466 * Math.pow(30, 0.9), 12)
    expect(ta).toBeGreaterThan(0.9)
    expect(ta).toBeLessThan(1.1)
  })

  it('coeficiente de estabilidade θ e limite 0,5/Cd ≤ 0,25', () => {
    // P=10000 kN, Δ=0,01 m, H=200 kN, hs=3 m, Cd=2,5:
    // θ = 10000·0,01/(200·3·2,5) = 0,0667; θmax = 0,5/2,5 = 0,2
    const st = stabilityCoefficient(10000, 0.01, 200, 3, 2.5)
    expect(st.theta).toBeCloseTo(0.06667, 4)
    expect(st.thetaMax).toBeCloseTo(0.2, 10)
    expect(stabilityCoefficient(1, 0.01, 1, 3, 1.5).thetaMax).toBe(0.25)
  })

  it('tabelas de projeto: I, limites de drift e sistemas (R/Ω0/Cd)', () => {
    expect(IMPORTANCE).toEqual({ 1: 1.0, 2: 1.25, 3: 1.5 })
    expect(DRIFT_LIMIT).toEqual({ 1: 0.02, 2: 0.015, 3: 0.01 })
    const usual = SEISMIC_SYSTEMS['portico-concreto-usual']
    expect([usual.R, usual.omega0, usual.Cd]).toEqual([3, 3, 2.5])
    const inter = SEISMIC_SYSTEMS['portico-concreto-intermediario']
    expect([inter.R, inter.omega0, inter.Cd]).toEqual([5, 3, 4.5])
    const pw = SEISMIC_SYSTEMS['pilar-parede-usual']
    expect([pw.R, pw.omega0, pw.Cd]).toEqual([4, 2.5, 4])
  })
})
