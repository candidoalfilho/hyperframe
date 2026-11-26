import type { Project, Vec2 } from '../model/types'
import { dist, polygonCentroid } from '../geometry/geometry'
import { isRectangular } from '../geometry/slabEdges'
import type { AnalysisResults, CaseId, SlabTransfer } from './types'

/**
 * CAMINHO DAS CARGAS VERTICAIS (issue #9) — lajes → vigas → pilares → fundações.
 *
 * Não é um cálculo novo: é a leitura, elemento por elemento, do equilíbrio que o
 * pórtico já resolveu. Em cada nó somam-se as forças verticais que cada elemento
 * exerce sobre ele (cortante das vigas, normal dos pilares, cargas nodais e
 * reações de apoio): quem empurra o nó para baixo ENTREGA carga, quem o segura
 * RECEBE. O que as lajes entregam às vigas vem do registro feito na montagem das
 * cargas (`model.loadTransfers`). Tudo é linear, então vale para qualquer caso
 * ou combinação (superposição com os fatores γ·ψ).
 */

export interface LoadPathSelection {
  label: string
  /** fatores por caso de carga (característico = 1) */
  factors: Partial<Record<CaseId, number>>
  /** passe de rigidez de onde saem os esforços */
  stiffness: 'elu' | 'els'
}

export interface LoadPathOption extends LoadPathSelection {
  id: string
  group: 'Casos' | 'Combinações'
}

export type LoadPathKind = 'slab' | 'beam' | 'column' | 'foundation' | 'soil' | 'direct'

export interface LoadPathElement {
  key: string
  kind: LoadPathKind
  /** id do elemento de modelagem (laje, viga, pilar) */
  id: string
  name: string
  /** laje/viga: pavimento; tramo de pilar: nível do TOPO do tramo; fundação: nível do apoio */
  levelIndex: number
  /** carga aplicada no próprio elemento, kN (peso próprio, paredes, carga da laje) */
  own: number
  parts: { label: string; value: number }[]
  /** soma do que recebe de outros elementos e do que entrega, kN */
  received: number
  delivered: number
  /** tramo de pilar: compressão no topo e na base, kN (negativo = tração) */
  nTop?: number
  nBase?: number
  /** laje: parcela sem apoio que a receba (não aplicada), kN */
  lost?: number
  pos?: Vec2
}

export interface LoadPathFlow {
  from: string
  to: string
  /** kN — sempre positivo no sentido from → to */
  value: number
  levelIndex: number
  /** ponto em planta onde a transferência ocorre */
  at: Vec2
}

export interface LoadPathSlabEdge {
  slabKey: string
  slabId: string
  levelIndex: number
  edgeIndex: number
  a: Vec2
  b: Vec2
  supported: boolean
  /** quinhão da borda p/ desenho; `exact` = a figura tem a área do quinhão */
  polygon: Vec2[]
  exact: boolean
  /** força entregue pela borda, kN, e por metro de borda, kN/m */
  value: number
  perMeter: number
  beamKeys: string[]
}

export interface LoadPathColumnStep {
  key: string
  /** nível do topo do tramo (o pavimento que descarrega nele) */
  levelIndex: number
  levelName: string
  /** parcelas que chegam ao topo do tramo, kN */
  fromAbove: number
  fromBeams: number
  fromSlabs: number
  /** peso próprio do tramo, kN */
  own: number
  /** compressão na base do tramo (acumulado), kN */
  nBase: number
}

export interface LoadPathColumn {
  columnId: string
  name: string
  pos: Vec2
  /** de cima para baixo */
  steps: LoadPathColumnStep[]
  /** reação vertical na fundação, kN (null = pilar sem apoio próprio) */
  foundation: number | null
}

