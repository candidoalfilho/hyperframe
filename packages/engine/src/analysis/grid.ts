import type { Vec2 } from '../model/types'
import { pointInPolygon, pointKey, projectOnSegment, TOL } from '../geometry/geometry'
import { SkylineMatrix, buildProfile } from './skyline'

/**
 * Grelha de pavimento (analogia de grelha p/ placas): malha regular de
 * barras cruzadas com 3 GDL por nó (w p/ cima, θx, θy), flexão EI + torção
 * GJ, resolvida com o mesmo solver skyline LDLᵀ do pórtico.
 *
 * Uso: análise de lajes (maciças) p/ dimensionamento por faixas, flechas,
 * distribuição de reações às bordas apoiadas e a PILARES INTERNOS (lajes
 * lisas/cogumelo — a reação alimenta a punção §19.5 e vira carga nodal no
 * pórtico).
 *
 * Convenções do elemento (eixo local x ao longo da barra):
 *  GDL locais [w_i, θax_i, θbend_i, w_j, θax_j, θbend_j], onde θax é a
 *  rotação em torno do próprio eixo (torção) e θbend a rotação de flexão.
 *  Âncoras nos testes: faixa unidirecional = viga (exata) e placa quadrada
 *  simplesmente apoiada (Timoshenko, tolerância de analogia).
 */

export interface GridNode {
  id: number
  x: number
  y: number
  /** apoio vertical (w = 0): borda com viga ou pilar interno */
  support: boolean
  /** pilar interno associado (id do Column) — reação vira carga no pórtico */
  columnId?: string
  /** bordas apoiadas do polígono às quais o nó pertence (canto = 2) */
  edgeIndices: number[]
  /** área tributária do nó (meia faixa nas bordas, quarto nos cantos), m² */
  trib: number
}

export interface GridMember {
  id: number
  ni: number
  nj: number
  /** direção: 0 = ao longo de x, 1 = ao longo de y */
  dir: 0 | 1
  /** largura da faixa representada, m */
  width: number
  length: number
}

export interface GridModel {
  nodes: GridNode[]
  members: GridMember[]
  /** espaçamentos da malha, m */
  dx: number
  dy: number
}

export interface GridResult {
  /** deslocamento w por nó (positivo p/ cima), m */
  w: number[]
  /** reações verticais nos apoios (positivo = apoio empurra p/ cima), kN */
  reactions: Map<number, number>
  /** momento fletor POR METRO máximo no vão (+) e no apoio (−) por direção, kN·m/m */
  mxSpanMax: number
  mxSupportMax: number
  mySpanMax: number
  mySupportMax: number
  /** flecha máxima (p/ baixo), m */
  wMax: number
  /** soma das reações, kN (≈ carga total — verificação) */
  totalReaction: number
}

// ---------------------------------------------------------------------------
// malha
// ---------------------------------------------------------------------------

export interface GridMeshInput {
  polygon: Vec2[]
  /** furos (contornos a excluir) */
  holes?: Vec2[][]
  /** bordas apoiadas (índice da borda do polígono) */
  supportedEdges: number[]
  /** pilares internos (posição + id) que servem de apoio pontual */
  interiorColumns?: { id: string; pos: Vec2 }[]
  /** espaçamento alvo da malha, m (ajustado p/ dividir o vão) */
  targetSpacing?: number
}

/** distância do ponto à borda `e` do polígono */
function distToEdge(p: Vec2, polygon: Vec2[], e: number): number {
  const a = polygon[e]
  const b = polygon[(e + 1) % polygon.length]
  return projectOnSegment(p, a, b).d
}

