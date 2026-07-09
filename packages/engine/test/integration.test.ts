import { describe, expect, it } from 'vitest'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { uid } from '../src/model/uid'
import { analyze, comboReactions } from '../src/analyze'
import { buildAnalysisModel } from '../src/analysis/buildModel'
import type { Project } from '../src/model/types'

/** edifício mínimo: 1 pavimento, 4 pilares, 4 vigas de contorno, 1 laje */
function tinyBuilding(withWind = false): Project {
  const p = createEmptyProject({
    name: 'Teste',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 1,
    floorHeight: 3,
    wind: { enabled: withWind, v0: 40, s1: 1, category: 4, s3Group: 2 },
    createdAt: '2026-01-01',
  })
  const base = p.levels[0]
  const top = p.levels[1]
  const plan = p.plans[0]
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ]
  p.columns = pts.map((pos, i) => ({
    id: uid('col'),
    name: `P${i + 1}`,
    pos,
    section: { bw: 0.25, h: 0.5 },
    rotationDeg: 0 as const,
    baseLevelId: base.id,
    topLevelId: top.id,
  }))
  plan.beams = [
    [pts[0], pts[1]],
    [pts[1], pts[2]],
    [pts[2], pts[3]],
    [pts[3], pts[0]],
  ].map((path, i) => ({
    id: uid('bm'),
    name: `V${i + 1}`,
    path: [...path],
    section: { bw: 0.2, h: 0.5 },
  }))
  plan.slabs = [
    {
      id: uid('sl'),
      name: 'L1',
      polygon: [...pts],
      thickness: 0.1,
      finishLoad: 1.0,
      liveLoad: 2.0,
    },
  ]
  return p
}

describe('geração do modelo', () => {
  it('gera nós, membros e pesos por nível coerentes', () => {
    const { model } = buildAnalysisModel(tinyBuilding())
    // 4 pilares × 1 tramo + 4 vigas × 1 barra = 8 membros
    expect(model.members).toHaveLength(8)
    // 4 nós base + 4 nós topo + 1 mestre
    expect(model.nodes.filter((n) => n.support)).toHaveLength(4)
    expect(model.masters).toHaveLength(1)
    const lw = model.levelWeights[0]
    // Q = 2,0 kN/m² × 24 m² = 48 kN
    expect(lw.Q).toBeCloseTo(48, 3)
    // G = laje (0,1·25 + 1,0)·24 + vigas 0,2·0,5·25·20 m + pilares 0,25·0,5·25·3·4
    const gExpected = (0.1 * 25 + 1.0) * 24 + 0.2 * 0.5 * 25 * 20 + 0.25 * 0.5 * 25 * 3 * 4
    expect(lw.G).toBeCloseTo(gExpected, 1)
  })
})

describe('análise — equilíbrio global', () => {
  it('ΣFz das reações (caso G) = peso total', () => {
    const project = tinyBuilding()
    const results = analyze(project)
    const g = results.cases.elu.G!
    const sumFz = g.reactions.reduce((s, r) => s + r.fz, 0)
    expect(sumFz).toBeCloseTo(results.model.levelWeights[0].G, 1)
    // simetria em x: pilares 1-2 e 3-4 c/ mesma carga
    const fzs = g.reactions.map((r) => r.fz).sort((a, b) => a - b)
    expect(fzs[0]).toBeCloseTo(fzs[1], 0)
    expect(fzs[2]).toBeCloseTo(fzs[3], 0)
  })

  it('combinação ELU1 = 1,4·(G+Q) no somatório vertical', () => {
    const project = tinyBuilding()
    const results = analyze(project)
    const r = comboReactions(results, 'ELU1')
    const sumFz = r.reduce((s, x) => s + x.fz, 0)
    const { G, Q } = results.model.levelWeights[0]
    expect(sumFz).toBeCloseTo(1.4 * (G + Q), 1)
  })

  it('vento: ΣFx das reações equilibra a força aplicada', () => {
    const project = tinyBuilding(true)
    const results = analyze(project)
    const wxp = results.cases.elu.WXP!
    const applied = results.model.wind!.find((w) => w.dir === 'XP')!.totalForce
    const sumFx = wxp.reactions.reduce((s, r) => s + r.fx, 0)
    expect(sumFx).toBeCloseTo(-applied, 2) // reações opostas à ação
    expect(applied).toBeGreaterThan(0)
  })

  it('diafragma rígido: nós do pavimento transladam igualmente sob vento', () => {
    const project = tinyBuilding(true)
    const results = analyze(project)
    const wxp = results.cases.elu.WXP!
    const topNodes = results.model.nodes.filter(
      (n) => n.levelIndex === 1 && n.kind === 'structural',
    )
    const ux = topNodes.map((n) => wxp.displacements[n.id][0])
    // estrutura simétrica → sem torção → ux idênticos
    for (const u of ux) expect(u).toBeCloseTo(ux[0], 9)
    expect(ux[0]).toBeGreaterThan(0) // move no sentido do vento
  })
})

