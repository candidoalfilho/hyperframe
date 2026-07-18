/**
 * Writer PDF mínimo, zero dependências (como o writer DXF): PDF 1.4, página
 * A4, fontes base-14 (Helvetica/Bold/Oblique) com /WinAnsiEncoding, streams
 * de conteúdo sem compressão (texto pesquisável). Coordenadas em pt, origem
 * no canto INFERIOR esquerdo (padrão PDF) — o layout converte a partir do topo.
 */

export const A4 = { width: 595.28, height: 841.89 }

export type PdfFont = 'R' | 'B' | 'I'

const FONT_RES: Record<PdfFont, string> = { R: '/F1', B: '/F2', I: '/F3' }

// ---------------------------------------------------------------------------
// texto → WinAnsi (CP1252) com transliteração de símbolos de engenharia
// ---------------------------------------------------------------------------

/** substituições de tokens (aplicadas antes do mapeamento por caractere) */
const REPLACEMENTS: [string, string][] = [
  ['cosθ', 'cos(teta)'],
  ['γz', 'gama-z'],
  ['γc', 'gama-c'],
  ['γs', 'gama-s'],
  ['γf', 'gama-f'],
  ['γw', 'gama-w'],
  ['γ', 'gama'],
  ['θ1', 'teta1'],
  ['θa', 'teta-a'],
  ['θ', 'teta'],
  ['ψ0', 'psi0'],
  ['ψ1', 'psi1'],
  ['ψ2', 'psi2'],
  ['ψ', 'psi'],
  ['σ', 'sigma'],
  ['Δ', 'delta-'],
  ['δ', 'delta'],
  ['α', 'alfa'],
  ['λ', 'lambda'],
  ['ρ', 'ro'],
  ['ε', 'eps'],
  ['μ', 'mi'],
  ['ν', 'ni'],
  ['ξ', 'qsi'],
  ['φ', 'Ø'],
  ['⌀', 'Ø'],
  ['≤', '<='],
  ['≥', '>='],
  ['−', '-'],
  ['≈', '~'],
  ['√', 'raiz'],
  ['∞', 'inf'],
  ['→', '->'],
  ['⇒', '=>'],
]

/** CP1252: pontos fora do Latin-1 que têm byte próprio */
const CP1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
}

/** aplica transliterações e devolve string pronta p/ mapear byte a byte */
export function transliterate(s: string): string {
  let out = s
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to)
  return out
}

/** escapa p/ string literal PDF: bytes > 127 em \ooo (stream 100% ASCII) */
export function encodePdfText(s: string): string {
  const t = transliterate(s)
  let out = ''
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 63
    let byte: number
    if (cp === 0x28 || cp === 0x29 || cp === 0x5c) {
      out += `\\${ch}`
      continue
    }
    if (cp >= 32 && cp <= 126) {
      out += ch
      continue
    }
    if (cp >= 0xa0 && cp <= 0xff) byte = cp
    else if (CP1252[cp] !== undefined) byte = CP1252[cp]
    else byte = 63 // '?'
    out += `\\${byte.toString(8).padStart(3, '0')}`
  }
  return out
}

// ---------------------------------------------------------------------------
// métricas Helvetica (AFM, 1/1000 em) p/ quebra de linha e alinhamento
// ---------------------------------------------------------------------------

// prettier-ignore
const HELV_WIDTHS: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32–47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48–63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64–79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80–95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96–111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,   // 112–127
]

/** largura estimada do texto, pt (bold ≈ +5%) */
export function textWidth(s: string, size: number, font: PdfFont = 'R'): number {
  const t = transliterate(s)
  let units = 0
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 63
    if (cp >= 32 && cp <= 127) units += HELV_WIDTHS[cp - 32] || 556
    else units += 556
  }
  const w = (units / 1000) * size
  return font === 'B' ? w * 1.05 : w
}

/** quebra o texto em linhas que caibam em maxWidth */
export function wrapText(s: string, size: number, maxWidth: number, font: PdfFont = 'R'): string[] {
  const words = s.split(/\s+/).filter((w) => w.length > 0)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w
    if (textWidth(cand, size, font) <= maxWidth || cur === '') cur = cand
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length > 0 ? lines : ['']
}

// ---------------------------------------------------------------------------
// documento
// ---------------------------------------------------------------------------

