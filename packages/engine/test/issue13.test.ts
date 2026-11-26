import { describe, expect, it } from 'vitest'
import {
  globalStiffness,
  localStiffness,
  offsetDisplacements,
  offsetForces,
  offsetStiffness,
  rotationMatrix,
} from '../src/analysis/frame3d'
import { createEmptyProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import type { Vec3 } from '../src/analysis/types'
import type { Project } from '../src/model/types'

/**
 * issue #13 — ligação viga–pilar com braço rígido (NBR 6118 §14.6.2.1):
 * excentricidade transversal gera momento no pilar; trecho rígido
 * longitudinal opcional dá o vão de cálculo do §14.6.2.4.
 */

describe('braço rígido no elemento de pórtico', () => {
  const r = rotationMatrix([1, 0, 0], [0, 0, 1], [0, -1, 0])
  const kl = localStiffness({ L: 4, EA: 2e6, EIy: 3e4, EIz: 8e4, GJ: 1e4 })
  const kg = globalStiffness(r, kl)
  const ri: Vec3 = [0.1, 0.25, 0]
  const rj: Vec3 = [-0.15, -0.2, 0.05]
  const k = offsetStiffness(kg, ri, rj)

  it('sem braço devolve a própria matriz', () => {
    expect(offsetStiffness(kg, undefined, undefined)).toBe(kg)
  })

  it('K continua simétrica', () => {
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < i; j++) expect(k[i * 12 + j]).toBeCloseTo(k[j * 12 + i], 6)
  })

  it('movimento de corpo rígido dos NÓS não gera esforço (H correto)', () => {
    // nós: i na origem, j tal que os extremos flexíveis fiquem a 4 m em x
    const xi: Vec3 = [0, 0, 0]
    const xj: Vec3 = [ri[0] + 4 - rj[0], ri[1] - rj[1], ri[2] - rj[2]]
    const cross = (a: Vec3, b: Vec3): Vec3 => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
    const modes: { u0: Vec3; th: Vec3 }[] = [
      { u0: [1, 0, 0], th: [0, 0, 0] },
      { u0: [0, 0, 1], th: [0, 0, 0] },
      { u0: [0, 0, 0], th: [1, 0, 0] },
      { u0: [0, 0, 0], th: [0, 1, 0] },
      { u0: [0, 0, 0], th: [0, 0, 1] },
      { u0: [0.3, -0.2, 0.5], th: [0.4, -0.7, 0.2] },
    ]
    for (const { u0, th } of modes) {
      const u = new Float64Array(12)
      for (const [o, x] of [
        [0, xi],
        [6, xj],
      ] as const) {
        const t = cross(th, x)
        for (let d = 0; d < 3; d++) {
          u[o + d] = u0[d] + t[d]
          u[o + 3 + d] = th[d]
        }
      }
      for (let i = 0; i < 12; i++) {
        let f = 0
        for (let j = 0; j < 12; j++) f += k[i * 12 + j] * u[j]
        expect(Math.abs(f)).toBeLessThan(1e-6)
      }
    }
  })

  it('força no extremo chega ao nó com o momento r × F', () => {
    // 10 kN para baixo no extremo i, a 25 cm em y do nó ⇒ Mx = r_y·F_z = −2,5
    const f = new Float64Array(12)
    f[2] = -10
    const fn = offsetForces(f, [0, 0.25, 0], undefined)
    expect(fn[2]).toBe(-10)
    expect(fn[3]).toBeCloseTo(-2.5, 12)
    expect(fn[4]).toBeCloseTo(0, 12)
    // rotação θx do nó levanta o extremo a +y: uz = θx·r_y
    const u = new Float64Array(12)
    u[3] = 0.01
    expect(offsetDisplacements(u, [0, 0.25, 0], undefined)[2]).toBeCloseTo(0.0025, 12)
  })
})

