import type { FloorPlan, Project, SectionRect, Slab, Vec2 } from '../model/types'
import { columnSectionInfo, columnWorldDirs } from '../model/columnSection'
import { slabSelfWeight } from './slabWeight'
import { analyzeSlabGrid, slabGridCacheKey, type SlabGridOutput } from './grid'
import { averageModulus } from '../geotech/soil'
import {
  TOL,
  bbox,
  cross,
  dist,
  pointInPolygon,
  pointKey,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  segIntersection,
  sub,
} from '../geometry/geometry'
import { clipPolygon, overlapArea } from '../geometry/clip'
import {
  edgeContinuous,
  oneWayTributaryAreas,
  simplifyPolygon,
  simplifyPolygonMap,
} from '../geometry/slabEdges'
import { computeWind } from '../nbr/nbr6123/wind'
import { flankingSlabs, tSectionInertia } from './flange'
import { columnHalfExtents } from '../model/columnSection'
import { masonryWallStackLoads } from '../design/masonryRun'
import { rectSectionProps } from './frame3d'
import { notionalLoads, windNotionalRule } from '../nbr/nbr6118/imperfections'
import type { WindGeometry } from '../nbr/api'
import type { AMember, ANode, AnalysisModel, CaseId, Vec3 } from './types'

/** carga uniforme local por membro (kN/m nos eixos locais do membro) */
export interface MemberLoad {
  wx: number
  wy: number
  wz: number
}

export interface NodalLoad {
  node: number
  /** 0..5 = ux,uy,uz,rx,ry,rz (globais) */
  dof: number
  value: number
}

export interface InternalModel {
  memberLoads: Record<CaseId, MemberLoad[]>
  nodalLoads: Record<CaseId, NodalLoad[]>
}

interface Piece {
  a: Vec2
  b: Vec2
  beamId: string
  beamName: string
  /** vão de dimensionamento (entre apoios em pilares/mudança de seção), por viga */
  spanIndex: number
  /** seção do trecho (override por segmento ou seção da viga) */
  section: SectionRect
  /** posição ao longo do eixo da viga (comprimento acumulado), m */
  s0: number
  s1: number
  /** eixo geométrico original, quando um extremo foi capturado por um pilar */
  ga?: Vec2
  gb?: Vec2
  /**
   * extremos do trecho FLEXÍVEL quando diferem dos nós: ponto sobre o eixo real
   * da viga, ligado ao nó do pilar por braço rígido (§14.6.2.1)
   */
  ea?: Vec2
  eb?: Vec2
}

const CASES: CaseId[] = ['G', 'Q', 'WXP', 'WXN', 'WYP', 'WYN', 'EQXP', 'EQXN', 'EQYP', 'EQYN']

/**
 * Gera o pórtico espacial: nós por pavimento, pilares por tramo, vigas
 * divididas em barras nos cruzamentos/pilares, diafragma rígido por pavimento
 * com laje, cargas G/Q (peso próprio, revestimento, alvenaria, sobrecarga por
 * área de influência) e vento (NBR 6123) nos nós mestres.
 */
