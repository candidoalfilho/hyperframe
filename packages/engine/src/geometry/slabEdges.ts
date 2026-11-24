import type { Slab, Vec2 } from '../model/types'
import { dist, polygonArea, projectOnSegment } from './geometry'

/**
 * Remove vértices COLINEARES do contorno (ex.: o nó que uma viga em "T" deixa
 * no meio da borda da laje). O resultado começa no vértice mantido que abre a
 * borda original 0, então a 1ª borda simplificada é paralela à 1ª original.
 * `edgeMap[e]` = índice da borda simplificada que contém a borda original e.
 */
export function simplifyPolygonMap(
  poly: Vec2[],
  tol = 0.02,
): { polygon: Vec2[]; edgeMap: number[] } {
  const n = poly.length
  const identity = { polygon: poly, edgeMap: poly.map((_, i) => i) }
  if (n <= 3) return identity
  const keep = poly.map((b, i) => {
    const a = poly[(i - 1 + n) % n]
    const c = poly[(i + 1) % n]
    const acx = c.x - a.x
    const acy = c.y - a.y
    const lac = Math.hypot(acx, acy)
    if (lac < 1e-9) return true
    const off = Math.abs((b.x - a.x) * acy - (b.y - a.y) * acx) / lac
    const between = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0
    return !(off <= tol && between)
  })
  const nKept = keep.filter(Boolean).length
  if (nKept === n || nKept < 3) return identity
  // vértice mantido em que começa a borda simplificada que contém a borda 0
  let start = 0
  while (!keep[start]) start = (start - 1 + n) % n
  const polygon: Vec2[] = []
  const edgeMap = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (keep[i]) polygon.push(poly[i])
    edgeMap[i] = polygon.length - 1
  }
  return { polygon, edgeMap }
}

export function simplifyPolygon(poly: Vec2[], tol = 0.02): Vec2[] {
  return simplifyPolygonMap(poly, tol).polygon
}

/** laje retangular? (4 cantos após descartar vértices colineares, ângulos retos) */
export function isRectangular(polygon: Vec2[]): boolean {
  const poly = simplifyPolygon(polygon)
  if (poly.length !== 4) return false
  const l = [0, 1, 2, 3].map((i) => dist(poly[i], poly[(i + 1) % 4]))
  if (Math.abs(l[0] - l[2]) > 0.02 || Math.abs(l[1] - l[3]) > 0.02) return false
  const dot =
    (poly[1].x - poly[0].x) * (poly[2].x - poly[1].x) +
    (poly[1].y - poly[0].y) * (poly[2].y - poly[1].y)
  return Math.abs(dot) < 0.02 * l[0] * l[1]
}

/**
 * borda contínua = lajes vizinhas dividem ≥ 50% desta borda (colineares).
 * A sobreposição é SOMADA entre vizinhas e entre os trechos de cada uma (uma
 * borda pode fazer divisa com duas lajes, ou com uma laje de borda subdividida).
 */
export function edgeContinuous(a: Vec2, b: Vec2, others: Slab[]): boolean {
  const len = dist(a, b)
  if (len < 1e-6) return false
  let total = 0
  for (const other of others) {
    const poly = other.polygon
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]
      const d = poly[(i + 1) % poly.length]
      // colinearidade: extremos do outro segmento à distância ≤ tol da reta ab
      const p1 = projectOnSegment(c, a, b)
      const p2 = projectOnSegment(d, a, b)
      if (p1.d > 0.02 || p2.d > 0.02) continue
      const t1 = Math.min(p1.t, p2.t)
      const t2 = Math.max(p1.t, p2.t)
      total += Math.max(0, Math.min(1, t2) - Math.max(0, t1)) * len
    }
  }
  return total >= 0.5 * len - 1e-9
}

