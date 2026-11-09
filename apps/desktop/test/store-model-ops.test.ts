import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleProject, type Project } from '@hyperframe/engine'
import { useStore } from '../src/store'

/**
 * Ações de modelagem em projeto existente (issue #4):
 * adicionar/remover níveis e mover elementos arrastando vértices coincidentes.
 */

const sortedLevels = (p: Project) => [...p.levels].sort((a, b) => a.elevation - b.elevation)

beforeEach(() => {
  useStore.setState({
    project: createSampleProject(),
    results: null,
    analysisStatus: 'idle',
    selection: null,
  })
})

const st = () => useStore.getState()

describe('addLevel', () => {
  it('adiciona nível acima do topo e estende os pilares que terminavam lá', () => {
    const before = st().project
    const top = sortedLevels(before)[before.levels.length - 1]
    const nCols = before.columns.filter((c) => c.topLevelId === top.id).length
    expect(nCols).toBeGreaterThan(0)

    st().addLevel({ aboveLevelId: top.id, height: 2.8, extendColumns: true })

    const p = st().project
    expect(p.levels.length).toBe(before.levels.length + 1)
    const newTop = sortedLevels(p)[p.levels.length - 1]
    expect(newTop.name).toBe('Novo nível')
    expect(newTop.elevation).toBeCloseTo(top.elevation + 2.8, 9)
    expect(newTop.planId).toBeNull()
    // pilares estendidos até o novo topo
    expect(p.columns.filter((c) => c.topLevelId === newTop.id).length).toBe(nCols)
    // array mantém o invariante: ordenado por cota (levels[0] = base, último = topo)
    expect(p.levels[p.levels.length - 1].id).toBe(newTop.id)
    expect(st().results).toBeNull()
  })

  it('sem extendColumns os pilares continuam no topo antigo', () => {
    const top = sortedLevels(st().project)[st().project.levels.length - 1]
    st().addLevel({ aboveLevelId: top.id, height: 3 })
    const p = st().project
    expect(p.columns.every((c) => c.topLevelId === top.id)).toBe(true)
  })

  it('insere nível intermediário deslocando os superiores pelo pé-direito novo', () => {
    const before = sortedLevels(st().project)
    const base = before[0]
    const elevAcima = before.slice(1).map((l) => l.elevation)
    st().addLevel({ aboveLevelId: base.id, height: 2.5 })
    const p = sortedLevels(st().project)
    expect(p[1].name).toBe('Novo nível')
    expect(p[1].elevation).toBeCloseTo(base.elevation + 2.5, 9)
    p.slice(2).forEach((l, i) => expect(l.elevation).toBeCloseTo(elevAcima[i] + 2.5, 9))
  })

  it('adiciona subsolo abaixo da base (aboveLevelId null)', () => {
    const base = sortedLevels(st().project)[0]
    st().addLevel({ aboveLevelId: null, height: 3 })
    const p = sortedLevels(st().project)
    expect(p[0].elevation).toBeCloseTo(base.elevation - 3, 9)
    expect(p[1].id).toBe(base.id)
    expect(p[1].elevation).toBeCloseTo(base.elevation, 9) // demais não se movem
  })

  it('rejeita pé-direito fora da faixa', () => {
    const n = st().project.levels.length
    st().addLevel({ aboveLevelId: null, height: 0.4 })
    st().addLevel({ aboveLevelId: null, height: 25 })
    expect(st().project.levels.length).toBe(n)
  })
})

