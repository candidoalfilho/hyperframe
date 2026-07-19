import type { Project } from '../model/types'
import type { StairDesignResultItem } from '../analysis/types'
import { bbox } from '../geometry/geometry'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import { designStair, designStairLanding } from '../nbr/nbr6118/stairs'
import { STAIR_DEFAULTS } from '../model/presets'

/**
 * Dimensiona cada região de escada (kind 'escada') como lance de laje armada
 * em uma direção. Vão = maior lado do retângulo envolvente do polígono
 * (sobrescritível em region.stair.span).
 */
export function runStairDesign(project: Project): StairDesignResultItem[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const cover = coverFor(project.settings.caa).slab
  const out: StairDesignResultItem[] = []

  const levels = [...project.levels].sort((x, y) => x.elevation - y.elevation)
  const seenPlans = new Set<string>()
  for (const level of levels) {
    if (!level.planId || seenPlans.has(level.planId)) continue
    seenPlans.add(level.planId)
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue

    for (const region of plan.loadRegions ?? []) {
      if (region.kind !== 'escada' || region.polygon.length < 3) continue
      const st = { ...STAIR_DEFAULTS, ...(region.stair ?? {}) }
      const { min, max } = bbox(region.polygon)
      const autoSpan = Math.max(max.x - min.x, max.y - min.y)
      const span = st.span && st.span > 0.1 ? st.span : autoSpan

      const kind = st.kind ?? 'reto'
      const landingDepth = st.landingDepth ?? 1.2
      const common = {
        waist: st.waist,
        riser: st.riser,
        tread: st.tread,
        finish: st.finish,
        q: region.q > 0 ? region.q : 2.5,
        unitWeight: project.settings.concreteUnitWeight,
        cover,
        fck: cp.fck,
        fcd: cp.fcd,
        fyd: fydV,
        fctm: cp.fctm,
        ecs: cp.ecs,
        psi2: project.settings.psiLive.psi2,
      }
      const design =
        kind === 'reto'
          ? designStair({ span, ...common })
          : designStairLanding({
              ...common,
              kind,
              flightSpan: Math.max(span - landingDepth, 0.6),
              landingSpan: landingDepth,
            })

      out.push({
        regionId: region.id,
        name: region.name,
        levelName: level.name,
        design,
        status: design.ok ? (design.blondelOk ? 'ok' : 'atencao') : 'falha',
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}
