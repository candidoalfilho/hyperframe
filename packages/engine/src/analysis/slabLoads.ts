import type { FloorPlan, Slab, SlabLoad, Vec2 } from '../model/types'
import { dist, pointInPolygon, projectOnSegment } from '../geometry/geometry'
import { wallLoadFromCalc } from '../model/wallLoad'
import { buildGridMesh, solveGridCases, type GridPointLoad } from './grid'

/**
 * Cargas concentradas e lineares sobre lajes (issue #8).
 *
 * Caminho de carga: as cargas são discretizadas em forças pontuais e
 * resolvidas na analogia de grelha da própria laje (bordas com viga = apoio
 * vertical, rotação livre). As reações nos nós de borda descem para as vigas
 * NA POSIÇÃO em que ocorrem — uma parede perto de uma viga carrega essa viga,
 * não as quatro por igual. Lajes unidirecionais (nervuradas em uma direção e
 * treliçadas) repartem cada força entre os dois apoios da vigota pela regra
 * da alavanca.
 *
 * Verificação da laje: a mesma grelha compara o caso "uniforme" com o caso
 * "uniforme + concentradas" e devolve os fatores de amplificação dos momentos
 * de vão e da flecha, usados pelo dimensionamento (carga uniforme equivalente).
 */

/** área carregada padrão de uma carga pontual, m */
export const SLAB_LOAD_SIZE_DEFAULT = { bx: 0.2, by: 0.2 }
/** passo de discretização das cargas lineares, m */
const LINE_STEP = 0.1
/** malha da grelha usada com cargas concentradas, m */
export const SLAB_LOAD_MESH = 0.25

/** comprimento da carga linear (0 p/ pontual), m */
export function slabLoadLength(load: SlabLoad): number {
  return load.kind === 'line' && load.b ? dist(load.a, load.b) : 0
}

/** permanente efetiva: da composição da parede (linear com `calc`) ou o valor informado */
export function slabLoadG(load: SlabLoad): number {
  if (load.kind === 'line' && load.calc) return wallLoadFromCalc(load.calc, slabLoadLength(load)).w
  return load.g
}

/** resultante característica da carga, kN */
export function slabLoadTotal(load: SlabLoad): { g: number; q: number } {
  const f = load.kind === 'line' ? slabLoadLength(load) : 1
  return { g: slabLoadG(load) * f, q: load.q * f }
}

/** força pontual característica resultante da discretização, kN */
export interface SlabLoadSample {
  loadId: string
  pos: Vec2
  g: number
  q: number
}

/** pontual → 1 amostra; linear → amostras no meio de trechos ≤ 10 cm */
export function sampleSlabLoad(load: SlabLoad): SlabLoadSample[] {
  const g = slabLoadG(load)
  if (load.kind === 'point' || !load.b) {
    return [{ loadId: load.id, pos: { ...load.a }, g, q: load.q }]
  }
  const L = slabLoadLength(load)
  if (L < 1e-6) return []
  const n = Math.max(1, Math.ceil(L / LINE_STEP))
  const dl = L / n
  const out: SlabLoadSample[] = []
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    out.push({
      loadId: load.id,
      pos: { x: load.a.x + (load.b.x - load.a.x) * t, y: load.a.y + (load.b.y - load.a.y) * t },
      g: g * dl,
      q: load.q * dl,
    })
  }
  return out
}

const distToPolygon = (p: Vec2, poly: Vec2[]): number => {
  let d = Infinity
  for (let e = 0; e < poly.length; e++) {
    d = Math.min(d, projectOnSegment(p, poly[e], poly[(e + 1) % poly.length]).d)
  }
  return d
}

export interface SlabLoadAssignment {
  /** amostras por laje (id) */
  bySlab: Map<string, SlabLoadSample[]>
  /** parcela de cada carga que caiu fora de qualquer laje ou sobre abertura, kN */
  outside: Map<string, { g: number; q: number }>
}

/**
 * Atribui cada amostra à laje que a contém. Ponto sobre a borda (em cima de
 * uma viga) vai para a laje mais próxima a até 5 cm. `holesOf` devolve as
 * aberturas da laje — carga sobre abertura não tem laje que a receba.
 */
