import type { ElementRef, Project } from '../model/types'
import { dist, pointInPolygon, polygonArea, projectOnSegment, TOL } from '../geometry/geometry'
import { columnSectionInfo } from './columnSection'

/**
 * Verificação de consistência do modelo (pré-análise) — no espírito do
 * "Consistência de Planta": erros graves impedem/invalidam a análise, médios
 * indicam modelagem provavelmente errada, leves são avisos de organização.
 */

export type IssueSeverity = 'grave' | 'media' | 'leve'

export interface ConsistencyIssue {
  severity: IssueSeverity
  message: string
  /** elemento relacionado (p/ seleção na UI) */
  ref?: ElementRef
  /** nome do pavimento/planta, quando aplicável */
  where?: string
}

export function checkConsistency(project: Project): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const push = (severity: IssueSeverity, message: string, ref?: ElementRef, where?: string) =>
    issues.push({ severity, message, ref, where })

  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const levelIndexById = new Map(levels.map((l, i) => [l.id, i]))
  const usedPlanIds = new Set(levels.map((l) => l.planId).filter(Boolean) as string[])

  // ---------------------------------------------------------------- geral
  if (project.columns.length === 0) {
    push('grave', 'Modelo sem pilares — a análise não é possível.')
  }
  if (levels.length < 2) {
    push('grave', 'Defina ao menos um pavimento acima da fundação.')
  }

  // ---------------------------------------------------------------- pilares
  for (const col of project.columns) {
    const iBase = levelIndexById.get(col.baseLevelId)
    const iTop = levelIndexById.get(col.topLevelId)
    if (iBase === undefined || iTop === undefined) {
      push('grave', `Pilar ${col.name}: nível de base/topo inexistente.`, {
        kind: 'column',
        id: col.id,
      })
      continue
    }
    if (iTop <= iBase) {
      push('grave', `Pilar ${col.name}: topo (${levels[iTop].name}) abaixo/na base.`, {
        kind: 'column',
        id: col.id,
      })
    }
    const info = columnSectionInfo(col.section)
    if (info.minDim < 0.14) {
      push(
        'media',
        `Pilar ${col.name}: menor dimensão ${(info.minDim * 100).toFixed(0)} cm < 14 cm (NBR 6118 §13.2.3 — exige γn e limita a 19 cm).`,
        { kind: 'column', id: col.id },
      )
    }
    if (info.A < 0.036) {
      // §13.2.3: área mínima 360 cm²
      push('media', `Pilar ${col.name}: área ${(info.A * 1e4).toFixed(0)} cm² < 360 cm² (§13.2.3).`, {
        kind: 'column',
        id: col.id,
      })
    }
    // pilar-parede (§13.2.3 / §15.9): b/h ≥ 5 — tratado como barra
    if (info.kind === 'rect' && Math.max(info.bu, info.bv) / Math.max(info.minDim, 0.01) >= 5) {
      push(
        'leve',
        `Pilar ${col.name}: relação lados ≥ 5 — pilar-parede; dimensionado como barra (verificação por lâminas §15.9 no roadmap).`,
        { kind: 'column', id: col.id },
      )
    }
    // nasce fora da fundação: precisa de viga sob o ponto
    if (iBase > 0) {
      const level = levels[iBase]
      const plan = project.plans.find((p) => p.id === level.planId)
      const onBeam =
        plan?.beams.some((b) => {
          for (let i = 0; i + 1 < b.path.length; i++) {
            const { d } = projectOnSegment(col.pos, b.path[i], b.path[i + 1])
            if (d <= TOL * 2) return true
          }
          return false
        }) ?? false
      if (!onBeam) {
        push(
          'grave',
          `Pilar ${col.name} nasce em ${level.name} sem viga de transferência sob o ponto.`,
          { kind: 'column', id: col.id },
          level.name,
        )
      }
    }
  }
  // pilares duplicados (mesma posição)
  for (let i = 0; i < project.columns.length; i++) {
    for (let j = i + 1; j < project.columns.length; j++) {
      const a = project.columns[i]
      const b = project.columns[j]
      if (dist(a.pos, b.pos) < 0.05) {
        push('grave', `Pilares ${a.name} e ${b.name} sobrepostos (mesma posição em planta).`, {
          kind: 'column',
          id: b.id,
        })
      }
    }
  }

  // ---------------------------------------------------------------- plantas
  for (const plan of project.plans) {
    const inUse = usedPlanIds.has(plan.id)
    const where = plan.name

    for (const beam of plan.beams) {
      if (beam.path.length < 2) {
        push('grave', `Viga ${beam.name} (${where}): polilinha com menos de 2 vértices.`, {
          kind: 'beam',
          id: beam.id,
        }, where)
        continue
      }
      // viga apoiada? (pilar sobre o eixo ou cruzamento com outra viga)
      if (inUse) {
        let hasColumn = false
        for (let i = 0; i + 1 < beam.path.length && !hasColumn; i++) {
          for (const col of project.columns) {
            const { d } = projectOnSegment(col.pos, beam.path[i], beam.path[i + 1])
            if (d <= TOL * 2) {
              hasColumn = true
              break
            }
          }
        }
        if (!hasColumn) {
          const crossesOther = plan.beams.some((other) => {
            if (other.id === beam.id) return false
            for (let i = 0; i + 1 < beam.path.length; i++) {
              for (let j = 0; j + 1 < other.path.length; j++) {
                // interseção aproximada: projeção das pontas
                const p1 = projectOnSegment(beam.path[i], other.path[j], other.path[j + 1])
                const p2 = projectOnSegment(beam.path[i + 1], other.path[j], other.path[j + 1])
                if (p1.d <= TOL * 2 || p2.d <= TOL * 2) return true
              }
            }
            return false
          })
          push(
            crossesOther ? 'media' : 'grave',
            crossesOther
              ? `Viga ${beam.name} (${where}): sem pilar — apoiada apenas em outras vigas.`
              : `Viga ${beam.name} (${where}): sem apoio (nem pilar, nem cruzamento) — instável.`,
            { kind: 'beam', id: beam.id },
            where,
          )
        }
      }
      // furos coerentes
      let L = 0
      for (let i = 0; i + 1 < beam.path.length; i++) L += dist(beam.path[i], beam.path[i + 1])
      for (const op of beam.openings ?? []) {
        if (op.x < 0 || op.x > L) {
          push(
            'media',
            `Viga ${beam.name} (${where}): furo em x = ${op.x.toFixed(2)} m fora do comprimento (${L.toFixed(2)} m).`,
            { kind: 'beam', id: beam.id },
            where,
          )
        }
        if (op.height >= beam.section.h) {
          push('grave', `Viga ${beam.name} (${where}): furo com altura ≥ altura da viga.`, {
            kind: 'beam',
            id: beam.id,
          }, where)
        }
      }
      // seções por trecho coerentes
      if (beam.segmentSections && beam.segmentSections.length > beam.path.length - 1) {
        push('leve', `Viga ${beam.name} (${where}): seções por trecho além dos segmentos da polilinha.`, {
          kind: 'beam',
          id: beam.id,
        }, where)
      }
    }

    for (const slab of plan.slabs) {
      if (slab.polygon.length < 3 || polygonArea(slab.polygon) < 0.05) {
        push('grave', `Laje ${slab.name} (${where}): contorno degenerado.`, {
          kind: 'slab',
          id: slab.id,
        }, where)
      }
      if (!slab.ribbed && slab.thickness < 0.07) {
        push('media', `Laje ${slab.name} (${where}): h = ${(slab.thickness * 100).toFixed(0)} cm < 7 cm (mínimo usual §13.2.4.1).`, {
          kind: 'slab',
          id: slab.id,
        }, where)
      }
      if (slab.ribbed && slab.thickness <= slab.ribbed.topping + 0.02) {
        push('media', `Laje ${slab.name} (${where}): altura total ≤ capa + 2 cm — nervura inexistente.`, {
          kind: 'slab',
          id: slab.id,
        }, where)
      }
      // laje lisa/cogumelo: pilar interno à laje sem viga no ponto
      if (inUse) {
        for (const col of project.columns) {
          if (!pointInPolygon(col.pos, slab.polygon)) continue
          const onBeam = plan.beams.some((b) => {
            for (let i = 0; i + 1 < b.path.length; i++) {
              const { d } = projectOnSegment(col.pos, b.path[i], b.path[i + 1])
              if (d <= TOL * 2) return true
            }
            return false
          })
          if (!onBeam) {
            if (project.settings.slabMethod === 'grelha') {
              push(
                'leve',
                `Pilar ${col.name} interno à laje ${slab.name} (${where}): laje lisa — a GRELHA leva a carga ao pilar e verifica a punção (§19.5).`,
                { kind: 'column', id: col.id },
                where,
              )
            } else {
              push(
                'media',
                `Pilar ${col.name} interno à laje ${slab.name} (${where}) sem viga — no método de Marcus a carga NÃO chega ao pilar; mude p/ o método da GRELHA nas configurações (lajes lisas + punção).`,
                { kind: 'column', id: col.id },
                where,
              )
            }
          }
        }
      }
    }

    for (const wl of plan.wallLoads) {
      const beam = plan.beams.find((b) => b.id === wl.beamId)
      if (!beam) {
        push('leve', `Carga de parede (${where}) aponta p/ viga inexistente.`, {
          kind: 'wallLoad',
          id: wl.id,
        }, where)
        continue
      }
      if (wl.x0 !== undefined && wl.x1 !== undefined && wl.x1 <= wl.x0) {
        push('media', `Carga de parede em ${beam.name} (${where}): trecho x1 ≤ x0.`, {
          kind: 'wallLoad',
          id: wl.id,
        }, where)
      }
    }

    for (const region of plan.loadRegions ?? []) {
      if (region.polygon.length < 3 || polygonArea(region.polygon) < 1e-3) {
        push('media', `Região ${region.name} (${where}): contorno degenerado.`, {
          kind: 'loadRegion',
          id: region.id,
        }, where)
      }
    }
  }

  // nomes duplicados (leve)
  const names = new Map<string, number>()
  for (const c of project.columns) names.set(c.name, (names.get(c.name) ?? 0) + 1)
  for (const [name, count] of names) {
    if (count > 1) push('leve', `${count} pilares com o mesmo nome "${name}".`)
  }

  const order: IssueSeverity[] = ['grave', 'media', 'leve']
  return issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
}
