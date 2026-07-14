import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { buildFormworkDrawing } from '../src/drawing/formwork'
import { buildSectionCutDrawing } from '../src/drawing/sectionCut'
import { buildLoadPlanDrawing } from '../src/drawing/loadPlan'
import { composeSheet } from '../src/drawing/sheet'
import type { Drawing } from '../src/drawing/types'

function checkDrawing(d: Drawing): void {
  expect(d.primitives.length).toBeGreaterThan(0)
  expect(Number.isFinite(d.bounds.minX)).toBe(true)
  expect(Number.isFinite(d.bounds.maxY)).toBe(true)
  for (const p of d.primitives) {
    const nums: number[] = []
    switch (p.kind) {
      case 'line':
        nums.push(p.x1, p.y1, p.x2, p.y2)
        break
      case 'polyline':
        for (const pt of p.points) nums.push(pt.x, pt.y)
        break
      case 'circle':
        nums.push(p.cx, p.cy, p.r)
        break
      case 'text':
        nums.push(p.x, p.y, p.height)
        break
      case 'dim':
        nums.push(p.x1, p.y1, p.x2, p.y2, p.offset)
        break
    }
    for (const n of nums) expect(Number.isFinite(n)).toBe(true)
  }
}

const texts = (d: Drawing): string[] =>
  d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)

describe('corte esquemático', () => {
  const project = createSampleProject()

  it('corta em x com níveis, pilares e vigas seccionadas', () => {
    const d = buildSectionCutDrawing(project, { dir: 'x', pos: 4.0, label: 'A' })
    checkDrawing(d)
    expect(d.title).toContain('CORTE A-A')
    // linhas de nível p/ todos os pavimentos
    const ts = texts(d)
    expect(ts.some((t) => t.includes('Cobertura'))).toBe(true)
    // pilares do eixo x=4 aparecem (4 pilares no eixo B)
    expect(ts.filter((t) => /^P\d+$/.test(t)).length).toBeGreaterThanOrEqual(3)
    // vigas perpendiculares seccionadas com seção
    expect(ts.some((t) => /V\d+ 20x50/.test(t))).toBe(true)
  })

  it('corta em y e inclui cotas de pé-direito', () => {
    const d = buildSectionCutDrawing(project, { dir: 'y', pos: 4.5, label: 'B' })
    checkDrawing(d)
    const dims = d.primitives.filter((p) => p.kind === 'dim')
    // 8 pavimentos → 8 cotas de pé-direito
    expect(dims.length).toBeGreaterThanOrEqual(8)
  })
})

describe('planta de cargas', () => {
  it('rotula reações por pilar e monta tabela', () => {
    const project = createSampleProject()
    const r = analyze(project)
    const d = buildLoadPlanDrawing(project, r.foundationLoads)
    checkDrawing(d)
    const ts = texts(d)
    expect(ts.some((t) => t.startsWith('G: '))).toBe(true)
    expect(ts.some((t) => t.startsWith('ELU: '))).toBe(true)
    expect(ts.some((t) => t.includes('PLANTA DE CARGAS'))).toBe(true)
    // uma linha de tabela por pilar
    expect(r.foundationLoads).toHaveLength(project.columns.length)
  })
})

describe('prancha com moldura e carimbo', () => {
  it('envolve a forma em A1 com escala automática e campos do carimbo', () => {
    const project = createSampleProject()
    const content = buildFormworkDrawing(project, project.plans[0].id)
    const sheet = composeSheet(content, {
      format: 'A1',
      info: {
        projectName: project.name,
        client: 'Cliente Teste',
        city: project.city,
        author: 'Eng. Teste',
        title1: 'Planta de forma',
        title2: 'Pavimento tipo',
        sheetLabel: '01/03',
        revision: 'R00',
        date: '01/07/2026',
      },
    })
    checkDrawing(sheet.drawing)
    // papel A1 paisagem
    expect(sheet.drawing.bounds.maxX).toBeCloseTo(0.841, 6)
    expect(sheet.drawing.bounds.maxY).toBeCloseTo(0.594, 6)
    // escala padrão razoável p/ um edifício de ~13 m em A1
    expect([20, 25, 50, 75, 100]).toContain(sheet.scale)
    const ts = texts(sheet.drawing)
    expect(ts).toContain('OBRA:')
    expect(ts).toContain('HyperFrame')
    expect(ts.some((t) => t === `1:${sheet.scale}`)).toBe(true)
    // conteúdo ficou DENTRO da moldura
    for (const p of sheet.drawing.primitives) {
      if (p.kind === 'circle') {
        expect(p.cx).toBeGreaterThanOrEqual(0)
        expect(p.cx).toBeLessThanOrEqual(0.841)
      }
    }
  })

  it('escala forçada é respeitada', () => {
    const project = createSampleProject()
    const content = buildFormworkDrawing(project, project.plans[0].id)
    const sheet = composeSheet(content, {
      format: 'A0',
      scale: 50,
      info: { projectName: 'X', title1: 'Forma' },
    })
    expect(sheet.scale).toBe(50)
    expect(sheet.drawing.bounds.maxX).toBeCloseTo(1.189, 6)
  })

  it('cotas escalam com a prancha (altura explícita ÷ escala, sem saturar no piso)', () => {
    const project = createSampleProject()
    const content = buildFormworkDrawing(project, project.plans[0].id)
    const isDim = (p: { kind: string }): p is import('../src/drawing/types').DDim =>
      p.kind === 'dim'
    const rawDims = content.primitives.filter(isDim)
    expect(rawDims.length).toBeGreaterThan(0)
    for (const d of rawDims) expect(d.height).toBeCloseTo(0.3, 9)
    const sheet = composeSheet(content, {
      format: 'A1',
      info: { projectName: 'X', title1: 'Forma' },
    })
    const dims = sheet.drawing.primitives.filter(isDim)
    expect(dims.length).toBe(rawDims.length)
    for (const d of dims) {
      // em papel: 0,3 m de modelo ÷ k — antes o piso de 0,1 m (modelo) saturava
      // e o texto da cota travava em ~100 mm no papel, gigante vs conteúdo
      expect(d.height).toBeCloseTo(0.3 / sheet.scale, 9)
      expect(d.height!).toBeLessThan(0.02)
    }
  })
})