export function assignSlabLoads(
  plan: FloorPlan,
  holesOf: (slab: Slab) => Vec2[][] = () => [],
): SlabLoadAssignment {
  const bySlab = new Map<string, SlabLoadSample[]>()
  const outside = new Map<string, { g: number; q: number }>()
  const holes = new Map<string, Vec2[][]>()
  const holesFor = (s: Slab) => {
    let h = holes.get(s.id)
    if (!h) {
      h = holesOf(s)
      holes.set(s.id, h)
    }
    return h
  }
  for (const load of plan.slabLoads ?? []) {
    for (const smp of sampleSlabLoad(load)) {
      let target: Slab | null = plan.slabs.find((s) => pointInPolygon(smp.pos, s.polygon)) ?? null
      if (!target) {
        let best = 0.05
        for (const s of plan.slabs) {
          const d = distToPolygon(smp.pos, s.polygon)
          if (d < best) {
            best = d
            target = s
          }
        }
      }
      if (target && holesFor(target).some((h) => pointInPolygon(smp.pos, h))) target = null
      if (!target) {
        const o = outside.get(load.id) ?? { g: 0, q: 0 }
        o.g += smp.g
        o.q += smp.q
        outside.set(load.id, o)
        continue
      }
      const list = bySlab.get(target.id) ?? []
      list.push(smp)
      bySlab.set(target.id, list)
    }
  }
  return { bySlab, outside }
}

/** reação característica em um ponto de apoio da laje */
export interface SlabSupportReaction {
  pos: Vec2
  /** índice da borda do polígono (null = pilar interno) */
  edgeIndex: number | null
  columnId?: string
  g: number
  q: number
}

export interface SlabLoadDistribution {
  reactions: SlabSupportReaction[]
  /** parcela que não encontrou apoio, kN */
  lostG: number
  lostQ: number
  method: 'grelha' | 'unidirecional'
}

export interface SlabLoadDistributionInput {
  polygon: Vec2[]
  holes?: Vec2[][]
  /** bordas com viga (índices do polígono) */
  supportedEdges: number[]
  interiorColumns?: { id: string; pos: Vec2 }[]
  thickness: number
  samples: SlabLoadSample[]
  /** direção das nervuras/vigotas em laje unidirecional (null = bidirecional) */
  oneWayAxis?: 'x' | 'y' | null
}

/** corda da vigota que passa por `p` na direção `axis`: apoios inicial e final */
function joistChord(
  polygon: Vec2[],
  p: Vec2,
  axis: 'x' | 'y',
): { start: { t: number; edge: number }; end: { t: number; edge: number } } | null {
  const u = (q: Vec2) => (axis === 'x' ? q.x : q.y)
  const v = (q: Vec2) => (axis === 'x' ? q.y : q.x)
  const n = polygon.length
  let start: { t: number; edge: number } | null = null
  let end: { t: number; edge: number } | null = null
  for (let e = 0; e < n; e++) {
    const a = polygon[e]
    const b = polygon[(e + 1) % n]
    const va = v(a) - v(p)
    const vb = v(b) - v(p)
    if (va * vb > 0 || Math.abs(va - vb) < 1e-12) continue // não cruza (ou borda paralela)
    const k = va / (va - vb)
    const t = u(a) + k * (u(b) - u(a)) - u(p)
    if (t <= 0 && (!start || t > start.t)) start = { t, edge: e }
    if (t >= 0 && (!end || t < end.t)) end = { t, edge: e }
  }
  return start && end && end.t - start.t > 1e-6 ? { start, end } : null
}

/**
 * Reações das cargas concentradas nos apoios da laje.
 * Bidirecional: analogia de grelha (malha de 25 cm). Unidirecional: alavanca.
 */
export function distributeSlabLoads(inp: SlabLoadDistributionInput): SlabLoadDistribution {
  const totalG = inp.samples.reduce((s, x) => s + x.g, 0)
  const totalQ = inp.samples.reduce((s, x) => s + x.q, 0)
  const supported = new Set(inp.supportedEdges)
  const reactions: SlabSupportReaction[] = []

  if (inp.oneWayAxis) {
    const axis = inp.oneWayAxis
    const at = (p: Vec2, t: number): Vec2 =>
      axis === 'x' ? { x: p.x + t, y: p.y } : { x: p.x, y: p.y + t }
    for (const smp of inp.samples) {
      const chord = joistChord(inp.polygon, smp.pos, axis)
      if (!chord) continue
      const L = chord.end.t - chord.start.t
      const okS = supported.has(chord.start.edge)
      const okE = supported.has(chord.end.edge)
      if (!okS && !okE) continue
      // alavanca; vigota com um só apoio com viga descarrega tudo nele
      const fS = okS && okE ? chord.end.t / L : okS ? 1 : 0
      for (const [f, c] of [
        [fS, chord.start],
        [1 - fS, chord.end],
      ] as const) {
        if (f < 1e-12) continue
        reactions.push({ pos: at(smp.pos, c.t), edgeIndex: c.edge, g: smp.g * f, q: smp.q * f })
      }
    }
  } else if (inp.supportedEdges.length + (inp.interiorColumns?.length ?? 0) > 0) {
    const model = buildGridMesh({
      polygon: inp.polygon,
      holes: inp.holes,
      supportedEdges: inp.supportedEdges,
      interiorColumns: inp.interiorColumns,
      targetSpacing: SLAB_LOAD_MESH,
    })
    const pts = (k: 'g' | 'q'): GridPointLoad[] =>
      inp.samples.filter((s) => s[k] !== 0).map((s) => ({ x: s.pos.x, y: s.pos.y, p: s[k] }))
    // E não altera as reações (espessura uniforme); G e Q em uma fatoração
    const [rg, rq] = solveGridCases(model, inp.thickness, 25e6, [
      { q: 0, points: pts('g') },
      { q: 0, points: pts('q') },
    ])
    for (const nd of model.nodes) {
      if (!nd.support) continue
      const g = rg.reactions.get(nd.id) ?? 0
      const q = rq.reactions.get(nd.id) ?? 0
      if (Math.abs(g) < 1e-12 && Math.abs(q) < 1e-12) continue
      const pos = { x: nd.x, y: nd.y }
      if (nd.columnId) {
        reactions.push({ pos, edgeIndex: null, columnId: nd.columnId, g, q })
      } else {
        // canto: metade para cada borda
        const k = Math.max(nd.edgeIndices.length, 1)
        for (const e of nd.edgeIndices) reactions.push({ pos, edgeIndex: e, g: g / k, q: q / k })
      }
    }
  }
  const sumG = reactions.reduce((s, r) => s + r.g, 0)
  const sumQ = reactions.reduce((s, r) => s + r.q, 0)
  return {
    reactions,
    lostG: totalG - sumG,
    lostQ: totalQ - sumQ,
    method: inp.oneWayAxis ? 'unidirecional' : 'grelha',
  }
}

