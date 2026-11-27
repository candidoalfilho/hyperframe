/**
 * Tabelas como desenho (linhas + textos na camada CONTORNO/TEXTOS), para entrar
 * nas pranchas compostas ao lado dos desenhos: resumo de aço por bitola e
 * quantitativos. Coordenadas em metros "de modelo": na escala 1:50 o texto de
 * 0,12 m sai com 2,4 mm no papel.
 */

import type { Quantities, SteelSummary } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'

const f = (v: number, d = 1): string => v.toFixed(d).replace('.', ',')

/** grade com título, cabeçalho e linhas; `widths` em metros de modelo */
export function tableDrawing(
  title: string,
  header: string[],
  rows: string[][],
  widths: number[],
): Drawing {
  const prims: DrawingPrimitive[] = []
  const rowH = 0.3
  const totalW = widths.reduce((s, w) => s + w, 0)
  const nRows = rows.length + 1
  prims.push({ kind: 'text', x: 0, y: 0.1, text: title, height: 0.16, layer: 'TEXTOS' })
  for (let r = 0; r <= nRows; r++) {
    prims.push({ kind: 'line', x1: 0, y1: -r * rowH, x2: totalW, y2: -r * rowH, layer: 'CONTORNO' })
  }
  let x = 0
  for (let c = 0; c <= widths.length; c++) {
    prims.push({ kind: 'line', x1: x, y1: 0, x2: x, y2: -nRows * rowH, layer: 'CONTORNO' })
    x += widths[c] ?? 0
  }
  const put = (r: number, cells: string[]) => {
    let cx = 0
    cells.forEach((t, c) => {
      prims.push({
        kind: 'text',
        x: cx + widths[c] / 2,
        y: -(r + 1) * rowH + 0.09,
        text: t,
        height: 0.12,
        layer: 'TEXTOS',
        align: 'center',
      })
      cx += widths[c]
    })
  }
  put(0, header)
  rows.forEach((row, i) => put(i + 1, row))
  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 0.15) }
}

/** resumo de aço por bitola (kg), com o total e o total com 10% de perdas */
export function buildSteelTableDrawing(steel: SteelSummary): Drawing {
  return tableDrawing(
    'RESUMO DE AÇO — CA-50/CA-60',
    ['BITOLA (mm)', 'PESO (kg)'],
    [
      ...steel.byPhi.map((b) => [f(b.phi * 1000, Number.isInteger(b.phi * 1000) ? 0 : 1), f(b.kg, 1)]),
      ['TOTAL', f(steel.totalKg, 1)],
      ['TOTAL + 10%', f(steel.totalWithWaste, 1)],
    ],
    [1.6, 1.6],
  )
}

/** quantitativos: concreto por tipo de elemento, fôrma, aço e taxa */
export function buildQuantitiesTableDrawing(q: Quantities): Drawing {
  return tableDrawing(
    'QUANTITATIVOS',
    ['ITEM', 'QUANT.', 'UN.'],
    [
      ['Concreto — pilares', f(q.concrete.columns, 2), 'm³'],
      ['Concreto — vigas', f(q.concrete.beams, 2), 'm³'],
      ['Concreto — lajes', f(q.concrete.slabs, 2), 'm³'],
      ['Concreto — total', f(q.concrete.total, 2), 'm³'],
      ['Fôrma', f(q.formwork, 1), 'm²'],
      ['Aço — total', f(q.steel.total, 0), 'kg'],
      ['Taxa de aço', f(q.steel.ratePerM3, 1), 'kg/m³'],
    ],
    [2.6, 1.4, 0.9],
  )
}