/** gera a malha regular recortada pelo contorno (e furos) */
export function buildGridMesh(inp: GridMeshInput): GridModel {
  const target = inp.targetSpacing ?? 0.5
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of inp.polygon) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const lx = Math.max(maxX - minX, 0.1)
  const ly = Math.max(maxY - minY, 0.1)
  const nx = Math.max(2, Math.round(lx / target))
  const ny = Math.max(2, Math.round(ly / target))
  const dx = lx / nx
  const dy = ly / ny

  const edgeTol = Math.min(dx, dy) * 0.45

  const nodes: GridNode[] = []
  const idByKey = new Map<string, number>()
  const gridIJ = new Map<number, [number, number]>()
  const idAt = (i: number, j: number): number | undefined =>
    idByKey.get(`${i}|${j}`)

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const p = { x: minX + i * dx, y: minY + j * dy }
      // dentro do contorno (com tolerância p/ nós de borda) e fora dos furos
      const onEdge = inp.polygon.some((_, e) => distToEdge(p, inp.polygon, e) <= edgeTol)
      const inside = pointInPolygon(p, inp.polygon)
      if (!inside && !onEdge) continue
      let inHole = false
      for (const hole of inp.holes ?? []) {
        if (pointInPolygon(p, hole)) {
          const nearHoleEdge = hole.some((hv, e) => {
            const b = hole[(e + 1) % hole.length]
            return projectOnSegment(p, hv, b).d <= edgeTol * 0.5
          })
          if (!nearHoleEdge) {
            inHole = true
            break
          }
        }
      }
      if (inHole) continue

      // apoio: perto de borda apoiada (canto pertence às duas)
      const edgeIndices: number[] = []
      for (const e of inp.supportedEdges) {
        if (distToEdge(p, inp.polygon, e) <= edgeTol) edgeIndices.push(e)
      }
      const support = edgeIndices.length > 0
      const id = nodes.length
      nodes.push({ id, x: p.x, y: p.y, support, edgeIndices, trib: 0 })
      idByKey.set(`${i}|${j}`, id)
      gridIJ.set(id, [i, j])
    }
  }

  // tributária por nó a partir da vizinhança (meia faixa onde falta vizinho)
  for (const [id, [i, j]] of gridIJ) {
    const tx =
      ((idAt(i - 1, j) !== undefined ? dx : 0) + (idAt(i + 1, j) !== undefined ? dx : 0)) / 2
    const ty =
      ((idAt(i, j - 1) !== undefined ? dy : 0) + (idAt(i, j + 1) !== undefined ? dy : 0)) / 2
    nodes[id].trib = Math.max(tx, dx / 2) * Math.max(ty, dy / 2)
  }

  // pilares internos: apoio no nó mais próximo
  for (const col of inp.interiorColumns ?? []) {
    let best = -1
    let bestD = Infinity
    for (const n of nodes) {
      const d = Math.hypot(n.x - col.pos.x, n.y - col.pos.y)
      if (d < bestD) {
        bestD = d
        best = n.id
      }
    }
    if (best >= 0 && bestD <= Math.max(dx, dy)) {
      nodes[best].support = true
      nodes[best].columnId = col.id
      nodes[best].edgeIndices = []
    }
  }

  // membros entre vizinhos da malha (faixas de borda com meia largura)
  const members: GridMember[] = []
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const a = idAt(i, j)
      if (a === undefined) continue
      const bx = idAt(i + 1, j)
      if (bx !== undefined) {
        const below = idAt(i, j - 1) !== undefined && idAt(i + 1, j - 1) !== undefined
        const above = idAt(i, j + 1) !== undefined && idAt(i + 1, j + 1) !== undefined
        const width = Math.max(((below ? 1 : 0) + (above ? 1 : 0)) * (dy / 2), dy / 2)
        members.push({ id: members.length, ni: a, nj: bx, dir: 0, width, length: dx })
      }
      const by = idAt(i, j + 1)
      if (by !== undefined) {
        const left = idAt(i - 1, j) !== undefined && idAt(i - 1, j + 1) !== undefined
        const right = idAt(i + 1, j) !== undefined && idAt(i + 1, j + 1) !== undefined
        const width = Math.max(((left ? 1 : 0) + (right ? 1 : 0)) * (dx / 2), dx / 2)
        members.push({ id: members.length, ni: a, nj: by, dir: 1, width, length: dy })
      }
    }
  }

  return { nodes, members, dx, dy }
}

// ---------------------------------------------------------------------------
// solver
// ---------------------------------------------------------------------------

/** rigidez local do elemento de grelha 6×6 (w, θax, θbend por nó) */
function gridStiffness(EI: number, GJ: number, L: number): Float64Array {
  const k = new Float64Array(36)
  const set = (i: number, j: number, v: number) => {
    k[i * 6 + j] = v
    k[j * 6 + i] = v
  }
  const L2 = L * L
  const L3 = L2 * L
  set(0, 0, (12 * EI) / L3)
  set(0, 2, (6 * EI) / L2)
  set(0, 3, -(12 * EI) / L3)
  set(0, 5, (6 * EI) / L2)
  set(1, 1, GJ / L)
  set(1, 4, -GJ / L)
  set(2, 2, (4 * EI) / L)
  set(2, 3, -(6 * EI) / L2)
  set(2, 5, (2 * EI) / L)
  set(3, 3, (12 * EI) / L3)
  set(3, 5, -(6 * EI) / L2)
  set(4, 4, GJ / L)
  set(5, 5, (4 * EI) / L)
  return k
}