export interface SlabConcentratedEffects {
  /** amplificação dos momentos nas direções X e Y globais e da flecha (≥ 1) */
  kx: number
  ky: number
  kw: number
  /** momentos de vão característicos, kN·m/m: só uniforme → com as concentradas */
  mxUniform: number
  mxCombined: number
  myUniform: number
  myCombined: number
  /** resultante das concentradas nesta laje, kN */
  totalG: number
  totalQ: number
}

/**
 * Efeito das cargas concentradas no dimensionamento de laje BIDIRECIONAL: razão
 * entre os momentos máximos (e a flecha quase-permanente) da grelha com e sem
 * as concentradas. As bordas são apoios simples nos dois casos, então a razão
 * é consistente; o pico sob a carga é a média numa faixa de 25 cm.
 */
export function slabConcentratedEffects(inp: {
  polygon: Vec2[]
  holes?: Vec2[][]
  supportedEdges: number[]
  interiorColumns?: { id: string; pos: Vec2 }[]
  thickness: number
  /** pressões características uniformes, kN/m² */
  g: number
  q: number
  psi2: number
  samples: SlabLoadSample[]
}): SlabConcentratedEffects | null {
  if (inp.samples.length === 0) return null
  if (inp.supportedEdges.length + (inp.interiorColumns?.length ?? 0) === 0) return null
  const model = buildGridMesh({
    polygon: inp.polygon,
    holes: inp.holes,
    supportedEdges: inp.supportedEdges,
    interiorColumns: inp.interiorColumns,
    targetSpacing: SLAB_LOAD_MESH,
  })
  const all: GridPointLoad[] = inp.samples.map((s) => ({ x: s.pos.x, y: s.pos.y, p: s.g + s.q }))
  const qp: GridPointLoad[] = inp.samples.map((s) => ({
    x: s.pos.x,
    y: s.pos.y,
    p: s.g + inp.psi2 * s.q,
  }))
  const pAll = inp.g + inp.q
  const pQp = inp.g + inp.psi2 * inp.q
  const [u, c, uq, cq] = solveGridCases(model, inp.thickness, 25e6, [
    { q: pAll },
    { q: pAll, points: all },
    { q: pQp },
    { q: pQp, points: qp },
  ])
  const ratio = (a: number, b: number) => (b > 1e-9 ? Math.max(a / b, 1) : 1)
  // vão e apoio (pilar interno) amplificam pelo pior dos dois
  const kx = Math.max(ratio(c.mxSpanMax, u.mxSpanMax), ratio(c.mxSupportMax, u.mxSupportMax))
  const ky = Math.max(ratio(c.mySpanMax, u.mySpanMax), ratio(c.mySupportMax, u.mySupportMax))
  return {
    kx,
    ky,
    kw: ratio(cq.wMax, uq.wMax),
    mxUniform: u.mxSpanMax,
    mxCombined: c.mxSpanMax,
    myUniform: u.mySpanMax,
    myCombined: c.mySpanMax,
    totalG: inp.samples.reduce((s, x) => s + x.g, 0),
    totalQ: inp.samples.reduce((s, x) => s + x.q, 0),
  }
}

/**
 * Laje UNIDIRECIONAL (vigotas ∥ `axis`): esforços característicos adicionais
 * na vigota mais solicitada, supondo que toda carga dentro de uma faixa de um
 * intereixo desce pela vigota sob ela (biapoiada no vão da corda).
 */