export interface LoadPath {
  label: string
  factors: Partial<Record<CaseId, number>>
  levels: { levelIndex: number; name: string; elevation: number }[]
  elements: LoadPathElement[]
  flows: LoadPathFlow[]
  slabEdges: LoadPathSlabEdge[]
  columns: LoadPathColumn[]
  /** conferência do equilíbrio vertical, kN */
  check: {
    /** soma das cargas aplicadas nos elementos */
    applied: number
    /** soma das reações (fundações + solo sob baldrames) */
    reactions: number
    /** maior desequilíbrio encontrado num nó */
    residual: number
    /** carga de laje sem apoio (fora do pórtico) */
    lost: number
  }
}

export const slabKey = (levelIndex: number, id: string) => `s|${levelIndex}|${id}`
export const beamKey = (levelIndex: number, id: string) => `b|${levelIndex}|${id}`
export const columnKey = (id: string, spanIndex: number) => `c|${id}|${spanIndex}`
export const foundationKey = (columnId: string) => `f|${columnId}`

const CASE_LABEL: Partial<Record<CaseId, string>> = {
  G: 'G — permanente',
  Q: 'Q — acidental',
  WXP: 'Vento X+',
  WXN: 'Vento X−',
  WYP: 'Vento Y+',
  WYN: 'Vento Y−',
  EQXP: 'Sismo X+',
  EQXN: 'Sismo X−',
  EQYP: 'Sismo Y+',
  EQYN: 'Sismo Y−',
}

/** casos e combinações que podem ser exibidos no caminho das cargas */
export function loadPathOptions(results: AnalysisResults): LoadPathOption[] {
  const out: LoadPathOption[] = [
    {
      id: 'G+Q',
      group: 'Casos',
      label: 'G + Q — característica',
      factors: { G: 1, Q: 1 },
      stiffness: 'els',
    },
  ]
  for (const caseId of Object.keys(results.cases.els) as CaseId[]) {
    out.push({
      id: `case:${caseId}`,
      group: 'Casos',
      label: CASE_LABEL[caseId] ?? caseId,
      factors: { [caseId]: 1 },
      stiffness: 'els',
    })
  }
  for (const c of results.combos) {
    out.push({
      id: `combo:${c.id}`,
      group: 'Combinações',
      label: c.label,
      factors: c.factors,
      stiffness: c.stiffness,
    })
  }
  return out
}

/**
 * Figura do quinhão de cada borda, para desenho. Retângulo pelas charneiras a
 * 45°: triângulos nos lados menores e trapézios nos maiores. Unidirecional em
 * painel retangular: duas faixas (1/2–1/2 ou 5/8–3/8). Nos demais casos (grelha,
 * contorno qualquer) a repartição não tem figura própria — devolve a cunha
 * centroide–borda, só esquemática (`exact` = false).
 */
