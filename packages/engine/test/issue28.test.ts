import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import {
  OVERFLOW_SHRINK_STEPS,
  SHEET_SOURCE_GROUPS,
  buildSourceDrawing,
  composeSheetLayout,
  newSheetItem,
  placeNewSheetItem,
  placeNewSheetItems,
  SHEET_GAP,
  freeSheetSpot,
  placeSheetItems,
  sheetAreas,
  sheetIssues,
  sheetSourceKey,
  sheetSourceOptions,
} from '../src/drawing/sheetLayout'
import { STANDARD_SCALES } from '../src/drawing/sheet'
import { decodeDxfBytes, decodeDxfText, dxfSafeText, encodeDxf } from '../src/dxf/encoding'
import { parseDxf } from '../src/dxf/parse'
import { writeDxf, writeDxfBytes } from '../src/dxf/write'
import type { Drawing } from '../src/drawing/types'
import type { SheetLayout, SheetSource } from '../src/model/types'

/** issue #28 — DXF com × e Ø corrompidos; vários desenhos de uma vez na prancha */

const project = createSampleProject()
const results = analyze(project)
const plan = project.plans[0]

/** como o AutoCAD lê um R12: cada byte é um caractere da página ANSI_1252 */
// (tabela própria do teste: o TextDecoder do Node trata windows-1252 como Latin-1)
const WIN_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const asCp1252 = (bytes: Uint8Array): string =>
  [...bytes].map((b) => (b >= 0x80 && b <= 0x9f ? WIN_80_9F[b - 0x80] : String.fromCharCode(b))).join('')
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const textDrawing = (text: string): Drawing => ({
  title: 'Detalhe — armação',
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  primitives: [{ kind: 'text', x: 0, y: 0, text, height: 0.1, layer: 'TEXTOS' }],
})

