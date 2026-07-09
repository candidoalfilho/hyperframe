import { describe, expect, it } from 'vitest'
import { parseDxf } from '../src/dxf/parse'
import { writeDxf } from '../src/dxf/write'
import type { Drawing } from '../src/drawing/types'

/** monta um DXF ASCII a partir da sequência código, valor, código, valor… */
function dxf(...linhas: (string | number)[]): string {
  return linhas.map(String).join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Entidades básicas
// ---------------------------------------------------------------------------

const SAMPLE = dxf(
  0, 'SECTION', 2, 'HEADER',
  9, '$ACADVER', 1, 'AC1009',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LINE', 8, 'PAREDES', 10, 1.5, 20, 2.5, 11, 4, 21, 6,
  0, 'CIRCLE', 8, 'FUROS', 10, 3, 20, 4, 40, 0.75,
  0, 'LWPOLYLINE', 8, 'LAJES', 90, 3, 70, 1, 10, 0, 20, 0, 10, 5, 20, 0, 10, 5, 20, 3,
  0, 'TEXT', 8, 'TEXTOS', 10, 2, 20, 2.2, 40, 0.25, 1, 'P1 20x40', 50, 90,
  0, 'ARC', 8, 'EIXOS', 10, 1, 20, 1, 40, 2, 50, 30, 51, 120,
  0, 'ENDSEC',
  0, 'EOF',
)

describe('parseDxf — entidades básicas', () => {
  it('lê LINE, CIRCLE, LWPOLYLINE, TEXT e ARC com coordenadas e layers exatos', () => {
    const ents = parseDxf(SAMPLE)
    expect(ents).toHaveLength(5)

    const [linha, circulo, poli, texto, arco] = ents

    expect(linha.type).toBe('line')
    expect(linha.x1).toBeCloseTo(1.5, 9)
    expect(linha.y1).toBeCloseTo(2.5, 9)
    expect(linha.x2).toBeCloseTo(4, 9)
    expect(linha.y2).toBeCloseTo(6, 9)
    expect(linha.layer).toBe('PAREDES')

    expect(circulo.type).toBe('circle')
    expect(circulo.cx).toBeCloseTo(3, 9)
    expect(circulo.cy).toBeCloseTo(4, 9)
    expect(circulo.r).toBeCloseTo(0.75, 9)
    expect(circulo.layer).toBe('FUROS')

    expect(poli.type).toBe('polyline')
    expect(poli.closed).toBe(true)
    expect(poli.layer).toBe('LAJES')
    expect(poli.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
    ])

    expect(texto.type).toBe('text')
    expect(texto.text).toBe('P1 20x40')
    expect(texto.x).toBeCloseTo(2, 9)
    expect(texto.y).toBeCloseTo(2.2, 9)
    expect(texto.height).toBeCloseTo(0.25, 9)
    expect(texto.rotation).toBeCloseTo(90, 9)
    expect(texto.layer).toBe('TEXTOS')

    expect(arco.type).toBe('arc')
    expect(arco.cx).toBeCloseTo(1, 9)
    expect(arco.cy).toBeCloseTo(1, 9)
    expect(arco.r).toBeCloseTo(2, 9)
    expect(arco.a1).toBeCloseTo(30, 9)
    expect(arco.a2).toBeCloseTo(120, 9)
    expect(arco.layer).toBe('EIXOS')
  })

  it('aceita quebras de linha CRLF', () => {
    const ents = parseDxf(SAMPLE.replace(/\n/g, '\r\n'))
    expect(ents).toHaveLength(5)
    expect(ents[0].type).toBe('line')
    expect(ents[0].x1).toBeCloseTo(1.5, 9)
  })
})

// ---------------------------------------------------------------------------
// BLOCKS + INSERT
// ---------------------------------------------------------------------------

