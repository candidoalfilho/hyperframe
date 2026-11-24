import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleProject, type ElementRef } from '@hyperframe/engine'
import { selectedRefs, useStore } from '../src/store'
import { hitTest, marqueeHits, wallLoadOnBeamAt, type HitContext } from '../src/editor2d/hittest'
import { buildSnapData, computeSnap } from '../src/editor2d/snap'

/** issue #6 — seleção de viga com carga de parede, seleção múltipla e movimento em grupo */

beforeEach(() => {
  useStore.setState({
    project: createSampleProject(),
    results: null,
    analysisStatus: 'idle',
    selection: null,
    multi: [],
  })
})
const st = () => useStore.getState()
const ctx = (): HitContext => {
  const p = st().project
  const plan = p.plans[0]
  return {
    columns: p.columns,
    beams: plan.beams,
    slabs: plan.slabs,
    wallLoads: plan.wallLoads,
    loadRegions: plan.loadRegions,
    showLoads: true,
    showSlabs: true,
    k: 40,
  }
}

describe('hit-test: viga com carga de parede continua selecionável', () => {
  it('clique sobre a viga seleciona a VIGA (antes selecionava a carga)', () => {
    const plan = st().project.plans[0]
    const wl = plan.wallLoads[0]
    const beam = plan.beams.find((b) => b.id === wl.beamId)!
    const [a, b] = beam.path
    // meio do 1º trecho, longe dos pilares das pontas
    const mid = { x: a.x + (b.x - a.x) * 0.37, y: a.y + (b.y - a.y) * 0.37 }
    expect(hitTest(mid, ctx())).toEqual({ kind: 'beam', id: beam.id })
    // a carga é alcançada pelo segundo clique na viga já selecionada…
    expect(wallLoadOnBeamAt(mid, ctx(), beam.id)?.id).toBe(wl.id)
    // …ou clicando ao lado da viga, na faixa do rótulo
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    // desloca p/ dentro do pavimento (fora de laje não há nada embaixo)
    const side = { x: mid.x - (dy / len) * 0.3, y: mid.y + (dx / len) * 0.3 }
    const other = { x: mid.x + (dy / len) * 0.3, y: mid.y - (dx / len) * 0.3 }
    const hits = [hitTest(side, ctx()), hitTest(other, ctx())]
    expect(hits.some((h) => h?.kind === 'wallLoad' && h.id === wl.id)).toBe(true)
  })

  it('várias cargas na mesma viga: a do trecho clicado', () => {
    const plan = st().project.plans[0]
    const beam = plan.beams[0]
    const first = plan.wallLoads.find((w) => w.beamId === beam.id)
    if (!first) st().addWallLoad(beam.id)
    const w1 = st().project.plans[0].wallLoads.find((w) => w.beamId === beam.id)!
    st().updateWallLoad(w1.id, { x0: 0, x1: 3 })
    st().addWallLoad(beam.id, true)
    const mine = st().project.plans[0].wallLoads.filter((w) => w.beamId === beam.id)
    expect(mine.length).toBe(2)
    const w2 = mine.find((w) => w.id !== w1.id)!
    st().updateWallLoad(w2.id, { x0: 5, x1: 9 })
    const [a, b] = beam.path
    const at = (s: number) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      return { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len }
    }
    expect(wallLoadOnBeamAt(at(1.5), ctx(), beam.id)?.id).toBe(w1.id)
    expect(wallLoadOnBeamAt(at(7), ctx(), beam.id)?.id).toBe(w2.id)
  })
})