describe('texto do DXF', () => {
  it('o caso do relato: "N4 16×φ5 c/18" abre como "N4 16×Ø5 c/18"', () => {
    const bytes = writeDxfBytes(textDrawing('N4 16×φ5 c/18'))
    const comoOAutocadLe = asCp1252(bytes)
    expect(comoOAutocadLe).toContain('\n1\nN4 16×Ø5 c/18\n')
    // nada das sequências que apareciam: "Ã—" (× em UTF-8) e "Ï†" (φ em UTF-8)
    expect(comoOAutocadLe).not.toMatch(/Ã—|Ï†/)
    // × e Ø são um byte cada
    const linha = [...bytes].join(',')
    expect(linha).toContain([0x31, 0x36, 0xd7, 0xd8, 0x35].join(','))
  })

  it('acentos, travessão e símbolos da página saem um byte por caractere', () => {
    const s = 'Fundação — seção 20×50 · 12,5 m² ±0,5° “aço” ½'
    expect(dxfSafeText(s)).toBe(s)
    const bytes = encodeDxf(s)
    expect(bytes).toHaveLength([...s].length)
    expect(asCp1252(bytes)).toBe(s)
    expect([...encodeDxf('ç—×Øã')]).toEqual([0xe7, 0x97, 0xd7, 0xd8, 0xe3])
  })

  it('o que a página não tem é transliterado; o resto vira \\U+XXXX', () => {
    expect(dxfSafeText('φ10 ⌀12')).toBe('Ø10 Ø12')
    expect(dxfSafeText('As ≥ 2,5 e x ≤ 0,45')).toBe('As >= 2,5 e x <= 0,45')
    expect(dxfSafeText('γf = 1,4 → σ')).toBe('gamaf = 1,4 -> sigma'.replace('gamaf', 'gama-f'))
    // sem transliteração: escape do DXF, só ASCII
    expect(dxfSafeText('0,25·ℓ · σmáx 260 kPa')).toBe('0,25·l · sigma-máx 260 kPa')
    expect(dxfSafeText('área ∑ 日')).toBe('área \\U+2211 \\U+65E5')
    expect([...encodeDxf(dxfSafeText('∑'))].every((b) => b < 0x80)).toBe(true)
  })

  it('o cabeçalho declara a página e o conteúdo só tem caracteres dela', () => {
    const s = writeDxf(textDrawing('N1 2 φ 12,5 — C=320'))
    expect(s).toContain('$DWGCODEPAGE\n3\nANSI_1252\n')
    // ainda R12, com a página logo depois da versão
    expect(s.indexOf('AC1009')).toBeLessThan(s.indexOf('$DWGCODEPAGE'))
    expect(s).toContain('N1 2 Ø 12,5 — C=320')
    // gravar e reler os bytes devolve exatamente o conteúdo
    expect(asCp1252(encodeDxf(s))).toBe(s)
    expect(encodeDxf(s)).toHaveLength(s.length)
  })

  it('todos os desenhos do projeto: nenhum caractere perdido nem escapado', () => {
    const opts = sheetSourceOptions(project, results)
    expect(opts.length).toBeGreaterThan(10)
    let comSimbolo = 0
    for (const o of opts) {
      const d = buildSourceDrawing(project, results, o.source)!
      const s = writeDxf(d)
      // se aparecer \U+, falta uma transliteração para um símbolo que o programa usa
      expect(s, o.label).not.toContain('\\U+')
      const bytes = encodeDxf(s)
      // "?" só onde o texto já tinha "?"
      expect(bytes.filter((b) => b === 0x3f).length, o.label).toBe([...s].filter((c) => c === '?').length)
      expect(asCp1252(bytes), o.label).toBe(s)
      if (/[×Ø]/.test(s)) comSimbolo++
    }
    // o teste só vale se os desenhos de armação de fato trazem os símbolos
    expect(comSimbolo).toBeGreaterThan(3)
  })

  it('prancha composta: carimbo e títulos acentuados chegam inteiros', () => {
    const lay: SheetLayout = {
      id: 's',
      name: 'Formas e armações',
      format: 'A1',
      items: [
        { id: 'a', source: { kind: 'viga', beamId: plan.beams[0].id }, x: 0.05, y: 0.3, scale: 50 },
        { id: 'b', source: { kind: 'fundacoes-det' }, x: 0.45, y: 0.3, scale: 50 },
      ],
    }
    const { drawing } = composeSheetLayout(project, results, lay, { projectName: 'Edifício São João', date: '27/11/2026' })
    const lido = asCp1252(writeDxfBytes(drawing))
    expect(lido).toContain('Edifício São João')
    expect(lido).toMatch(/Ø/)
    expect(lido).not.toMatch(/Ã—|Ã˜|Ã§|Ã£|Ã©|Ï†/)
    // o leitor do próprio programa relê os textos como foram escritos
    const textos = parseDxf(decodeDxfBytes(writeDxfBytes(drawing))).filter((e) => e.type === 'text')
    expect(textos.some((t) => t.text?.includes('Edifício São João'))).toBe(true)
    expect(textos.some((t) => t.text?.includes('Ø'))).toBe(true)
  })
})

describe('leitura de DXF de terceiros', () => {
  const file = (text: string) => `0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\nT\n10\n0\n20\n0\n40\n1\n1\n${text}\n0\nENDSEC\n0\nEOF\n`

  it('ANSI_1252 (AutoCAD até 2006 e R12) e UTF-8 (2007 em diante) dão o mesmo texto', () => {
    const s = file('Seção 20×50 Ø10 — aço')
    const ansi = encodeDxf(s)
    expect(decodeDxfBytes(ansi)).toBe(s)
    expect(decodeDxfBytes(utf8(s))).toBe(s)
    // marca de ordem de bytes no começo do UTF-8 é descartada
    expect(decodeDxfBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(s)]))).toBe(s)
    expect(parseDxf(decodeDxfBytes(ansi))[0].text).toBe('Seção 20×50 Ø10 — aço')
    expect(parseDxf(decodeDxfBytes(utf8(s)))[0].text).toBe('Seção 20×50 Ø10 — aço')
  })

  it('bytes que não formam UTF-8 são lidos como ANSI_1252', () => {
    // "é" sozinho (0xE9) abriria uma sequência de 3 bytes em UTF-8
    expect(decodeDxfBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
    // sequência truncada no fim do arquivo e forma longa demais
    expect(decodeDxfBytes(new Uint8Array([0x41, 0xc3]))).toBe('AÃ')
    expect(decodeDxfBytes(new Uint8Array([0xc0, 0xaf]))).toBe('À¯')
    // só ASCII: igual nas duas leituras
    expect(decodeDxfBytes(utf8('V1 20x50'))).toBe('V1 20x50')
    expect(decodeDxfBytes(new Uint8Array())).toBe('')
  })

  it('códigos de controle e escapes do AutoCAD viram o símbolo', () => {
    expect(decodeDxfText('%%c12.5 c/15')).toBe('Ø12.5 c/15')
    expect(decodeDxfText('45%%d %%p0,5 100%%%')).toBe('45° ±0,5 100%')
    expect(decodeDxfText('20\\U+00D750 \\U+00d810')).toBe('20×50 Ø10')
    expect(parseDxf(file('N4 16\\U+00D7%%C5 c/18'))[0].text).toBe('N4 16×Ø5 c/18')
    // MTEXT: o escape não é confundido com código de formatação "\\X…;"
    const mtext = '0\nSECTION\n2\nENTITIES\n0\nMTEXT\n8\nT\n10\n0\n20\n0\n40\n1\n1\n{\\fArial;20\\U+00D750}\\Pcobrimento; 3 cm\n0\nENDSEC\n0\nEOF\n'
    expect(parseDxf(mtext)[0].text).toBe('20×50 cobrimento; 3 cm')
  })
})

