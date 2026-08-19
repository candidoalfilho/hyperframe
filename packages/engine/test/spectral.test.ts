import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'
import { baseShearCorrection, spectralResponse } from '../src/analysis/spectral'
import type { ModalMode } from '../src/analysis/modal'
import type { Project, SeismicParams } from '../src/model/types'

const G = 9.80665

/** modo sintético só em X, formas dadas por pavimento */
function mode(n: number, T: number, ux: number[], effX: number): ModalMode {
  return {
    n,
    T,
    freq: 1 / T,
    shape: ux.map((u, i) => ({ levelIndex: i, ux: u, uy: 0 })),
    effMassX: effX,
    effMassY: 0,
  }
}

describe('spectralResponse — âncora SRSS calculada à mão (2 GDL, 2 modos)', () => {
  // shear building m1 = m2 = 100 t; modos clássicos k1=k2:
  // φ1 = [0,618; 1], φ2 = [1; −0,618] (normalizados |max| = 1)
  const m = 100
  const masses = [m, m]
  const phi1 = [0.618, 1]
  const phi2 = [1, -0.618]
  // massa efetiva analítica: Meff1/M = 0,947, Meff2/M = 0,053 (2 GDL)
  const modes = [mode(1, 0.5, phi1, 0.947), mode(2, 0.2, phi2, 0.053)]
  // espectro constante Sa = 0,10g, I/R = 1/3
  const Sa = () => 0.1
  const IoR = 1 / 3

  it('cortantes por modo e SRSS batem com a conta manual', () => {
    const r = spectralResponse(modes, masses, 'X', Sa, IoR, 0.999)
    expect(r.modesUsed).toBe(2)
    expect(r.massSum).toBeCloseTo(1.0, 3)

    // modo 1: Γ1 = Σmφ/Σmφ² = (0,618+1)/(0,618²+1²) = 1,618/1,3819 = 1,17086
    // p1,i = Sa·g·(I/R)·Γ1·m·φ1,i → V1,base = Σp1 = Sa·g·(I/R)·Γ1·m·1,618
    const g1 = (phi1[0] + phi1[1]) / (phi1[0] ** 2 + phi1[1] ** 2)
    const v1base = 0.1 * G * IoR * g1 * m * (phi1[0] + phi1[1])
    // modo 2: Γ2 = (1 − 0,618)/(1 + 0,618²) = 0,382/1,3819 = 0,27643
    const g2 = (phi2[0] + phi2[1]) / (phi2[0] ** 2 + phi2[1] ** 2)
    const v2base = 0.1 * G * IoR * g2 * m * (phi2[0] + phi2[1])
    expect(r.perModeBase[0]).toBeCloseTo(Math.abs(v1base), 6)
    expect(r.perModeBase[1]).toBeCloseTo(Math.abs(v2base), 6)

    // base SRSS
    expect(r.Ht).toBeCloseTo(Math.hypot(v1base, v2base), 6)
    // cortante do 2º pavimento: só a força do topo de cada modo
    const v1top = 0.1 * G * IoR * g1 * m * phi1[1]
    const v2top = 0.1 * G * IoR * g2 * m * phi2[1]
    expect(r.shears[1]).toBeCloseTo(Math.hypot(v1top, v2top), 6)
    // forças = diferenças dos cortantes SRSS e somam Ht
    expect(r.forces[0] + r.forces[1]).toBeCloseTo(r.Ht, 6)
    expect(r.forces[1]).toBeCloseTo(r.shears[1], 6)
  })

  it('massa efetiva somada dos modos usados ≈ soma dos cortantes²: SRSS ≥ maior modo', () => {
    const r = spectralResponse(modes, masses, 'X', Sa, IoR, 0.999)
    expect(r.Ht).toBeGreaterThanOrEqual(Math.max(...r.perModeBase) - 1e-9)
  })

  it('para 1 modo dominante o espectral reduz ao FHE com Sa constante', () => {
    // só o modo 1: V = Sa·(I/R)·g·Meff1 — com Sa constante é o Cs·W do platô
    const r = spectralResponse([modes[0]], masses, 'X', Sa, IoR)
    expect(r.Ht).toBeCloseTo(0.1 * IoR * G * 0.947 * 2 * m * 1.0000, 0)
  })

  it('regra 0,85·H (§10.4): escala quando Ht < 0,85·H e dispensa quando não', () => {
    expect(baseShearCorrection(80, 100)).toBeCloseTo(85 / 80, 10)
    expect(baseShearCorrection(90, 100)).toBe(1)
    expect(80 * baseShearCorrection(80, 100)).toBeCloseTo(85, 10)
  })
})

describe('método espectral no analyze (fase 3)', () => {
  const SEISMIC: SeismicParams = {
    enabled: true,
    zone: 3,
    soilClass: 'D',
    category: 1,
    system: 'portico-concreto-usual',
    liveFraction: 0,
    method: 'espectral',
  }
  function proj(p?: Partial<SeismicParams>): Project {
    const pr = createSampleProject()
    pr.settings.seismic = { ...SEISMIC, ...p }
    return pr
  }
  const rSpec = analyze(proj())
  const rFhe = analyze(proj({ method: 'equivalente' }))

  it('method = espectral com ≥ 90% de massa e Ht > 0 nas duas direções', () => {
    const s = rSpec.seismic!
    expect(s.method).toBe('espectral')
    expect(s.dirs).toHaveLength(2)
    for (const d of s.dirs) {
      expect(d.spectral).toBeDefined()
      expect(d.spectral!.massSum).toBeGreaterThanOrEqual(0.9)
      expect(d.spectral!.Ht).toBeGreaterThan(0)
      expect(d.spectral!.scale).toBeGreaterThanOrEqual(1)
    }
  })

  it('equilíbrio: Σ reações fx do EQX+ = H espectral aplicado', () => {
    const s = rSpec.seismic!
    const hx = s.dirs.find((d) => d.dir === 'X')!.H
    const sum = rSpec.cases.elu.EQXP!.reactions.reduce((a, x) => a + x.fx, 0)
    expect(Math.abs(sum)).toBeCloseTo(hx, 1)
  })

  it('cortante final respeita o piso 0,85·H do FHE (§10.4)', () => {
    for (const dir of ['X', 'Y'] as const) {
      const hSpec = rSpec.seismic!.dirs.find((d) => d.dir === dir)!.H
      const hFhe = rFhe.seismic!.dirs.find((d) => d.dir === dir)!.H
      expect(hSpec).toBeGreaterThanOrEqual(0.85 * hFhe - 1e-6)
    }
  })

  it('combinações excepcionais continuam presentes com o espectral', () => {
    expect(rSpec.combos.filter((c) => c.id.startsWith('ELU5'))).toHaveLength(8)
  })

  it('zona 1 mantém o simplificado mesmo pedindo espectral', () => {
    const r = analyze(proj({ zone: 1 }))
    expect(r.seismic!.method).toBe('simplificado')
  })
})
