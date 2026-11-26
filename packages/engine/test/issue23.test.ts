import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import {
  SHEET_GAP,
  SHEET_TITLE_STRIP,
  arrangeSheet,
  buildSourceDrawing,
  composeSheetLayout,
  fitItemScale,
  itemPaperSize,
  newSheetItem,
  packSheet,
  placeSheetItems,
  sheetAreas,
  sheetIssues,
  sheetSourceLabel,
  sheetSourceOptions,
} from '../src/drawing/sheetLayout'
import { SHEET_FORMATS, STANDARD_SCALES, composeSheet, mapPrimitive } from '../src/drawing/sheet'
import { buildFormworkDrawing } from '../src/drawing/formwork'
import { buildDrawingPdf, buildDrawingsPdf } from '../src/drawing/drawingPdf'
import { buildQuantitiesTableDrawing, buildSteelTableDrawing } from '../src/drawing/tables'
import { writeDxf } from '../src/dxf/write'
import { parseProject, serializeProject } from '../src/io/serialize'
import type { SheetItem, SheetLayout, SheetSource } from '../src/model/types'
import type { Drawing } from '../src/drawing/types'

/** issue #23 — composição de pranchas: vários desenhos por folha */

const project = createSampleProject()
const results = analyze(project)
const plan = project.plans[0]
const info = { projectName: project.name, date: '26/11/2026' }
const item = (id: string, source: SheetSource, x: number, y: number, scale: number, rotation?: 0 | 90): SheetItem => ({
  id,
  source,
  x,
  y,
  scale,
  ...(rotation ? { rotation } : {}),
})
const layoutOf = (format: SheetLayout['format'], items: SheetItem[]): SheetLayout => ({
  id: 's1',
  name: 'Prancha 01',
  format,
  items,
})
const forma: SheetSource = { kind: 'forma', planId: plan.id }
const texts = (d: Drawing) => d.primitives.flatMap((p) => (p.kind === 'text' ? [p.text] : []))

describe('folha', () => {
  it('área útil dentro da moldura e carimbo no canto inferior direito', () => {
    // A1: 841 × 594 mm; margens 25 mm (esq.) e 10 mm; 5 mm de folga
    const { usable, stamp } = sheetAreas('A1')
    expect(usable.x0).toBeCloseTo(0.03, 12)
    expect(usable.y0).toBeCloseTo(0.015, 12)
    expect(usable.x1).toBeCloseTo(0.841 - 0.015, 12)
    expect(usable.y1).toBeCloseTo(0.594 - 0.015, 12)
    expect(stamp.x1).toBeCloseTo(0.831, 12)
    expect(stamp.x0).toBeCloseTo(0.831 - 0.175 - 0.005, 12)
    expect(stamp.y1).toBeCloseTo(0.01 + 0.056 + 0.005, 12)
    // A4: margens de 7 mm
    expect(sheetAreas('A4').usable.y0).toBeCloseTo(0.012, 12)
  })

  it('tamanho no papel = tamanho do desenho ÷ escala; girado troca largura e altura', () => {
    const d = buildFormworkDrawing(project, plan.id)
    const w = d.bounds.maxX - d.bounds.minX
    const h = d.bounds.maxY - d.bounds.minY
    expect(itemPaperSize(d, 50)).toEqual({ w: w / 50, h: h / 50 })
    expect(itemPaperSize(d, 100, 90)).toEqual({ w: h / 100, h: w / 100 })
  })

  it('escala que cabe: a menor escala-padrão (maior desenho) dentro do espaço', () => {
    const d = buildFormworkDrawing(project, plan.id)
    const s = fitItemScale(d, 0.4, 0.3)
    expect(STANDARD_SCALES).toContain(s)
    const size = itemPaperSize(d, s)
    expect(size.w).toBeLessThanOrEqual(0.4)
    expect(size.h).toBeLessThanOrEqual(0.3)
    // a escala-padrão anterior já não caberia
    const prev = STANDARD_SCALES[STANDARD_SCALES.indexOf(s) - 1]
    if (prev) {
      const big = itemPaperSize(d, prev)
      expect(big.w > 0.4 || big.h > 0.3).toBe(true)
    }
    // espaço minúsculo: fica na maior redução disponível
    expect(fitItemScale(d, 0.001, 0.001)).toBe(500)
  })
})

