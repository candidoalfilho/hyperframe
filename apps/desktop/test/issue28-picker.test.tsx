import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  analyze,
  createSampleProject,
  placeSheetItems,
  sheetIssues,
  sheetSourceKey,
  sheetSourceOptions,
  type AnalysisResults,
  type Project,
  type SheetLayout,
  type SheetSourceOption,
} from '@hyperframe/engine'
import { useStore } from '../src/store'
import SheetSourcePicker, {
  filterSheetOptions,
  groupSheetOptions,
  sheetUsage,
} from '../src/drawings/SheetSourcePicker'

/** issue #28 — escolher vários desenhos de uma vez para a prancha */

let project: Project
let results: AnalysisResults
let options: SheetSourceOption[]
beforeAll(() => {
  project = createSampleProject()
  results = analyze(project)
  options = sheetSourceOptions(project, results)
})
beforeEach(() => {
  useStore.setState({ project, results, analysisStatus: 'done', dirty: false })
  useStore.temporal.getState().clear()
})
const st = () => useStore.getState()
const sheets = () => st().project.sheets ?? []
const noFilter = { text: '', group: '', planId: '', hideUsed: false }
const issuesOf = (sh: SheetLayout) => sheetIssues(sh.format, placeSheetItems(st().project, st().results, sh))