export function tributaryPolygons(
  st: Pick<SlabTransfer, 'polygon' | 'method' | 'edges'>,
): { polygon: Vec2[]; exact: boolean }[] {
  const p = st.polygon
  const n = p.length
  const wedges = (): { polygon: Vec2[]; exact: boolean }[] => {
    const c = polygonCentroid(p)
    return p.map((a, e) => ({ polygon: [a, p[(e + 1) % n], c], exact: false }))
  }
  if (n !== 4 || !isRectangular(p)) return wedges()
  const add = (a: Vec2, d: Vec2, k: number): Vec2 => ({ x: a.x + d.x * k, y: a.y + d.y * k })

  if (st.method === 'charneiras') {
    // gira os índices p/ que a borda 0 seja um lado MAIOR
    const l0 = dist(p[0], p[1])
    const l1 = dist(p[1], p[2])
    const s = l0 >= l1 ? 0 : 1
    const q = [0, 1, 2, 3].map((i) => p[(i + s) % 4])
    const L = dist(q[0], q[1])
    const lx = dist(q[1], q[2])
    const u = { x: (q[1].x - q[0].x) / L, y: (q[1].y - q[0].y) / L }
    const v = { x: (q[3].x - q[0].x) / lx, y: (q[3].y - q[0].y) / lx }
    const ra = add(add(q[0], u, lx / 2), v, lx / 2)
    const rb = add(add(q[1], u, -lx / 2), v, lx / 2)
    const rot = [
      [q[0], q[1], rb, ra],
      [q[1], q[2], rb],
      [q[2], q[3], ra, rb],
      [q[3], q[0], ra],
    ]
    return [0, 1, 2, 3].map((e) => ({ polygon: rot[(e - s + 4) % 4], exact: true }))
  }

  if (st.method === 'unidirecional') {
    const t = st.edges.map((e) => e.trib)
    const tot = t.reduce((a, b) => a + b, 0)
    for (const e of [0, 1]) {
      const o = e + 2
      // só as duas bordas opostas recebem (nervuras paralelas a um lado)
      if (tot <= 1e-9 || t[e] + t[o] < 0.999 * tot) continue
      const f = t[e] / (t[e] + t[o])
      const d = { x: p[(e + 2) % 4].x - p[(e + 1) % 4].x, y: p[(e + 2) % 4].y - p[(e + 1) % 4].y }
      const m1 = add(p[(e + 1) % 4], d, f)
      const m0 = add(p[e], d, f)
      const out: { polygon: Vec2[]; exact: boolean }[] = p.map(() => ({ polygon: [], exact: true }))
      out[e] = { polygon: [p[e], p[(e + 1) % 4], m1, m0], exact: true }
      out[o] = { polygon: [p[o], p[(o + 1) % 4], m0, m1], exact: true }
      return out
    }
  }
  return wedges()
}

