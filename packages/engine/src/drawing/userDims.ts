import type { DimStyle, Dimension } from '../model/types'
import { dimensionLayout } from '../model/dimensions'
import type { DrawingPrimitive } from './types'

/**
 * Cotas do usuário (issue #10) em primitivas de desenho — linhas, símbolos de
 * extremidade e textos na camada COTAS. Mesma geometria do editor
 * (`dimensionLayout`), então o que se vê na planta é o que sai no PDF e no DXF.
 */
export function dimensionPrimitives(dim: Dimension, style: DimStyle): DrawingPrimitive[] {
  if (dim.points.length < 2) return []
  const lay = dimensionLayout(dim, style)
  const h = lay.height
  const { u, n } = lay
  const out: DrawingPrimitive[] = []
  for (const l of lay.lines) {
    out.push({ kind: 'line', x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y, layer: 'COTAS' })
  }
  for (const m of lay.marks) {
    if (m.origin) {
      // origem da cota acumulada: círculo vazado
      out.push({ kind: 'circle', cx: m.at.x, cy: m.at.y, r: 0.3 * h, layer: 'COTAS' })
      continue
    }
    if (style.terminator === 'dot') {
      out.push({ kind: 'circle', cx: m.at.x, cy: m.at.y, r: 0.18 * h, layer: 'COTAS', filled: true })
    } else if (style.terminator === 'arrow') {
      // uma seta por trecho que chega à marca, com a ponta nela
      for (const d of m.dirs) {
        const bx = m.at.x + u.x * d * 0.9 * h
        const by = m.at.y + u.y * d * 0.9 * h
        out.push({
          kind: 'polyline',
          closed: true,
          layer: 'COTAS',
          points: [
            { x: m.at.x, y: m.at.y },
            { x: bx + n.x * 0.16 * h, y: by + n.y * 0.16 * h },
            { x: bx - n.x * 0.16 * h, y: by - n.y * 0.16 * h },
          ],
        })
      }
    } else {
      // traço a 45° (ABNT), comprimento ≈ altura do texto
      const tx = ((u.x + n.x) / Math.SQRT2) * 0.5 * h
      const ty = ((u.y + n.y) / Math.SQRT2) * 0.5 * h
      out.push({
        kind: 'line',
        x1: m.at.x - tx,
        y1: m.at.y - ty,
        x2: m.at.x + tx,
        y2: m.at.y + ty,
        layer: 'COTAS',
      })
    }
  }
  for (const t of lay.labels) {
    out.push({
      kind: 'text',
      x: t.x,
      y: t.y,
      text: t.text,
      height: h,
      layer: 'COTAS',
      rotation: t.angleDeg,
      align: t.align,
    })
  }
  return out
}
