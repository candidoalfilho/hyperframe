import { beforeEach, describe, expect, it } from 'vitest'
import {
  DIM_STYLE_DEFAULT,
  analyze,
  createSampleProject,
  dimensionValues,
  lostDimRefs,
  type Dimension,
} from '@hyperframe/engine'
import { useStore } from '../src/store'
import { hitTest, marqueeHits, type HitContext } from '../src/editor2d/hittest'
import { dimFromPicks, dimOffsetAt, dimTextHeight, dimensionAt, linearDirFor } from '../src/editor2d/dimTool'

/** issue #10 — cotas permanentes no editor */

beforeEach(() => {
  const p = createSampleProject()
  useStore.setState({
    project: p,
    results: null,
    analysisStatus: 'idle',
    selection: null,
    multi: [],
    activeLevelId: [...p.levels].sort((a, b) => a.elevation - b.elevation)[1].id,
  })
  useStore.temporal.getState().clear()
})
const st = () => useStore.getState()
const dims = () => st().project.plans[0].dimensions ?? []
const cols = () => [...st().project.columns].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
const picks = (points: { x: number; y: number }[], cursor: { x: number; y: number } | null, extra = {}) => ({
  points,
  cursor,
  placing: false,
  mode: 'linear' as const,
  form: 'single' as const,
  total: true,
  assoc: true,
  ...extra,
})
const ctx = (k = 40): HitContext => {
  const pl = st().project.plans[0]
  return {
    columns: st().project.columns,
    beams: pl.beams,
    slabs: pl.slabs,
    wallLoads: pl.wallLoads,
    loadRegions: pl.loadRegions,
    slabLoads: pl.slabLoads ?? [],
    dimensions: pl.dimensions ?? [],
    dimStyle: DIM_STYLE_DEFAULT,
    showLoads: true,
    showSlabs: true,
    k,
  }
}
/** cota simples entre os dois primeiros pilares da fila de baixo, 1,5 m abaixo */
const addSimple = (): Dimension => {
  const [a, b] = cols()
  const d = dimFromPicks(
    picks([a.pos, b.pos], { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y - 1.5 }, { placing: true }),
    st().project,
    st().project.plans[0],
  )!
  st().addDimension(d)
  return dims()[dims().length - 1]
}

describe('gesto da ferramenta Cota', () => {
  it('linear: horizontal se a linha é puxada para cima/baixo, vertical se para o lado', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 3 },
    ]
    expect(linearDirFor(pts, { x: 2, y: -1 })).toBe('h')
    expect(linearDirFor(pts, { x: 2, y: 5 })).toBe('h')
    expect(linearDirFor(pts, { x: -1, y: 1.5 })).toBe('v')
    expect(linearDirFor(pts, { x: 6, y: 1.5 })).toBe('v')
    // sem cursor (ou cursor entre os pontos): pela maior extensão
    expect(linearDirFor(pts, null)).toBe('h')
    expect(linearDirFor(pts, { x: 2, y: 1.5 })).toBe('h')
    expect(linearDirFor([pts[0], { x: 1, y: 5 }], null)).toBe('v')
  })

  it('afastamento pelo cursor: h mede em Y, v mede em −X, alinhada na normal', () => {
    const p = [{ p: { x: 1, y: 2 } }, { p: { x: 5, y: 2 } }]
    expect(dimOffsetAt({ dir: 'h', points: p }, { x: 3, y: 0.5 })).toBeCloseTo(-1.5, 9)
    expect(dimOffsetAt({ dir: 'v', points: p }, { x: -0.2, y: 9 })).toBeCloseTo(1.2, 9)
    const diag = [{ p: { x: 0, y: 0 } }, { p: { x: 3, y: 4 } }]
    expect(dimOffsetAt({ dir: 'aligned', points: diag }, { x: -0.8, y: 0.6 })).toBeCloseTo(1, 9)
  })

  it('antes de posicionar, o cursor é o próximo ponto; depois, define a linha', () => {
    const { project } = st()
    const plan = project.plans[0]
    const [a, b] = cols()
    expect(dimFromPicks(picks([a.pos], null), project, plan)).toBeNull()
    const prev = dimFromPicks(picks([a.pos], b.pos), project, plan)!
    expect(prev.points).toHaveLength(2)
    expect(prev.offset).toBe(-0.8)
    const placed = dimFromPicks(picks([a.pos, b.pos], { x: 2, y: a.pos.y + 2 }, { placing: true }), project, plan)!
    expect(placed.points).toHaveLength(2)
    expect(placed.dir).toBe('h')
    expect(placed.offset).toBeCloseTo(2, 9)
    expect(placed.total).toBeUndefined()
  })

  it('pontos do snap ficam presos; com a opção desligada, livres', () => {
    const { project } = st()
    const plan = project.plans[0]
    const [a, b] = cols()
    const d = dimFromPicks(picks([a.pos, b.pos, { x: 1.111, y: 2.222 }], null, { form: 'chain' }), project, plan)!
    expect(d.points[0].ref).toEqual({ kind: 'column', id: a.id, at: 'c' })
    expect(d.points[1].ref).toEqual({ kind: 'column', id: b.id, at: 'c' })
    expect(d.points[2].ref).toBeUndefined()
    expect(d.total).toBe(true)
    const free = dimFromPicks(picks([a.pos, b.pos], null, { assoc: false }), project, plan)!
    expect(free.points.every((pt) => !pt.ref)).toBe(true)
    const aligned = dimFromPicks(picks([a.pos, b.pos], null, { mode: 'aligned', form: 'baseline' }), project, plan)!
    expect(aligned.dir).toBe('aligned')
    expect(aligned.form).toBe('baseline')
  })

  it('texto do editor: nunca menor que 9,5 px nem maior que 14 px', () => {
    expect(dimTextHeight(DIM_STYLE_DEFAULT, 10) * 10).toBeCloseTo(9.5, 9)
    expect(dimTextHeight(DIM_STYLE_DEFAULT, 60) * 60).toBeCloseTo(12, 9)
    expect(dimTextHeight(DIM_STYLE_DEFAULT, 400) * 400).toBeCloseTo(14, 9)
  })
})