export interface GridSolveInput {
  model: GridModel
  /** espessura da laje, m (EI = E·t³/12·b por faixa; GJ = E·t³/6·b) */
  thickness: number
  /** módulo de elasticidade, kPa */
  e: number
  /** pressão uniforme, kN/m² (positivo p/ BAIXO) */
  q: number
}

/**
 * Resolve a grelha p/ pressão uniforme. GDL globais por nó: [w, θx, θy]
 * (θx = rotação em torno de X global; θy em torno de Y). Barras em x:
 * torção = θx, flexão = θy; barras em y: torção = θy, flexão = θx (com
 * troca de sinal implícita absorvida pela simetria do elemento).
 */
export function solveGrid(inp: GridSolveInput): GridResult {
  const { model, thickness: t, e: E, q } = inp
  const nodes = model.nodes
  const members = model.members
  if (!nodes.some((n) => n.support)) {
    throw new Error(
      'Grelha sem nenhum apoio (mecanismo) — a laje precisa de bordas com viga ou pilares internos.',
    )
  }

  // numeração: nós livres têm 3 GDL; apoios têm w prescrito e rotações livres
  const dofOf = new Map<number, [number, number, number]>() // [w, θx, θy] (−1 = prescrito)
  let n = 0
  for (const nd of nodes) {
    const w = nd.support ? -1 : n++
    const rx = n++
    const ry = n++
    dofOf.set(nd.id, [w, rx, ry])
  }

  // mapeamento de GDL do elemento p/ globais
  const memberDofs: number[][] = []
  const memberK: Float64Array[] = []
  for (const m of members) {
    const b = m.width
    const EI = (E * b * t * t * t) / 12
    // torção da analogia: t³/12 POR FAMÍLIA de faixas (as duas famílias somam
    // a rigidez de twisting da placa) — calibrado pela âncora de Timoshenko
    const GJ = (E * b * t * t * t) / 12
    const k = gridStiffness(EI, GJ, m.length)
    const [wi, rxi, ryi] = dofOf.get(m.ni)!
    const [wj, rxj, ryj] = dofOf.get(m.nj)!
    // barras em x: [w, θax=θx, θbend=θy]; barras em y: [w, θax=θy, θbend=θx]
    const dofs =
      m.dir === 0 ? [wi, rxi, ryi, wj, rxj, ryj] : [wi, ryi, rxi, wj, ryj, rxj]
    memberDofs.push(dofs)
    memberK.push(k)
  }

  const minRow = buildProfile(n, (cb) => {
    for (const dofs of memberDofs) cb(dofs.filter((d) => d >= 0))
  })
  const K = new SkylineMatrix(minRow)
  for (let mi = 0; mi < members.length; mi++) {
    const dofs = memberDofs[mi]
    const k = memberK[mi]
    for (let a = 0; a < 6; a++) {
      const da = dofs[a]
      if (da < 0) continue
      for (let bIdx = 0; bIdx < 6; bIdx++) {
        const db = dofs[bIdx]
        if (db < 0 || da > db) continue
        const v = k[a * 6 + bIdx]
        if (v !== 0) K.add(da, db, v)
      }
    }
  }
  K.factorize()

  // cargas nodais: pressão × área tributária do nó (calculada na malha)
  const F = new Float64Array(n)
  for (const nd of nodes) {
    const [w] = dofOf.get(nd.id)!
    if (w >= 0) F[w] -= q * nd.trib // w positivo p/ cima
  }

  const U = K.solve(F)
  const w = nodes.map((nd) => {
    const [wd] = dofOf.get(nd.id)!
    return wd >= 0 ? U[wd] : 0
  })
  const rot = (nd: GridNode): [number, number] => {
    const [, rx, ry] = dofOf.get(nd.id)!
    return [U[rx] ?? 0, U[ry] ?? 0]
  }

  // esforços por membro + reações nos apoios
  const reactions = new Map<number, number>()
  let mxSpanMax = 0
  let mxSupportMax = 0
  let mySpanMax = 0
  let mySupportMax = 0
  for (let mi = 0; mi < members.length; mi++) {
    const m = members[mi]
    const k = memberK[mi]
    const na = nodes[m.ni]
    const nb = nodes[m.nj]
    const [rxa, rya] = rot(na)
    const [rxb, ryb] = rot(nb)
    const ul =
      m.dir === 0
        ? [w[m.ni], rxa, rya, w[m.nj], rxb, ryb]
        : [w[m.ni], rya, rxa, w[m.nj], ryb, rxb]
    const fl = new Float64Array(6)
    for (let i = 0; i < 6; i++) {
      let s = 0
      for (let j = 0; j < 6; j++) s += k[i * 6 + j] * ul[j]
      fl[i] = s
    }
    // reações: cortantes das extremidades acumulados nos nós de apoio
    if (na.support) reactions.set(m.ni, (reactions.get(m.ni) ?? 0) + fl[0])
    if (nb.support) reactions.set(m.nj, (reactions.get(m.nj) ?? 0) + fl[3])
    // momentos de flexão nas extremidades → por metro (÷ largura da faixa)
    const mA = Math.abs(fl[2]) / m.width
    const mB = Math.abs(fl[5]) / m.width
    // sinal físico: momento no vão (sagging) vs sobre apoio (hogging).
    // Aproximação robusta p/ malha: extremidade em nó de apoio ⇒ hogging.
    const isX = m.dir === 0
    const applyEnd = (mVal: number, atSupport: boolean) => {
      if (atSupport) {
        if (isX) mxSupportMax = Math.max(mxSupportMax, mVal)
        else mySupportMax = Math.max(mySupportMax, mVal)
      } else {
        if (isX) mxSpanMax = Math.max(mxSpanMax, mVal)
        else mySpanMax = Math.max(mySpanMax, mVal)
      }
    }
    applyEnd(mA, na.support)
    applyEnd(mB, nb.support)
  }

  // cargas nos nós de apoio também vão direto p/ o apoio
  for (const nd of nodes) {
    if (!nd.support) continue
    reactions.set(nd.id, (reactions.get(nd.id) ?? 0) + q * nd.trib)
  }

  let totalReaction = 0
  for (const r of reactions.values()) totalReaction += r
  const wMax = Math.max(0, ...w.map((v) => -v))

  return {
    w,
    reactions,
    mxSpanMax,
    mxSupportMax,
    mySpanMax,
    mySupportMax,
    wMax,
    totalReaction,
  }
}