export function buildAnalysisModel(project: Project): {
  model: AnalysisModel
  internal: InternalModel
} {
  const warnings: string[] = []
  const γ = project.settings.concreteUnitWeight

  // níveis ordenados
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const levelIndexById = new Map(levels.map((l, i) => [l.id, i]))

  // ---------------------------------------------------------------- nós
  const nodes: ANode[] = []
  const nodeIdByKey = new Map<string, number>()
  const getNode = (levelIndex: number, p: Vec2, kind: 'structural' | 'master' = 'structural') => {
    const key = `${levelIndex}|${pointKey(p)}|${kind}`
    let id = nodeIdByKey.get(key)
    if (id === undefined) {
      id = nodes.length
      nodes.push({
        id,
        x: p.x,
        y: p.y,
        z: levels[levelIndex].elevation,
        levelIndex,
        kind,
        support: false,
      })
      nodeIdByKey.set(key, id)
    }
    return id
  }

  // -------------------------------------------------- vigas → pedaços
  const colPoints = project.columns.map((c) => c.pos)
  // REGIÃO NODAL do pilar: ponto de viga dentro da projeção da seção (+2 cm)
  // pertence ao nó do pilar. A viga que chega na face — ou cruza o pilar fora
  // do centro — fica ligada a ele, e o trecho contido na seção não vira vão
  // (trecho rígido, §14.6.2.1). O extremo flexível da barra fica sobre o eixo
  // REAL da viga (projeção do centro do pilar nesse eixo) e é ligado ao nó por
  // um braço rígido: a reação da viga chega ao pilar com o momento V·e.
  const footprintsAt = (li: number) =>
    project.columns
      .filter((c) => {
        const ib = levelIndexById.get(c.baseLevelId) ?? 0
        const it = levelIndexById.get(c.topLevelId) ?? levels.length - 1
        return li >= ib && li <= it
      })
      .map((c) => ({ pos: c.pos, name: c.name, he: columnHalfExtents(c) }))
  let nCaptured = 0
  let nStubs = 0
  let nRigidZones = 0
  const rigidZones = project.settings.rigidEndZones === true
  /** maior excentricidade transversal por ligação viga–pilar (m) */
  const eccentric = new Map<string, number>()
  /** ligações em que o braço rígido não pôde ser montado (barra degenerada) */
  const noArm = new Set<string>()
  /** ligações em que a alma da viga passa da face do pilar: sobra em m */
  const overhang = new Map<string, number>()
  /** pieces por índice de nível */
  const piecesByLevel = new Map<number, Piece[]>()
  /** trechos de viga descartados por estarem dentro da seção de um pilar */
  const stubsByLevel = new Map<number, { a: Vec2; b: Vec2 }[]>()

  // ks p/ baldrames (vigas no nível 0) sobre apoio elástico de Winkler:
  // override manual > sondagem (Es médio, faixa B) > heurística 120·σadm
  const level0HasBeams = (() => {
    const l0 = levels[0]
    if (!l0?.planId) return false
    const plan = project.plans.find((p) => p.id === l0.planId)
    return (plan?.beams.length ?? 0) > 0
  })()
  let ksGround = 0
  if (level0HasBeams) {
    const si = project.settings.soilInteraction
    if (project.settings.groundBeamKs && project.settings.groundBeamKs > 0) {
      ksGround = project.settings.groundBeamKs
    } else if (si.enabled && si.layers.length > 0) {
      const es = averageModulus(si.layers, 2 * 0.3) // faixa ~30 cm
      ksGround = es / (0.3 * (1 - si.poisson * si.poisson))
    } else {
      ksGround = 120 * project.settings.soil.sigmaAdm // heurística usual (Bowles)
    }
  }

  for (let li = 0; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue

    // todos os segmentos brutos do pavimento (p/ interseções mútuas)
    const rawSegs: { a: Vec2; b: Vec2 }[] = []
    for (const beam of plan.beams) {
      for (let i = 0; i + 1 < beam.path.length; i++) {
        rawSegs.push({ a: beam.path[i], b: beam.path[i + 1] })
      }
    }

    const footprints = footprintsAt(li)
    const captureOf = (p: Vec2) => {
      let best: (typeof footprints)[number] | null = null
      let bestD = Infinity
      for (const f of footprints) {
        if (Math.abs(p.x - f.pos.x) > f.he.dx + 0.02 || Math.abs(p.y - f.pos.y) > f.he.dy + 0.02)
          continue
        const d = dist(p, f.pos)
        if (d < bestD) {
          best = f
          bestD = d
        }
      }
      return best
    }

    const pieces: Piece[] = []
    for (const beam of plan.beams) {
      let spanIndex = 0
      let pendingBreak = false
      let sAcc = 0 // comprimento acumulado ao longo da polilinha
      const sectionOfSeg = (si: number): SectionRect =>
        beam.segmentSections?.[si] ?? beam.section
      for (let si = 0; si + 1 < beam.path.length; si++) {
        const a = beam.path[si]
        const b = beam.path[si + 1]
        const L = dist(a, b)
        if (L < TOL) continue
        const section = sectionOfSeg(si)
        const cuts = new Set<number>([0, 1])
        // interseções com os demais segmentos
        for (const seg of rawSegs) {
          if (seg.a === a && seg.b === b) continue
          const p = segIntersection(a, b, seg.a, seg.b)
          if (p) {
            const { t } = projectOnSegment(p, a, b)
            cuts.add(Math.round((t * L) / TOL) * (TOL / L))
          }
        }
        // pilares sobre a viga
        for (const cp of colPoints) {
          const { t, d } = projectOnSegment(cp, a, b)
          if (d <= TOL * 2) cuts.add(Math.round((t * L) / TOL) * (TOL / L))
        }
        // viga que atravessa a seção de um pilar fora do centro: corta no ponto
        // mais próximo do centro (que será capturado pelo nó do pilar)
        for (const f of footprints) {
          const { t, d } = projectOnSegment(f.pos, a, b)
          if (d <= TOL * 2 || t <= 0 || t >= 1) continue
          const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          if (Math.abs(q.x - f.pos.x) <= f.he.dx + 0.02 && Math.abs(q.y - f.pos.y) <= f.he.dy + 0.02)
            cuts.add(Math.round((t * L) / TOL) * (TOL / L))
        }
        let ts = [...cuts].sort((x, y) => x - y)
        // baldrames (nível 0) sobre Winkler: refina em segmentos ≤ 0,5 m
        if (li === 0 && ksGround > 0) {
          const refined: number[] = []
          for (let k = 0; k + 1 < ts.length; k++) {
            refined.push(ts[k])
            const segLen = (ts[k + 1] - ts[k]) * L
            const nSub = Math.ceil(segLen / 0.5)
            for (let s2 = 1; s2 < nSub; s2++) {
              refined.push(ts[k] + ((ts[k + 1] - ts[k]) * s2) / nSub)
            }
          }
          refined.push(ts[ts.length - 1])
          ts = refined
        }
        for (let k = 0; k + 1 < ts.length; k++) {
          const t0 = ts[k]
          const t1 = ts[k + 1]
          if ((t1 - t0) * L < TOL) continue
          const ga = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }
          const gb = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }
          const ca = captureOf(ga)
          const cb = captureOf(gb)
          const pa = ca ? ca.pos : ga
          const pb = cb ? cb.pos : gb
          const isSegEnd = k + 2 === ts.length
          const nextSection = si + 2 < beam.path.length ? sectionOfSeg(si + 1) : section
          const sectionChanges =
            isSegEnd && (nextSection.bw !== section.bw || nextSection.h !== section.h)
          if (dist(pa, pb) < TOL) {
            // trecho inteiro dentro da seção do pilar: rígido, não vira barra
            nStubs++
            const list = stubsByLevel.get(li) ?? []
            list.push({ a: ga, b: gb })
            stubsByLevel.set(li, list)
            if (sectionChanges) pendingBreak = true
            continue
          }
          // extremo FLEXÍVEL em pilar: projeção do centro do pilar no eixo da
          // viga (excentricidade transversal pura) e, com trechos rígidos
          // ativos, avançado para dentro do vão de t/2 − 0,3·h (fig. 14.1)
          const ux = (b.x - a.x) / L
          const uy = (b.y - a.y) / L
          const flexEnd = (c: NonNullable<typeof ca>, toSpan: 1 | -1, zone: boolean): Vec2 => {
            const sC = (c.pos.x - a.x) * ux + (c.pos.y - a.y) * uy
            let adv = 0
            if (zone) {
              // meia dimensão do apoio na direção da viga (corda pelo centro)
              const tHalf = Math.min(
                Math.abs(ux) > 1e-6 ? c.he.dx / Math.abs(ux) : Infinity,
                Math.abs(uy) > 1e-6 ? c.he.dy / Math.abs(uy) : Infinity,
              )
              adv = Math.max(0, tHalf - 0.3 * section.h)
            }
            const sE = sC + toSpan * adv
            return { x: a.x + ux * sE, y: a.y + uy * sE }
          }
          const flexLen = (p: Vec2, q: Vec2) => (q.x - p.x) * ux + (q.y - p.y) * uy
          const minFlex = Math.max(0.05, 0.2 * dist(pa, pb))
          let ea = ca ? flexEnd(ca, 1, rigidZones) : ga
          let eb = cb ? flexEnd(cb, -1, rigidZones) : gb
          let zoned = rigidZones
          if (rigidZones && flexLen(ea, eb) < minFlex) {
            // apoios largos demais p/ o vão: sem trecho rígido longitudinal
            ea = ca ? flexEnd(ca, 1, false) : ga
            eb = cb ? flexEnd(cb, -1, false) : gb
            zoned = false
          }
          const armOk = flexLen(ea, eb) >= minFlex
          if (!armOk) {
            // barra degenerada (pilares quase encostados): barra nó a nó
            ea = pa
            eb = pb
          }
          for (const [c, g, e] of [
            [ca, ga, ea],
            [cb, gb, eb],
          ] as const) {
            if (!c) continue
            if (dist(c.pos, g) > TOL * 2) nCaptured++
            // excentricidade transversal: distância do centro do pilar ao eixo da viga
            const ecc = Math.abs((c.pos.x - a.x) * uy - (c.pos.y - a.y) * ux)
            const key = `${beam.name}–${c.name}`
            if (ecc > TOL * 2) {
              if (armOk) eccentric.set(key, Math.max(eccentric.get(key) ?? 0, ecc))
              else noArm.add(key)
            }
            if (armOk && zoned && dist(e, c.pos) > ecc + TOL) nRigidZones++
            // largura da viga além da face do pilar (meia largura do apoio na normal)
            const hn = c.he.dx * Math.abs(uy) + c.he.dy * Math.abs(ux)
            const over = ecc + section.bw / 2 - hn
            if (over > 0.005) overhang.set(key, Math.max(overhang.get(key) ?? 0, over))
          }
          const moved = dist(pa, ga) > TOL || dist(pb, gb) > TOL
          const armA = dist(ea, pa) > TOL
          const armB = dist(eb, pb) > TOL
          // novo vão de dimensionamento: apoio em pilar ou mudança de seção
          if (pendingBreak) {
            spanIndex++
            pendingBreak = false
          }
          pieces.push({
            a: pa,
            b: pb,
            beamId: beam.id,
            beamName: beam.name,
            spanIndex,
            section,
            s0: sAcc + t0 * L,
            s1: sAcc + t1 * L,
            ...(moved || armA || armB ? { ga, gb } : {}),
            ...(armA ? { ea } : {}),
            ...(armB ? { eb } : {}),
          })
          const endsOnColumn = colPoints.some((cp) => dist(cp, pb) <= TOL * 2)
          if (endsOnColumn || sectionChanges) pendingBreak = true
        }
        sAcc += L
      }
    }
    piecesByLevel.set(li, pieces)
  }
  if (nCaptured + nStubs > 0) {
    warnings.push(
      `Ligação viga–pilar: ${nCaptured} extremo(s) de viga dentro da seção de pilar ligado(s) ao nó do pilar` +
        (nStubs > 0 ? ` e ${nStubs} trecho(s) contido(s) na seção tratado(s) como rígido(s) (não viram vão)` : '') +
        ' (§14.6.2.1).',
    )
  }
  if (eccentric.size > 0) {
    const list = [...eccentric].sort((x, y) => y[1] - x[1])
    warnings.push(
      `Excentricidade viga–pilar considerada por braço rígido em ${list.length} ligação(ões) — a reação da viga gera momento no pilar (maiores: ${list
        .slice(0, 6)
        .map(([k, e]) => `${k}: ${(e * 100).toFixed(0)} cm`)
        .join('; ')}).`,
    )
  }
  if (nRigidZones > 0) {
    warnings.push(
      `Trechos rígidos longitudinais em ${nRigidZones} extremo(s) de viga: vão de cálculo ℓ0 + a1 + a2, a = min(t/2; 0,3·h) (§14.6.2.4).`,
    )
  }
  if (overhang.size > 0) {
    const list = [...overhang].sort((x, y) => y[1] - x[1])
    warnings.push(
      `Viga parcialmente fora da seção do pilar em ${list.length} ligação(ões) (${list
        .slice(0, 6)
        .map(([k, e]) => `${k}: ${(e * 100).toFixed(0)} cm além da face`)
        .join('; ')}) — confira a ancoragem das barras e o detalhe da ligação.`,
    )
  }
  if (noArm.size > 0) {
    warnings.push(
      `Excentricidade viga–pilar NÃO considerada em ${[...noArm].join('; ')}: pilares próximos demais para o trecho flexível da viga — verifique o momento adicional no pilar.`,
    )
  }

  // ---------------------------------------------------------------- membros
  const members: AMember[] = []
  /** arco [s0,s1] do membro ao longo da viga de origem (cargas parciais) */
  const memberArc = new Map<number, { s0: number; s1: number }>()
  /** comprimento geométrico / comprimento da barra — conserva a força de cargas
   *  lineares quando um extremo foi capturado pelo nó do pilar */
  const loadScale = (mid: number): number => {
    const ax = members[mid].axis
    return ax ? dist(ax.a, ax.b) / Math.max(members[mid].length, 1e-9) : 1
  }
  const addMember = (
    ni: number,
    nj: number,
    ref: AMember['ref'],
    section: { bw: number; h: number },
    xL: Vec3,
    yL: Vec3,
    zL: Vec3,
    props?: AMember['props'],
  ) => {
    const a = nodes[ni]
    const b = nodes[nj]
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const m: AMember = {
      id: members.length,
      ni,
      nj,
      ref,
      section,
      props,
      length,
      xLocal: xL,
      yLocal: yL,
      zLocal: zL,
    }
    members.push(m)
    return m
  }

  // cota de assentamento EFETIVA por pilar: a do próprio override e, numa
  // sapata ASSOCIADA, a cota única do par (máx das duas — o secundário desce
  // junto; coerente com o foundationRun e com o desenho 3D)
  const fdnDepthById = new Map<string, number>()
  for (const o of project.foundationOverrides ?? []) {
    if (o.depth && o.depth > 0) fdnDepthById.set(o.columnId, o.depth)
  }
  for (const o of project.foundationOverrides ?? []) {
    if (!o.combineWithColumnId || o.combineWithColumnId === o.columnId) continue
    const d = Math.max(fdnDepthById.get(o.columnId) ?? 0, fdnDepthById.get(o.combineWithColumnId) ?? 0)
    if (d > 0) {
      fdnDepthById.set(o.columnId, d)
      fdnDepthById.set(o.combineWithColumnId, d)
    }
  }

  // pilares: um tramo por andar
  for (const col of project.columns) {
    const iBase = levelIndexById.get(col.baseLevelId) ?? 0
    const iTop = levelIndexById.get(col.topLevelId) ?? levels.length - 1
    if (iTop <= iBase) {
      warnings.push(`Pilar ${col.name}: topo abaixo da base — ignorado.`)
      continue
    }
    const baseNode = getNode(iBase, col.pos)
    // cota de assentamento por pilar (terreno em aclive/declive): o apoio
    // desce p/ a cota da sapata e um tramo de ARRANQUE liga ao nível 0 —
    // rigidez e esbeltez passam a sentir o desnível (NBR 6122 §7.7)
    const fdnDepth = iBase === 0 ? (fdnDepthById.get(col.id) ?? 0) : 0
    let supportNode = baseNode
    if (iBase === 0) {
      if (fdnDepth > 0.01) {
        supportNode = nodes.length
        nodes.push({
          id: supportNode,
          x: col.pos.x,
          y: col.pos.y,
          z: levels[0].elevation - fdnDepth,
          levelIndex: 0,
          kind: 'structural',
          support: true,
        })
      } else {
        nodes[baseNode].support = true
      }
    } else {
      // nasce em viga? (transferência) — o nó da base coincide com um corte da viga
      const onBeam = (piecesByLevel.get(iBase) ?? []).some(
        (pc) => dist(pc.a, col.pos) <= TOL * 2 || dist(pc.b, col.pos) <= TOL * 2,
      )
      warnings.push(
        onBeam
          ? `Pilar ${col.name} nasce em viga no nível ${levels[iBase].name} (transferência) — verifique a flecha e a viga de apoio.`
          : `Pilar ${col.name} nasce no nível ${levels[iBase].name} SEM apoio (nem fundação, nem viga) — modelo instável.`,
      )
    }
    const secInfo = columnSectionInfo(col.section)
    const dirs = columnWorldDirs(col.rotationDeg)
    // eixos locais: x p/ cima; y local = direção da dimensão h da seção
    const xL: Vec3 = [0, 0, 1]
    const yL: Vec3 = [dirs.vDir.x, dirs.vDir.y, 0]
    const zL: Vec3 = [dirs.uDir.x, dirs.uDir.y, 0]
    const props: AMember['props'] = {
      A: secInfo.A,
      Iy: secInfo.Iu,
      Iz: secInfo.Iv,
      J: secInfo.J,
      perimeter: secInfo.perimeter,
    }
    // tramo de arranque: da sapata rebaixada até o nível 0 (mesma seção)
    if (supportNode !== baseNode) {
      addMember(
        supportNode,
        baseNode,
        { kind: 'column', sourceId: col.id, sourceName: col.name, spanIndex: -1 },
        { bw: secInfo.bu, h: secInfo.bv },
        xL,
        yL,
        zL,
        props,
      )
    }
    for (let i = iBase; i < iTop; i++) {
      const ni = getNode(i, col.pos)
      const nj = getNode(i + 1, col.pos)
      addMember(
        ni,
        nj,
        { kind: 'column', sourceId: col.id, sourceName: col.name, spanIndex: i - iBase },
        { bw: secInfo.bu, h: secInfo.bv },
        xL,
        yL,
        zL,
        props,
      )
    }
  }

  // vigas: uma barra por pedaço (seção do trecho); rigidez com MESA COLABORANTE
  // (§14.6.2.2 — Iz da seção T bruta quando há laje colada; a = 0,75·l típico;
  // área p/ peso próprio segue retangular, a laje já pesa por conta própria)
  let tStiffened = 0
  for (const [li, pieces] of piecesByLevel) {
    const planT = project.plans.find((pl) => pl.id === levels[li]?.planId)
    for (const pc of pieces) {
      const ni = getNode(li, pc.a)
      const nj = getNode(li, pc.b)
      // trecho flexível: extremos sobre o eixo real (braço rígido até o nó)
      const fa = pc.ea ?? pc.a
      const fb = pc.eb ?? pc.b
      const dx = fb.x - fa.x
      const dy = fb.y - fa.y
      const L = Math.hypot(dx, dy)
      const xL: Vec3 = [dx / L, dy / L, 0]
      const yL: Vec3 = [0, 0, 1]
      const zL: Vec3 = [dy / L, -dx / L, 0]
      let propsT: AMember['props'] | undefined
      if (planT) {
        const fl = flankingSlabs(planT, pc.ga ?? pc.a, pc.gb ?? pc.b, pc.section.bw)
        if (fl.hf !== null && fl.hf < pc.section.h) {
          const a075 = 0.75 * L
          const sideB = (c: number | null): number =>
            c === null || c <= 0 ? 0 : Math.min(0.5 * c, 0.1 * a075)
          const bf = pc.section.bw + sideB(fl.clearLeft) + sideB(fl.clearRight)
          if (bf > pc.section.bw + 0.02) {
            const { bw, h } = pc.section
            propsT = {
              A: bw * h,
              Iy: (h * bw ** 3) / 12,
              Iz: tSectionInertia(bw, h, bf, fl.hf),
              J: rectSectionProps(bw, h).J,
              perimeter: 2 * (bw + h),
            }
            tStiffened++
          }
        }
      }
      const m = addMember(
        ni,
        nj,
        { kind: 'beam', sourceId: pc.beamId, sourceName: pc.beamName, spanIndex: pc.spanIndex },
        pc.section,
        xL,
        yL,
        zL,
        propsT,
      )
      if (pc.ga && pc.gb) m.axis = { a: pc.ga, b: pc.gb }
      if (pc.ea || pc.eb) {
        m.length = L
        if (pc.ea) m.offI = [pc.ea.x - pc.a.x, pc.ea.y - pc.a.y, 0]
        if (pc.eb) m.offJ = [pc.eb.x - pc.b.x, pc.eb.y - pc.b.y, 0]
      }
      memberArc.set(m.id, { s0: pc.s0, s1: pc.s1 })
    }
  }
  if (tStiffened > 0) {
    warnings.push(
      `Rigidez das vigas com mesa colaborante (§14.6.2.2) em ${tStiffened} trecho(s) — flechas e distribuição de esforços mais realistas.`,
    )
  }

  // ------------------------------------ molas de Winkler nos baldrames
  const winkler: { nodeId: number; kz: number; area: number }[] = []
  if (ksGround > 0) {
    const acc = new Map<number, { kz: number; area: number }>()
    for (const m of members) {
      if (m.ref.kind !== 'beam') continue
      if (nodes[m.ni].levelIndex !== 0) continue
      for (const nid of [m.ni, m.nj]) {
        if (nodes[nid].support) continue // base de pilar tem a própria fundação
        const area = (m.section.bw * m.length) / 2
        const cur = acc.get(nid) ?? { kz: 0, area: 0 }
        cur.kz += ksGround * area
        cur.area += area
        acc.set(nid, cur)
      }
    }
    for (const [nid, v] of acc) {
      const springs = nodes[nid].springs ?? [0, 0, 0, 0, 0, 0]
      springs[2] += v.kz
      nodes[nid].springs = springs
      winkler.push({ nodeId: nid, kz: v.kz, area: v.area })
    }
    if (winkler.length > 0) {
      warnings.push(
        `Baldrames sobre apoio elástico (Winkler): ks = ${Math.round(ksGround)} kN/m³ em ${winkler.length} nós.`,
      )
    }
  }

  // ------------------------------------------------------------- diafragmas
  const masters: { levelIndex: number; nodeId: number }[] = []
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan || plan.slabs.length === 0) continue
    // centroide ponderado por área das lajes
    let ax = 0
    let ay = 0
    let at = 0
    for (const slab of plan.slabs) {
      const a = polygonArea(slab.polygon)
      const c = polygonCentroid(slab.polygon)
      ax += c.x * a
      ay += c.y * a
      at += a
    }
    if (at < 1e-6) continue
    const master = getNode(li, { x: ax / at, y: ay / at }, 'master')
    masters.push({ levelIndex: li, nodeId: master })
  }
  const masterByLevel = new Map(masters.map((m) => [m.levelIndex, m.nodeId]))

  // ---------------------------------------------------------------- cargas
  const memberLoads: Record<CaseId, MemberLoad[]> = {} as never
  const nodalLoads: Record<CaseId, NodalLoad[]> = {} as never
  for (const c of CASES) {
    memberLoads[c] = members.map(() => ({ wx: 0, wy: 0, wz: 0 }))
    nodalLoads[c] = []
  }

  const levelG = new Array(levels.length).fill(0)
  const levelQ = new Array(levels.length).fill(0)

  // consolos (§22.5): Fd é de CÁLCULO ⇒ característica G ≈ Fd/1,4 aplicada
  // no nó do pilar no nível do consolo, com o MOMENTO da excentricidade
  // (e = meia seção + a) — o consolo flete o pilar
  let nCorbelLoads = 0
  for (const col of project.columns) {
    for (const cb of col.corbels ?? []) {
      const li = levels.findIndex((l) => l.id === cb.levelId)
      if (li < 0) continue
      const nd = nodes.find(
        (n) =>
          n.levelIndex === li &&
          n.kind === 'structural' &&
          Math.abs(n.x - col.pos.x) < 0.05 &&
          Math.abs(n.y - col.pos.y) < 0.05,
      )
      if (!nd) continue
      const fk = cb.fd / 1.4
      const rad = (cb.rotationDeg * Math.PI) / 180
      const ux = Math.cos(rad)
      const uy = Math.sin(rad)
      const he = columnHalfExtents(col)
      const e = Math.abs(ux) * he.dx + Math.abs(uy) * he.dy + cb.a
      nodalLoads.G.push({ node: nd.id, dof: 2, value: -fk })
      nodalLoads.G.push({ node: nd.id, dof: 3, value: -fk * e * uy })
      nodalLoads.G.push({ node: nd.id, dof: 4, value: fk * e * ux })
      levelG[li] += fk
      nCorbelLoads++
    }
  }
  if (nCorbelLoads > 0) {
    warnings.push(
      `${nCorbelLoads} consolo(s): carga característica Fd/1,4 + momento da excentricidade aplicados como G no nó do pilar.`,
    )
  }

  // peso próprio
  if (project.settings.considerSelfWeight) {
    for (const m of members) {
      const A = m.props?.A ?? m.section.bw * m.section.h
      const w = A * γ
      if (m.ref.kind === 'column') {
        memberLoads.G[m.id].wx -= w // x local aponta p/ cima
        levelG[nodes[m.nj].levelIndex] += w * m.length
      } else {
        // trechos rígidos longitudinais: o peso do trecho dentro do apoio é
        // mantido (rateado no trecho flexível — conserva a força vertical)
        const along = (o?: Vec3) =>
          o ? Math.abs(o[0] * m.xLocal[0] + o[1] * m.xLocal[1] + o[2] * m.xLocal[2]) : 0
        const full = m.length + along(m.offI) + along(m.offJ)
        memberLoads.G[m.id].wy -= (w * full) / m.length // y local = vertical p/ cima
        levelG[nodes[m.ni].levelIndex] += w * full
      }
    }
  }

  // pedaços por viga (p/ cargas de parede e de laje)
  const piecesIndexByLevel = new Map<number, Map<string, number[]>>()
  for (const [li] of piecesByLevel) {
    const byBeam = new Map<string, number[]>()
    piecesIndexByLevel.set(li, byBeam)
  }
  for (const m of members) {
    if (m.ref.kind !== 'beam') continue
    const li = nodes[m.ni].levelIndex
    const byBeam = piecesIndexByLevel.get(li)
    if (!byBeam) continue
    const list = byBeam.get(m.ref.sourceId) ?? []
    list.push(m.id)
    byBeam.set(m.ref.sourceId, list)
  }

  // TRANSFERÊNCIA alvenaria → concreto (Fase 4): parede que morre sobre um
  // pavimento de PLANTA DIFERENTE descarrega g/q acumulados como carga linear
  // nas vigas colineares desse pavimento (mesmo mecanismo das cargas de
  // parede). Efeito arco NÃO abatido — a favor da segurança (calculadora
  // archEffect disponível p/ abatimento manual).
  {
    const stacks = masonryWallStackLoads(project)
    let nTransfer = 0
    for (const st of stacks) {
      const liBelow = st.lowestLevelIndex - 1
      const levelBelow = levels[liBelow]
      if (!levelBelow?.planId || levelBelow.planId === st.planId) continue
      const planBelow = project.plans.find((pl) => pl.id === levelBelow.planId)
      if (!planBelow) continue
      const byBeam = piecesIndexByLevel.get(liBelow)
      if (!byBeam) continue
      for (const beam of planBelow.beams) {
        // sobreposição colinear da parede com os trechos da viga (arco-comprimento)
        const ranges: [number, number][] = []
        let sCum = 0
        for (let bs = 0; bs + 1 < beam.path.length; bs++) {
          const a = beam.path[bs]
          const b = beam.path[bs + 1]
          const segLen = Math.hypot(b.x - a.x, b.y - a.y)
          for (let ws = 0; ws + 1 < st.path.length; ws++) {
            const p1 = projectOnSegment(st.path[ws], a, b)
            const p2 = projectOnSegment(st.path[ws + 1], a, b)
            if (p1.d <= TOL * 4 && p2.d <= TOL * 4) {
              const t0 = Math.max(Math.min(p1.t, p2.t), 0) * segLen
              const t1 = Math.min(Math.max(p1.t, p2.t), 1) * segLen
              if (t1 - t0 > 0.1) ranges.push([sCum + t0, sCum + t1])
            }
          }
          sCum += segLen
        }
        if (ranges.length === 0) continue
        const memberIds = byBeam.get(beam.id)
        if (!memberIds) continue
        for (const [x0, x1] of ranges) {
          for (const mid of memberIds) {
            const arc = memberArc.get(mid)
            const s0 = arc?.s0 ?? 0
            const s1 = arc?.s1 ?? members[mid].length
            const ov = Math.min(s1, x1) - Math.max(s0, x0)
            if (ov <= TOL) continue
            const frac = Math.min(ov / (s1 - s0), 1) * loadScale(mid)
            memberLoads.G[mid].wy -= st.g * frac
            memberLoads.Q[mid].wy -= st.q * frac
            levelG[liBelow] += st.g * ov
            levelQ[liBelow] += st.q * ov
          }
          nTransfer++
        }
      }
    }
    if (nTransfer > 0) {
      warnings.push(
        `Transferência alvenaria→concreto: ${nTransfer} trecho(s) de parede descarregando nas vigas do pavimento inferior (g+q acumulados; efeito arco não abatido — a favor da segurança).`,
      )
    }
  }


  // alvenaria (cargas de linha permanentes) — viga inteira ou trecho [x0, x1];
  // inclui o nível 0 (alvenaria de embasamento sobre baldrames)
  for (let li = 0; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    const byBeam = piecesIndexByLevel.get(li)
    if (!byBeam) continue
    for (const wl of plan.wallLoads) {
      const memberIds = byBeam.get(wl.beamId)
      if (!memberIds) continue
      const x0 = wl.x0 ?? -Infinity
      const x1 = wl.x1 ?? Infinity
      let applied = 0
      for (const mid of memberIds) {
        const arc = memberArc.get(mid)
        const s0 = arc?.s0 ?? 0
        const s1 = arc?.s1 ?? members[mid].length
        const ov = Math.min(s1, x1) - Math.max(s0, x0)
        if (ov <= TOL) continue
        // carga uniforme equivalente no pedaço, conservando a força total
        const frac = Math.min(ov / (s1 - s0), 1) * loadScale(mid)
        memberLoads.G[mid].wy -= wl.w * frac
        levelG[li] += wl.w * ov
        applied += ov
      }
      if (wl.x0 !== undefined && wl.x1 !== undefined && applied < (x1 - x0) * 0.5) {
        warnings.push(
          `Carga de parede em ${plan.beams.find((b) => b.id === wl.beamId)?.name ?? '?'} (${level.name}): trecho ${wl.x0.toFixed(2)}–${wl.x1.toFixed(2)} m cobre pouco da viga — confira as posições.`,
        )
      }
    }
  }

  // lajes: quinhões por área de influência (Marcus) ou reações da GRELHA
  const useGrid = project.settings.slabMethod === 'grelha'
  const gridCache = new Map<string, SlabGridOutput>()
  const levelIndexOfColumn = (colId: string): [number, number] => {
    const col = project.columns.find((c) => c.id === colId)
    if (!col) return [0, -1]
    return [
      levelIndexById.get(col.baseLevelId) ?? 0,
      levelIndexById.get(col.topLevelId) ?? levels.length - 1,
    ]
  }
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    const levelMembers = members.filter(
      (m) => m.ref.kind === 'beam' && nodes[m.ni].levelIndex === li,
    )
    // cobertura das regiões de carga (escada/reservatório) sobre as lajes
    for (const region of plan.loadRegions ?? []) {
      const aRegion = polygonArea(region.polygon)
      if (aRegion < 1e-6) continue
      let covered = 0
      for (const slab of plan.slabs) {
        covered += overlapArea(region.polygon, convexClipOf(slab))
      }
      if (covered < 0.9 * aRegion) {
        warnings.push(
          `Região ${region.name} (${level.name}): apenas ${Math.round(
            (100 * covered) / aRegion,
          )}% sobre lajes — carga fora de laje não aplicada.`,
        )
      }
    }
    for (const slab of plan.slabs) {
      const area = polygonArea(slab.polygon)
      if (area < 1e-6) continue
      const extras = slabExtraLoads(plan, slab)
      // furos (e escadas com abertura) removem a laje na área de interseção:
      // peso próprio/revestimento/sobrecarga só atuam na área líquida; as
      // cargas de região (extras) permanecem íntegras (vão p/ o contorno)
      const openArea = Math.min(slabOpeningsArea(plan, slab), area)
      const netFactor = (area - openArea) / area
      if (openArea > 0.5 * area) {
        warnings.push(
          `Laje ${slab.name} (${level.name}): furos cobrem ${Math.round(
            (100 * openArea) / area,
          )}% da área — verifique o modelo.`,
        )
      }
      const gSelf = slabSelfWeight(slab, γ)
      const gArea = (gSelf + slab.finishLoad) * netFactor + extras.g // kN/m²
      const qArea = slab.liveLoad * netFactor + extras.q
      levelG[li] += gArea * area
      levelQ[li] += qArea * area

      // nervurada unidirecional / treliçada: a carga desce só nas vigas onde as
      // nervuras apoiam (com 5/8–3/8 quando um extremo tem continuidade)
      const oneWayAxis = slab.ribbed && slab.ribbed.dirs !== 'xy' ? slab.ribbed.dirs : null
      // contorno SEM vértices colineares: a borda é casada inteira com as vigas
      // (um vértice no meio do lado não pode virar "borda livre" pela metade)
      const poly = simplifyPolygon(slab.polygon)
      const n = poly.length
      let edgeShares: number[]
      if (oneWayAxis) {
        const considerContinuity = slab.ribbed!.lattice ? !!slab.ribbed!.lattice.continuous : true
        const others = plan.slabs.filter((o) => o.id !== slab.id)
        const fixed = poly.map(
          (p, e) => considerContinuity && edgeContinuous(p, poly[(e + 1) % n], others),
        )
        edgeShares = oneWayTributaryAreas(poly, oneWayAxis, (e) => fixed[e])
      } else {
        edgeShares = tributaryAreas(poly)
      }
      // 1º passe: identifica bordas apoiadas e acumula quinhões de bordas livres
      interface EdgeSupport {
        aTrib: number
        onEdge: number[]
        covered: number
        edgeLen: number
        edgeIndex: number
      }
      const supported: EdgeSupport[] = []
      let freeTrib = 0
      for (let e = 0; e < n; e++) {
        const pa = poly[e]
        const pb = poly[(e + 1) % n]
        const edgeLen = dist(pa, pb)
        if (edgeLen < TOL) continue
        const aTrib = edgeShares[e]
        if (aTrib < 1e-9) continue
        // membros de viga sobre esta borda
        const onEdge: number[] = []
        let covered = 0
        for (const m of levelMembers) {
          const p1 = m.axis?.a ?? { x: nodes[m.ni].x, y: nodes[m.ni].y }
          const p2 = m.axis?.b ?? { x: nodes[m.nj].x, y: nodes[m.nj].y }
          const pr1 = projectOnSegment(p1, pa, pb)
          const pr2 = projectOnSegment(p2, pa, pb)
          if (pr1.d <= TOL * 3 && pr2.d <= TOL * 3) {
            onEdge.push(m.id)
            covered += m.axis ? dist(p1, p2) : m.length
          }
        }
        if (onEdge.length === 0) {
          freeTrib += aTrib
          continue
        }
        // o trecho de viga dentro da seção do pilar também apoia a borda
        for (const st of stubsByLevel.get(li) ?? []) {
          if (
            projectOnSegment(st.a, pa, pb).d <= TOL * 3 &&
            projectOnSegment(st.b, pa, pb).d <= TOL * 3
          )
            covered += dist(st.a, st.b)
        }
        supported.push({ aTrib, onEdge, covered, edgeLen, edgeIndex: e })
        if (covered < edgeLen - 10 * TOL) {
          warnings.push(
            `Laje ${slab.name} (${level.name}): borda parcialmente apoiada (${covered.toFixed(
              2,
            )} de ${edgeLen.toFixed(2)} m) — carga concentrada nas vigas existentes.`,
          )
        }
      }
      // ---------------- método da GRELHA: reações reais por borda + pilares
      if (useGrid && !oneWayAxis) {
        // pilares que apoiam a laje direto (internos, de borda livre e de
        // canto — §19.5.2): todos precisam entrar na grelha como apoio
        const supportedEdgeIdx = supported.map((ed) => ed.edgeIndex)
        const supportedSet = new Set(supportedEdgeIdx)
        const onBeamFn = (p: Vec2): boolean =>
          levelMembers.some((m) => {
            const na = m.axis?.a ?? nodes[m.ni]
            const nb = m.axis?.b ?? nodes[m.nj]
            return projectOnSegment(p, { x: na.x, y: na.y }, { x: nb.x, y: nb.y }).d <= TOL * 2
          })
        const candidates = project.columns
          .filter((col) => {
            const [ib, it] = levelIndexOfColumn(col.id)
            return li >= ib && li <= it
          })
          .map((col) => {
            const info = columnSectionInfo(col.section)
            return { id: col.id, pos: col.pos, half: Math.hypot(info.bu, info.bv) / 2 }
          })
        const interior = classifySlabColumns(
          candidates,
          poly,
          (e) => supportedSet.has(e),
          onBeamFn,
        )
        if (supportedEdgeIdx.length + interior.length > 0) {
          try {
            const key = slabGridCacheKey({
              polygon: poly,
              holes: slabOpeningPolygons(plan, slab),
              supportedEdges: supportedEdgeIdx,
              interiorColumns: interior,
              thickness: slab.thickness,
            })
            let grid = gridCache.get(key)
            if (!grid) {
              grid = analyzeSlabGrid({
                polygon: poly,
                holes: slabOpeningPolygons(plan, slab),
                supportedEdges: supportedEdgeIdx,
                interiorColumns: interior,
                thickness: slab.thickness,
                e: 25e6, // distribuição independe de E (uniforme na laje)
                q: 1,
              })
              gridCache.set(key, grid)
            }
            const totalG = gArea * area
            const totalQ = qArea * area
            for (const ed of supported) {
              const share = grid.edgeShares.get(ed.edgeIndex) ?? 0
              if (share <= 0) continue
              const wLineG = (share * totalG) / ed.covered
              const wLineQ = (share * totalQ) / ed.covered
              for (const mid of ed.onEdge) {
                memberLoads.G[mid].wy -= wLineG * loadScale(mid)
                memberLoads.Q[mid].wy -= wLineQ * loadScale(mid)
              }
            }
            for (const [colId, fUnit] of grid.columnLoads) {
              const col = project.columns.find((c) => c.id === colId)
              if (!col) continue
              const frac = fUnit / Math.max(grid.result.totalReaction, 1e-9)
              const node = getNode(li, col.pos)
              nodalLoads.G.push({ node, dof: 2, value: -frac * totalG })
              nodalLoads.Q.push({ node, dof: 2, value: -frac * totalQ })
            }
            if (interior.length > 0) {
              warnings.push(
                `Laje ${slab.name} (${level.name}): grelha com ${interior.length} pilar(es) interno(s) — laje lisa; punção verificada no dimensionamento.`,
              )
            }
            continue // não usa o caminho de quinhões a 45°
          } catch (err) {
            warnings.push(
              `Laje ${slab.name} (${level.name}): grelha falhou (${err instanceof Error ? err.message : 'erro'}) — usando quinhões a 45°.`,
            )
          }
        }
      }

      // 2º passe: aplica quinhões; bordas livres redistribuem às apoiadas
      const tribSupported = supported.reduce((s, ed) => s + ed.aTrib, 0)
      if (freeTrib > 1e-9) {
        if (tribSupported > 1e-9) {
          warnings.push(
            `Laje ${slab.name} (${level.name}): borda(s) livre(s) — quinhão de ${(
              freeTrib * gArea
            ).toFixed(1)} kN redistribuído às bordas apoiadas.`,
          )
        } else {
          warnings.push(
            `Laje ${slab.name} (${level.name}): NENHUMA borda apoiada — carga de ${(
              (freeTrib + tribSupported) * gArea
            ).toFixed(1)} kN não aplicada.`,
          )
        }
      }
      for (const ed of supported) {
        // quinhão próprio + parcela redistribuída (proporcional ao quinhão)
        const share = tribSupported > 1e-9 ? ed.aTrib * (1 + freeTrib / tribSupported) : ed.aTrib
        const wLineG = (share * gArea) / ed.covered
        const wLineQ = (share * qArea) / ed.covered
        for (const mid of ed.onEdge) {
          memberLoads.G[mid].wy -= wLineG * loadScale(mid)
          memberLoads.Q[mid].wy -= wLineQ * loadScale(mid)
        }
      }
    }
  }

  // ------------------------------------------------------------------ vento
  let wind: AnalysisModel['wind'] = null
  let imperfections: AnalysisModel['imperfections'] = null
  if (project.settings.wind.enabled) {
    const pts: Vec2[] = [
      ...project.columns.map((c) => c.pos),
      ...[...piecesByLevel.values()].flat().flatMap((p) => [p.a, p.b]),
    ]
    if (pts.length >= 2) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      const lx = Math.max(maxX - minX, 0.1)
      const ly = Math.max(maxY - minY, 0.1)
      const totalHeight = levels[levels.length - 1].elevation
      const geoLevels: WindGeometry['levels'] = []
      for (let li = 1; li < levels.length; li++) {
        const z = levels[li].elevation
        const below = levels[li - 1].elevation
        const above = li + 1 < levels.length ? levels[li + 1].elevation : z
        geoLevels.push({
          levelIndex: li,
          z,
          tributaryHeight: (z - below) / 2 + (above - z) / 2,
        })
      }
      wind = computeWind(project.settings.wind, { lx, ly, totalHeight, levels: geoLevels })

      // desaprumo global (NBR 6118 §11.3.3.4.1) — composto ao vento pela regra
      // da norma (compara momentos de tombamento na base; mesma direção/sentido)
      if (project.settings.notionalImperfections) {
        const weights = geoLevels.map((gl) => ({
          levelIndex: gl.levelIndex,
          z: gl.z,
          weight: levelG[gl.levelIndex] + levelQ[gl.levelIndex],
        }))
        const notional = notionalLoads(totalHeight, project.columns.length, weights)
        const rules: NonNullable<AnalysisModel['imperfections']>['rules'] = []
        for (const wd of wind) {
          const mWind = wd.perLevel.reduce((s, lf) => s + lf.F * lf.z, 0)
          const rule = windNotionalRule(mWind, notional.baseMoment)
          rules.push({ dir: wd.dir, rule, mWind })
          if (rule === 'somente-vento') continue
          const fOf = new Map(notional.perLevel.map((l) => [l.levelIndex, l.F]))
          for (const lf of wd.perLevel) {
            const fn = fOf.get(lf.levelIndex) ?? 0
            lf.F = rule === 'somente-desaprumo' ? fn : lf.F + fn
          }
          wd.totalForce = wd.perLevel.reduce((s, lf) => s + lf.F, 0)
        }
        imperfections = {
          theta1: notional.theta1,
          thetaA: notional.thetaA,
          baseMoment: notional.baseMoment,
          rules,
        }
        const composed = rules.filter((r) => r.rule !== 'somente-vento')
        if (composed.length > 0) {
          warnings.push(
            `Desaprumo global (θa = 1/${Math.round(1 / notional.thetaA)}) incluído nas ações laterais: ${composed
              .map((r) => `${r.dir} (${r.rule})`)
              .join(', ')}.`,
          )
        }
      }

      // aplica nos nós mestres (ou distribui nos nós do nível, com aviso)
      for (const wd of wind) {
        const caseId: CaseId = `W${wd.dir}` as CaseId
        const sign = wd.dir === 'XN' || wd.dir === 'YN' ? -1 : 1
        const dof = wd.dir.startsWith('X') ? 0 : 1
        // excentricidade da resultante: e = 7,5% da largura da face (NBR 6123
        // §6.6 — sem efeito de vizinhança) ⇒ torção no diafragma. Sinal único
        // por caso; a envoltória ±X/±Y cobre os dois giros em plantas ~simétricas.
        const eTor = 0.075 * (wd.dir.startsWith('X') ? ly : lx)
        for (const lf of wd.perLevel) {
          const master = masterByLevel.get(lf.levelIndex)
          if (master !== undefined) {
            nodalLoads[caseId].push({ node: master, dof, value: sign * lf.F })
            nodalLoads[caseId].push({ node: master, dof: 5, value: sign * lf.F * eTor })
          } else {
            const lvlNodes = nodes.filter(
              (nd) => nd.levelIndex === lf.levelIndex && nd.kind === 'structural',
            )
            if (lvlNodes.length > 0) {
              for (const nd of lvlNodes) {
                nodalLoads[caseId].push({ node: nd.id, dof, value: (sign * lf.F) / lvlNodes.length })
              }
            }
          }
        }
        if (wd.perLevel.some((lf) => masterByLevel.get(lf.levelIndex) === undefined)) {
          warnings.push(
            `Vento ${wd.dir}: há pavimentos sem laje (sem diafragma) — força distribuída nos nós.`,
          )
        }
      }
      warnings.push(
        'Vento com excentricidade de 7,5% da face (torção no diafragma, NBR 6123 §6.6) — plantas muito assimétricas: verificar o giro oposto.',
      )
    } else {
      warnings.push('Vento habilitado, mas o modelo não tem geometria em planta suficiente.')
    }
  } else if (project.settings.notionalImperfections) {
    warnings.push(
      'Desaprumo global não aplicado: habilite o vento para gerar os casos de ação lateral.',
    )
  }

  const levelWeights = levels
    .map((l, i) => ({ levelIndex: i, z: l.elevation, G: levelG[i], Q: levelQ[i] }))
    .filter((lw) => lw.levelIndex > 0)

  if (project.columns.length === 0) warnings.push('Modelo sem pilares — análise impossível.')

  const model: AnalysisModel = {
    nodes,
    members,
    masters,
    wind,
    imperfections,
    levelWeights,
    winkler: winkler.length > 0 ? winkler : null,
    winklerKs: ksGround > 0 ? ksGround : null,
    warnings,
    stats: { nodes: nodes.length, members: members.length, dofs: 0 },
  }
  return { model, internal: { memberLoads, nodalLoads } }
}

