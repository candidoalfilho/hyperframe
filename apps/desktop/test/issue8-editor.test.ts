import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleProject } from '@hyperframe/engine'
import { useStore } from '../src/store'
import { hitTest, marqueeHits, type HitContext } from '../src/editor2d/hittest'

/** issue #8 — cargas concentradas e lineares sobre lajes no editor */

beforeEach(() => {
  const p = createSampleProject()
  useStore.setState({
    project: p,
    results: null,
    analysisStatus: 'idle',
    selection: null,
    multi: [],
    activeLevelId: [...p.levels].sort((a, b) => a.elevation - b.elevation)[1].id,
    defaults: { ...useStore.getState().defaults, slabLoadKind: undefined, slabLoadG: undefined, slabLoadQ: undefined },
  })
  useStore.temporal.getState().clear()
})
const st = () => useStore.getState()
const loads = () => st().project.plans[0].slabLoads ?? []
const ctx = (): HitContext => {
  const pl = st().project.plans[0]
  return {
    columns: st().project.columns,
    beams: pl.beams,
    slabs: pl.slabs,
    wallLoads: pl.wallLoads,
    loadRegions: pl.loadRegions,
    slabLoads: pl.slabLoads ?? [],
    showLoads: true,
    showSlabs: true,
    k: 60,
  }
}

describe('lançar cargas na laje', () => {
  it('1 ponto cria carga pontual com os valores padrão e a seleciona', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    expect(loads().length).toBe(1)
    const l = loads()[0]
    expect(l).toMatchObject({ name: 'CP1', kind: 'point', a: { x: 2, y: 2 }, g: 10, q: 0 })
    expect(l.b).toBeUndefined()
    expect(st().selection).toEqual({ kind: 'slabLoad', id: l.id })
    expect(st().results).toBeNull()
  })

  it('2 pontos criam carga linear; nomes seguem por tipo', () => {
    st().setDefaults({ slabLoadKind: 'line', slabLoadG: 6, slabLoadQ: 1 })
    st().addSlabLoad([{ x: 1, y: 2 }, { x: 3, y: 2 }])
    st().addSlabLoad([{ x: 1, y: 3 }, { x: 3, y: 3 }])
    st().addSlabLoad([{ x: 2, y: 1 }])
    expect(loads().map((l) => l.name)).toEqual(['CL1', 'CL2', 'CP1'])
    expect(loads()[0]).toMatchObject({ kind: 'line', b: { x: 3, y: 2 }, g: 6, q: 1 })
  })

  it('linha de comprimento nulo é ignorada', () => {
    st().addSlabLoad([{ x: 1, y: 2 }, { x: 1.01, y: 2 }])
    expect(loads().length).toBe(0)
  })

  it('editar, mover e excluir; tudo desfazível', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    const id = loads()[0].id
    st().updateSlabLoad(id, { g: 25, size: { bx: 0.3, by: 0.4 } })
    expect(loads()[0]).toMatchObject({ g: 25, size: { bx: 0.3, by: 0.4 } })
    st().moveSlabLoad(id, { x: 0.5, y: -0.25 })
    expect(loads()[0].a).toEqual({ x: 2.5, y: 1.75 })
    st().deleteElement({ kind: 'slabLoad', id })
    expect(loads().length).toBe(0)
    useStore.temporal.getState().undo()
    expect(loads().length).toBe(1)
    expect(loads()[0].a).toEqual({ x: 2.5, y: 1.75 })
  })

  it('o projeto sem cargas na laje continua válido (campo opcional)', () => {
    expect(st().project.plans[0].slabLoads).toBeUndefined()
    st().selectAll()
    expect(st().multi.some((r) => r.kind === 'slabLoad')).toBe(false)
  })
})

describe('seleção e movimento em grupo', () => {
  it('o clique pega a carga antes da laje; a linha é pega em qualquer ponto dela', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    st().setDefaults({ slabLoadKind: 'line' })
    st().addSlabLoad([{ x: 1, y: 3 }, { x: 3, y: 3 }])
    const [p, l] = loads()
    expect(hitTest({ x: 2.03, y: 2.02 }, ctx())).toEqual({ kind: 'slabLoad', id: p.id })
    expect(hitTest({ x: 2.4, y: 3.05 }, ctx())).toEqual({ kind: 'slabLoad', id: l.id })
    // longe das cargas: a laje
    expect(hitTest({ x: 2, y: 1 }, ctx())?.kind).toBe('slab')
  })

  it('janela de seleção inclui as cargas; a que cruza pega a linha tocada', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    st().setDefaults({ slabLoadKind: 'line' })
    st().addSlabLoad([{ x: 1, y: 3 }, { x: 3.5, y: 3 }])
    const inside = marqueeHits({ x0: 0.5, y0: 1.5, x1: 3, y1: 3.5 }, false, ctx())
    expect(inside.filter((r) => r.kind === 'slabLoad').length).toBe(1) // só a pontual inteira
    const crossing = marqueeHits({ x0: 0.5, y0: 1.5, x1: 3, y1: 3.5 }, true, ctx())
    expect(crossing.filter((r) => r.kind === 'slabLoad').length).toBe(2)
  })

  it('mover em grupo desloca só as cargas selecionadas; excluir em grupo remove', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    st().addSlabLoad([{ x: 3, y: 3 }])
    const [a, b] = loads()
    st().moveElements([{ kind: 'slabLoad', id: a.id }], { x: 1, y: 0 })
    expect(loads()[0].a).toEqual({ x: 3, y: 2 })
    expect(loads()[1].a).toEqual({ x: 3, y: 3 })
    st().deleteElements([
      { kind: 'slabLoad', id: a.id },
      { kind: 'slabLoad', id: b.id },
    ])
    expect(loads().length).toBe(0)
  })

  it('Ctrl+A inclui as cargas na laje', () => {
    st().addSlabLoad([{ x: 2, y: 2 }])
    st().selectAll()
    expect(st().multi.filter((r) => r.kind === 'slabLoad').length).toBe(1)
  })
})
