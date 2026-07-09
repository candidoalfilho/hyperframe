import {
  pointInPolygon,
  projectOnSegment,
  type Beam,
  type Column,
  type ElementRef,
  type LoadRegion,
  type Slab,
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
  showLoads: boolean
  showSlabs: boolean
  /** px por metro — p/ tolerância mínima de 8 px nas vigas */
  k: number
}

/** hit-test com prioridade: pilares > cargas de parede > regiões de carga > vigas > lajes */
export function hitTest(p: Vec2, ctx: HitContext): ElementRef | null {
  // pilares — retângulo expandido 0,15 m
  for (let i = ctx.columns.length - 1; i >= 0; i--) {
    const c = ctx.columns[i]
    const hx = (c.rotationDeg === 0 ? c.section.h : c.section.bw) / 2 + 0.15
    const hy = (c.rotationDeg === 0 ? c.section.bw : c.section.h) / 2 + 0.15
    if (Math.abs(p.x - c.pos.x) <= hx && Math.abs(p.y - c.pos.y) <= hy) {
      return { kind: 'column', id: c.id }
    }
  }

  // cargas de parede — perto da linha da viga hospedeira (0,3 m), só se visíveis
  if (ctx.showLoads && ctx.wallLoads.length > 0) {
    const byId = new Map(ctx.beams.map((b) => [b.id, b]))
    let best: WallLoad | null = null
    let bestD = 0.3
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

  // lajes — ponto dentro do polígono (só se visíveis)
  if (ctx.showSlabs) {
    for (const sl of ctx.slabs) {
      if (pointInPolygon(p, sl.polygon)) return { kind: 'slab', id: sl.id }
    }
  }

  return null
}
