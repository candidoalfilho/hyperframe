/**
 * Armaduras em 3D (issue #25): o eixo de cada barra do detalhamento, em
 * coordenadas do projeto (x, y em planta; z = cota), para a vista 3D.
 *
 * A fonte é o detalhamento (`results.detailing`) — as mesmas quantidades,
 * bitolas, comprimentos e passos das pranchas e do quadro de ferros. A posição
 * das barras ao longo do vão segue a regra da elevação da viga
 * (`drawing/beamDetail.ts`): positivo centrado no vão, negativo cavalgando o
 * apoio (ou entrando no vão, no apoio de extremidade), estribos trecho a trecho.
 *
 * É uma representação para CONFERÊNCIA VISUAL. Simplificações: as barras são
 * distribuídas na largura em camadas (§18.3.2.2), as pontas são limitadas ao
 * comprimento da viga (o gancho fica no cobrimento do extremo) e os traspasses
 * dos pilares ficam coincidentes com a barra do tramo seguinte.
 */

import type { AnalysisResults, BeamDetailSpan } from '../analysis/types'
import { columnSectionInfo, columnWorldDirs, insetRectilinear } from '../model/columnSection'
import type { Project, Vec2 } from '../model/types'
import { coverFor } from '../nbr/nbr6118/materials'
import { NEG_EDGE_EMBED, columnStirrupOffsets } from './detailing'
import { barLayers } from './rebarCheck'

export type RebarCategory = 'viga-positiva' | 'viga-negativa' | 'viga-estribo' | 'pilar-barra' | 'pilar-estribo'

/** categorias na ordem da legenda */
export const REBAR_CATEGORIES: { id: RebarCategory; label: string; group: 'Vigas' | 'Pilares' }[] = [
  { id: 'viga-positiva', label: 'Positivas (fundo)', group: 'Vigas' },
  { id: 'viga-negativa', label: 'Negativas (topo)', group: 'Vigas' },
  { id: 'viga-estribo', label: 'Estribos', group: 'Vigas' },
  { id: 'pilar-barra', label: 'Longitudinais', group: 'Pilares' },
  { id: 'pilar-estribo', label: 'Estribos', group: 'Pilares' },
]

/** barras iguais de um elemento (uma posição do quadro de ferros, num pavimento) */
export interface RebarGroup3D {
  id: string
  category: RebarCategory
  elementKind: 'beam' | 'column'
  elementId: string
  elementName: string
  /**
   * índice em `project.levels`: o pavimento da viga; no pilar, o nível da BASE
   * do tramo (`levelTop` = o do topo)
   */
  levelIndex: number
  levelTop?: number
  /** vão da viga ou tramo do pilar (0 = primeiro) */
  spanIndex: number
  /** N da posição no quadro de ferros do elemento */
  pos?: number
  /** bitola, m */
  phi: number
  /** barras (ou estribos) deste grupo neste pavimento */
  n: number
  /** comprimento de corte de cada barra, m */
  unitLength: number
  /** o que é, ex.: "negativa — apoio esquerdo" */
  label: string
  /** eixo de cada barra: [x0, y0, z0, x1, y1, z1, …], m */
  paths: number[][]
}

// ---------------------------------------------------------------------------
// geometria ao longo da viga
// ---------------------------------------------------------------------------

interface PathGeom {
  pts: Vec2[]
  /** estação acumulada de cada vértice */
  st: number[]
  total: number
}

function pathGeom(path: Vec2[]): PathGeom {
  const pts: Vec2[] = []
  const st: number[] = []
  let total = 0
  for (const p of path) {
    const last = pts[pts.length - 1]
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y)
      if (d < 1e-9) continue
      total += d
    }
    pts.push(p)
    st.push(total)
  }
  return { pts, st, total }
}

/** estação do ponto do eixo mais próximo de `p` */
function stationOf(g: PathGeom, p: Vec2): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i + 1 < g.pts.length; i++) {
    const a = g.pts[i]
    const b = g.pts[i + 1]
    const L = g.st[i + 1] - g.st[i]
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)))
    const d = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t))
    if (d < bestD) {
      bestD = d
      best = g.st[i] + t * L
    }
  }
  return best
}

/** trecho do eixo que contém a estação (o último, se passar do fim) */
function segAt(g: PathGeom, s: number): number {
  for (let i = 0; i + 2 < g.pts.length; i++) if (s < g.st[i + 1]) return i
  return Math.max(0, g.pts.length - 2)
}

