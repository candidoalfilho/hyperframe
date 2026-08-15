import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'
import type { Project, SeismicParams } from '../src/model/types'

/**
 * Sismo FASE 2 — casos EQ* reais no pórtico, torção acidental de 5% (§9.4)
 * e combinações últimas excepcionais (NBR 8681 §4.3.3) no dimensionamento.
 */
const SEISMIC: SeismicParams = {
  enabled: true,
  zone: 4,
  soilClass: 'E',
  category: 1,
  system: 'portico-concreto-usual',
  liveFraction: 0.25,
}

function withSeismic(p?: Partial<SeismicParams>): Project {
  const proj = createSampleProject()
  proj.settings.seismic = { ...SEISMIC, ...p }
  return proj
}

describe('fase 2 — combinações excepcionais (NBR 8681 §4.3.3)', () => {
  const rOn = analyze(withSeismic())
  const rOff = analyze(createSampleProject())

  it('sismo ativo gera 8 combinações ELU 5 (4 direções × desfav./fav.)', () => {
    const exc = rOn.combos.filter((c) => c.id.startsWith('ELU5'))
    expect(exc).toHaveLength(8)
    for (const c of exc) {
      expect(c.type).toBe('ELU')
      expect(c.stiffness).toBe('elu')
      const eq = Object.keys(c.factors).find((k) => k.startsWith('EQ'))
      expect(eq).toBeDefined()
      expect(c.factors[eq as 'EQXP']).toBe(1.0)
      // γg excepcional: 1,2 desfavorável ou 1,0 favorável
      expect([1.0, 1.2]).toContain(c.factors.G)
      // sobrecarga só na desfavorável, com ψ0,ef = ψ2 (§5.1.4.3)
      const psi2 = createSampleProject().settings.psiLive.psi2
      if (c.factors.G === 1.2) expect(c.factors.Q).toBeCloseTo(psi2, 6)
      else expect(c.factors.Q).toBeUndefined()
    }
  })

  it('sismo desligado: nenhuma combinação excepcional, nenhum caso EQ', () => {
    expect(rOff.combos.some((c) => c.id.startsWith('ELU5'))).toBe(false)
    expect(rOff.cases.elu.EQXP).toBeUndefined()
  })

  it('zona 0 (isenta): relatório isento e sem casos/combos EQ', () => {
    const r = analyze(withSeismic({ zone: 0 }))
    expect(r.seismic!.method).toBe('isento')
    expect(r.cases.elu.EQXP).toBeUndefined()
    expect(r.combos.some((c) => c.id.startsWith('ELU5'))).toBe(false)
  })
})

describe('fase 2 — equilíbrio e torção acidental dos casos EQ*', () => {
  const r = analyze(withSeismic())

  it('cortante na base: Σ reações fx do caso EQX+ equilibra H (e fy p/ EQY+)', () => {
    const s = r.seismic!
    const hx = s.dirs.find((d) => d.dir === 'X')!.H
    const hy = s.dirs.find((d) => d.dir === 'Y')!.H
    const sumFx = r.cases.elu.EQXP!.reactions.reduce((a, x) => a + x.fx, 0)
    const sumFy = r.cases.elu.EQYP!.reactions.reduce((a, x) => a + x.fy, 0)
    expect(Math.abs(sumFx)).toBeCloseTo(hx, 1)
    expect(Math.abs(sumFy)).toBeCloseTo(hy, 1)
    // caso negativo espelha o positivo
    const sumFxN = r.cases.elu.EQXN!.reactions.reduce((a, x) => a + x.fx, 0)
    expect(sumFxN).toBeCloseTo(-sumFx, 4)
  })

  it('torção acidental: e = 5% da dimensão em planta PERPENDICULAR à direção', () => {
    const nodes = r.model.nodes.filter((n) => n.kind === 'structural')
    const lx = Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x))
    const ly = Math.max(...nodes.map((n) => n.y)) - Math.min(...nodes.map((n) => n.y))
    const dx = r.seismic!.dirs.find((d) => d.dir === 'X')!
    const dy = r.seismic!.dirs.find((d) => d.dir === 'Y')!
    expect(dx.eTor).toBeCloseTo(0.05 * ly, 9)
    expect(dy.eTor).toBeCloseTo(0.05 * lx, 9)
    expect(dx.eTor).toBeGreaterThan(0)
  })

  it('relatório usa os MESMOS deslocamentos do caso EQ resolvido (ELU)', () => {
    const s = r.seismic!
    const dirX = s.dirs.find((d) => d.dir === 'X')!
    const topRow = dirX.rows[dirX.rows.length - 1]
    const masters = r.model.nodes
      .filter((n) => n.kind === 'master')
      .sort((a, b) => a.levelIndex - b.levelIndex)
    const topMaster = masters[masters.length - 1]
    expect(topRow.deltaXe).toBeCloseTo(
      Math.abs(r.cases.elu.EQXP!.displacements[topMaster.id][0]),
      12,
    )
  })
})

describe('fase 2 — o sismo entra no dimensionamento', () => {
  const rOff = analyze(createSampleProject())
  const rOn = analyze(withSeismic())

  it('envoltória ELU: com sismo forte (zona 4, solo E) ela só pode crescer', () => {
    let widened = 0
    for (let mi = 0; mi < rOff.envelopeELU.Mz.length; mi++) {
      for (let s = 0; s < rOff.envelopeELU.Mz[mi].max.length; s++) {
        expect(rOn.envelopeELU.Mz[mi].max[s]).toBeGreaterThanOrEqual(
          rOff.envelopeELU.Mz[mi].max[s] - 1e-6,
        )
        expect(rOn.envelopeELU.Mz[mi].min[s]).toBeLessThanOrEqual(
          rOff.envelopeELU.Mz[mi].min[s] + 1e-6,
        )
        if (
          rOn.envelopeELU.Mz[mi].max[s] > rOff.envelopeELU.Mz[mi].max[s] + 1e-6 ||
          rOn.envelopeELU.Mz[mi].min[s] < rOff.envelopeELU.Mz[mi].min[s] - 1e-6
        )
          widened++
      }
    }
    // em zona 4 + solo E o sismo TEM que governar em algum ponto
    expect(widened).toBeGreaterThan(0)
  })

  it('planta de cargas: reações características incluem os casos EQ*', () => {
    const anyRow = rOn.foundationLoads.find((f) =>
      f.cases.some((c) => c.caseId.startsWith('EQ')),
    )
    expect(anyRow).toBeDefined()
  })
})