describe('lista de desenhos', () => {
  it('filtra por categoria, pavimento e texto (sem diferenciar acento nem caixa)', () => {
    expect(filterSheetOptions(options, noFilter, new Map())).toEqual(options)
    const vigas = filterSheetOptions(options, { ...noFilter, group: 'Vigas' }, new Map())
    expect(vigas.length).toBeGreaterThan(0)
    expect(vigas.every((o) => o.source.kind === 'viga')).toBe(true)
    // pavimento: só o que pertence àquela planta (forma, lajes, vigas…)
    const plan = project.plans[1]
    const doPav = filterSheetOptions(options, { ...noFilter, planId: plan.id }, new Map())
    expect(doPav.length).toBeGreaterThan(0)
    expect(doPav.every((o) => o.planId === plan.id)).toBe(true)
    expect(doPav.some((o) => o.source.kind === 'forma')).toBe(true)
    expect(doPav.some((o) => o.source.kind === 'pilares' || o.source.kind === 'aco')).toBe(false)
    // os dois juntos
    const both = filterSheetOptions(options, { ...noFilter, group: 'Vigas', planId: plan.id }, new Map())
    expect(both).toEqual(vigas.filter((o) => o.planId === plan.id))
    // texto: todas as palavras, em qualquer ordem
    const fund = filterSheetOptions(options, { ...noFilter, text: 'FUNDACOES detalhamento' }, new Map())
    expect(fund.map((o) => o.source.kind)).toEqual(['fundacoes-det'])
    expect(filterSheetOptions(options, { ...noFilter, text: 'aco' }, new Map()).some((o) => o.source.kind === 'aco')).toBe(true)
    expect(filterSheetOptions(options, { ...noFilter, text: 'não existe isso' }, new Map())).toEqual([])
  })

  it('agrupa por categoria na ordem da lista, sem categorias vazias', () => {
    const groups = groupSheetOptions(options)
    expect(groups.map((g) => g.group)).toEqual(['Plantas de forma', 'Lajes', 'Vigas', 'Pilares', 'Fundações', 'Cortes', 'Tabelas'])
    expect(groups.flatMap((g) => g.options)).toHaveLength(options.length)
    expect(groupSheetOptions(options.filter((o) => o.group === 'Cortes')).map((g) => g.group)).toEqual(['Cortes'])
    expect(groupSheetOptions([])).toEqual([])
  })

  it('marca o que já está nesta prancha e em outras; "só os que faltam" esconde os dois', () => {
    const a = st().addSheet()
    const b = st().addSheet()
    const [forma, viga, pilares] = [options[0], options.find((o) => o.source.kind === 'viga')!, options.find((o) => o.source.kind === 'pilares')!]
    st().addSheetItems(a, [forma.source, viga.source])
    st().addSheetItems(a, [viga.source])
    st().addSheetItems(b, [viga.source, pilares.source])
    const usage = sheetUsage(sheets(), a)
    expect(usage.get(forma.key)).toEqual({ here: 1, others: [] })
    expect(usage.get(viga.key)).toEqual({ here: 2, others: ['02'] })
    expect(usage.get(pilares.key)).toEqual({ here: 0, others: ['02'] })
    expect(usage.size).toBe(3)
    // vista da outra prancha: os papéis se invertem
    expect(sheetUsage(sheets(), b).get(forma.key)).toEqual({ here: 0, others: ['01'] })
    const left = filterSheetOptions(options, { ...noFilter, hideUsed: true }, usage)
    expect(left).toHaveLength(options.length - 3)
    expect(left.some((o) => [forma.key, viga.key, pilares.key].includes(o.key))).toBe(false)
  })

  it('a janela lista tudo com caixa de seleção, categorias e as marcas de uso', () => {
    const viga = options.find((o) => o.source.kind === 'viga')!
    const usage = new Map([
      [options[0].key, { here: 1, others: [] }],
      [viga.key, { here: 0, others: ['02', '03'] }],
    ])
    const html = renderToStaticMarkup(
      <SheetSourcePicker
        options={options}
        plans={project.plans.map((p) => ({ id: p.id, name: p.name }))}
        usage={usage}
        sheetName="01/03 — Formas"
        hasResults
        onAdd={() => {}}
        onClose={() => {}}
      />,
    )
    // uma caixa por desenho, uma por categoria, mais "só os que faltam" e "pranchas novas"
    expect(html.match(/type="checkbox"/g)).toHaveLength(options.length + groupSheetOptions(options).length + 2)
    expect(html.match(/data-testid="sheet-picker-row"/g)).toHaveLength(options.length)
    for (const o of [options[0], viga, options[options.length - 1]]) expect(html).toContain(o.label)
    for (const p of project.plans) expect(html).toContain(`>${p.name}</option>`)
    expect(html).toContain('Selecionar todos')
    expect(html).toContain('Desmarcar todos')
    expect(html).toContain('Todas as categorias')
    expect(html).toContain('Todos os pavimentos')
    expect(html).toContain('nesta prancha')
    expect(html).toContain('prancha 02, 03')
    expect(html).toContain(`0 de ${options.length} marcados`)
    expect(html).toContain('Adicionar desenhos — 01/03 — Formas')
    // nada marcado: o botão de adicionar fica desligado
    expect(html).toMatch(/<button class="btn btn-primary" disabled="">Adicionar<\/button>/)
    expect(html).not.toContain('Rode a análise')
  })

  it('sem análise, a janela avisa que faltam as armações', () => {
    const html = renderToStaticMarkup(
      <SheetSourcePicker
        options={sheetSourceOptions(project, null)}
        plans={[]}
        usage={new Map()}
        sheetName="01/01 — Prancha 01"
        hasResults={false}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Rode a análise')
    expect(html).not.toContain('Vigas')
  })
})

describe('inserir vários desenhos', () => {
  it('entram todos de uma vez, num único passo de desfazer, sem invalidar a análise', () => {
    const id = st().addSheet()
    const sources = options.slice(0, 5).map((o) => o.source)
    const r = st().addSheetItems(id, sources)
    expect(r.ids).toHaveLength(5)
    expect(r.newSheets).toEqual([])
    expect(r.unplaced).toBe(0)
    expect(sheets()[0].items.map((it) => sheetSourceKey(it.source))).toEqual(options.slice(0, 5).map((o) => o.key))
    expect(sheets()[0].items.map((it) => it.id)).toEqual(r.ids)
    expect(issuesOf(sheets()[0])).toEqual([])
    expect(st().results).not.toBeNull()
    expect(st().dirty).toBe(true)
    useStore.temporal.getState().undo()
    expect(sheets()[0].items).toEqual([])
    useStore.temporal.getState().redo()
    expect(sheets()[0].items).toHaveLength(5)
  })

  it('com transbordo, o que não cabe vai para pranchas novas, numeradas e no mesmo formato', () => {
    const id = st().addSheet()
    st().updateSheet(id, { format: 'A3', name: 'Tudo' })
    const all = options.map((o) => o.source)
    const r = st().addSheetItems(id, all, true)
    expect(r.ids).toHaveLength(all.length)
    expect(r.newSheets.length).toBeGreaterThan(0)
    expect(r.unplaced).toBe(0)
    expect(sheets()).toHaveLength(1 + r.newSheets.length)
    expect(sheets().slice(1).map((s) => s.id)).toEqual(r.newSheets)
    expect(sheets().map((s) => s.name)).toEqual(['Tudo', ...r.newSheets.map((_, i) => `Prancha ${String(i + 2).padStart(2, '0')}`)])
    expect(sheets().every((s) => s.format === 'A3')).toBe(true)
    expect(sheets().flatMap((s) => s.items)).toHaveLength(all.length)
    for (const sh of sheets()) expect(issuesOf(sh), sh.name).toEqual([])
    // um passo de desfazer leva as pranchas novas junto
    useStore.temporal.getState().undo()
    expect(sheets()).toHaveLength(1)
    expect(sheets()[0].items).toEqual([])
  })

  it('sem transbordo, tudo fica na folha e o que sobrepôs é contado', () => {
    const id = st().addSheet()
    st().updateSheet(id, { format: 'A4' })
    const r = st().addSheetItems(id, options.map((o) => o.source))
    expect(r.newSheets).toEqual([])
    expect(sheets()).toHaveLength(1)
    expect(sheets()[0].items).toHaveLength(options.length)
    expect(r.unplaced).toBeGreaterThan(0)
    expect(issuesOf(sheets()[0]).some((i) => i.kind === 'sobreposto')).toBe(true)
  })

  it('prancha inexistente ou lista vazia não mexe no projeto', () => {
    const id = st().addSheet()
    const before = st().project
    expect(st().addSheetItems('nao-existe', [options[0].source])).toEqual({ ids: [], newSheets: [], unplaced: 0 })
    expect(st().addSheetItems(id, [])).toEqual({ ids: [], newSheets: [], unplaced: 0 })
    expect(st().project).toBe(before)
  })
})
