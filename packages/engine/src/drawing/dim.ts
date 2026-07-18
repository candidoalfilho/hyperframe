import type { DDim } from './types'

/**
 * Decomposição geométrica da cota (linha + chamadas + traços a 45° + texto)
 * compartilhada pelos writers DXF e PDF — mesma regra do renderer SVG.
 */
export interface DimParts {
  lines: [number, number, number, number][]
  text: { x: number; y: number; text: string; height: number; angleDeg: number }
}

export function dimParts(d: DDim): DimParts {
  const dx = d.x2 - d.x1
  const dy = d.y2 - d.y1
  const len = Math.hypot(dx, dy)
  // altura explícita (escala com a prancha) ou proporcional ao afastamento
  const height = d.height ?? Math.min(0.3, Math.max(0.1, Math.abs(d.offset) * 0.55))
  if (len < 1e-9) {
    return { lines: [], text: { x: d.x1, y: d.y1, text: d.text, height, angleDeg: 0 } }
  }
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const ox = nx * d.offset
  const oy = ny * d.offset
  const ax = d.x1 + ox
  const ay = d.y1 + oy
  const bx = d.x2 + ox
  const by = d.y2 + oy
  const lines: [number, number, number, number][] = [
    [ax, ay, bx, by], // linha de cota
    [d.x1, d.y1, d.x1 + ox * 1.1, d.y1 + oy * 1.1], // chamadas
    [d.x2, d.y2, d.x2 + ox * 1.1, d.y2 + oy * 1.1],
  ]
  // traços a 45° (bissetriz), comprimento total ≈ altura do texto
  const t = height / 2
  const tx = (ux + nx) / Math.SQRT2
  const ty = (uy + ny) / Math.SQRT2
  lines.push([ax - tx * t, ay - ty * t, ax + tx * t, ay + ty * t])
  lines.push([bx - tx * t, by - ty * t, bx + tx * t, by + ty * t])
  // texto no meio, afastado 0,4·|offset| além da linha, virado p/ leitura em pé
  const sgn = d.offset < 0 ? -1 : 1
  const k = d.offset + 0.4 * Math.abs(d.offset) * sgn
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI
  if (ang > 90 || ang <= -90) ang += 180
  if (ang > 180) ang -= 360
  return {
    lines,
    text: {
      x: (d.x1 + d.x2) / 2 + nx * k,
      y: (d.y1 + d.y2) / 2 + ny * k,
      text: d.text,
      height,
      angleDeg: ang,
    },
  }
}
