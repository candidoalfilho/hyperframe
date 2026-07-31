import type { Project } from '../model/types'
import type { MasonryWallResult } from '../analysis/types'
import { flankingSlabs } from '../analysis/flange'
import { checkMasonryWall, checkMasonryShearFlex, masonryPiers } from '../nbr/nbr16868/masonry'
import { computeWind } from '../nbr/nbr6123/wind'
import type { WindGeometry } from '../nbr/api'
import { fyd as fydOf } from '../nbr/nbr6118/materials'

/** peso específico da parede (bloco + graute parcial + revestimento), kN/m³ */
const WALL_UNIT_WEIGHT = 14

/**
 * Alvenaria estrutural — Fases 1+2:
 *  F1: acúmulo VERTICAL (pp + meia distância livre das lajes) e compressão
 *      simples por pavimento; ABERTURAS criam trechos (grupos isolados) com
 *      concentração de carga pela tributária das vergas.
 *  F2: CONTRAVENTAMENTO ao vento — cortante/momento de pavimento distribuídos
 *      às paredes ALINHADAS com a direção proporcionalmente a I = t·L³;
 *      cisalhamento (fvk = 0,15+0,5·σ) e flexocompressão com tração de borda
 *      ⇒ graute + armadura (NBR 16868).
 */