describe('cotas no store', () => {
  it('criar numera, seleciona e NÃO invalida a análise', () => {
    useStore.setState({ results: analyze(st().project), analysisStatus: 'done' })
    const d1 = addSimple()
    expect(d1.name).toBe('Cota 1')
    expect(st().selection).toEqual({ kind: 'dimension', id: d1.id })
    expect(st().results).not.toBeNull()
    expect(st().dirty).toBe(true)
    expect(addSimple().name).toBe('Cota 2')
    st().updateDimension(d1.id, { offset: -3, form: 'baseline' })
    expect(dims()[0]).toMatchObject({ offset: -3, form: 'baseline' })
    expect(st().results).not.toBeNull()
    st().deleteElement({ kind: 'dimension', id: d1.id })
    expect(dims().map((d) => d.name)).toEqual(['Cota 2'])
    expect(st().results).not.toBeNull()
    // a seleção estava na Cota 2 (a última criada) e continua nela
    expect(st().selection?.id).not.toBe(d1.id)
    // o nome liberado é reaproveitado
    expect(addSimple().name).toBe('Cota 1')
  })

  it('mover o pilar leva a cota no mesmo passo de desfazer', () => {
    const d = addSimple()
    const [, b] = cols()
    const v0 = dimensionValues(d)[0]
    st().moveColumn(b.id, { x: b.pos.x + 0.25, y: b.pos.y })
    expect(dimensionValues(dims()[0])[0]).toBeCloseTo(v0 + 0.25, 9)
    useStore.temporal.getState().undo()
    expect(dimensionValues(dims()[0])[0]).toBeCloseTo(v0, 9)
    expect(st().project.columns.find((c) => c.id === b.id)!.pos.x).toBeCloseTo(b.pos.x, 9)
    useStore.temporal.getState().redo()
    expect(dimensionValues(dims()[0])[0]).toBeCloseTo(v0 + 0.25, 9)
  })

  it('mudar a seção pelo painel (com ponto de referência) move a cota de face', () => {
    const [a, b] = cols()
    st().autoDimension({ dir: 'h', mode: 'faces', side: 'min', total: false }, [
      { kind: 'column', id: a.id },
      { kind: 'column', id: b.id },
    ])
    const before = dimensionValues(dims()[0])
    const sec = a.section as { bw: number; h: number }
    const alongX = a.rotationDeg === 0 || a.rotationDeg === 180
    st().updateColumn(a.id, { section: alongX ? { ...sec, h: sec.h + 0.2 } : { ...sec, bw: sec.bw + 0.2 } })
    const after = dimensionValues(dims()[0])
    expect(after[0]).toBeCloseTo(before[0] + 0.2, 9) // largura do pilar
    expect(after[1]).toBeCloseTo(before[1] - 0.1, 9) // vão livre
  })

  it('eixo da grelha deslocado leva o ponto preso a ele', () => {
    const ax = st().project.grid.xAxes[1]
    st().addDimension({
      dir: 'h',
      form: 'chain',
      offset: -1,
      points: [{ p: { x: 0, y: 2.3 } }, { p: { x: ax.pos, y: 2.3 }, ref: { kind: 'grid', x: ax.id } }],
    })
    st().updateGridAxis('x', ax.id, ax.pos + 0.4)
    expect(dims()[0].points[1].p).toEqual({ x: ax.pos + 0.4, y: 2.3 })
  })

  it('excluir o pilar deixa a cota parada com a referência perdida; desfazer recupera', () => {
    const d = addSimple()
    const [, b] = cols()
    st().deleteElement({ kind: 'column', id: b.id })
    const plan = st().project.plans[0]
    expect(dims()).toHaveLength(1)
    expect(dims()[0].points[1].p).toEqual(b.pos)
    expect(lostDimRefs(st().project, plan, dims()[0])).toEqual([1])
    useStore.temporal.getState().undo()
    expect(lostDimRefs(st().project, st().project.plans[0], dims()[0])).toEqual([])
    expect(d.points[1].ref).toMatchObject({ kind: 'column', id: b.id })
  })

  it('cotagem automática da seleção e de todos os pilares', () => {
    const all = st().project.columns.map((c) => ({ kind: 'column' as const, id: c.id }))
    st().selectMany(all)
    expect(st().autoDimension({ dir: 'h', mode: 'axes', side: 'min', total: true })).toBe('ok')
    const d = dims()[0]
    const xs = [...new Set(st().project.columns.map((c) => c.pos.x))].sort((p, q) => p - q)
    expect(d.points.map((pt) => pt.p.x)).toEqual(xs)
    expect(d.total).toBe(true)
    expect(st().selection).toEqual({ kind: 'dimension', id: d.id })
    // mesmo alinhamento ⇒ nada a cotar nessa direção
    const col = st().project.columns.filter((c) => c.pos.x === xs[0]).map((c) => ({ kind: 'column' as const, id: c.id }))
    expect(st().autoDimension({ dir: 'h', mode: 'axes', side: 'min', total: true }, col)).toBe('none')
    expect(dims()).toHaveLength(1)
  })

  it('mover em grupo: pontos livres seguem o deslocamento, presos seguem o elemento', () => {
    const [a] = cols()
    st().addDimension({
      dir: 'h',
      form: 'chain',
      offset: -1,
      points: [{ p: { ...a.pos }, ref: { kind: 'column', id: a.id, at: 'c' } }, { p: { x: 2.2, y: 1.1 } }],
    })
    const d = dims()[0]
    useStore.setState({ results: analyze(st().project), analysisStatus: 'done' })
    // só a cota: o ponto livre anda, o preso fica com o pilar; análise preservada
    st().moveElements([{ kind: 'dimension', id: d.id }], { x: 0.5, y: 0 })
    expect(dims()[0].points[0].p).toEqual(a.pos)
    expect(dims()[0].points[1].p).toEqual({ x: 2.7, y: 1.1 })
    expect(st().results).not.toBeNull()
    // cota + pilar: os dois pontos andam e a análise cai
    st().moveElements(
      [
        { kind: 'dimension', id: d.id },
        { kind: 'column', id: a.id },
      ],
      { x: 0, y: -0.3 },
    )
    expect(dims()[0].points[0].p.y).toBeCloseTo(a.pos.y - 0.3, 9)
    expect(dims()[0].points[1].p.y).toBeCloseTo(0.8, 9)
    expect(st().results).toBeNull()
  })

  it('selecionar tudo inclui as cotas; excluir várias de uma vez', () => {
    const d1 = addSimple()
    const d2 = addSimple()
    st().selectAll()
    expect(st().multi.filter((r) => r.kind === 'dimension').map((r) => r.id)).toEqual([d1.id, d2.id])
    useStore.setState({ results: analyze(st().project), analysisStatus: 'done' })
    st().deleteElements([
      { kind: 'dimension', id: d1.id },
      { kind: 'dimension', id: d2.id },
    ])
    expect(dims()).toHaveLength(0)
    expect(st().results).not.toBeNull()
  })

  it('estilo do projeto: parte do padrão e guarda só o que muda', () => {
    expect(st().project.dimStyle).toBeUndefined()
    st().setDimStyle({ unit: 'm', decimals: 2 })
    expect(st().project.dimStyle).toEqual({ ...DIM_STYLE_DEFAULT, unit: 'm', decimals: 2 })
    useStore.temporal.getState().undo()
    expect(st().project.dimStyle).toBeUndefined()
  })

  it('abrir projeto com cota desatualizada acerta a posição pela referência', () => {
    const p = createSampleProject()
    const c = p.columns[0]
    p.plans[0].dimensions = [
      {
        id: 'x',
        name: 'Cota 1',
        dir: 'h',
        form: 'chain',
        offset: -1,
        points: [{ p: { x: 99, y: 99 }, ref: { kind: 'column', id: c.id, at: 'c' } }, { p: { x: 5, y: 0 } }],
      },
    ]
    st().loadProject(p, null)
    expect(dims()[0].points[0].p).toEqual(c.pos)
  })
})

