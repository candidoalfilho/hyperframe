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