/** o furo vale p/ esta laje? (kind 'furo' sempre; escada conforme opening) */
export function regionOpensSlab(region: FloorPlan['loadRegions'][number]): boolean {
  if (region.kind === 'furo') return true
  if (region.kind === 'escada') return region.stair?.opening ?? true
  return false
}

/** área de furos/aberturas sobre a laje (interseção), m² */
export function slabOpeningsArea(plan: FloorPlan, slab: Slab): number {
  const clip = convexClipOf(slab)
  let a = 0
  for (const region of plan.loadRegions ?? []) {
    if (!regionOpensSlab(region)) continue
    a += overlapArea(region.polygon, clip)
  }
  return a
}

/** polígonos de furo recortados pela laje (p/ visualização/desenho) */
export function slabOpeningPolygons(plan: FloorPlan, slab: Slab): Vec2[][] {
  const clip = convexClipOf(slab)
  const out: Vec2[][] = []
  for (const region of plan.loadRegions ?? []) {
    if (!regionOpensSlab(region)) continue
    const cut = clipPolygon(region.polygon, clip)
    if (cut.length >= 3 && polygonArea(cut) > 1e-4) out.push(cut)
  }
  return out
}

export interface SlabColumnSupport {
  id: string
  pos: Vec2
  /** posição p/ punção (§19.5.2): interno, borda ou canto */
  position: 'internal' | 'edge' | 'corner'
  /** normal da borda livre apontando p/ DENTRO da laje (borda/canto) */
  inward?: Vec2
  /** normal da segunda borda livre (canto) */
  inward2?: Vec2
}

