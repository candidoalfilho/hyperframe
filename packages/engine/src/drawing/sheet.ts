/**
 * Prancha: moldura + carimbo (ABNT NBR 10068/10582) envolvendo um desenho.
 * O conteúdo é escalado (1:N) e centrado na área útil; o resultado fica em
 * METROS DE PAPEL (A0…A4 paisagem), pronto p/ SVG/DXF/impressão.
 */

import type { Drawing, DrawingPrimitive } from './types'

export type SheetFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4'

/** dimensões do papel paisagem, m */
const FORMATS: Record<SheetFormat, { w: number; h: number }> = {
  A0: { w: 1.189, h: 0.841 },
  A1: { w: 0.841, h: 0.594 },
  A2: { w: 0.594, h: 0.42 },
  A3: { w: 0.42, h: 0.297 },
  A4: { w: 0.297, h: 0.21 },
}

/** margens ABNT: esquerda 25 mm (encadernação), demais 10 mm (7 p/ A4/A3) */
function margins(format: SheetFormat): { left: number; other: number } {
  return format === 'A4' || format === 'A3'
    ? { left: 0.025, other: 0.007 }
    : { left: 0.025, other: 0.01 }
}

const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500]

/** carimbo: 175×56 mm no canto inferior direito */
const STAMP_W = 0.175
const STAMP_H = 0.056

export interface SheetInfo {
  /** obra (nome do projeto) */
  projectName: string
  client?: string
  address?: string
  city?: string
  /** engenheiro/autor */
  author?: string
  /** conteúdo, 2 linhas */
  title1: string
  title2?: string
  /** "01/05" */
  sheetLabel?: string
  revision?: string
  /** dd/mm/aaaa */
  date?: string
}

export interface SheetOptions {
  format: SheetFormat
  /** escala 1:N; ausente = automática (menor escala-padrão que couber) */
  scale?: number
  info: SheetInfo
}

export interface SheetResult {
  drawing: Drawing
  /** escala adotada (1:N) */
  scale: number
  format: SheetFormat
}

/** transforma primitiva do desenho (m de modelo) p/ papel: p' = o + p/k */
function mapPrimitive(p: DrawingPrimitive, k: number, ox: number, oy: number): DrawingPrimitive {
  const mx = (x: number) => ox + x / k
  const my = (y: number) => oy + y / k
  switch (p.kind) {
    case 'line':
      return { ...p, x1: mx(p.x1), y1: my(p.y1), x2: mx(p.x2), y2: my(p.y2) }
    case 'polyline':
      return { ...p, points: p.points.map((pt) => ({ x: mx(pt.x), y: my(pt.y) })) }
    case 'circle':
      return { ...p, cx: mx(p.cx), cy: my(p.cy), r: p.r / k }
    case 'text':
      return { ...p, x: mx(p.x), y: my(p.y), height: p.height / k }
    case 'dim':
      return {
        ...p,
        x1: mx(p.x1),
        y1: my(p.y1),
        x2: mx(p.x2),
        y2: my(p.y2),
        offset: p.offset / k,
        // altura explícita escala como DText.height; sem ela o renderer
        // derivaria do offset JÁ dividido e o piso legível saturaria (texto gigante)
        height: p.height !== undefined ? p.height / k : undefined,
      }
  }
}