/** monta o caminho das cargas para um caso ou combinação */
export function computeLoadPath(
  project: Project,
  results: AnalysisResults,
  sel: LoadPathSelection,
): LoadPath {
  const { model } = results
  const { nodes, members } = model
  const tr = model.loadTransfers
  const pass = results.cases[sel.stiffness]
  const gf = sel.factors.G ?? 0
  const qf = sel.factors.Q ?? 0
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const levelName = (li: number) => levels[li]?.name ?? `Nível ${li}`

  // ------------------------------------------------- esforços combinados
  /** força vertical ↓ que cada extremo de barra exerce sobre o seu nó */
  const downI = new Float64Array(members.length)
  const downJ = new Float64Array(members.length)
  const fzUp = new Map<number, number>()
  const uz = new Float64Array(nodes.length)
  for (const [caseId, factor] of Object.entries(sel.factors) as [CaseId, number][]) {
    const cr = pass[caseId]
    if (!cr || !factor) continue
    members.forEach((m, mi) => {
      const d = cr.memberDiagrams[mi]
      const last = d.x.length - 1
      if (m.ref.kind === 'beam') {
        // Vy(0) = força do nó sobre a barra (↑) ⇒ a barra empurra o nó p/ baixo
        downI[mi] += factor * d.Vy[0]
        downJ[mi] -= factor * d.Vy[last]
      } else {
        // pilar (x local ↑, N de tração +): compressão na base empurra o nó de baixo
        downI[mi] -= factor * d.N[0]
        downJ[mi] += factor * d.N[last]
      }
    })
    for (const r of cr.reactions) fzUp.set(r.nodeId, (fzUp.get(r.nodeId) ?? 0) + factor * r.fz)
    cr.displacements.forEach((u, i) => (uz[i] += factor * u[2]))
  }

  // -------------------------------------------------------------- elementos
  const elements = new Map<string, LoadPathElement>()
  const el = (
    key: string,
    kind: LoadPathKind,
    id: string,
    name: string,
    levelIndex: number,
    pos?: Vec2,
  ): LoadPathElement => {
    let e = elements.get(key)
    if (!e) {
      e = { key, kind, id, name, levelIndex, own: 0, parts: [], received: 0, delivered: 0, pos }
      elements.set(key, e)
    }
    return e
  }
  const addPart = (e: LoadPathElement, label: string, value: number) => {
    if (Math.abs(value) < 1e-9) return
    e.own += value
    const cur = e.parts.find((x) => x.label === label)
    if (cur) cur.value += value
    else e.parts.push({ label, value })
  }

  /** chave do elemento de cada barra */
  const memberKey = members.map((m) =>
    m.ref.kind === 'beam'
      ? beamKey(nodes[m.ni].levelIndex, m.ref.sourceId)
      : columnKey(m.ref.sourceId, m.ref.spanIndex),
  )
  members.forEach((m, mi) => {
    const own = tr.members[mi]
    if (m.ref.kind === 'beam') {
      const e = el(memberKey[mi], 'beam', m.ref.sourceId, m.ref.sourceName, nodes[m.ni].levelIndex)
      addPart(e, 'Peso próprio', gf * own.self)
      addPart(e, 'Paredes', gf * own.wallG + qf * own.wallQ)
    } else {
      const e = el(memberKey[mi], 'column', m.ref.sourceId, m.ref.sourceName, nodes[m.nj].levelIndex, {
        x: nodes[m.ni].x,
        y: nodes[m.ni].y,
      })
      addPart(e, 'Peso próprio', gf * own.self)
      e.nTop = -downJ[mi]
      e.nBase = downI[mi]
    }
  })

  const flows: LoadPathFlow[] = []
  const flowIndex = new Map<string, LoadPathFlow>()
  const addFlow = (from: string, to: string, value: number, levelIndex: number, at: Vec2) => {
    if (value < 1e-9 || from === to) return
    const k = `${from}>${to}>${levelIndex}`
    const cur = flowIndex.get(k)
    if (cur) {
      // mesma dupla em mais de um ponto: soma e leva o ponto p/ a média ponderada
      const t = cur.value + value
      cur.at = { x: (cur.at.x * cur.value + at.x * value) / t, y: (cur.at.y * cur.value + at.y * value) / t }
      cur.value = t
      return
    }
    const f = { from, to, value, levelIndex, at }
    flowIndex.set(k, f)
    flows.push(f)
  }

  // --------------------------------------------------------- lajes → vigas
  const slabEdges: LoadPathSlabEdge[] = []
  /** cargas nodais diretas (laje sobre pilar, consolo): nó → [chave, valor] */
  const direct = new Map<number, { key: string; value: number }[]>()
  const pushDirect = (nodeId: number, key: string, value: number) => {
    if (Math.abs(value) < 1e-9) return
    const list = direct.get(nodeId) ?? []
    list.push({ key, value })
    direct.set(nodeId, list)
  }
  let lost = 0
  for (const st of tr.slabs) {
    const key = slabKey(st.levelIndex, st.slabId)
    const e = el(key, 'slab', st.slabId, st.name, st.levelIndex, polygonCentroid(st.polygon))
    const slabLost = gf * st.lostG + qf * st.lostQ
    addPart(e, 'Carga da laje', gf * st.g + qf * st.q - slabLost)
    if (slabLost > 1e-9) {
      e.lost = slabLost
      lost += slabLost
    }
    const shapes = tributaryPolygons(st)
    const n = st.polygon.length
    for (const ed of st.edges) {
      const a = st.polygon[ed.edgeIndex]
      const b = st.polygon[(ed.edgeIndex + 1) % n]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      let value = 0
      const beamKeys: string[] = []
      for (const mm of ed.members) {
        const v = gf * mm.g + qf * mm.q
        value += v
        const bk = memberKey[mm.memberId]
        if (!beamKeys.includes(bk)) beamKeys.push(bk)
        const m = members[mm.memberId]
        const pm = m.axis
          ? { x: (m.axis.a.x + m.axis.b.x) / 2, y: (m.axis.a.y + m.axis.b.y) / 2 }
          : { x: (nodes[m.ni].x + nodes[m.nj].x) / 2, y: (nodes[m.ni].y + nodes[m.nj].y) / 2 }
        addFlow(key, bk, v, st.levelIndex, pm)
      }
      const len = dist(a, b)
      slabEdges.push({
        slabKey: key,
        slabId: st.slabId,
        levelIndex: st.levelIndex,
        edgeIndex: ed.edgeIndex,
        a,
        b,
        supported: ed.supported,
        polygon: shapes[ed.edgeIndex]?.polygon ?? [a, b, mid],
        exact: shapes[ed.edgeIndex]?.exact ?? false,
        value,
        perMeter: len > 1e-9 ? value / len : 0,
        beamKeys,
      })
    }
    for (const c of st.columns) pushDirect(c.nodeId, key, gf * c.g + qf * c.q)
  }
  for (const nl of tr.nodal) {
    const key = `d|${nl.columnId}|${nl.levelIndex}`
    const e = el(key, 'direct', nl.columnId, nl.name, nl.levelIndex, { x: nodes[nl.nodeId].x, y: nodes[nl.nodeId].y })
    addPart(e, 'Carga do consolo', gf * nl.g + qf * nl.q)
    pushDirect(nl.nodeId, key, gf * nl.g + qf * nl.q)
  }

  // ----------------------------------------------------- equilíbrio nos nós
  const byNode: { key: string; f: number }[][] = nodes.map(() => [])
  const put = (nodeId: number, key: string, f: number) => {
    const list = byNode[nodeId]
    const cur = list.find((x) => x.key === key)
    if (cur) cur.f += f
    else list.push({ key, f })
  }
  members.forEach((m, mi) => {
    put(m.ni, memberKey[mi], downI[mi])
    put(m.nj, memberKey[mi], downJ[mi])
  })
  for (const [nodeId, list] of direct) for (const d of list) put(nodeId, d.key, d.value)
  /** pilar dono de cada nó de apoio */
  const supportColumn = new Map<number, { id: string; name: string }>()
  for (const m of members) {
    if (m.ref.kind !== 'column') continue
    for (const nid of [m.ni, m.nj]) {
      if (nodes[nid].support && !supportColumn.has(nid))
        supportColumn.set(nid, { id: m.ref.sourceId, name: m.ref.sourceName })
    }
  }
  let reactions = 0
  for (const [nodeId, fz] of fzUp) {
    const nd = nodes[nodeId]
    const col = supportColumn.get(nodeId)
    const key = foundationKey(col?.id ?? `n${nodeId}`)
    el(key, 'foundation', col?.id ?? '', col ? `Fundação de ${col.name}` : 'Apoio', nd.levelIndex, {
      x: nd.x,
      y: nd.y,
    })
    put(nodeId, key, -fz)
    reactions += fz
  }
  for (const w of model.winkler ?? []) {
    const nd = nodes[w.nodeId]
    if (nd.support) continue // a mola do apoio já está na reação
    const up = -w.kz * uz[w.nodeId]
    if (Math.abs(up) < 1e-9) continue
    const key = `w|${nd.levelIndex}`
    el(key, 'soil', '', 'Solo sob os baldrames', nd.levelIndex)
    put(w.nodeId, key, -up)
    reactions += up
  }

  let residual = 0
  nodes.forEach((nd, nodeId) => {
    const list = byNode[nodeId]
    if (list.length === 0) return
    let src = 0
    let snk = 0
    for (const x of list) {
      if (x.f > 0) src += x.f
      else snk -= x.f
    }
    residual = Math.max(residual, Math.abs(src - snk))
    if (src < 1e-9 || snk < 1e-9) return
    const at = { x: nd.x, y: nd.y }
    // quem empurra o nó p/ baixo entrega a quem o segura, na proporção de cada um
    for (const s of list) {
      if (s.f <= 0) continue
      for (const t of list) {
        if (t.f >= 0) continue
        addFlow(s.key, t.key, (s.f * -t.f) / snk, nd.levelIndex, at)
      }
    }
  })

  for (const f of flows) {
    const a = elements.get(f.from)
    const b = elements.get(f.to)
    if (a) a.delivered += f.value
    if (b) b.received += f.value
  }

  /** o que o elemento `key` troca com cada vizinho no nó (+ = recebe), kN */
  const sharesAt = (nodeId: number, key: string): { key: string; value: number }[] => {
    const list = byNode[nodeId]
    const me = list.find((x) => x.key === key)
    if (!me || Math.abs(me.f) < 1e-9) return []
    let src = 0
    let snk = 0
    for (const x of list) {
      if (x.f > 0) src += x.f
      else snk -= x.f
    }
    if (src < 1e-9 || snk < 1e-9) return []
    return me.f < 0
      ? list.filter((x) => x.f > 0).map((x) => ({ key: x.key, value: (x.f * -me.f) / snk }))
      : list.filter((x) => x.f < 0).map((x) => ({ key: x.key, value: -(me.f * -x.f) / snk }))
  }

  // ------------------------------------------------ descida nos pilares
  const columns: LoadPathColumn[] = []
  for (const col of project.columns) {
    const own = members
      .map((m, mi) => ({ m, mi }))
      .filter((x) => x.m.ref.kind === 'column' && x.m.ref.sourceId === col.id)
      .sort((a, b) => b.m.ref.spanIndex - a.m.ref.spanIndex)
    if (own.length === 0) continue
    const steps: LoadPathColumnStep[] = own.map(({ m, mi }) => {
      const key = memberKey[mi]
      let fromAbove = 0
      let fromBeams = 0
      let fromSlabs = 0
      // só o que o tramo troca pelo TOPO (a base conversa com o pavimento de baixo)
      for (const sh of sharesAt(m.nj, key)) {
        const other = elements.get(sh.key)?.kind
        if (other === 'column') fromAbove += sh.value
        else if (other === 'beam') fromBeams += sh.value
        else if (other === 'slab' || other === 'direct') fromSlabs += sh.value
      }
      const nBase = downI[mi]
      return {
        key,
        levelIndex: nodes[m.nj].levelIndex,
        levelName: levelName(nodes[m.nj].levelIndex),
        fromAbove,
        fromBeams,
        fromSlabs,
        own: nBase + downJ[mi],
        nBase,
      }
    })
    const support = [...supportColumn].find(([, c]) => c.id === col.id)
    columns.push({
      columnId: col.id,
      name: col.name,
      pos: col.pos,
      steps,
      foundation: support ? (fzUp.get(support[0]) ?? null) : null,
    })
  }
  columns.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

  let applied = 0
  for (const e of elements.values()) applied += e.own

  return {
    label: sel.label,
    factors: sel.factors,
    levels: levels.map((l, i) => ({ levelIndex: i, name: l.name, elevation: l.elevation })),
    elements: [...elements.values()],
    flows,
    slabEdges,
    columns,
    check: { applied, reactions, residual, lost },
  }
}

/**
 * De onde vem a carga de um elemento e para onde ela vai: fecho transitivo dos
 * fluxos a montante (`up`) e a jusante (`down`), sem o próprio elemento.
 */
export function traceLoadPath(lp: Pick<LoadPath, 'flows'>, key: string): { up: string[]; down: string[] } {
  const walk = (dir: 'up' | 'down'): string[] => {
    const seen = new Set<string>([key])
    const queue = [key]
    while (queue.length > 0) {
      const k = queue.pop()!
      for (const f of lp.flows) {
        const next = dir === 'up' ? (f.to === k ? f.from : null) : f.from === k ? f.to : null
        if (next && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    seen.delete(key)
    return [...seen]
  }
  return { up: walk('up'), down: walk('down') }
}