/**
 * Classifica os pilares que apoiam a laje DIRETAMENTE (sem viga no ponto):
 * internos ao polígono, sobre borda LIVRE (edge) ou no encontro de duas
 * bordas livres (corner). Pilar encostado em borda COM viga não conta
 * (a carga desce pela viga). `half` = meia-diagonal da seção (tolerância).
 */
export function classifySlabColumns(
  cols: { id: string; pos: Vec2; half: number }[],
  polygon: Vec2[],
  isEdgeSupported: (edgeIndex: number) => boolean,
  nearBeam: (p: Vec2) => boolean,
): SlabColumnSupport[] {
  const out: SlabColumnSupport[] = []
  const n = polygon.length
  for (const c of cols) {
    if (nearBeam(c.pos)) continue
    const touching: Vec2[] = []
    let touchesSupported = false
    for (let e = 0; e < n; e++) {
      const a = polygon[e]
      const b = polygon[(e + 1) % n]
      const { d } = projectOnSegment(c.pos, a, b)
      if (d > c.half + TOL * 4) continue
      if (isEdgeSupported(e)) {
        touchesSupported = true
        continue
      }
      const tx = b.x - a.x
      const ty = b.y - a.y
      const len = Math.hypot(tx, ty)
      if (len < TOL) continue
      // normal p/ DENTRO: testa qual lado do segmento contém a laje
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      let nx = -ty / len
      let ny = tx / len
      const probe = 0.03 + c.half
      if (!pointInPolygon({ x: mid.x + nx * probe, y: mid.y + ny * probe }, polygon)) {
        nx = -nx
        ny = -ny
      }
      touching.push({ x: nx, y: ny })
    }
    if (touching.length === 0) {
      if (!touchesSupported && pointInPolygon(c.pos, polygon)) {
        out.push({ id: c.id, pos: c.pos, position: 'internal' })
      }
      continue
    }
    if (touching.length === 1) {
      out.push({ id: c.id, pos: c.pos, position: 'edge', inward: touching[0] })
    } else {
      out.push({
        id: c.id,
        pos: c.pos,
        position: 'corner',
        inward: touching[0],
        inward2: touching[1],
      })
    }
  }
  return out
}

