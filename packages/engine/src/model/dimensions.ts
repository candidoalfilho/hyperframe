import { columnHalfExtents } from './columnSection'
import type {
  DimColumnAnchor,
  DimPoint,
  DimRef,
  DimStyle,
  Dimension,
  ElementRef,
  FloorPlan,
  Project,
  Vec2,
} from './types'

/**
 * Cotas permanentes (issue #10). São anotação: não entram na análise. Cada ponto
 * pode estar preso a um elemento do modelo (`DimRef`) — a posição `p` é
 * recalculada a partir da referência a cada edição (`refreshDimensions`), então
 * a cota acompanha o pilar movido, a seção alterada ou o eixo deslocado.
 */

export const DIM_STYLE_DEFAULT: DimStyle = {
  unit: 'cm',
  decimals: 1,
  textHeight: 0.2,
  terminator: 'tick',
}

export const DIM_ANCHOR_LABEL: Record<DimColumnAnchor, string> = {
  c: 'centro',
  n: 'face superior',
  s: 'face inferior',
  e: 'face direita',
  w: 'face esquerda',
  ne: 'canto superior direito',
  nw: 'canto superior esquerdo',
  se: 'canto inferior direito',
  sw: 'canto inferior esquerdo',
}

/** ordem de preferência ao prender um ponto num pilar: centro, faces, cantos */
const ANCHORS: DimColumnAnchor[] = ['c', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export const dimStyleOf = (project: Pick<Project, 'dimStyle'>): DimStyle => ({
  ...DIM_STYLE_DEFAULT,
  ...(project.dimStyle ?? {}),
})

/** valor em metros → texto na unidade do estilo (vírgula decimal, sem unidade) */
export function formatDim(value: number, style: DimStyle): string {
  const k = style.unit === 'cm' ? 100 : style.unit === 'mm' ? 1000 : 1
  const d = Math.max(0, Math.min(4, Math.round(style.decimals)))
  let t = (Math.abs(value) * k).toFixed(d)
  // cm e mm: "450" em vez de "450,0"; em metros as casas ficam ("4,50")
  if (style.unit !== 'm' && t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '')
  return t.replace('.', ',')
}

function anchorPoint(
  col: Project['columns'][number],
  at: DimColumnAnchor,
): Vec2 {
  const he = columnHalfExtents(col)
  const sx = at.includes('e') ? 1 : at.includes('w') ? -1 : 0
  const sy = at.includes('n') ? 1 : at.includes('s') ? -1 : 0
  return { x: col.pos.x + sx * he.dx, y: col.pos.y + sy * he.dy }
}

/**
 * Posição atual de uma referência; null = a referência não existe mais (pilar
 * ou viga excluídos, vértice removido, eixo apagado). `prev` fornece a
 * coordenada livre de um ponto preso a um único eixo.
 */
export function resolveDimRef(
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'>,
  ref: DimRef,
  prev: Vec2,
): Vec2 | null {
  if (ref.kind === 'column') {
    const col = project.columns.find((c) => c.id === ref.id)
    return col ? anchorPoint(col, ref.at) : null
  }
  if (ref.kind === 'beam') {
    const v = plan.beams.find((b) => b.id === ref.id)?.path[ref.vertex]
    return v ? { x: v.x, y: v.y } : null
  }
  let x = prev.x
  let y = prev.y
  if (ref.x !== undefined) {
    const a = project.grid.xAxes.find((g) => g.id === ref.x)
    if (!a) return null
    x = a.pos
  }
  if (ref.y !== undefined) {
    const a = project.grid.yAxes.find((g) => g.id === ref.y)
    if (!a) return null
    y = a.pos
  }
  return ref.x === undefined && ref.y === undefined ? null : { x, y }
}

/**
 * Referência do modelo que está no ponto `p` (o ponto que o snap devolveu):
 * pilar (centro, face ou canto) > vértice de viga > eixos da grelha. null =
 * nada ali; o ponto fica livre.
 */
export function dimRefAt(
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'> | null,
  p: Vec2,
  tol = 0.01,
): DimRef | null {
  const near = (q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y) <= tol
  for (const at of ANCHORS) {
    for (const col of project.columns) {
      if (near(anchorPoint(col, at))) return { kind: 'column', id: col.id, at }
    }
  }
  for (const b of plan?.beams ?? []) {
    const i = b.path.findIndex(near)
    if (i >= 0) return { kind: 'beam', id: b.id, vertex: i }
  }
  const ax = project.grid.xAxes.find((a) => Math.abs(a.pos - p.x) <= tol)
  const ay = project.grid.yAxes.find((a) => Math.abs(a.pos - p.y) <= tol)
  if (ax || ay) return { kind: 'grid', ...(ax ? { x: ax.id } : {}), ...(ay ? { y: ay.id } : {}) }
  return null
}

/** descrição legível da referência ("P1 — centro", "V3 — vértice 2", "eixo A × 1") */
export function dimRefLabel(
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'>,
  ref: DimRef,
): string {
  if (ref.kind === 'column') {
    const col = project.columns.find((c) => c.id === ref.id)
    return col ? `${col.name} — ${DIM_ANCHOR_LABEL[ref.at]}` : 'pilar excluído'
  }
  if (ref.kind === 'beam') {
    const b = plan.beams.find((x) => x.id === ref.id)
    if (!b) return 'viga excluída'
    const last = b.path.length - 1
    return `${b.name} — ${ref.vertex === 0 ? 'início' : ref.vertex === last ? 'fim' : `vértice ${ref.vertex + 1}`}`
  }
  const ax = ref.x !== undefined ? project.grid.xAxes.find((a) => a.id === ref.x) : undefined
  const ay = ref.y !== undefined ? project.grid.yAxes.find((a) => a.id === ref.y) : undefined
  if ((ref.x !== undefined && !ax) || (ref.y !== undefined && !ay)) return 'eixo excluído'
  return ax && ay ? `eixos ${ax.label} × ${ay.label}` : `eixo ${(ax ?? ay)?.label ?? '?'}`
}

/** índices dos pontos cuja referência deixou de existir */
export function lostDimRefs(
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'>,
  dim: Dimension,
): number[] {
  const out: number[] = []
  dim.points.forEach((pt, i) => {
    if (pt.ref && !resolveDimRef(project, plan, pt.ref, pt.p)) out.push(i)
  })
  return out
}

/**
 * Atualiza a posição dos pontos presos a referências. Devolve o MESMO objeto se
 * nada mudou. Referência perdida: o ponto fica onde estava (e continua marcado
 * como preso, para o caso de o elemento voltar por desfazer).
 */
export function refreshDimensions(project: Project): Project {
  let changed = false
  const plans = project.plans.map((pl) => {
    if (!pl.dimensions || pl.dimensions.length === 0) return pl
    let planChanged = false
    const dimensions = pl.dimensions.map((d) => {
      let dimChanged = false
      const points = d.points.map((pt) => {
        if (!pt.ref) return pt
        const q = resolveDimRef(project, pl, pt.ref, pt.p)
        if (!q || (Math.abs(q.x - pt.p.x) < 1e-9 && Math.abs(q.y - pt.p.y) < 1e-9)) return pt
        dimChanged = true
        return { ...pt, p: q }
      })
      if (!dimChanged) return d
      planChanged = true
      return { ...d, points }
    })
    if (!planChanged) return pl
    changed = true
    return { ...pl, dimensions }
  })
  return changed ? { ...project, plans } : project
}

// ---------------------------------------------------------------------------
// geometria da cota
// ---------------------------------------------------------------------------

export interface DimLayout {
  /** direção medida e normal (unitárias); a linha de cota fica em p0 + n·offset */
  u: Vec2
  n: Vec2
  /** altura de texto usada no traçado, m */
  height: number
  /** linha de cota principal — alvo de seleção e de arrasto */
  main: { a: Vec2; b: Vec2 }
  lines: { a: Vec2; b: Vec2; role: 'dim' | 'ext' }[]
  /**
   * extremidades: `dirs` = sentidos (ao longo de u) dos trechos que chegam ali —
   * as setas apontam para a marca vindas de cada trecho
   */
  marks: { at: Vec2; dirs: (1 | -1)[]; origin?: boolean }[]
  /** textos: ponto de inserção na linha de base, rotação e alinhamento */
  labels: {
    x: number
    y: number
    angleDeg: number
    align: 'left' | 'center' | 'right'
    text: string
    /** valor medido, m */
    value: number
  }[]
}

/** direção medida (unitária) */
export function dimDirection(dim: Pick<Dimension, 'dir' | 'points'>): Vec2 {
  if (dim.dir === 'h') return { x: 1, y: 0 }
  if (dim.dir === 'v') return { x: 0, y: 1 }
  const a = dim.points[0].p
  const b = dim.points[dim.points.length - 1].p
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  return l < 1e-9 ? { x: 1, y: 0 } : { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

/** ângulo de leitura (−90° < a ≤ 90°) e o "para cima" do texto nessa direção */
function upright(dx: number, dy: number): { deg: number; r: Vec2; up: Vec2 } {
  let a = Math.atan2(dy, dx)
  if (a > Math.PI / 2 + 1e-9 || a <= -Math.PI / 2 + 1e-9) a += Math.PI
  if (a > Math.PI) a -= 2 * Math.PI
  return { deg: (a * 180) / Math.PI, r: { x: Math.cos(a), y: Math.sin(a) }, up: { x: -Math.sin(a), y: Math.cos(a) } }
}

/**
 * Geometria completa da cota em coordenadas do modelo. `textHeight` permite ao
 * editor desenhar com texto de tamanho fixo na tela (px/escala); nas pranchas
 * vale a altura do estilo.
 */
export function dimensionLayout(
  dim: Dimension,
  style: DimStyle,
  textHeight: number = style.textHeight,
): DimLayout {
  const h = Math.max(textHeight, 1e-6)
  const u = dimDirection(dim)
  const n = { x: -u.y, y: u.x }
  const p0 = dim.points[0].p
  const proj = (q: Vec2) => (q.x - p0.x) * u.x + (q.y - p0.y) * u.y
  const onLine = (s: number, off: number): Vec2 => ({
    x: p0.x + u.x * s + n.x * off,
    y: p0.y + u.y * s + n.y * off,
  })
  const side = dim.offset < 0 ? -1 : 1
  // abscissas distintas ao longo da direção medida
  const all = dim.points.map((pt) => proj(pt.p))
  const S = [...all].sort((a, b) => a - b).filter((s, i, arr) => i === 0 || s - arr[i - 1] > 1e-4)
  const sMin = S[0]
  const sMax = S[S.length - 1]
  const hasTotal = dim.form === 'chain' && !!dim.total && S.length > 2
  const totalOff = dim.offset + side * 2.4 * h
  const outer = hasTotal ? totalOff : dim.offset

  const lines: DimLayout['lines'] = []
  const marks: DimLayout['marks'] = []
  const labels: DimLayout['labels'] = []
  const main = { a: onLine(sMin, dim.offset), b: onLine(sMax, dim.offset) }
  lines.push({ ...main, role: 'dim' })

  // chamadas: do ponto (com uma folga) até um pouco além da linha de cota
  const gap = 0.35 * h
  const over = 0.5 * h
  dim.points.forEach((pt, i) => {
    const s = all[i]
    const isEnd = Math.abs(s - sMin) < 1e-4 || Math.abs(s - sMax) < 1e-4
    const target = hasTotal && isEnd ? outer : dim.offset
    // distância com sinal do ponto até a linha, na normal
    const d = (p0.x - pt.p.x) * n.x + (p0.y - pt.p.y) * n.y + target
    if (Math.abs(d) < gap + 1e-6) return
    const sg = d < 0 ? -1 : 1
    lines.push({
      a: { x: pt.p.x + n.x * sg * gap, y: pt.p.y + n.y * sg * gap },
      b: { x: pt.p.x + n.x * (d + sg * over), y: pt.p.y + n.y * (d + sg * over) },
      role: 'ext',
    })
  })

  const along = upright(u.x, u.y)
  /** texto centrado sobre a linha de cota (acima, no sentido de leitura) */
  const midLabel = (s0: number, s1: number, off: number, value: number) => {
    const m = onLine((s0 + s1) / 2, off)
    labels.push({
      x: m.x + along.up.x * 0.3 * h,
      y: m.y + along.up.y * 0.3 * h,
      angleDeg: along.deg,
      align: 'center',
      text: formatDim(value, style),
      value,
    })
  }

  if (dim.form === 'baseline' && S.length >= 2) {
    // acumulada: um valor por ponto, medido desde o 1º ponto, escrito ao lado da chamada
    const across = upright(n.x * side, n.y * side)
    const sameWay = across.r.x * n.x * side + across.r.y * n.y * side > 0
    for (const s of S) {
      const origin = Math.abs(s) < 1e-4
      const at = onLine(s, dim.offset)
      marks.push({ at, dirs: s > sMin + 1e-4 && s < sMax - 1e-4 ? [1, -1] : s <= sMin + 1e-4 ? [1] : [-1], origin })
      const start = { x: at.x + n.x * side * 0.9 * h, y: at.y + n.y * side * 0.9 * h }
      labels.push({
        x: start.x + across.up.x * 0.25 * h,
        y: start.y + across.up.y * 0.25 * h,
        angleDeg: across.deg,
        align: sameWay ? 'left' : 'right',
        text: formatDim(Math.abs(s), style),
        value: Math.abs(s),
      })
    }
  } else {
    S.forEach((s, i) => {
      const dirs: (1 | -1)[] = []
      if (i + 1 < S.length) dirs.push(1)
      if (i > 0) dirs.push(-1)
      marks.push({ at: onLine(s, dim.offset), dirs })
      if (i + 1 < S.length) midLabel(s, S[i + 1], dim.offset, S[i + 1] - s)
    })
    if (hasTotal) {
      lines.push({ a: onLine(sMin, totalOff), b: onLine(sMax, totalOff), role: 'dim' })
      marks.push({ at: onLine(sMin, totalOff), dirs: [1] })
      marks.push({ at: onLine(sMax, totalOff), dirs: [-1] })
      midLabel(sMin, sMax, totalOff, sMax - sMin)
    }
  }
  return { u, n, height: h, main, lines, marks, labels }
}

/** valores medidos, na ordem em que aparecem (cadeia: trechos; acumulada: desde a origem) */
export function dimensionValues(dim: Dimension, style: DimStyle = DIM_STYLE_DEFAULT): number[] {
  return dimensionLayout(dim, style).labels.map((l) => l.value)
}

// ---------------------------------------------------------------------------
// cotagem automática
// ---------------------------------------------------------------------------

export interface AutoDimOptions {
  /** direção das cotas: 'h' mede em X (linha horizontal), 'v' mede em Y */
  dir: 'h' | 'v'
  /** entre eixos (centros de pilar, eixos de viga) ou entre faces dos pilares */
  mode: 'axes' | 'faces'
  /** de que lado dos elementos a linha fica: 'min' = abaixo/à esquerda */
  side: 'min' | 'max'
  /** linha extra com a dimensão total */
  total: boolean
  /** distância da linha de cota ao contorno dos elementos, m */
  gap?: number
}

/**
 * Cota em cadeia gerada a partir de uma seleção de pilares e vigas: um ponto por
 * alinhamento distinto (alinhamentos repetidos não geram cota duplicada), todos
 * presos ao modelo. null = menos de dois alinhamentos na direção pedida.
 */
export function autoDimension(
  project: Pick<Project, 'columns' | 'grid'>,
  plan: Pick<FloorPlan, 'beams'>,
  refs: ElementRef[],
  opts: AutoDimOptions,
): Omit<Dimension, 'id' | 'name'> | null {
  const horizontal = opts.dir === 'h'
  const c = (q: Vec2) => (horizontal ? q.x : q.y) // coordenada medida
  const o = (q: Vec2) => (horizontal ? q.y : q.x) // a outra
  const cand: DimPoint[] = []
  let lo = Infinity
  let hi = -Infinity
  const grow = (v: number) => {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  for (const r of refs) {
    if (r.kind === 'column') {
      const col = project.columns.find((x) => x.id === r.id)
      if (!col) continue
      const he = columnHalfExtents(col)
      grow(o(col.pos) - (horizontal ? he.dy : he.dx))
      grow(o(col.pos) + (horizontal ? he.dy : he.dx))
      const ats: DimColumnAnchor[] =
        opts.mode === 'axes' ? ['c'] : horizontal ? ['w', 'e'] : ['s', 'n']
      for (const at of ats) cand.push({ p: anchorPoint(col, at), ref: { kind: 'column', id: col.id, at } })
    } else if (r.kind === 'beam') {
      const b = plan.beams.find((x) => x.id === r.id)
      if (!b) continue
      b.path.forEach((v, i) => {
        grow(o(v) - b.section.bw / 2)
        grow(o(v) + b.section.bw / 2)
        // o vértice sobre um pilar selecionado fica por conta do pilar
        cand.push({ p: { x: v.x, y: v.y }, ref: { kind: 'beam', id: b.id, vertex: i } })
      })
    }
  }
  if (cand.length < 2) return null
  // um ponto por alinhamento (5 mm): fica o mais próximo do lado da linha de cota;
  // empate → pilar tem preferência sobre viga
  const sideSign = opts.side === 'min' ? 1 : -1
  cand.sort(
    (a, b) =>
      c(a.p) - c(b.p) ||
      sideSign * (o(a.p) - o(b.p)) ||
      Number(a.ref?.kind !== 'column') - Number(b.ref?.kind !== 'column'),
  )
  const points: DimPoint[] = []
  for (const pt of cand) {
    const last = points[points.length - 1]
    if (last && Math.abs(c(pt.p) - c(last.p)) < 0.005) {
      const better =
        sideSign * (o(pt.p) - o(last.p)) < -1e-6 ||
        (Math.abs(o(pt.p) - o(last.p)) < 1e-6 && pt.ref?.kind === 'column' && last.ref?.kind !== 'column')
      if (better) points[points.length - 1] = pt
      continue
    }
    points.push(pt)
  }
  if (points.length < 2) return null
  const gap = opts.gap ?? 0.8
  const linePos = opts.side === 'min' ? lo - gap : hi + gap
  // h: linha em y = p0.y + offset · v: linha em x = p0.x − offset
  const offset = horizontal ? linePos - points[0].p.y : points[0].p.x - linePos
  return {
    dir: opts.dir,
    form: 'chain',
    points,
    offset: Math.round(offset * 1e6) / 1e6,
    ...(opts.total && points.length > 2 ? { total: true } : {}),
    category: opts.mode === 'axes' ? 'locacao' : 'dimensao',
  }
}
