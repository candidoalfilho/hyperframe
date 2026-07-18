import type { FloorPlan, Project, Slab, Vec2 } from '../model/types'
import type { SlabDesignResultItem, SlabGridDesign } from '../analysis/types'
import { dist, pointInPolygon, projectOnSegment, TOL } from '../geometry/geometry'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import { designSlab, pickSlabBars, type EdgeCondition } from '../nbr/nbr6118/slabDesign'
import { designBeamFlexure } from '../nbr/nbr6118/beamDesign'
import { designRibbedSlab, ribbedSelfWeight } from '../nbr/nbr6118/ribbedSlab'
import {
  checkPunching,
  collapseReinforcement,
  designPunchingReinf,
  openingPerimeterReduction,
} from '../nbr/nbr6118/punching'
import { analyzeSlabGrid } from '../analysis/grid'
import { analyzeFloorGrid, type FloorGridOutput } from '../analysis/floorGrid'
import { columnSectionInfo } from '../model/columnSection'
import {
  classifySlabColumns,
  slabExtraLoads,
  slabOpeningPolygons,
  slabOpeningsArea,
} from '../analysis/buildModel'
import { columnHalfExtents } from '../model/columnSection'
import { polygonArea } from '../geometry/geometry'

/** laje retangular? (4 vértices, lados opostos iguais, ângulos retos) */
function isRectangular(poly: Vec2[]): boolean {
  if (poly.length !== 4) return false
  const l = [0, 1, 2, 3].map((i) => dist(poly[i], poly[(i + 1) % 4]))
  if (Math.abs(l[0] - l[2]) > 0.02 || Math.abs(l[1] - l[3]) > 0.02) return false
  const dot =
    (poly[1].x - poly[0].x) * (poly[2].x - poly[1].x) +
    (poly[1].y - poly[0].y) * (poly[2].y - poly[1].y)
  return Math.abs(dot) < 0.02 * l[0] * l[1]
}

/** borda contínua = outra laje divide ≥ 50% desta borda (colinear) */
function edgeContinuous(a: Vec2, b: Vec2, others: Slab[]): boolean {
  const len = dist(a, b)
  if (len < 1e-6) return false
  for (const other of others) {
    const poly = other.polygon
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]
      const d = poly[(i + 1) % poly.length]
      // colinearidade: extremos do outro segmento à distância ≤ tol da reta ab
      const p1 = projectOnSegment(c, a, b)
      const p2 = projectOnSegment(d, a, b)
      if (p1.d > 0.02 || p2.d > 0.02) continue
      const t1 = Math.min(p1.t, p2.t)
      const t2 = Math.max(p1.t, p2.t)
      const overlap = (Math.min(1, t2) - Math.max(0, t1)) * len
      if (overlap >= 0.5 * len) return true
    }
  }
  return false
}

/** pressões características da laje (peso próprio + revest. + regiões, furos descontados) */
function slabPressures(
  project: Project,
  plan: FloorPlan,
  slab: Slab,
): { g: number; q: number } {
  const extras = slabExtraLoads(plan, slab)
  const area = polygonArea(slab.polygon)
  const openArea = Math.min(slabOpeningsArea(plan, slab), area)
  const netFactor = area > 1e-9 ? (area - openArea) / area : 1
  const g =
    (slab.thickness * project.settings.concreteUnitWeight + slab.finishLoad) * netFactor +
    extras.g
  const q = slab.liveLoad * netFactor + extras.q
  return { g, q }
}

/** grelha de pavimento unificada da planta (null = indisponível ⇒ método por laje) */
function tryFloorGrid(
  project: Project,
  plan: FloorPlan,
  levels: { id: string }[],
  levelIndex: number,
  ecs: number,
): FloorGridOutput | null {
  const macicas = plan.slabs.filter((s) => !s.ribbed)
  if (macicas.length === 0) return null
  const levelIdxById = new Map(levels.map((l, i) => [l.id, i]))
  const columns = project.columns
    .filter((col) => {
      const ib = levelIdxById.get(col.baseLevelId) ?? 0
      const it = levelIdxById.get(col.topLevelId) ?? levels.length - 1
      return levelIndex >= ib && levelIndex <= it
    })
    .map((col) => ({ id: col.id, pos: col.pos }))
  try {
    return analyzeFloorGrid({
      slabs: macicas.map((sl) => {
        const { g, q } = slabPressures(project, plan, sl)
        return {
          id: sl.id,
          polygon: sl.polygon,
          holes: slabOpeningPolygons(plan, sl),
          thickness: sl.thickness,
          pTot: g + q,
          pQp: g + project.settings.psiLive.psi2 * q,
        }
      }),
      beams: plan.beams.map((b) => ({
        path: b.path,
        sections: b.path.slice(0, -1).map((_, si) => b.segmentSections?.[si] ?? b.section),
      })),
      columns,
      e: ecs,
    })
  } catch {
    return null
  }
}

