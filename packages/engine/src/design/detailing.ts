import type { Project, RebarOverride } from '../model/types'
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

/** comprimento comercial de barra, m */
export const STOCK_BAR_LENGTH = 12

/**
 * Emenda por traspasse — NBR 6118 §9.5.2. Barras acima do comprimento
 * comercial são divididas em peças IGUAIS com traspasse
 * l0t = α0t·lb,nec (α0t = 2,0 — todas emendadas na mesma seção, a favor da
 * segurança) ≥ l0t,mín = máx(0,6·lb; 15φ; 0,2 m).
 */
export function planSplices(
  devLength: number,
  lb: number,
  lbNec: number,
  phi: number,
  stock = STOCK_BAR_LENGTH,
): { pieces: number; pieceLength: number; lap: number } {
  if (devLength <= stock + 1e-9) return { pieces: 1, pieceLength: devLength, lap: 0 }
  const lap = Math.max(2 * lbNec, 0.6 * lb, 15 * phi, 0.2)
  const pieces = Math.max(2, Math.ceil((devLength - lap) / (stock - lap) - 1e-9))
  const pieceLength = round5((devLength + (pieces - 1) * lap) / pieces)
  return { pieces, pieceLength, lap }
}

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

    // ajustes do editor de armaduras (n/φ/passo manuais por posição)
    const ovOf = (slot: RebarOverride['slot']) =>
      project.rebarOverrides?.find(
        (o) => o.beamId === bd.beamId && o.spanIndex === bd.spanIndex && o.slot === slot,
      )
    const aPhi = (phi: number) => (Math.PI * phi * phi) / 4
    const manualNote = (asCalc: number, n: number, phi: number): string =>
      n * aPhi(phi) + 1e-12 < asCalc
        ? 'AJUSTE MANUAL — As efetivo MENOR que o calculado!'
        : 'ajuste manual do engenheiro'

    const lbBasic = (phi: number) => basicAnchorage(phi, fydV, fbdGood)
    const lbOf = (phi: number, asCalc: number, asEf: number, hook: boolean) =>
      requiredAnchorage(lbBasic(phi), asCalc, asEf, phi, hook)

    // decalagem al do diagrama (§17.4.2.2, modelo I) com o VSd da envoltória
    const ovP = ovOf('positive')
    const posPhi = ovP?.phi ?? bd.positive.barsPhi
    const posN = ovP?.n ?? bd.positive.barsN
    const dUtil = Math.max(h - coverBeam - 0.005 - posPhi / 2, 0.5 * h)
    const al = shiftAl(dUtil, bd.shear.vd, bd.shear.vc)

    // positivos: vão + ancoragem; gancho vertical (α=0,7) nas pontas EXTREMAS;
    // acima de 12 m a barra é emendada por traspasse (§9.5.2)
    const hookStart = bd.spanIndex === 0
    const hookEnd = bd.spanIndex === (lastSpanIdx.get(bd.beamId) ?? bd.spanIndex)
    const asEfPos = ovP ? posN * aPhi(posPhi) : bd.positive.asProvided || bd.positive.as
    const legStart = hookStart ? leg : 0
    const legEnd = hookEnd ? leg : 0
    const posLen = round5(
      L +
        lbOf(posPhi, bd.positive.as, asEfPos, hookStart) +
        lbOf(posPhi, bd.positive.as, asEfPos, hookEnd) +
        legStart +
        legEnd,
    )
    const spPos = planSplices(
      posLen,
      lbBasic(posPhi),
      lbOf(posPhi, bd.positive.as, asEfPos, false),
      posPhi,
    )
    const posNotes: string[] = []
    if (hookStart || hookEnd) posNotes.push('gancho vertical na(s) extremidade(s)')
    if (spPos.pieces > 1) {
      posNotes.push(
        `${spPos.pieces - 1} emenda(s) por traspasse l0t=${Math.round(spPos.lap * 100)} cm (§9.5.2)`,
      )
    }
    if (ovP) posNotes.push(manualNote(bd.positive.as, posN, posPhi))
    const posPos = pushItem(
      group,
      bd.beamId,
      posPhi,
      posN * spPos.pieces,
      spPos.pieces > 1 ? spPos.pieceLength : posLen,
      el,
      reps,
      posNotes.join(' · ') || undefined,
    )

    // negativos: corte pelo DIAGRAMA REAL — x do momento nulo + al + lb,nec
    // (§18.3.2.4); com ≥ 4 barras, metade escalona no ponto de 50% do momento
    const negOf = (f: BeamSpanDesign['negLeft'], slot: 'negLeft' | 'negRight') => {
      const ov = ovOf(slot)
      if (!f || (ov?.n ?? f.barsN) <= 0) return null
      const nTot = ov?.n ?? f.barsN
      const phi = ov?.phi ?? f.barsPhi
      const asEf = ov ? nTot * aPhi(phi) : f.asProvided || f.as
      const lbHook = lbOf(phi, f.as, asEf, true)
      const sideFull = Math.min(
        f.cutZero !== undefined && f.cutZero > 0 ? f.cutZero + al + lbHook : 0.25 * L + al + lbHook,
        L,
      )
      const runFull = round5(Math.max(2 * sideFull, 2 * lbHook))
      const lenFull = round5(runFull + 2 * leg)
      const baseNote =
        f.cutZero !== undefined && f.cutZero > 0
          ? 'negativo: corte no momento nulo da envoltória + al + lb (§18.3.2.4)'
          : 'negativo: 2·(0,25·ℓ + al) + ganchos — envoltória sem tração definida'
      const notes = (extra?: string) =>
        [baseNote, extra, ov ? manualNote(f.as, nTot, phi) : undefined]
          .filter(Boolean)
          .join(' · ')
      // escalonamento: corta metade das barras no ponto de 50% do momento
      if (nTot >= 4 && f.cutHalf !== undefined && f.cutZero !== undefined && f.cutZero > 0) {
        const nShort = Math.floor(nTot / 2)
        const sideShort = Math.min(f.cutHalf + al + lbHook, sideFull)
        const runShort = round5(Math.max(2 * sideShort, 2 * lbHook))
        const lenShort = round5(runShort + 2 * leg)
        if (lenShort < lenFull - 0.1) {
          const nFull = nTot - nShort
          const pFull = pushItem(group, bd.beamId, phi, nFull, lenFull, el, reps, notes())
          const pShort = pushItem(
            group,
            bd.beamId,
            phi,
            nShort,
            lenShort,
            el,
            reps,
            notes('escalonada (corte a 50% do momento do apoio)'),
          )
          return {
            n: nFull,
            phi,
            length: lenFull,
            pos: pFull,
            leg,
            cut: { n: nShort, length: lenShort, pos: pShort },
          }
        }
      }
      const p = pushItem(group, bd.beamId, phi, nTot, lenFull, el, reps, notes())
      return { n: nTot, phi, length: lenFull, pos: p, leg }
    }
    const negLeft = negOf(bd.negLeft, 'negLeft')
    const negRight = negOf(bd.negRight, 'negRight')

    // estribos (passo manual do editor tem prioridade)
    const ovSt = ovOf('stirrup')
    const spacingMatch = /c\/ (\d+)/.exec(bd.shear.spec)
    const spacing = ovSt?.spacing ?? (spacingMatch ? Number(spacingMatch[1]) / 100 : 0.15)
    const count = Math.max(2, Math.ceil((L - 0.1) / spacing) + 1)
    const stirrupUnit = round5(2 * (bw - 2 * coverBeam + (h - 2 * coverBeam)) + 0.15)
    const stPos = pushItem(
      group,
      bd.beamId,
      0.005,
      count,
      stirrupUnit,
      el,
      reps,
      ovSt ? 'passo ajustado manualmente' : undefined,
    )

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
        splices: spPos.pieces > 1 ? spPos.pieces - 1 : undefined,
        spliceLap: spPos.pieces > 1 ? spPos.lap : undefined,
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
