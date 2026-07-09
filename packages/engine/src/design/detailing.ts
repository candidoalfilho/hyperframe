import type { Project } from '../model/types'
import type {
  BeamDetailSpan,
  BeamSpanDesign,
  ColumnDesignResult,
  ColumnDetailInfo,
  DetailingResults,
  RebarItem,
  SteelSummary,
} from '../analysis/types'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import { basicAnchorage, fbd, requiredAnchorage } from '../nbr/nbr6118/anchorage'

/**
 * Detalhamento PRELIMINAR (posições retas + estribos) e tabela de aço.
 * Comprimentos de negativos pela regra prática 0,25·ℓ de cada lado do apoio;
 * ancoragens pela NBR 6118 §9.4. Revisão manual indicada nas pranchas.
 */

const STEEL_DENSITY = 7850
const round5 = (v: number) => Math.ceil(v / 0.05 - 1e-9) * 0.05

export function runDetailing(
  project: Project,
  beamDesign: BeamSpanDesign[],
  columnDesign: ColumnDesignResult[],
): DetailingResults {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const coverBeam = coverFor(project.settings.caa).beam
  const fbdGood = fbd(cp.fctd, true)

  // multiplicador: nº de pavimentos que usam a planta de cada viga
  const levelsPerPlan = new Map<string, number>()
  for (const level of project.levels) {
    if (level.planId) levelsPerPlan.set(level.planId, (levelsPerPlan.get(level.planId) ?? 0) + 1)
  }
  const planOfBeam = new Map<string, string>()
  for (const plan of project.plans) {
    for (const b of plan.beams) planOfBeam.set(b.id, plan.id)
  }

  const items: RebarItem[] = []
  let pos = 0
  const pushItem = (
    phi: number,
    n: number,
    unitLength: number,
    element: string,
    reps: number,
    note?: string,
  ) => {
    if (n <= 0 || phi <= 0 || unitLength <= 0) return
    pos++
    const total = unitLength * n * reps
    const kg = total * ((Math.PI * phi * phi) / 4) * STEEL_DENSITY
    items.push({
      pos,
      phi,
      n: n * reps,
      unitLength,
      totalLength: total,
      kg,
      element,
      note,
    })
  }

  // ---------------------------------------------------------------- vigas
  const beams: BeamDetailSpan[] = []
  for (const bd of beamDesign) {
    const reps = levelsPerPlan.get(planOfBeam.get(bd.beamId) ?? '') ?? 1
    const { bw, h } = bd.section
    const L = bd.length
    const el = `Viga ${bd.beamName} vão ${bd.spanIndex + 1}`

    const lbOf = (phi: number, asCalc: number, asEf: number) =>
      requiredAnchorage(basicAnchorage(phi, fydV, fbdGood), asCalc, asEf, phi)

    // positivos: vão inteiro + ancoragem nos dois apoios
    const posPhi = bd.positive.barsPhi
    const posN = bd.positive.barsN
    const posLen = round5(
      L + 2 * lbOf(posPhi, bd.positive.as, bd.positive.asProvided || bd.positive.as),
    )
    pushItem(posPhi, posN, posLen, el, reps)

    // negativos: 0,25·ℓ p/ cada lado do apoio + ancoragem
    const negOf = (f: BeamSpanDesign['negLeft']) => {
      if (!f || f.barsN <= 0) return null
      const len = round5(0.5 * L + lbOf(f.barsPhi, f.as, f.asProvided || f.as))
      pushItem(f.barsPhi, f.barsN, len, el, reps, 'negativo — cobrir diagrama na revisão')
      return { n: f.barsN, phi: f.barsPhi, length: len }
    }
    const negLeft = negOf(bd.negLeft)
    const negRight = negOf(bd.negRight)

    // estribos
    const spacingMatch = /c\/ (\d+)/.exec(bd.shear.spec)
    const spacing = spacingMatch ? Number(spacingMatch[1]) / 100 : 0.15
    const count = Math.max(2, Math.ceil((L - 0.1) / spacing) + 1)
    const stirrupUnit = round5(2 * (bw - 2 * coverBeam + (h - 2 * coverBeam)) + 0.15)
    pushItem(0.005, count, stirrupUnit, el, reps)

    beams.push({
      beamId: bd.beamId,
      beamName: bd.beamName,
      spanIndex: bd.spanIndex,
      length: L,
      section: bd.section,
      positive: { n: posN, phi: posPhi, length: posLen },
      negLeft,
      negRight,
      stirrup: { phi: 0.005, spacing, count, unitLength: stirrupUnit },
    })
  }

  // ---------------------------------------------------------------- pilares
  const columns: ColumnDetailInfo[] = []
  const levelsSorted = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const idxOf = new Map(levelsSorted.map((l, i) => [l.id, i]))
  for (const cd of columnDesign) {
    if (cd.barsN <= 0) continue
    const col = project.columns.find((c) => c.id === cd.columnId)
    if (!col) continue
    const iBase = idxOf.get(col.baseLevelId) ?? 0
    const iTop = idxOf.get(col.topLevelId) ?? levelsSorted.length - 1
    const storyHeights: number[] = []
    for (let i = iBase; i < iTop; i++) {
      storyHeights.push(levelsSorted[i + 1].elevation - levelsSorted[i].elevation)
    }
    const lap = round5(basicAnchorage(cd.barsPhi, fydV, fbdGood))
    const el = `Pilar ${cd.name}`
    for (const hs of storyHeights) {
      pushItem(cd.barsPhi, cd.barsN, round5(hs + lap), el, 1)
      const nStirrups = Math.max(2, Math.ceil(hs / cd.stirrupSpacing))
      const su = round5(
        2 * (col.section.bw - 2 * 0.025 + (col.section.h - 2 * 0.025)) + 0.15,
      )
      pushItem(cd.stirrupPhi, nStirrups, su, el, 1)
    }
    columns.push({
      columnId: cd.columnId,
      name: cd.name,
      section: cd.section,
      barsN: cd.barsN,
      barsPhi: cd.barsPhi,
      barPositions: cd.barPositions,
      stirrupPhi: cd.stirrupPhi,
      stirrupSpacing: cd.stirrupSpacing,
      storyHeights,
      lapLength: lap,
    })
  }

  // ---------------------------------------------------------------- resumo
  const byPhiMap = new Map<number, number>()
  let totalKg = 0
  for (const it of items) {
    byPhiMap.set(it.phi, (byPhiMap.get(it.phi) ?? 0) + it.kg)
    totalKg += it.kg
  }
  const steel: SteelSummary = {
    items,
    byPhi: [...byPhiMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phi, kg]) => ({ phi, kg })),
    totalKg,
    totalWithWaste: totalKg * 1.1,
  }

  return { beams, columns, steel }
}
