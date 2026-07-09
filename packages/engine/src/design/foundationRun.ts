import type { Project } from '../model/types'
import type {
  AnalysisModel,
  CaseId,
  CaseResult,
  FoundationResultItem,
} from '../analysis/types'
import { fyd as fydOf } from '../nbr/nbr6118/materials'
import { designFooting } from '../nbr/nbr6118/foundations'

/**
 * Pré-dimensionamento de sapatas isoladas a partir das reações de serviço
 * (G + Q característicos, passe ELS).
 */
export function runFoundationDesign(
  project: Project,
  model: AnalysisModel,
  casesEls: Partial<Record<CaseId, CaseResult>>,
): FoundationResultItem[] {
  const g = casesEls.G
  const q = casesEls.Q
  if (!g) return []
  const fydV = fydOf(project.settings.steel)
  const out: FoundationResultItem[] = []

  const reactionAt = (cr: CaseResult | undefined, nodeId: number) =>
    cr?.reactions.find((r) => r.nodeId === nodeId)

  for (const col of project.columns) {
    // nó de apoio do pilar (base)
    const node = model.nodes.find(
      (n) =>
        n.support &&
        Math.abs(n.x - col.pos.x) < 0.05 &&
        Math.abs(n.y - col.pos.y) < 0.05,
    )
    if (!node) continue
    const rg = reactionAt(g, node.id)
    const rq = reactionAt(q, node.id)
    if (!rg) continue
    const nServ = rg.fz + (rq?.fz ?? 0)
    if (nServ <= 1e-6) continue
    const mxServ = Math.abs(rg.mx + (rq?.mx ?? 0)) // em torno de X → excentricidade em Y
    const myServ = Math.abs(rg.my + (rq?.my ?? 0)) // em torno de Y → excentricidade em X

    // direção a = dimensão h do pilar (rot 0 → h ao longo de X)
    const alongX = col.rotationDeg === 0
    const ap = col.section.h
    const bp = col.section.bw
    const ma = alongX ? myServ : mxServ
    const mb = alongX ? mxServ : myServ

    const footing = designFooting({
      nServ,
      ma,
      mb,
      ap,
      bp,
      sigmaAdm: project.settings.soil.sigmaAdm,
      fyd: fydV,
    })

    out.push({
      columnId: col.id,
      name: col.name,
      nServ,
      footing,
      status: footing.status,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}