// ---------------------------------------------------------------------------
// análise de uma laje (fachada de alto nível)
// ---------------------------------------------------------------------------

export interface SlabGridInput {
  polygon: Vec2[]
  holes?: Vec2[][]
  supportedEdges: number[]
  interiorColumns?: { id: string; pos: Vec2 }[]
  thickness: number
  e: number
  /** pressão característica, kN/m² */
  q: number
  targetSpacing?: number
}

export interface SlabGridOutput {
  result: GridResult
  /** fração da carga total que vai p/ cada borda apoiada (índice → fração) */
  edgeShares: Map<number, number>
  /** carga em cada pilar interno, kN (id do pilar → força) */
  columnLoads: Map<string, number>
  /** nº de nós/membros (diagnóstico) */
  stats: { nodes: number; members: number }
}

export function analyzeSlabGrid(inp: SlabGridInput): SlabGridOutput {
  const model = buildGridMesh({
    polygon: inp.polygon,
    holes: inp.holes,
    supportedEdges: inp.supportedEdges,
    interiorColumns: inp.interiorColumns,
    targetSpacing: inp.targetSpacing,
  })
  const result = solveGrid({ model, thickness: inp.thickness, e: inp.e, q: inp.q })

  const edgeShares = new Map<number, number>()
  const columnLoads = new Map<string, number>()
  const total = Math.max(result.totalReaction, 1e-9)
  for (const [nodeId, r] of result.reactions) {
    const nd = model.nodes[nodeId]
    if (nd.columnId) {
      columnLoads.set(nd.columnId, (columnLoads.get(nd.columnId) ?? 0) + r)
    } else if (nd.edgeIndices.length > 0) {
      // canto: divide entre as bordas adjacentes
      for (const e of nd.edgeIndices) {
        edgeShares.set(e, (edgeShares.get(e) ?? 0) + r / total / nd.edgeIndices.length)
      }
    } else {
      // apoio sem borda (não deveria ocorrer) — rateia p/ todas as bordas
      for (const e of inp.supportedEdges) {
        edgeShares.set(e, (edgeShares.get(e) ?? 0) + r / total / inp.supportedEdges.length)
      }
    }
  }

  return {
    result,
    edgeShares,
    columnLoads,
    stats: { nodes: model.nodes.length, members: model.members.length },
  }
}

/** chave estável p/ cache de grelha por laje (geometria + malha) */
export function slabGridCacheKey(inp: Omit<SlabGridInput, 'q' | 'e'>): string {
  return [
    inp.polygon.map(pointKey).join(';'),
    (inp.holes ?? []).map((h) => h.map(pointKey).join(';')).join('|'),
    inp.supportedEdges.join(','),
    (inp.interiorColumns ?? []).map((c) => `${c.id}@${pointKey(c.pos)}`).join(','),
    inp.thickness.toFixed(4),
    (inp.targetSpacing ?? 0.5).toFixed(3),
    TOL,
  ].join('#')
}
