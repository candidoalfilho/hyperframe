import type { Slab, Vec2 } from '../model/types'
import { dist, polygonArea, projectOnSegment } from './geometry'

/** laje retangular? (4 vértices, lados opostos iguais, ângulos retos) */
export function isRectangular(poly: Vec2[]): boolean {
  if (poly.length !== 4) return false
  const l = [0, 1, 2, 3].map((i) => dist(poly[i], poly[(i + 1) % 4]))
  if (Math.abs(l[0] - l[2]) > 0.02 || Math.abs(l[1] - l[3]) > 0.02) return false
  const dot =
    (poly[1].x - poly[0].x) * (poly[2].x - poly[1].x) +
    (poly[1].y - poly[0].y) * (poly[2].y - poly[1].y)
  return Math.abs(dot) < 0.02 * l[0] * l[1]
}

/** borda contínua = outra laje divide ≥ 50% desta borda (colinear) */
export function edgeContinuous(a: Vec2, b: Vec2, others: Slab[]): boolean {
  const len = dist(a, b)
  if (len < 1e-6) return false
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
      const overlap = (Math.min(1, t2) - Math.max(0, t1)) * len
      if (overlap >= 0.5 * len) return true
    }
  }
  return false
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
