import type { Project } from '../model/types'
import type { MasonryWallResult } from '../analysis/types'
import { flankingSlabs } from '../analysis/flange'
import { checkMasonryWall } from '../nbr/nbr16868/masonry'

/** peso específico da parede (bloco + graute parcial + revestimento), kN/m³ */
const WALL_UNIT_WEIGHT = 14

/**
 * Alvenaria estrutural — Fase 1: acúmulo VERTICAL de cargas por parede
 * (peso próprio + quinhão das lajes adjacentes por meia distância livre) do
 * topo p/ a base, com verificação de compressão simples (NBR 16868) POR
 * PAVIMENTO e fpk mínimo sugerido. Acúmulo por parede idêntica entre
 * pavimentos (plantas compartilhadas). Grupos de paredes com aberturas e
 * contraventamento ao vento: Fase 2.
 */
export function runMasonry(project: Project): MasonryWallResult[] {
  const out: MasonryWallResult[] = []
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const gammaC = project.settings.concreteUnitWeight

  // carga característica POR PAVIMENTO de cada parede (kN/m): pp + lajes
  const storyLoad = (li: number, wallId: string): number | null => {
    const level = levels[li]
    if (!level?.planId) return null
    const plan = project.plans.find((p) => p.id === level.planId)
    const wall = plan?.masonryWalls?.find((w) => w.id === wallId)
    if (!plan || !wall) return null
    const hStory = (levels[li + 1]?.elevation ?? level.elevation + 2.8) - level.elevation
    let w = wall.thickness * hStory * WALL_UNIT_WEIGHT
    // lajes coladas aos trechos: meia distância livre de cada lado
    let slabShare = 0
    for (let s = 0; s + 1 < wall.path.length; s++) {
      const fl = flankingSlabs(plan, wall.path[s], wall.path[s + 1], wall.thickness)
      for (const clear of [fl.clearLeft, fl.clearRight]) {
        if (clear === null) continue
        // pressão média das lajes do plano (g + q) — Fase 1 usa a maior
        let p = 0
        for (const sl of plan.slabs) {
          p = Math.max(p, sl.thickness * gammaC + sl.finishLoad + sl.liveLoad)
        }
        slabShare = Math.max(slabShare, (clear / 2) * p)
      }
    }
    return w + slabShare
  }

  for (let li = 0; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    for (const wall of plan?.masonryWalls ?? []) {
      // acumula deste pavimento até o topo (paredes com o mesmo id acima)
      let nk = 0
      for (let lj = li; lj < levels.length; lj++) {
        const c = storyLoad(lj, wall.id)
        if (c === null) break
        nk += c
      }
      const hStory = (levels[li + 1]?.elevation ?? level.elevation + 2.8) - level.elevation
      const check = checkMasonryWall({
        nd: 1.4 * nk,
        thickness: wall.thickness,
        height: hStory,
        block: wall.block,
        fpk: wall.fpk,
      })
      out.push({
        wallId: wall.id,
        name: wall.name,
        levelName: level.name,
        levelIndex: li,
        thickness: wall.thickness,
        block: wall.block,
        fpk: wall.fpk,
        nd: 1.4 * nk,
        lambda: check.lambda,
        r: check.r,
        nRd: check.nRd,
        utilization: check.utilization,
        fpkRequired: check.fpkRequired,
        status: check.ok ? (check.utilization > 0.9 ? 'atencao' : 'ok') : 'falha',
        notes: check.notes,
      })
    }
  }
  return out.sort(
    (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.levelIndex - b.levelIndex,
  )
}
