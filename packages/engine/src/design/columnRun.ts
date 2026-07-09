import type { Project } from '../model/types'
import type {
  AnalysisModel,
  CaseId,
  CaseResult,
  ColumnDesignResult,
  LoadCombo,
} from '../analysis/types'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import {
  designColumnSection,
  minimumMoment,
  slenderness,
  type ColumnDemandPoint,
  type ColumnSectionDef,
} from '../nbr/nbr6118/columnDesign'

/**
 * Dimensionamento de todos os pilares: para cada tramo e combinação ELU,
 * monta a solicitação (Nd, Mu, Mv) já com momentos mínimos (§11.3.3.4.3) e
 * efeitos locais de 2ª ordem (pilar-padrão, §15.8.3.3.2); reduz ao conjunto
 * governante e dimensiona a flexo-compressão oblíqua.
 */
export function runColumnDesign(
  project: Project,
  model: AnalysisModel,
  combos: LoadCombo[],
  casesElu: Partial<Record<CaseId, CaseResult>>,
): ColumnDesignResult[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const cover = coverFor(project.settings.caa).column
  const eluCombos = combos.filter((c) => c.type === 'ELU')
  const out: ColumnDesignResult[] = []

  for (const col of project.columns) {
    const memberIds: number[] = []
    model.members.forEach((m, mi) => {
      if (m.ref.kind === 'column' && m.ref.sourceId === col.id) memberIds.push(mi)
    })
    if (memberIds.length === 0) continue

    const { bw, h } = col.section
    const ac = bw * h
    const sec: ColumnSectionDef = {
      bw,
      h,
      cover,
      fcd: cp.fcd,
      fyd: fydV,
      es: project.settings.steel.Es,
    }

    interface RawDemand extends ColumnDemandPoint {
      lambdaU: number
      lambdaV: number
      needsRigorous: boolean
    }
    const raw: RawDemand[] = []
    let ndMax = 0

    for (const mi of memberIds) {
      const member = model.members[mi]
      const le = member.length
      for (const combo of eluCombos) {
        // superpõe extremidades (estação 0 = base, última = topo)
        let n0 = 0
        let nL = 0
        let mz0 = 0
        let mzL = 0
        let my0 = 0
        let myL = 0
        for (const [caseId, factor] of Object.entries(combo.factors)) {
          const cr = casesElu[caseId as CaseId]
          if (!cr) continue
          const d = cr.memberDiagrams[mi]
          const last = d.x.length - 1
          n0 += factor * d.N[0]
          nL += factor * d.N[last]
          mz0 += factor * d.Mz[0]
          mzL += factor * d.Mz[last]
          my0 += factor * d.My[0]
          myL += factor * d.My[last]
        }
        const nd = Math.max(-n0, -nL, 0) // compressão +
        if (nd < 1e-6) continue
        ndMax = Math.max(ndMax, nd)

        // direção V: momentos Mz (gradiente ao longo de h)
        const mdV = directionMoment(nd, h, le, ac, cp.fcd, mz0, mzL)
        // direção U: momentos My (gradiente ao longo de bw)
        const mdU = directionMoment(nd, bw, le, ac, cp.fcd, my0, myL)

        raw.push({
          label: combo.label,
          nd,
          mu: mdU.md,
          mv: mdV.md,
          lambdaU: mdU.lambda,
          lambdaV: mdV.lambda,
          needsRigorous: mdU.needsRigorous || mdV.needsRigorous,
        })
      }
    }

    if (raw.length === 0) continue

    // conjunto governante (evita 13 combos × 8 tramos na integração)
    const pick = (score: (d: RawDemand) => number): RawDemand =>
      raw.reduce((best, d) => (score(d) > score(best) ? d : best), raw[0])
    const governing = new Map<string, RawDemand>()
    for (const d of [
      pick((x) => x.nd),
      pick((x) => -x.nd),
      pick((x) => x.mu),
      pick((x) => x.mv),
      pick((x) => x.mu + x.mv),
      pick((x) => x.mu / (x.nd + 1)),
      pick((x) => x.mv / (x.nd + 1)),
    ]) {
      governing.set(`${d.label}|${d.nd.toFixed(1)}|${d.mu.toFixed(1)}|${d.mv.toFixed(1)}`, d)
    }
    const demands = [...governing.values()]
    const lambdaU = Math.max(...raw.map((d) => d.lambdaU))
    const lambdaV = Math.max(...raw.map((d) => d.lambdaV))
    const needsRigorous = raw.some((d) => d.needsRigorous)

    const asMin = Math.max((0.15 * ndMax) / fydV, 0.004 * ac)
    const design = designColumnSection(sec, demands, asMin)

    const worst = demands.reduce((b, d) => (d.nd > b.nd ? d : b), demands[0])
    const notes = [...design.notes]
    if (needsRigorous) {
      notes.push('λ > 90 — o pilar exige método rigoroso de 2ª ordem (fora do escopo v0.2).')
    }

    let status: ColumnDesignResult['status'] = 'ok'
    if (!design.ok) status = 'falha'
    else if (needsRigorous || design.utilization > 0.9 || design.rho > 0.03) status = 'atencao'

    out.push({
      columnId: col.id,
      name: col.name,
      section: col.section,
      nd: worst.nd,
      mdU: worst.mu,
      mdV: worst.mv,
      nu: worst.nd / (ac * cp.fcd),
      lambdaU,
      lambdaV,
      needsRigorous,
      as: design.arrangement?.as ?? 0,
      rho: design.rho,
      bars: design.arrangement?.spec ?? '—',
      barsN: design.arrangement?.n ?? 0,
      barsPhi: design.arrangement?.phi ?? 0,
      barPositions: design.arrangement?.positions ?? [],
      stirrupSpec: design.stirrups.spec,
      stirrupPhi: design.stirrups.phi,
      stirrupSpacing: design.stirrups.spacing,
      utilization: design.utilization,
      governing: design.governing,
      status,
      notes,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

/** momento de cálculo por direção com mínimo + 2ª ordem local */
function directionMoment(
  nd: number,
  hDir: number,
  le: number,
  ac: number,
  fcd: number,
  mEnd0: number,
  mEndL: number,
): { md: number; lambda: number; needsRigorous: boolean } {
  const abs0 = Math.abs(mEnd0)
  const absL = Math.abs(mEndL)
  const maRaw = Math.max(abs0, absL)
  const mbRaw = Math.min(abs0, absL)
  // sinal relativo p/ αb (curvatura simples → mesmo sinal de flexão nas pontas
  // significa curvatura reversa no tramo; convenção: ratio = -m2/m1 do pilar
  // biapoiado → usamos sinais dos momentos de extremidade diretamente)
  // diagrama interno sem troca de sinal ⇒ curvatura simples ⇒ MB/MA > 0 (norma)
  const sameSign = mEnd0 * mEndL >= 0
  const mMin = minimumMoment(nd, hDir)
  const m1dA = Math.max(maRaw, mMin)
  const mbSigned = maRaw <= mMin ? m1dA : (sameSign ? 1 : -1) * mbRaw
  const sl = slenderness({
    le,
    hDir,
    nd,
    ac,
    fcd,
    ma: m1dA,
    mb: mbSigned,
  })
  const md = Math.max(m1dA, sl.alphaB * m1dA + sl.m2)
  return { md, lambda: sl.lambda, needsRigorous: sl.needsRigorous }
}
