import type { Project } from '../model/types'
import type {
  AnalysisModel,
  CaseId,
  CaseResult,
  FoundationResultItem,
} from '../analysis/types'
import { concreteProps, fyd as fydOf } from '../nbr/nbr6118/materials'
import { designFooting } from '../nbr/nbr6118/foundations'
import { designPileCap } from '../nbr/nbr6118/pileCaps'
import { designCaisson } from '../nbr/nbr6122/caisson'
import { designStrapBeam } from '../nbr/nbr6122/strapBeam'
import type { FoundationResultItem as FRI } from '../analysis/types'
import { columnSectionInfo } from '../model/columnSection'

/**
 * Pré-dimensionamento das fundações a partir das reações de serviço
 * (G + Q característicos, passe ELS): sapatas isoladas OU blocos sobre
 * estacas (método das bielas), conforme settings.foundation.type.
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
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
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

    // direção a = dimensão h do pilar (rot 0/180 → h ao longo de X)
    const info = columnSectionInfo(col.section)
    const alongX = col.rotationDeg === 0 || col.rotationDeg === 180
    const ap = info.bv
    const bp = info.bu

    // editor de fundações: tipo/geometria/offset por pilar
    const ov = project.foundationOverrides?.find((o) => o.columnId === col.id)
    const kind = ov?.kind ?? project.settings.foundation.type
    // offset do CG desloca a resultante: soma N·|e| ao momento da direção
    const offA = ov?.offset ? Math.abs(alongX ? ov.offset.x : ov.offset.y) : 0
    const offB = ov?.offset ? Math.abs(alongX ? ov.offset.y : ov.offset.x) : 0
    const ma = (alongX ? myServ : mxServ) + nServ * offA
    const mb = (alongX ? mxServ : myServ) + nServ * offB
    const extra = { manual: !!ov, offset: ov?.offset, depth: ov?.depth }

    if (kind === 'tubulao') {
      const caisson = designCaisson({
        nServ,
        sigmaAdm: project.settings.soil.sigmaAdm,
        sigmaConcrete: project.settings.foundation.caissonSigmaConcrete ?? 5000,
      })
      if (ma + mb > 0.05 * nServ * Math.max(ap, bp)) {
        caisson.notes.push('Momentos na base não considerados no tubulão — verificar excentricidades.')
      }
      out.push({
        columnId: col.id,
        name: col.name,
        nServ,
        kind: 'tubulao',
        ...extra,
        footing: null,
        pileCap: null,
        caisson,
        status: caisson.status,
      })
      continue
    }

    if (kind === 'estacas') {
      const pileCap = designPileCap({
        nServ,
        ap,
        bp,
        pileCapacity: project.settings.foundation.pileCapacity,
        pileDiameter: project.settings.foundation.pileDiameter,
        spacingFactor: project.settings.foundation.pileSpacingFactor,
        nPilesFixed: ov?.nPiles,
        fcd: cp.fcd,
        fyd: fydV,
      })
      if (ov?.nPiles && pileCap.pileLoad > pileCap.pileCapacity + 1e-6) {
        pileCap.status = 'falha'
        pileCap.notes.push('Carga por estaca EXCEDE a capacidade — aumente o nº de estacas.')
      }
      if (ma + mb > 0.05 * nServ * Math.max(ap, bp)) {
        pileCap.notes.push(
          'Momentos na base não considerados na divisão de carga entre estacas — verificar.',
        )
      }
      out.push({
        columnId: col.id,
        name: col.name,
        nServ,
        kind: 'bloco',
        ...extra,
        footing: null,
        pileCap,
        caisson: null,
        status: pileCap.status,
      })
      continue
    }

    // ---- viga alavanca (sapata de divisa): R1 amplificada + sapata CENTRADA ----
    let strap: FRI['strap']
    let nFooting = nServ
    let maF = ma
    let mbF = mb
    const partner =
      ov?.strapToColumnId && ov.strapToColumnId !== col.id
        ? project.columns.find((c) => c.id === ov.strapToColumnId)
        : undefined
    if (partner && ov?.offset && (ov.offset.x !== 0 || ov.offset.y !== 0)) {
      const ux = partner.pos.x - col.pos.x
      const uy = partner.pos.y - col.pos.y
      const L = Math.hypot(ux, uy)
      const eMag = Math.hypot(ov.offset.x, ov.offset.y)
      const ePar = L > 1e-6 ? (ov.offset.x * ux + ov.offset.y * uy) / L : 0
      if (ePar > 0.01 && L > eMag + 0.2) {
        const sb = designStrapBeam({
          n1Serv: nServ,
          e: ePar,
          L,
          bw: Math.max(0.25, Math.min(ap, bp)),
          fck: cp.fck,
          fcd: cp.fcd,
          fctd: cp.fctd,
          fctm: cp.fctm,
          fyd: fydV,
          fywk: project.settings.steel.fyk,
        })
        if (ePar / eMag < 0.95) {
          sb.notes.push(
            'Offset tem componente perpendicular à alavanca — só a projeção na direção P1→P2 equilibra; o restante vira N·e na sapata.',
          )
        }
        // alívio vs. carga do pilar interno (reação de serviço do parceiro)
        const pNode = model.nodes.find(
          (n) =>
            n.support &&
            Math.abs(n.x - partner.pos.x) < 0.05 &&
            Math.abs(n.y - partner.pos.y) < 0.05,
        )
        if (pNode) {
          const prg = reactionAt(g, pNode.id)
          const prq = reactionAt(q, pNode.id)
          const pN = (prg?.fz ?? 0) + (prq?.fz ?? 0)
          if (pN > 1e-6 && sb.relief > 0.5 * pN) {
            if (sb.status === 'ok') sb.status = 'atencao'
            sb.notes.push(
              `Alívio (${sb.relief.toFixed(0)} kN) > 50% da carga do pilar interno (${pN.toFixed(0)} kN) — rever geometria/vão.`,
            )
          }
        }
        sb.notes.push(
          `Alívio de ${sb.relief.toFixed(0)} kN em ${partner.name} NÃO descontado da fundação dele (a favor da segurança).`,
        )
        strap = { ...sb, partnerId: partner.id, partnerName: partner.name, e: ePar, L }
        // sapata centrada no CG: momento do offset já equilibrado pela alavanca —
        // só a componente perpendicular permanece como N·e
        nFooting = sb.r1
        const perpA = Math.max(0, offA - Math.abs(alongX ? (ePar * ux) / L : (ePar * uy) / L))
        const perpB = Math.max(0, offB - Math.abs(alongX ? (ePar * uy) / L : (ePar * ux) / L))
        maF = (alongX ? myServ : mxServ) + nServ * perpA
        mbF = (alongX ? mxServ : myServ) + nServ * perpB
      }
    }

    const footing = designFooting({
      nServ: nFooting,
      ma: maF,
      mb: mbF,
      ap,
      bp,
      sigmaAdm: project.settings.soil.sigmaAdm,
      fyd: fydV,
      fixed: ov?.a && ov?.b ? { a: ov.a, b: ov.b } : undefined,
    })
    if (strap) {
      footing.notes.push(
        `Sapata de divisa c/ viga alavanca até ${strap.partnerName}: dimensionada CENTRADA p/ R1 = ${strap.r1.toFixed(0)} kN (amplificação ${((strap.r1 / nServ - 1) * 100).toFixed(0)}%).`,
      )
    } else if (offA + offB > 1e-9) {
      footing.notes.push(
        `Offset do CG (${(offA * 100).toFixed(0)}/${(offB * 100).toFixed(0)} cm) somado como N·e — p/ divisa, selecione o pilar da viga alavanca no inspetor.`,
      )
    }

    const worst = (a: FRI['status'], b: FRI['status']): FRI['status'] =>
      a === 'falha' || b === 'falha' ? 'falha' : a === 'atencao' || b === 'atencao' ? 'atencao' : 'ok'

    out.push({
      columnId: col.id,
      name: col.name,
      nServ,
      kind: 'sapata',
      ...extra,
      footing,
      strap,
      pileCap: null,
      caisson: null,
      status: strap ? worst(footing.status, strap.status) : footing.status,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}
