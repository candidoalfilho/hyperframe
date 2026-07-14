import { describe, expect, it } from 'vitest'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { uid } from '../src/model/uid'
import { analyze } from '../src/analyze'
import { buildAnalysisModel } from '../src/analysis/buildModel'
import type { Project } from '../src/model/types'

/** prédio com laje LISA: 4 pilares internos, vigas só no perímetro externo maior */
function flatSlabBuilding(): Project {
  const p = createEmptyProject({
    name: 'Cogumelo',
    fck: 30000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 1,
    floorHeight: 3,
    wind: { enabled: false, v0: 40, s1: 1, category: 4, s3Group: 2 },
    createdAt: '2026-01-01',
  })
  p.settings.slabMethod = 'grelha'
  const [base, top] = p.levels
  const plan = p.plans[0]
  // 4 pilares internos (SEM vigas) + 4 de canto com vigas de contorno
  const corners = [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 9, y: 9 },
    { x: 0, y: 9 },
  ]
  const inner = [
    { x: 3, y: 3 },
    { x: 6, y: 3 },
    { x: 6, y: 6 },
    { x: 3, y: 6 },
  ]
  p.columns = [...corners, ...inner].map((pos, i) => ({
    id: uid('col'),
    name: `P${i + 1}`,
    pos,
    section: { bw: 0.35, h: 0.35 },
    rotationDeg: 0 as const,
    baseLevelId: base.id,
    topLevelId: top.id,
  }))
  plan.beams = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
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
      polygon: corners.map((c) => ({ ...c })),
      thickness: 0.2,
      finishLoad: 1.0,
      liveLoad: 3.0,
    },
  ]
  return p
}

describe('grelha no pipeline — laje lisa (cogumelo)', () => {
  const p = flatSlabBuilding()
  const r = analyze(p)

  it('equilíbrio global preservado (ΣFz = peso total)', () => {
    const g = r.cases.elu.G!
    const sumFz = g.reactions.reduce((s, x) => s + x.fz, 0)
    const totalG = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(sumFz).toBeCloseTo(totalG, 0)
  })

  it('pilares internos recebem carga da laje (via grelha)', () => {
    const g = r.cases.els.G!
    // reações dos 4 pilares internos >> reações dos cantos (área tributária maior)
    const byName = new Map(
      p.columns.map((c) => {
        const node = r.model.nodes.find(
          (n) => n.support && Math.abs(n.x - c.pos.x) < 0.05 && Math.abs(n.y - c.pos.y) < 0.05,
        )
        const rx = g.reactions.find((x) => x.nodeId === node?.id)
        return [c.name, rx?.fz ?? 0]
      }),
    )
    const inner = ['P5', 'P6', 'P7', 'P8'].map((n) => byName.get(n)!)
    // cada pilar interno recebe carga substancial DIRETO da laje (sem viga);
    // no método de Marcus essa carga seria zero
    for (const fi of inner) expect(fi).toBeGreaterThan(50)
    const innerSum = inner.reduce((s, v) => s + v, 0)
    const totalG = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(innerSum).toBeGreaterThan(0.25 * totalG)
  })

  it('punção verificada nos pilares internos com a reação real', () => {
    const l1 = r.slabDesign.find((s) => s.name === 'L1')!
    expect(l1.gridDesign).not.toBeNull()
    const gd = l1.gridDesign!
    expect(gd.punching.length).toBe(4)
    for (const pu of gd.punching) {
      expect(pu.fsd).toBeGreaterThan(50) // kN — carga real, não zero
      expect(pu.check.u0).toBeCloseTo(4 * 0.35, 6)
      expect(pu.check.tauRd2).toBeGreaterThan(0)
    }
  })

  it('armaduras e flecha calculadas pela grelha', () => {
    const gd = r.slabDesign.find((s) => s.name === 'L1')!.gridDesign!
    expect(gd.asX).toBeGreaterThan(0)
    expect(gd.mxSupport).toBeGreaterThan(gd.mxSpan * 0.5) // negativo relevante no cogumelo
    expect(gd.deflectionLimit).toBeCloseTo(9 / 250, 6)
  })
})

describe('grelha no pipeline — edifício exemplo completo', () => {
  it('trocar p/ grelha mantém equilíbrio e dimensiona todas as lajes', () => {
    const p = createSampleProject()
    p.settings.slabMethod = 'grelha'
    const r = analyze(p)
    const g = r.cases.elu.G!
    const sumFz = g.reactions.reduce((s, x) => s + x.fz, 0)
    const totalG = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(sumFz).toBeCloseTo(totalG, 0)
    for (const sd of r.slabDesign) {
      expect(sd.gridDesign).not.toBeNull()
      expect(sd.gridDesign!.asX).toBeGreaterThan(0)
      expect(sd.gridDesign!.asY).toBeGreaterThan(0)
    }
  })
})

