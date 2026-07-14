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
import { basicAnchorage, fbd, requiredAnchorage, shiftAl } from '../nbr/nbr6118/anchorage'
import { columnSectionInfo, insetRectilinear } from '../model/columnSection'

/**
 * Detalhamento de vigas e pilares + tabela de aço por posição.
 * Vigas: positivos com ancoragem §9.4 e gancho vertical nas pontas extremas
 * (α=0,7); negativos cobrindo 0,25·ℓ + decalagem al (§17.4.2.2) p/ cada lado
 * do apoio, com ganchos; numeração N reinicia por elemento (casa com a
 * prancha). Revisão de engenheiro continua obrigatória.
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
  // numeração N reinicia por elemento (viga/pilar) p/ casar com a prancha
  const posByGroup = new Map<string, number>()
  const pushItem = (
    group: string,
    elementId: string | undefined,
    phi: number,
    n: number,
    unitLength: number,
    element: string,
    reps: number,
    note?: string,
  ): number => {
    if (n <= 0 || phi <= 0 || unitLength <= 0) return 0
    const pos = (posByGroup.get(group) ?? 0) + 1
    posByGroup.set(group, pos)
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
      elementId,
      note,
    })
    return pos
  }

  // ---------------------------------------------------------------- vigas
  // último vão de cada viga: define onde o positivo ganha gancho de ponta
  const lastSpanIdx = new Map<string, number>()
  for (const bd of beamDesign) {
    lastSpanIdx.set(bd.beamId, Math.max(lastSpanIdx.get(bd.beamId) ?? 0, bd.spanIndex))
  }

  const beams: BeamDetailSpan[] = []
  for (const bd of beamDesign) {
    const reps = levelsPerPlan.get(planOfBeam.get(bd.beamId) ?? '') ?? 1
    const { bw, h } = bd.section
    const L = bd.length
    // numeração por beamId: o mesmo NOME (V1) pode repetir em plantas distintas
    const group = bd.beamId
    const el = `Viga ${bd.beamName} vão ${bd.spanIndex + 1}`
    // perna do gancho vertical: altura da viga menos os cobrimentos
    const leg = round5(Math.max(h - 2 * coverBeam, 0.1))

    const lbOf = (phi: number, asCalc: number, asEf: number, hook: boolean) =>
      requiredAnchorage(basicAnchorage(phi, fydV, fbdGood), asCalc, asEf, phi, hook)

    // decalagem al do diagrama (§17.4.2.2, modelo I) com o VSd da envoltória
    const posPhi = bd.positive.barsPhi
    const dUtil = Math.max(h - coverBeam - 0.005 - posPhi / 2, 0.5 * h)
    const al = shiftAl(dUtil, bd.shear.vd, bd.shear.vc)

    // positivos: vão + ancoragem; gancho vertical (α=0,7) nas pontas EXTREMAS
    const posN = bd.positive.barsN
    const hookStart = bd.spanIndex === 0
    const hookEnd = bd.spanIndex === (lastSpanIdx.get(bd.beamId) ?? bd.spanIndex)
    const asEfPos = bd.positive.asProvided || bd.positive.as
    const legStart = hookStart ? leg : 0
    const legEnd = hookEnd ? leg : 0
    const posLen = round5(
      L +
        lbOf(posPhi, bd.positive.as, asEfPos, hookStart) +
        lbOf(posPhi, bd.positive.as, asEfPos, hookEnd) +
        legStart +
        legEnd,
    )
    const posPos = pushItem(
      group,
      bd.beamId,
      posPhi,
      posN,
      posLen,
      el,
      reps,
      hookStart || hookEnd ? 'gancho vertical na(s) extremidade(s)' : undefined,
    )

    // negativos: (0,25·ℓ + al) p/ cada lado do apoio + ganchos verticais
    const negOf = (f: BeamSpanDesign['negLeft']) => {
      if (!f || f.barsN <= 0) return null
      const lbHook = lbOf(f.barsPhi, f.as, f.asProvided || f.as, true)
      const run = round5(Math.max(2 * (0.25 * L + al), 2 * lbHook))
      const len = round5(run + 2 * leg)
      const p = pushItem(
        group,
        bd.beamId,
        f.barsPhi,
        f.barsN,
        len,
        el,
        reps,
        'negativo: 2·(0,25·ℓ + al) + ganchos — cobrir o diagrama na revisão',
      )
      return { n: f.barsN, phi: f.barsPhi, length: len, pos: p, leg }
    }
    const negLeft = negOf(bd.negLeft)
    const negRight = negOf(bd.negRight)

    // estribos
    const spacingMatch = /c\/ (\d+)/.exec(bd.shear.spec)
    const spacing = spacingMatch ? Number(spacingMatch[1]) / 100 : 0.15
    const count = Math.max(2, Math.ceil((L - 0.1) / spacing) + 1)
    const stirrupUnit = round5(2 * (bw - 2 * coverBeam + (h - 2 * coverBeam)) + 0.15)
    const stPos = pushItem(group, bd.beamId, 0.005, count, stirrupUnit, el, reps)

    beams.push({
      beamId: bd.beamId,
      beamName: bd.beamName,
      spanIndex: bd.spanIndex,
      length: L,
      section: bd.section,
      positive: {
        n: posN,
        phi: posPhi,
        length: posLen,
        pos: posPos,
        legStart: legStart > 0 ? legStart : undefined,
        legEnd: legEnd > 0 ? legEnd : undefined,
      },
      negLeft,
      negRight,
      stirrup: { phi: 0.005, spacing, count, unitLength: stirrupUnit, pos: stPos },
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
    const info = columnSectionInfo(col.section)
    // comprimento do estribo: contorno recuado do cobrimento + gancho
    let stirrupPerim: number
    if (info.kind === 'circle') {
      stirrupPerim = Math.PI * Math.max(info.bu - 2 * 0.025, 0.05)
    } else {
      const inset = insetRectilinear(info.polygon, 0.025)
      stirrupPerim = 0
      for (let i = 0; i < inset.length; i++) {
        const q = inset[(i + 1) % inset.length]
        stirrupPerim += Math.hypot(q.x - inset[i].x, q.y - inset[i].y)
      }
    }
    for (const hs of storyHeights) {
      pushItem(el, cd.columnId, cd.barsPhi, cd.barsN, round5(hs + lap), el, 1)
      const nStirrups = Math.max(2, Math.ceil(hs / cd.stirrupSpacing))
      const su = round5(stirrupPerim + 0.15)
      pushItem(el, cd.columnId, cd.stirrupPhi, nStirrups, su, el, 1)
    }
    columns.push({
      columnId: cd.columnId,
      name: cd.name,
      section: cd.section,
      sectionLabel: info.label,
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
