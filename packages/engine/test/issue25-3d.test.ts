import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { REBAR_CATEGORIES, buildRebar3D, rebarPathLength, type RebarGroup3D } from '../src/design/rebar3d'
import { columnFootprint } from '../src/model/columnSection'
import { coverFor } from '../src/nbr/nbr6118/materials'
import { arcPoints } from '../src/geometry/arc'
import { pointInPolygon } from '../src/geometry/geometry'
import type { Project, Vec2 } from '../src/model/types'

/** issue #25 — armaduras em 3D: o eixo de cada barra do detalhamento */

const project = createSampleProject()
const results = analyze(project)
const groups = buildRebar3D(project, results)
const cover = coverFor(project.settings.caa)
const of = (cat: RebarGroup3D['category'], list = groups) => list.filter((g) => g.category === cat)
const pts = (path: number[]): [number, number, number][] => {
  const out: [number, number, number][] = []
  for (let i = 0; i + 2 < path.length; i += 3) out.push([path[i], path[i + 1], path[i + 2]])
  return out
}
/** distância em planta de um ponto ao eixo (polilinha) */
const distToPath = (path: Vec2[], x: number, y: number): number => {
  let best = Infinity
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
    const t = Math.min(1, Math.max(0, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / L2))
    best = Math.min(best, Math.hypot(x - a.x - (b.x - a.x) * t, y - a.y - (b.y - a.y) * t))
  }
  return best
}
const beamOf = (p: Project, id: string) => p.plans.flatMap((pl) => pl.beams).find((b) => b.id === id)!

describe('grupos', () => {
  it('há barras de todas as categorias, com identificação única e dados da posição', () => {
    for (const c of REBAR_CATEGORIES) expect(of(c.id).length, c.id).toBeGreaterThan(0)
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length)
    for (const g of groups) {
      expect(g.paths.length, g.id).toBeGreaterThan(0)
      expect(g.phi, g.id).toBeGreaterThan(0.004)
      expect(g.phi, g.id).toBeLessThan(0.04)
      expect(g.unitLength, g.id).toBeGreaterThan(0.2)
      expect(g.n, g.id).toBeGreaterThan(0)
      expect(g.elementName, g.id).not.toBe('')
      for (const path of g.paths) {
        expect(path.length % 3, g.id).toBe(0)
        expect(path.length, g.id).toBeGreaterThanOrEqual(6)
        expect(path.every(Number.isFinite), g.id).toBe(true)
      }
    }
  })

  it('cada grupo aponta para a sua linha do quadro de ferros', () => {
    const items = results.detailing.steel.items
    for (const g of groups) {
      expect(g.pos, g.id).toBeDefined()
      const row = items.find((it) => it.elementId === g.elementId && it.pos === g.pos)
      expect(row, g.id).toBeDefined()
      expect(row!.phi, g.id).toBeCloseTo(g.phi, 9)
      expect(row!.unitLength, g.id).toBeCloseTo(g.unitLength, 2)
    }
  })

  it('a soma das barras desenhadas nos pavimentos bate com a quantidade do quadro', () => {
    const items = results.detailing.steel.items
    // longitudinais (positivas sem emenda, negativas, barras de pilar): n exato
    const sum = new Map<string, number>()
    for (const g of groups) {
      if (g.category === 'viga-estribo' || g.category === 'pilar-estribo') continue
      const key = `${g.elementId}|${g.pos}`
      sum.set(key, (sum.get(key) ?? 0) + g.n)
      expect(g.paths.length, g.id).toBe(g.n)
    }
    const spliced = new Set(
      results.detailing.beams.filter((d) => d.positive.splices).map((d) => `${d.beamId}|${d.positive.pos}`),
    )
    let checked = 0
    for (const [key, n] of sum) {
      if (spliced.has(key)) continue
      const [elementId, pos] = key.split('|')
      const row = items.find((it) => it.elementId === elementId && it.pos === Number(pos))!
      expect(n, key).toBe(row.n)
      checked++
    }
    expect(checked).toBeGreaterThan(40)
    // estribos de pilar: mesma contagem; de viga: a distribuição real fica perto da do quadro
    for (const g of of('pilar-estribo')) {
      expect(g.n, g.id).toBe(items.find((it) => it.elementId === g.elementId && it.pos === g.pos)!.n)
    }
    for (const g of of('viga-estribo')) {
      const d = results.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      expect(Math.abs(g.n - d.stirrup.count), g.id).toBeLessThanOrEqual(3)
    }
  })
})

