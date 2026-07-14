/**
 * Corte esquemático do edifício (corte rebatido): plano vertical em x = pos
 * (dir 'x') ou y = pos (dir 'y'). Mostra níveis com cotas, pilares que cruzam
 * o plano, vigas seccionadas (retângulo bw×h sob o nível) e lajes (espessura),
 * com cadeia de cotas de pé-direito à esquerda.
 *
 * Coordenadas em METROS (horizontal = outra coordenada em planta; vertical = z).
 */

import type { Project, SectionRect, Vec2 } from '../model/types'
import type { Drawing, DrawingPrimitive } from './types'
import { columnHalfExtents } from '../model/columnSection'
import { boundsOfPrimitives } from './formwork'

function cmTxt(m: number): string {
  const c = Math.round(m * 1000) / 10
  return Number.isInteger(c) ? String(c) : String(c).replace('.', ',')
}

function fmtElev(z: number): string {
  const v = z.toFixed(2).replace('.', ',')
  return z >= 0 ? `+${v}` : v
}

export interface SectionCutOptions {
  dir: 'x' | 'y'
  /** posição do plano de corte, m */
  pos: number
  /** rótulo do corte (ex.: "A") */
  label?: string
}

/** interseções de um polígono com a reta coord=pos → faixas [min,max] na outra coord */
function polygonCrossRanges(polygon: Vec2[], dir: 'x' | 'y', pos: number): [number, number][] {
  const hits: number[] = []
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    const ca = dir === 'x' ? a.x : a.y
    const cb = dir === 'x' ? b.x : b.y
    if ((ca - pos) * (cb - pos) < 0) {
      const t = (pos - ca) / (cb - ca)
      hits.push(dir === 'x' ? a.y + (b.y - a.y) * t : a.x + (b.x - a.x) * t)
    }
  }
  hits.sort((p, q) => p - q)
  const ranges: [number, number][] = []
  for (let i = 0; i + 1 < hits.length; i += 2) ranges.push([hits[i], hits[i + 1]])
  return ranges
}

