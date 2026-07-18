import type { Vec2 } from '../model/types'
import { pointInPolygon, projectOnSegment } from '../geometry/geometry'
import { SkylineMatrix, buildProfile } from './skyline'
import { gridStiffness } from './grid'

/**
 * GRELHA DE PAVIMENTO UNIFICADA: todas as lajes MACIÇAS de uma planta numa
 * malha única + VIGAS como barras flexíveis (EI real da seção; torção
 * fissurada 0,15·GJ — §17.5.1.2) + apoios verticais SÓ nos pilares.
 *
 * Ganhos sobre a grelha por laje (bordas rotuladas):
 *  - CONTINUIDADE entre lajes vizinhas (momentos negativos reais na borda
 *    comum — a rotação é contínua através do nó da viga);
 *  - flexibilidade das vigas (alivia vãos internos, carrega os pilares
 *    conforme a rigidez real);
 *  - reações de pilar diretas p/ punção (lajes lisas e apoios de borda).
 *
 * Degradação controlada: trechos de viga NÃO alinhados com a malha (fora dos
 * eixos X/Y) viram apoios rígidos como antes; regiões sem caminho até um
 * pilar são pinadas nas linhas de viga (nota) — e se ainda assim houver
 * mecanismo, o chamador cai no método por laje.
 */

export interface FloorGridInput {
  slabs: {
    id: string
    polygon: Vec2[]
    holes: Vec2[][]
    thickness: number
    /** pressões características, kN/m² (positivo p/ baixo) */
    pTot: number
    pQp: number
  }[]
  beams: {
    path: Vec2[]
    /** seção por trecho da polilinha (bw×h, m) */
    sections: { bw: number; h: number }[]
  }[]
  /** pilares ativos no nível (apoio vertical) */
  columns: { id: string; pos: Vec2 }[]
  /** módulo de elasticidade do concreto, kPa */
  e: number
  targetSpacing?: number
}

export interface FloorGridSlabResult {
  slabId: string
  /** momentos POR METRO característicos (padrão real de cargas), kN·m/m */
  mxSpanMax: number
  mxSupportMax: number
  mySpanMax: number
  mySupportMax: number
  /** flecha RELATIVA ao contorno da laje (média das bordas), m, p/ baixo */
  wRelTot: number
  wRelQp: number
  /** reações características dos pilares que tocam esta laje, kN */
  columnLoads: Map<string, number>
}

export interface FloorGridOutput {
  slabs: Map<string, FloorGridSlabResult>
  /** reações características de TODOS os pilares do pavimento, kN */
  columnLoads: Map<string, number>
  stats: { nodes: number; members: number }
  notes: string[]
  /** verificação: Σ reações ≈ carga total */
  totalReaction: number
  totalLoad: number
}

interface FNode {
  id: number
  x: number
  y: number
  slabIds: number[] // índices em inp.slabs
  onBeam: boolean
  support: boolean
  columnId?: string
  trib: number
  pTot: number
  pQp: number
}

interface FMember {
  ni: number
  nj: number
  dir: 0 | 1
  width: number
  length: number
  /** rigidez de VIGA (sobrepõe a faixa de laje) */
  beam?: { ei: number; gj: number }
  /** espessura da faixa de laje, m */
  t: number
  slabIdx: number
}