export class PdfDoc {
  private pages: string[] = []
  private sizes: { width: number; height: number }[] = []
  private cur = -1
  private defaultSize: { width: number; height: number }

  /** `defaultSize` em pontos (1 pt = 1/72") — padrão A4 retrato */
  constructor(defaultSize?: { width: number; height: number }) {
    this.defaultSize = defaultSize ?? { width: A4.width, height: A4.height }
    this.addPage()
  }

  addPage(size?: { width: number; height: number }): void {
    this.pages.push('')
    this.sizes.push(size ?? this.defaultSize)
    this.cur = this.pages.length - 1
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** operador cru no stream da página atual */
  op(s: string): void {
    this.pages[this.cur] += `${s}\n`
  }

  /** texto em (x, y) — coordenadas PDF (y a partir de baixo) */
  text(x: number, y: number, s: string, size: number, font: PdfFont = 'R', gray = 0): void {
    const g = gray.toFixed(3)
    this.op(
      `BT ${g} ${g} ${g} rg ${FONT_RES[font]} ${size.toFixed(1)} Tf ${x.toFixed(2)} ${y.toFixed(
        2,
      )} Td (${encodePdfText(s)}) Tj ET`,
    )
  }

  /**
   * texto rotacionado (graus, anti-horário) com alinhamento opcional —
   * âncora em (x, y); 'center' desloca metade da largura na direção do texto
   */
  textRotated(
    x: number,
    y: number,
    s: string,
    size: number,
    angleDeg: number,
    font: PdfFont = 'R',
    gray = 0,
    align: 'left' | 'center' = 'left',
  ): void {
    const a = (angleDeg * Math.PI) / 180
    const c = Math.cos(a)
    const sn = Math.sin(a)
    let tx = x
    let ty = y
    if (align === 'center') {
      const w = textWidth(s, size)
      tx -= (w / 2) * c
      ty -= (w / 2) * sn
    }
    const g = gray.toFixed(3)
    this.op(
      `BT ${g} ${g} ${g} rg ${FONT_RES[font]} ${size.toFixed(2)} Tf ` +
        `${c.toFixed(5)} ${sn.toFixed(5)} ${(-sn).toFixed(5)} ${c.toFixed(5)} ` +
        `${tx.toFixed(2)} ${ty.toFixed(2)} Tm (${encodePdfText(s)}) Tj ET`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, gray = 0.55): void {
    const g = gray.toFixed(3)
    this.op(
      `${g} ${g} ${g} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(
        2,
      )} ${y2.toFixed(2)} l S`,
    )
  }

  fillRect(x: number, y: number, w: number, h: number, gray = 0.93): void {
    const g = gray.toFixed(3)
    this.op(`${g} ${g} ${g} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
  }

  /** desenha em TODAS as páginas (ex.: rodapé com nº de páginas) */
  forEachPage(fn: (pageIndex: number, total: number) => void): void {
    const total = this.pages.length
    const saved = this.cur
    for (let i = 0; i < total; i++) {
      this.cur = i
      fn(i, total)
    }
    this.cur = saved
  }

  /** monta o arquivo PDF (ASCII puro → bytes) */
  build(): Uint8Array {
    const objects: string[] = []
    // 1: catálogo · 2: árvore de páginas · 3-5: fontes
    const nPages = this.pages.length
    const pageObjStart = 6
    const kids = Array.from({ length: nPages }, (_, i) => `${pageObjStart + i * 2} 0 R`).join(' ')

    objects.push('<< /Type /Catalog /Pages 2 0 R >>')
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`)
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    )
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    )
    objects.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
    )

    for (let i = 0; i < nPages; i++) {
      const contentRef = pageObjStart + i * 2 + 1
      const sz = this.sizes[i] ?? this.defaultSize
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sz.width.toFixed(2)} ${sz.height.toFixed(2)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentRef} 0 R >>`,
      )
      const stream = this.pages[i]
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
    }

    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((obj, i) => {
      offsets.push(body.length)
      body += `${i + 1} 0 obj\n${obj}\nendobj\n`
    })
    const xrefStart = body.length
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const off of offsets) {
      body += `${off.toString().padStart(10, '0')} 00000 n \n`
    }
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

    const bytes = new Uint8Array(body.length)
    for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff
    return bytes
  }
}
