import {
  dimDirection,
  dimRefAt,
  dimensionLayout,
  projectOnSegment,
  type DimStyle,
  type Dimension,
  type FloorPlan,
  type Project,
  type Vec2,
} from '@hyperframe/engine'

/**
 * Ferramenta Cota (issue #10) — regras puras do gesto: direção da cota linear,
 * afastamento da linha pelo cursor, montagem da cota a partir dos cliques e
 * acerto (hit-test) de uma cota existente.
 */

export type NewDimension = Omit<Dimension, 'id' | 'name'>

/** altura do texto no editor: a do estilo, mas sempre legível (9,5–14 px) — em metros */
export function dimTextHeight(style: DimStyle, k: number): number {
  return Math.min(14, Math.max(9.5, style.textHeight * k)) / Math.max(k, 1e-9)
}

/**
 * Cota linear: horizontal ou vertical conforme o lado para onde a linha é
 * puxada (como no DIMLINEAR do CAD). Sem cursor, pela maior extensão dos pontos.
 */
export function linearDirFor(points: Vec2[], cursor: Vec2 | null): 'h' | 'v' {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (!cursor) return maxX - minX >= maxY - minY ? 'h' : 'v'
  const outX = Math.max(minX - cursor.x, cursor.x - maxX, 0)
  const outY = Math.max(minY - cursor.y, cursor.y - maxY, 0)
  if (outX === 0 && outY === 0) return maxX - minX >= maxY - minY ? 'h' : 'v'
  return outY >= outX ? 'h' : 'v'
}

/** afastamento (com sinal) que põe a linha de cota passando pelo cursor */
export function dimOffsetAt(dim: Pick<Dimension, 'dir' | 'points'>, cursor: Vec2): number {
  const u = dimDirection(dim)
  const p0 = dim.points[0].p
  const off = (cursor.x - p0.x) * -u.y + (cursor.y - p0.y) * u.x
  return Math.round(off * 1e4) / 1e4
}

export interface DimPickState {
  /** pontos já clicados */
  points: Vec2[]
  /** cursor (com snap) */
  cursor: Vec2 | null
  /** pontos concluídos: o próximo clique posiciona a linha de cota */
  placing: boolean
  mode: 'linear' | 'aligned'
  form: 'single' | 'chain' | 'baseline'
  total: boolean
  /** prende os pontos aos elementos do modelo */
  assoc: boolean
}

/**
 * Cota correspondente ao estado do gesto (prévia e criação). Antes de posicionar
 * a linha, o cursor conta como o próximo ponto e o afastamento é o padrão.
 * null = ainda não há dois pontos distintos.
 */
export function dimFromPicks(
  st: DimPickState,
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'> | null,
): NewDimension | null {
  const pts = [...st.points]
  if (!st.placing && st.cursor) {
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(last.x - st.cursor.x, last.y - st.cursor.y) > 1e-6) pts.push(st.cursor)
  }
  if (pts.length < 2) return null
  const dir: Dimension['dir'] =
    st.mode === 'aligned' ? 'aligned' : linearDirFor(pts, st.placing ? st.cursor : null)
  const points = pts.map((p) => {
    const ref = st.assoc ? dimRefAt(project, plan, p) : null
    return ref ? { p: { x: p.x, y: p.y }, ref } : { p: { x: p.x, y: p.y } }
  })
  const base = { dir, points }
  const offset =
    st.placing && st.cursor ? dimOffsetAt(base, st.cursor) : dir === 'h' ? -0.8 : 0.8
  return {
    ...base,
    form: st.form === 'baseline' ? 'baseline' : 'chain',
    offset,
    ...(st.total && st.form === 'chain' && points.length > 2 ? { total: true } : {}),
  }
}

/** cota sob o ponto: perto de uma linha de cota ou de um dos textos */
export function dimensionAt(
  p: Vec2,
  dims: Dimension[],
  style: DimStyle,
  k: number,
): Dimension | null {
  const h = dimTextHeight(style, k)
  const tol = Math.max(6 / k, 0.04)
  let best: Dimension | null = null
  let bestD = Infinity
  for (const d of dims) {
    if (d.points.length < 2) continue
    const lay = dimensionLayout(d, style, h)
    let dist = Infinity
    for (const l of lay.lines) {
      if (l.role !== 'dim') continue
      dist = Math.min(dist, projectOnSegment(p, l.a, l.b).d)
    }
    for (const t of lay.labels) {
      // caixa aproximada do texto: meia largura ao longo da leitura
      const half = Math.max(t.text.length * 0.31 * h, h)
      const a = (t.angleDeg * Math.PI) / 180
      const cx = t.align === 'center' ? 0 : t.align === 'left' ? half : -half
      const c = { x: t.x + Math.cos(a) * cx, y: t.y + Math.sin(a) * cx }
      const along = Math.abs((p.x - c.x) * Math.cos(a) + (p.y - c.y) * Math.sin(a))
      const across = Math.abs(-(p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) - 0.35 * h)
      if (along <= half && across <= 0.7 * h) dist = Math.min(dist, 0)
    }
    if (dist <= tol && dist < bestD) {
      best = d
      bestD = dist
    }
  }
  return best
}