export function runMasonry(project: Project): MasonryWallResult[] {
  const out: MasonryWallResult[] = []
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const gammaC = project.settings.concreteUnitWeight
  const fydV = fydOf(project.settings.steel)

  // carga característica POR PAVIMENTO (kN/m), separada em g/q
  const storyLoad = (li: number, wallId: string): { g: number; q: number } | null => {
    const level = levels[li]
    if (!level?.planId) return null
    const plan = project.plans.find((p) => p.id === level.planId)
    const wall = plan?.masonryWalls?.find((w) => w.id === wallId)
    if (!plan || !wall) return null
    const hStory = (levels[li + 1]?.elevation ?? level.elevation + 2.8) - level.elevation
    let g = wall.thickness * hStory * WALL_UNIT_WEIGHT
    let q = 0
    for (let s = 0; s + 1 < wall.path.length; s++) {
      const fl = flankingSlabs(plan, wall.path[s], wall.path[s + 1], wall.thickness)
      for (const clear of [fl.clearLeft, fl.clearRight]) {
        if (clear === null) continue
        let pg = 0
        let pq = 0
        for (const sl of plan.slabs) {
          const sg = sl.thickness * gammaC + sl.finishLoad
          if (sg + sl.liveLoad > pg + pq) {
            pg = sg
            pq = sl.liveLoad
          }
        }
        const shareG = (clear / 2) * pg
        if (shareG > 0 && shareG + (clear / 2) * pq > 0) {
          g = Math.max(g, wall.thickness * hStory * WALL_UNIT_WEIGHT + shareG)
          q = Math.max(q, (clear / 2) * pq)
        }
      }
    }
    return { g, q }
  }

  // ---- vento: cortante/momento por pavimento e rigidezes por direção ----
  const wind = project.settings.wind.enabled ? (() => {
    const pts = project.plans.flatMap((pl) => (pl.masonryWalls ?? []).flatMap((w) => w.path))
    if (pts.length < 2 || levels.length < 2) return null
    const minX = Math.min(...pts.map((p) => p.x))
    const maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const maxY = Math.max(...pts.map((p) => p.y))
    const geoLevels: WindGeometry['levels'] = []
    for (let li = 1; li < levels.length; li++) {
      const z = levels[li].elevation
      const below = levels[li - 1].elevation
      const above = li + 1 < levels.length ? levels[li + 1].elevation : z
      geoLevels.push({ levelIndex: li, z, tributaryHeight: (z - below) / 2 + (above - z) / 2 })
    }
    try {
      return computeWind(project.settings.wind, {
        lx: Math.max(maxX - minX, 0.1),
        ly: Math.max(maxY - minY, 0.1),
        totalHeight: levels[levels.length - 1].elevation,
        levels: geoLevels,
      })
    } catch {
      return null
    }
  })() : null

  /** comprimento projetado da parede na direção (0 = X, 1 = Y) */
  const dirLength = (path: { x: number; y: number }[], dir: 0 | 1): number => {
    let l = 0
    for (let s = 0; s + 1 < path.length; s++) {
      const dx = Math.abs(path[s + 1].x - path[s].x)
      const dy = Math.abs(path[s + 1].y - path[s].y)
      const seg = Math.hypot(dx, dy)
      const along = dir === 0 ? dx : dy
      if (seg > 1e-6 && along / seg >= 0.85) l += seg
    }
    return l
  }

  for (let li = 0; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    const walls = plan?.masonryWalls ?? []

    // rigidez total por direção neste pavimento (I ∝ t·L³)
    const stiff = (dir: 0 | 1) =>
      walls.reduce((s, w) => s + w.thickness * dirLength(w.path, dir) ** 3, 0)
    const sumI: [number, number] = [stiff(0), stiff(1)]
    // cortante e momento de vento acumulados na BASE deste pavimento, por direção
    const zBase = level.elevation
    const windVM = (dir: 0 | 1): { v: number; m: number } => {
      if (!wind) return { v: 0, m: 0 }
      const wd = wind.find((x) => x.dir === (dir === 0 ? 'XP' : 'YP'))
      if (!wd) return { v: 0, m: 0 }
      let v = 0
      let m = 0
      for (const lf of wd.perLevel) {
        if (lf.z > zBase + 1e-6) {
          v += lf.F
          m += lf.F * (lf.z - zBase)
        }
      }
      return { v, m }
    }

    for (const wall of walls) {
      let gk = 0
      let qk = 0
      for (let lj = li; lj < levels.length; lj++) {
        const c = storyLoad(lj, wall.id)
        if (c === null) break
        gk += c.g
        qk += c.q
      }
      const nkLin = gk + qk
      const hStory = (levels[li + 1]?.elevation ?? level.elevation + 2.8) - level.elevation
      const totalLen = wall.path.slice(0, -1).reduce((s, p, i) => s + Math.hypot(wall.path[i + 1].x - p.x, wall.path[i + 1].y - p.y), 0)

      // aberturas ⇒ trechos com concentração (pior trecho governa a compressão)
      const piers = masonryPiers(totalLen, wall.openings ?? [])
      const conc = piers.length > 0 ? Math.max(...piers.map((p) => p.concentration)) : 1
      const check = checkMasonryWall({
        nd: 1.4 * nkLin * conc,
        thickness: wall.thickness,
        height: hStory,
        block: wall.block,
        fpk: wall.fpk,
      })
      const notes = [...check.notes]
      if ((wall.openings?.length ?? 0) > 0) {
        notes.unshift(
          `${piers.length} trecho(s) entre aberturas — concentração de carga ×${conc.toFixed(2)} no pior trecho (grupos isolados; vergas descarregam nos trechos).`,
        )
      }

      // vento no plano da parede (direção dominante)
      let windRes: MasonryWallResult['wind']
      const dir: 0 | 1 = dirLength(wall.path, 0) >= dirLength(wall.path, 1) ? 0 : 1
      const lDir = dirLength(wall.path, dir)
      if (wind && lDir > 0.3 && sumI[dir] > 1e-9) {
        const { v, m } = windVM(dir)
        const share = (wall.thickness * lDir ** 3) / sumI[dir]
        const sf = checkMasonryShearFlex({
          vd: 1.4 * v * share,
          md: 1.4 * m * share,
          nd: 1.4 * nkLin * lDir,
          ngk: gk * lDir,
          length: lDir,
          thickness: wall.thickness,
          block: wall.block,
          fpk: wall.fpk,
          fyd: fydV,
        })
        windRes = {
          dir: dir === 0 ? 'X' : 'Y',
          vd: 1.4 * v * share,
          md: 1.4 * m * share,
          tauD: sf.tauD,
          fvd: sf.fvd,
          shearOk: sf.shearOk,
          compressionOk: sf.compressionOk,
          needsReinf: sf.needsReinf,
          asTie: sf.asTie,
        }
        notes.push(...sf.notes)
      }

      const windFail = windRes ? !windRes.shearOk || !windRes.compressionOk : false
      out.push({
        wallId: wall.id,
        name: wall.name,
        levelName: level.name,
        levelIndex: li,
        thickness: wall.thickness,
        block: wall.block,
        fpk: wall.fpk,
        nd: 1.4 * nkLin * conc,
        lambda: check.lambda,
        r: check.r,
        nRd: check.nRd,
        utilization: check.utilization,
        fpkRequired: check.fpkRequired,
        wind: windRes,
        status: !check.ok || windFail ? 'falha' : check.utilization > 0.9 || windRes?.needsReinf ? 'atencao' : 'ok',
        notes,
      })
    }
  }
  return out.sort(
    (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.levelIndex - b.levelIndex,
  )
}
