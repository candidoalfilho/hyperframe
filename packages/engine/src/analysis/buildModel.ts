import type { Project, Vec2 } from '../model/types'
import {
  TOL,
  dist,
  pointKey,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  segIntersection,
} from '../geometry/geometry'
import { computeWind } from '../nbr/nbr6123/wind'
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
  /** vão de dimensionamento (entre apoios em pilares), por viga */
  spanIndex: number
}

const CASES: CaseId[] = ['G', 'Q', 'WXP', 'WXN', 'WYP', 'WYN']

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
  /** pieces por índice de nível */
  const piecesByLevel = new Map<number, Piece[]>()

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

    const pieces: Piece[] = []
    for (const beam of plan.beams) {
      let spanIndex = 0
      for (let si = 0; si + 1 < beam.path.length; si++) {
        const a = beam.path[si]
        const b = beam.path[si + 1]
        const L = dist(a, b)
        if (L < TOL) continue
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
        const ts = [...cuts].sort((x, y) => x - y)
        for (let k = 0; k + 1 < ts.length; k++) {
          const t0 = ts[k]
          const t1 = ts[k + 1]
          if ((t1 - t0) * L < TOL) continue
          const pa = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }
          const pb = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }
          pieces.push({ a: pa, b: pb, beamId: beam.id, beamName: beam.name, spanIndex })
          // novo vão de dimensionamento quando o pedaço termina num pilar
          const endsOnColumn = colPoints.some((cp) => dist(cp, pb) <= TOL * 2)
          const isLastPiece = k + 2 === ts.length && si + 2 === beam.path.length
          if (endsOnColumn && !isLastPiece) spanIndex++
        }
      }
    }
    piecesByLevel.set(li, pieces)
  }

  // ---------------------------------------------------------------- membros
  const members: AMember[] = []
  const addMember = (
    ni: number,
    nj: number,
    ref: AMember['ref'],
    section: { bw: number; h: number },
    xL: Vec3,
    yL: Vec3,
    zL: Vec3,
  ) => {
    const a = nodes[ni]
    const b = nodes[nj]
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const m: AMember = { id: members.length, ni, nj, ref, section, length, xLocal: xL, yLocal: yL, zLocal: zL }
    members.push(m)
    return m
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
    if (iBase === 0) {
      nodes[baseNode].support = true
    } else {
      warnings.push(`Pilar ${col.name} nasce no nível ${levels[iBase].name} (sem apoio direto).`)
    }
    // eixos locais: x p/ cima; y local = direção da dimensão h da seção
    const yL: Vec3 = col.rotationDeg === 0 ? [1, 0, 0] : [0, 1, 0]
    const xL: Vec3 = [0, 0, 1]
    const zL: Vec3 = col.rotationDeg === 0 ? [0, 1, 0] : [-1, 0, 0]
    for (let i = iBase; i < iTop; i++) {
      const ni = getNode(i, col.pos)
      const nj = getNode(i + 1, col.pos)
      addMember(
        ni,
        nj,
        { kind: 'column', sourceId: col.id, sourceName: col.name, spanIndex: i - iBase },
        col.section,
        xL,
        yL,
        zL,
      )
    }
  }

  // vigas: uma barra por pedaço
  const beamSectionById = new Map<string, { bw: number; h: number }>()
  for (const plan of project.plans) {
    for (const b of plan.beams) beamSectionById.set(b.id, b.section)
  }
  for (const [li, pieces] of piecesByLevel) {
    for (const pc of pieces) {
      const ni = getNode(li, pc.a)
      const nj = getNode(li, pc.b)
      const dx = pc.b.x - pc.a.x
      const dy = pc.b.y - pc.a.y
      const L = Math.hypot(dx, dy)
      const xL: Vec3 = [dx / L, dy / L, 0]
      const yL: Vec3 = [0, 0, 1]
      const zL: Vec3 = [dy / L, -dx / L, 0]
      addMember(
        ni,
        nj,
        { kind: 'beam', sourceId: pc.beamId, sourceName: pc.beamName, spanIndex: pc.spanIndex },
        beamSectionById.get(pc.beamId) ?? { bw: 0.2, h: 0.5 },
        xL,
        yL,
        zL,
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

  // peso próprio
  if (project.settings.considerSelfWeight) {
    for (const m of members) {
      const A = m.section.bw * m.section.h
      const w = A * γ
      if (m.ref.kind === 'column') {
        memberLoads.G[m.id].wx -= w // x local aponta p/ cima
        levelG[nodes[m.nj].levelIndex] += w * m.length
      } else {
        memberLoads.G[m.id].wy -= w // y local = vertical p/ cima
        levelG[nodes[m.ni].levelIndex] += w * m.length
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

  // alvenaria (cargas de linha permanentes) — cobre toda a viga
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    const byBeam = piecesIndexByLevel.get(li)
    if (!byBeam) continue
    for (const wl of plan.wallLoads) {
      const memberIds = byBeam.get(wl.beamId)
      if (!memberIds) continue
      for (const mid of memberIds) {
        memberLoads.G[mid].wy -= wl.w
        levelG[li] += wl.w * members[mid].length
      }
    }
  }

  // lajes: quinhões de carga por área de influência
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li]
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    const levelMembers = members.filter(
      (m) => m.ref.kind === 'beam' && nodes[m.ni].levelIndex === li,
    )
    for (const slab of plan.slabs) {
      const area = polygonArea(slab.polygon)
      if (area < 1e-6) continue
      const gArea = slab.thickness * γ + slab.finishLoad // kN/m²
      const qArea = slab.liveLoad
      levelG[li] += gArea * area
      levelQ[li] += qArea * area

      const edgeShares = tributaryAreas(slab.polygon)
      const n = slab.polygon.length
      for (let e = 0; e < n; e++) {
        const pa = slab.polygon[e]
        const pb = slab.polygon[(e + 1) % n]
        const edgeLen = dist(pa, pb)
        if (edgeLen < TOL) continue
        const aTrib = edgeShares[e]
        if (aTrib < 1e-9) continue
        // membros de viga sobre esta borda
        const onEdge: number[] = []
        let covered = 0
        for (const m of levelMembers) {
          const na = nodes[m.ni]
          const nb = nodes[m.nj]
          const p1 = { x: na.x, y: na.y }
          const p2 = { x: nb.x, y: nb.y }
          const pr1 = projectOnSegment(p1, pa, pb)
          const pr2 = projectOnSegment(p2, pa, pb)
          if (pr1.d <= TOL * 3 && pr2.d <= TOL * 3) {
            onEdge.push(m.id)
            covered += m.length
          }
        }
        if (onEdge.length === 0) {
          warnings.push(
            `Laje ${slab.name} (${level.name}): borda sem viga de apoio — quinhão de ${(
              aTrib * gArea
            ).toFixed(1)} kN não aplicado.`,
          )
          continue
        }
        // carga de linha equivalente conservando a força total do quinhão
        const wLineG = (aTrib * gArea) / covered
        const wLineQ = (aTrib * qArea) / covered
        for (const mid of onEdge) {
          memberLoads.G[mid].wy -= wLineG
          memberLoads.Q[mid].wy -= wLineQ
        }
        if (covered < edgeLen - 10 * TOL) {
          warnings.push(
            `Laje ${slab.name} (${level.name}): borda parcialmente apoiada (${covered.toFixed(
              2,
            )} de ${edgeLen.toFixed(2)} m) — carga concentrada nas vigas existentes.`,
          )
        }
      }
    }
  }

  // ------------------------------------------------------------------ vento
  let wind: AnalysisModel['wind'] = null
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
      // aplica nos nós mestres (ou distribui nos nós do nível, com aviso)
      for (const wd of wind) {
        const caseId: CaseId = `W${wd.dir}` as CaseId
        const sign = wd.dir === 'XN' || wd.dir === 'YN' ? -1 : 1
        const dof = wd.dir.startsWith('X') ? 0 : 1
        for (const lf of wd.perLevel) {
          const master = masterByLevel.get(lf.levelIndex)
          if (master !== undefined) {
            nodalLoads[caseId].push({ node: master, dof, value: sign * lf.F })
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
    } else {
      warnings.push('Vento habilitado, mas o modelo não tem geometria em planta suficiente.')
    }
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
    levelWeights,
    warnings,
    stats: { nodes: nodes.length, members: members.length, dofs: 0 },
  }
  return { model, internal: { memberLoads, nodalLoads } }
}

/**
 * Quinhões de carga (área de influência) por borda do polígono.
 * Retângulos: regra das charneiras a 45° (triângulos nos lados menores,
 * trapézios nos maiores). Outros polígonos: proporcional ao comprimento
 * da borda (aproximação documentada).
 */
export function tributaryAreas(polygon: Vec2[]): number[] {
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