/** ponto e tangente unitária na estação `s` */
function frameAt(g: PathGeom, s: number): { x: number; y: number; tx: number; ty: number } {
  const i = segAt(g, s)
  const a = g.pts[i]
  const b = g.pts[i + 1]
  const L = g.st[i + 1] - g.st[i]
  const tx = (b.x - a.x) / L
  const ty = (b.y - a.y) / L
  const d = s - g.st[i]
  return { x: a.x + tx * d, y: a.y + ty * d, tx, ty }
}

/**
 * Eixo de uma barra entre as estações `a` e `b`, deslocado `off` para a
 * esquerda do sentido da viga, na cota `z`. Acompanha os vértices da viga
 * (vigas curvas são polilinhas).
 */
function runPoints(g: PathGeom, a: number, b: number, off: number, z: number): number[] {
  const out: number[] = []
  const push = (s: number) => {
    const f = frameAt(g, s)
    out.push(f.x - f.ty * off, f.y + f.tx * off, z)
  }
  push(a)
  for (let i = 1; i + 1 < g.pts.length; i++) if (g.st[i] > a + 1e-6 && g.st[i] < b - 1e-6) push(g.st[i])
  push(b)
  return out
}

/** posições laterais (da esquerda para a direita) e a camada de cada barra */
function barSlots(n: number, phi: number, bw: number, cover: number, phiT: number): { off: number; layer: number }[] {
  const { perLayer } = barLayers(n, phi, bw, cover, phiT)
  const half = Math.max(bw / 2 - cover - phiT - phi / 2, 0)
  const out: { off: number; layer: number }[] = []
  let left = n
  for (let k = 0; left > 0; k++) {
    const nk = Math.min(perLayer, left)
    for (let i = 0; i < nk; i++) out.push({ off: nk === 1 ? 0 : -half + (2 * half * i) / (nk - 1), layer: k })
    left -= nk
  }
  return out
}

/** vãos de cada viga ao longo do eixo: estação de início e fim, pelo modelo de análise */
function beamSpanStations(project: Project, results: AnalysisResults): Map<string, Map<number, [number, number]>> {
  const geoms = new Map<string, PathGeom>()
  for (const pl of project.plans) for (const b of pl.beams) geoms.set(b.id, pathGeom(b.path))
  const { model } = results
  const firstLevel = new Map<string, number>()
  const out = new Map<string, Map<number, [number, number]>>()
  for (const m of model.members) {
    if (m.ref.kind !== 'beam') continue
    const g = geoms.get(m.ref.sourceId)
    if (!g || g.pts.length < 2) continue
    // os pavimentos que repetem a planta têm os mesmos vãos: basta o primeiro
    const li = model.nodes[m.ni].levelIndex
    if (!firstLevel.has(m.ref.sourceId)) firstLevel.set(m.ref.sourceId, li)
    if (firstLevel.get(m.ref.sourceId) !== li) continue
    const spans = out.get(m.ref.sourceId) ?? new Map<number, [number, number]>()
    out.set(m.ref.sourceId, spans)
    const ends = m.axis ? [m.axis.a, m.axis.b] : [model.nodes[m.ni], model.nodes[m.nj]]
    const sa = stationOf(g, ends[0])
    const sb = stationOf(g, ends[1])
    const cur = spans.get(m.ref.spanIndex)
    spans.set(m.ref.spanIndex, [
      Math.min(cur?.[0] ?? Infinity, sa, sb),
      Math.max(cur?.[1] ?? -Infinity, sa, sb),
    ])
  }
  return out
}

// ---------------------------------------------------------------------------
// vigas
// ---------------------------------------------------------------------------