export function buildSectionCutDrawing(project: Project, opts: SectionCutOptions): Drawing {
  const { dir, pos } = opts
  const label = opts.label ?? 'A'
  const prims: DrawingPrimitive[] = []
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)

  // extensão horizontal do conteúdo (na coordenada perpendicular ao corte)
  let hMin = Infinity
  let hMax = -Infinity
  const addH = (v: number) => {
    if (v < hMin) hMin = v
    if (v > hMax) hMax = v
  }
  for (const c of project.columns) addH(dir === 'x' ? c.pos.y : c.pos.x)
  for (const plan of project.plans) {
    for (const b of plan.beams) for (const p of b.path) addH(dir === 'x' ? p.y : p.x)
  }
  if (!Number.isFinite(hMin)) {
    hMin = 0
    hMax = 10
  }
  if (hMax - hMin < 1) hMax = hMin + 1
  const zMax = levels[levels.length - 1]?.elevation ?? 3

  // ---- linhas de nível + rótulos de cota ----
  for (const level of levels) {
    prims.push({
      kind: 'line',
      x1: hMin - 1.2,
      y1: level.elevation,
      x2: hMax + 1.2,
      y2: level.elevation,
      layer: 'EIXOS',
      dashed: true,
    })
    prims.push({
      kind: 'text',
      x: hMax + 1.35,
      y: level.elevation + 0.05,
      text: `${level.name}  ${fmtElev(level.elevation)}`,
      height: 0.18,
      layer: 'TEXTOS',
    })
  }

  // ---- cadeia de cotas de pé-direito à esquerda ----
  for (let i = 0; i + 1 < levels.length; i++) {
    const z0 = levels[i].elevation
    const z1 = levels[i + 1].elevation
    if (z1 - z0 < 1e-6) continue
    prims.push({
      kind: 'dim',
      x1: hMin - 1.2,
      y1: z0,
      x2: hMin - 1.2,
      y2: z1,
      offset: 0.8, // p/ a esquerda (segmento +y tem normal −x)
      height: 0.3,
      text: String(Math.round((z1 - z0) * 100)),
      layer: 'COTAS',
    })
  }

  // ---- pilares que cruzam o plano ----
  const levelIndexById = new Map(levels.map((l, i) => [l.id, i]))
  for (const col of project.columns) {
    const cAxis = dir === 'x' ? col.pos.x : col.pos.y
    const { dx, dy } = columnHalfExtents(col)
    const halfAlongCut = dir === 'x' ? dx : dy
    if (Math.abs(cAxis - pos) > halfAlongCut + 1e-6) continue
    const cH = dir === 'x' ? col.pos.y : col.pos.x
    const halfH = dir === 'x' ? dy : dx
    const zBase = levels[levelIndexById.get(col.baseLevelId) ?? 0]?.elevation ?? 0
    const zTop = levels[levelIndexById.get(col.topLevelId) ?? levels.length - 1]?.elevation ?? zMax
    if (zTop <= zBase) continue
    prims.push({
      kind: 'polyline',
      points: [
        { x: cH - halfH, y: zBase },
        { x: cH + halfH, y: zBase },
        { x: cH + halfH, y: zTop },
        { x: cH - halfH, y: zTop },
      ],
      closed: true,
      layer: 'PILARES',
    })
    prims.push({
      kind: 'text',
      x: cH,
      y: zBase - 0.35,
      text: col.name,
      height: 0.15,
      layer: 'TEXTOS',
      align: 'center',
    })
  }

  // ---- vigas e lajes por nível ----
  for (const level of levels) {
    if (!level.planId) continue
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) continue
    const z = level.elevation

    for (const beam of plan.beams) {
      for (let i = 0; i + 1 < beam.path.length; i++) {
        const a = beam.path[i]
        const b = beam.path[i + 1]
        const sec: SectionRect = beam.segmentSections?.[i] ?? beam.section
        const ca = dir === 'x' ? a.x : a.y
        const cb = dir === 'x' ? b.x : b.y
        const ha = dir === 'x' ? a.y : a.x
        const hb = dir === 'x' ? b.y : b.x
        if ((ca - pos) * (cb - pos) < 0) {
          // seccionada: retângulo bw×h pendurado no nível
          const t = (pos - ca) / (cb - ca)
          const hc = ha + (hb - ha) * t
          prims.push({
            kind: 'polyline',
            points: [
              { x: hc - sec.bw / 2, y: z - sec.h },
              { x: hc + sec.bw / 2, y: z - sec.h },
              { x: hc + sec.bw / 2, y: z },
              { x: hc - sec.bw / 2, y: z },
            ],
            closed: true,
            layer: 'VIGAS',
          })
          prims.push({
            kind: 'text',
            x: hc,
            y: z - sec.h - 0.22,
            text: `${beam.name} ${cmTxt(sec.bw)}x${cmTxt(sec.h)}`,
            height: 0.12,
            layer: 'TEXTOS',
            align: 'center',
          })
        } else if (Math.abs(ca - pos) <= 0.05 && Math.abs(cb - pos) <= 0.05) {
          // corre no plano do corte: elevação do trecho
          const lo = Math.min(ha, hb)
          const hi = Math.max(ha, hb)
          prims.push({
            kind: 'polyline',
            points: [
              { x: lo, y: z - sec.h },
              { x: hi, y: z - sec.h },
              { x: hi, y: z },
              { x: lo, y: z },
            ],
            closed: true,
            layer: 'VIGAS',
          })
          prims.push({
            kind: 'text',
            x: (lo + hi) / 2,
            y: z - sec.h - 0.22,
            text: `${beam.name} (long.)`,
            height: 0.12,
            layer: 'TEXTOS',
            align: 'center',
          })
        }
      }
    }

    for (const slab of plan.slabs) {
      for (const [r0, r1] of polygonCrossRanges(slab.polygon, dir, pos)) {
        prims.push({
          kind: 'polyline',
          points: [
            { x: r0, y: z - slab.thickness },
            { x: r1, y: z - slab.thickness },
            { x: r1, y: z },
            { x: r0, y: z },
          ],
          closed: true,
          layer: 'LAJES',
        })
      }
    }
  }

  // ---- título ----
  const posTxt = pos.toFixed(2).replace('.', ',')
  const title = `CORTE ${label}-${label} (${dir === 'x' ? 'x' : 'y'} = ${posTxt} m)`
  const b0 = boundsOfPrimitives(prims, 0)
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.6,
    text: title,
    height: 0.25,
    layer: 'TEXTOS',
  })

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1.5) }
}
