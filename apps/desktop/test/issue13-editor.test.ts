import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject, type Project } from '@hyperframe/engine'
import { useStore } from '../src/store'
import {
  alignInProject,
  anchorOffset,
  centerFromAnchor,
  distributeInProject,
  elementBounds,
} from '../src/store/align'

/** issue #13 — ponto de inserção do pilar, alinhar e distribuir */

const base = (): Project => {
  const p = createEmptyProject({
    name: 't',
    fck: 30_000,
    aggregate: 'granito',
    caa: 'II',
    numFloors: 1,
    floorHeight: 3,
    wind: { enabled: false, v0: 30, s1: 1, category: 4, s3Group: 2 },
  })
  return p
}

const col = (p: Project, id: string, x: number, y: number, bw = 0.2, h = 0.5, rot: 0 | 90 = 0) => {
  p.columns.push({
    id,
    name: id.toUpperCase(),
    pos: { x, y },
    section: { bw, h },
    rotationDeg: rot,
    baseLevelId: p.levels[0].id,
    topLevelId: p.levels[p.levels.length - 1].id,
  })
}

beforeEach(() => {
  const p = base()
  useStore.setState({
    project: p,
    results: null,
    analysisStatus: 'idle',
    selection: null,
    multi: [],
    activeLevelId: p.levels[p.levels.length - 1].id,
    defaults: {
      ...useStore.getState().defaults,
      columnSection: { bw: 0.2, h: 0.5 },
      columnRotation: 0,
      columnAnchor: undefined,
    },
  })
})
const st = () => useStore.getState()

describe('ponto de inserção do pilar', () => {
  it('offset da âncora segue a seção girada (h ao longo de X em 0°)', () => {
    const c = { section: { bw: 0.2, h: 0.5 }, rotationDeg: 0 as const }
    expect(anchorOffset(c, 'c')).toEqual({ x: 0, y: 0 })
    expect(anchorOffset(c, 'e')).toEqual({ x: 0.25, y: 0 })
    expect(anchorOffset(c, 'sw')).toEqual({ x: -0.25, y: -0.1 })
    expect(anchorOffset({ ...c, rotationDeg: 90 }, 'n')).toEqual({ x: 0, y: 0.25 })
    expect(centerFromAnchor(c, 'w', { x: 0, y: 0 })).toEqual({ x: 0.25, y: 0 })
  })

  it('inserir pelo centro (padrão) não muda o comportamento', () => {
    st().addColumn({ x: 2, y: 3 })
    expect(st().project.columns[0].pos).toEqual({ x: 2, y: 3 })
  })

  it('inserir pela face esquerda: a face cai no clique e o centro fica meio h adiante', () => {
    st().setDefaults({ columnAnchor: 'w' })
    st().addColumn({ x: 0, y: 0 })
    const c = st().project.columns[0]
    expect(c.pos.x).toBeCloseTo(0.25, 9)
    expect(c.pos.y).toBeCloseTo(0, 9)
    expect(elementBounds(st().project, { kind: 'column', id: c.id })!.minX).toBeCloseTo(0, 9)
  })

  it('inserir pelo canto: canto inferior esquerdo no clique', () => {
    st().setDefaults({ columnAnchor: 'sw' })
    st().addColumn({ x: 1, y: 1 })
    const b = elementBounds(st().project, { kind: 'column', id: st().project.columns[0].id })!
    expect(b.minX).toBeCloseTo(1, 9)
    expect(b.minY).toBeCloseTo(1, 9)
  })

  it('mudar a seção mantém a face de referência parada', () => {
    const p = base()
    col(p, 'p1', 0.25, 0)
    useStore.setState({ project: p })
    // face esquerda em x = 0; h passa de 50 para 80 cm
    st().resizeColumn('p1', { section: { bw: 0.2, h: 0.8 } }, 'w')
    const c = st().project.columns[0]
    expect(c.pos.x).toBeCloseTo(0.4, 9)
    expect(elementBounds(st().project, { kind: 'column', id: 'p1' })!.minX).toBeCloseTo(0, 9)
    // girar 90° com o canto inferior esquerdo fixo
    const b0 = elementBounds(st().project, { kind: 'column', id: 'p1' })!
    st().resizeColumn('p1', { rotationDeg: 90 }, 'sw')
    const b1 = elementBounds(st().project, { kind: 'column', id: 'p1' })!
    expect(b1.minX).toBeCloseTo(b0.minX, 9)
    expect(b1.minY).toBeCloseTo(b0.minY, 9)
    expect(st().results).toBeNull()
  })
})

