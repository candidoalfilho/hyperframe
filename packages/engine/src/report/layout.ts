/**
 * Layout de página do memorial (A4 retrato): títulos, parágrafos, pares
 * rótulo–valor, tabelas com quebra de página e gráficos de linha (diagramas
 * de esforços). Compartilhado pelo memorial resumido e pelo anexo detalhado.
 */

import { A4, PdfDoc, textWidth, wrapText, type PdfFont } from './pdf'

// ---------------------------------------------------------------------------
// formatação pt-BR
// ---------------------------------------------------------------------------

export const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—')
export const cmDim = (m: number): string => fmt(m * 100, 0)
export const cm2 = (a: number): string => fmt(a * 1e4, 2)
export const mm = (m: number, d = 2): string => fmt(m * 1000, d)

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export const ML = 52
export const MR = 52
export const MT = 60
export const MB = 54
export const CW = A4.width - ML - MR

export interface Col {
  t: string
  w: number
  align?: 'l' | 'r' | 'c'
}

export class Layout {
  doc = new PdfDoc()
  y = A4.height - MT

  ensure(h: number): void {
    if (this.y - h < MB) this.newPage()
  }

  newPage(): void {
    this.doc.addPage()
    this.y = A4.height - MT
  }

  vspace(h: number): void {
    this.y -= h
  }

  h1(txt: string): void {
    this.ensure(30)
    this.vspace(10)
    this.doc.text(ML, this.y - 11, txt, 11.5, 'B', 0.05)
    this.y -= 15
    this.doc.line(ML, this.y, ML + CW, this.y, 0.9, 0.25)
    this.y -= 8
  }

  h2(txt: string): void {
    this.ensure(22)
    this.vspace(6)
    this.doc.text(ML, this.y - 9, txt, 9.5, 'B', 0.12)
    this.y -= 14
  }

  para(txt: string, size = 8.6, font: PdfFont = 'R', gray = 0.15): void {
    const lines = wrapText(txt, size, CW, font)
    for (const line of lines) {
      this.ensure(size + 4)
      this.doc.text(ML, this.y - size, line, size, font, gray)
      this.y -= size + 3
    }
    this.y -= 2
  }

  kv(rows: [string, string][], labelW = 190): void {
    for (const [k, v] of rows) {
      const lines = wrapText(v, 8.6, CW - labelW - 6)
      this.ensure(lines.length * 11.5 + 2)
      this.doc.text(ML, this.y - 8.6, k, 8.6, 'B', 0.2)
      for (const line of lines) {
        this.doc.text(ML + labelW, this.y - 8.6, line, 8.6, 'R', 0.12)
        this.y -= 11.5
      }
    }
    this.y -= 3
  }

  /** trunca com reticências p/ caber na largura */
  private fit(txt: string, size: number, maxW: number, font: PdfFont): string {
    if (textWidth(txt, size, font) <= maxW) return txt
    let t = txt
    while (t.length > 1 && textWidth(`${t}…`, size, font) > maxW) t = t.slice(0, -1)
    return `${t}…`
  }

