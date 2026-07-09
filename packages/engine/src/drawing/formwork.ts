/**
 * Planta de forma — desenho técnico do pavimento no estilo de prancha BR:
 * eixos tracejados com bolachas e cotas entre eixos, pilares preenchidos,
 * vigas em contorno duplo com eixo tracejado, lajes com nome/espessura e
 * regiões de carga em contorno tracejado.
 *
 * Coordenadas em METROS no plano do desenho, y para CIMA (mesmo sistema do
 * modelo). Zero dependências e zero DOM — consumido pelo SVG do app e pelo
 * gerador DXF.
 */

import type { Project, Vec2 } from '../model/types'
import type { Drawing, DrawingPrimitive } from './types'
import { polygonCentroid } from '../geometry/geometry'

// ---------------------------------------------------------------------------
// helpers de formatação (pt-BR) e geometria
// ---------------------------------------------------------------------------

/** metros → rótulo em cm: "25", "12,5" */
function cmTxt(m: number): string {
  const c = Math.round(m * 1000) / 10
  return Number.isInteger(c) ? String(c) : String(c).replace('.', ',')
}

/** número com 1 casa decimal e vírgula: "5,0" */
function fmt1(n: number): string {
  return n.toFixed(1).replace('.', ',')
}

/** bbox de todas as primitivas (com estimativa de extensão dos textos) */
export function boundsOfPrimitives(
  prims: DrawingPrimitive[],
  margin: number,
): Drawing['bounds'] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const p of prims) {
    switch (p.kind) {
      case 'line':
        add(p.x1, p.y1)
        add(p.x2, p.y2)
        break
      case 'polyline':
        for (const pt of p.points) add(pt.x, pt.y)
        break
      case 'circle':
        add(p.cx - p.r, p.cy - p.r)
        add(p.cx + p.r, p.cy + p.r)
        break
      case 'text': {
        // estimativa: fonte mono ≈ 0,62·altura por caractere (rotação ignorada)
        const w = p.text.length * p.height * 0.62
        const a = p.align ?? 'left'
        const x0 = a === 'left' ? p.x : a === 'center' ? p.x - w / 2 : p.x - w
        add(x0, p.y)
        add(x0 + w, p.y + p.height)
        break
      }
      case 'dim': {
        add(p.x1, p.y1)
        add(p.x2, p.y2)
        const dx = p.x2 - p.x1
        const dy = p.y2 - p.y1
        const l = Math.hypot(dx, dy) || 1
        // linha de cota + texto alcançam ~1,5·offset na perpendicular
        const nx = (-dy / l) * p.offset * 1.5
        const ny = (dx / l) * p.offset * 1.5
        add(p.x1 + nx, p.y1 + ny)
        add(p.x2 + nx, p.y2 + ny)
        break
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0
    minY = 0
    maxX = 1
    maxY = 1
  }
  if (maxX - minX < 1e-6) {
    minX -= 0.5
    maxX += 0.5
  }
  if (maxY - minY < 1e-6) {
    minY -= 0.5
    maxY += 0.5
  }
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  }
}

/**
 * Offset paralelo de polilinha aberta com junta em meia-esquadria.
 * d > 0 desloca para a esquerda do sentido de percurso (normal +90°).
 */
export function offsetPolyline(pts: Vec2[], d: number): Vec2[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }))
  // normais unitárias por segmento (direção girada +90°)
  const ns: Vec2[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1].x - pts[i].x
    const dy = pts[i + 1].y - pts[i].y
    const l = Math.hypot(dx, dy) || 1
    ns.push({ x: -dy / l, y: dx / l })
  }
  const out: Vec2[] = [{ x: pts[0].x + ns[0].x * d, y: pts[0].y + ns[0].y * d }]
  for (let i = 1; i + 1 < pts.length; i++) {
    const na = ns[i - 1]
    const nb = ns[i]
    let mx = na.x + nb.x
    let my = na.y + nb.y
    const ml = Math.hypot(mx, my)
    if (ml < 1e-9) {
      mx = na.x
      my = na.y
    } else {
      mx /= ml
      my /= ml
    }
    // fator de esquadria d/cos(θ/2), limitado p/ ângulos muito fechados
    const cos = Math.max(0.25, mx * na.x + my * na.y)
    out.push({ x: pts[i].x + (mx * d) / cos, y: pts[i].y + (my * d) / cos })
  }
  const nl = ns[ns.length - 1]
  const pl = pts[pts.length - 1]
  out.push({ x: pl.x + nl.x * d, y: pl.y + nl.y * d })
  return out
}

// ---------------------------------------------------------------------------
// planta de forma
// ---------------------------------------------------------------------------