describe('vigas', () => {
  it('toda barra fica dentro do concreto: na altura, na largura e no comprimento da viga', () => {
    for (const g of groups.filter((x) => x.elementKind === 'beam')) {
      const beam = beamOf(project, g.elementId)
      const d = results.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      const top = project.levels[g.levelIndex].elevation
      const { bw, h } = d.section
      for (const path of g.paths) {
        for (const [x, y, z] of pts(path)) {
          expect(z, g.id).toBeLessThanOrEqual(top - cover.beam + 1e-9)
          expect(z, g.id).toBeGreaterThanOrEqual(top - h + cover.beam - 1e-9)
          expect(distToPath(beam.path, x, y), g.id).toBeLessThanOrEqual(bw / 2 - cover.beam + 1e-6)
        }
      }
    }
  })

  it('positivas no fundo e negativas no topo, com as barras lado a lado na largura', () => {
    for (const g of of('viga-positiva')) {
      const d = results.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      const top = project.levels[g.levelIndex].elevation
      // trecho reto (o ponto mais baixo de cada barra) na metade de baixo
      for (const path of g.paths) expect(Math.min(...pts(path).map((p) => p[2])), g.id).toBeLessThan(top - d.section.h / 2)
      expect(g.n).toBe(d.positive.n)
    }
    for (const g of of('viga-negativa')) {
      const d = results.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      const top = project.levels[g.levelIndex].elevation
      for (const path of g.paths) expect(Math.max(...pts(path).map((p) => p[2])), g.id).toBeGreaterThan(top - d.section.h / 2)
    }
    // duas barras do mesmo grupo nunca ocupam o mesmo lugar
    for (const g of [...of('viga-positiva'), ...of('viga-negativa')]) {
      const keys = g.paths.map((p) => p.slice(0, 9).map((v) => v.toFixed(4)).join(','))
      expect(new Set(keys).size, g.id).toBe(keys.length)
    }
  })

  it('o comprimento desenhado é o de corte, salvo onde a ponta foi limitada à viga', () => {
    let exact = 0
    for (const g of [...of('viga-positiva'), ...of('viga-negativa')]) {
      for (const path of g.paths) {
        const L = rebarPathLength(path)
        expect(L, g.id).toBeLessThanOrEqual(g.unitLength + 1e-6)
        if (Math.abs(L - g.unitLength) < 1e-6) exact++
      }
    }
    // negativas de apoio interno passam direto: comprimento exato
    expect(exact).toBeGreaterThan(20)
  })

  it('estribos: laços fechados, perpendiculares ao eixo, no passo do detalhamento', () => {
    for (const g of of('viga-estribo')) {
      const d = results.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      const loops = g.paths.filter((p) => p.length === 15)
      expect(loops.length, g.id).toBe(g.paths.length) // 2 ramos: só laços
      for (const p of loops) expect(p.slice(0, 3), g.id).toEqual(p.slice(12, 15))
      // sem trechos: distância entre laços consecutivos = passo
      if (!d.stirrup.zones) {
        for (let i = 1; i < loops.length; i++) {
          const step = Math.hypot(loops[i][0] - loops[i - 1][0], loops[i][1] - loops[i - 1][1])
          expect(step, g.id).toBeCloseTo(Math.max(d.stirrup.spacing, 0.03), 6)
        }
      }
      // o laço tem a altura da viga menos os cobrimentos
      const zs = pts(loops[0]).map((p) => p[2])
      expect(Math.max(...zs) - Math.min(...zs), g.id).toBeCloseTo(d.section.h - 2 * cover.beam - d.stirrup.phi, 9)
    }
  })

  it('a mesma viga se repete em cada pavimento que usa a planta, só mudando a cota', () => {
    const beam = project.plans[0].beams[0]
    const levels = project.levels.flatMap((l, i) => (l.planId === project.plans[0].id ? [i] : []))
    expect(levels.length).toBeGreaterThan(1)
    const at = (li: number) => groups.filter((g) => g.elementId === beam.id && g.levelIndex === li)
    const ref = at(levels[0])
    expect(ref.length).toBeGreaterThan(2)
    for (const li of levels.slice(1)) {
      const here = at(li)
      expect(here.map((g) => [g.category, g.spanIndex, g.pos, g.n])).toEqual(ref.map((g) => [g.category, g.spanIndex, g.pos, g.n]))
      const dz = project.levels[li].elevation - project.levels[levels[0]].elevation
      expect(here[0].paths[0][2] - ref[0].paths[0][2]).toBeCloseTo(dz, 9)
      expect(here[0].paths[0].slice(0, 2)).toEqual(ref[0].paths[0].slice(0, 2))
    }
  })
})

