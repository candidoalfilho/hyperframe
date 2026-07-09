import type { Vec2 } from '../model/types'
import { polygonArea, signedArea } from './geometry'

/**
 * Recorte de polígono por semiplano (Sutherland–Hodgman) e interseção de
 * polígonos convexos — usado na integração de seções (flexo-compressão
 * oblíqua) e na sobreposição de regiões de carga com lajes.
 */

/** mantém a parte do polígono onde n·p ≤ c (semiplano) */
export function clipHalfPlane(poly: Vec2[], n: Vec2, c: number): Vec2[] {
  if (poly.length === 0) return []
  const out: Vec2[] = []
  const inside = (p: Vec2) => n.x * p.x + n.y * p.y <= c + 1e-12
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ia = inside(a)
    const ib = inside(b)
    if (ia) out.push(a)
    if (ia !== ib) {
      const da = n.x * a.x + n.y * a.y - c
      const db = n.x * b.x + n.y * b.y - c
      const t = da / (da - db)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** interseção A ∩ B com B CONVEXO (Sutherland–Hodgman clip de A pelas bordas de B) */
export function clipPolygon(subject: Vec2[], convexClip: Vec2[]): Vec2[] {
  // garante orientação CCW do clip
  let clip = convexClip
  if (signedArea(clip) < 0) clip = [...clip].reverse()
  let out = subject
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    // borda a→b, interior à esquerda (CCW): n·p ≤ c com n = normal direita
    const n = { x: b.y - a.y, y: -(b.x - a.x) }
    const c = n.x * a.x + n.y * a.y
    out = clipHalfPlane(out, n, c)
  }
  return out
}

/** área da interseção A ∩ B (B convexo) */
export function overlapArea(a: Vec2[], convexB: Vec2[]): number {
  const clipped = clipPolygon(a, convexB)
  return clipped.length >= 3 ? polygonArea(clipped) : 0
}

/** área e centroide de um polígono (retorna área 0 p/ degenerado) */
export function areaCentroid(poly: Vec2[]): { area: number; cx: number; cy: number } {
  if (poly.length < 3) return { area: 0, cx: 0, cy: 0 }
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  a /= 2
  if (Math.abs(a) < 1e-12) return { area: 0, cx: 0, cy: 0 }
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) }
}