function beamGroups(
  g: PathGeom,
  spans: { d: BeamDetailSpan; sa: number; sb: number }[],
  zTop: number,
  cover: number,
  base: Pick<RebarGroup3D, 'elementKind' | 'elementId' | 'elementName' | 'levelIndex'>,
  idPrefix: string,
): RebarGroup3D[] {
  const out: RebarGroup3D[] = []
  // pontas das barras ficam dentro do concreto: até o cobrimento dos extremos
  const lo = Math.min(cover, g.total / 2)
  const hi = g.total - lo
  spans.forEach(({ d, sa, sb }, k) => {
    const { bw, h } = d.section
    const phiT = d.stirrup.phi
    const Lg = sb - sa
    const mid = (sa + sb) / 2
    const zBot = zTop - h
    const gapOf = (phi: number) => Math.max(0.02, phi)
    const add = (
      slot: string,
      category: RebarCategory,
      label: string,
      phi: number,
      unitLength: number,
      pos: number | undefined,
      paths: number[][],
      n = paths.length,
    ) => {
      if (paths.length === 0) return
      out.push({
        ...base,
        id: `${idPrefix}:${d.spanIndex}:${slot}`,
        category,
        spanIndex: d.spanIndex,
        pos,
        phi,
        n,
        unitLength,
        label,
        paths,
      })
    }

    /** barras retas entre a e b com pernas verticais (dir +1 sobe, −1 desce) nas pontas */
    const straight = (
      n: number,
      phi: number,
      a: number,
      b: number,
      face: 'bottom' | 'top',
      legA: number,
      legB: number,
      drop = 0,
    ): number[][] => {
      const xa = Math.max(a, lo)
      const xb = Math.min(b, hi)
      if (xb - xa < 0.05) return []
      const edge = cover + phiT + phi / 2
      return barSlots(n, phi, bw, cover, phiT).map(({ off, layer }) => {
        const inset = edge + layer * (phi + gapOf(phi)) + drop
        const z = face === 'bottom' ? zBot + inset : zTop - inset
        const dir = face === 'bottom' ? 1 : -1
        // a perna do gancho para dentro do estribo da face oposta
        const maxLeg = Math.max(h - inset - edge, 0)
        const pts = runPoints(g, xa, xb, off, z)
        const la = Math.min(legA, maxLeg)
        const lb = Math.min(legB, maxLeg)
        const head = la > 0 ? [pts[0], pts[1], z + dir * la] : []
        const tail = lb > 0 ? [pts[pts.length - 3], pts[pts.length - 2], z + dir * lb] : []
        return [...head, ...pts, ...tail]
      })
    }

    // ---- positivas: centradas no vão, ganchos para cima nas pontas da viga
    const p = d.positive
    if (p.n > 0) {
      const legS = p.legStart ?? 0
      const legE = p.legEnd ?? 0
      const run = Math.max(p.length - legS - legE, 0.1)
      add('positive', 'viga-positiva', 'positiva', p.phi, p.length, p.pos, straight(p.n, p.phi, mid - run / 2, mid + run / 2, 'bottom', legS, legE))
    }

    // ---- negativas: cavalgam o apoio; no apoio de extremidade entram no vão
    const neg = (f: NonNullable<BeamDetailSpan['negLeft']>, side: 'left' | 'right', drop: number) => {
      const xc = side === 'left' ? sa : sb
      const leg = f.leg ?? 0
      const range = (len: number): [number, number] => {
        const run = Math.max(len - 2 * leg, 0.1)
        if (f.edge) return side === 'left' ? [xc - NEG_EDGE_EMBED, xc - NEG_EDGE_EMBED + run] : [xc + NEG_EDGE_EMBED - run, xc + NEG_EDGE_EMBED]
        // prolongada: cobre o vão e sobra por igual além dos dois apoios
        if (f.through) {
          const over = Math.max(run - Lg, 0) / 2
          return side === 'left' ? [xc - over, xc - over + run] : [xc + over - run, xc + over]
        }
        return [xc - run / 2, xc + run / 2]
      }
      const where = side === 'left' ? 'apoio esquerdo' : 'apoio direito'
      const slot = side === 'left' ? 'negLeft' : 'negRight'
      const [a, b] = range(f.length)
      const full = straight(f.n + (f.cut?.n ?? 0), f.phi, a, b, 'top', leg, leg, drop)
      if (!f.cut) {
        add(slot, 'viga-negativa', `negativa — ${where}${f.through ? ' (prolongada)' : ''}`, f.phi, f.length, f.pos, full)
        return
      }
      // escalonadas: as barras de dentro são as curtas (corte a 50% do momento)
      const [ca, cb] = range(f.cut.length)
      const short = straight(f.n + f.cut.n, f.phi, ca, cb, 'top', leg, leg, drop)
      const isShort = (i: number) => i % 2 === 1 && Math.floor(i / 2) < f.cut!.n
      add(slot, 'viga-negativa', `negativa — ${where}`, f.phi, f.length, f.pos, full.filter((_, i) => !isShort(i)))
      add(`${slot}-cut`, 'viga-negativa', `negativa escalonada — ${where}`, f.phi, f.cut.length, f.cut.pos, short.filter((_, i) => isShort(i)))
    }
    if (d.negLeft) neg(d.negLeft, 'left', 0)
    if (d.negRight) {
      // no apoio interno as negativas dos dois vãos coexistem: a deste vão fica uma camada abaixo
      const next = spans[k + 1]?.d.negLeft
      neg(d.negRight, 'right', next ? next.phi + gapOf(next.phi) : 0)
    }

    // ---- estribos: um laço por posição, trecho a trecho
    const st = d.stirrup
    const zones = st.zones ?? [{ length: Lg, spacing: st.spacing, count: st.count }]
    const scale = Lg / Math.max(zones.reduce((acc, z) => acc + z.length, 0), 1e-9)
    const halfW = Math.max(bw / 2 - cover - st.phi / 2, 0.01)
    const z0 = zBot + cover + st.phi / 2
    const z1 = zTop - cover - st.phi / 2
    const legs = Math.max(2, st.legs ?? 2)
    const loops: number[][] = []
    let nStations = 0
    let zx = sa
    let lastS: number | null = null
    let lastStep = 0
    for (const z of zones) {
      const step = Math.max(z.spacing, 0.03)
      // o trecho seguinte continua do último estribo, no menor dos dois passos
      const za: number = Math.max(zx, sa + 0.05, lo, lastS === null ? -Infinity : lastS + Math.min(lastStep, step))
      const zb = Math.min(zx + z.length * scale, sb - 0.05, hi)
      for (let s = za; s <= zb + 1e-9; s += step) {
        lastS = s
        lastStep = step
        const f = frameAt(g, s)
        const at = (off: number, zz: number) => [f.x - f.ty * off, f.y + f.tx * off, zz]
        loops.push([...at(-halfW, z0), ...at(halfW, z0), ...at(halfW, z1), ...at(-halfW, z1), ...at(-halfW, z0)])
        // ramos internos (4 ou 6 ramos): pernas verticais entre as faces
        for (let j = 1; j < legs - 1; j++) {
          const off = -halfW + (2 * halfW * j) / (legs - 1)
          loops.push([...at(off, z0), ...at(off, z1)])
        }
        nStations++
      }
      zx += z.length * scale
    }
    const legsTxt = legs > 2 ? ` (${legs} ramos)` : ''
    add('stirrup', 'viga-estribo', `estribos${legsTxt}`, st.phi, st.unitLength, st.pos, loops, nStations * Math.ceil(legs / 2))
  })
  return out
}

