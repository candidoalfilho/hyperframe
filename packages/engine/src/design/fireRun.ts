import type { Project } from '../model/types'
import type {
  BeamSpanDesign,
  ColumnDesignResult,
  FireCheckItem,
  FireCheckResults,
  SlabDesignResultItem,
} from '../analysis/types'
import { coverFor } from '../nbr/nbr6118/materials'
import { checkBeamFire, checkColumnFire, checkSlabFire, requiredTRRF } from '../nbr/nbr15200/fire'
import { columnSectionInfo } from '../model/columnSection'

const STIRRUP_PHI = 0.0063

/**
 * Verificação em situação de incêndio de todos os elementos dimensionados
 * (NBR 14432 + NBR 15200). c1 = cobrimento + estribo + φ/2 do arranjo adotado;
 * revestimentos não são considerados (a favor da segurança).
 */
export function runFireCheck(
  project: Project,
  beamDesign: BeamSpanDesign[],
  columnDesign: ColumnDesignResult[],
  slabDesign: SlabDesignResultItem[],
): FireCheckResults {
  const fire = project.settings.fire
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const buildingHeight = levels.length > 0 ? levels[levels.length - 1].elevation : 0
  const trrfSuggested = requiredTRRF(fire.occupancy, buildingHeight)
  const trrf = fire.trrf === 'auto' ? trrfSuggested : fire.trrf

  if (!fire.enabled) {
    return {
      enabled: false,
      trrf,
      trrfSuggested,
      occupancy: fire.occupancy,
      buildingHeight,
      items: [],
      allOk: true,
      notes: ['Verificação de incêndio desativada nas configurações.'],
    }
  }

  const cover = coverFor(project.settings.caa)
  const items: FireCheckItem[] = []

  // ------------------------------------------------------------------ vigas
  for (const bd of beamDesign) {
    const bwMm = bd.section.bw * 1000
    const phi = bd.positive.barsPhi || 0.0125
    const c1 = (cover.beam + STIRRUP_PHI + phi / 2) * 1000
    const continuous = bd.negLeft !== null || bd.negRight !== null
    const r = checkBeamFire(bwMm, c1, trrf, continuous)
    items.push({
      element: `Viga ${bd.beamName} vão ${bd.spanIndex + 1}`,
      kind: 'viga',
      dim: bwMm,
      dimRequired: r.bMin,
      c1,
      c1Required: r.c1Required,
      ok: r.ok,
      notes: r.notes,
    })
  }

  // ------------------------------------------------------------------ lajes
  for (const sd of slabDesign) {
    const c1 = (cover.slab + 0.004) * 1000 // eixo da malha (φ8/2)
    const lambda =
      sd.rectangular && Math.min(sd.spanA, sd.spanB) > 0.01
        ? Math.max(sd.spanA, sd.spanB) / Math.min(sd.spanA, sd.spanB)
        : 2.5 // não retangular: trata como armada em uma direção (conservador)
    const tMean =
      sd.kind === 'nervurada' && sd.ribbedDesign
        ? sd.ribbedDesign.geometry.concreteThickness
        : sd.kind === 'trelicada' && sd.latticeDesign
          ? sd.latticeDesign.concreteThickness
          : null
    if (tMean !== null) {
      // simplificação conservadora: verifica o isolamento com a espessura
      // MÉDIA de concreto (capa + nervuras rateadas) como laje unidirecional
      const rSlab = checkSlabFire(
        Math.max(tMean * 1000, 40),
        c1,
        trrf,
        lambda,
        false,
      )
      items.push({
        element: `Laje ${sd.name} (${sd.levelName}) — capa`,
        kind: 'laje',
        dim: Math.round(tMean * 1000),
        dimRequired: rSlab.hMin,
        c1,
        c1Required: rSlab.c1Required,
        ok: rSlab.ok,
        notes: [
          ...rSlab.notes,
          `${sd.kind === 'trelicada' ? 'Treliçada' : 'Nervurada'}: espessura média de concreto usada p/ isolamento (conservador vs tab. 10/11 da NBR 15200).`,
        ],
      })
      continue
    }
    const hMm = sd.thickness * 1000
    const continuous =
      sd.design !== null && sd.design.dirA.fixedEnds + sd.design.dirB.fixedEnds > 0
    const r = checkSlabFire(hMm, c1, trrf, lambda, continuous)
    items.push({
      element: `Laje ${sd.name} (${sd.levelName})`,
      kind: 'laje',
      dim: hMm,
      dimRequired: r.hMin,
      c1,
      c1Required: r.c1Required,
      ok: r.ok,
      notes: r.notes,
    })
  }

  // ----------------------------------------------------------------- pilares
  let maxStory = 3
  for (let i = 1; i < levels.length; i++) {
    maxStory = Math.max(maxStory, levels[i].elevation - levels[i - 1].elevation)
  }
  for (const cd of columnDesign) {
    const info = columnSectionInfo(cd.section)
    // círculo: b = h = D; L: menor aba como largura efetiva (conservador)
    const isL = info.kind === 'L'
    const bMm = (isL ? info.minDim : Math.min(info.bu, info.bv)) * 1000
    const hMm = Math.max(info.bu, info.bv) * 1000
    const c1 = (cover.column + cd.stirrupPhi + cd.barsPhi / 2) * 1000
    // lef,fi = 0,7·lef do último pavimento (conservador p/ tramos intermediários: 0,5·lef)
    const lefFi = 0.7 * maxStory
    const muFi = Math.min(Math.max(0.7 * cd.utilization, 0.05), 1)
    const r = checkColumnFire(
      { b: bMm, h: hMm, c1, lefFi, muFi, nBars: cd.barsN },
      trrf,
    )
    const notes = [...r.notes]
    if (info.kind === 'circle') notes.push('Seção circular: método analítico com b = h = D.')
    if (isL) notes.push('Seção em L: largura efetiva = menor aba (conservador).')
    items.push({
      element: `Pilar ${cd.name}`,
      kind: 'pilar',
      dim: bMm,
      dimRequired: 190,
      c1,
      c1Required: 25,
      trf: r.trf,
      ok: r.ok,
      notes,
    })
  }

  const notes = [
    `TRRF adotado: ${trrf} min (sugerido NBR 14432 p/ grupo ${fire.occupancy}, h = ${buildingHeight.toFixed(1).replace('.', ',')} m: ${trrfSuggested} min).`,
    'Altura considerada = cota do último nível estrutural. Confirmar divisão de ocupação, isenções (NBR 14432 tab. 1) e exigências da IT do Corpo de Bombeiros local.',
    'c1 calculado com o arranjo de armadura adotado; revestimentos desprezados (a favor da segurança).',
    'Pilares: método analítico da NBR 15200 §8.4 com μfi = 0,7·(aproveitamento) e lef,fi = 0,7·pé-direito.',
  ]

  return {
    enabled: true,
    trrf,
    trrfSuggested,
    occupancy: fire.occupancy,
    buildingHeight,
    items,
    allOk: items.every((i) => i.ok),
    notes,
  }
}