/** pórtico de 1 vão em x; pilares 20×50 com o lado de 50 ao longo de Y */
const frame = (
  yBeam: number,
  opts: { rigid?: boolean; rot?: 0 | 90; x0?: number; x1?: number } = {},
): Project => {
  const p = createEmptyProject({
    name: 't',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 1,
    floorHeight: 3,
    wind: { enabled: false, v0: 30, s1: 1, category: 4, s3Group: 2 },
  })
  p.settings.considerSelfWeight = false
  p.settings.notionalImperfections = false
  if (opts.rigid) p.settings.rigidEndZones = true
  const [base, top] = p.levels
  p.columns = [0, 5].map((x, i) => ({
    id: `c${i}`,
    name: `P${i + 1}`,
    pos: { x, y: 0 },
    section: { bw: 0.2, h: 0.5 },
    rotationDeg: opts.rot ?? 90,
    baseLevelId: base.id,
    topLevelId: top.id,
  }))
  p.plans[0].beams = [
    {
      id: 'b0',
      name: 'V1',
      path: [
        { x: opts.x0 ?? 0, y: yBeam },
        { x: opts.x1 ?? 5, y: yBeam },
      ],
      section: { bw: 0.15, h: 0.4 },
    },
  ]
  p.plans[0].wallLoads = [{ id: 'w', beamId: 'b0', w: 10 }]
  return p
}

describe('excentricidade transversal viga–pilar', () => {
  it('viga centrada: sem braço e sem momento transversal no pilar (regressão)', () => {
    const r = analyze(frame(0))
    expect(r.model.members.every((m) => !m.offI && !m.offJ)).toBe(true)
    for (const rx of r.cases.elu.G!.reactions) expect(Math.abs(rx.mx)).toBeLessThan(1e-6)
  })

  it('viga a 15 cm do eixo: momento no pilar = reação × excentricidade', () => {
    const r = analyze(frame(0.15))
    const beam = r.model.members.find((m) => m.ref.kind === 'beam')!
    expect(beam.offI).toEqual([0, 0.15, 0])
    expect(beam.offJ).toEqual([0, 0.15, 0])
    expect(beam.length).toBeCloseTo(5, 9)
    // parede 10 kN/m × 5 m ⇒ 25 kN por pilar; M = 25 × 0,15 = 3,75 kN·m
    const rx = r.cases.elu.G!.reactions
    expect(rx.length).toBe(2)
    for (const q of rx) {
      expect(q.fz).toBeCloseTo(25, 6)
      expect(Math.abs(q.mx)).toBeCloseTo(3.75, 6)
    }
    expect(Math.sign(rx[0].mx)).toBe(Math.sign(rx[1].mx))
    // e o pilar é dimensionado com esse momento (constante ao longo da altura)
    const col = r.model.members.find((m) => m.ref.kind === 'column')!
    const d = r.cases.elu.G!.memberDiagrams[col.id]
    const mTop = Math.max(Math.abs(d.My[d.My.length - 1]), Math.abs(d.Mz[d.Mz.length - 1]))
    expect(mTop).toBeGreaterThan(3.7)
    expect(r.model.warnings.some((w) => w.startsWith('Excentricidade viga–pilar considerada'))).toBe(
      true,
    )
  })

  it('viga lançada só até a face, fora do eixo: mesma ligação e mesmo momento', () => {
    // pilar com 50 ao longo de X: faces em x = 0,25 e x = 4,75; viga a 8 cm do eixo
    const r = analyze(frame(0.08, { rot: 0, x0: 0.25, x1: 4.75 }))
    const beam = r.model.members.find((m) => m.ref.kind === 'beam')!
    expect(beam.length).toBeCloseTo(5, 9) // vão eixo a eixo
    expect(beam.offI![1]).toBeCloseTo(0.08, 9)
    expect(beam.offI![0]).toBeCloseTo(0, 9)
    // parede de 4,5 m × 10 kN/m = 45 kN ⇒ 22,5 kN por pilar × 0,08 = 1,8 kN·m
    for (const q of r.cases.elu.G!.reactions) {
      expect(q.fz).toBeCloseTo(22.5, 6)
      expect(Math.abs(q.mx)).toBeCloseTo(1.8, 6)
    }
  })

  it('equilíbrio global de momentos com as cargas na posição real', () => {
    const r = analyze(frame(0.15))
    const rx = r.cases.elu.G!.reactions
    // cargas: 50 kN para baixo ao longo da reta y = 0,15, de x = 0 a 5
    // ΣMx = y·Fz ; ΣMy = −x·Fz (em torno da origem)
    const mxLoad = 0.15 * -50
    const myLoad = -2.5 * -50
    let mx = 0
    let my = 0
    for (const q of rx) {
      const n = r.model.nodes[q.nodeId]
      mx += q.mx + (n.y * q.fz - n.z * q.fy)
      my += q.my + (n.z * q.fx - n.x * q.fz)
    }
    expect(mx + mxLoad).toBeCloseTo(0, 6)
    expect(my + myLoad).toBeCloseTo(0, 6)
  })
})