// ---------------------------------------------------------------------------
// tudo
// ---------------------------------------------------------------------------

/**
 * Grupos de barras de vigas e pilares em 3D. `levels` restringe aos índices de
 * nível dados (viga: o pavimento; pilar: tramos que tocam o nível).
 */
export function buildRebar3D(
  project: Project,
  results: AnalysisResults,
  opts: { levels?: number[] } = {},
): RebarGroup3D[] {
  const out: RebarGroup3D[] = []
  const cover = coverFor(project.settings.caa)
  const wanted = opts.levels ? new Set(opts.levels) : null

  // ---- vigas: o detalhamento é por planta e vale em cada pavimento que a usa
  const stations = beamSpanStations(project, results)
  const detailByBeam = new Map<string, BeamDetailSpan[]>()
  for (const d of results.detailing.beams) {
    const l = detailByBeam.get(d.beamId) ?? []
    l.push(d)
    detailByBeam.set(d.beamId, l)
  }
  project.levels.forEach((level, li) => {
    if (!level.planId || (wanted && !wanted.has(li))) return
    const plan = project.plans.find((pl) => pl.id === level.planId)
    if (!plan) return
    for (const beam of plan.beams) {
      const details = detailByBeam.get(beam.id)
      const sts = stations.get(beam.id)
      if (!details || !sts) continue
      const g = pathGeom(beam.path)
      if (g.pts.length < 2) continue
      const spans = [...details]
        .sort((a, b) => a.spanIndex - b.spanIndex)
        .flatMap((d) => {
          const r = sts.get(d.spanIndex)
          return r && r[1] - r[0] > 0.05 ? [{ d, sa: r[0], sb: r[1] }] : []
        })
      out.push(
        ...beamGroups(
          g,
          spans,
          level.elevation,
          cover.beam,
          { elementKind: 'beam', elementId: beam.id, elementName: beam.name, levelIndex: li },
          `b:${beam.id}:${li}`,
        ),
      )
    }
  })

  // ---- pilares: um grupo de barras e um de estribos por tramo
  const sorted = project.levels.map((l, i) => ({ l, i })).sort((a, b) => a.l.elevation - b.l.elevation)
  const rank = new Map(sorted.map((x, k) => [x.l.id, k]))
  for (const det of results.detailing.columns) {
    const col = project.columns.find((c) => c.id === det.columnId)
    if (!col || det.barsN <= 0) continue
    const kBase = rank.get(col.baseLevelId) ?? 0
    const info = columnSectionInfo(col.section)
    const { vDir, uDir } = columnWorldDirs(col.rotationDeg)
    const world = (p: Vec2): [number, number] => [
      col.pos.x + p.y * vDir.x + p.x * uDir.x,
      col.pos.y + p.y * vDir.y + p.x * uDir.y,
    ]
    // estribo: contorno recuado até o eixo do fio
    const inset = 0.025 + det.stirrupPhi / 2
    let outline: Vec2[]
    if (info.kind === 'circle') {
      const r = Math.max(info.bu / 2 - inset, 0.01)
      outline = Array.from({ length: 24 }, (_, i) => ({
        x: r * Math.cos((2 * Math.PI * i) / 24),
        y: r * Math.sin((2 * Math.PI * i) / 24),
      }))
    } else {
      outline = insetRectilinear(info.polygon, inset)
    }
    let perim = 0
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length]
      perim += Math.hypot(q.x - p.x, q.y - p.y)
    })
    const ring = [...outline, outline[0]].map(world)
    const steel = results.detailing.steel.items.filter((it) => it.elementId === det.columnId)
    const rowOf = (pos: number, phi: number) => steel.find((it) => it.pos === pos && Math.abs(it.phi - phi) < 1e-9)
    const nT = det.storyHeights.length
    let z = sorted[kBase]?.l.elevation ?? 0
    for (let t = 0; t < nT; t++) {
      const h = det.storyHeights[t]
      const liBase = sorted[kBase + t]?.i ?? 0
      const liTop = sorted[kBase + t + 1]?.i ?? liBase
      const zb = z
      z += h
      if (wanted && !wanted.has(liBase) && !wanted.has(liTop)) continue
      const last = t === nT - 1
      // a barra sobe o traspasse no tramo de cima; no último, para no cobrimento
      const top = last ? zb + h - cover.column : zb + h + det.lapLength
      const base = {
        elementKind: 'column' as const,
        elementId: col.id,
        elementName: col.name,
        levelIndex: liBase,
        levelTop: liTop,
        spanIndex: t,
      }
      out.push({
        ...base,
        id: `c:${col.id}:${t}:bars`,
        category: 'pilar-barra',
        pos: rowOf(2 * t + 1, det.barsPhi)?.pos,
        phi: det.barsPhi,
        n: det.barPositions.length,
        // comprimento de corte: o do quadro de ferros (arredondado a 5 cm)
        unitLength: rowOf(2 * t + 1, det.barsPhi)?.unitLength ?? h + det.lapLength,
        label: last ? 'longitudinais' : 'longitudinais (com traspasse acima do piso)',
        paths: det.barPositions.map((p) => {
          const [x, y] = world(p)
          return [x, y, zb, x, y, top]
        }),
      })
      // mesma contagem do quadro de ferros: com trecho junto aos nós, as posições
      // reais; sem, altura ÷ passo, distribuídos por igual
      const nEven = Math.max(2, Math.ceil(h / det.stirrupSpacing))
      const offs =
        det.jointLength !== undefined && det.jointSpacing !== undefined
          ? columnStirrupOffsets(h, det.stirrupSpacing, det.jointLength, det.jointSpacing)
          : Array.from({ length: nEven }, (_, i) => 0.05 + ((Math.max(h - 0.1, 0.05)) * i) / (nEven - 1))
      out.push({
        ...base,
        id: `c:${col.id}:${t}:stirrup`,
        category: 'pilar-estribo',
        pos: rowOf(2 * t + 2, det.stirrupPhi)?.pos,
        phi: det.stirrupPhi,
        n: offs.length,
        unitLength: rowOf(2 * t + 2, det.stirrupPhi)?.unitLength ?? perim + 0.15,
        label: det.jointLength ? 'estribos (passo menor junto aos nós)' : 'estribos',
        paths: offs.map((o) => ring.flatMap(([x, y]) => [x, y, zb + o])),
      })
    }
  }
  return out
}

/** comprimento do eixo desenhado de uma barra, m */
export function rebarPathLength(path: number[]): number {
  let L = 0
  for (let i = 3; i + 2 < path.length; i += 3) {
    L += Math.hypot(path[i] - path[i - 3], path[i + 1] - path[i - 2], path[i + 2] - path[i - 1])
  }
  return L
}