  table(cols: Col[], rows: string[][], size = 7.4): void {
    const totalW = cols.reduce((s, c) => s + c.w, 0)
    const scale = CW / totalW
    const widths = cols.map((c) => c.w * scale)
    const rowH = size + 4.6
    const pad = 3

    const drawHeader = () => {
      this.ensure(rowH + 4)
      this.doc.fillRect(ML, this.y - rowH, CW, rowH, 0.9)
      let x = ML
      cols.forEach((c, i) => {
        const w = widths[i]
        const tx =
          c.align === 'r'
            ? x + w - pad - textWidth(c.t, size, 'B')
            : c.align === 'c'
              ? x + (w - textWidth(c.t, size, 'B')) / 2
              : x + pad
        this.doc.text(tx, this.y - rowH + 3.2, c.t, size, 'B', 0.1)
        x += w
      })
      this.y -= rowH
      this.doc.line(ML, this.y, ML + CW, this.y, 0.7, 0.35)
    }

    drawHeader()
    for (const row of rows) {
      if (this.y - rowH < MB) {
        this.newPage()
        drawHeader()
      }
      let x = ML
      cols.forEach((c, i) => {
        const w = widths[i]
        const raw = row[i] ?? ''
        const txt = this.fit(raw, size, w - 2 * pad, 'R')
        const tx =
          c.align === 'r'
            ? x + w - pad - textWidth(txt, size, 'R')
            : c.align === 'c'
              ? x + (w - textWidth(txt, size, 'R')) / 2
              : x + pad
        this.doc.text(tx, this.y - rowH + 3.2, txt, size, 'R', 0.12)
        x += w
      })
      this.y -= rowH
      this.doc.line(ML, this.y, ML + CW, this.y, 0.35, 0.82)
    }
    this.y -= 6
  }
  /**
   * Gráfico de linha com a envoltória de um esforço ao longo do elemento:
   * faixa entre `min` e `max` (uma curva só se forem iguais), eixo no zero,
   * marcas dos apoios, valores extremos anotados e as escalas na legenda.
   * `invert` desenha o positivo para baixo (momento no lado tracionado).
   */
  plot(p: PlotSpec): void {
    const H = p.height ?? 84
    const padTop = 12
    const padBottom = 24
    this.ensure(H + padTop + padBottom + 26)
    this.vspace(3)
    this.doc.text(ML, this.y - 8, p.title, 8.2, 'B', 0.12)
    this.y -= 12
    const x0 = ML + 30
    const x1 = ML + CW - 8
    const top = this.y - padTop
    const bottom = top - H
    const xMin = p.x[0] ?? 0
    const xMax = p.x[p.x.length - 1] ?? 1
    const spanX = Math.max(xMax - xMin, 1e-9)
    let vMin = Math.min(0, ...p.min)
    let vMax = Math.max(0, ...p.max)
    if (vMax - vMin < 1e-9) {
      vMin = -1
      vMax = 1
    }
    const sx = (x: number) => x0 + ((x - xMin) / spanX) * (x1 - x0)
    const sy = (v: number) => {
      const t = (v - vMin) / (vMax - vMin)
      return p.invert ? top - t * H : bottom + t * H
    }
    const yZero = sy(0)
    // faixas preenchidas até o eixo
    const band = (vals: number[], gray: number) => {
      const pts = p.x.map((x, i) => ({ x: sx(x), y: sy(vals[i]) }))
      this.doc.fillPolygon([{ x: sx(xMin), y: yZero }, ...pts, { x: sx(xMax), y: yZero }], gray)
    }
    const single = p.max.every((v, i) => Math.abs(v - p.min[i]) < 1e-9)
    band(p.max, 0.86)
    if (!single) band(p.min, 0.92)
    // apoios
    for (const m of p.marks ?? []) {
      const mx = sx(m.x)
      this.doc.polyline(
        [
          { x: mx, y: top + 3 },
          { x: mx, y: bottom - 3 },
        ],
        0.35,
        0.6,
        false,
        [2, 2],
      )
      const w = textWidth(m.label, 6.4, 'R')
      this.doc.text(Math.min(Math.max(mx - w / 2, ML), ML + CW - w), bottom - 19, m.label, 6.4, 'R', 0.3)
    }
    // eixo e curvas
    this.doc.line(x0, yZero, x1, yZero, 0.6, 0.25)
    const curve = (vals: number[]) =>
      this.doc.polyline(
        p.x.map((x, i) => ({ x: sx(x), y: sy(vals[i]) })),
        0.75,
        0.05,
      )
    curve(p.max)
    if (!single) curve(p.min)
    // extremos anotados
    const annotate = (vals: number[], pick: 'max' | 'min') => {
      let k = 0
      for (let i = 1; i < vals.length; i++) {
        if (pick === 'max' ? vals[i] > vals[k] : vals[i] < vals[k]) k = i
      }
      const v = vals[k]
      if (Math.abs(v) < 1e-6 * Math.max(Math.abs(vMax), Math.abs(vMin))) return
      const label = fmt(v, p.digits ?? 1)
      const w = textWidth(label, 6.8, 'B')
      const px = Math.min(Math.max(sx(p.x[k]) - w / 2, x0), x1 - w)
      // o rótulo fica do lado de fora da curva
      const outside = (pick === 'max') !== !!p.invert ? 3 : -8.5
      this.doc.text(px, sy(v) + outside, label, 6.8, 'B', 0.05)
    }
    annotate(p.max, 'max')
    annotate(p.min, 'min')
    // unidade e escalas
    this.doc.text(ML, top - 6, p.unit, 6.8, 'R', 0.3)
    this.y = bottom - padBottom
    const cmPt = 28.3465
    const hScale = (spanX / (x1 - x0)) * cmPt
    const vScale = ((vMax - vMin) / H) * cmPt
    const notes = [
      `Escalas: 1 cm = ${fmt(hScale, 2)} m (horizontal) · 1 cm = ${fmt(vScale, vScale < 10 ? 2 : 1)} ${p.unit} (vertical)`,
      ...(p.invert ? ['positivo para baixo (lado tracionado)'] : []),
      ...(p.note ? [p.note] : []),
    ]
    this.para(notes.join(' · '), 7, 'I', 0.35)
  }
}

export interface PlotSpec {
  title: string
  /** unidade do esforço, ex.: "kN·m" */
  unit: string
  /** posição ao longo do elemento, m (crescente; pode repetir nos apoios) */
  x: number[]
  max: number[]
  min: number[]
  /** positivo para baixo (momentos) */
  invert?: boolean
  /** apoios/pavimentos: linha tracejada e rótulo sob o eixo */
  marks?: { x: number; label: string }[]
  /** texto extra da legenda (combinação crítica etc.) */
  note?: string
  /** altura da área do gráfico, pt */
  height?: number
  /** casas decimais dos extremos */
  digits?: number
}