/** polígono de recorte convexo da laje (a própria, se convexa; senão o bbox) */
function convexClipOf(slab: Slab): Vec2[] {
  const poly = slab.polygon
  let sign = 0
  let convex = poly.length >= 3
  for (let i = 0; i < poly.length && convex; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = poly[(i + 2) % poly.length]
    const cr = cross(sub(b, a), sub(c, b))
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign === 0) sign = s
    else if (s !== sign) convex = false
  }
  if (convex) return poly
  const { min, max } = bbox(poly)
  return [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ]
}

/**
 * Cargas extras (g, q em kN/m²) que as regiões de carga do pavimento
 * depositam sobre uma laje — força total conservada, espalhada na laje.
 */
export function slabExtraLoads(plan: FloorPlan, slab: Slab): { g: number; q: number } {
  const aSlab = polygonArea(slab.polygon)
  if (aSlab < 1e-9) return { g: 0, q: 0 }
  let g = 0
  let q = 0
  const clip = convexClipOf(slab)
  for (const region of plan.loadRegions ?? []) {
    const ov = overlapArea(region.polygon, clip)
    if (ov > 1e-9) {
      g += (region.g * ov) / aSlab
      q += (region.q * ov) / aSlab
    }
  }
  return { g, q }
}

/**
 * Quinhões de carga (área de influência) por borda do polígono.
 * Retângulos: regra das charneiras a 45° (triângulos nos lados menores,
 * trapézios nos maiores). Outros polígonos: proporcional ao comprimento
 * da borda (aproximação documentada).
 */