/**
 * Quinhões de laje UNIDIRECIONAL (nervuras/vigotas ∥ ao eixo global `axis`):
 * cada faixa de nervura descarrega só nas duas bordas que ela encontra —
 * metade em cada, ou 5/8 no extremo engastado e 3/8 no apoiado quando só um
 * lado tem continuidade (`fixedEdge`). Bordas paralelas às nervuras recebem 0.
 * Integração numérica por faixas (vale p/ polígonos não convexos); o total é
 * normalizado à área do polígono.
 */
export function oneWayTributaryAreas(
  polygon: Vec2[],
  axis: 'x' | 'y',
  fixedEdge?: (edgeIndex: number) => boolean,
): number[] {
  const n = polygon.length
  const shares = new Array<number>(n).fill(0)
  // u = coordenada ao longo das nervuras · t = transversal
  const u = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const t = (p: Vec2) => (axis === 'x' ? p.y : p.x)
  let tMin = Infinity
  let tMax = -Infinity
  for (const p of polygon) {
    tMin = Math.min(tMin, t(p))
    tMax = Math.max(tMax, t(p))
  }
  const STRIPS = 400
  const dt = (tMax - tMin) / STRIPS
  if (!(dt > 0)) return shares
  for (let s = 0; s < STRIPS; s++) {
    const tt = tMin + (s + 0.5) * dt
    const hits: { u: number; edge: number }[] = []
    for (let e = 0; e < n; e++) {
      const a = polygon[e]
      const b = polygon[(e + 1) % n]
      const ta = t(a)
      const tb = t(b)
      if ((ta - tt) * (tb - tt) >= 0) continue // não cruza (ou paralela)
      const k = (tt - ta) / (tb - ta)
      hits.push({ u: u(a) + k * (u(b) - u(a)), edge: e })
    }
    hits.sort((p, q) => p.u - q.u)
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const h0 = hits[i]
      const h1 = hits[i + 1]
      const stripArea = (h1.u - h0.u) * dt
      const f0 = fixedEdge?.(h0.edge) ?? false
      const f1 = fixedEdge?.(h1.edge) ?? false
      const s0 = f0 && !f1 ? 0.625 : !f0 && f1 ? 0.375 : 0.5
      shares[h0.edge] += s0 * stripArea
      shares[h1.edge] += (1 - s0) * stripArea
    }
  }
  const sum = shares.reduce((acc, v) => acc + v, 0)
  const total = polygonArea(polygon)
  return sum > 1e-12 ? shares.map((v) => (v * total) / sum) : shares
}

/**
 * Vãos das faixas de nervura/vigota ∥ `axis` dentro do polígono (cordas):
 * maior, menor e médio ponderado pela largura. Vale p/ painéis não retangulares.
 */
export function oneWaySpanStats(
  polygon: Vec2[],
  axis: 'x' | 'y',
): { max: number; min: number; mean: number } {
  const n = polygon.length
  const u = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const t = (p: Vec2) => (axis === 'x' ? p.y : p.x)
  let tMin = Infinity
  let tMax = -Infinity
  for (const p of polygon) {
    tMin = Math.min(tMin, t(p))
    tMax = Math.max(tMax, t(p))
  }
  const STRIPS = 400
  const dt = (tMax - tMin) / STRIPS
  let max = 0
  let min = Infinity
  let sum = 0
  let count = 0
  if (!(dt > 0)) return { max: 0, min: 0, mean: 0 }
  for (let s = 0; s < STRIPS; s++) {
    const tt = tMin + (s + 0.5) * dt
    const hits: number[] = []
    for (let e = 0; e < n; e++) {
      const a = polygon[e]
      const b = polygon[(e + 1) % n]
      if ((t(a) - tt) * (t(b) - tt) >= 0) continue
      const k = (tt - t(a)) / (t(b) - t(a))
      hits.push(u(a) + k * (u(b) - u(a)))
    }
    hits.sort((p, q) => p - q)
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const chord = hits[i + 1] - hits[i]
      if (chord < 0.05) continue
      max = Math.max(max, chord)
      min = Math.min(min, chord)
      sum += chord
      count++
    }
  }
  return count > 0 ? { max, min, mean: sum / count } : { max: 0, min: 0, mean: 0 }
}