export interface JoistExtraEffects {
  /** momento e cortante adicionais na vigota crítica, kN·m e kN (G+Q) */
  m: number
  v: number
  /** parcela quase-permanente do momento (G + ψ2·Q), kN·m */
  mQp: number
  /** posição transversal da vigota crítica e vão da sua corda, m */
  at: number
  span: number
  /**
   * a carga se espalha por toda a largura do painel (linha ⟂ às vigotas):
   * todas as vigotas recebem — amplifica o dimensionamento do painel inteiro
   */
  spread: boolean
}

export function joistExtraEffects(inp: {
  polygon: Vec2[]
  axis: 'x' | 'y'
  /** intereixo das vigotas, m */
  spacing: number
  psi2: number
  samples: SlabLoadSample[]
}): JoistExtraEffects | null {
  if (inp.samples.length === 0 || !(inp.spacing > 0)) return null
  const v = (q: Vec2) => (inp.axis === 'x' ? q.y : q.x)
  const u = (q: Vec2) => (inp.axis === 'x' ? q.x : q.y)
  let vMin = Infinity
  let vMax = -Infinity
  for (const p of inp.polygon) {
    vMin = Math.min(vMin, v(p))
    vMax = Math.max(vMax, v(p))
  }
  // A posição real das vigotas não é conhecida: testa a malha de vigotas
  // alinhada com o eixo de cada carga (pior caso — a carga cai sobre uma
  // vigota). Cada força é repartida entre as duas vigotas vizinhas (alavanca),
  // o que dá w × intereixo por vigota numa parede perpendicular a elas.
  const centroids = new Map<string, { sum: number; n: number }>()
  let sMin = Infinity
  let sMax = -Infinity
  for (const smp of inp.samples) {
    const c = centroids.get(smp.loadId) ?? { sum: 0, n: 0 }
    c.sum += v(smp.pos)
    c.n++
    centroids.set(smp.loadId, c)
    sMin = Math.min(sMin, v(smp.pos))
    sMax = Math.max(sMax, v(smp.pos))
  }
  let best: JoistExtraEffects | null = null
  for (const c of centroids.values()) {
    const origin = c.sum / c.n
    const joists = new Map<number, { smp: SlabLoadSample; f: number }[]>()
    for (const smp of inp.samples) {
      const r = (v(smp.pos) - origin) / inp.spacing
      const j0 = Math.floor(r + 1e-9)
      const f1 = Math.min(Math.max(r - j0, 0), 1)
      for (const [j, f] of [
        [j0, 1 - f1],
        [j0 + 1, f1],
      ] as const) {
        if (f < 1e-9) continue
        const list = joists.get(j) ?? []
        list.push({ smp, f })
        joists.set(j, list)
      }
    }
    for (const [j, list] of joists) {
      const at = origin + j * inp.spacing
      if (at < vMin - 1e-6 || at > vMax + 1e-6) continue
      // viga biapoiada no vão da corda desta vigota, forças nas suas abscissas
      const ref = inp.axis === 'x' ? { x: u(list[0].smp.pos), y: at } : { x: at, y: u(list[0].smp.pos) }
      const chord = joistChord(inp.polygon, ref, inp.axis) ?? joistChord(inp.polygon, list[0].smp.pos, inp.axis)
      if (!chord) continue
      const u0 = u(ref) + chord.start.t
      const L = chord.end.t - chord.start.t
      const loads = list
        .map(({ smp, f }) => ({
          a: Math.min(Math.max(u(smp.pos) - u0, 0), L),
          p: (smp.g + smp.q) * f,
          pQp: (smp.g + inp.psi2 * smp.q) * f,
        }))
        .sort((p, q) => p.a - q.a)
      const rA = loads.reduce((acc, l) => acc + (l.p * (L - l.a)) / L, 0)
      const rB = loads.reduce((acc, l) => acc + (l.p * l.a) / L, 0)
      const rAqp = loads.reduce((acc, l) => acc + (l.pQp * (L - l.a)) / L, 0)
      // momento máximo ocorre sob uma das forças
      let m = 0
      let mQp = 0
      for (const here of loads) {
        let mm = rA * here.a
        let mq = rAqp * here.a
        for (const l of loads) {
          if (l.a < here.a) {
            mm -= l.p * (here.a - l.a)
            mq -= l.pQp * (here.a - l.a)
          }
        }
        if (mm > m) m = mm
        if (mq > mQp) mQp = mq
      }
      if (!best || m > best.m) best = { m, v: Math.max(rA, rB), mQp, at, span: L, spread: false }
    }
  }
  // cargas que atravessam ≥ 80% da largura do painel solicitam todas as vigotas
  if (best) best.spread = sMax - sMin >= 0.8 * (vMax - vMin)
  return best
}
