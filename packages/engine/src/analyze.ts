import type { Project } from './model/types'
import { buildAnalysisModel, slabOpeningsArea } from './analysis/buildModel'
import { numberDofs, solvePass } from './analysis/solve'
import { generateCombos } from './nbr/nbr8681/combinations'
import { concreteProps, coverFor, fyd as fydOf } from './nbr/nbr6118/materials'
import {
  designBeamFlexure,
  designBeamShear,
  designBeamTorsion,
  pickBars,
  skinReinforcement,
} from './nbr/nbr6118/beamDesign'
import { gammaZ, alphaParam } from './nbr/nbr6118/stability'
import { DRIFT_STORY_RATIO, DRIFT_TOP_RATIO } from './nbr/api'
import { runColumnDesign } from './design/columnRun'
import { runSlabDesign } from './design/slabRun'
import { runFoundationDesign } from './design/foundationRun'
import { runBeamService } from './design/serviceRun'
import { runDetailing } from './design/detailing'
import { runStairDesign } from './design/stairRun'
import { runTankDesign } from './design/tankRun'
import { runFireCheck } from './design/fireRun'
import { runOpeningChecks } from './design/openingsRun'
import { footingSprings, pileCapSprings } from './geotech/soil'
import { columnSectionInfo } from './model/columnSection'
import { ribbedGeometry } from './nbr/nbr6118/ribbedSlab'
import type {
  AnalysisResults,
  BeamSpanDesign,
  CaseId,
  CaseResult,
  DetailingResults,
  DriftResult,
  FlexureDesign,
  FoundationLoadRow,
  FoundationResultItem,
  GammaZResult,
  LoadCombo,
  MemberDiagrams,
  Quantities,
  Reaction,
  SlabDesignResultItem,
  SoilInteractionResults,
} from './analysis/types'
import { ALL_CASES } from './analysis/types'

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

const STEEL_DENSITY = 7850 // kg/m³