export function runSlabDesign(
  project: Project,
  /** momento desbalanceado ELU laje→pilar por `${columnId}|${levelIndex}` */
  jointMoments?: Map<string, { m1: number; m2: number }>,
): SlabDesignResultItem[] {
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const cover = coverFor(project.settings.caa).slab
  const out: SlabDesignResultItem[] = []

  const levels = [...project.levels].sort((x, y) => x.elevation - y.elevation)
  const seenPlans = new Set<string>()
  for (const level of levels) {
    if (!level.planId || seenPlans.has(level.planId)) continue
    seenPlans.add(level.planId)
    const plan: FloorPlan | undefined = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue

    const floor =
      project.settings.slabMethod === 'grelha'
        ? tryFloorGrid(project, plan, levels, levels.indexOf(level), cp.ecs)
        : null

    for (const slab of plan.slabs) {
      const rect = isRectangular(slab.polygon)
      const extras = slabExtraLoads(plan, slab)
      const notes: string[] = []
      let openWarn = false
      if (extras.g > 1e-9 || extras.q > 1e-9) {
        notes.push(
          `Inclui carga de região (escada/reservatório): +${extras.g.toFixed(1)} kN/m² (g), +${extras.q.toFixed(1)} kN/m² (q).`,
        )
      }
      const openArea = slabOpeningsArea(plan, slab)
      if (openArea > 1e-6) {
        const ratio = openArea / Math.max(polygonArea(slab.polygon), 1e-9)
        openWarn = ratio > 0.15
        notes.push(
          `Furo/abertura de ${(100 * ratio).toFixed(0)}% da área — o método de Marcus não considera aberturas; prever reforço nas bordas do furo (verificação manual).`,
        )
      }
      const kind = slab.ribbed ? 'nervurada' : 'macica'

      // ------------------------------ método da GRELHA (maciças, qualquer forma)
      if (!slab.ribbed && project.settings.slabMethod === 'grelha') {
        const item = designSlabByGrid(
          project,
          plan,
          slab,
          level.name,
          levels.indexOf(level),
          {
            cover,
            fcd: cp.fcd,
            fck: cp.fck,
            fyd: fydV,
            fctm: cp.fctm,
            ecs: cp.ecs,
          },
          floor,
          jointMoments,
        )
        if (item) {
          item.notes.unshift(...notes)
          if (openWarn && item.status === 'ok') item.status = 'atencao'
          out.push(item)
          continue
        }
        notes.push('Grelha indisponível p/ esta laje (sem apoios) — caindo p/ Marcus.')
      }

      if (!rect) {
        out.push({
          slabId: slab.id,
          name: slab.name,
          levelName: level.name,
          spanA: 0,
          spanB: 0,
          thickness: slab.thickness,
          rectangular: false,
          kind,
          design: null,
          ribbedDesign: null,
          gridDesign: null,
          status: 'atencao',
          notes: [...notes, 'Laje não retangular — dimensionar manualmente ou use o método da GRELHA nas configurações.'],
        })
        continue
      }

      const others = plan.slabs.filter((s) => s.id !== slab.id)
      const p = slab.polygon
      const cont = [0, 1, 2, 3].map((i) => edgeContinuous(p[i], p[(i + 1) % 4], others))
      const spanA = dist(p[0], p[1])
      const spanB = dist(p[1], p[2])
      // faixa na direção A (vão = |e0|) apoia nas bordas 1 e 3
      const fixedA = ((cont[1] ? 1 : 0) + (cont[3] ? 1 : 0)) as EdgeCondition
      const fixedB = ((cont[0] ? 1 : 0) + (cont[2] ? 1 : 0)) as EdgeCondition

      const gSelf = slab.ribbed
        ? ribbedSelfWeight(slab.thickness, slab.ribbed, project.settings.concreteUnitWeight)
        : slab.thickness * project.settings.concreteUnitWeight

      if (slab.ribbed) {
        const ribbedDesign = designRibbedSlab({
          a: { span: spanA, fixedEnds: fixedA },
          b: { span: spanB, fixedEnds: fixedB },
          h: slab.thickness,
          ribbed: slab.ribbed,
          g: gSelf + slab.finishLoad + extras.g,
          q: slab.liveLoad + extras.q,
          psi2: project.settings.psiLive.psi2,
          cover,
          fcd: cp.fcd,
          fck: cp.fck,
          fyd: fydV,
          fctm: cp.fctm,
          fctd: cp.fctd,
          ecs: cp.ecs,
          fywk: project.settings.steel.fyk,
          gammaC: project.settings.concreteUnitWeight,
        })
        const geomOk = ribbedDesign.geometry.checks.every((c) => c.ok)
        let status: SlabDesignResultItem['status'] = 'ok'
        if (!ribbedDesign.dirA.ok || !ribbedDesign.dirB.ok || !geomOk) status = 'falha'
        else if (!ribbedDesign.deflectionOk || openWarn || ribbedDesign.geometry.asTBeams)
          status = 'atencao'
        out.push({
          slabId: slab.id,
          name: slab.name,
          levelName: level.name,
          spanA,
          spanB,
          thickness: slab.thickness,
          rectangular: true,
          kind,
          design: null,
          ribbedDesign,
          gridDesign: null,
          status,
          notes: [...notes, ...ribbedDesign.notes],
        })
        continue
      }

      const design = designSlab({
        a: { span: spanA, fixedEnds: fixedA },
        b: { span: spanB, fixedEnds: fixedB },
        thickness: slab.thickness,
        g: gSelf + slab.finishLoad + extras.g,
        q: slab.liveLoad + extras.q,
        psi2: project.settings.psiLive.psi2,
        cover,
        fcd: cp.fcd,
        fck: cp.fck,
        fyd: fydV,
        fctm: cp.fctm,
        ecs: cp.ecs,
      })

      let status: SlabDesignResultItem['status'] = 'ok'
      if (!design.dirA.ok || !design.dirB.ok || !design.minThicknessOk) status = 'falha'
      else if (!design.deflectionOk || openWarn) status = 'atencao'

      out.push({
        slabId: slab.id,
        name: slab.name,
        levelName: level.name,
        spanA,
        spanB,
        thickness: slab.thickness,
        rectangular: true,
        kind,
        design,
        ribbedDesign: null,
        gridDesign: null,
        status,
        notes: [...notes, ...design.notes],
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

// ---------------------------------------------------------------------------
// método da grelha — dimensionamento por faixas + punção nos pilares internos
// ---------------------------------------------------------------------------

interface GridMat {
  cover: number
  fcd: number
  fck: number
  fyd: number
  fctm: number
  ecs: number
}

function designSlabByGrid(
  project: Project,
  plan: FloorPlan,
  slab: Slab,
  levelName: string,
  levelIndex: number,
  mat: GridMat,
  floor: FloorGridOutput | null,
  jointMoments?: Map<string, { m1: number; m2: number }>,
): SlabDesignResultItem | null {
  const notes: string[] = []
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const levelIdxById = new Map(levels.map((l, i) => [l.id, i]))

  // bordas apoiadas: amostras da borda perto de algum segmento de viga
  const nearBeam = (p: Vec2): boolean =>
    plan.beams.some((b) => {
      for (let i = 0; i + 1 < b.path.length; i++) {
        if (projectOnSegment(p, b.path[i], b.path[i + 1]).d <= TOL * 3) return true
      }
      return false
    })
  const n = slab.polygon.length
  const supportedEdges: number[] = []
  for (let e = 0; e < n; e++) {
    const a = slab.polygon[e]
    const b = slab.polygon[(e + 1) % n]
    const samples = [0.25, 0.5, 0.75].map((t) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    }))
    if (samples.filter(nearBeam).length >= 2) supportedEdges.push(e)
  }

  // pilares que apoiam a laje direto: internos, de borda livre e de canto
  const supportedSet = new Set(supportedEdges)
  const candidates = project.columns
    .filter((col) => {
      const ib = levelIdxById.get(col.baseLevelId) ?? 0
      const it = levelIdxById.get(col.topLevelId) ?? levels.length - 1
      return levelIndex >= ib && levelIndex <= it
    })
    .map((col) => {
      const info = columnSectionInfo(col.section)
      return { id: col.id, pos: col.pos, half: Math.hypot(info.bu, info.bv) / 2 }
    })
  const interior = classifySlabColumns(
    candidates,
    slab.polygon,
    (e) => supportedSet.has(e),
    nearBeam,
  )
  const classById = new Map(interior.map((c) => [c.id, c]))

  if (supportedEdges.length + interior.length === 0) return null

  const extras = slabExtraLoads(plan, slab)
  const area = polygonArea(slab.polygon)
  const openArea = Math.min(slabOpeningsArea(plan, slab), area)
  const netFactor = area > 1e-9 ? (area - openArea) / area : 1
  const g =
    (slab.thickness * project.settings.concreteUnitWeight + slab.finishLoad) * netFactor +
    extras.g
  const q = slab.liveLoad * netFactor + extras.q
  const wQp = g + project.settings.psiLive.psi2 * q

  const holes = slabOpeningPolygons(plan, slab)
  const wChar = g + q
  const fr = floor?.slabs.get(slab.id) ?? null

  // grelha de PAVIMENTO unificada (continuidade + vigas flexíveis) quando
  // disponível; senão, grelha por laje com bordas rotuladas (como antes)
  let mxSpanChar: number
  let mxSupChar: number
  let mySpanChar: number
  let mySupChar: number
  let wQpDefl: number
  let colLoadsChar: Map<string, number>
  let statsG: { nodes: number; members: number }
  if (fr && wChar > 1e-9) {
    mxSpanChar = fr.mxSpanMax
    mxSupChar = fr.mxSupportMax
    mySpanChar = fr.mySpanMax
    mySupChar = fr.mySupportMax
    wQpDefl = fr.wRelQp
    // punção só nos pilares que apoiam a LAJE diretamente (não os de viga)
    colLoadsChar = new Map([...fr.columnLoads].filter(([id]) => classById.has(id)))
    statsG = floor!.stats
    notes.push(
      'Grelha de PAVIMENTO unificada: continuidade entre lajes vizinhas e flexibilidade real das vigas (torção fissurada 0,15·GJ), apoios verticais nos pilares.',
    )
    for (const nt of floor!.notes) if (!notes.includes(nt)) notes.push(nt)
  } else {
    let grid
    try {
      grid = analyzeSlabGrid({
        polygon: slab.polygon,
        holes,
        supportedEdges,
        interiorColumns: interior,
        thickness: slab.thickness,
        e: mat.ecs,
        q: 1, // pressão unitária — momentos/reações escalam linearmente
      })
    } catch (err) {
      notes.push(`Grelha falhou: ${err instanceof Error ? err.message : 'erro'}.`)
      return null
    }
    mxSpanChar = grid.result.mxSpanMax * wChar
    mxSupChar = grid.result.mxSupportMax * wChar
    mySpanChar = grid.result.mySpanMax * wChar
    mySupChar = grid.result.mySupportMax * wChar
    wQpDefl = grid.result.wMax * wQp
    colLoadsChar = new Map([...grid.columnLoads].map(([id, f]) => [id, f * wChar]))
    statsG = grid.stats
  }

  const h = slab.thickness
  const d = Math.max(h - mat.cover - 0.015, 0.5 * h) // d médio (2 camadas φ10)
  const asMin = 0.0015 * h
  const flex = (mdPerM: number): { as: number; ok: boolean } => {
    if (mdPerM < 0.1) return { as: asMin, ok: true }
    const r = designBeamFlexure({
      md: mdPerM,
      bw: 1,
      h,
      d,
      fcd: mat.fcd,
      fyd: mat.fyd,
      fck: mat.fck,
    })
    return { as: Math.max(r.as, asMin), ok: r.ok }
  }

  const mxSpan = mxSpanChar * 1.4
  const mxSup = mxSupChar * 1.4
  const mySpan = mySpanChar * 1.4
  const mySup = mySupChar * 1.4
  const fX = flex(mxSpan)
  const fXSup = flex(mxSup)
  const fY = flex(mySpan)
  const fYSup = flex(mySup)

  // flecha QP com fissuração (Branson aproximado, como no método de Marcus)
  const maQp =
    wChar > 1e-9 ? (Math.max(mxSpanChar, mySpanChar) * wQp) / wChar : 0
  const mr = 0.25 * mat.fctm * h * h
  let ieqRatio = 1
  if (maQp > mr) {
    const r3 = (mr / maQp) ** 3
    ieqRatio = 1 / Math.min(1, r3 + (1 - r3) * 0.3)
    notes.push('Laje fissura em serviço — flecha ampliada por Branson (III≈0,3·Ic).')
  }
  const deflection = wQpDefl * ieqRatio * (1 + 1.32)
  // vão de referência p/ o limite: menor dimensão da caixa envolvente
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of slab.polygon) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const lx = Math.min(maxX - minX, maxY - minY)
  const deflectionLimit = lx / 250

  // punção nos pilares internos com a reação REAL da grelha
  const punching: SlabGridDesign['punching'] = []
  for (const [colId, fChar] of colLoadsChar) {
    const col = project.columns.find((c) => c.id === colId)
    if (!col) continue
    const fsd = fChar * 1.4
    const info = columnSectionInfo(col.section)
    const rho = Math.min(Math.max(fXSup.as, fYSup.as) / d, 0.02)
    // furo a menos de 8d do pilar desconta o trecho entre tangentes (§19.5.1)
    const openingFraction = openingPerimeterReduction(col.pos, holes, d)
    // posição (§19.5.2): borda/canto orientam c1 PERPENDICULAR à borda livre
    const cls = classById.get(colId)
    const position = cls?.position ?? 'internal'
    const he = columnHalfExtents(col)
    const dimAlong = (v: Vec2): number => 2 * (Math.abs(v.x) * he.dx + Math.abs(v.y) * he.dy)
    let column: Parameters<typeof checkPunching>[0]['column']
    if (info.kind === 'circle') {
      column = { shape: 'circle', d: info.bu }
    } else if (position === 'edge' && cls?.inward) {
      column = {
        shape: 'rect',
        c1: dimAlong(cls.inward),
        c2: dimAlong({ x: -cls.inward.y, y: cls.inward.x }),
      }
    } else if (position === 'corner' && cls?.inward && cls?.inward2) {
      column = { shape: 'rect', c1: dimAlong(cls.inward), c2: dimAlong(cls.inward2) }
    } else {
      column = { shape: 'rect', c1: info.bu, c2: info.bv }
    }
    // momento desbalanceado laje→pilar da envoltória do pórtico (K·MSd)
    const jm = jointMoments?.get(`${colId}|${levelIndex}`)
    const punchInput = {
      fsd,
      column,
      d,
      rhoX: rho,
      rhoY: rho,
      fck: mat.fck,
      gammaC: project.settings.concrete.gammaC,
      openingFraction,
      position,
      msd1: jm?.m1,
      msd2: jm?.m2,
    }
    const check = checkPunching(punchInput)
    // τSd1 > τRd1: dimensiona os conectores (studs) até o contorno C″
    const reinf =
      check.needsShearReinf && check.okC
        ? designPunchingReinf({ ...punchInput, h: slab.thickness })
        : undefined
    if (position !== 'internal') {
      notes.push(
        `Punção de ${col.name}: pilar de ${position === 'edge' ? 'BORDA' : 'CANTO'} — perímetro reduzido u*${jm ? ` e MSd = ${jm.m1.toFixed(1)} kN·m` : ''} (§19.5.2).`,
      )
    }
    if (openingFraction > 1e-9) {
      notes.push(
        `Punção de ${col.name}: abertura a menos de 8d — perímetros reduzidos em ${Math.round(openingFraction * 100)}% (§19.5.1).`,
      )
    }
    if (reinf) {
      notes.push(
        `Punção de ${col.name}: armadura dimensionada — ${reinf.spec}; contorno C″ ${reinf.ok ? 'dispensa' : 'NÃO dispensa'} (τSd = ${reinf.tauSdC2.toFixed(0)} × τRd1 = ${check.tauRd1.toFixed(0)} kPa, §19.5.3.4).`,
      )
    }
    // colapso progressivo (§19.5.4): fyd·As,ccp ≥ 1,5·FSd na face inferior
    const collapse = collapseReinforcement(fsd, mat.fyd)
    punching.push({ columnId: colId, name: col.name, fsd, check, reinf, collapse })
  }
  if (punching.length > 0) {
    notes.push(
      `Colapso progressivo (§19.5.4) — armadura INFERIOR atravessando cada pilar (ancorar além de C′): ` +
        punching
          .map((p) => `${p.name} ≥ ${(p.collapse.as * 1e4).toFixed(1)} cm²`)
          .join(' · ') +
        '.',
    )
  }

  // reforço de borda dos furos: repõe a armadura interrompida (metade por
  // lado, barras paralelas à borda) + diagonais de canto contra fissuração
  const aPhi10 = (Math.PI * 0.01 * 0.01) / 4
  holes.forEach((hole, i) => {
    let hx0 = Infinity
    let hx1 = -Infinity
    let hy0 = Infinity
    let hy1 = -Infinity
    for (const p of hole) {
      hx0 = Math.min(hx0, p.x)
      hx1 = Math.max(hx1, p.x)
      hy0 = Math.min(hy0, p.y)
      hy1 = Math.max(hy1, p.y)
    }
    const wx = hx1 - hx0
    const wy = hy1 - hy0
    if (wx < 0.05 || wy < 0.05) return
    const nX = Math.max(2, Math.ceil((fX.as * wy) / 2 / aPhi10))
    const nY = Math.max(2, Math.ceil((fY.as * wx) / 2 / aPhi10))
    notes.push(
      `Furo ${i + 1} (${wx.toFixed(2).replace('.', ',')}×${wy.toFixed(2).replace('.', ',')} m): ` +
        `repor ${nX} φ 10 por borda paralela a X e ${nY} φ 10 por borda paralela a Y ` +
        `(comprimento = furo + 2·lb) + 2 φ 10 a 45° por canto (§13.2.5).`,
    )
  })

  const flexOk = fX.ok && fXSup.ok && fY.ok && fYSup.ok
  const punchFail = punching.some((p) => !p.check.okC || (p.reinf && !p.reinf.ok))
  const punchReinf = punching.some((p) => p.check.needsShearReinf)
  const deflectionOk = deflection <= deflectionLimit
  let status: SlabDesignResultItem['status'] = 'ok'
  if (!flexOk || punchFail) status = 'falha'
  else if (!deflectionOk || punchReinf) status = 'atencao'
  notes.push(
    `Grelha${fr ? ' unificada (pavimento)' : ''}: ${statsG.nodes} nós, ${statsG.members} barras; ` +
      `${supportedEdges.length} borda(s) apoiada(s)${interior.length > 0 ? `, ${interior.length} pilar(es) interno(s)` : ''}.`,
  )

  const gridDesign: SlabGridDesign = {
    mxSpan,
    mxSupport: mxSup,
    mySpan,
    mySupport: mySup,
    asX: fX.as,
    asXSup: fXSup.as,
    asY: fY.as,
    asYSup: fYSup.as,
    specX: pickSlabBars(fX.as, h),
    specXSup: mxSup > 0.1 ? pickSlabBars(fXSup.as, h) : '—',
    specY: pickSlabBars(fY.as, h),
    specYSup: mySup > 0.1 ? pickSlabBars(fYSup.as, h) : '—',
    deflection,
    deflectionLimit,
    deflectionOk,
    punching,
    stats: statsG,
    ok: flexOk,
    notes: [],
  }

  return {
    slabId: slab.id,
    name: slab.name,
    levelName,
    spanA: maxX - minX,
    spanB: maxY - minY,
    thickness: slab.thickness,
    rectangular: slab.polygon.length === 4,
    kind: 'macica',
    design: null,
    ribbedDesign: null,
    gridDesign,
    status,
    notes,
  }
}
