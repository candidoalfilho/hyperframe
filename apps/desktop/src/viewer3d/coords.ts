import type { Project, Vec2 } from '@hyperframe/engine'

/**
 * Mapeamento de coordenadas — projeto (x, y em planta; cota = elevação, m)
 * para three.js (y-up): mundo → three: [x, cota, -y]
 */
export function planToWorld(p: Vec2, elevation: number): [number, number, number] {
  return [p.x, elevation, -p.y]
}

/** ponto do modelo de análise (x, y em planta; z = cota) → three.js */
export function modelToWorld(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

/** raycast desabilitado — p/ elementos fantasma e auxiliares (não clicáveis) */
export const NO_RAYCAST = () => null

export interface SceneBounds {
  /** centro da caixa envolvente do edifício (coords three.js) */
  center: [number, number, number]
  /** meio-diâmetro da caixa envolvente, m */
  radius: number
  /** máx. distância da origem a um canto da caixa — p/ frustum da sombra */
  originRadius: number
}

/** caixa envolvente do edifício, em coordenadas three.js */
export function computeBounds(project: Project): SceneBounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const add = (p: Vec2) => {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  for (const c of project.columns) add(c.pos)
  for (const level of project.levels) {
    if (!level.planId) continue
    const plan = project.plans.find((pl) => pl.id === level.planId)
    if (!plan) continue
    for (const b of plan.beams) for (const p of b.path) add(p)
    for (const s of plan.slabs) for (const p of s.polygon) add(p)
  }
  // sem elementos: usa a grelha de eixos como referência
  if (!Number.isFinite(minX)) {
    for (const a of project.grid.xAxes) add({ x: a.pos, y: 0 })
    for (const a of project.grid.yAxes) add({ x: 0, y: a.pos })
  }
  if (!Number.isFinite(minX)) {
    minX = -5
    maxX = 5
    minY = -5
    maxY = 5
  }
  const elevs = project.levels.map((l) => l.elevation)
  const minE = Math.min(0, ...elevs)
  const maxE = Math.max(3, ...elevs)

  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minE + maxE) / 2,
    -(minY + maxY) / 2,
  ]
  const radius = Math.max(5, Math.hypot(maxX - minX, maxE - minE, maxY - minY) / 2)

  let originRadius = 0
  for (const x of [minX, maxX])
    for (const e of [minE, maxE])
      for (const y of [minY, maxY]) originRadius = Math.max(originRadius, Math.hypot(x, e, y))

  return { center, radius, originRadius }
}
