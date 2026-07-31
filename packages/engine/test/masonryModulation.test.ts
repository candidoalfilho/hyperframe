import { describe, expect, it } from 'vitest'
import { modulateWall, lintelLength, BLOCK } from '../src/nbr/nbr16868/modulation'
import { buildMasonryElevationDrawing } from '../src/drawing/masonryElevation'
import { createSampleProject } from '../src/model/factory'

// Parede 4,00 m × pé-direito 2,80: 20 módulos M-20 · 14 fiadas.
// Fiada A: 10 inteiros · Fiada B: meio + 9 inteiros + meio.
describe('modulateWall (família 14/19, M-20)', () => {
  it('âncora 4,00×2,80: 20 módulos, 14 fiadas, amarração A/B correta', () => {
    const m = modulateWall(4.0, 2.8)
    expect(m.halfModules).toBe(20)
    expect(m.leftover).toBeLessThan(0.015)
    expect(m.fiadaA).toEqual({ inteiro: 10, meio: 0 })
    expect(m.fiadaB).toEqual({ inteiro: 9, meio: 2 })
    expect(m.rows).toBe(14)
    // 7 fiadas A + 7 B; última (B) vira canaleta
    expect(m.totals.inteiro).toBe(10 * 7 + 9 * 7 - 9)
    expect(m.totals.meio).toBe(2 * 7 - 2)
    expect(m.totals.canaleta).toBe(9)
    expect(m.totals.canaletaMeia).toBe(2)
    expect(m.notes.join(' ')).toMatch(/CANALETA/i)
  })
  it('comprimento ímpar em módulos: 3,00 m ⇒ 15 módulos, fiada A com meio', () => {
    const m = modulateWall(3.0, 2.8)
    expect(m.halfModules).toBe(15)
    expect(m.fiadaA).toEqual({ inteiro: 7, meio: 1 })
    expect(m.fiadaB).toEqual({ inteiro: 7, meio: 1 })
  })
  it('não modular avisa ajuste; verga = vão + 60 cm', () => {
    const m = modulateWall(3.27, 2.8)
    expect(m.notes.join(' ')).toMatch(/NÃO modular/i)
    expect(lintelLength(1.2)).toBeCloseTo(1.8, 9)
    expect(BLOCK.module).toBeCloseTo(0.4, 9)
  })
})

describe('buildMasonryElevationDrawing', () => {
  it('elevação com fiadas, verga da porta e quadro de blocos', () => {
    const project = createSampleProject()
    const d = buildMasonryElevationDrawing(project, {
      id: 'mw1',
      name: 'PAR1',
      path: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      thickness: 0.14,
      block: 'concreto',
      fpk: 6000,
      openings: [{ x: 2, width: 0.8 }],
    })
    expect(d.title).toContain('PAR1')
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.some((t) => t.startsWith('VERGA 1'))).toBe(true)
    expect(texts.some((t) => t.includes('QUADRO DE BLOCOS'))).toBe(true)
    expect(texts.some((t) => t.includes('módulos M-20'))).toBe(true)
    // blocos desenhados (muitos retângulos) e recorte da porta reduz a contagem
    const nBlocks = d.primitives.filter((p) => p.kind === 'polyline' && (p.layer === 'LAJES' || p.layer === 'ARMADURA')).length
    expect(nBlocks).toBeGreaterThan(80)
  })
})