describe('origens dos desenhos', () => {
  it('todas as opções montam um desenho; sem análise só as que não dependem dela', () => {
    const opts = sheetSourceOptions(project, results)
    const kinds = new Set(opts.map((o) => o.source.kind))
    for (const k of ['forma', 'lajes', 'corte', 'cargas', 'fundacoes', 'fundacoes-det', 'viga', 'pilares', 'pilar-elev', 'aco', 'quantitativos'])
      expect(kinds.has(k as SheetSource['kind'])).toBe(true)
    for (const o of opts) {
      const d = buildSourceDrawing(project, results, o.source)
      expect(d, o.label).not.toBeNull()
      expect(d!.primitives.length).toBeGreaterThan(0)
      expect(o.label).toBe(sheetSourceLabel(project, o.source))
    }
    const noRes = sheetSourceOptions(project, null)
    expect(new Set(noRes.map((o) => o.source.kind))).toEqual(new Set(['forma', 'corte']))
    expect(buildSourceDrawing(project, null, { kind: 'pilares' })).toBeNull()
    expect(buildSourceDrawing(project, null, forma)).not.toBeNull()
  })

  it('nomes legíveis e origem inexistente', () => {
    expect(sheetSourceLabel(project, forma)).toBe(`Planta de forma — ${plan.name}`)
    expect(sheetSourceLabel(project, { kind: 'viga', beamId: plan.beams[0].id })).toBe(`Viga ${plan.beams[0].name} — ${plan.name}`)
    expect(buildSourceDrawing(project, results, { kind: 'viga', beamId: 'não existe' })).toBeNull()
    expect(buildSourceDrawing(project, results, { kind: 'forma', planId: 'x' })).toBeNull()
  })

  it('tabelas: resumo de aço fecha com o detalhamento; quantitativos com o total de concreto', () => {
    const aco = texts(buildSteelTableDrawing(results.detailing.steel))
    expect(aco).toContain('TOTAL')
    expect(aco).toContain(results.detailing.steel.totalKg.toFixed(1).replace('.', ','))
    expect(aco.filter((t) => /^\d+(,\d)?$/.test(t)).length).toBeGreaterThanOrEqual(results.detailing.steel.byPhi.length)
    const q = texts(buildQuantitiesTableDrawing(results.quantities))
    expect(q).toContain(results.quantities.concrete.total.toFixed(2).replace('.', ','))
    expect(q).toContain('kg/m³')
  })
})

describe('posicionar e conferir', () => {
  const d = buildFormworkDrawing(project, plan.id)
  const size = itemPaperSize(d, 100)

  it('a caixa do item começa na posição dada e inclui a faixa do título', () => {
    const [p] = placeSheetItems(project, results, layoutOf('A1', [item('a', forma, 0.1, 0.2, 100)]))
    expect(p.box.x0).toBe(0.1)
    expect(p.box.y0).toBeCloseTo(0.2 - SHEET_TITLE_STRIP, 12)
    expect(p.box.x1).toBeCloseTo(0.1 + size.w, 12)
    expect(p.box.y1).toBeCloseTo(0.2 + size.h, 12)
    expect(p.label).toBe(`Planta de forma — ${plan.name}`)
  })

  it('aponta sobreposição, fora da área útil, sobre o carimbo e indisponível', () => {
    const lay = layoutOf('A1', [
      item('a', forma, 0.1, 0.3, 100),
      item('b', forma, 0.1 + size.w / 2, 0.3, 100), // sobre o primeiro
      item('c', forma, 0.83, 0.3, 100), // sai pela direita
      item('d', forma, 0.7, 0.02, 100), // em cima do carimbo
      item('e', { kind: 'viga', beamId: 'sumiu' }, 0.4, 0.5, 50),
    ])
    const issues = sheetIssues('A1', placeSheetItems(project, results, lay))
    const of = (id: string) => issues.filter((i) => i.itemId === id).map((i) => i.kind)
    expect(of('a')).toContain('sobreposto')
    expect(issues.find((i) => i.itemId === 'a' && i.kind === 'sobreposto')!.otherId).toBe('b')
    expect(of('c')).toContain('fora')
    expect(of('d')).toContain('carimbo')
    expect(of('e')).toContain('indisponivel')
    // um desenho sozinho no meio da folha não tem problema
    expect(sheetIssues('A1', placeSheetItems(project, results, layoutOf('A1', [item('a', forma, 0.1, 0.3, 100)])))).toEqual([])
  })
})