/** extensão dos eixos além do conteúdo (m) e raio da bolacha */
const AXIS_EXT = 1.5
const BUBBLE_R = 0.25

export function buildFormworkDrawing(project: Project, planId: string): Drawing {
  const plan = project.plans.find((p) => p.id === planId)
  if (!plan) throw new Error(`Planta de forma não encontrada: ${planId}`)

  const prims: DrawingPrimitive[] = []

  // ---- extensão do conteúdo (pilares, vigas, lajes, regiões e eixos) ----
  let cMinX = Infinity
  let cMinY = Infinity
  let cMaxX = -Infinity
  let cMaxY = -Infinity
  const addPt = (x: number, y: number): void => {
    if (x < cMinX) cMinX = x
    if (x > cMaxX) cMaxX = x
    if (y < cMinY) cMinY = y
    if (y > cMaxY) cMaxY = y
  }
  for (const c of project.columns) {
    const dx = (c.rotationDeg === 0 ? c.section.h : c.section.bw) / 2
    const dy = (c.rotationDeg === 0 ? c.section.bw : c.section.h) / 2
    addPt(c.pos.x - dx, c.pos.y - dy)
    addPt(c.pos.x + dx, c.pos.y + dy)
  }
  for (const b of plan.beams) for (const p of b.path) addPt(p.x, p.y)
  for (const s of plan.slabs) for (const p of s.polygon) addPt(p.x, p.y)
  for (const r of plan.loadRegions) for (const p of r.polygon) addPt(p.x, p.y)
  for (const a of project.grid.xAxes) {
    if (a.pos < cMinX) cMinX = a.pos
    if (a.pos > cMaxX) cMaxX = a.pos
  }
  for (const a of project.grid.yAxes) {
    if (a.pos < cMinY) cMinY = a.pos
    if (a.pos > cMaxY) cMaxY = a.pos
  }
  if (!Number.isFinite(cMinX)) {
    cMinX = 0
    cMaxX = 10
  }
  if (!Number.isFinite(cMinY)) {
    cMinY = 0
    cMaxY = 10
  }
  if (cMaxX - cMinX < 1e-6) cMaxX = cMinX + 1
  if (cMaxY - cMinY < 1e-6) cMaxY = cMinY + 1

  // ---- eixos com bolachas nas DUAS pontas ----
  const bubble = (cx: number, cy: number, label: string): void => {
    prims.push({ kind: 'circle', cx, cy, r: BUBBLE_R, layer: 'EIXOS' })
    prims.push({
      kind: 'text',
      x: cx,
      y: cy - 0.07, // baseline ≈ centro óptico da bolacha
      text: label,
      height: 0.2,
      layer: 'EIXOS',
      align: 'center',
    })
  }
  for (const a of project.grid.xAxes) {
    const yLo = cMinY - AXIS_EXT
    const yHi = cMaxY + AXIS_EXT
    prims.push({ kind: 'line', x1: a.pos, y1: yLo, x2: a.pos, y2: yHi, layer: 'EIXOS', dashed: true })
    bubble(a.pos, yLo - BUBBLE_R, a.label)
    bubble(a.pos, yHi + BUBBLE_R, a.label)
  }
  for (const a of project.grid.yAxes) {
    const xLo = cMinX - AXIS_EXT
    const xHi = cMaxX + AXIS_EXT
    prims.push({ kind: 'line', x1: xLo, y1: a.pos, x2: xHi, y2: a.pos, layer: 'EIXOS', dashed: true })
    bubble(xLo - BUBBLE_R, a.pos, a.label)
    bubble(xHi + BUBBLE_R, a.pos, a.label)
  }

  // ---- cotas entre eixos adjacentes, afastadas para fora do conteúdo ----
  const xs = [...project.grid.xAxes].sort((a, b) => a.pos - b.pos)
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    prims.push({
      kind: 'dim',
      x1: a.pos,
      y1: cMinY,
      x2: b.pos,
      y2: cMinY,
      offset: -1.0, // linha de cota abaixo do conteúdo (normal +y → offset negativo)
      text: String(Math.round((b.pos - a.pos) * 100)),
      layer: 'COTAS',
    })
  }
  const ys = [...project.grid.yAxes].sort((a, b) => a.pos - b.pos)
  for (let i = 0; i + 1 < ys.length; i++) {
    const a = ys[i]
    const b = ys[i + 1]
    prims.push({
      kind: 'dim',
      x1: cMinX,
      y1: a.pos,
      x2: cMinX,
      y2: b.pos,
      offset: 1.0, // segmento p/ +y tem normal −x → offset positivo joga p/ a esquerda
      text: String(Math.round((b.pos - a.pos) * 100)),
      layer: 'COTAS',
    })
  }

  // ---- lajes: cruz diagonal + nome + espessura no centróide ----
  for (const s of plan.slabs) {
    const c = polygonCentroid(s.polygon)
    const t = 0.3 // meia-dimensão da cruz
    prims.push({ kind: 'line', x1: c.x - t, y1: c.y - t, x2: c.x + t, y2: c.y + t, layer: 'LAJES' })
    prims.push({ kind: 'line', x1: c.x - t, y1: c.y + t, x2: c.x + t, y2: c.y - t, layer: 'LAJES' })
    prims.push({
      kind: 'text',
      x: c.x,
      y: c.y + t + 0.08,
      text: s.name,
      height: 0.18,
      layer: 'LAJES',
      align: 'center',
    })
    prims.push({
      kind: 'text',
      x: c.x,
      y: c.y - t - 0.23,
      text: `h=${cmTxt(s.thickness)}`,
      height: 0.15,
      layer: 'LAJES',
      align: 'center',
    })
  }

  // ---- regiões de carga (escada, reservatório…): contorno tracejado ----
  for (const r of plan.loadRegions) {
    prims.push({
      kind: 'polyline',
      points: r.polygon.map((p) => ({ ...p })),
      closed: true,
      layer: 'CONTORNO',
      dashed: true,
    })
    const c = polygonCentroid(r.polygon)
    prims.push({
      kind: 'text',
      x: c.x,
      y: c.y,
      text: `${r.name} g=${fmt1(r.g)} q=${fmt1(r.q)} kN/m²`,
      height: 0.15,
      layer: 'CONTORNO',
      align: 'center',
    })
  }

  // ---- vigas: contorno duplo ±bw/2 + eixo tracejado + nome no 1º trecho ----
  for (const b of plan.beams) {
    // remove vértices repetidos p/ não degenerar o offset
    const path: Vec2[] = []
    for (const p of b.path) {
      const last = path[path.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) path.push(p)
    }
    if (path.length < 2) continue
    const half = b.section.bw / 2
    prims.push({ kind: 'polyline', points: offsetPolyline(path, half), layer: 'VIGAS' })
    prims.push({ kind: 'polyline', points: offsetPolyline(path, -half), layer: 'VIGAS' })
    prims.push({
      kind: 'polyline',
      points: path.map((p) => ({ ...p })),
      layer: 'VIGAS',
      dashed: true,
    })

    // rótulo ao longo do PRIMEIRO trecho, mantido em pé
    const dx = path[1].x - path[0].x
    const dy = path[1].y - path[0].y
    const l = Math.hypot(dx, dy) || 1
    let nx = -dy / l
    let ny = dx / l
    // rótulo sempre acima (ou à esquerda em vigas verticais)
    if (ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) {
      nx = -nx
      ny = -ny
    }
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI
    if (ang > 90 || ang <= -90) ang += 180
    if (ang > 180) ang -= 360
    const off = half + 0.12
    prims.push({
      kind: 'text',
      x: (path[0].x + path[1].x) / 2 + nx * off,
      y: (path[0].y + path[1].y) / 2 + ny * off,
      text: `${b.name} ${cmTxt(b.section.bw)}x${cmTxt(b.section.h)}`,
      height: 0.15,
      layer: 'TEXTOS',
      rotation: ang,
      align: 'center',
    })
  }

  // ---- pilares por último (aspecto preenchido sobre as vigas) ----
  for (const c of project.columns) {
    const dx = (c.rotationDeg === 0 ? c.section.h : c.section.bw) / 2
    const dy = (c.rotationDeg === 0 ? c.section.bw : c.section.h) / 2
    prims.push({
      kind: 'polyline',
      points: [
        { x: c.pos.x - dx, y: c.pos.y - dy },
        { x: c.pos.x + dx, y: c.pos.y - dy },
        { x: c.pos.x + dx, y: c.pos.y + dy },
        { x: c.pos.x - dx, y: c.pos.y + dy },
      ],
      closed: true,
      layer: 'PILARES',
    })
    prims.push({
      kind: 'text',
      x: c.pos.x + dx + 0.06,
      y: c.pos.y + dy + 0.06,
      text: `${c.name} ${cmTxt(c.section.bw)}x${cmTxt(c.section.h)}`,
      height: 0.15,
      layer: 'TEXTOS',
    })
  }

  // ---- título no canto inferior esquerdo ----
  const b0 = boundsOfPrimitives(prims, 0)
  const title = `PLANTA DE FORMA — ${plan.name} — esc. 1:50`
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.6,
    text: title,
    height: 0.25,
    layer: 'TEXTOS',
  })

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 2) }
}
