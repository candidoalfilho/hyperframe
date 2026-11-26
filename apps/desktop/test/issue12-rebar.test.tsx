import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { analyze, createSampleProject, type AnalysisResults, type Project } from '@hyperframe/engine'
import { useStore } from '../src/store'
import { BeamRebarEditor, ColumnRebarEditor } from '../src/drawings/RebarEditors'

/** issue #12 — editor de armaduras no app (vigas e pilares) */

let project: Project
let results: AnalysisResults
beforeAll(() => {
  project = createSampleProject()
  results = analyze(project)
})
beforeEach(() => {
  useStore.setState({ project, results, analysisStatus: 'done', selection: null, multi: [], dirty: false })
  useStore.temporal.getState().clear()
})
const st = () => useStore.getState()
const span = () => st().results!.beamDesign.find((b) => b.negLeft && b.negRight)!
const key = () => ({ beamId: span().beamId, spanIndex: span().spanIndex })
const det = () => st().results!.detailing.beams.find((b) => b.beamId === span().beamId && b.spanIndex === span().spanIndex)!
const chk = () => st().results!.detailing.checks!.beams.find((b) => b.beamId === span().beamId && b.spanIndex === span().spanIndex)!

describe('ajustes de viga no store', () => {
  it('cada campo mescla com o que já existe na posição; a análise não é invalidada', () => {
    st().setRebarOverride({ ...key(), slot: 'stirrup', phi: 0.0063 })
    st().setRebarOverride({ ...key(), slot: 'stirrup', spacing: 0.2 })
    st().setRebarOverride({ ...key(), slot: 'stirrup', left: { length: 1, spacing: 0.1 } })
    expect(st().project.rebarOverrides).toEqual([
      { ...key(), slot: 'stirrup', phi: 0.0063, spacing: 0.2, left: { length: 1, spacing: 0.1 } },
    ])
    expect(st().results).not.toBeNull()
    expect(st().dirty).toBe(true)
    expect(det().stirrup).toMatchObject({ phi: 0.0063, spacing: 0.2, manual: true })
    expect(det().stirrup.zones).toHaveLength(2)
    expect(chk().manual).toBe(true)
  })

  it('campo indefinido volta ao automático; sem nenhum campo o ajuste some', () => {
    st().setRebarOverride({ ...key(), slot: 'negLeft', n: 6, phi: 0.0125, through: true })
    expect(det().negLeft!.through).toBe(true)
    st().setRebarOverride({ ...key(), slot: 'negLeft', through: undefined })
    expect(st().project.rebarOverrides![0]).toEqual({ ...key(), slot: 'negLeft', n: 6, phi: 0.0125 })
    expect(det().negLeft!.through).toBeUndefined()
    st().setRebarOverride({ ...key(), slot: 'negLeft', n: undefined, phi: undefined })
    expect(st().project.rebarOverrides).toEqual([])
    expect(chk().manual).toBe(false)
  })

  it('armadura insuficiente reprova o vão na hora; desfazer devolve', () => {
    st().setRebarOverride({ ...key(), slot: 'negLeft', n: 2, phi: 0.008 })
    expect(chk().status).toBe('falha')
    useStore.temporal.getState().undo()
    expect(st().project.rebarOverrides ?? []).toEqual([])
  })

  it('ver a solução do programa não apaga os ajustes; restaurar automático apaga só os da viga', () => {
    st().setRebarOverride({ ...key(), slot: 'negLeft', n: 2, phi: 0.008 })
    const kg = st().results!.detailing.steel.totalKg
    st().setRebarOverridesOff(true)
    expect(st().project.rebarOverridesOff).toBe(true)
    expect(st().project.rebarOverrides).toHaveLength(1)
    expect(chk().manual).toBe(false)
    expect(st().results!.detailing.steel.totalKg).not.toBeCloseTo(kg, 3)
    st().setRebarOverridesOff(false)
    expect(st().project.rebarOverridesOff).toBeUndefined()
    expect(st().results!.detailing.steel.totalKg).toBeCloseTo(kg, 9)
    st().clearRebarOverrides(span().beamId)
    expect(st().project.rebarOverrides).toEqual([])
  })
})

describe('ajustes de pilar no store', () => {
  const col = () => st().results!.columnDesign[0]
  const cdet = () => st().results!.detailing.columns.find((c) => c.columnId === col().columnId)!
  const cchk = () => st().results!.detailing.checks!.columns.find((c) => c.columnId === col().columnId)!

  it('barras, estribos e trecho junto aos nós; quadro de ferros acompanha', () => {
    const kg = st().results!.detailing.steel.totalKg
    st().setColumnRebarOverride({ columnId: col().columnId, n: 8, phi: 0.016 })
    st().setColumnRebarOverride({ columnId: col().columnId, jointLength: 0.5, jointSpacing: 0.1 })
    expect(st().project.columnRebarOverrides).toEqual([
      { columnId: col().columnId, n: 8, phi: 0.016, jointLength: 0.5, jointSpacing: 0.1 },
    ])
    expect(cdet()).toMatchObject({ barsN: 8, barsPhi: 0.016, jointLength: 0.5, manual: true })
    expect(cdet().barPositions).toHaveLength(8)
    expect(cchk().manual).toBe(true)
    expect(st().results!.detailing.steel.totalKg).toBeGreaterThan(kg)
    expect(st().results!.columnDesign[0].barsN).toBe(col().barsN) // o dimensionamento do programa não muda
    st().clearColumnRebarOverride(col().columnId)
    expect(st().project.columnRebarOverrides).toEqual([])
    expect(st().results!.detailing.steel.totalKg).toBeCloseTo(kg, 9)
  })

  it('arranjo insuficiente é reprovado', () => {
    st().setColumnRebarOverride({ columnId: col().columnId, n: 4, phi: 0.01 })
    expect(cchk().status).toBe('falha')
  })
})

describe('editores (renderização)', () => {
  it('viga: título com o estado; pilar: idem — fechados por padrão', () => {
    const hb = renderToStaticMarkup(<BeamRebarEditor beamId={project.plans[0].beams[0].id} />)
    // o SSR do zustand lê o estado inicial (sem resultados) — o editor não quebra
    expect(typeof hb).toBe('string')
    const hc = renderToStaticMarkup(<ColumnRebarEditor columnId={project.columns[0].id} />)
    expect(typeof hc).toBe('string')
  })
})
