import type { FloorPlan, Project, Slab, Vec2 } from '../model/types'
import type { SlabDesignResultItem } from '../analysis/types'
import { dist, projectOnSegment } from '../geometry/geometry'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import { designSlab, type EdgeCondition } from '../nbr/nbr6118/slabDesign'
import { slabExtraLoads } from '../analysis/buildModel'

/** laje retangular? (4 vértices, lados opostos iguais, ângulos retos) */
function isRectangular(poly: Vec2[]): boolean {
  if (poly.length !== 4) return false
  const l = [0, 1, 2, 3].map((i) => dist(poly[i], poly[(i + 1) % 4]))
  if (Math.abs(l[0] - l[2]) > 0.02 || Math.abs(l[1] - l[3]) > 0.02) return false
  const dot =
    (poly[1].x - poly[0].x) * (poly[2].x - poly[1].x) +
    (poly[1].y - poly[0].y) * (poly[2].y - poly[1].y)
  return Math.abs(dot) < 0.02 * l[0] * l[1]
}

/** borda contínua = outra laje divide ≥ 50% desta borda (colinear) */
function edgeContinuous(a: Vec2, b: Vec2, others: Slab[]): boolean {
  const len = dist(a, b)
  if (len < 1e-6) return false
  for (const other of others) {
    const poly = other.polygon
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]
      const d = poly[(i + 1) % poly.length]
      // colinearidade: extremos do outro segmento à distância ≤ tol da reta ab
      const p1 = projectOnSegment(c, a, b)
      const p2 = projectOnSegment(d, a, b)
      if (p1.d > 0.02 || p2.d > 0.02) continue
      const t1 = Math.min(p1.t, p2.t)
      const t2 = Math.max(p1.t, p2.t)
      const overlap = (Math.min(1, t2) - Math.max(0, t1)) * len
      if (overlap >= 0.5 * len) return true
    }
  }
  return false
}

export function runSlabDesign(project: Project): SlabDesignResultItem[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const cover = coverFor(project.settings.caa).slab
  const out: SlabDesignResultItem[] = []

  const levels = [...project.levels].sort((x, y) => x.elevation - y.elevation)
  const seenPlans = new Set<string>()
  for (const level of levels) {
    if (!level.planId || seenPlans.has(level.planId)) continue
    seenPlans.add(level.planId)
    const plan: FloorPlan | undefined = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue

    for (const slab of plan.slabs) {
      const rect = isRectangular(slab.polygon)
      const extras = slabExtraLoads(plan, slab)
      const notes: string[] = []
      if (extras.g > 1e-9 || extras.q > 1e-9) {
        notes.push(
          `Inclui carga de região (escada/reservatório): +${extras.g.toFixed(1)} kN/m² (g), +${extras.q.toFixed(1)} kN/m² (q).`,
        )
      }
      if (!rect) {
        out.push({
          slabId: slab.id,
          name: slab.name,
          levelName: level.name,
          spanA: 0,
          spanB: 0,
          thickness: slab.thickness,
          rectangular: false,
          design: null,
          status: 'atencao',
          notes: [...notes, 'Laje não retangular — dimensionar manualmente (método de Marcus não se aplica).'],
        })
        continue
      }

      const others = plan.slabs.filter((s) => s.id !== slab.id)
      const p = slab.polygon
      const cont = [0, 1, 2, 3].map((i) => edgeContinuous(p[i], p[(i + 1) % 4], others))
      const spanA = dist(p[0], p[1])
      const spanB = dist(p[1], p[2])
      // faixa na direção A (vão = |e0|) apoia nas bordas 1 e 3
      const fixedA = ((cont[1] ? 1 : 0) + (cont[3] ? 1 : 0)) as EdgeCondition
      const fixedB = ((cont[0] ? 1 : 0) + (cont[2] ? 1 : 0)) as EdgeCondition

      const design = designSlab({
        a: { span: spanA, fixedEnds: fixedA },
        b: { span: spanB, fixedEnds: fixedB },
        thickness: slab.thickness,
        g: slab.thickness * project.settings.concreteUnitWeight + slab.finishLoad + extras.g,
        q: slab.liveLoad + extras.q,
        psi2: project.settings.psiLive.psi2,
        cover,
        fcd: cp.fcd,
        fck: cp.fck,
        fyd: fydV,
        fctm: cp.fctm,
        ecs: cp.ecs,
      })

      let status: SlabDesignResultItem['status'] = 'ok'
      if (!design.dirA.ok || !design.dirB.ok || !design.minThicknessOk) status = 'falha'
      else if (!design.deflectionOk) status = 'atencao'

      out.push({
        slabId: slab.id,
        name: slab.name,
        levelName: level.name,
        spanA,
        spanB,
        thickness: slab.thickness,
        rectangular: true,
        design,
        status,
        notes: [...notes, ...design.notes],
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}