/** Análise completa: pórtico espacial + combinações + estabilidade + dimensionamento. */
export function analyze(project: Project): AnalysisResults {
  const t0 = now()
  const { model, internal } = buildAnalysisModel(project)
  if (model.members.length === 0) {
    throw new Error('Modelo vazio: adicione pilares e vigas antes de analisar.')
  }

  const hasWind = model.wind !== null && model.wind.length > 0
  const combos = generateCombos({
    hasWind,
    gammaG: 1.4,
    gammaGFav: 1.0,
    gammaQ: 1.4,
    psiLive: project.settings.psiLive,
    psiWind: project.settings.psiWind,
  })

  let system = numberDofs(model)
  model.stats.dofs = system.nDofs

  const activeCases: CaseId[] = hasWind ? ALL_CASES : ['G', 'Q']
  const eluPass = {
    beams: project.settings.stiffnessReduction.beams,
    columns: project.settings.stiffnessReduction.columns,
    useEci: true,
  }
  const elsPass = { beams: 1, columns: 1, useEci: false }
  let casesElu = solvePass(project, model, internal, system, eluPass, activeCases)
  let casesEls = solvePass(project, model, internal, system, elsPass, activeCases)

  // -------------------------------------------- interação solo-estrutura
  // 1º passe engastado dimensiona as fundações; delas nascem as molas
  // (CRV/CRH); o modelo é então re-analisado sobre apoios elásticos e as
  // fundações reavaliadas com as novas reações.
  let foundations = runFoundationDesign(project, model, casesEls)
  const soilInteraction = initSoilResults(project)
  if (project.settings.soilInteraction.enabled) {
    const assigned = assignFoundationSprings(project, model, foundations, soilInteraction)
    if (assigned > 0) {
      system = numberDofs(model)
      model.stats.dofs = system.nDofs
      casesElu = solvePass(project, model, internal, system, eluPass, activeCases)
      casesEls = solvePass(project, model, internal, system, elsPass, activeCases)
      foundations = runFoundationDesign(project, model, casesEls)
      model.warnings.push(
        `Interação solo-estrutura: ${assigned} apoio(s) sobre molas (CRV/CRH estimados da sondagem) — molas calculadas com as fundações do 1º passe engastado.`,
      )
    } else {
      soilInteraction.notes.push('Nenhum apoio recebeu molas (fundações sem resultados).')
    }
  }
  const cases = { elu: casesElu, els: casesEls }

  // ---------------------------------------------------------- estabilidade
  // (antes da envoltória: a majoração 0,95·γz de 2ª ordem altera os fatores
  //  de vento das combinações ELU — NBR 6118 §15.7.2)
  const stability = computeStability(project, model, combos, cases)
  stability.secondOrder = applySecondOrderAmplification(project, model, combos, stability)

  // ---------------------------------------------------------- envoltória ELU
  const eluCombos = combos.filter((c) => c.type === 'ELU')
  const nStations = model.members.length > 0 ? casesElu.G!.memberDiagrams[0].x.length : 0
  const fields = ['N', 'Vy', 'Vz', 'My', 'Mz', 'T'] as const
  const envelopeELU = {
    N: [] as { min: number[]; max: number[] }[],
    Vy: [] as { min: number[]; max: number[] }[],
    Vz: [] as { min: number[]; max: number[] }[],
    My: [] as { min: number[]; max: number[] }[],
    Mz: [] as { min: number[]; max: number[] }[],
    T: [] as { min: number[]; max: number[] }[],
  }
  for (let mi = 0; mi < model.members.length; mi++) {
    const env: Record<string, { min: number[]; max: number[] }> = {}
    for (const f of fields) {
      env[f] = {
        min: new Array(nStations).fill(Infinity),
        max: new Array(nStations).fill(-Infinity),
      }
    }
    for (const combo of eluCombos) {
      for (let s = 0; s < nStations; s++) {
        for (const f of fields) {
          let v = 0
          for (const [caseId, factor] of Object.entries(combo.factors)) {
            const cr = casesElu[caseId as CaseId]
            if (cr) v += factor * cr.memberDiagrams[mi][f][s]
          }
          if (v < env[f].min[s]) env[f].min[s] = v
          if (v > env[f].max[s]) env[f].max[s] = v
        }
      }
    }
    for (const f of fields) envelopeELU[f].push(env[f])
  }

  // ------------------------------------------------------- dimensionamento
  const beamDesign = designBeams(project, model, envelopeELU)
  const columnDesign = runColumnDesign(project, model, combos, casesElu)
  // momento desbalanceado laje→pilar (envoltória ELU) p/ punção com K·MSd
  // (§19.5.2): diferença entre os momentos do pilar abaixo (topo) e acima
  // (base) da ligação; envoltórias tratadas como independentes — conservador
  const jointMoments = new Map<string, { m1: number; m2: number }>()
  {
    const byCol = new Map<string, { li: number; mi: number }[]>()
    model.members.forEach((m, mi) => {
      if (m.ref.kind !== 'column') return
      const li = Math.min(model.nodes[m.ni].levelIndex, model.nodes[m.nj].levelIndex)
      const list = byCol.get(m.ref.sourceId) ?? []
      list.push({ li, mi })
      byCol.set(m.ref.sourceId, list)
    })
    const unbal = (
      e: { min: number[]; max: number[] }[],
      belowMi: number,
      aboveMi: number | undefined,
    ): number => {
      const eb = e[belowMi]
      const nb = eb.max.length - 1
      if (aboveMi === undefined) return Math.max(Math.abs(eb.max[nb]), Math.abs(eb.min[nb]))
      const ea = e[aboveMi]
      return Math.max(Math.abs(eb.max[nb] - ea.min[0]), Math.abs(ea.max[0] - eb.min[nb]))
    }
    for (const [colId, list] of byCol) {
      list.sort((a, b) => a.li - b.li)
      for (let i = 0; i < list.length; i++) {
        const below = list[i]
        const above = i + 1 < list.length ? list[i + 1] : undefined
        const my = unbal(envelopeELU.My, below.mi, above?.mi)
        const mz = unbal(envelopeELU.Mz, below.mi, above?.mi)
        jointMoments.set(`${colId}|${below.li + 1}`, {
          m1: Math.max(my, mz),
          m2: Math.min(my, mz),
        })
      }
    }
  }
  const slabDesign = runSlabDesign(project, jointMoments)
  const beamService = runBeamService(project, model, combos, casesEls, beamDesign)
  const stairDesign = runStairDesign(project)
  const tankDesign = runTankDesign(project)
  const fire = runFireCheck(project, beamDesign, columnDesign, slabDesign)
  const detailing = runDetailing(project, beamDesign, columnDesign)

  // ------------------------------------------------- furos de viga (§13.2.5)
  const beamOpenings = runOpeningChecks(project)
  for (const op of beamOpenings) {
    if (op.status === 'inadequada') {
      model.warnings.push(
        `Furo na viga ${op.beamName} (${op.planName}, x=${op.x.toFixed(2)} m): geometria INADEQUADA (§13.2.5.1).`,
      )
    } else if (op.status === 'verificar') {
      model.warnings.push(
        `Furo na viga ${op.beamName} (${op.planName}, x=${op.x.toFixed(2)} m): fora das condições de dispensa (§13.2.5.2) — verificação específica da região necessária.`,
      )
    }
  }

  // ----------------------------------------- recalques (ELS-QP, molas ativas)
  finishSoilResults(project, model, combos, casesEls, soilInteraction)

  // ------------------------- pressão no solo sob baldrames (Winkler, G+Q)
  if (model.winkler && model.winkler.length > 0) {
    const g = casesEls.G
    const q = casesEls.Q
    let pMax = 0
    for (const w of model.winkler) {
      const uz = (g?.displacements[w.nodeId][2] ?? 0) + (q?.displacements[w.nodeId][2] ?? 0)
      if (w.area > 1e-9) pMax = Math.max(pMax, (-uz * w.kz) / w.area)
    }
    const sigmaAdm = project.settings.soil.sigmaAdm
    if (pMax > sigmaAdm) {
      model.warnings.push(
        `Baldrames: pressão máxima no solo ${pMax.toFixed(0)} kPa > σadm = ${sigmaAdm.toFixed(0)} kPa — alargue a base ou revise o ks.`,
      )
    } else if (pMax > 0) {
      model.warnings.push(
        `Baldrames: pressão máxima no solo ${pMax.toFixed(0)} kPa ≤ σadm = ${sigmaAdm.toFixed(0)} kPa (serviço G+Q).`,
      )
    }
  }

  // --------------------------------------------- planta de cargas (fundação)
  const foundationLoads = computeFoundationLoads(project, model, combos, cases)

  // ----------------------------------------------------------- quantitativos
  const quantities = computeQuantities(project, model, detailing, slabDesign)

  const elapsedMs = now() - t0
  return {
    model,
    combos,
    cases,
    envelopeELU,
    stability,
    beamDesign,
    columnDesign,
    slabDesign,
    foundations,
    beamService,
    stairDesign,
    tankDesign,
    fire,
    detailing,
    quantities,
    beamOpenings,
    soilInteraction,
    foundationLoads,
    warnings: model.warnings,
    elapsedMs,
  }
}

