import {
  columnHalfExtents,
  pointInPolygon,
  projectOnSegment,
  type Beam,
  type Column,
  type ElementRef,
  type LoadRegion,
  type Slab,
  type SlabLoad,
  type Vec2,
  type WallLoad,
} from '@hyperframe/engine'

/** menor distância do ponto a uma polilinha */
export function distToPath(p: Vec2, path: Vec2[]): number {
  let m = Infinity
  for (let i = 0; i + 1 < path.length; i++) {
    m = Math.min(m, projectOnSegment(p, path[i], path[i + 1]).d)
  }
  return m
}

/** viga mais próxima do ponto dentro da tolerância (m) */
export function nearestBeam(p: Vec2, beams: Beam[], tol: number): Beam | null {
  let best: Beam | null = null
  let bestD = tol
  for (const b of beams) {
    const d = distToPath(p, b.path)
    if (d <= bestD) {
      best = b
      bestD = d
    }
  }
  return best
}

export interface HitContext {
  columns: Column[]
  beams: Beam[]
  slabs: Slab[]
  wallLoads: WallLoad[]
  loadRegions: LoadRegion[]
  /** cargas concentradas/lineares sobre lajes */
  slabLoads?: SlabLoad[]
  showLoads: boolean
  showSlabs: boolean
  /** px por metro — p/ tolerância mínima de 8 px nas vigas */
  k: number
}

/** posição ao longo da polilinha (arco, m) do ponto mais próximo de p */
function arcAt(p: Vec2, path: Vec2[]): number {
  let best = Infinity
  let arc = 0
  let acc = 0
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const pr = projectOnSegment(p, a, b)
    if (pr.d < best) {
      best = pr.d
      arc = acc + Math.min(Math.max(pr.t, 0), 1) * len
    }
    acc += len
  }
  return arc
}

/** carga de parede da viga `beamId` cujo trecho carregado contém o ponto clicado */
export function wallLoadOnBeamAt(p: Vec2, ctx: HitContext, beamId: string): WallLoad | null {
  if (!ctx.showLoads) return null
  const beam = ctx.beams.find((b) => b.id === beamId)
  if (!beam) return null
  const s = arcAt(p, beam.path)
  const onBeam = ctx.wallLoads.filter((w) => w.beamId === beamId)
  return (
    onBeam.find((w) => s >= (w.x0 ?? -Infinity) - 0.05 && s <= (w.x1 ?? Infinity) + 0.05) ??
    onBeam[0] ??
    null
  )
}

/**
 * hit-test com prioridade: pilares > cargas sobre laje > regiões de carga > vigas > cargas de
 * parede > lajes. A VIGA vem antes da carga de parede desenhada sobre ela —
 * a carga é alcançada clicando ao lado da viga (rótulo) ou clicando de novo
 * na viga já selecionada (ver Editor2D) e pelo painel da viga.
 */
