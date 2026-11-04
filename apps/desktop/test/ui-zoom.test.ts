import { describe, expect, it } from 'vitest'
import { cssPxScale, eventPoint } from '../src/ui/zoom'

/** elemento fake: 800×600 px CSS, desenhado com zoom da UI de 1,3 e deslocado na tela */
function fakeEl(zoom: number): Element {
  return {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      width: 800 * zoom,
      height: 600 * zoom,
    }),
  } as unknown as Element
}

describe('compensação do zoom da UI (CSS zoom no body)', () => {
  it('sem zoom: ponto do evento = clientXY − canto do rect', () => {
    const el = fakeEl(1)
    expect(cssPxScale(el)).toBe(1)
    expect(eventPoint(el, { clientX: 500, clientY: 350 })).toEqual({ x: 400, y: 300 })
  })

  it('com zoom 1,3: converte px visuais em px CSS do elemento', () => {
    const el = fakeEl(1.3)
    expect(cssPxScale(el)).toBeCloseTo(1 / 1.3, 12)
    // cursor no centro visual do elemento (100 + 1040/2 = 620; 50 + 780/2 = 440)
    const p = eventPoint(el, { clientX: 620, clientY: 440 })
    expect(p.x).toBeCloseTo(400, 9)
    expect(p.y).toBeCloseTo(300, 9)
  })

  it('com zoom 0,8 (reduzido) também corrige', () => {
    const el = fakeEl(0.8)
    const p = eventPoint(el, { clientX: 100 + 640 * 0.8, clientY: 50 + 480 * 0.8 })
    expect(p.x).toBeCloseTo(640, 9)
    expect(p.y).toBeCloseTo(480, 9)
  })

  it('rect degenerado (display:none) não divide por zero', () => {
    const el = {
      clientWidth: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    } as unknown as Element
    expect(cssPxScale(el)).toBe(1)
  })
})