describe('desenhos disponíveis para a prancha', () => {
  it('cada desenho tem chave única, categoria conhecida e, quando é de um pavimento, a planta', () => {
    const opts = sheetSourceOptions(project, results)
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length)
    for (const o of opts) {
      expect(SHEET_SOURCE_GROUPS as readonly string[]).toContain(o.group)
      expect(o.key).toBe(sheetSourceKey(o.source))
    }
    // categorias na ordem das listas, sem voltar a uma categoria já fechada
    const order = opts.map((o) => SHEET_SOURCE_GROUPS.indexOf(o.group as (typeof SHEET_SOURCE_GROUPS)[number]))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const of = (kind: SheetSource['kind']) => opts.filter((o) => o.source.kind === kind)
    for (const o of [...of('forma'), ...of('lajes')]) {
      expect(o.planId).toBe((o.source as { planId: string }).planId)
    }
    // viga: a planta em que ela está
    for (const o of of('viga')) {
      const owner = project.plans.find((p) => p.beams.some((b) => b.id === (o.source as { beamId: string }).beamId))
      expect(o.planId).toBe(owner!.id)
    }
    for (const o of [...of('pilares'), ...of('aco'), ...of('corte'), ...of('fundacoes')]) expect(o.planId).toBeUndefined()
    // a mesma origem em outro objeto tem a mesma chave
    expect(sheetSourceKey({ kind: 'viga', beamId: 'x' })).toBe(sheetSourceKey({ beamId: 'x', kind: 'viga' }))
    expect(sheetSourceKey({ kind: 'corte', dir: 'x', axisId: 'a' })).not.toBe(sheetSourceKey({ kind: 'corte', dir: 'y', axisId: 'a' }))
  })
})