export function hitTest(p: Vec2, ctx: HitContext): ElementRef | null {
  // pilares — caixa envolvente expandida 0,15 m
  for (let i = ctx.columns.length - 1; i >= 0; i--) {
    const c = ctx.columns[i]
    const ext = columnHalfExtents(c)
    const hx = ext.dx + 0.15
    const hy = ext.dy + 0.15
    if (Math.abs(p.x - c.pos.x) <= hx && Math.abs(p.y - c.pos.y) <= hy) {
      return { kind: 'column', id: c.id }
    }
  }

  // cargas sobre laje — marcador pequeno: antes das regiões e das vigas
  if (ctx.showLoads) {
    const tol = Math.max(0.12, 9 / ctx.k)
    let best: SlabLoad | null = null
    let bestD = tol
    for (const l of ctx.slabLoads ?? []) {
      const d = l.b ? projectOnSegment(p, l.a, l.b).d : Math.hypot(p.x - l.a.x, p.y - l.a.y)
      if (d <= bestD) {
        best = l
        bestD = d
      }
    }
    if (best) return { kind: 'slabLoad', id: best.id }
  }

  // regiões de carga — pequenas e desenhadas sobre lajes: antes das vigas (só se visíveis)
  if (ctx.showLoads) {
    for (let i = ctx.loadRegions.length - 1; i >= 0; i--) {
      const rg = ctx.loadRegions[i]
      if (pointInPolygon(p, rg.polygon)) return { kind: 'loadRegion', id: rg.id }
    }
  }

  // vigas — distância ao caminho < max(bw/2 + 0,1, 8px/zoom)
  let bestBeam: Beam | null = null
  let bestBeamD = Infinity
  for (const b of ctx.beams) {
    const tol = Math.max(b.section.bw / 2 + 0.1, 8 / ctx.k)
    const d = distToPath(p, b.path)
    if (d <= tol && d < bestBeamD) {
      bestBeam = b
      bestBeamD = d
    }
  }
  if (bestBeam) return { kind: 'beam', id: bestBeam.id }

  // cargas de parede — faixa ao lado da viga hospedeira (rótulo), até 0,45 m
  if (ctx.showLoads && ctx.wallLoads.length > 0) {
    const byId = new Map(ctx.beams.map((b) => [b.id, b]))
    let best: WallLoad | null = null
    let bestD = Math.max(0.45, 22 / ctx.k)
    for (const wl of ctx.wallLoads) {
      const beam = byId.get(wl.beamId)
      if (!beam) continue
      const d = distToPath(p, beam.path)
      if (d <= bestD) {
        best = wl
        bestD = d
      }
    }
    if (best) return { kind: 'wallLoad', id: best.id }
  }

  // lajes — ponto dentro do polígono (só se visíveis)
  if (ctx.showSlabs) {
    for (const sl of ctx.slabs) {
      if (pointInPolygon(p, sl.polygon)) return { kind: 'slab', id: sl.id }
    }
  }

  return null
}

export interface WorldRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const inRect = (p: Vec2, r: WorldRect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1

/** segmento ab cruza (ou está dentro de) o retângulo? */
function segHitsRect(a: Vec2, b: Vec2, r: WorldRect): boolean {
  if (inRect(a, r) || inRect(b, r)) return true
  const corners = [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ]
  const ccw = (p: Vec2, q: Vec2, s: Vec2) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x)
  for (let i = 0; i < 4; i++) {
    const c = corners[i]
    const d = corners[(i + 1) % 4]
    if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return true
  }
  return false
}

/**
 * Seleção por janela, como no CAD: arrastando da esquerda p/ a direita
 * (`crossing` = false) entra só o que está INTEIRO dentro; da direita p/ a
 * esquerda (`crossing` = true) entra também o que a janela toca. Lajes e
 * regiões só entram inteiras; cargas de parede acompanham a viga.
 */
export function marqueeHits(r: WorldRect, crossing: boolean, ctx: HitContext): ElementRef[] {
  const out: ElementRef[] = []
  for (const c of ctx.columns) {
    const ext = columnHalfExtents(c)
    const full =
      c.pos.x - ext.dx >= r.x0 && c.pos.x + ext.dx <= r.x1 && c.pos.y - ext.dy >= r.y0 && c.pos.y + ext.dy <= r.y1
    const touch =
      c.pos.x + ext.dx >= r.x0 && c.pos.x - ext.dx <= r.x1 && c.pos.y + ext.dy >= r.y0 && c.pos.y - ext.dy <= r.y1
    if (full || (crossing && touch)) out.push({ kind: 'column', id: c.id })
  }
  for (const b of ctx.beams) {
    const full = b.path.every((p) => inRect(p, r))
    const touch =
      crossing && b.path.some((p, i) => i + 1 < b.path.length && segHitsRect(p, b.path[i + 1], r))
    if (full || touch) out.push({ kind: 'beam', id: b.id })
  }
  if (ctx.showSlabs) {
    for (const sl of ctx.slabs) {
      if (sl.polygon.every((p) => inRect(p, r))) out.push({ kind: 'slab', id: sl.id })
    }
  }
  if (ctx.showLoads) {
    for (const rg of ctx.loadRegions) {
      if (rg.polygon.every((p) => inRect(p, r))) out.push({ kind: 'loadRegion', id: rg.id })
    }
    for (const l of ctx.slabLoads ?? []) {
      const full = inRect(l.a, r) && (!l.b || inRect(l.b, r))
      const touch = crossing && !!l.b && segHitsRect(l.a, l.b, r)
      if (full || touch) out.push({ kind: 'slabLoad', id: l.id })
    }
  }
  return out
}