describe('trechos rígidos longitudinais (§14.6.2.1 / §14.6.2.4)', () => {
  it('desligado (padrão): vão eixo a eixo', () => {
    const r = analyze(frame(0, { rot: 0 }))
    expect(r.beamDesign[0].length).toBeCloseTo(5, 9)
  })

  it('ligado: ℓef = ℓ0 + a1 + a2 com a = min(t/2; 0,3·h)', () => {
    // pilar t = 50 cm na direção da viga; viga h = 40 cm
    // ℓ0 = 5 − 0,50 = 4,50 ; a = min(0,25; 0,12) = 0,12 ⇒ ℓef = 4,74 m
    const r = analyze(frame(0, { rot: 0, rigid: true }))
    const beam = r.model.members.find((m) => m.ref.kind === 'beam')!
    expect(beam.length).toBeCloseTo(4.74, 9)
    expect(beam.offI![0]).toBeCloseTo(0.13, 9)
    expect(beam.offJ![0]).toBeCloseTo(-0.13, 9)
    expect(r.beamDesign[0].length).toBeCloseTo(4.74, 6)
    // força vertical conservada e momento positivo menor que no vão eixo a eixo
    const fz = r.cases.elu.G!.reactions.reduce((s, q) => s + q.fz, 0)
    expect(fz).toBeCloseTo(50, 6)
    const ref = analyze(frame(0, { rot: 0 }))
    expect(r.beamDesign[0].positive.md).toBeLessThan(ref.beamDesign[0].positive.md)
    expect(r.model.warnings.some((w) => w.startsWith('Trechos rígidos longitudinais'))).toBe(true)
  })

  it('apoio estreito (t/2 ≤ 0,3·h): nada muda', () => {
    // pilar com 20 cm na direção da viga: t/2 = 0,10 < 0,12
    const r = analyze(frame(0, { rot: 90, rigid: true }))
    const beam = r.model.members.find((m) => m.ref.kind === 'beam')!
    expect(beam.offI).toBeUndefined()
    expect(beam.length).toBeCloseTo(5, 9)
  })

  it('excentricidade nos dois eixos ao mesmo tempo', () => {
    const r = analyze(frame(0.05, { rot: 0, rigid: true }))
    const beam = r.model.members.find((m) => m.ref.kind === 'beam')!
    expect(beam.offI![0]).toBeCloseTo(0.13, 9)
    expect(beam.offI![1]).toBeCloseTo(0.05, 9)
    // peso próprio do trecho rígido é mantido
    const p = frame(0.05, { rot: 0, rigid: true })
    p.settings.considerSelfWeight = true
    p.plans[0].wallLoads = []
    const rs = analyze(p)
    const fz = rs.cases.elu.G!.reactions.reduce((s, q) => s + q.fz, 0)
    const γ = p.settings.concreteUnitWeight
    const wBeam = 0.15 * 0.4 * γ * 5
    const wCols = 2 * 0.2 * 0.5 * γ * 3
    expect(fz).toBeCloseTo(wBeam + wCols, 6)
  })
})

