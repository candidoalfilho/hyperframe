import type { Project } from './model/types'
import { buildAnalysisModel } from './analysis/buildModel'
import { numberDofs, solvePass } from './analysis/solve'
import { generateCombos } from './nbr/nbr8681/combinations'
import { concreteProps, coverFor, fyd as fydOf } from './nbr/nbr6118/materials'
import { designBeamFlexure, designBeamShear, pickBars } from './nbr/nbr6118/beamDesign'
import { alphaParam, gammaZ } from './nbr/nbr6118/stability'
import { DRIFT_STORY_RATIO, DRIFT_TOP_RATIO } from './nbr/api'
import type {
  AnalysisResults,
  BeamSpanDesign,
  CaseId,
  CaseResult,
  ColumnCheck,
  DriftResult,
  FlexureDesign,
  GammaZResult,
  LoadCombo,
  MemberDiagrams,
  Quantities,
  Reaction,
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

  const system = numberDofs(model)
  model.stats.dofs = system.nDofs

  const activeCases: CaseId[] = hasWind ? ALL_CASES : ['G', 'Q']
  const casesElu = solvePass(
    project,
    model,
    internal,
    system,
    {
      beams: project.settings.stiffnessReduction.beams,
      columns: project.settings.stiffnessReduction.columns,
      useEci: true,
    },
    activeCases,
  )
  const casesEls = solvePass(
    project,
    model,
    internal,
    system,
    { beams: 1, columns: 1, useEci: false },
    activeCases,
  )
  const cases = { elu: casesElu, els: casesEls }

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

  // ---------------------------------------------------------- estabilidade
  const stability = computeStability(project, model, combos, cases)

  // ------------------------------------------------------- dimensionamento
  const beamDesign = designBeams(project, model, envelopeELU)
  const columnChecks = checkColumns(project, model, envelopeELU)

  // ----------------------------------------------------------- quantitativos
  const quantities = computeQuantities(project, model, beamDesign)

  const elapsedMs = now() - t0
  return {
    model,
    combos,
    cases,
    envelopeELU,
    stability,
    beamDesign,
    columnChecks,
    quantities,
    warnings: model.warnings,
    elapsedMs,
  }
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

  if (!model.wind || model.wind.length === 0) {
    return { gammaZ: [], alpha: [], drift: [] }
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

  return { gammaZ: gammaZResults, alpha, drift }
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
    for (const mi of memberIds) {
      const e = env.Mz[mi]
      for (let s = 0; s < e.max.length; s++) mdPos = Math.max(mdPos, e.max[s])
      const ev = env.Vy[mi]
      for (let s = 0; s < ev.max.length; s++) {
        vd = Math.max(vd, Math.abs(ev.max[s]), Math.abs(ev.min[s]))
      }
    }
    const firstEnv = env.Mz[memberIds[0]]
    const lastEnv = env.Mz[memberIds[memberIds.length - 1]]
    const mdNegLeft = Math.max(0, -firstEnv.min[0])
    const mdNegRight = Math.max(0, -lastEnv.min[lastEnv.min.length - 1])

    const flexInput = { bw, h, d, fcd: cp.fcd, fyd: fydV, fck: cp.fck }
    const mkFlex = (md: number): FlexureDesign => {
      const r = designBeamFlexure({ md, ...flexInput })
      const asFinal = Math.max(r.as, r.asMin)
      const bars = pickBars(asFinal, bw, cover)
      return {
        md,
        as: asFinal,
        asMin: r.asMin,
        xd: r.xd,
        bars: bars.spec,
        ok: r.ok,
        note: r.note,
      }
    }
    const positive = mkFlex(mdPos)
    const negLeft = mdNegLeft > 0.5 ? mkFlex(mdNegLeft) : null
    const negRight = mdNegRight > 0.5 ? mkFlex(mdNegRight) : null

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
    const aswS = Math.max(shearR.aswS, shearR.aswSMin)
    // estribo φ5 (2 ramos): espaçamento s = 2·Aφ/AswS
    const phiT = 0.005
    const aPhi = (Math.PI * phiT * phiT) / 4
    let spacing = Math.min((2 * aPhi) / aswS, shearR.sMax)
    spacing = Math.floor(spacing * 100) / 100
    const stirrupSpec = `φ5 c/ ${Math.max(5, Math.round(spacing * 100))}`

    // massa de aço estimada do vão
    const stirrupPerimeter = 2 * (bw + h - 4 * cover) + 0.1
    const steelVol =
      positive.as * length +
      (negLeft?.as ?? 0) * 0.3 * length +
      (negRight?.as ?? 0) * 0.3 * length +
      (aswS / 2) * stirrupPerimeter * length
    const steelKg = steelVol * STEEL_DENSITY * 1.1 // +10% perdas/ancoragens

    const fail = !positive.ok || !(negLeft?.ok ?? true) || !(negRight?.ok ?? true) || !shearR.ok
    const warn = positive.xd > 0.35 || vd > 0.9 * shearR.vrd2
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
      steelKg,
      status: fail ? 'falha' : warn ? 'atencao' : 'ok',
    })
  }

  return out.sort(
    (a, b) => a.beamName.localeCompare(b.beamName, 'pt-BR', { numeric: true }) || a.spanIndex - b.spanIndex,
  )
}