// ---------------------------------------------------------------------------
// interação solo-estrutura — molas por fundação e recalques
// ---------------------------------------------------------------------------

function initSoilResults(project: Project): SoilInteractionResults {
  const enabled = project.settings.soilInteraction.enabled
  return {
    enabled,
    items: [],
    maxSettlement: 0,
    maxDistortion: null,
    notes: enabled
      ? [
          'CRV/CRH estimados da sondagem (Es = α·K·NSPT — Teixeira & Godoy; estacas por Aoki–Velloso). Projeto executivo exige laudo geotécnico (NBR 6122).',
        ]
      : [],
  }
}

/** nó de apoio (base) do pilar */
function baseNodeOf(model: AnalysisResults['model'], col: Project['columns'][number]) {
  return model.nodes.find(
    (n) => n.support && Math.abs(n.x - col.pos.x) < 0.05 && Math.abs(n.y - col.pos.y) < 0.05,
  )
}

/** calcula e instala as molas nos nós de apoio; retorna quantos receberam */
function assignFoundationSprings(
  project: Project,
  model: AnalysisResults['model'],
  foundations: FoundationResultItem[],
  soil: SoilInteractionResults,
): number {
  const params = project.settings.soilInteraction
  let assigned = 0
  for (const f of foundations) {
    const col = project.columns.find((c) => c.id === f.columnId)
    if (!col) continue
    const node = baseNodeOf(model, col)
    if (!node) continue
    // direção "a" da fundação = direção h do pilar (rot 0/180 → ao longo de X)
    const aAlongX = col.rotationDeg === 0 || col.rotationDeg === 180
    const springs =
      f.kind === 'sapata' && f.footing
        ? footingSprings(f.footing.a, f.footing.b, params, aAlongX)
        : f.kind === 'tubulao' && f.caisson
          ? // base circular ≈ quadrado de área equivalente (lado 0,886·D)
            footingSprings(0.886 * f.caisson.baseD, 0.886 * f.caisson.baseD, params, aAlongX)
          : f.pileCap
            ? pileCapSprings(
                f.pileCap.nPiles,
                f.pileCap.e,
                project.settings.foundation,
                params,
                aAlongX,
              )
            : null
    if (!springs) continue
    node.springs = [springs.kh, springs.kh, springs.kv, springs.krx, springs.kry, springs.krz]
    assigned++
    soil.items.push({
      columnId: col.id,
      name: col.name,
      kind: f.kind,
      kv: springs.kv,
      kh: springs.kh,
      krx: springs.krx,
      kry: springs.kry,
      krz: springs.krz,
      settlementQP: 0,
      notes: springs.notes,
    })
  }
  return assigned
}

/** recalques na combinação quase-permanente + distorções angulares */
function finishSoilResults(
  project: Project,
  model: AnalysisResults['model'],
  combos: LoadCombo[],
  casesEls: Partial<Record<CaseId, CaseResult>>,
  soil: SoilInteractionResults,
): void {
  if (!soil.enabled || soil.items.length === 0) return
  const qp = combos.find((c) => c.type === 'ELS-QP')
  if (!qp) return
  const uzOf = (nodeId: number): number => {
    let s = 0
    for (const [caseId, factor] of Object.entries(qp.factors)) {
      const cr = casesEls[caseId as CaseId]
      if (cr) s += factor * cr.displacements[nodeId][2]
    }
    return s
  }
  const pos = new Map<string, { x: number; y: number; s: number }>()
  for (const item of soil.items) {
    const col = project.columns.find((c) => c.id === item.columnId)
    if (!col) continue
    const node = baseNodeOf(model, col)
    if (!node) continue
    const settlement = Math.max(0, -uzOf(node.id))
    item.settlementQP = settlement
    soil.maxSettlement = Math.max(soil.maxSettlement, settlement)
    pos.set(item.columnId, { x: col.pos.x, y: col.pos.y, s: settlement })
  }
  // distorção angular máxima entre pares de pilares (limite usual 1/500)
  const entries = [...pos.entries()]
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i]
      const [idB, b] = entries[j]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < 0.5) continue
      const dist = Math.abs(a.s - b.s) / d
      if (!soil.maxDistortion || dist > soil.maxDistortion.value) {
        const nameA = soil.items.find((it) => it.columnId === idA)?.name ?? '?'
        const nameB = soil.items.find((it) => it.columnId === idB)?.name ?? '?'
        soil.maxDistortion = { value: dist, pair: `${nameA}–${nameB}` }
      }
    }
  }
  if (soil.maxDistortion && soil.maxDistortion.value > 1 / 500) {
    model.warnings.push(
      `Recalque diferencial: distorção ${soil.maxDistortion.pair} = 1/${Math.round(
        1 / soil.maxDistortion.value,
      )} > 1/500 — avaliar fundações/rigidez.`,
    )
  }
}

// ---------------------------------------------------------------------------
// planta de cargas na fundação (reações características por caso)
// ---------------------------------------------------------------------------

