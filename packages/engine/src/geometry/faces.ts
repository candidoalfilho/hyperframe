import type { Vec2 } from '../model/types'
import { TOL, pointKey, signedArea, splitSegments, type Segment } from './geometry'

/**
 * Detecção de faces (regiões fechadas) na subdivisão planar formada pelos
 * eixos das vigas — usada para reconhecer painéis de laje automaticamente.
 *
 * Algoritmo clássico de traçado de faces com meias-arestas ordenadas por
 * ângulo em cada nó. Retorna apenas as faces internas (área finita), em CCW.
 */
export function detectFaces(rawSegments: Segment[]): Vec2[][] {
  const segments = splitSegments(rawSegments)

  // nós únicos
  const nodeByKey = new Map<string, number>()
  const nodes: Vec2[] = []
  const nodeOf = (p: Vec2): number => {
    const k = pointKey(p)
    let id = nodeByKey.get(k)
    if (id === undefined) {
      id = nodes.length
      nodes.push(p)
      nodeByKey.set(k, id)
    }
    return id
  }

  interface Half {
    from: number
    to: number
    angle: number
    twin: number
    next: number
    visited: boolean
  }
  const halves: Half[] = []
  const outgoing = new Map<number, number[]>()

  const edgeSeen = new Set<string>()
  for (const s of segments) {
    const u = nodeOf(s.a)
    const v = nodeOf(s.b)
    if (u === v) continue
    const ek = u < v ? `${u}-${v}` : `${v}-${u}`
    if (edgeSeen.has(ek)) continue
    edgeSeen.add(ek)
    const a1 = Math.atan2(nodes[v].y - nodes[u].y, nodes[v].x - nodes[u].x)
    const a2 = Math.atan2(nodes[u].y - nodes[v].y, nodes[u].x - nodes[v].x)
    const i1 = halves.length
    halves.push({ from: u, to: v, angle: a1, twin: i1 + 1, next: -1, visited: false })
    halves.push({ from: v, to: u, angle: a2, twin: i1, next: -1, visited: false })
    if (!outgoing.has(u)) outgoing.set(u, [])
    if (!outgoing.has(v)) outgoing.set(v, [])
    outgoing.get(u)!.push(i1)
    outgoing.get(v)!.push(i1 + 1)
  }

  // ordena meias-arestas de saída por ângulo em cada nó
  for (const [, list] of outgoing) {
    list.sort((a, b) => halves[a].angle - halves[b].angle)
  }

  // next(e): no nó de chegada, pega a aresta imediatamente "no sentido horário"
  // a partir da gêmea de e — isso traça faces internas em CCW.
  for (let e = 0; e < halves.length; e++) {
    const h = halves[e]
    const list = outgoing.get(h.to)!
    const idx = list.indexOf(h.twin)
    const nextIdx = (idx - 1 + list.length) % list.length
    h.next = list[nextIdx]
  }

  const faces: Vec2[][] = []
  for (let e = 0; e < halves.length; e++) {
    if (halves[e].visited) continue
    const loop: number[] = []
    let cur = e
    let guard = 0
    while (!halves[cur].visited && guard++ < halves.length + 1) {
      halves[cur].visited = true
      loop.push(halves[cur].from)
      cur = halves[cur].next
    }
    if (loop.length < 3) continue
    const poly = loop.map((i) => nodes[i])
    const area = signedArea(poly)
    // faces internas saem em CCW (área > 0); a face externa sai negativa
    if (area > TOL) {
      faces.push(poly)
    }
  }
  return faces
}
