import { columnHalfExtents, type Column, type Project, type Vec2 } from '@hyperframe/engine'

/**
 * Operações geométricas de conjunto do editor (issue #13): ponto de inserção
 * do pilar, mover, alinhar e distribuir. Funções puras sobre o projeto — o
 * store aplica o resultado em um único passo de desfazer.
 */

export interface GeoRef {
  kind: 'column' | 'beam' | 'slab' | 'wallLoad' | 'loadRegion' | 'mwall' | 'slabLoad'
  id: string
}

/**
 * Ponto da seção do pilar que fica sob o cursor na inserção (e que permanece
 * fixo quando a seção muda): centro, meio de uma face ou canto. As letras
 * seguem a planta: n = +Y, s = −Y, e = +X, w = −X.
 */
export type ColumnAnchor = 'c' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const COLUMN_ANCHORS: ColumnAnchor[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']

export const ANCHOR_LABEL: Record<ColumnAnchor, string> = {
  c: 'centro',
  n: 'face superior',
  s: 'face inferior',
  e: 'face direita',
  w: 'face esquerda',
  ne: 'canto superior direito',
  nw: 'canto superior esquerdo',
  se: 'canto inferior direito',
  sw: 'canto inferior esquerdo',
}

/** vetor do CENTRO do pilar até o ponto de ancoragem (m) */
export function anchorOffset(
  col: Pick<Column, 'section' | 'rotationDeg'>,
  anchor: ColumnAnchor,
): Vec2 {
  const he = columnHalfExtents(col)
  const sx = anchor.includes('e') ? 1 : anchor.includes('w') ? -1 : 0
  const sy = anchor.includes('n') ? 1 : anchor.includes('s') ? -1 : 0
  return { x: sx * he.dx, y: sy * he.dy }
}

/** centro do pilar para que o ponto de ancoragem caia em `point` */
export function centerFromAnchor(
  col: Pick<Column, 'section' | 'rotationDeg'>,
  anchor: ColumnAnchor,
  point: Vec2,
): Vec2 {
  const o = anchorOffset(col, anchor)
  return { x: point.x - o.x, y: point.y - o.y }
}

const has = (refs: GeoRef[], kind: GeoRef['kind'], id: string) =>
  refs.some((r) => r.kind === kind && r.id === id)

/**
 * Move um conjunto de elementos pelo mesmo deslocamento. Vértices de elementos
 * não selecionados que coincidem com os pontos movidos acompanham. Devolve
 * 'duplicate' se um pilar cairia sobre outro que fica parado.
 */
export function moveInProject(p: Project, refs: GeoRef[], delta: Vec2): Project | 'duplicate' {
  if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) return p
  const movedCols = p.columns.filter((c) => has(refs, 'column', c.id))
  // pilar não pode cair sobre outro que fica parado
  const collide = movedCols.some((c) =>
    p.columns.some(
      (o) =>
        !has(refs, 'column', o.id) &&
        Math.hypot(o.pos.x - (c.pos.x + delta.x), o.pos.y - (c.pos.y + delta.y)) < 0.05,
    ),
  )
  if (collide) return 'duplicate'
  // pontos que se movem: pilares (valem em todas as plantas) + vértices
  // dos elementos selecionados (valem na planta deles)
  const globalPts = movedCols.map((c) => c.pos)
  // arredonda ao micrômetro: alinhar por faces não deixa resíduo de ponto flutuante
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0
  const shift = (q: Vec2) => ({ x: r6(q.x + delta.x), y: r6(q.y + delta.y) })
  const plans = p.plans.map((pl) => {
    const pts = [
      ...globalPts,
      ...pl.beams.filter((b) => has(refs, 'beam', b.id)).flatMap((b) => b.path),
      ...pl.slabs.filter((x) => has(refs, 'slab', x.id)).flatMap((x) => x.polygon),
      ...pl.loadRegions.filter((r) => has(refs, 'loadRegion', r.id)).flatMap((r) => r.polygon),
    ]
    if (pts.length === 0 && !pl.slabLoads?.some((l) => has(refs, 'slabLoad', l.id))) return pl
    const near = (q: Vec2) => pts.some((m) => Math.hypot(q.x - m.x, q.y - m.y) < 0.02)
    const mv = (q: Vec2) => (near(q) ? shift(q) : q)
    return {
      ...pl,
      beams: pl.beams.map((b) => ({ ...b, path: b.path.map(mv) })),
      slabs: pl.slabs.map((x) => ({ ...x, polygon: x.polygon.map(mv) })),
      loadRegions: pl.loadRegions.map((r) => ({ ...r, polygon: r.polygon.map(mv) })),
      ...(pl.masonryWalls
        ? { masonryWalls: pl.masonryWalls.map((w) => ({ ...w, path: w.path.map(mv) })) }
        : {}),
      // cargas sobre laje: só as selecionadas se movem (não estão presas a vértices)
      ...(pl.slabLoads
        ? {
            slabLoads: pl.slabLoads.map((l) =>
              has(refs, 'slabLoad', l.id)
                ? { ...l, a: shift(l.a), ...(l.b ? { b: shift(l.b) } : {}) }
                : l,
            ),
          }
        : {}),
    }
  })
  return {
    ...p,
    columns: p.columns.map((c) => (has(refs, 'column', c.id) ? { ...c, pos: shift(c.pos) } : c)),
    plans,
  }
}

export interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const boxOf = (pts: Vec2[]): Box => ({
  minX: Math.min(...pts.map((q) => q.x)),
  maxX: Math.max(...pts.map((q) => q.x)),
  minY: Math.min(...pts.map((q) => q.y)),
  maxY: Math.max(...pts.map((q) => q.y)),
})

/**
 * Limites geométricos do elemento em planta: seção do pilar, viga com a sua
 * largura, contorno da região. null = elemento sem geometria própria que se
 * possa alinhar (laje, carga de parede) ou inexistente.
 */
export function elementBounds(p: Project, ref: GeoRef): Box | null {
  if (ref.kind === 'column') {
    const c = p.columns.find((x) => x.id === ref.id)
    if (!c) return null
    const he = columnHalfExtents(c)
    return {
      minX: c.pos.x - he.dx,
      maxX: c.pos.x + he.dx,
      minY: c.pos.y - he.dy,
      maxY: c.pos.y + he.dy,
    }
  }
  for (const pl of p.plans) {
    if (ref.kind === 'beam') {
      const b = pl.beams.find((x) => x.id === ref.id)
      if (!b) continue
      const pts: Vec2[] = []
      for (let i = 0; i + 1 < b.path.length; i++) {
        const a = b.path[i]
        const q = b.path[i + 1]
        const L = Math.hypot(q.x - a.x, q.y - a.y)
        if (L < 1e-9) continue
        const bw = (b.segmentSections?.[i] ?? b.section).bw
        const nx = (-(q.y - a.y) / L) * (bw / 2)
        const ny = ((q.x - a.x) / L) * (bw / 2)
        pts.push(
          { x: a.x + nx, y: a.y + ny },
          { x: a.x - nx, y: a.y - ny },
          { x: q.x + nx, y: q.y + ny },
          { x: q.x - nx, y: q.y - ny },
        )
      }
      return pts.length > 0 ? boxOf(pts) : null
    }
    if (ref.kind === 'loadRegion') {
      const r = pl.loadRegions.find((x) => x.id === ref.id)
      if (r) return boxOf(r.polygon)
    }
    if (ref.kind === 'slabLoad') {
      const l = pl.slabLoads?.find((x) => x.id === ref.id)
      if (l) return boxOf(l.b ? [l.a, l.b] : [l.a])
    }
  }
  return null
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'

export const ALIGN_LABEL: Record<AlignMode, string> = {
  left: 'à esquerda',
  right: 'à direita',
  top: 'pelo topo',
  bottom: 'pela base',
  centerX: 'centros na vertical',
  centerY: 'centros na horizontal',
}

const alignDelta = (mode: AlignMode, box: Box, anchor: Box): Vec2 => {
  switch (mode) {
    case 'left':
      return { x: anchor.minX - box.minX, y: 0 }
    case 'right':
      return { x: anchor.maxX - box.maxX, y: 0 }
    case 'top':
      return { x: 0, y: anchor.maxY - box.maxY }
    case 'bottom':
      return { x: 0, y: anchor.minY - box.minY }
    case 'centerX': // mesma abscissa de centro (os objetos ficam numa linha vertical)
      return { x: (anchor.minX + anchor.maxX) / 2 - (box.minX + box.maxX) / 2, y: 0 }
    case 'centerY': // mesma ordenada de centro (os objetos ficam numa linha horizontal)
      return { x: 0, y: (anchor.minY + anchor.maxY) / 2 - (box.minY + box.maxY) / 2 }
  }
}

/** pilares primeiro: o que eles arrastam (extremos de viga) já chega alinhado */
const ordered = (refs: GeoRef[]) => [
  ...refs.filter((r) => r.kind === 'column'),
  ...refs.filter((r) => r.kind !== 'column'),
]

export type GroupOpResult = { project: Project; moved: number } | 'duplicate' | 'none'

/**
 * Alinha os elementos pela ÂNCORA (que fica parada): cada elemento é deslocado
 * para que o seu limite geométrico coincida com o da âncora. Dimensões e
 * orientações são preservadas.
 */
export function alignInProject(
  p: Project,
  refs: GeoRef[],
  anchor: GeoRef,
  mode: AlignMode,
): GroupOpResult {
  if (!elementBounds(p, anchor)) return 'none'
  let cur = p
  let moved = 0
  for (const r of ordered(refs)) {
    if (r.kind === anchor.kind && r.id === anchor.id) continue
    // limites lidos do estado corrente: um pilar já movido pode ter arrastado este elemento
    const box = elementBounds(cur, r)
    const aBox = elementBounds(cur, anchor)
    if (!box || !aBox) continue
    const d = alignDelta(mode, box, aBox)
    if (Math.abs(d.x) < 1e-6 && Math.abs(d.y) < 1e-6) continue
    const next = moveInProject(cur, [r], d)
    if (next === 'duplicate') return 'duplicate'
    cur = next
    moved++
  }
  return moved > 0 ? { project: cur, moved } : 'none'
}

/**
 * Distribui os elementos com os CENTROS igualmente espaçados na direção
 * pedida; os dois extremos ficam parados (≥ 3 elementos).
 */
export function distributeInProject(p: Project, refs: GeoRef[], axis: 'x' | 'y'): GroupOpResult {
  const center = (b: Box) => (axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2)
  const items = refs
    .map((r) => ({ r, box: elementBounds(p, r) }))
    .filter((x): x is { r: GeoRef; box: Box } => x.box !== null)
    .sort((a, b) => center(a.box) - center(b.box))
  if (items.length < 3) return 'none'
  const c0 = center(items[0].box)
  const c1 = center(items[items.length - 1].box)
  const step = (c1 - c0) / (items.length - 1)
  const targets = new Map(items.map((it, i) => [`${it.r.kind}|${it.r.id}`, c0 + step * i]))
  let cur = p
  let moved = 0
  for (const r of ordered(items.slice(1, -1).map((x) => x.r))) {
    const box = elementBounds(cur, r)
    if (!box) continue
    const d = targets.get(`${r.kind}|${r.id}`)! - center(box)
    if (Math.abs(d) < 1e-6) continue
    const next = moveInProject(cur, [r], axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d })
    if (next === 'duplicate') return 'duplicate'
    cur = next
    moved++
  }
  return moved > 0 ? { project: cur, moved } : 'none'
}
