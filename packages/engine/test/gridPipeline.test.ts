import { describe, expect, it } from 'vitest'
import { createEmptyProject, createSampleProject } from '../src/model/factory'
import { uid } from '../src/model/uid'
import { analyze } from '../src/analyze'
import { buildAnalysisModel } from '../src/analysis/buildModel'
import { buildMemorialPdf } from '../src/report/memorial'
import { checkConsistency } from '../src/model/consistency'
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

  it('memorial reporta a grelha e a subseção 9.1 de punção', () => {
    const bytes = buildMemorialPdf(p, r, { generatedAt: '14/07/2026 12:00' })
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    expect(s).toContain('analogia de grelha') // título da seção 9 + premissas
    expect(s).toContain('9.1 Pun\\347\\343o') // "9.1 Punção" (ç/ã em octal WinAnsi)
    for (const name of ['P5', 'P6', 'P7', 'P8']) expect(s).toContain(name)
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

describe('armadura de punção no pipeline (§19.5.3.3/4)', () => {
  it('laje lisa fina e pesada: studs dimensionados por linhas até C″', () => {
    const p = flatSlabBuilding()
    p.plans[0].slabs[0].thickness = 0.14
    p.plans[0].slabs[0].liveLoad = 30
    const r = analyze(p)
    const gd = r.slabDesign.find((s) => s.name === 'L1')!.gridDesign!
    const need = gd.punching.filter((pu) => pu.check.needsShearReinf)
    expect(need.length).toBeGreaterThan(0)
    for (const pu of need) {
      expect(pu.reinf).toBeDefined()
      expect(pu.reinf!.ok).toBe(true)
      expect(pu.reinf!.lines).toBeGreaterThanOrEqual(2)
      expect(pu.reinf!.aswProvided).toBeGreaterThanOrEqual(pu.reinf!.aswRequired)
      expect(pu.reinf!.spec).toContain('conectores')
    }
    const item = r.slabDesign.find((s) => s.name === 'L1')!
    // punção resolvida (studs dimensionados, C e C″ ok) — o status da laje
    // pode ainda ser 'falha' pela FLEXÃO (14 cm c/ 30 kN/m² é proposital)
    expect(gd.punching.every((pu) => pu.check.okC && (!pu.reinf || pu.reinf.ok))).toBe(true)
    expect(item.notes.some((n) => n.includes('§19.5.3.4'))).toBe(true)
  })
})

describe('punção de borda e canto no pipeline (§19.5.2)', () => {
  /** laje lisa 9×9 SEM as vigas das bordas y=0 e x=0 (bordas livres) e com
   *  um pilar extra P13 no meio da borda livre y=0 */
  function flatSlabFreeEdges(): Project {
    const p = flatSlabBuilding()
    const plan = p.plans[0]
    plan.beams = plan.beams.filter((b) => b.name !== 'V1' && b.name !== 'V4')
    const [base, top] = p.levels
    p.columns.push({
      id: uid('col'),
      name: 'P13',
      pos: { x: 4.5, y: 0 },
      section: { bw: 0.35, h: 0.35 },
      rotationDeg: 0 as const,
      baseLevelId: base.id,
      topLevelId: top.id,
    })
    return p
  }

  const r = analyze(flatSlabFreeEdges())
  const gd = r.slabDesign.find((s) => s.name === 'L1')!.gridDesign!
  const byName = new Map(gd.punching.map((pu) => [pu.name, pu]))

  it('pilar no meio da borda livre é verificado como BORDA (u* reduzido)', () => {
    const p13 = byName.get('P13')!
    expect(p13.check.position).toBe('edge')
    // d = 0,20 − 0,025 − 0,015 = 0,16 · a = mín(1,5d; 0,5·0,35) = 0,175
    // u* = 2a + c2 + 2πd = 0,35 + 0,35 + 1,005
    expect(p13.check.u1).toBeCloseTo(0.35 + 0.35 + Math.PI * 2 * 0.16, 2)
    expect(p13.check.eStar).toBeGreaterThan(0)
    expect(p13.fsd).toBeGreaterThan(20) // a grelha agora APOIA o pilar de borda
  })

  it('pilar no encontro das duas bordas livres é CANTO', () => {
    const p1 = byName.get('P1')!
    expect(p1.check.position).toBe('corner')
    expect(p1.check.u1).toBeCloseTo(0.175 + 0.175 + Math.PI * 0.16, 2)
  })

  it('pilar interno permanece interno e o equilíbrio global fecha', () => {
    expect(byName.get('P5')!.check.position).toBe('internal')
    const g = r.cases.elu.G!
    const sumFz = g.reactions.reduce((s, x) => s + x.fz, 0)
    const totalG = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(sumFz).toBeCloseTo(totalG, 0)
  })

  it('nota da verificação de borda/canto presente na laje', () => {
    const item = r.slabDesign.find((s) => s.name === 'L1')!
    expect(item.notes.some((n) => n.includes('§19.5.2'))).toBe(true)
  })
})

describe('furos: punção §19.5.1, reforço de borda e §13.2.5', () => {
  /** laje lisa 9×9 com furo retangular 1,2×0,8 encostado no pilar interno P5 (3;3) */
  function withHoleNearColumn(): Project {
    const p = flatSlabBuilding()
    p.plans[0].loadRegions.push({
      id: uid('rg'),
      name: 'FUR1',
      kind: 'furo',
      polygon: [
        { x: 3.8, y: 2.6 },
        { x: 5.0, y: 2.6 },
        { x: 5.0, y: 3.4 },
        { x: 3.8, y: 3.4 },
      ],
      g: 0,
      q: 0,
    })
    return p
  }

  it('furo a menos de 8d reduz o perímetro de punção do pilar (§19.5.1)', () => {
    const r = analyze(withHoleNearColumn())
    const gd = r.slabDesign.find((s) => s.name === 'L1')!.gridDesign!
    const p5 = gd.punching.find((pu) => pu.name === 'P5')!
    // P5 em (3;3), vértice mais próximo do furo a 0,89 m < 8d ⇒ desconto
    expect(p5.check.u0).toBeLessThan(4 * 0.35 - 1e-6)
    expect(p5.check.notes.some((n) => n.includes('§19.5.1'))).toBe(true)
    // P7 em (6;6) está além de 8d — perímetro cheio
    const p7 = gd.punching.find((pu) => pu.name === 'P7')!
    expect(p7.check.u0).toBeCloseTo(4 * 0.35, 6)
  })

  it('reforço de borda do furo dimensionado (reposição da armadura cortada)', () => {
    const r = analyze(withHoleNearColumn())
    const item = r.slabDesign.find((s) => s.name === 'L1')!
    expect(item.notes.some((n) => n.includes('repor') && n.includes('φ 10'))).toBe(true)
    expect(item.notes.some((n) => n.includes('45°'))).toBe(true)
  })

  it('consistência: furo grande exige verificação; pequeno dispensa (§13.2.5)', () => {
    // 1,2 m > lx/10 = 0,9 m ⇒ exige (leve no modo grelha, que já considera)
    const grande = checkConsistency(withHoleNearColumn())
    const ex = grande.find((i) => i.message.includes('§13.2.5') && i.message.includes('exige'))
    expect(ex).toBeDefined()
    expect(ex!.severity).toBe('leve')
    // furo de 60 cm ≤ 0,9 m ⇒ dispensa
    const p2 = flatSlabBuilding()
    p2.plans[0].loadRegions.push({
      id: uid('rg'),
      name: 'FUR2',
      kind: 'furo',
      polygon: [
        { x: 7.5, y: 7.5 },
        { x: 8.1, y: 7.5 },
        { x: 8.1, y: 8.1 },
        { x: 7.5, y: 8.1 },
      ],
      g: 0,
      q: 0,
    })
    const pequeno = checkConsistency(p2)
    expect(
      pequeno.some((i) => i.message.includes('§13.2.5') && i.message.includes('dispensa')),
    ).toBe(true)
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