export function analyzeFloorGrid(inp: FloorGridInput): FloorGridOutput {
  const notes: string[] = []
  const target = inp.targetSpacing ?? 0.5
  if (inp.slabs.length === 0) throw new Error('Pavimento sem lajes maciças p/ a grelha unificada.')

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of inp.slabs) {
    for (const p of s.polygon) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const lx = Math.max(maxX - minX, 0.1)
  const ly = Math.max(maxY - minY, 0.1)
  const nx = Math.max(2, Math.round(lx / target))
  const ny = Math.max(2, Math.round(ly / target))
  const dx = lx / nx
  const dy = ly / ny
  const edgeTol = Math.min(dx, dy) * 0.45

  const distToPolyEdge = (p: Vec2, poly: Vec2[]): number => {
    let best = Infinity
    for (let e = 0; e < poly.length; e++) {
      best = Math.min(best, projectOnSegment(p, poly[e], poly[(e + 1) % poly.length]).d)
    }
    return best
  }

  // trechos de viga: axis-aligned viram barras; oblíquos viram apoio rígido
  interface BeamSeg {
    a: Vec2
    b: Vec2
    dir: 0 | 1 | -1 // -1 = oblíquo
    ei: number
    gj: number
  }
  const segs: BeamSeg[] = []
  let oblique = 0
  for (const beam of inp.beams) {
    for (let s = 0; s + 1 < beam.path.length; s++) {
      const a = beam.path[s]
      const b = beam.path[s + 1]
      const sec = beam.sections[s] ?? beam.sections[0]
      if (!sec) continue
      const ei = (inp.e * sec.bw * sec.h ** 3) / 12
      // St-Venant J ≈ 0,2·a·b³ (a = lado maior); G = 0,4·E; 15% fissurada
      const aa = Math.max(sec.bw, sec.h)
      const bb = Math.min(sec.bw, sec.h)
      const gj = 0.15 * 0.4 * inp.e * 0.2 * aa * bb ** 3
      const horiz = Math.abs(b.y - a.y) <= edgeTol
      const vert = Math.abs(b.x - a.x) <= edgeTol
      const dir: BeamSeg['dir'] = horiz ? 0 : vert ? 1 : -1
      if (dir === -1) oblique++
      segs.push({ a, b, dir, ei, gj })
    }
  }
  if (oblique > 0) {
    notes.push(
      `${oblique} trecho(s) de viga fora dos eixos X/Y tratado(s) como apoio rígido na grelha unificada.`,
    )
  }

  // ---- nós ----
  const nodes: FNode[] = []
  const idByKey = new Map<string, number>()
  const gridIJ = new Map<number, [number, number]>()
  const idAt = (i: number, j: number): number | undefined => idByKey.get(`${i}|${j}`)

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const p = { x: minX + i * dx, y: minY + j * dy }
      const slabIds: number[] = []
      for (let si = 0; si < inp.slabs.length; si++) {
        const s = inp.slabs[si]
        const inside = pointInPolygon(p, s.polygon) || distToPolyEdge(p, s.polygon) <= edgeTol
        if (!inside) continue
        let inHole = false
        for (const hole of s.holes) {
          if (pointInPolygon(p, hole) && distToPolyEdge(p, hole) > edgeTol * 0.5) {
            inHole = true
            break
          }
        }
        if (!inHole) slabIds.push(si)
      }
      if (slabIds.length === 0) continue

      // vigas próximas: barra (alinhada) ou apoio rígido (oblíqua)
      let onBeam = false
      let rigid = false
      for (const sg of segs) {
        if (projectOnSegment(p, sg.a, sg.b).d <= edgeTol) {
          if (sg.dir === -1) rigid = true
          else onBeam = true
        }
      }

      const id = nodes.length
      const pTot = slabIds.reduce((s, si) => s + inp.slabs[si].pTot, 0) / slabIds.length
      const pQp = slabIds.reduce((s, si) => s + inp.slabs[si].pQp, 0) / slabIds.length
      nodes.push({ id, x: p.x, y: p.y, slabIds, onBeam, support: rigid, trib: 0, pTot, pQp })
      idByKey.set(`${i}|${j}`, id)
      gridIJ.set(id, [i, j])
    }
  }
  if (nodes.length < 8) throw new Error('Malha unificada degenerada (poucas lajes/nós).')

  // tributária
  for (const [id, [i, j]] of gridIJ) {
    const tx =
      ((idAt(i - 1, j) !== undefined ? dx : 0) + (idAt(i + 1, j) !== undefined ? dx : 0)) / 2
    const ty =
      ((idAt(i, j - 1) !== undefined ? dy : 0) + (idAt(i, j + 1) !== undefined ? dy : 0)) / 2
    nodes[id].trib = Math.max(tx, dx / 2) * Math.max(ty, dy / 2)
  }

  // pilares → apoio no nó mais próximo
  let colSnapped = 0
  for (const col of inp.columns) {
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
      colSnapped++
    }
  }
  if (colSnapped === 0) {
    throw new Error('Grelha unificada sem nenhum pilar no pavimento — mecanismo.')
  }

  // ---- membros ----
  const members: FMember[] = []
  const beamOf = (pa: Vec2, pb: Vec2, dir: 0 | 1): BeamSeg | null => {
    for (const sg of segs) {
      if (sg.dir !== dir) continue
      if (
        projectOnSegment(pa, sg.a, sg.b).d <= edgeTol &&
        projectOnSegment(pb, sg.a, sg.b).d <= edgeTol
      ) {
        return sg
      }
    }
    return null
  }
  const slabOfMid = (pa: FNode, pb: FNode): number => {
    const common = pa.slabIds.filter((s) => pb.slabIds.includes(s))
    if (common.length === 1) return common[0]
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
    for (const si of common.length > 0 ? common : pa.slabIds) {
      if (pointInPolygon(mid, inp.slabs[si].polygon)) return si
    }
    return common[0] ?? pa.slabIds[0]
  }

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const a = idAt(i, j)
      if (a === undefined) continue
      const pairs: [number | undefined, 0 | 1, number][] = [
        [idAt(i + 1, j), 0, dx],
        [idAt(i, j + 1), 1, dy],
      ]
      for (const [b, dir, len] of pairs) {
        if (b === undefined) continue
        const na = nodes[a]
        const nb = nodes[b]
        // sem laje em comum e sem viga ligando ⇒ não conecta (lajes separadas)
        const common = na.slabIds.some((s) => nb.slabIds.includes(s))
        const bm = beamOf(na, nb, dir)
        if (!common && !bm) continue
        const width =
          dir === 0
            ? Math.max(
                (((idAt(i, j - 1) !== undefined && idAt(i + 1, j - 1) !== undefined ? 1 : 0) +
                  (idAt(i, j + 1) !== undefined && idAt(i + 1, j + 1) !== undefined ? 1 : 0)) *
                  dy) /
                  2,
                dy / 2,
              )
            : Math.max(
                (((idAt(i - 1, j) !== undefined && idAt(i - 1, j + 1) !== undefined ? 1 : 0) +
                  (idAt(i + 1, j) !== undefined && idAt(i + 1, j + 1) !== undefined ? 1 : 0)) *
                  dx) /
                  2,
                dx / 2,
              )
        const si = slabOfMid(na, nb)
        members.push({
          ni: a,
          nj: b,
          dir,
          width,
          length: len,
          beam: bm ? { ei: bm.ei, gj: bm.gj } : undefined,
          t: inp.slabs[si]?.thickness ?? inp.slabs[0].thickness,
          slabIdx: si,
        })
      }
    }
  }

  // ---- conectividade: regiões sem caminho a pilar → pina linhas de viga ----
  const adj = new Map<number, number[]>()
  for (const m of members) {
    if (!adj.has(m.ni)) adj.set(m.ni, [])
    if (!adj.has(m.nj)) adj.set(m.nj, [])
    adj.get(m.ni)!.push(m.nj)
    adj.get(m.nj)!.push(m.ni)
  }
  const bfs = (): Set<number> => {
    const seen = new Set<number>()
    const queue = nodes.filter((n) => n.support).map((n) => n.id)
    for (const q of queue) seen.add(q)
    while (queue.length > 0) {
      const cur = queue.pop()!
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb)
          queue.push(nb)
        }
      }
    }
    return seen
  }
  let reached = bfs()
  if (reached.size < nodes.length) {
    let pinned = 0
    for (const n of nodes) {
      if (!reached.has(n.id) && n.onBeam) {
        n.support = true
        pinned++
      }
    }
    if (pinned > 0) {
      notes.push(
        `Região sem caminho até pilar: ${pinned} nó(s) de viga pinado(s) (apoio rígido) na grelha unificada.`,
      )
      reached = bfs()
    }
    if (reached.size < nodes.length) {
      throw new Error('Grelha unificada com região sem apoio (mecanismo) — usando método por laje.')
    }
  }

  // ---- montagem e solução (2 padrões de carga, 1 fatoração) ----
  const dofOf = new Map<number, [number, number, number]>()
  let ndof = 0
  for (const nd of nodes) {
    const w = nd.support ? -1 : ndof++
    const rx = ndof++
    const ry = ndof++
    dofOf.set(nd.id, [w, rx, ry])
  }
  const memberDofs: number[][] = []
  const memberK: Float64Array[] = []
  for (const m of members) {
    const b = m.width
    const ei = m.beam ? m.beam.ei : (inp.e * b * m.t ** 3) / 12
    const gj = m.beam ? m.beam.gj : (inp.e * b * m.t ** 3) / 12
    const k = gridStiffness(ei, gj, m.length)
    const [wi, rxi, ryi] = dofOf.get(m.ni)!
    const [wj, rxj, ryj] = dofOf.get(m.nj)!
    const dofs = m.dir === 0 ? [wi, rxi, ryi, wj, rxj, ryj] : [wi, ryi, rxi, wj, ryj, rxj]
    memberDofs.push(dofs)
    memberK.push(k)
  }
  const minRow = buildProfile(ndof, (cb) => {
    for (const dofs of memberDofs) cb(dofs.filter((d) => d >= 0))
  })
  const K = new SkylineMatrix(minRow)
  for (let mi = 0; mi < members.length; mi++) {
    const dofs = memberDofs[mi]
    const k = memberK[mi]
    for (let a = 0; a < 6; a++) {
      const da = dofs[a]
      if (da < 0) continue
      for (let bi = 0; bi < 6; bi++) {
        const db = dofs[bi]
        if (db < 0 || da > db) continue
        const v = k[a * 6 + bi]
        if (v !== 0) K.add(da, db, v)
      }
    }
  }
  K.factorize()

  const solveFull = (pOf: (nd: FNode) => number) => {
    const F = new Float64Array(ndof)
    for (const nd of nodes) {
      const [w] = dofOf.get(nd.id)!
      if (w >= 0) F[w] -= pOf(nd) * nd.trib
    }
    const U = K.solve(F)
    const w = nodes.map((nd) => {
      const [wd] = dofOf.get(nd.id)!
      return wd >= 0 ? U[wd] : 0
    })
    const rot = (id: number): [number, number] => {
      const [, rx, ry] = dofOf.get(id)!
      return [U[rx] ?? 0, U[ry] ?? 0]
    }
    return { w, rot, pOf }
  }

  const tot = solveFull((nd) => nd.pTot)
  const qp = solveFull((nd) => nd.pQp)

  // ---- extração por laje ----
  const perSlab = inp.slabs.map((s) => ({
    slabId: s.id,
    mxSpanMax: 0,
    mxSupportMax: 0,
    mySpanMax: 0,
    mySupportMax: 0,
    wRelTot: 0,
    wRelQp: 0,
    columnLoads: new Map<string, number>(),
  }))
  const reactions = new Map<number, number>()

  for (let mi = 0; mi < members.length; mi++) {
    const m = members[mi]
    const k = memberK[mi]
    const na = nodes[m.ni]
    const nb = nodes[m.nj]
    const [rxa, rya] = tot.rot(m.ni)
    const [rxb, ryb] = tot.rot(m.nj)
    const ul =
      m.dir === 0
        ? [tot.w[m.ni], rxa, rya, tot.w[m.nj], rxb, ryb]
        : [tot.w[m.ni], rya, rxa, tot.w[m.nj], ryb, rxb]
    const fl = new Float64Array(6)
    for (let i = 0; i < 6; i++) {
      let s = 0
      for (let j = 0; j < 6; j++) s += k[i * 6 + j] * ul[j]
      fl[i] = s
    }
    if (na.support) reactions.set(m.ni, (reactions.get(m.ni) ?? 0) + fl[0])
    if (nb.support) reactions.set(m.nj, (reactions.get(m.nj) ?? 0) + fl[3])
    if (m.beam) continue // esforço de viga — não entra nos momentos de laje

    const isX = m.dir === 0
    const applyEnd = (nd: FNode, mPerM: number) => {
      const hog = nd.onBeam || nd.support
      const targets = hog ? nd.slabIds : [m.slabIdx]
      for (const si of targets) {
        const ps = perSlab[si]
        if (!ps) continue
        if (hog) {
          if (isX) ps.mxSupportMax = Math.max(ps.mxSupportMax, mPerM)
          else ps.mySupportMax = Math.max(ps.mySupportMax, mPerM)
        } else {
          if (isX) ps.mxSpanMax = Math.max(ps.mxSpanMax, mPerM)
          else ps.mySpanMax = Math.max(ps.mySpanMax, mPerM)
        }
      }
    }
    applyEnd(na, Math.abs(fl[2]) / m.width)
    applyEnd(nb, Math.abs(fl[5]) / m.width)
  }

  // carga direta nos nós de apoio
  for (const nd of nodes) {
    if (nd.support) reactions.set(nd.id, (reactions.get(nd.id) ?? 0) + nd.pTot * nd.trib)
  }

  // flecha relativa por laje (interior − média do contorno)
  for (let si = 0; si < inp.slabs.length; si++) {
    const ps = perSlab[si]
    const slabNodes = nodes.filter((n) => n.slabIds.includes(si))
    const boundary = slabNodes.filter(
      (n) => n.onBeam || n.support || distToPolyEdge(n, inp.slabs[si].polygon) <= edgeTol,
    )
    const relOf = (w: number[]): number => {
      if (boundary.length === 0) return Math.max(0, ...slabNodes.map((n) => -w[n.id]))
      const wb = boundary.reduce((s, n) => s + w[n.id], 0) / boundary.length
      return Math.max(0, ...slabNodes.map((n) => wb - w[n.id]))
    }
    ps.wRelTot = relOf(tot.w)
    ps.wRelQp = relOf(qp.w)
  }

  // reações por pilar (globais e por laje)
  const columnLoads = new Map<string, number>()
  let totalReaction = 0
  for (const [nid, r] of reactions) {
    totalReaction += r
    const nd = nodes[nid]
    if (!nd.columnId) continue
    columnLoads.set(nd.columnId, (columnLoads.get(nd.columnId) ?? 0) + r)
    for (const si of nd.slabIds) {
      const ps = perSlab[si]
      ps.columnLoads.set(nd.columnId, (ps.columnLoads.get(nd.columnId) ?? 0) + r)
    }
  }
  const totalLoad = nodes.reduce((s, n) => s + n.pTot * n.trib, 0)

  return {
    slabs: new Map(perSlab.map((p) => [p.slabId, p])),
    columnLoads,
    stats: { nodes: nodes.length, members: members.length },
    notes,
    totalReaction,
    totalLoad,
  }
}
