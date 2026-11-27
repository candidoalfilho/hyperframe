import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  analyze,
  createSampleProject,
  placeSheetItems,
  sheetIssues,
  type AnalysisResults,
  type Project,
} from '@hyperframe/engine'
import { useStore } from '../src/store'

/** issue #23 — pranchas compostas no store */

let project: Project
let results: AnalysisResults
beforeAll(() => {
  project = createSampleProject()
  results = analyze(project)
})
beforeEach(() => {
  useStore.setState({ project, results, analysisStatus: 'done', dirty: false })
  useStore.temporal.getState().clear()
})
const st = () => useStore.getState()
const sheets = () => st().project.sheets ?? []
const issues = (i = 0) => sheetIssues(sheets()[i].format, placeSheetItems(st().project, st().results, sheets()[i]))

describe('pranchas', () => {
  it('criar numera, renomear e trocar o formato; a análise não é invalidada', () => {
    const a = st().addSheet()
    const b = st().addSheet()
    expect(sheets().map((s) => s.name)).toEqual(['Prancha 01', 'Prancha 02'])
    expect(sheets()[0]).toMatchObject({ id: a, format: 'A1', items: [] })
    st().updateSheet(b, { name: 'Fundações', format: 'A2', revision: 'R01' })
    expect(sheets()[1]).toMatchObject({ name: 'Fundações', format: 'A2', revision: 'R01' })
    expect(st().results).not.toBeNull()
    expect(st().dirty).toBe(true)
    st().deleteSheet(a)
    expect(sheets().map((s) => s.name)).toEqual(['Fundações'])
    // o nome que ficou livre não colide
    st().addSheet()
    expect(sheets().map((s) => s.name)).toEqual(['Fundações', 'Prancha 02'])
  })

  it('inserir desenhos: cada um entra num lugar livre', () => {
    const id = st().addSheet()
    const plan = st().project.plans[0]
    const a = st().addSheetItem(id, { kind: 'forma', planId: plan.id })
    const b = st().addSheetItem(id, { kind: 'viga', beamId: plan.beams[0].id })
    const c = st().addSheetItem(id, { kind: 'aco' })
    expect(sheets()[0].items.map((i) => i.id)).toEqual([a, b, c])
    expect(issues()).toEqual([])
    expect(st().addSheetItem('não existe', { kind: 'aco' })).toBeNull()
  })

  it('mover, mudar a escala, girar, duplicar e remover', () => {
    const id = st().addSheet()
    const a = st().addSheetItem(id, { kind: 'pilares' })!
    st().updateSheetItem(id, a, { x: 0.2, y: 0.3, scale: 100, rotation: 90 })
    expect(sheets()[0].items[0]).toMatchObject({ x: 0.2, y: 0.3, scale: 100, rotation: 90 })
    const copy = st().duplicateSheetItem(id, a)!
    expect(sheets()[0].items).toHaveLength(2)
    expect(sheets()[0].items[1]).toMatchObject({ id: copy, scale: 100, rotation: 90, source: { kind: 'pilares' } })
    // a cópia não cai em cima do original
    expect(issues().filter((i) => i.kind === 'sobreposto')).toEqual([])
    st().removeSheetItem(id, a)
    expect(sheets()[0].items.map((i) => i.id)).toEqual([copy])
  })

  it('organizar: avisa quando não cabe; reduzindo escalas, cabe', () => {
    const id = st().addSheet()
    st().updateSheet(id, { format: 'A3' })
    const plan = st().project.plans[0]
    const a = st().addSheetItem(id, { kind: 'forma', planId: plan.id })!
    const b = st().addSheetItem(id, { kind: 'pilares' })!
    st().updateSheetItem(id, a, { scale: 25 })
    st().updateSheetItem(id, b, { scale: 10 })
    expect(st().arrangeSheet(id)).toBe(false)
    expect(st().arrangeSheet(id, true)).toBe(true)
    expect(issues()).toEqual([])
    expect(sheets()[0].items[0].scale).toBeGreaterThan(25)
  })

  it('desfazer e refazer; as pranchas vão no projeto', () => {
    const id = st().addSheet()
    st().addSheetItem(id, { kind: 'quantitativos' })
    useStore.temporal.getState().undo()
    expect(sheets()[0].items).toHaveLength(0)
    useStore.temporal.getState().redo()
    expect(sheets()[0].items).toHaveLength(1)
    expect(st().project.sheets).toBe(sheets())
  })

  it('sem análise, armações e tabelas viram marcador indisponível (e voltam com a análise)', () => {
    const id = st().addSheet()
    st().addSheetItem(id, { kind: 'pilares' })
    useStore.setState({ results: null })
    expect(issues().map((i) => i.kind)).toContain('indisponivel')
    useStore.setState({ results })
    expect(issues().map((i) => i.kind)).not.toContain('indisponivel')
  })
})