export function tributaryAreas(original: Vec2[]): number[] {
  // vértices colineares (viga em "T" na borda) não mudam a forma: calcula no
  // contorno simplificado e rateia cada borda entre seus trechos originais
  const simp = simplifyPolygonMap(original)
  if (simp.polygon.length !== original.length) {
    const base = tributaryAreas(simp.polygon)
    const no = original.length
    const lenO = original.map((p, i) => dist(p, original[(i + 1) % no]))
    const lenS = new Array<number>(simp.polygon.length).fill(0)
    simp.edgeMap.forEach((se, e) => (lenS[se] += lenO[e]))
    return lenO.map((l, e) => {
      const se = simp.edgeMap[e]
      return lenS[se] > 1e-12 ? (base[se] * l) / lenS[se] : 0
    })
  }
  const polygon = original
  const n = polygon.length
  const area = polygonArea(polygon)
  const lens: number[] = []
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    const l = dist(polygon[i], polygon[(i + 1) % n])
    lens.push(l)
    perimeter += l
  }

  if (n === 4) {
    // retângulo? lados opostos iguais e ângulos ~retos
    const isRect =
      Math.abs(lens[0] - lens[2]) < 0.01 &&
      Math.abs(lens[1] - lens[3]) < 0.01 &&
      Math.abs(
        (polygon[1].x - polygon[0].x) * (polygon[2].x - polygon[1].x) +
          (polygon[1].y - polygon[0].y) * (polygon[2].y - polygon[1].y),
      ) <
        0.01 * lens[0] * lens[1]
    if (isRect) {
      const l01 = lens[0]
      const l12 = lens[1]
      const lx = Math.min(l01, l12) // menor vão
      const shares: number[] = []
      for (let e = 0; e < 4; e++) {
        const le = lens[e]
        if (Math.abs(le - lx) < 0.011) {
          shares.push((lx * lx) / 4) // triângulo
        } else {
          shares.push((lx * (2 * le - lx)) / 4) // trapézio
        }
      }
      // corrige arredondamento p/ conservar a área total
      const sum = shares.reduce((a, b) => a + b, 0)
      return shares.map((s) => (s * area) / sum)
    }
  }
  return lens.map((l) => (area * l) / perimeter)
}
