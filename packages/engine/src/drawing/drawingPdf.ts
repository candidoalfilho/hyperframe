import { PdfDoc, transliterate } from '../report/pdf'
import { dimParts } from './dim'
import type { Drawing, DrawingLayer } from './types'

/**
 * Prancha em PDF VETORIAL 1:1 com a folha: cada metro de papel do desenho
 * (saída do composeSheet, bounds = formato A0–A4) vira o tamanho exato em
 * pontos (1 pt = 1/72"), então o PDF imprime NA ESCALA do carimbo. Linhas,
 * polilinhas, círculos (béziers), tracejados, textos rotacionados e cotas
 * (geometria compartilhada com o DXF em drawing/dim.ts). Zero dependências.
 */

const PT_PER_M = 72_000 / 25.4 // 2834,65 pt/m

/** espessura (pt) e cinza por camada — convenção de impressão técnica */
const LAYER_STYLE: Record<DrawingLayer, { w: number; gray: number }> = {
  MARGEM: { w: 0.9, gray: 0 },
  CONTORNO: { w: 0.5, gray: 0 },
  PILARES: { w: 0.85, gray: 0 },
  VIGAS: { w: 0.6, gray: 0 },
  LAJES: { w: 0.35, gray: 0.35 },
  EIXOS: { w: 0.3, gray: 0.45 },
  COTAS: { w: 0.3, gray: 0.15 },
  TEXTOS: { w: 0.3, gray: 0 },
  ARMADURA: { w: 0.7, gray: 0 },
  ESTRIBOS: { w: 0.35, gray: 0.3 },
}

export function buildDrawingPdf(drawing: Drawing): Uint8Array {
  const b = drawing.bounds
  const W = (b.maxX - b.minX) * PT_PER_M
  const H = (b.maxY - b.minY) * PT_PER_M
  const doc = new PdfDoc({ width: W, height: H })
  const X = (x: number): number => (x - b.minX) * PT_PER_M
  const Y = (y: number): number => (y - b.minY) * PT_PER_M
  const style = (layer: DrawingLayer): { w: number; gray: number } =>
    LAYER_STYLE[layer] ?? { w: 0.5, gray: 0 }

  const stroke = (
    pts: { x: number; y: number }[],
    layer: DrawingLayer,
    closed: boolean,
    dashed: boolean,
    filled = false,
  ): void => {
    if (pts.length < 2) return
    const s = style(layer)
    const g = s.gray.toFixed(3)
    let path = `${X(pts[0].x).toFixed(2)} ${Y(pts[0].y).toFixed(2)} m `
    for (let i = 1; i < pts.length; i++) {
      path += `${X(pts[i].x).toFixed(2)} ${Y(pts[i].y).toFixed(2)} l `
    }
    if (closed) path += 'h '
    const dash = dashed ? '[3 2] 0 d ' : ''
    doc.op(`${g} ${g} ${g} RG ${g} ${g} ${g} rg ${s.w.toFixed(2)} w ${dash}${path}${filled ? 'b' : 'S'}${dashed ? ' [] 0 d' : ''}`)
  }

  const K = 0.5523 // fator de bézier p/ quarto de círculo
  const circle = (cx: number, cy: number, r: number, layer: DrawingLayer, filled: boolean): void => {
    const s = style(layer)
    const g = s.gray.toFixed(3)
    const x = X(cx)
    const y = Y(cy)
    const rp = r * PT_PER_M
    const k = K * rp
    const f = (n: number): string => n.toFixed(2)
    const path =
      `${f(x + rp)} ${f(y)} m ` +
      `${f(x + rp)} ${f(y + k)} ${f(x + k)} ${f(y + rp)} ${f(x)} ${f(y + rp)} c ` +
      `${f(x - k)} ${f(y + rp)} ${f(x - rp)} ${f(y + k)} ${f(x - rp)} ${f(y)} c ` +
      `${f(x - rp)} ${f(y - k)} ${f(x - k)} ${f(y - rp)} ${f(x)} ${f(y - rp)} c ` +
      `${f(x + k)} ${f(y - rp)} ${f(x + rp)} ${f(y - k)} ${f(x + rp)} ${f(y)} c h `
    doc.op(`${g} ${g} ${g} RG ${g} ${g} ${g} rg ${s.w.toFixed(2)} w ${path}${filled ? 'f' : 'S'}`)
  }

  const text = (
    x: number,
    y: number,
    t: string,
    height: number,
    layer: DrawingLayer,
    rotation: number,
    align: 'left' | 'center' | 'right',
  ): void => {
    const s = style(layer)
    const size = height * PT_PER_M
    const txt = transliterate(t)
    // 'right' aproximado como 'center' deslocado — casos raros nas pranchas
    doc.textRotated(X(x), Y(y), txt, size, rotation, 'R', s.gray, align === 'left' ? 'left' : 'center')
  }

  for (const p of drawing.primitives) {
    switch (p.kind) {
      case 'line':
        stroke([{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }], p.layer, false, p.dashed === true)
        break
      case 'polyline':
        stroke(p.points, p.layer, p.closed === true, p.dashed === true)
        break
      case 'circle':
        circle(p.cx, p.cy, p.r, p.layer, p.filled === true)
        break
      case 'text':
        text(p.x, p.y, p.text, p.height, p.layer, p.rotation ?? 0, p.align ?? 'left')
        break
      case 'dim': {
        const parts = dimParts(p)
        for (const [x1, y1, x2, y2] of parts.lines) {
          stroke([{ x: x1, y: y1 }, { x: x2, y: y2 }], p.layer, false, false)
        }
        const t = parts.text
        text(t.x, t.y, t.text, t.height, p.layer, t.angleDeg, 'center')
        break
      }
    }
  }

  return doc.build()
}