describe('seleção na planta', () => {
  it('clique na linha de cota ou no texto seleciona a cota', () => {
    const d = addSimple()
    const [a, b] = cols()
    const y = a.pos.y - 1.5
    const mid = { x: (a.pos.x + b.pos.x) / 2, y }
    expect(hitTest(mid, ctx())).toEqual({ kind: 'dimension', id: d.id })
    // texto: logo acima da linha
    expect(dimensionAt({ x: mid.x, y: y + 0.15 }, dims(), DIM_STYLE_DEFAULT, 40)?.id).toBe(d.id)
    // longe da linha: nada
    expect(dimensionAt({ x: mid.x, y: y - 0.6 }, dims(), DIM_STYLE_DEFAULT, 40)).toBeNull()
    expect(hitTest({ x: mid.x, y: y - 0.6 }, ctx())).toBeNull()
  })

  it('pilar tem prioridade; cota passa na frente da laje', () => {
    const [a, b] = cols()
    // cota com a linha passando por dentro das lajes e por cima do 2º pilar da fila
    st().addDimension({
      dir: 'h',
      form: 'chain',
      offset: 0,
      points: [{ p: { x: a.pos.x + 1, y: a.pos.y } }, { p: { x: b.pos.x + 2, y: a.pos.y } }],
    })
    const d = dims()[0]
    st().updateDimension(d.id, { offset: 2 })
    expect(hitTest({ x: a.pos.x + 1.5, y: a.pos.y + 2 }, ctx())).toEqual({ kind: 'dimension', id: d.id })
    st().updateDimension(d.id, { offset: 0 })
    expect(hitTest({ x: b.pos.x, y: b.pos.y }, ctx())?.kind).toBe('column')
  })

  it('sem as cotas visíveis, o clique atravessa', () => {
    const d = addSimple()
    const [a, b] = cols()
    const mid = { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y - 1.5 }
    expect(hitTest(mid, { ...ctx(), dimensions: [] })).toBeNull()
    expect(d.id).toBeTruthy()
  })

  it('janela: inteira dentro pega; cruzando só da direita para a esquerda', () => {
    const d = addSimple()
    const [a, b] = cols()
    const y = a.pos.y - 1.5
    const around = { x0: a.pos.x - 0.5, y0: y - 0.5, x1: b.pos.x + 0.5, y1: y + 0.2 }
    expect(marqueeHits(around, false, ctx())).toContainEqual({ kind: 'dimension', id: d.id })
    const part = { x0: a.pos.x + 1, y0: y - 0.5, x1: a.pos.x + 2, y1: y + 0.2 }
    expect(marqueeHits(part, false, ctx())).not.toContainEqual({ kind: 'dimension', id: d.id })
    expect(marqueeHits(part, true, ctx())).toContainEqual({ kind: 'dimension', id: d.id })
  })
})
