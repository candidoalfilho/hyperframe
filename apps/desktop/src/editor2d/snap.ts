import {
  dist,
  projectOnSegment,
  type Beam,
  type Column,
  type Grid,
  type Vec2,
} from '@hyperframe/engine'

/**
 * Snapping do editor 2D — candidatos em ordem de prioridade:
 *  1. interseções de eixos da grelha (xAxes × yAxes)
 *  2. centros de pilares
 *  3. vértices de caminhos de viga
 *  4. pontos médios de trechos de viga
 *  5. projeção sobre linhas de eixo
 *  6. projeção sobre trechos de viga
 */
export type SnapKind = 'intersection' | 'column' | 'endpoint' | 'midpoint' | 'axis' | 'online'

export interface SnapResult {
  point: Vec2
  kind: SnapKind
}

interface Seg {
  a: Vec2
  b: Vec2
}

export interface SnapData {
  xs: number[]
  ys: number[]
  intersections: Vec2[]
  columns: Vec2[]
  endpoints: Vec2[]
  midpoints: Vec2[]
  segments: Seg[]
}

/** arredonda para múltiplo de 0,05 m */
export function round05(v: number): number {
  return Math.round(v * 20) / 20
}

export function roundPoint05(p: Vec2): Vec2 {
  return { x: round05(p.x), y: round05(p.y) }
}

export function buildSnapData(grid: Grid, columns: Column[], beams: Beam[]): SnapData {
  const xs = grid.xAxes.map((a) => a.pos)
  const ys = grid.yAxes.map((a) => a.pos)
  const intersections: Vec2[] = []
  for (const x of xs) for (const y of ys) intersections.push({ x, y })

  const endpoints: Vec2[] = []
  const midpoints: Vec2[] = []
  const segments: Seg[] = []
  for (const b of beams) {
    for (const p of b.path) endpoints.push(p)
    for (let i = 0; i + 1 < b.path.length; i++) {
      const a = b.path[i]
      const c = b.path[i + 1]
      midpoints.push({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 })
      segments.push({ a, b: c })
    }
  }
  return {
    xs,
    ys,
    intersections,
    columns: columns.map((c) => c.pos),
    endpoints,
    midpoints,
    segments,
  }
}

function nearestPoint(raw: Vec2, pts: Vec2[], tol: number): Vec2 | null {
  let best: Vec2 | null = null
  let bestD = tol
  for (const p of pts) {
    const d = dist(raw, p)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/** melhor snap dentro da tolerância (m). Classes em ordem de prioridade; na classe, o mais próximo. */
export function computeSnap(raw: Vec2, data: SnapData, tol: number): SnapResult | null {
  const inter = nearestPoint(raw, data.intersections, tol)
  if (inter) return { point: inter, kind: 'intersection' }

  const col = nearestPoint(raw, data.columns, tol)
  if (col) return { point: col, kind: 'column' }

  const end = nearestPoint(raw, data.endpoints, tol)
  if (end) return { point: end, kind: 'endpoint' }

  const mid = nearestPoint(raw, data.midpoints, tol)
  if (mid) return { point: mid, kind: 'midpoint' }

  // projeção sobre linhas de eixo (coordenada livre arredondada a 0,05 m)
  let axis: Vec2 | null = null
  let axisD = tol
  for (const x of data.xs) {
    const d = Math.abs(raw.x - x)
    if (d <= axisD) {
      axis = { x, y: round05(raw.y) }
      axisD = d
    }
  }
  for (const y of data.ys) {
    const d = Math.abs(raw.y - y)
    if (d <= axisD) {
      axis = { x: round05(raw.x), y }
      axisD = d
    }
  }
  if (axis) return { point: axis, kind: 'axis' }

  // projeção sobre trechos de viga
  let onl: Vec2 | null = null
  let onlD = tol
  for (const s of data.segments) {
    const { t, d } = projectOnSegment(raw, s.a, s.b)
    if (d <= onlD) {
      onl = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
      onlD = d
    }
  }
  if (onl) return { point: onl, kind: 'online' }

  return null
}
