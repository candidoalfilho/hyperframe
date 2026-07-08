import type { Project, Vec2 } from '@hyperframe/engine'

/**
 * Geometria do edifício em instâncias simples (caixas + lajes), já em
 * coordenadas three.js (y-up; mundo → three: [x, cota, -y]).
 */

export interface BoxInstance {
  key: string
  kind: 'column' | 'beam'
  /** id do elemento de modelagem (seleção destaca o elemento inteiro) */
  id: string
  /** índices de nível tocados — p/ "isolar pavimento ativo" */
  levels: number[]
  position: [number, number, number]
  rotationY: number
  /** [comprimento em x local, altura, largura] */
  size: [number, number, number]
}

export interface SlabInstance {
  key: string
  id: string
  levelIndex: number
  polygon: Vec2[]
  thickness: number
  /** cota do topo da laje, m */
  elevation: number
}

export function buildBoxes(project: Project): BoxInstance[] {
  const boxes: BoxInstance[] = []
  const levelIdx = new Map<string, number>()
  project.levels.forEach((l, i) => levelIdx.set(l.id, i))

  // ---- pilares: um segmento por pé-direito entre níveis consecutivos ----
  for (const col of project.columns) {
    const i0 = levelIdx.get(col.baseLevelId) ?? 0
    const i1 = levelIdx.get(col.topLevelId) ?? project.levels.length - 1
    // rot 0 → dimensão h da seção ao longo do X global; rot 90 → ao longo de Y
    const sx = col.rotationDeg === 0 ? col.section.h : col.section.bw
    const sz = col.rotationDeg === 0 ? col.section.bw : col.section.h
    for (let i = i0; i < i1; i++) {
      const zBot = project.levels[i].elevation
      const zTop = project.levels[i + 1].elevation
      const hStory = zTop - zBot
      if (hStory <= 1e-6) continue
      boxes.push({
        key: `col:${col.id}:${i}`,
        kind: 'column',
        id: col.id,
        levels: [i, i + 1],
        position: [col.pos.x, zBot + hStory / 2, -col.pos.y],
        rotationY: 0,
        size: [sx, hStory, sz],
      })
    }
  }

  // ---- vigas: uma caixa por trecho da polilinha, topo na cota do nível ----
  project.levels.forEach((level, li) => {
    if (!level.planId) return
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) return
    for (const beam of plan.beams) {
      const { bw, h } = beam.section
      for (let s = 0; s + 1 < beam.path.length; s++) {
        const a = beam.path[s]
        const b = beam.path[s + 1]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy)
        if (len <= 1e-6) continue
        boxes.push({
          key: `bm:${level.id}:${beam.id}:${s}`,
          kind: 'beam',
          id: beam.id,
          levels: [li],
          position: [(a.x + b.x) / 2, level.elevation - h / 2, -(a.y + b.y) / 2],
          // eixo X local do box aponta p/ (cosθ, 0, -sinθ) em three ⇒ θ = atan2(dy, dx)
          rotationY: Math.atan2(dy, dx),
          size: [len, h, bw],
        })
      }
    }
  })

  return boxes
}

export function buildSlabs(project: Project): SlabInstance[] {
  const out: SlabInstance[] = []
  project.levels.forEach((level, li) => {
    if (!level.planId) return
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) return
    for (const slab of plan.slabs) {
      if (slab.polygon.length < 3) continue
      out.push({
        key: `sl:${level.id}:${slab.id}`,
        id: slab.id,
        levelIndex: li,
        polygon: slab.polygon,
        thickness: slab.thickness,
        elevation: level.elevation,
      })
    }
  })
  return out
}
