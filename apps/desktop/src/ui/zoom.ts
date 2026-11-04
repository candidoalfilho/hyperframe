/**
 * Zoom da INTERFACE (persistido por máquina). Usado pelos atalhos ⌘+/⌘−/⌘0
 * e pelo modo apresentação — útil em projetores e telas de alta densidade.
 */

const KEY = 'hyperframe-ui-zoom'

/** zoom do modo apresentação */
export const PRESENT_ZOOM = 1.3

export function getUiZoom(): number {
  return Number(localStorage.getItem(KEY) ?? '1') || 1
}

export function applyUiZoom(z: number): void {
  ;(document.body.style as unknown as { zoom: string }).zoom = z === 1 ? '' : String(z)
}

export function setUiZoom(z: number): void {
  const clamped = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10))
  localStorage.setItem(KEY, String(clamped))
  applyUiZoom(clamped)
  window.dispatchEvent(new CustomEvent('hf-ui-zoom', { detail: clamped }))
}

/**
 * Fator que converte px visuais (clientX/getBoundingClientRect) em px CSS do
 * elemento. Com o zoom da UI ativo o rect vem multiplicado pelo zoom, mas o
 * sistema de coordenadas interno (SVG/clientWidth) não — sem essa correção o
 * hit-test e o pan ficam deslocados proporcionalmente ao zoom.
 */
export function cssPxScale(el: Element, rect?: DOMRect): number {
  const r = rect ?? el.getBoundingClientRect()
  return r.width > 0 && el.clientWidth > 0 ? el.clientWidth / r.width : 1
}

/** Ponto do evento em px CSS do elemento (compensa o zoom da UI). */
export function eventPoint(
  el: Element,
  e: { clientX: number; clientY: number },
): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const k = cssPxScale(el, r)
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }
}