describe('alinhar pela âncora', () => {
  it('alinha as faces esquerdas de pilares de seções diferentes', () => {
    const p = base()
    col(p, 'a', 0, 0, 0.2, 0.5) // face esquerda em −0,25
    col(p, 'b', 0.1, 4, 0.2, 0.8) // face esquerda em −0,30
    col(p, 'c', -0.05, 8, 0.2, 0.3, 90) // 20 cm em X: face esquerda em −0,15
    const refs = (['a', 'b', 'c'] as const).map((id) => ({ kind: 'column' as const, id }))
    const r = alignInProject(p, refs, refs[0], 'left')
    if (r === 'none' || r === 'duplicate') throw new Error('não alinhou')
    expect(r.moved).toBe(2)
    for (const ref of refs)
      expect(elementBounds(r.project, ref)!.minX).toBeCloseTo(-0.25, 9)
    // a âncora não se move; ninguém muda de Y nem de seção
    expect(r.project.columns[0].pos).toEqual({ x: 0, y: 0 })
    expect(r.project.columns.map((c) => c.pos.y)).toEqual([0, 4, 8])
  })

  it('topo, base e centros', () => {
    const p = base()
    col(p, 'a', 0, 0, 0.2, 0.5, 90) // meia altura em Y = 0,25
    col(p, 'b', 4, 0.3, 0.2, 0.3, 90) // meia altura em Y = 0,15
    const refs = [
      { kind: 'column' as const, id: 'a' },
      { kind: 'column' as const, id: 'b' },
    ]
    const top = alignInProject(p, refs, refs[0], 'top')
    if (top === 'none' || top === 'duplicate') throw new Error()
    expect(elementBounds(top.project, refs[1])!.maxY).toBeCloseTo(0.25, 9)
    const bottom = alignInProject(p, refs, refs[0], 'bottom')
    if (bottom === 'none' || bottom === 'duplicate') throw new Error()
    expect(elementBounds(bottom.project, refs[1])!.minY).toBeCloseTo(-0.25, 9)
    const cy = alignInProject(p, refs, refs[0], 'centerY')
    if (cy === 'none' || cy === 'duplicate') throw new Error()
    expect(cy.project.columns[1].pos).toEqual({ x: 4, y: 0 })
  })

  it('a viga presa ao pilar acompanha; alinhar de novo não move nada', () => {
    const p = base()
    col(p, 'a', 0, 0)
    col(p, 'b', 5, 0.2)
    p.plans[0].beams = [
      { id: 'v', name: 'V1', path: [{ x: 0, y: 0 }, { x: 5, y: 0.2 }], section: { bw: 0.15, h: 0.4 } },
    ]
    const refs = [
      { kind: 'column' as const, id: 'a' },
      { kind: 'column' as const, id: 'b' },
    ]
    const r = alignInProject(p, refs, refs[0], 'centerY')
    if (r === 'none' || r === 'duplicate') throw new Error()
    expect(r.project.plans[0].beams[0].path[1]).toEqual({ x: 5, y: 0 })
    expect(alignInProject(r.project, refs, refs[0], 'centerY')).toBe('none')
  })

  it('pelo store: a âncora é o último selecionado e tudo é um passo de desfazer', () => {
    const p = base()
    col(p, 'a', 0, 0)
    col(p, 'b', 0.3, 4)
    col(p, 'c', -0.2, 8)
    useStore.setState({ project: p })
    useStore.temporal.getState().clear()
    st().select({ kind: 'column', id: 'b' })
    st().toggleSelect({ kind: 'column', id: 'c' })
    st().toggleSelect({ kind: 'column', id: 'a' }) // âncora
    expect(st().alignSelection('centerX')).toBe('ok')
    expect(st().project.columns.map((c) => c.pos.x)).toEqual([0, 0, 0])
    useStore.temporal.getState().undo()
    expect(st().project.columns.map((c) => c.pos.x)).toEqual([0, 0.3, -0.2])
  })
})

describe('distribuir', () => {
  it('centros igualmente espaçados; os extremos ficam parados', () => {
    const p = base()
    col(p, 'a', 0, 0)
    col(p, 'b', 1, 0)
    col(p, 'c', 7, 0)
    col(p, 'd', 12, 0)
    const refs = (['c', 'a', 'd', 'b'] as const).map((id) => ({ kind: 'column' as const, id }))
    const r = distributeInProject(p, refs, 'x')
    if (r === 'none' || r === 'duplicate') throw new Error()
    expect(r.project.columns.map((c) => c.pos.x)).toEqual([0, 4, 8, 12])
    expect(r.moved).toBe(2)
  })

  it('menos de 3 elementos: nada a fazer', () => {
    const p = base()
    col(p, 'a', 0, 0)
    col(p, 'b', 1, 0)
    expect(
      distributeInProject(
        p,
        [
          { kind: 'column', id: 'a' },
          { kind: 'column', id: 'b' },
        ],
        'x',
      ),
    ).toBe('none')
  })
})