describe('alertas de compatibilidade geométrica', () => {
  it('avisa quando a alma da viga passa da face do pilar', () => {
    // pilar com 20 cm na direção Y (meia largura 10 cm); viga de 15 cm a 5,5 cm do eixo
    // ⇒ borda da viga a 13 cm: 3 cm além da face
    const r = analyze(frame(0.055, { rot: 0 }))
    const w = r.model.warnings.find((x) => x.startsWith('Viga parcialmente fora'))
    expect(w).toBeDefined()
    expect(w).toContain('V1–P1: 3 cm')
    // viga inteira dentro do pilar: sem aviso
    const ok = analyze(frame(0.15))
    expect(ok.model.warnings.some((x) => x.startsWith('Viga parcialmente fora'))).toBe(false)
  })
})

describe('viga que cruza dentro do pilar fora do centro', () => {
  it('o trecho descartado dentro da seção continua apoiando a borda da laje', async () => {
    const { createSampleProject } = await import('../src/model/factory')
    const p = createSampleProject()
    const plan = p.plans[0]
    // desloca 8 cm a viga horizontal de fachada: as vigas verticais passam a
    // ser cortadas em y = 0,08, dentro dos pilares da fachada
    const b = plan.beams.find(
      (x) => x.path.every((q) => Math.abs(q.y) < 1e-9) && x.path.length >= 2,
    )!
    b.path = b.path.map((q) => ({ x: q.x, y: q.y + 0.08 }))
    const r = analyze(p)
    expect(r.model.warnings.some((w) => w.includes('parcialmente apoiada'))).toBe(false)
    expect(r.model.warnings.some((w) => w.startsWith('Excentricidade viga–pilar considerada'))).toBe(
      true,
    )
  })
})

describe('viga lançada de face a face sob a laje', () => {
  it('a borda da laje conta como apoiada até o eixo do pilar e a carga é conservada', async () => {
    const { createSampleProject } = await import('../src/model/factory')
    const ref = analyze(createSampleProject())
    const p = createSampleProject()
    const b = p.plans[0].beams.find((x) => x.path.every((q) => Math.abs(q.y) < 1e-9))!
    const xs = b.path.map((q) => q.x)
    // encurta a viga 12,5 cm em cada ponta (face dos pilares de canto)
    b.path = [
      { x: Math.min(...xs) + 0.125, y: 0 },
      { x: Math.max(...xs) - 0.125, y: 0 },
    ]
    const r = analyze(p)
    expect(r.model.warnings.some((w) => w.includes('parcialmente apoiada'))).toBe(false)
    // a carga das lajes chega inteira: só a alvenaria perde os 25 cm por pavimento
    const fz = (x: typeof r) => x.cases.elu.G!.reactions.reduce((s, q) => s + q.fz, 0)
    const w = r.model.levelWeights.reduce((s, lw) => s + lw.G, 0)
    expect(fz(r)).toBeCloseTo(w, 4)
    expect(fz(ref) - fz(r)).toBeGreaterThanOrEqual(0)
    expect((fz(ref) - fz(r)) / fz(ref)).toBeLessThan(0.003)
  })
})

describe('memorial', () => {
  it('descreve o modelo da ligação viga–pilar quando há braço rígido', async () => {
    const { buildMemorialPdf } = await import('../src/report/memorial')
    const text = (p: Project): string => {
      const bytes = buildMemorialPdf(p, analyze(p), { generatedAt: '26/11/2026 10:00' })
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return s
    }
    const ecc = text(frame(0.15))
    expect(ecc).toContain('14.6.2.1')
    expect(ecc).toContain('15 cm')
    // viga centrada e sem trechos rígidos: o parágrafo não aparece
    expect(text(frame(0))).not.toContain('14.6.2.1')
    expect(text(frame(0, { rot: 0, rigid: true }))).toContain('14.6.2.4')
  })
})

