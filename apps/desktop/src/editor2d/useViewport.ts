import { useEffect, useState, type RefObject } from 'react'
import type { Vec2 } from '@hyperframe/engine'

/**
 * Viewport 2D do editor de planta.
 *  - mundo: metros, +y para CIMA (norte)
 *  - tela:  pixels, +y para baixo
 *  - k  = escala (px por metro)
 *  - (ox, oy) = posição em px da origem do mundo dentro do canvas
 */
export interface Viewport {
  k: number
  ox: number
  oy: number
}

export interface Size {
  w: number
  h: number
}

export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const MIN_SCALE = 4
export const MAX_SCALE = 400

export function clampScale(k: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k))
}

/** mundo (m, +y↑) → tela (px, +y↓) */
export function worldToScreen(vp: Viewport, p: Vec2): Vec2 {
  return { x: vp.ox + p.x * vp.k, y: vp.oy - p.y * vp.k }
}

/** tela (px) → mundo (m) */
export function screenToWorld(vp: Viewport, s: Vec2): Vec2 {
  return { x: (s.x - vp.ox) / vp.k, y: (vp.oy - s.y) / vp.k }
}

/** zoom multiplicativo mantendo fixo o ponto de tela `s` (cursor) */
export function zoomAt(vp: Viewport, s: Vec2, factor: number): Viewport {
  const k = clampScale(vp.k * factor)
  if (k === vp.k) return vp
  const r = k / vp.k
  return { k, ox: s.x - (s.x - vp.ox) * r, oy: s.y - (s.y - vp.oy) * r }
}

/** enquadra o retângulo de mundo `b` no canvas com margem em px */
export function fitBounds(size: Size, b: WorldBounds, marginPx = 48): Viewport {
  const dx = Math.max(b.maxX - b.minX, 0.001)
  const dy = Math.max(b.maxY - b.minY, 0.001)
  const availW = Math.max(size.w - 2 * marginPx, 40)
  const availH = Math.max(size.h - 2 * marginPx, 40)
  const k = clampScale(Math.min(availW / dx, availH / dy))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { k, ox: size.w / 2 - cx * k, oy: size.h / 2 + cy * k }
}

/** tamanho do container (via ResizeObserver) + estado do viewport */
export function useViewport(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [vp, setVp] = useState<Viewport>({ k: 60, ox: 120, oy: 480 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return { size, vp, setVp }
}