describe('pilares', () => {
  it('barras dentro da seção, na vertical, do piso ao traspasse acima do piso seguinte', () => {
    for (const g of of('pilar-barra')) {
      const col = project.columns.find((c) => c.id === g.elementId)!
      const det = results.detailing.columns.find((c) => c.columnId === g.elementId)!
      const foot = columnFootprint(col)
      const zb = project.levels[g.levelIndex].elevation
      const zt = project.levels[g.levelTop!].elevation
      const last = g.spanIndex === det.storyHeights.length - 1
      expect(g.n).toBe(det.barsN)
      for (const path of g.paths) {
        const [a, b] = pts(path)
        expect(pointInPolygon({ x: a[0], y: a[1] }, foot), g.id).toBe(true)
        expect([a[0], a[1]], g.id).toEqual([b[0], b[1]])
        expect(a[2], g.id).toBeCloseTo(zb, 9)
        expect(b[2], g.id).toBeCloseTo(last ? zt - cover.column : zt + det.lapLength, 9)
      }
    }
  })

  it('estribos: um laço fechado por posição, dentro da seção e entre os dois pisos', () => {
    for (const g of of('pilar-estribo')) {
      const col = project.columns.find((c) => c.id === g.elementId)!
      const foot = columnFootprint(col)
      const zb = project.levels[g.levelIndex].elevation
      const zt = project.levels[g.levelTop!].elevation
      const zs: number[] = []
      for (const path of g.paths) {
        const p = pts(path)
        expect(p[0], g.id).toEqual(p[p.length - 1])
        expect(new Set(p.map((q) => q[2])).size, g.id).toBe(1)
        for (const q of p) expect(pointInPolygon({ x: q[0], y: q[1] }, foot), g.id).toBe(true)
        zs.push(p[0][2])
      }
      expect(Math.min(...zs), g.id).toBeGreaterThan(zb)
      expect(Math.max(...zs), g.id).toBeLessThan(zt)
      expect([...zs].sort((a, b) => a - b), g.id).toEqual(zs)
    }
  })
})

describe('filtro por pavimento', () => {
  it('só as vigas do pavimento e os tramos de pilar que o tocam', () => {
    const li = 2
    const only = buildRebar3D(project, results, { levels: [li] })
    expect(only.length).toBeGreaterThan(0)
    expect(only.length).toBeLessThan(groups.length)
    for (const g of only) {
      if (g.elementKind === 'beam') expect(g.levelIndex).toBe(li)
      else expect([g.levelIndex, g.levelTop]).toContain(li)
    }
    expect(only).toEqual(groups.filter((g) => (g.elementKind === 'beam' ? g.levelIndex === li : g.levelIndex === li || g.levelTop === li)))
    expect(buildRebar3D(project, results, { levels: [] })).toEqual([])
  })
})