describe('análise — projeto de exemplo completo (8 pavimentos)', () => {
  const results = analyze(createSampleProject())

  it('gera modelo com estatísticas plausíveis', () => {
    expect(results.model.stats.members).toBeGreaterThan(200)
    // 12 nós escravos (3 GDL) + 1 mestre (3 GDL) por pavimento × 8 = 312
    expect(results.model.stats.dofs).toBe(312)
    expect(results.combos).toHaveLength(19)
  })

  it('equilíbrio vertical do caso G', () => {
    const g = results.cases.elu.G!
    const sumFz = g.reactions.reduce((s, r) => s + r.fz, 0)
    const totalG = results.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(sumFz / totalG).toBeCloseTo(1, 3)
  })

  it('γz calculado nas 4 direções, entre 1,0 e 1,5', () => {
    expect(results.stability.gammaZ).toHaveLength(4)
    for (const gz of results.stability.gammaZ) {
      expect(gz.value).toBeGreaterThan(1.0)
      expect(gz.value).toBeLessThan(1.5)
      expect(gz.m1).toBeGreaterThan(0)
      expect(gz.deltaM).toBeGreaterThan(0)
    }
  })

  it('drift ELS calculado com pavimentos', () => {
    expect(results.stability.drift.length).toBeGreaterThan(0)
    for (const d of results.stability.drift) {
      expect(d.stories.length).toBe(8)
      expect(Math.abs(d.topDisp)).toBeGreaterThan(0)
    }
  })

  it('deslocamento cresce com a altura (vento)', () => {
    const d = results.stability.drift[0]
    const disps = d.stories.map((s) => Math.abs(s.disp))
    for (let i = 1; i < disps.length; i++) {
      expect(disps[i]).toBeGreaterThanOrEqual(disps[i - 1] - 1e-9)
    }
  })

  it('dimensiona vigas com As ≥ As,min e sem falhas', () => {
    expect(results.beamDesign.length).toBeGreaterThan(0)
    for (const bd of results.beamDesign) {
      expect(bd.positive.as).toBeGreaterThanOrEqual(bd.positive.asMin - 1e-9)
      expect(bd.status).not.toBe('falha')
      expect(bd.shear.vd).toBeLessThan(bd.shear.vrd2)
    }
  })

  it('dimensiona pilares a flexo-compressão oblíqua', () => {
    expect(results.columnDesign).toHaveLength(12)
    for (const cd of results.columnDesign) {
      expect(cd.nd).toBeGreaterThan(100) // 8 pavimentos → sempre centenas de kN
      expect(cd.status).not.toBe('falha')
      expect(cd.utilization).toBeGreaterThan(0)
      expect(cd.utilization).toBeLessThanOrEqual(1.01)
      expect(cd.barsN).toBeGreaterThanOrEqual(4)
      // ρ dentro dos limites normativos
      const ac = cd.section.bw * cd.section.h
      expect(cd.as).toBeGreaterThanOrEqual(0.004 * ac - 1e-9)
      expect(cd.as).toBeLessThanOrEqual(0.04 * ac + 1e-9)
      expect(cd.barPositions.length).toBe(cd.barsN)
    }
  })

  it('dimensiona lajes retangulares (Marcus) — tipo e cobertura', () => {
    // 6 lajes do tipo + 6 da cobertura (plantas distintas)
    expect(results.slabDesign).toHaveLength(12)
    for (const sd of results.slabDesign) {
      expect(sd.rectangular).toBe(true)
      expect(sd.design).not.toBeNull()
      expect(sd.status).not.toBe('falha')
      const d = sd.design!
      // quinhões somam a carga característica da laje (com extras de região)
      expect(d.dirA.w + d.dirB.w).toBeGreaterThan(0.12 * 25) // pelo menos o peso próprio
      expect(d.dirA.asSpan).toBeGreaterThanOrEqual(d.dirA.asSpanMin - 1e-12)
      expect(d.dirA.spanSpec).toContain('φ')
      expect(d.deflection).toBeGreaterThan(0)
    }
    // laje sob o reservatório recebe carga extra (g e q de região)
    const withExtras = results.slabDesign.filter((sd) =>
      sd.notes.some((n) => n.includes('região')),
    )
    expect(withExtras.length).toBeGreaterThan(0)
  })

  it('regiões de carga entram no peso dos pavimentos', () => {
    // reservatório de 2,5×2,5 m com q=15 kN/m² no último nível
    const top = results.model.levelWeights[results.model.levelWeights.length - 1]
    const below = results.model.levelWeights[results.model.levelWeights.length - 2]
    // cobertura tem menos sobrecarga (1,0) porém reservatório → Q próximo do tipo
    expect(top.Q).toBeGreaterThan(0.4 * below.Q)
  })

  it('pré-dimensiona sapatas com tensão ≤ admissível', () => {
    expect(results.foundations).toHaveLength(12)
    for (const f of results.foundations) {
      expect(f.nServ).toBeGreaterThan(100)
      expect(f.footing.sigma).toBeLessThanOrEqual(250 + 1e-6)
      expect(f.footing.a).toBeGreaterThanOrEqual(f.footing.b - 1e-9)
      expect(f.footing.h).toBeGreaterThanOrEqual(0.3)
      expect(f.status).not.toBe('falha')
    }
  })

  it('verifica flechas de vigas em serviço', () => {
    expect(results.beamService.length).toBe(results.beamDesign.length)
    for (const bs of results.beamService) {
      expect(bs.deltaTotal).toBeGreaterThan(0)
      expect(bs.crackFactor).toBeGreaterThanOrEqual(1)
      expect(bs.ok).toBe(true) // seções 20×50 em vãos de 4–4,5 m passam folgado
    }
  })

  it('gera detalhamento e tabela de aço', () => {
    expect(results.detailing.beams.length).toBe(results.beamDesign.length)
    expect(results.detailing.columns).toHaveLength(12)
    expect(results.detailing.steel.items.length).toBeGreaterThan(30)
    expect(results.detailing.steel.totalKg).toBeGreaterThan(3000)
    expect(results.detailing.steel.totalWithWaste).toBeCloseTo(
      results.detailing.steel.totalKg * 1.1,
      6,
    )
    for (const it of results.detailing.steel.items) {
      expect(it.kg).toBeGreaterThan(0)
      expect(it.unitLength).toBeGreaterThan(0)
    }
  })

  it('quantitativos coerentes', () => {
    const q = results.quantities
    expect(q.concrete.total).toBeGreaterThan(50)
    expect(q.concrete.total).toBeLessThan(1000)
    expect(q.steel.total).toBeGreaterThan(1000)
    expect(q.steel.ratePerM3).toBeGreaterThan(40)
    expect(q.steel.ratePerM3).toBeLessThan(250)
    expect(q.formwork).toBeGreaterThan(q.concrete.total)
  })

  it('roda em tempo razoável', () => {
    expect(results.elapsedMs).toBeLessThan(30_000)
  })
})