describe('robustez: edifício exemplo com vigas deslocadas ao acaso', () => {
  // gerador determinístico (LCG) — o teste não depende de Math.random
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const finite = (v: unknown): boolean => {
    if (typeof v === 'number') return Number.isFinite(v)
    if (Array.isArray(v)) return v.every(finite)
    if (v && typeof v === 'object') return Object.values(v).every(finite)
    return true
  }

  for (const seed of [1, 7, 42]) {
    for (const rigid of [false, true]) {
      it(`semente ${seed}, trechos rígidos ${rigid ? 'ligados' : 'desligados'}: equilíbrio e sem NaN`, async () => {
        const { createSampleProject } = await import('../src/model/factory')
        const base = createSampleProject()
        const ref = analyze(base)
        // o invariante vale no modelo de referência
        for (const k of ['G', 'Q'] as const) {
          const fz0 = ref.cases.elu[k]!.reactions.reduce((s, q) => s + q.fz, 0)
          const w0 = ref.model.levelWeights.reduce((s, lw) => s + lw[k], 0)
          expect(fz0).toBeCloseTo(w0, 4)
        }
        const p = createSampleProject()
        p.settings.rigidEndZones = rigid || undefined
        const rnd = rng(seed)
        // desloca cada viga reta até ±10 cm na direção transversal (dentro dos
        // pilares); os vértices das lajes sobre a viga acompanham, como no editor
        for (const plan of p.plans) {
          const moves: { axis: 'x' | 'y'; at: number; d: number }[] = []
          for (const b of plan.beams) {
            const a = b.path[0]
            const z = b.path[b.path.length - 1]
            const d = (rnd() - 0.5) * 0.2
            if (Math.abs(a.y - z.y) < 1e-9) {
              moves.push({ axis: 'y', at: a.y, d })
              b.path = b.path.map((q) => ({ x: q.x, y: q.y + d }))
            } else if (Math.abs(a.x - z.x) < 1e-9) {
              moves.push({ axis: 'x', at: a.x, d })
              b.path = b.path.map((q) => ({ x: q.x + d, y: q.y }))
            }
          }
          for (const sl of plan.slabs) {
            sl.polygon = sl.polygon.map((q) => {
              const mx = moves.find((m) => m.axis === 'x' && Math.abs(m.at - q.x) < 1e-6)
              const my = moves.find((m) => m.axis === 'y' && Math.abs(m.at - q.y) < 1e-6)
              return { x: q.x + (mx?.d ?? 0), y: q.y + (my?.d ?? 0) }
            })
          }
        }
        const r = analyze(p)
        expect(r.model.members.some((m) => m.offI || m.offJ)).toBe(true)
        // nenhum NaN/Infinity em deslocamentos, diagramas e reações
        for (const pass of [r.cases.elu, r.cases.els])
          for (const c of Object.values(pass)) expect(finite(c)).toBe(true)
        // equilíbrio vertical: Σ reações = peso total do modelo (G e Q)
        const total = (k: 'G' | 'Q') => r.model.levelWeights.reduce((s, lw) => s + lw[k], 0)
        for (const k of ['G', 'Q'] as const) {
          const fz = r.cases.elu[k]!.reactions.reduce((s, q) => s + q.fz, 0)
          expect(fz).toBeCloseTo(total(k), 4)
        }
        // a carga total é a do edifício de referência (vigas só mudaram de lugar)
        const fzRef = ref.cases.elu.G!.reactions.reduce((s, q) => s + q.fz, 0)
        const fzNew = r.cases.elu.G!.reactions.reduce((s, q) => s + q.fz, 0)
        expect(Math.abs(fzNew - fzRef) / fzRef).toBeLessThan(0.02)
        // dimensionamento continua completo e finito
        expect(r.beamDesign.length).toBeGreaterThan(0)
        expect(r.columnDesign.length).toBe(ref.columnDesign.length)
        expect(finite(r.columnDesign.map((c) => c.as))).toBe(true)
        // γz não dispara (o braço não desestabiliza o pórtico)
        expect(finite(r.stability)).toBe(true)
      })
    }
  }
})