export function composeSheet(content: Drawing, opts: SheetOptions): SheetResult {
  const fmt = FORMATS[opts.format]
  const mg = margins(opts.format)
  const prims: DrawingPrimitive[] = []

  // área útil (dentro da moldura), reservando a faixa do carimbo
  const frameX0 = mg.left
  const frameY0 = mg.other
  const frameX1 = fmt.w - mg.other
  const frameY1 = fmt.h - mg.other
  const availW = frameX1 - frameX0 - 0.01
  const availH = frameY1 - frameY0 - STAMP_H - 0.015

  const cw = Math.max(content.bounds.maxX - content.bounds.minX, 0.1)
  const ch = Math.max(content.bounds.maxY - content.bounds.minY, 0.1)

  let scale = opts.scale ?? 0
  if (!scale || scale <= 0) {
    scale =
      STANDARD_SCALES.find((s) => cw / s <= availW && ch / s <= availH) ??
      STANDARD_SCALES[STANDARD_SCALES.length - 1]
  }

  // centraliza o conteúdo na área útil (acima do carimbo)
  const drawW = cw / scale
  const drawH = ch / scale
  const ox = frameX0 + (availW - drawW) / 2 + 0.005 - content.bounds.minX / scale
  const oy = frameY0 + STAMP_H + 0.01 + (availH - drawH) / 2 - content.bounds.minY / scale
  for (const p of content.primitives) prims.push(mapPrimitive(p, scale, ox, oy))

  // ---- moldura ----
  prims.push({
    kind: 'polyline',
    points: [
      { x: frameX0, y: frameY0 },
      { x: frameX1, y: frameY0 },
      { x: frameX1, y: frameY1 },
      { x: frameX0, y: frameY1 },
    ],
    closed: true,
    layer: 'MARGEM',
  })

  // ---- carimbo (canto inferior direito) ----
  const sx1 = frameX1
  const sx0 = sx1 - Math.min(STAMP_W, frameX1 - frameX0)
  const sy0 = frameY0
  const sy1 = sy0 + STAMP_H
  const box = (x0: number, y0: number, x1: number, y1: number): void => {
    prims.push({
      kind: 'polyline',
      points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      closed: true,
      layer: 'MARGEM',
    })
  }
  const text = (x: number, y: number, t: string, h = 0.0022, align: 'left' | 'center' = 'left'): void => {
    prims.push({ kind: 'text', x, y, text: t, height: h, layer: 'TEXTOS', align })
  }
  box(sx0, sy0, sx1, sy1)
  const info = opts.info
  const pad = 0.002
  const rowH = STAMP_H / 4
  // linhas horizontais do carimbo
  for (let i = 1; i < 4; i++) {
    prims.push({ kind: 'line', x1: sx0, y1: sy0 + rowH * i, x2: sx1, y2: sy0 + rowH * i, layer: 'MARGEM' })
  }
  // linha 4 (topo): logo + obra
  const logoW = 0.032
  prims.push({ kind: 'line', x1: sx0 + logoW, y1: sy0 + 3 * rowH, x2: sx0 + logoW, y2: sy1, layer: 'MARGEM' })
  text(sx0 + logoW / 2, sy0 + 3 * rowH + rowH / 2 - 0.0015, 'HyperFrame', 0.003, 'center')
  text(sx0 + logoW + pad, sy1 - 0.0042, 'OBRA:', 0.0018)
  text(sx0 + logoW + pad + 0.012, sy0 + 3 * rowH + 0.003, info.projectName, 0.0026)
  // linha 3: cliente + local
  text(sx0 + pad, sy0 + 3 * rowH - 0.0042, 'CLIENTE:', 0.0018)
  text(sx0 + pad + 0.016, sy0 + 2 * rowH + 0.0028, info.client ?? '—', 0.0024)
  const midX = sx0 + (sx1 - sx0) * 0.55
  prims.push({ kind: 'line', x1: midX, y1: sy0 + 2 * rowH, x2: midX, y2: sy0 + 3 * rowH, layer: 'MARGEM' })
  text(midX + pad, sy0 + 3 * rowH - 0.0042, 'LOCAL:', 0.0018)
  text(midX + pad + 0.012, sy0 + 2 * rowH + 0.0028, info.address ?? info.city ?? '—', 0.0024)
  // linha 2: conteúdo
  text(sx0 + pad, sy0 + 2 * rowH - 0.0042, 'CONTEÚDO:', 0.0018)
  text(sx0 + pad + 0.02, sy0 + rowH + 0.0058, info.title1, 0.0026)
  if (info.title2) text(sx0 + pad + 0.02, sy0 + rowH + 0.0022, info.title2, 0.0022)
  // linha 1 (base): eng / data / escala / folha / rev
  const cols = [0, 0.42, 0.62, 0.76, 0.89, 1]
  const labels = ['RESP. TÉCNICO', 'DATA', 'ESCALA', 'FOLHA', 'REV.']
  const values = [
    info.author ?? '—',
    info.date ?? '—',
    `1:${scale}`,
    info.sheetLabel ?? '01',
    info.revision ?? 'R00',
  ]
  for (let i = 1; i < cols.length - 1; i++) {
    const x = sx0 + (sx1 - sx0) * cols[i]
    prims.push({ kind: 'line', x1: x, y1: sy0, x2: x, y2: sy0 + rowH, layer: 'MARGEM' })
  }
  for (let i = 0; i < labels.length; i++) {
    const x = sx0 + (sx1 - sx0) * cols[i] + pad
    text(x, sy0 + rowH - 0.0038, labels[i], 0.0016)
    text(x, sy0 + 0.0022, values[i], 0.0024)
  }

  const title = `${info.title1}${info.title2 ? ' — ' + info.title2 : ''} (${opts.format} 1:${scale})`
  return {
    drawing: {
      title,
      primitives: prims,
      bounds: { minX: 0, minY: 0, maxX: fmt.w, maxY: fmt.h },
    },
    scale,
    format: opts.format,
  }
}