describe('parseDxf — blocos e INSERT', () => {
  it('expande INSERT com escala 2 e rotação 90°', () => {
    const s = dxf(
      0, 'SECTION', 2, 'BLOCKS',
      0, 'BLOCK', 8, '0', 2, 'B1', 70, 0, 10, 0, 20, 0,
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0,
      0, 'ENDBLK',
      0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'INSERT', 8, 'MOB', 2, 'B1', 10, 10, 20, 5, 41, 2, 42, 2, 50, 90,
      0, 'ENDSEC',
      0, 'EOF',
    )
    const ents = parseDxf(s)
    expect(ents).toHaveLength(1)
    const linha = ents[0]
    expect(linha.type).toBe('line')
    // (1,0) girado 90° ccw → (0,1); ×2 → (0,2); transladado → (10,7)
    expect(linha.x1).toBeCloseTo(10, 9)
    expect(linha.y1).toBeCloseTo(5, 9)
    expect(linha.x2).toBeCloseTo(10, 9)
    expect(linha.y2).toBeCloseTo(7, 9)
    // entidade no layer "0" herda o layer do INSERT
    expect(linha.layer).toBe('MOB')
  })

  it('expande INSERT aninhado (bloco dentro de bloco)', () => {
    const s = dxf(
      0, 'SECTION', 2, 'BLOCKS',
      0, 'BLOCK', 2, 'B1', 10, 0, 20, 0,
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0,
      0, 'ENDBLK',
      0, 'BLOCK', 2, 'B2', 10, 0, 20, 0,
      0, 'INSERT', 2, 'B1', 10, 1, 20, 0,
      0, 'ENDBLK',
      0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'INSERT', 2, 'B2', 10, 5, 20, 5,
      0, 'ENDSEC',
      0, 'EOF',
    )
    const ents = parseDxf(s)
    expect(ents).toHaveLength(1)
    expect(ents[0].type).toBe('line')
    expect(ents[0].x1).toBeCloseTo(6, 9)
    expect(ents[0].y1).toBeCloseTo(5, 9)
    expect(ents[0].x2).toBeCloseTo(7, 9)
    expect(ents[0].y2).toBeCloseTo(5, 9)
  })

  it('INSERT de bloco desconhecido é ignorado sem lançar', () => {
    const s = dxf(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'INSERT', 2, 'NAO_EXISTE', 10, 1, 20, 1,
      0, 'ENDSEC',
      0, 'EOF',
    )
    expect(parseDxf(s)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POLYLINE clássica
// ---------------------------------------------------------------------------

describe('parseDxf — POLYLINE/VERTEX/SEQEND', () => {
  it('monta a polilinha a partir dos VERTEX e lê o flag de fechada', () => {
    const s = dxf(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'POLYLINE', 8, 'VIGAS', 66, 1, 70, 1,
      0, 'VERTEX', 8, 'VIGAS', 10, 0, 20, 0,
      0, 'VERTEX', 8, 'VIGAS', 10, 4, 20, 0,
      0, 'VERTEX', 8, 'VIGAS', 10, 4, 20, 3,
      0, 'SEQEND',
      0, 'ENDSEC',
      0, 'EOF',
    )
    const ents = parseDxf(s)
    expect(ents).toHaveLength(1)
    const poli = ents[0]
    expect(poli.type).toBe('polyline')
    expect(poli.closed).toBe(true)
    expect(poli.layer).toBe('VIGAS')
    expect(poli.points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ])
  })
})

// ---------------------------------------------------------------------------
// MTEXT
// ---------------------------------------------------------------------------

describe('parseDxf — MTEXT', () => {
  it('junta a continuação (grupo 3) e remove a formatação inline', () => {
    const s = dxf(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'MTEXT', 8, 'TEXTOS', 10, 1, 20, 2, 40, 0.3,
      3, 'VIGA ',
      1, '{\\fArial|b0|i0;\\A1;V1\\P20x50}',
      0, 'ENDSEC',
      0, 'EOF',
    )
    const ents = parseDxf(s)
    expect(ents).toHaveLength(1)
    const texto = ents[0]
    expect(texto.type).toBe('text')
    expect(texto.text).toBe('VIGA V1 20x50')
    expect(texto.x).toBeCloseTo(1, 9)
    expect(texto.y).toBeCloseTo(2, 9)
    expect(texto.height).toBeCloseTo(0.3, 9)
  })
})

// ---------------------------------------------------------------------------
// Roundtrip writeDxf → parseDxf
// ---------------------------------------------------------------------------

describe('writeDxf ⇄ parseDxf (roundtrip)', () => {
  const drawing: Drawing = {
    title: 'Planta de formas — teste',
    bounds: { minX: 0, minY: -1, maxX: 10, maxY: 5 },
    primitives: [
      { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0, layer: 'VIGAS' },
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 1 },
        ],
        closed: true,
        layer: 'LAJES',
      },
      { kind: 'circle', cx: 1, cy: 1, r: 0.3, layer: 'PILARES', filled: true },
      { kind: 'text', x: 2, y: 3, text: 'V1 20x50', height: 0.2, layer: 'TEXTOS', align: 'center' },
      { kind: 'dim', x1: 0, y1: 0, x2: 5, y2: 0, offset: -0.6, text: '500', layer: 'COTAS' },
    ],
  }

  it('gera a estrutura R12 esperada', () => {
    const s = writeDxf(drawing)
    expect(s).toContain('AC1009')
    expect(s).toContain('$INSUNITS')
    expect(s).toContain('CONTORNO')
    expect(s).toContain('ARMADURA')
    expect(s.endsWith('0\nEOF\n')).toBe(true)
  })

  it('roundtrip preserva contagem, coordenadas e o texto da cota', () => {
    const ents = parseDxf(writeDxf(drawing))
    // 4 primitivas diretas + cota decomposta em 5 linhas + 1 texto
    expect(ents).toHaveLength(10)

    const linha = ents.find((e) => e.type === 'line' && e.layer === 'VIGAS')!
    expect(linha).toBeDefined()
    expect(linha.x1).toBeCloseTo(0, 6)
    expect(linha.y1).toBeCloseTo(0, 6)
    expect(linha.x2).toBeCloseTo(5, 6)
    expect(linha.y2).toBeCloseTo(0, 6)

    const poli = ents.find((e) => e.type === 'polyline')!
    expect(poli).toBeDefined()
    expect(poli.closed).toBe(true)
    expect(poli.layer).toBe('LAJES')
    expect(poli.points).toHaveLength(3)
    expect(poli.points![1].x).toBeCloseTo(2, 6)
    expect(poli.points![2].y).toBeCloseTo(1, 6)

    const circ = ents.find((e) => e.type === 'circle')!
    expect(circ).toBeDefined()
    expect(circ.cx).toBeCloseTo(1, 6)
    expect(circ.cy).toBeCloseTo(1, 6)
    expect(circ.r).toBeCloseTo(0.3, 6)
    expect(circ.layer).toBe('PILARES')

    const rotulo = ents.find((e) => e.type === 'text' && e.text === 'V1 20x50')!
    expect(rotulo).toBeDefined()
    expect(rotulo.x).toBeCloseTo(2, 6)
    expect(rotulo.y).toBeCloseTo(3, 6)
    expect(rotulo.height).toBeCloseTo(0.2, 6)
    expect(rotulo.layer).toBe('TEXTOS')

    // o texto da cota sobrevive ao roundtrip
    expect(ents.some((e) => e.type === 'text' && e.text === '500')).toBe(true)
  })

  it('cota decompõe em ≥ 3 entidades: linhas + texto centrado e afastado', () => {
    const ents = parseDxf(writeDxf(drawing))
    const cotas = ents.filter((e) => e.layer === 'COTAS')
    expect(cotas.length).toBeGreaterThanOrEqual(3)

    // linha de cota + 2 linhas de chamada + 2 traços a 45°
    const linhas = cotas.filter((e) => e.type === 'line')
    expect(linhas).toHaveLength(5)

    // a linha de cota fica deslocada offset = −0,6 na perpendicular (y = −0,6)
    const linhaDeCota = linhas.find(
      (l) => Math.abs((l.y1 ?? 9) + 0.6) < 1e-6 && Math.abs((l.y2 ?? 9) + 0.6) < 1e-6,
    )!
    expect(linhaDeCota).toBeDefined()
    expect(Math.min(linhaDeCota.x1!, linhaDeCota.x2!)).toBeCloseTo(0, 6)
    expect(Math.max(linhaDeCota.x1!, linhaDeCota.x2!)).toBeCloseTo(5, 6)

    const texto = cotas.find((e) => e.type === 'text')!
    expect(texto).toBeDefined()
    expect(texto.text).toBe('500')
    // meio do vão, afastado 1,4·offset na perpendicular
    expect(texto.x).toBeCloseTo(2.5, 6)
    expect(texto.y).toBeCloseTo(-0.84, 6)
    // altura = |offset|·0,55 grampeada em [0,10 ; 0,30]
    expect(texto.height).toBeCloseTo(0.3, 6)
    expect(texto.rotation ?? 0).toBeCloseTo(0, 6)
  })
})

// ---------------------------------------------------------------------------
// Arquivos problemáticos
// ---------------------------------------------------------------------------

describe('parseDxf — arquivos problemáticos', () => {
  it('conteúdo sem nenhuma seção → Error pt-BR', () => {
    expect(() => parseDxf('banana')).toThrow('Arquivo DXF inválido')
  })

  it('entidade final truncada → mantém as anteriores sem lançar', () => {
    const s = dxf(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, 'A', 10, 0, 20, 0, 11, 1, 21, 1,
      0, 'CIRCLE', 8, 'B', 10, 2, 20, 2,
      // o raio (40) nunca chega — arquivo cortado no meio da entidade
    )
    const ents = parseDxf(s)
    expect(ents).toHaveLength(1)
    expect(ents[0].type).toBe('line')
    expect(ents[0].x2).toBeCloseTo(1, 9)
    expect(ents[0].layer).toBe('A')
  })
})
