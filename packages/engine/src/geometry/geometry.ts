import type { Vec2 } from '../model/types'

export const EPS = 1e-6
/** tolerância geométrica de modelagem: 1 mm */
export const TOL = 1e-3

export function v2(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function norm(a: Vec2): Vec2 {
  const l = len(a)
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

export function samePoint(a: Vec2, b: Vec2, tol = TOL): boolean {
  return dist(a, b) <= tol
}

/** chave de hash de ponto com tolerância de 1 mm */
export function pointKey(p: Vec2): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
}

/** projeção do ponto p no segmento a-b → parâmetro t ∈ [0,1] e distância */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; d: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 < EPS * EPS) return { t: 0, d: dist(p, a) }
  let t = dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  const proj = add(a, scale(ab, t))
  return { t, d: dist(p, proj) }
}

/**
 * Interseção de segmentos a1-a2 e b1-b2 (incluindo extremidades).
 * Retorna o ponto ou null (paralelos/colineares tratados como sem interseção pontual).
 */
export function segIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1)
  const s = sub(b2, b1)
  const denom = cross(r, s)
  if (Math.abs(denom) < EPS) return null
  const t = cross(sub(b1, a1), s) / denom
  const u = cross(sub(b1, a1), r) / denom
  const tolT = TOL / Math.max(len(r), EPS)
  const tolU = TOL / Math.max(len(s), EPS)
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return null
  return add(a1, scale(r, Math.max(0, Math.min(1, t))))
}

/** área com sinal (positiva se CCW) — polígono sem repetir o primeiro ponto */
export function signedArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedArea(poly))
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < EPS) {
    // degenerado: média dos vértices
    const s = poly.reduce((acc, p) => add(acc, p), v2(0, 0))
    return scale(s, 1 / Math.max(1, poly.length))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]
    const pj = poly[j]
    const intersects =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
    if (intersects) inside = !inside
  }
  return inside
}

export function bbox(points: Vec2[]): { min: Vec2; max: Vec2 } {
  const min = v2(Infinity, Infinity)
  const max = v2(-Infinity, -Infinity)
  for (const p of points) {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
  }
  return { min, max }
}

export interface Segment {
  a: Vec2
  b: Vec2
}

/**
 * Divide um conjunto de segmentos em sub-segmentos em todos os pontos de
 * interseção mútua (e em pontos extras fornecidos que caiam sobre eles).
 */
export function splitSegments(segments: Segment[], extraPoints: Vec2[] = []): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const L = dist(seg.a, seg.b)
    if (L < TOL) continue
    const cuts: number[] = [0, 1]
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const p = segIntersection(seg.a, seg.b, segments[j].a, segments[j].b)
      if (p) {
        const { t } = projectOnSegment(p, seg.a, seg.b)
        cuts.push(t)
      }
    }
    for (const p of extraPoints) {
      const { t, d } = projectOnSegment(p, seg.a, seg.b)
      if (d <= TOL) cuts.push(t)
    }
    cuts.sort((x, y) => x - y)
    for (let k = 0; k + 1 < cuts.length; k++) {
      const t0 = cuts[k]
      const t1 = cuts[k + 1]
      if ((t1 - t0) * L < TOL) continue
      out.push({
        a: add(seg.a, scale(sub(seg.b, seg.a), t0)),
        b: add(seg.a, scale(sub(seg.b, seg.a), t1)),
      })
    }
  }
  return out
}