describe('seleção múltipla', () => {
  it('Shift+clique soma e retira; select() volta à seleção simples', () => {
    const [c1, c2, c3] = st().project.columns
    const r = (id: string): ElementRef => ({ kind: 'column', id })
    st().select(r(c1.id))
    st().toggleSelect(r(c2.id))
    st().toggleSelect(r(c3.id))
    expect(selectedRefs(st()).map((x) => x.id)).toEqual([c1.id, c2.id, c3.id])
    st().toggleSelect(r(c2.id))
    expect(selectedRefs(st()).map((x) => x.id)).toEqual([c1.id, c3.id])
    st().select(r(c2.id))
    expect(selectedRefs(st())).toEqual([r(c2.id)])
  })

  it('janela: esquerda→direita só o que está inteiro dentro; crossing pega o que toca', () => {
    // janela em torno do pilar P1 (0,0) cortando as vigas que saem dele
    const rect = { x0: -0.6, y0: -0.6, x1: 1.5, y1: 1.5 }
    const win = marqueeHits(rect, false, ctx())
    expect(win.filter((h) => h.kind === 'column').length).toBe(1)
    expect(win.some((h) => h.kind === 'beam')).toBe(false)
    const cross = marqueeHits(rect, true, ctx())
    expect(cross.filter((h) => h.kind === 'beam').length).toBe(2) // V1 e V4 passam pela janela
    expect(cross.some((h) => h.kind === 'slab')).toBe(false) // laje só entra inteira
  })

  it('selectAll pega pilares, vigas, lajes e regiões da planta ativa', () => {
    const p = st().project
    useStore.setState({ activeLevelId: p.levels.find((l) => l.planId === p.plans[0].id)!.id })
    st().selectAll()
    const refs = selectedRefs(st())
    const plan = p.plans[0]
    expect(refs.length).toBe(
      p.columns.length + plan.beams.length + plan.slabs.length + plan.loadRegions.length,
    )
  })

  it('moveElements desloca o conjunto em um passo e mantém o modelo conectado', () => {
    const p0 = st().project
    const plan0 = p0.plans[0]
    // pilares do eixo x = 0 (P1, P5, P9) + a viga V4 que os liga
    const cols = p0.columns.filter((c) => Math.abs(c.pos.x) < 1e-9)
    const v4 = plan0.beams.find((b) => b.path.every((q) => Math.abs(q.x) < 1e-9))!
    const refs: ElementRef[] = [
      ...cols.map((c) => ({ kind: 'column' as const, id: c.id })),
      { kind: 'beam', id: v4.id },
    ]
    expect(st().moveElements(refs, { x: -0.5, y: 0 })).toBe('ok')
    const p = st().project
    const plan = p.plans[0]
    for (const c of cols) expect(p.columns.find((x) => x.id === c.id)!.pos.x).toBeCloseTo(-0.5, 9)
    expect(plan.beams.find((b) => b.id === v4.id)!.path.every((q) => Math.abs(q.x + 0.5) < 1e-9)).toBe(true)
    // vigas horizontais que chegavam em x = 0 esticam junto (não selecionadas)
    const v1 = plan.beams.find((b) => b.name === 'V1')!
    expect(Math.min(...v1.path.map((q) => q.x))).toBeCloseTo(-0.5, 9)
    // e as lajes coladas no eixo acompanham
    const l1 = plan.slabs.find((x) => x.name === 'L1')!
    expect(Math.min(...l1.polygon.map((q) => q.x))).toBeCloseTo(-0.5, 9)
    // pilares de outros eixos não saem do lugar
    expect(p.columns.filter((c) => Math.abs(c.pos.x - 4) < 1e-9).length).toBe(3)
    expect(st().results).toBeNull()
  })

  it('moveElements recusa pilar caindo sobre outro que fica parado', () => {
    const [a, b] = st().project.columns
    const r = st().moveElements([{ kind: 'column', id: a.id }], {
      x: b.pos.x - a.pos.x,
      y: b.pos.y - a.pos.y,
    })
    expect(r).toBe('duplicate')
  })

  it('deleteSelected remove o conjunto de uma vez (cargas de parede somem com a viga)', () => {
    const plan = st().project.plans[0]
    const wl = plan.wallLoads[0]
    const nBeams = plan.beams.length
    const nCols = st().project.columns.length
    st().selectMany([
      { kind: 'beam', id: wl.beamId },
      { kind: 'column', id: st().project.columns[0].id },
    ])
    st().deleteSelected()
    const after = st().project
    expect(after.plans[0].beams.length).toBe(nBeams - 1)
    expect(after.columns.length).toBe(nCols - 1)
    expect(after.plans[0].wallLoads.some((w) => w.id === wl.id)).toBe(false)
    expect(selectedRefs(st())).toEqual([])
  })

  it('rotateColumns gira 90° e volta a 0 em quatro toques', () => {
    const c = st().project.columns[1]
    const r0 = c.rotationDeg
    st().rotateColumns([c.id])
    expect(st().project.columns[1].rotationDeg).toBe((r0 + 90) % 360)
    st().rotateColumns([c.id])
    st().rotateColumns([c.id])
    st().rotateColumns([c.id])
    expect(st().project.columns[1].rotationDeg).toBe(r0)
  })
})

describe('snap nas faces do pilar', () => {
  it('oferece o meio da face e o canto além do centro', () => {
    const p = st().project
    const c = p.columns[5] // P6 25×60 com h ao longo de X: meia-largura 0,30 em x
    const data = buildSnapData({ xAxes: [], yAxes: [] }, [c], [])
    const face = computeSnap({ x: c.pos.x + 0.31, y: c.pos.y + 0.01 }, data, 0.05)
    expect(face?.point.x).toBeCloseTo(c.pos.x + 0.3, 9)
    expect(face?.point.y).toBeCloseTo(c.pos.y, 9)
    const corner = computeSnap({ x: c.pos.x + 0.29, y: c.pos.y + 0.13 }, data, 0.05)
    expect(corner?.point).toEqual({ x: c.pos.x + 0.3, y: c.pos.y + 0.125 })
    expect(computeSnap({ x: c.pos.x + 0.01, y: c.pos.y }, data, 0.05)?.kind).toBe('column')
  })
})