function computeFoundationLoads(
  project: Project,
  model: AnalysisResults['model'],
  combos: LoadCombo[],
  cases: AnalysisResults['cases'],
): FoundationLoadRow[] {
  const out: FoundationLoadRow[] = []
  const eluCombos = combos.filter((c) => c.type === 'ELU')
  for (const col of project.columns) {
    const node = baseNodeOf(model, col)
    if (!node) continue
    const rows: FoundationLoadRow['cases'] = []
    for (const caseId of ALL_CASES) {
      const cr = cases.els[caseId]
      if (!cr) continue
      const r = cr.reactions.find((x) => x.nodeId === node.id)
      if (!r) continue
      rows.push({ caseId, fx: r.fx, fy: r.fy, fz: r.fz, mx: r.mx, my: r.my, mz: r.mz })
    }
    if (rows.length === 0) continue
    const fzOf = (caseId: CaseId): number =>
      rows.find((r) => r.caseId === caseId)?.fz ?? 0
    let fzEluMax = 0
    for (const combo of eluCombos) {
      let fz = 0
      for (const [caseId, factor] of Object.entries(combo.factors)) {
        const cr = cases.elu[caseId as CaseId]
        const r = cr?.reactions.find((x) => x.nodeId === node.id)
        if (r) fz += factor * r.fz
      }
      fzEluMax = Math.max(fzEluMax, fz)
    }
    out.push({
      columnId: col.id,
      name: col.name,
      x: col.pos.x,
      y: col.pos.y,
      cases: rows,
      fzEluMax,
      fzServ: fzOf('G') + fzOf('Q'),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

// ---------------------------------------------------------------------------
// superposição p/ combinações (análise linear)
// ---------------------------------------------------------------------------

function comboOf(results: AnalysisResults, comboId: string): LoadCombo {
  const combo = results.combos.find((c) => c.id === comboId)
  if (!combo) throw new Error(`Combinação desconhecida: ${comboId}`)
  return combo
}

export function comboDisplacements(results: AnalysisResults, comboId: string): number[][] {
  const combo = comboOf(results, comboId)
  const pass = results.cases[combo.stiffness]
  const n = results.model.nodes.length
  const out: number[][] = Array.from({ length: n }, () => [0, 0, 0, 0, 0, 0])
  for (const [caseId, factor] of Object.entries(combo.factors)) {
    const cr = pass[caseId as CaseId]
    if (!cr) continue
    for (let i = 0; i < n; i++) {
      const u = cr.displacements[i]
      const o = out[i]
      for (let d = 0; d < 6; d++) o[d] += factor * u[d]
    }
  }
  return out
}

export function comboDiagrams(results: AnalysisResults, comboId: string): MemberDiagrams[] {
  const combo = comboOf(results, comboId)
  const pass = results.cases[combo.stiffness]
  const base = pass.G ?? Object.values(pass)[0]
  if (!base) throw new Error('Sem resultados de casos de carga.')
  return results.model.members.map((_, mi) => {
    const x = base.memberDiagrams[mi].x
    const out: MemberDiagrams = {
      x: [...x],
      N: new Array(x.length).fill(0),
      Vy: new Array(x.length).fill(0),
      Vz: new Array(x.length).fill(0),
      T: new Array(x.length).fill(0),
      My: new Array(x.length).fill(0),
      Mz: new Array(x.length).fill(0),
    }
    for (const [caseId, factor] of Object.entries(combo.factors)) {
      const cr = pass[caseId as CaseId]
      if (!cr) continue
      const d = cr.memberDiagrams[mi]
      for (let s = 0; s < x.length; s++) {
        out.N[s] += factor * d.N[s]
        out.Vy[s] += factor * d.Vy[s]
        out.Vz[s] += factor * d.Vz[s]
        out.T[s] += factor * d.T[s]
        out.My[s] += factor * d.My[s]
        out.Mz[s] += factor * d.Mz[s]
      }
    }
    return out
  })
}

export function comboReactions(results: AnalysisResults, comboId: string): Reaction[] {
  const combo = comboOf(results, comboId)
  const pass = results.cases[combo.stiffness]
  const acc = new Map<number, Reaction>()
  for (const [caseId, factor] of Object.entries(combo.factors)) {
    const cr = pass[caseId as CaseId]
    if (!cr) continue
    for (const r of cr.reactions) {
      const a =
        acc.get(r.nodeId) ?? { nodeId: r.nodeId, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }
      a.fx += factor * r.fx
      a.fy += factor * r.fy
      a.fz += factor * r.fz
      a.mx += factor * r.mx
      a.my += factor * r.my
      a.mz += factor * r.mz
      acc.set(r.nodeId, a)
    }
  }
  return [...acc.values()].sort((a, b) => a.nodeId - b.nodeId)
}

// ---------------------------------------------------------------------------
// estabilidade global
// ---------------------------------------------------------------------------

function levelLateralDisp(
  results: { model: AnalysisResults['model'] },
  disp: number[][],
  levelIndex: number,
  dof: 0 | 1,
): number {
  const masters = results.model.masters.find((m) => m.levelIndex === levelIndex)
  if (masters) return disp[masters.nodeId][dof]
  const nodes = results.model.nodes.filter(
    (n) => n.levelIndex === levelIndex && n.kind === 'structural',
  )
  if (nodes.length === 0) return 0
  return nodes.reduce((s, n) => s + disp[n.id][dof], 0) / nodes.length
}

function computeStability(
  project: Project,
  model: AnalysisResults['model'],
  combos: LoadCombo[],
  cases: AnalysisResults['cases'],
): AnalysisResults['stability'] {
  const gammaZResults: GammaZResult[] = []
  const drift: DriftResult[] = []
  const alpha: AnalysisResults['stability']['alpha'] = []

  const noSecondOrder = { applied: false, factors: [], notes: [] }
  if (!model.wind || model.wind.length === 0) {
    return { gammaZ: [], alpha: [], drift: [], secondOrder: noSecondOrder }
  }

  const fake: AnalysisResults = { model } as AnalysisResults
  const dirLabel: Record<string, GammaZResult['dir']> = {
    WXP: 'X+',
    WXN: 'X-',
    WYP: 'Y+',
    WYN: 'Y-',
  }

  // γz — combinações "vento principal" (ELU3)
  for (const combo of combos.filter((c) => c.type === 'ELU' && c.id.startsWith('ELU3'))) {
    const windCase = (Object.keys(combo.factors) as CaseId[]).find((k) => k.startsWith('W'))
    if (!windCase) continue
    const wd = model.wind.find((w) => `W${w.dir}` === windCase)
    if (!wd) continue
    const γw = combo.factors[windCase] ?? 0
    const fG = combo.factors.G ?? 0
    const fQ = combo.factors.Q ?? 0
    const dof: 0 | 1 = windCase.startsWith('WX') ? 0 : 1

    // M1: momento de tombamento de cálculo
    let m1 = 0
    for (const lf of wd.perLevel) m1 += γw * lf.F * lf.z

    // ΔM: Σ Pd·δ (deslocamentos da própria combinação, passe ELU)
    const disp = model.nodes.map(() => [0, 0, 0, 0, 0, 0])
    for (const [caseId, factor] of Object.entries(combo.factors)) {
      const cr = cases.elu[caseId as CaseId]
      if (!cr) continue
      for (let i = 0; i < disp.length; i++) {
        for (let d = 0; d < 6; d++) disp[i][d] += factor * cr.displacements[i][d]
      }
    }
    let deltaM = 0
    for (const lw of model.levelWeights) {
      const pd = fG * lw.G + fQ * lw.Q
      const δ = Math.abs(levelLateralDisp(fake, disp, lw.levelIndex, dof))
      deltaM += pd * δ
    }
    const gz = gammaZ({ m1: Math.abs(m1), deltaM })
    gammaZResults.push({
      dir: dirLabel[windCase],
      comboId: combo.id,
      comboLabel: combo.label,
      m1: Math.abs(m1),
      deltaM,
      value: gz.value,
      classification: gz.classification,
    })
  }

  // α — parâmetro de instabilidade (rigidez equivalente pelo deslocamento de topo, ELS)
  const H = model.nodes.reduce((s, n) => Math.max(s, n.z), 0)
  const nFloors = model.levelWeights.length
  const nk = model.levelWeights.reduce((s, lw) => s + lw.G + lw.Q, 0)
  for (const dirCase of ['WXP', 'WYP'] as const) {
    const cr = cases.els[dirCase]
    const wd = model.wind.find((w) => `W${w.dir}` === dirCase)
    if (!cr || !wd || wd.totalForce <= 0) continue
    const dof: 0 | 1 = dirCase === 'WXP' ? 0 : 1
    const topLevel = model.levelWeights[model.levelWeights.length - 1].levelIndex
    const aTop = Math.abs(levelLateralDisp(fake, cr.displacements, topLevel, dof))
    if (aTop < 1e-9) continue
    // carregamento ~uniforme equivalente: a = W·H³/(8EI) → EI = W·H³/(8a)
    const eiEq = (wd.totalForce * H * H * H) / (8 * aTop)
    const res = alphaParam({ totalHeight: H, nk, eiEq, n: nFloors })
    alpha.push({ dir: dirCase === 'WXP' ? 'x' : 'y', value: res.value, limit: res.limit, ok: res.ok, eiEq })
  }

  // deslocamentos laterais (ELS vento)
  for (const combo of combos.filter((c) => c.type === 'ELS-VENTO')) {
    const windCase = (Object.keys(combo.factors) as CaseId[]).find((k) => k.startsWith('W'))
    if (!windCase) continue
    const dof: 0 | 1 = windCase.startsWith('WX') ? 0 : 1
    const disp = model.nodes.map(() => [0, 0, 0, 0, 0, 0])
    for (const [caseId, factor] of Object.entries(combo.factors)) {
      const cr = cases.els[caseId as CaseId]
      if (!cr) continue
      for (let i = 0; i < disp.length; i++) {
        for (let d = 0; d < 6; d++) disp[i][d] += factor * cr.displacements[i][d]
      }
    }
    const stories: DriftResult['stories'] = []
    let prev = 0
    let prevZ = 0
    let allOk = true
    const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
    for (const lw of model.levelWeights) {
      const δ = levelLateralDisp(fake, disp, lw.levelIndex, dof)
      const rel = δ - prev
      const hi = lw.z - prevZ
      const relLimit = hi * DRIFT_STORY_RATIO
      const ok = Math.abs(rel) <= relLimit
      if (!ok) allOk = false
      stories.push({
        levelIndex: lw.levelIndex,
        levelName: levels[lw.levelIndex]?.name ?? `Nível ${lw.levelIndex}`,
        z: lw.z,
        disp: δ,
        rel,
        relLimit,
        ok,
      })
      prev = δ
      prevZ = lw.z
    }
    const topDisp = stories.length > 0 ? stories[stories.length - 1].disp : 0
    const topLimit = H * DRIFT_TOP_RATIO
    const topOk = Math.abs(topDisp) <= topLimit
    drift.push({
      comboId: combo.id,
      comboLabel: combo.label,
      dir: dirLabel[windCase],
      topDisp,
      topLimit,
      stories,
      ok: topOk && allOk,
    })
  }

  return { gammaZ: gammaZResults, alpha, drift, secondOrder: noSecondOrder }
}

// ---------------------------------------------------------------------------
// 2ª ordem global aproximada — NBR 6118 §15.7.2 (0,95·γz)
// ---------------------------------------------------------------------------

/**
 * Para 1,1 < γz ≤ 1,3, os esforços globais finais (1ª + 2ª ordem) podem ser
 * obtidos majorando os esforços horizontais das combinações ELU por 0,95·γz.
 * A majoração é aplicada diretamente nos fatores dos casos de vento das
 * combinações ELU (a análise é linear — superposição). γz > 1,3 está fora do
 * campo de validade → aviso p/ análise rigorosa (P-Δ).
 */
function applySecondOrderAmplification(
  project: Project,
  model: AnalysisResults['model'],
  combos: LoadCombo[],
  stability: AnalysisResults['stability'],
): AnalysisResults['stability']['secondOrder'] {
  const notes: string[] = []
  const factors: AnalysisResults['stability']['secondOrder']['factors'] = []
  if (stability.gammaZ.length === 0) {
    return { applied: false, factors, notes }
  }

  const caseOfDir: Record<GammaZResult['dir'], CaseId> = {
    'X+': 'WXP',
    'X-': 'WXN',
    'Y+': 'WYP',
    'Y-': 'WYN',
  }
  let applied = false
  for (const gz of stability.gammaZ) {
    let factor = 1
    if (gz.classification === 'nos-moveis') {
      factor = Math.max(1, 0.95 * gz.value)
      if (!project.settings.secondOrderGammaZ) {
        factor = 1
        notes.push(
          `γz ${gz.dir} = ${gz.value.toFixed(2)} > 1,10 — majoração 0,95·γz DESATIVADA nas configurações.`,
        )
      }
    } else if (gz.classification === 'invalido') {
      notes.push(
        `γz ${gz.dir} > 1,30 — fora do campo de validade da majoração 0,95·γz; ` +
          'necessária análise de 2ª ordem rigorosa (P-Δ) ou enrijecimento da estrutura.',
      )
      model.warnings.push(
        `Estabilidade: γz na direção ${gz.dir} excede 1,30 — resultados ELU sem 2ª ordem global.`,
      )
    }
    factors.push({ dir: gz.dir, gammaZ: gz.value, factor })
    if (factor > 1) {
      applied = true
      const caseId = caseOfDir[gz.dir]
      for (const combo of combos) {
        if (combo.type !== 'ELU') continue
        const f = combo.factors[caseId]
        if (f !== undefined) {
          combo.factors[caseId] = f * factor
          combo.label += combo.label.includes('×0,95γz') ? '' : ' (W×0,95γz)'
        }
      }
    }
  }
  if (applied) {
    notes.push(
      'Esforços horizontais das combinações ELU majorados por 0,95·γz (§15.7.2) — estrutura de nós móveis.',
    )
  }
  return { applied, factors, notes }
}

// ---------------------------------------------------------------------------
// dimensionamento de vigas (por vão) — NBR 6118
// ---------------------------------------------------------------------------

function designBeams(
  project: Project,
  model: AnalysisResults['model'],
  env: AnalysisResults['envelopeELU'],
): BeamSpanDesign[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const cover = coverFor(project.settings.caa).beam
  const out: BeamSpanDesign[] = []

  // agrupa membros por (nível, viga, vão) — dimensiona apenas o 1º nível que
  // usa cada planta (pavimento tipo ⇒ resultados praticamente iguais)
  const groups = new Map<string, number[]>()
  const seenLevelByBeam = new Map<string, number>()
  model.members.forEach((m, mi) => {
    if (m.ref.kind !== 'beam') return
    const li = model.nodes[m.ni].levelIndex
    const seen = seenLevelByBeam.get(m.ref.sourceId)
    if (seen === undefined) seenLevelByBeam.set(m.ref.sourceId, li)
    else if (seen !== li) return
    const key = `${m.ref.sourceId}|${m.ref.spanIndex}`
    const list = groups.get(key) ?? []
    list.push(mi)
    groups.set(key, list)
  })

  for (const [key, memberIds] of groups) {
    memberIds.sort((a, b) => a - b)
    const first = model.members[memberIds[0]]
    const { bw, h } = first.section
    const d = Math.max(h - cover - 0.0063 - 0.008, 0.5 * h)
    const length = memberIds.reduce((s, mi) => s + model.members[mi].length, 0)

    let mdPos = 0
    let vd = 0
    let td = 0
    for (const mi of memberIds) {
      const e = env.Mz[mi]
      for (let s = 0; s < e.max.length; s++) mdPos = Math.max(mdPos, e.max[s])
      const ev = env.Vy[mi]
      for (let s = 0; s < ev.max.length; s++) {
        vd = Math.max(vd, Math.abs(ev.max[s]), Math.abs(ev.min[s]))
      }
      const et = env.T[mi]
      for (let s = 0; s < et.max.length; s++) {
        td = Math.max(td, Math.abs(et.max[s]), Math.abs(et.min[s]))
      }
    }
    const firstEnv = env.Mz[memberIds[0]]
    const lastEnv = env.Mz[memberIds[memberIds.length - 1]]
    const mdNegLeft = Math.max(0, -firstEnv.min[0])
    const mdNegRight = Math.max(0, -lastEnv.min[lastEnv.min.length - 1])

    // envoltória de Mz amostrada ao longo do vão (x desde o apoio esquerdo)
    // → pontos de corte REAIS dos negativos: momento nulo e 50% do momento
    // do apoio (§18.3.2.4 — o detalhamento soma al + lb,nec ao corte teórico)
    const mzMin: { x: number; v: number }[] = []
    {
      let xBase = 0
      for (const mi of memberIds) {
        const e = env.Mz[mi]
        const len = model.members[mi].length
        const nS = e.min.length
        for (let s = 0; s < nS; s++) {
          mzMin.push({ x: xBase + (nS > 1 ? (len * s) / (nS - 1) : 0), v: e.min[s] })
        }
        xBase += len
      }
    }
    const cutDist = (fromLeft: boolean, mdSup: number): { zero: number; half: number } => {
      let zero = 0
      let half = 0
      for (let i = 0; i < mzMin.length; i++) {
        const p = mzMin[fromLeft ? i : mzMin.length - 1 - i]
        const dist = fromLeft ? p.x : length - p.x
        if (p.v < -1e-6) zero = dist
        else break // primeiro ponto sem tração em cima: fim da região negativa
        if (p.v < -0.5 * mdSup) half = dist
      }
      return { zero, half }
    }

    const flexInput = { bw, h, d, fcd: cp.fcd, fyd: fydV, fck: cp.fck }
    const mkFlex = (md: number): FlexureDesign => {
      const r = designBeamFlexure({ md, ...flexInput })
      const asFinal = Math.max(r.as, r.asMin)
      const bars = pickBars(asFinal, bw, cover)
      return {
        md,
        as: asFinal,
        asProvided: bars.asProvided,
        asMin: r.asMin,
        xd: r.xd,
        bars: bars.spec,
        barsN: bars.n,
        barsPhi: bars.phi,
        ok: r.ok,
        note: r.note,
      }
    }
    const positive = mkFlex(mdPos)
    const withCut = (f: FlexureDesign, fromLeft: boolean, mdSup: number): FlexureDesign => {
      const c = cutDist(fromLeft, mdSup)
      return { ...f, cutZero: c.zero, cutHalf: c.half }
    }
    const negLeft = mdNegLeft > 0.5 ? withCut(mkFlex(mdNegLeft), true, mdNegLeft) : null
    const negRight = mdNegRight > 0.5 ? withCut(mkFlex(mdNegRight), false, mdNegRight) : null

    const shearR = designBeamShear({
      vd,
      bw,
      d,
      fck: cp.fck,
      fcd: cp.fcd,
      fctd: cp.fctd,
      fywd: Math.min(fydV, 435_000),
      fctm: cp.fctm,
      fywk: project.settings.steel.fyk,
    })

    // torção (§17.5) — envoltória de T combinada ao cortante na biela
    const torsionR = designBeamTorsion({
      td,
      vd,
      vrd2: shearR.vrd2,
      bw,
      h,
      c1: cover + 0.0063 + 0.008,
      fck: cp.fck,
      fcd: cp.fcd,
      fctd: cp.fctd,
      fywd: Math.min(fydV, 435_000),
      fyd: fydV,
    })

    // estribos: cisalhamento (2 ramos) + torção (2·A90/s, um por ramo)
    const aswS = Math.max(shearR.aswS, shearR.aswSMin) + 2 * torsionR.a90S
    // estribo φ5 (2 ramos): espaçamento s = 2·Aφ/AswS
    const phiT = 0.005
    const aPhi = (Math.PI * phiT * phiT) / 4
    let spacing = Math.min((2 * aPhi) / aswS, shearR.sMax)
    spacing = Math.floor(spacing * 100) / 100
    const stirrupSpec = `φ5 c/ ${Math.max(5, Math.round(spacing * 100))}`

    // armadura de pele (§17.3.5.2.3)
    const skin = skinReinforcement(bw, h)

    // massa de aço estimada do vão
    const stirrupPerimeter = 2 * (bw + h - 4 * cover) + 0.1
    const steelVol =
      positive.as * length +
      (negLeft?.as ?? 0) * 0.3 * length +
      (negRight?.as ?? 0) * 0.3 * length +
      (aswS / 2) * stirrupPerimeter * length +
      torsionR.asl * length +
      2 * skin.asPerFace * length
    const steelKg = steelVol * STEEL_DENSITY * 1.1 // +10% perdas/ancoragens

    const fail =
      !positive.ok || !(negLeft?.ok ?? true) || !(negRight?.ok ?? true) || !shearR.ok || !torsionR.ok
    const warn = positive.xd > 0.35 || vd > 0.9 * shearR.vrd2 || torsionR.interaction > 0.9
    const [beamId] = key.split('|')

    out.push({
      beamId,
      beamName: first.ref.sourceName,
      spanIndex: first.ref.spanIndex,
      length,
      section: first.section,
      positive,
      negLeft,
      negRight,
      shear: {
        vd,
        vrd2: shearR.vrd2,
        vc: shearR.vc,
        aswS,
        aswSMin: shearR.aswSMin,
        spec: stirrupSpec,
        ok: shearR.ok,
      },
      torsion: {
        td: torsionR.td,
        he: torsionR.he,
        trd2: torsionR.trd2,
        a90S: torsionR.a90S,
        asl: torsionR.asl,
        interaction: torsionR.interaction,
        ok: torsionR.ok,
        negligible: torsionR.negligible,
      },
      skin,
      steelKg,
      status: fail ? 'falha' : warn ? 'atencao' : 'ok',
    })
  }

  return out.sort(
    (a, b) => a.beamName.localeCompare(b.beamName, 'pt-BR', { numeric: true }) || a.spanIndex - b.spanIndex,
  )
}

// ---------------------------------------------------------------------------
// quantitativos
// ---------------------------------------------------------------------------

function computeQuantities(
  project: Project,
  model: AnalysisResults['model'],
  detailing: DetailingResults,
  slabDesign: SlabDesignResultItem[],
): Quantities {
  let volColumns = 0
  let volBeams = 0
  let volSlabs = 0
  let formwork = 0
  let slabAreaTotal = 0

  for (const m of model.members) {
    const { bw, h } = m.section
    const a = m.props?.A ?? bw * h
    if (m.ref.kind === 'column') {
      volColumns += a * m.length
      formwork += (m.props?.perimeter ?? 2 * (bw + h)) * m.length
    } else {
      volBeams += a * m.length
      formwork += (bw + 2 * h) * m.length
    }
  }
  const levels = [...project.levels].sort((x, y) => x.elevation - y.elevation)
  for (const level of levels) {
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    for (const slab of plan.slabs) {
      const area = Math.abs(
        slab.polygon.reduce((s, p, i) => {
          const q = slab.polygon[(i + 1) % slab.polygon.length]
          return s + (p.x * q.y - q.x * p.y)
        }, 0) / 2,
      )
      // furos/aberturas não têm concreto nem fôrma; nervurada usa o volume real
      const net = Math.max(area - slabOpeningsArea(plan, slab), 0)
      const tConcrete = slab.ribbed
        ? ribbedGeometry(slab.thickness, slab.ribbed).concreteThickness
        : slab.thickness
      volSlabs += net * tConcrete
      formwork += net
      slabAreaTotal += net
    }
  }

  // aço de vigas e pilares: tabela de aço do detalhamento (posições reais)
  let steelBeams = 0
  let steelColumns = 0
  for (const it of detailing.steel.items) {
    if (it.element.startsWith('Viga')) steelBeams += it.kg
    else if (it.element.startsWith('Pilar')) steelColumns += it.kg
  }

  // lajes: malhas dimensionadas (Marcus) × pavimentos que usam a planta;
  // fator 1,4 cobre negativas/ancoragens; não-retangulares por taxa típica
  const levelsPerPlan = new Map<string, number>()
  for (const level of levels) {
    if (level.planId) levelsPerPlan.set(level.planId, (levelsPerPlan.get(level.planId) ?? 0) + 1)
  }
  const slabPlanOf = new Map<string, string>()
  const slabAreaOf = new Map<string, number>()
  const slabById = new Map<string, Project['plans'][number]['slabs'][number]>()
  for (const plan of project.plans) {
    for (const s of plan.slabs) {
      slabPlanOf.set(s.id, plan.id)
      slabById.set(s.id, s)
      slabAreaOf.set(
        s.id,
        Math.abs(
          s.polygon.reduce((acc, p, i) => {
            const q = s.polygon[(i + 1) % s.polygon.length]
            return acc + (p.x * q.y - q.x * p.y)
          }, 0) / 2,
        ),
      )
    }
  }
  let steelSlabs = 0
  for (const sd of slabDesign) {
    const reps = levelsPerPlan.get(slabPlanOf.get(sd.slabId) ?? '') ?? 1
    const area = slabAreaOf.get(sd.slabId) ?? 0
    if (sd.design) {
      steelSlabs +=
        (sd.design.dirA.asSpan + sd.design.dirB.asSpan) * area * 7850 * 1.4 * reps
    } else if (sd.ribbedDesign) {
      // As por metro = As por nervura / espaçamento em cada direção;
      // fator 1,4 cobre negativos, distribuição da capa e ancoragens
      const rd = sd.ribbedDesign
      const spacing = slabById.get(sd.slabId)?.ribbed?.spacing ?? 0.5
      const asPerM = (rd.dirA.asRib + rd.dirB.asRib) / Math.max(spacing, 0.2)
      steelSlabs += asPerM * area * 7850 * 1.4 * reps
    } else {
      steelSlabs += area * sd.thickness * 85 * reps // taxa típica p/ não-retangular
    }
  }
  const total = volColumns + volBeams + volSlabs
  const steelTotal = steelBeams + steelColumns + steelSlabs

  // estimativa de custo (custos unitários das configurações)
  const uc = project.settings.costs
  const costConcrete = total * uc.concretePerM3
  const costSteel = steelTotal * 1.1 * uc.steelPerKg // +10% perdas (como na tabela de aço)
  const costFormwork = formwork * uc.formworkPerM2
  const costTotal = costConcrete + costSteel + costFormwork

  return {
    concrete: { columns: volColumns, beams: volBeams, slabs: volSlabs, total },
    formwork,
    steel: {
      beamsDesigned: steelBeams,
      columnsEstimated: steelColumns,
      slabsEstimated: steelSlabs,
      total: steelTotal,
      ratePerM3: total > 0 ? steelTotal / total : 0,
    },
    cost: {
      enabled: uc.enabled,
      concrete: costConcrete,
      steel: costSteel,
      formwork: costFormwork,
      total: costTotal,
      perSlabArea: slabAreaTotal > 1 ? costTotal / slabAreaTotal : null,
    },
  }
}
