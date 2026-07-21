import { describe, expect, it } from 'vitest'
import { designRetainingWall } from '../src/geotech/retainingWall'
import { designRaft } from '../src/geotech/raft'

const MAT = { fck: 25_000, fcd: 17_857.1, fyd: 434_782.6 }

// Muro H=3 · φ=30° (Ka = 1/3) · γ=18 · q=10:
//   Ea = 0,5·⅓·18·9 + ⅓·10·3 = 27 + 10 = 37 kN/m
//   Mtomb = 27·1,0 + 10·1,5 = 42 kN·m/m
// Geometria B=2 (ponta 0,5 · fuste 0,25 · talão 1,25), base 0,3, γc=25, μ=0,5:
//   ΣV = 16,875+15+60,75+12,5 = 105,1 → FS desliz = 52,6/37 = 1,42 (< 1,5!)
//   Msta = 10,55+15+83,53+17,19 = 126,3 → FS tomb = 3,0
describe('designRetainingWall (Rankine + verificações)', () => {
  const BASE = {
    h: 3, stemT: 0.25, baseB: 2, toe: 0.5, baseH: 0.3,
    gammaSoil: 18, phiDeg: 30, q: 10, sigmaAdm: 200, mu: 0.5,
    concreteUnitWeight: 25, cover: 0.03, ...MAT,
  }
  const r = designRetainingWall(BASE)
  it('âncora: Ka = ⅓, Ea = 37 kN/m, FS tombamento = 3,0', () => {
    expect(r.ka).toBeCloseTo(1 / 3, 3)
    expect(r.ea).toBeCloseTo(37, 1)
    expect(r.fsOverturn).toBeCloseTo(3.0, 1)
  })
  it('deslizamento 1,42 < 1,5 ⇒ FALHA com nota de dente/alargamento', () => {
    expect(r.fsSliding).toBeCloseTo(1.42, 1)
    expect(r.status).toBe('falha')
    expect(r.notes.join(' ')).toMatch(/Deslizamento/)
  })
  it('base maior resolve: B=2,6 (talão 1,85) ⇒ FS ≥ 1,5 e σ ≤ σadm', () => {
    const ok = designRetainingWall({ ...BASE, baseB: 2.6 })
    expect(ok.fsSliding).toBeGreaterThanOrEqual(1.5)
    expect(ok.sigmaMax).toBeLessThanOrEqual(200)
    expect(ok.status).not.toBe('falha')
    expect(ok.stemSpec).toMatch(/φ/)
  })
  it('notas executivas: drenagem e face tracionada', () => {
    expect(r.notes.join(' ')).toMatch(/DRENAGEM/i)
    expect(r.notes.join(' ')).toMatch(/tracionada/i)
  })
})

// Radier 4 pilares de 1000 kN nos cantos de 6×6, balanço 1 m ⇒ 8×8:
//   pp = 0,4·25·64 = 640 → σ = 4640/64 = 72,5 kPa (centrado ⇒ e = 0)
describe('designRaft (método rígido)', () => {
  const cols = [
    { id: 'a', name: 'P1', pos: { x: 0, y: 0 }, nServ: 1000, c1: 0.3, c2: 0.3 },
    { id: 'b', name: 'P2', pos: { x: 6, y: 0 }, nServ: 1000, c1: 0.3, c2: 0.3 },
    { id: 'c', name: 'P3', pos: { x: 0, y: 6 }, nServ: 1000, c1: 0.3, c2: 0.3 },
    { id: 'd', name: 'P4', pos: { x: 6, y: 6 }, nServ: 1000, c1: 0.3, c2: 0.3 },
  ]
  const BASE = {
    columns: cols, overhang: 1, thickness: 0.4, sigmaAdm: 100,
    concreteUnitWeight: 25, cover: 0.04, gammaC: 1.4, ...MAT,
  }
  const r = designRaft(BASE)
  it('âncora: 8×8, σ = 72,5 kPa centrado, punção nos 4 pilares', () => {
    expect(r.a).toBeCloseTo(8, 6)
    expect(r.sigmaAvg).toBeCloseTo(72.5, 1)
    expect(Math.abs(r.ex) + Math.abs(r.ey)).toBeLessThan(1e-9)
    expect(r.punching).toHaveLength(4)
    expect(r.specX).toMatch(/φ/)
  })
  it('carga assimétrica gera excentricidade e σmáx > σavg', () => {
    const r2 = designRaft({ ...BASE, columns: cols.map((c, i) => ({ ...c, nServ: i === 0 ? 2000 : 1000 })) })
    expect(Math.abs(r2.ex)).toBeGreaterThan(0.1)
    expect(r2.sigmaMax).toBeGreaterThan(r2.sigmaAvg)
  })
  it('σadm apertada ⇒ falha com nota', () => {
    const r3 = designRaft({ ...BASE, sigmaAdm: 60 })
    expect(r3.status).toBe('falha')
  })
})