describe('casos especiais', () => {
  it('ajustes do editor aparecem: quantidade, estribos de 4 ramos e trechos de passo próprio', () => {
    const d0 = results.detailing.beams[0]
    const p2: Project = {
      ...project,
      rebarOverrides: [
        { beamId: d0.beamId, spanIndex: d0.spanIndex, slot: 'positive', n: d0.positive.n + 2, phi: d0.positive.phi },
        { beamId: d0.beamId, spanIndex: d0.spanIndex, slot: 'stirrup', n: 0, phi: 0.0063, spacing: 0.2, legs: 4, left: { length: 0.8, spacing: 0.1 }, right: { length: 0.8, spacing: 0.1 } },
      ],
    }
    const r2 = analyze(p2)
    const g2 = buildRebar3D(p2, r2).filter((g) => g.elementId === d0.beamId && g.spanIndex === d0.spanIndex && g.levelIndex === groups.find((x) => x.elementId === d0.beamId)!.levelIndex)
    const pos = g2.find((g) => g.category === 'viga-positiva')!
    expect(pos.n).toBe(d0.positive.n + 2)
    const st = g2.find((g) => g.category === 'viga-estribo')!
    expect(st.phi).toBeCloseTo(0.0063, 9)
    expect(st.label).toContain('4 ramos')
    const loops = st.paths.filter((p) => p.length === 15)
    const inner = st.paths.filter((p) => p.length === 6)
    // 4 ramos: dois ramos internos por laço
    expect(inner.length).toBe(2 * loops.length)
    // passos: 10 cm junto aos apoios, 20 cm no meio
    const steps = loops.slice(1).map((l, i) => Math.round(Math.hypot(l[0] - loops[i][0], l[1] - loops[i][1]) * 100))
    // (na passagem de um trecho ao outro o intervalo fica entre os dois passos)
    expect(Math.min(...steps)).toBe(10)
    expect(Math.max(...steps)).toBe(20)
    expect(steps.filter((v) => v === 10).length).toBeGreaterThanOrEqual(12)
    expect(steps[0]).toBe(10)
    expect(steps[Math.floor(steps.length / 2)]).toBe(20)
    expect(steps[steps.length - 1]).toBe(10)
  })

  it('viga curva: as barras acompanham a curva e não saem da largura', () => {
    const plan = project.plans[0]
    const b = plan.beams.find((x) => x.path.length === 2)!
    const curved = { ...b, path: arcPoints(b.path[0], b.path[1], 0.6) }
    const p2: Project = { ...project, plans: project.plans.map((pl) => (pl.id === plan.id ? { ...pl, beams: pl.beams.map((x) => (x.id === b.id ? curved : x)) } : pl)) }
    const r2 = analyze(p2)
    const g2 = buildRebar3D(p2, r2).filter((g) => g.elementId === b.id)
    expect(g2.length).toBeGreaterThan(0)
    const long = g2.filter((g) => g.category === 'viga-positiva')
    expect(long.some((g) => g.paths.some((p) => p.length > 12))).toBe(true)
    for (const g of g2) {
      const d = r2.detailing.beams.find((x) => x.beamId === g.elementId && x.spanIndex === g.spanIndex)!
      for (const path of g.paths) for (const [x, y] of pts(path)) expect(distToPath(curved.path, x, y), g.id).toBeLessThanOrEqual(d.section.bw / 2 - cover.beam + 2e-3)
    }
  })

  it('pilar girado, circular e em L: barras e estribos dentro do contorno', () => {
    const [c0, c1, c2] = project.columns
    const p2: Project = {
      ...project,
      columns: project.columns.map((c) =>
        c.id === c0.id
          ? { ...c, rotationDeg: 90 as const }
          : c.id === c1.id
            ? { ...c, section: { shape: 'circle' as const, d: 0.5 } }
            : c.id === c2.id
              ? { ...c, section: { shape: 'L' as const, b: 0.6, h: 0.6, tb: 0.2, th: 0.2 }, rotationDeg: 180 as const }
              : c,
      ),
    }
    const r2 = analyze(p2)
    const g2 = buildRebar3D(p2, r2)
    for (const id of [c0.id, c1.id, c2.id]) {
      const col = p2.columns.find((c) => c.id === id)!
      const foot = columnFootprint(col)
      const mine = g2.filter((g) => g.elementId === id)
      expect(mine.some((g) => g.category === 'pilar-barra'), col.name).toBe(true)
      expect(mine.some((g) => g.category === 'pilar-estribo'), col.name).toBe(true)
      for (const g of mine) for (const path of g.paths) for (const [x, y] of pts(path)) expect(pointInPolygon({ x, y }, foot), g.id).toBe(true)
    }
    // circular: o estribo é um anel (24 lados + fechamento)
    const ring = g2.find((g) => g.elementId === c1.id && g.category === 'pilar-estribo')!
    expect(ring.paths[0].length).toBe(25 * 3)
  })

  it('sem detalhamento não há barras', () => {
    const empty = { ...results, detailing: { ...results.detailing, beams: [], columns: [] } }
    expect(buildRebar3D(project, empty)).toEqual([])
  })
})
