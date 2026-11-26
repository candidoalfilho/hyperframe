import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { analyze, createSampleProject, loadPathOptions, type AnalysisResults, type Project } from '@hyperframe/engine'
import { useStore } from '../src/store'
import { LoadPathView } from '../src/panels/LoadPathTab'

/** issue #9 — aba "Caminho das cargas" dos resultados */

let project: Project
let results: AnalysisResults
const levelId = (i: number) => [...project.levels].sort((a, b) => a.elevation - b.elevation)[i].id
const view = (p: Project, r: AnalysisResults, activeLevelId: string) =>
  renderToStaticMarkup(
    <LoadPathView
      results={r}
      project={p}
      activeLevelId={activeLevelId}
      setActiveLevel={() => {}}
      selection={null}
      select={() => {}}
    />,
  )
const render = (level = 2) => view(project, results, levelId(level))
/** número pt-BR ("10 494,2") → number */
const num = (s: string) => Number(s.replace(/[\s  ]/g, '').replace(',', '.'))

beforeAll(() => {
  project = createSampleProject()
  results = analyze(project)
})

describe('aba Caminho das cargas', () => {
  it('existe como aba dos resultados e abre no pavimento ativo', () => {
    useStore.getState().setResultsTab('cargas')
    expect(useStore.getState().resultsTab).toBe('cargas')
    const html = render()
    expect(html).toContain('data-testid="load-path-plan"')
    expect(html).toContain('Como ler — 2º Pavimento')
    // G + Q é o padrão e todas as opções estão no seletor
    for (const o of loadPathOptions(results)) expect(html).toContain(`value="${o.id}"`)
    expect(html).toMatch(/<option value="G\+Q" selected="">/)
  })

  it('conferência: aplicado = reações, sem chip de erro', () => {
    const html = render()
    const m = html.match(/aplicado ([\d\s ,]+) kN = reações ([\d\s ,]+) kN/)
    expect(m).not.toBeNull()
    expect(num(m![1])).toBeCloseTo(num(m![2]), 1)
    expect(num(m![1])).toBeGreaterThan(5000)
    expect(html).not.toContain('chip err')
    expect(html).not.toContain('de laje sem apoio')
  })

  it('descida de cargas: uma linha por pilar, soma das fundações = total', () => {
    const html = render()
    const table = html.slice(html.indexOf('data-testid="load-path-descent"'))
    const rows = table.match(/<tr>/g) ?? []
    expect(rows.length).toBe(1 + project.columns.length + 1) // cabeçalho + pilares + soma
    for (const c of project.columns) expect(table).toContain(`<b>${c.name}</b>`)
    const total = results.foundationLoads.reduce((s, f) => s + f.fzServ, 0)
    const last = [...table.matchAll(/<b>([\d\s ,]+)<\/b><\/td><\/tr>/g)].pop()!
    expect(num(last[1])).toBeCloseTo(total, 0)
    // um cabeçalho por pavimento que descarrega nos pilares + Fundação
    expect((table.match(/<th[ >]/g) ?? []).length).toBe(1 + (project.levels.length - 1) + 1)
  })

  it('nível da fundação: só os apoios, com a reação de cada pilar', () => {
    const html = render(0)
    expect(html).toContain('Sem lajes nem vigas neste nível')
    expect((html.match(/>R [\d\s ]+</g) ?? []).length).toBe(project.columns.length)
  })

  it('sem viga nem laje selecionável, a aba não quebra (projeto só com pilares)', () => {
    const p = createSampleProject()
    for (const pl of p.plans) pl.slabs = []
    const r = analyze(p)
    const html = view(p, r, [...p.levels].sort((a, b) => a.elevation - b.elevation)[1].id)
    expect(html).toContain('data-testid="load-path-plan"')
    expect(html).not.toContain('chip err')
  })
})