// ---------------------------------------------------------------------------
// verificação simplificada de pilares
// ---------------------------------------------------------------------------

function checkColumns(
  project: Project,
  model: AnalysisResults['model'],
  env: AnalysisResults['envelopeELU'],
): ColumnCheck[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const out: ColumnCheck[] = []

  for (const col of project.columns) {
    const memberIds: number[] = []
    model.members.forEach((m, mi) => {
      if (m.ref.kind === 'column' && m.ref.sourceId === col.id) memberIds.push(mi)
    })
    if (memberIds.length === 0) continue
    let nd = 0
    let mdx = 0
    let mdy = 0
    let le = 0
    for (const mi of memberIds) {
      const eN = env.N[mi]
      for (const v of eN.min) nd = Math.max(nd, -v) // compressão
      const eMy = env.My[mi]
      const eMz = env.Mz[mi]
      for (let s = 0; s < eMy.max.length; s++) {
        mdx = Math.max(mdx, Math.abs(eMy.max[s]), Math.abs(eMy.min[s]))
        mdy = Math.max(mdy, Math.abs(eMz.max[s]), Math.abs(eMz.min[s]))
      }
      le = Math.max(le, model.members[mi].length)
    }
    const ac = col.section.bw * col.section.h
    const nu = nd / (ac * cp.fcd)
    const hMin = Math.min(col.section.bw, col.section.h)
    const lambda = (3.46 * le) / hMin
    // compressão simples aproximada (σsd em 2‰)
    const sigmaSd = Math.min(fydV, 420_000)
    const asCalc = Math.max((nd - 0.85 * cp.fcd * ac) / sigmaSd, 0)
    const asMin = Math.max((0.15 * nd) / fydV, 0.004 * ac)
    const asEst = Math.max(asCalc, asMin)
    const asMax = 0.04 * ac
    let status: ColumnCheck['status'] = 'ok'
    let note: string | undefined
    if (asEst > asMax || nu > 1.0 || lambda > 90) {
      status = 'falha'
      note =
        lambda > 90
          ? 'λ > 90 — exige método rigoroso de 2ª ordem'
          : 'seção insuficiente — aumente o pilar'
    } else if (nu > 0.7 || lambda > 60) {
      status = 'atencao'
      note = nu > 0.7 ? 'ν elevado — verificar flexo-compressão' : 'esbeltez moderada (λ > 60)'
    }
    out.push({
      columnId: col.id,
      name: col.name,
      nd,
      mdx,
      mdy,
      nu,
      lambda,
      asEst,
      status,
      note,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

// ---------------------------------------------------------------------------
// quantitativos
// ---------------------------------------------------------------------------

function computeQuantities(
  project: Project,
  model: AnalysisResults['model'],
  beamDesign: BeamSpanDesign[],
): Quantities {
  let volColumns = 0
  let volBeams = 0
  let volSlabs = 0
  let formwork = 0

  for (const m of model.members) {
    const { bw, h } = m.section
    const a = bw * h
    if (m.ref.kind === 'column') {
      volColumns += a * m.length
      formwork += 2 * (bw + h) * m.length
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
      volSlabs += area * slab.thickness
      formwork += area
    }
  }

  // vigas: aço dimensionado no pavimento representativo × nº de pavimentos com a planta
  const levelsPerPlan = new Map<string, number>()
  for (const level of levels) {
    if (level.planId) levelsPerPlan.set(level.planId, (levelsPerPlan.get(level.planId) ?? 0) + 1)
  }
  const beamPlanOf = new Map<string, string>()
  for (const plan of project.plans) {
    for (const b of plan.beams) beamPlanOf.set(b.id, plan.id)
  }
  let steelBeams = 0
  for (const bd of beamDesign) {
    const planId = beamPlanOf.get(bd.beamId)
    const reps = planId ? levelsPerPlan.get(planId) ?? 1 : 1
    steelBeams += bd.steelKg * reps
  }
  const steelColumnsEst = volColumns * 130
  const steelSlabsEst = volSlabs * 85
  const total = volColumns + volBeams + volSlabs

  return {
    concrete: { columns: volColumns, beams: volBeams, slabs: volSlabs, total },
    formwork,
    steel: {
      beamsDesigned: steelBeams,
      columnsEstimated: steelColumnsEst,
      slabsEstimated: steelSlabsEst,
      total: steelBeams + steelColumnsEst + steelSlabsEst,
      ratePerM3: total > 0 ? (steelBeams + steelColumnsEst + steelSlabsEst) / total : 0,
    },
  }
}