describe('vários desenhos de uma vez', () => {
  const empty = (format: SheetLayout['format']): SheetLayout => ({ id: 's1', name: 'Prancha 01', format, items: [] })
  const ids = () => {
    let n = 0
    return () => `n${n++}`
  }
  const all = sheetSourceOptions(project, results).map((o) => o.source)
  const issuesOf = (lay: SheetLayout) => sheetIssues(lay.format, placeSheetItems(project, results, lay))

  it('um a um ou em lote dá a mesma folha', () => {
    const sources = all.slice(0, 6)
    let seq = empty('A1')
    const id = ids()
    for (const s of sources) seq = { ...seq, items: [...seq.items, placeNewSheetItem(project, results, seq, s, id())] }
    const lote = placeNewSheetItems(project, results, empty('A1'), sources, ids())
    expect(lote.items).toEqual(seq.items)
    expect(lote.extra).toEqual([])
    expect(lote.unplaced).toBe(0)
  })

  it('com transbordo: sem sobreposição, em quantas folhas for preciso, sem encolher demais', () => {
    expect(all.length).toBeGreaterThan(15)
    const base = empty('A3')
    const r = placeNewSheetItems(project, results, base, all, ids(), { overflow: true })
    const sheets = [{ ...base, items: r.items }, ...r.extra.map((items, i) => ({ ...base, id: `e${i}`, items }))]
    expect(r.extra.length).toBeGreaterThan(0)
    expect(r.unplaced).toBe(0)
    // cada desenho entrou exatamente uma vez, na ordem pedida dentro de cada folha
    const placed = sheets.flatMap((sh) => sh.items)
    expect(placed.map((it) => sheetSourceKey(it.source)).sort()).toEqual(all.map(sheetSourceKey).sort())
    expect(new Set(placed.map((it) => it.id)).size).toBe(all.length)
    for (const sh of sheets) {
      expect(sh.items.length).toBeGreaterThan(0)
      expect(issuesOf(sh), sh.id).toEqual([])
      // ninguém encolheu mais que duas escalas-padrão abaixo da que teria sozinho
      for (const it of sh.items) {
        const std = newSheetItem(project, results, 'A3', it.source, 'x').scale
        const steps = STANDARD_SCALES.indexOf(it.scale) - STANDARD_SCALES.indexOf(std)
        expect(steps, sheetSourceKey(it.source)).toBeGreaterThanOrEqual(0)
        expect(steps, sheetSourceKey(it.source)).toBeLessThanOrEqual(OVERFLOW_SHRINK_STEPS)
      }
    }
  })

  it('sem transbordo: tudo na mesma folha; quem não achou lugar é contado e a conferência aponta', () => {
    const base = empty('A4')
    const r = placeNewSheetItems(project, results, base, all, ids())
    expect(r.extra).toEqual([])
    expect(r.items).toHaveLength(all.length)
    expect(r.unplaced).toBeGreaterThan(0)
    const sobrepostos = new Set(
      issuesOf({ ...base, items: r.items })
        .filter((i) => i.kind === 'sobreposto')
        .flatMap((i) => [i.itemId, i.otherId]),
    )
    expect(sobrepostos.size).toBeGreaterThanOrEqual(r.unplaced)
  })

  it('respeita o que já está na folha', () => {
    const forma: SheetSource = { kind: 'forma', planId: plan.id }
    const first = placeNewSheetItems(project, results, empty('A1'), [forma], ids())
    const lay = { ...empty('A1'), items: first.items }
    const more = placeNewSheetItems(project, results, lay, [{ kind: 'pilares' }, { kind: 'aco' }], () => `m${Math.random()}`)
    expect(issuesOf({ ...lay, items: [...lay.items, ...more.items] })).toEqual([])
    expect(placeNewSheetItems(project, results, lay, [], ids())).toEqual({ items: [], extra: [], unplaced: 0 })
  })
})

describe('lugar livre na folha', () => {
  it('acha o canto que sobra entre desenhos de tamanhos diferentes', () => {
    const { usable } = sheetAreas('A1')
    const W = usable.x1 - usable.x0
    // um desenho largo e baixo no alto, um estreito e alto abaixo dele, à esquerda
    const wide = { x0: usable.x0, y0: usable.y1 - 0.1, x1: usable.x0 + W * 0.7, y1: usable.y1 }
    const tall = { x0: usable.x0, y0: wide.y0 - SHEET_GAP - 0.3, x1: usable.x0 + 0.2, y1: wide.y0 - SHEET_GAP }
    // caixa que só cabe à direita do estreito e abaixo do largo
    const spot = freeSheetSpot('A1', [wide, tall], W * 0.5, 0.2)
    expect(spot).not.toBeNull()
    // (posições no décimo de milímetro, arredondadas para longe do vizinho)
    expect(spot!.x).toBeGreaterThanOrEqual(tall.x1 + SHEET_GAP - 1e-9)
    expect(spot!.x).toBeLessThan(tall.x1 + SHEET_GAP + 1.5e-4)
    expect(spot!.y + 0.2).toBeLessThanOrEqual(wide.y0 - SHEET_GAP + 1e-9)
    expect(spot!.y + 0.2).toBeGreaterThan(wide.y0 - SHEET_GAP - 1.5e-4)
    // folha vazia: canto superior esquerdo; caixa maior que a folha: sem lugar
    const corner = freeSheetSpot('A1', [], 0.1, 0.1)!
    expect(corner.x).toBeCloseTo(usable.x0, 3)
    expect(corner.y).toBeCloseTo(usable.y1 - 0.1, 3)
    expect(corner.y + 0.1).toBeLessThanOrEqual(usable.y1 + 1e-9)
    expect(freeSheetSpot('A1', [], 2, 0.1)).toBeNull()
  })
})