describe('deleteLevel', () => {
  it('remove nível livre e desce os superiores pelo pé-direito removido', () => {
    const top0 = sortedLevels(st().project)[st().project.levels.length - 1]
    // cria um nível novo no topo (sem pilares ancorados) e o remove em seguida
    st().addLevel({ aboveLevelId: top0.id, height: 2.8 })
    const added = sortedLevels(st().project)[st().project.levels.length - 1]
    st().addLevel({ aboveLevelId: added.id, height: 3 })
    const extra = sortedLevels(st().project)[st().project.levels.length - 1]
    const elevExtra = extra.elevation

    st().deleteLevel(added.id)
    const p = sortedLevels(st().project)
    expect(p.find((l) => l.id === added.id)).toBeUndefined()
    // o nível acima desceu os 2,8 m do removido
    expect(p[p.length - 1].id).toBe(extra.id)
    expect(p[p.length - 1].elevation).toBeCloseTo(elevExtra - 2.8, 9)
  })

  it('não remove nível com pilar ancorado (base/topo)', () => {
    const p0 = st().project
    const top = sortedLevels(p0)[p0.levels.length - 1]
    expect(p0.columns.some((c) => c.topLevelId === top.id)).toBe(true)
    st().deleteLevel(top.id)
    expect(st().project.levels.length).toBe(p0.levels.length)
  })
})

describe('moveColumn', () => {
  it('move o pilar e arrasta vértices coincidentes de vigas/lajes', () => {
    const p0 = st().project
    const col = p0.columns[0]
    const old = { ...col.pos }
    // vértices coincidentes antes do movimento
    const coincBeams = p0.plans.flatMap((pl) =>
      pl.beams.flatMap((b) =>
        b.path
          .map((pt, i) => ({ beam: b.id, i, hit: Math.hypot(pt.x - old.x, pt.y - old.y) < 0.02 }))
          .filter((v) => v.hit),
      ),
    )
    expect(coincBeams.length).toBeGreaterThan(0)

    const target = { x: old.x + 0.5, y: old.y + 0.35 }
    expect(st().moveColumn(col.id, target)).toBe('ok')

    const p = st().project
    expect(p.columns[0].pos).toEqual(target)
    for (const v of coincBeams) {
      const beam = p.plans.flatMap((pl) => pl.beams).find((b) => b.id === v.beam)!
      expect(beam.path[v.i].x).toBeCloseTo(old.x + 0.5, 9)
      expect(beam.path[v.i].y).toBeCloseTo(old.y + 0.35, 9)
    }
    expect(st().results).toBeNull()
  })

  it('recusa mover para cima de outro pilar', () => {
    const [a, b] = st().project.columns
    expect(st().moveColumn(a.id, { ...b.pos })).toBe('duplicate')
    expect(st().project.columns[0].pos).toEqual(a.pos)
  })
})

describe('moveBeam', () => {
  it('translada a viga inteira e vértices de laje coincidentes acompanham', () => {
    const p0 = st().project
    const plan = p0.plans.find((pl) => pl.beams.length > 0 && pl.slabs.length > 0)!
    const beam = plan.beams.find((b) =>
      plan.slabs.some((sl) =>
        sl.polygon.some((pt) =>
          b.path.some((q) => Math.hypot(pt.x - q.x, pt.y - q.y) < 0.02),
        ),
      ),
    )!
    const origPath = beam.path.map((p) => ({ ...p }))
    const slabHits = plan.slabs.flatMap((sl) =>
      sl.polygon
        .map((pt, i) => ({
          slab: sl.id,
          i,
          hit: origPath.some((q) => Math.hypot(pt.x - q.x, pt.y - q.y) < 0.02),
        }))
        .filter((v) => v.hit),
    )
    expect(slabHits.length).toBeGreaterThan(0)

    st().moveBeam(beam.id, { x: 0.3, y: -0.2 })

    const p = st().project
    const moved = p.plans.flatMap((pl) => pl.beams).find((b) => b.id === beam.id)!
    moved.path.forEach((pt, i) => {
      expect(pt.x).toBeCloseTo(origPath[i].x + 0.3, 9)
      expect(pt.y).toBeCloseTo(origPath[i].y - 0.2, 9)
    })
    const slabs = p.plans.find((pl) => pl.id === plan.id)!.slabs
    for (const v of slabHits) {
      const sl = slabs.find((s) => s.id === v.slab)!
      const orig = plan.slabs.find((s) => s.id === v.slab)!.polygon[v.i]
      expect(sl.polygon[v.i].x).toBeCloseTo(orig.x + 0.3, 9)
      expect(sl.polygon[v.i].y).toBeCloseTo(orig.y - 0.2, 9)
    }
  })
})