describe('organizar automaticamente', () => {
  it('fileiras de cima para baixo, sem sobreposição e sem tocar o carimbo', () => {
    const sizes = [
      { id: 'a', w: 0.3, h: 0.2 },
      { id: 'b', w: 0.25, h: 0.25 },
      { id: 'c', w: 0.2, h: 0.1 },
      { id: 'd', w: 0.3, h: 0.15 },
    ]
    const { pos, fits } = packSheet('A1', sizes)
    expect(fits).toBe(true)
    const { usable, stamp } = sheetAreas('A1')
    // o mais alto começa no canto superior esquerdo
    expect(pos.get('b')).toEqual({ x: usable.x0, y: usable.y1 - 0.25 })
    expect(pos.get('a')!.x).toBeCloseTo(usable.x0 + 0.25 + SHEET_GAP, 12)
    const boxes = sizes.map((s) => {
      const p = pos.get(s.id)!
      return { id: s.id, x0: p.x, y0: p.y - SHEET_TITLE_STRIP, x1: p.x + s.w, y1: p.y + s.h }
    })
    for (const b of boxes) {
      expect(b.x1).toBeLessThanOrEqual(usable.x1 + 1e-9)
      expect(b.y0).toBeGreaterThanOrEqual(usable.y0 - 1e-9)
      const hitsStamp = b.x0 < stamp.x1 && b.x1 > stamp.x0 && b.y0 < stamp.y1 && b.y1 > stamp.y0
      expect(hitsStamp).toBe(false)
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        expect(a.x0 < b.x1 - 1e-9 && a.x1 > b.x0 + 1e-9 && a.y0 < b.y1 - 1e-9 && a.y1 > b.y0 + 1e-9).toBe(false)
      }
  })

  it('o que não cabe é avisado', () => {
    expect(packSheet('A4', [{ id: 'a', w: 0.5, h: 0.1 }]).fits).toBe(false)
    expect(packSheet('A4', Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, w: 0.1, h: 0.1 }))).fits).toBe(false)
  })

  it('prancha real: forma + viga + pilares + tabelas organizadas numa A1, sem problemas', () => {
    const sources: SheetSource[] = [
      forma,
      { kind: 'viga', beamId: plan.beams[0].id },
      { kind: 'pilares' },
      { kind: 'aco' },
      { kind: 'quantitativos' },
    ]
    const lay = layoutOf('A1', sources.map((s, i) => newSheetItem(project, results, 'A1', s, `i${i}`)))
    const { layout, fits } = arrangeSheet(project, results, lay, { shrink: true })
    expect(fits).toBe(true)
    const composed = composeSheetLayout(project, results, layout, info)
    expect(composed.issues).toEqual([])
    expect(composed.placed).toHaveLength(5)
    // escalas diferentes ⇒ carimbo "INDICADA"; cada desenho leva o seu título com a escala
    const t = texts(composed.drawing)
    expect(new Set(layout.items.map((i) => i.scale)).size).toBeGreaterThan(1)
    expect(t).toContain('INDICADA')
    for (const it of layout.items) {
      expect(t).toContain(`${sheetSourceLabel(project, it.source).toUpperCase()} — ESC. 1:${it.scale}`)
    }
    expect(composed.drawing.bounds).toEqual({ minX: 0, minY: 0, maxX: SHEET_FORMATS.A1.w, maxY: SHEET_FORMATS.A1.h })
  })

  it('folha pequena: reduzir escalas faz caber; sem reduzir, avisa que não coube', () => {
    const lay = layoutOf('A3', [item('a', forma, 0, 0, 25), item('b', { kind: 'pilares' }, 0, 0, 10)])
    const plain = arrangeSheet(project, results, lay)
    expect(plain.fits).toBe(false)
    expect(plain.layout.items.map((i) => i.scale)).toEqual([25, 10])
    const shrunk = arrangeSheet(project, results, lay, { shrink: true })
    expect(shrunk.fits).toBe(true)
    expect(shrunk.layout.items[0].scale).toBeGreaterThan(25)
    expect(sheetIssues('A3', placeSheetItems(project, results, shrunk.layout))).toEqual([])
    // a prancha original não é alterada
    expect(lay.items[0]).toMatchObject({ x: 0, y: 0, scale: 25 })
  })
})

