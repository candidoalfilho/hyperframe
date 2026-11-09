import { beforeAll, describe, expect, it } from 'vitest'
import { PdfDoc, encodePdfText, textWidth, transliterate, wrapText } from '../src/report/pdf'
import { buildMemorialPdf } from '../src/report/memorial'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import type { AnalysisResults } from '../src/analysis/types'

const toStr = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

// ---------------------------------------------------------------------------
// writer PDF (primitivas)
// ---------------------------------------------------------------------------

describe('pdf writer (primitivas)', () => {
  it('escapa parênteses/contrabarra e codifica acentos em octal (WinAnsi)', () => {
    expect(encodePdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d')
    expect(encodePdfText('ç')).toBe('\\347') // U+00E7
    expect(encodePdfText('ã')).toBe('\\343')
    expect(encodePdfText('–')).toBe('\\226') // en-dash CP1252 0x96
  })

  it('translitera símbolos de engenharia (γz, θa, φ, ≤)', () => {
    expect(transliterate('γz = 1,15')).toBe('gama-z = 1,15')
    expect(transliterate('θa = 1/300')).toBe('teta-a = 1/300')
    expect(transliterate('φ12,5 ≤ 20')).toBe('Ø12,5 <= 20')
  })

  it('textWidth usa métricas Helvetica (dígito = 556/1000 em)', () => {
    expect(textWidth('000', 10)).toBeCloseTo(3 * 5.56, 3)
    expect(textWidth('i', 10)).toBeCloseTo(2.22, 3)
  })

  it('wrapText quebra em larguras que cabem', () => {
    const lines = wrapText('uma linha com várias palavras pequenas', 10, 80)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(80 + 1e-9)
  })

  it('gera PDF estruturalmente válido (xref aponta p/ objetos)', () => {
    const doc = new PdfDoc()
    doc.text(50, 700, 'Olá, memória de cálculo (β)', 12, 'B')
    doc.addPage()
    doc.text(50, 700, 'página 2', 10)
    const s = toStr(doc.build())

    expect(s.startsWith('%PDF-1.4\n')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toContain('/Count 2')

    // startxref aponta exatamente p/ a tabela xref
    const sx = Number(/startxref\n(\d+)\n%%EOF/.exec(s)?.[1])
    expect(s.slice(sx, sx + 4)).toBe('xref')

    // cada offset da xref aponta p/ "<n> 0 obj"
    const entries = [...s.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]))
    expect(entries.length).toBeGreaterThanOrEqual(9) // 5 fixos + 2 páginas × 2
    entries.forEach((off, i) => {
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
  })
})

// ---------------------------------------------------------------------------
// memorial completo
// ---------------------------------------------------------------------------

describe('buildMemorialPdf (memorial completo)', () => {
  let results: AnalysisResults
  let pdf: string

  beforeAll(() => {
    const project = createSampleProject()
    results = analyze(project)
    pdf = toStr(buildMemorialPdf(project, results, { generatedAt: '10/07/2026 12:00' }))
  })

  it('é um PDF multipágina substancial', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf.length).toBeGreaterThan(30_000)
    const count = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(count).toBeGreaterThanOrEqual(5)
    // nº de objetos de página bate com /Count
    expect(pdf.match(/\/Type \/Page /g)?.length).toBe(count)
  })

  it('contém todas as seções do memorial (texto pesquisável)', () => {
    for (const sec of [
      'Memorial de C', // título (á escapado)
      '1. Materiais e durabilidade',
      '2. Geometria e modelo',
      '3. A\\347\\365es', // Ações
      '4. Combina\\347\\365es',
      '5. Estabilidade global',
      '6. Vigas',
      '8. Pilares',
      '9. Lajes \\(Marcus',
      '10. Escadas',
      '11. Reservat\\363rios',
      '12. Funda\\347\\365es',
      '13. Situa\\347\\343o de inc\\352ndio',
      '14. Quantitativos',
      '15. Avisos',
    ]) {
      expect(pdf, `seção ausente: ${sec}`).toContain(sec)
    }
  })

  it('inclui dados do dimensionamento e rodapé com paginação', () => {
    const v1 = results.beamDesign[0]
    expect(pdf).toContain(`${v1.beamName} v${v1.spanIndex + 1}`)
    expect(pdf).toContain('gama-z') // γz transliterado
    expect(pdf).toContain('p\\341gina 1 de')
    expect(pdf).toContain('n\\343o substituem o engenheiro')
  })

  it('tabela de vigas traz as barras das negativas (bitola × quantidade) por apoio', () => {
    expect(pdf).toContain('Barras- e/d') // cabeçalho (− transliterado p/ hífen)
    const comNeg = results.beamDesign.find((b) => b.negLeft)
    expect(comNeg).toBeDefined()
    // spec tipo "3Ø10" (φ transliterado p/ Ø) presente no PDF
    expect(comNeg!.negLeft!.bars.length).toBeGreaterThan(0)
    expect(pdf).toContain(comNeg!.negLeft!.bars.replace('φ', '\\330'))
  })
})