describe('baldrames sobre apoio elástico (Winkler)', () => {
  function withGroundBeams(): Project {
    const p = createEmptyProject({
      name: 'Baldrame',
      fck: 30000,
      aggregate: 'granito',
      caa: 'II',
      numFloors: 1,
      floorHeight: 3,
      wind: { enabled: false, v0: 40, s1: 1, category: 4, s3Group: 2 },
      createdAt: '2026-01-01',
    })
    const [base, top] = p.levels
    // vão de 12 m p/ o baldrame ser viga LONGA sobre o solo (λL ≈ 4,4) —
    // com vão curto os engastes das pontas levam quase tudo (ver âncora)
    p.columns = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
    ].map((pos, i) => ({
      id: uid('col'),
      name: `P${i + 1}`,
      pos,
      section: { bw: 0.3, h: 0.3 },
      rotationDeg: 0 as const,
      baseLevelId: base.id,
      topLevelId: top.id,
    }))
    // planta de baldrames no nível da fundação
    const foundationPlan = {
      id: uid('pl'),
      name: 'Baldrames',
      beams: [
        {
          id: uid('bm'),
          name: 'VB1',
          path: [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
          ],
          section: { bw: 0.25, h: 0.5 },
        },
      ],
      slabs: [],
      wallLoads: [
        { id: uid('wl'), beamId: '', w: 8, label: 'Alvenaria sobre baldrame' },
      ],
      loadRegions: [],
    }
    foundationPlan.wallLoads[0].beamId = foundationPlan.beams[0].id
    p.plans.push(foundationPlan)
    base.planId = foundationPlan.id
    // viga no topo p/ fechar o pórtico
    p.plans[0].beams = [
      {
        id: uid('bm'),
        name: 'V1',
        path: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
        ],
        section: { bw: 0.2, h: 0.5 },
      },
    ]
    p.settings.groundBeamKs = 20000 // kN/m³ (override manual)
    return p
  }

  it('baldrame é subdividido e recebe molas de Winkler', () => {
    const { model } = buildAnalysisModel(withGroundBeams())
    expect(model.winklerKs).toBe(20000)
    expect(model.winkler).not.toBeNull()
    // 12 m em segmentos ≤ 0,5 m ⇒ ≥ 23 nós intermediários com mola
    expect(model.winkler!.length).toBeGreaterThanOrEqual(23)
    // rigidez total = ks·B·L (menos as pontas nos pilares)
    const kTotal = model.winkler!.reduce((s, w) => s + w.kz, 0)
    expect(kTotal).toBeGreaterThan(0.8 * 20000 * 0.25 * 12)
    expect(kTotal).toBeLessThanOrEqual(20000 * 0.25 * 12 + 1)
  })

  it('equilíbrio fechado: reações dos pilares + molas = carga total (âncora manual)', () => {
    const p = withGroundBeams()
    const r = analyze(p)
    const g = r.cases.els.G!
    const sumFz = g.reactions.reduce((s, x) => s + x.fz, 0)
    // molas: força = kz·(−uz) em cada nó de Winkler
    let springSum = 0
    for (const w of r.model.winkler!) {
      springSum += w.kz * -(g.displacements[w.nodeId][2] ?? 0)
    }
    // G total à mão: pilares 2×(0,3·0,3·25·3)=13,5 + viga topo 0,2·0,5·25·12=30
    //  + baldrame 0,25·0,5·25·12=37,5 + alvenaria 8·12=96 → 177 kN
    const totalApplied = 13.5 + 30 + 37.5 + 96
    expect(sumFz + springSum).toBeGreaterThan(0.99 * totalApplied)
    expect(sumFz + springSum).toBeLessThan(1.01 * totalApplied)
    // viga LONGA sobre o solo: λ = (ks·bw/(4EcsI))^¼ ≈ 0,366 m⁻¹ ⇒ λL ≈ 4,4.
    // Cada ponta engastada na base do pilar "rouba" q/λ do solo (solução
    // semi-infinita c/ ponta engastada: déficit ∫q·e^{−λx}(cos+sin)dx = q/λ),
    // logo molas ≈ q·(L − 2/λ) = 11,125·(12 − 5,47) ≈ 73 kN ≈ 41% dos 177 kN
    console.log(`springSum=${springSum.toFixed(2)} kN (${((100 * springSum) / totalApplied).toFixed(1)}% de ${totalApplied} kN)`)
    expect(springSum).toBeGreaterThan(0.3 * totalApplied)
    expect(springSum).toBeLessThan(0.55 * totalApplied)
    // aviso de pressão no solo presente e baldrame dimensionado como viga
    expect(r.warnings.some((w) => w.includes('Baldrames: pressão'))).toBe(true)
    expect(r.beamDesign.some((b) => b.beamName === 'VB1')).toBe(true)
  })

  it('sem override, ks vem da heurística 120·σadm', () => {
    const p = withGroundBeams()
    p.settings.groundBeamKs = undefined
    p.settings.soil.sigmaAdm = 250
    const { model } = buildAnalysisModel(p)
    expect(model.winklerKs).toBeCloseTo(120 * 250, 3)
  })
})