describe('desenho final', () => {
  it('cada item cai dentro da própria caixa, na escala dele', () => {
    const lay = layoutOf('A1', [item('a', forma, 0.05, 0.3, 100), item('b', { kind: 'pilares' }, 0.45, 0.3, 25)])
    const { drawing, placed } = composeSheetLayout(project, results, lay, info)
    // um eixo da forma: tracejado de comprimento conhecido no modelo ⇒ ÷ 100 no papel
    const src = buildFormworkDrawing(project, plan.id)
    const srcLine = src.primitives.find((p) => p.kind === 'line' && p.layer === 'EIXOS')!
    const mapped = mapPrimitive(srcLine, 100, 0.05 - src.bounds.minX / 100, 0.3 - src.bounds.minY / 100)
    expect(drawing.primitives).toContainEqual(mapped)
    if (srcLine.kind === 'line' && mapped.kind === 'line') {
      const l0 = Math.hypot(srcLine.x2 - srcLine.x1, srcLine.y2 - srcLine.y1)
      const l1 = Math.hypot(mapped.x2 - mapped.x1, mapped.y2 - mapped.y1)
      expect(l1).toBeCloseTo(l0 / 100, 12)
      for (const [x, y] of [[mapped.x1, mapped.y1], [mapped.x2, mapped.y2]]) {
        expect(x).toBeGreaterThanOrEqual(placed[0].box.x0 - 1e-9)
        expect(x).toBeLessThanOrEqual(placed[0].box.x1 + 1e-9)
        expect(y).toBeGreaterThanOrEqual(placed[0].item.y - 1e-9)
        expect(y).toBeLessThanOrEqual(placed[0].box.y1 + 1e-9)
      }
    }
  })

  it('girar 90°: o desenho continua dentro da caixa (largura e altura trocadas) e os textos giram', () => {
    const lay = layoutOf('A1', [item('a', forma, 0.1, 0.1, 100, 90)])
    const { drawing, placed } = composeSheetLayout(project, results, lay, info)
    const src = buildFormworkDrawing(project, plan.id)
    const box = placed[0].box
    expect(box.x1 - box.x0).toBeCloseTo((src.bounds.maxY - src.bounds.minY) / 100, 12)
    // todas as linhas do item ficam dentro da caixa girada
    const n = src.primitives.length
    for (const p of drawing.primitives.slice(0, n)) {
      if (p.kind !== 'line') continue
      for (const [x, y] of [[p.x1, p.y1], [p.x2, p.y2]]) {
        expect(x).toBeGreaterThanOrEqual(box.x0 - 1e-9)
        expect(x).toBeLessThanOrEqual(box.x1 + 1e-9)
        expect(y).toBeGreaterThanOrEqual(0.1 - 1e-9)
        expect(y).toBeLessThanOrEqual(box.y1 + 1e-9)
      }
    }
    const srcText = src.primitives.find((p) => p.kind === 'text')!
    const outText = drawing.primitives[src.primitives.indexOf(srcText)]
    if (srcText.kind === 'text' && outText.kind === 'text') {
      expect(outText.rotation).toBe((srcText.rotation ?? 0) + 90)
      expect(outText.height).toBeCloseTo(srcText.height / 100, 12)
    }
  })

  it('uma escala só vai para o carimbo; item indisponível vira marcador', () => {
    const one = composeSheetLayout(project, results, layoutOf('A2', [item('a', forma, 0.05, 0.1, 75)]), info)
    expect(texts(one.drawing)).toContain('1:75')
    expect(texts(one.drawing)).not.toContain('INDICADA')
    const gone = composeSheetLayout(project, results, layoutOf('A2', [item('x', { kind: 'viga', beamId: 'sumiu' }, 0.05, 0.1, 50)]), info)
    expect(texts(gone.drawing).some((t) => t.endsWith('— INDISPONÍVEL'))).toBe(true)
    expect(gone.issues.map((i) => i.kind)).toEqual(['indisponivel'])
  })

  it('a prancha simples (um desenho centrado) continua igual', () => {
    const single = composeSheet(buildFormworkDrawing(project, plan.id), {
      format: 'A1',
      info: { ...info, title1: 'Planta de forma' },
    })
    expect(single.scale).toBeGreaterThan(0)
    expect(texts(single.drawing)).toContain(`1:${single.scale}`)
    expect(single.drawing.bounds.maxX).toBe(SHEET_FORMATS.A1.w)
  })
})

describe('exportar e salvar', () => {
  const lay = layoutOf('A1', [item('a', forma, 0.05, 0.3, 100), item('b', { kind: 'aco' }, 0.5, 0.4, 50)])
  const composed = composeSheetLayout(project, results, lay, info)

  it('DXF e PDF da prancha composta', () => {
    const dxf = writeDxf(composed.drawing)
    expect(dxf).toContain('RESUMO DE A')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    const pdf = new TextDecoder('latin1').decode(buildDrawingPdf(composed.drawing))
    // página no tamanho exato da A1 (841 × 594 mm em pontos)
    expect(pdf).toMatch(/MediaBox \[0 0 2383\.9\d 1683\.7\d\]/)
  })

  it('várias pranchas num PDF: uma página por folha, cada uma no seu formato', () => {
    const a3 = composeSheetLayout(project, results, layoutOf('A3', [item('a', { kind: 'quantitativos' }, 0.05, 0.1, 50)]), info)
    const pdf = new TextDecoder('latin1').decode(buildDrawingsPdf([composed.drawing, a3.drawing]))
    expect((pdf.match(/\/Type \/Page /g) ?? []).length).toBe(2)
    expect(pdf).toMatch(/MediaBox \[0 0 2383\.9\d 1683\.7\d\]/)
    expect(pdf).toMatch(/MediaBox \[0 0 1190\.5\d 841\.8\d\]/)
  })

  it('as pranchas vão e voltam no arquivo do projeto', () => {
    const p = { ...project, sheets: [{ ...lay, revision: 'R02' }] }
    expect(parseProject(serializeProject(p)).sheets).toEqual(p.sheets)
    expect(parseProject(serializeProject(project)).sheets).toBeUndefined()
  })
})
