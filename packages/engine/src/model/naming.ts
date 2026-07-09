import type { Project } from './types'

function nextNumber(names: string[], prefix: string): number {
  let max = 0
  const re = new RegExp(`^${prefix}(\\d+)$`)
  for (const n of names) {
    const m = re.exec(n)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

export function nextColumnName(project: Project): string {
  return `P${nextNumber(project.columns.map((c) => c.name), 'P')}`
}

export function nextBeamName(project: Project, planId: string): string {
  const plan = project.plans.find((p) => p.id === planId)
  return `V${nextNumber(plan ? plan.beams.map((b) => b.name) : [], 'V')}`
}

export function nextSlabName(project: Project, planId: string): string {
  const plan = project.plans.find((p) => p.id === planId)
  return `L${nextNumber(plan ? plan.slabs.map((s) => s.name) : [], 'L')}`
}

const REGION_PREFIX: Record<string, string> = {
  escada: 'ESC',
  reservatorio: 'RES',
  generica: 'CR',
}

export function nextRegionName(
  project: Project,
  planId: string,
  kind: 'escada' | 'reservatorio' | 'generica',
): string {
  const plan = project.plans.find((p) => p.id === planId)
  const prefix = REGION_PREFIX[kind]
  return `${prefix}${nextNumber(plan ? plan.loadRegions.map((r) => r.name) : [], prefix)}`
}

export function nextPlanName(project: Project): string {
  return `Planta ${project.plans.length + 1}`
}
