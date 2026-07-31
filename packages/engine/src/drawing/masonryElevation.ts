import type { MasonryWall, Project } from '../model/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'
import { modulateWall, lintelLength, BLOCK } from '../nbr/nbr16868/modulation'

/**
 * ELEVAÇÃO DE PAREDE de alvenaria estrutural: fiadas de 20 cm com AMARRAÇÃO
 * defasada (ímpares começam com bloco inteiro, pares com meio), aberturas
 * recortadas com VERGA/CONTRAVERGA em canaleta (apoio 30 cm), cinta de
 * respaldo na última fiada, cotas e QUADRO DE BLOCOS por pavimento.
 */
export function buildMasonryElevationDrawing(project: Project, wall: MasonryWall): Drawing {
  const prims: DrawingPrimitive[] = []
  const title = `ELEVAÇÃO ${wall.name} — ALVENARIA ${Math.round(wall.thickness * 100)} (fpk ${(wall.fpk / 1000).toFixed(1)} MPa)`
  const length = wall.path
    .slice(0, -1)
    .reduce((s, p, i) => s + Math.hypot(wall.path[i + 1].x - p.x, wall.path[i + 1].y - p.y), 0)
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const h = levels.length > 1 ? levels[1].elevation - levels[0].elevation : 2.8
  const mod = modulateWall(length, h)
  const L = mod.modularLength
  const rows = mod.rows
  const opens = (wall.openings ?? []).map((o) => {
    const sill = o.sill ?? 0 // 0 = porta; > 0 = janela (contraverga)
    return {
      x0: Math.max(o.x - o.width / 2, 0),
      x1: Math.min(o.x + o.width / 2, L),
      sill,
      top: Math.min(sill + (o.height ?? (sill > 0 ? 1.2 : 2.1)), h - 0.2),
    }
  })

  const inOpening = (bx0: number, bx1: number, by0: number, by1: number): boolean =>
    opens.some((o) => bx1 > o.x0 + 0.01 && bx0 < o.x1 - 0.01 && by1 > o.sill + 0.01 && by0 < o.top - 0.01)

  // ---- blocos fiada a fiada ----
  for (let r = 0; r < rows; r++) {
    const y0 = r * BLOCK.halfModule
    const y1 = y0 + BLOCK.height
    const isA = r % 2 === 0
    const isTop = r === rows - 1
    let x = 0
    const pieces: number[] = []
    if (isA) {
      const n = Math.floor(mod.halfModules / 2)
      for (let i = 0; i < n; i++) pieces.push(BLOCK.length)
      if (mod.halfModules % 2 === 1) pieces.push(BLOCK.half)
    } else {
      pieces.push(BLOCK.half)
      const rest = mod.halfModules - 1
      const n = Math.floor(rest / 2)
      for (let i = 0; i < n; i++) pieces.push(BLOCK.length)
      if (rest % 2 === 1) pieces.push(BLOCK.half)
    }
    for (const len of pieces) {
      const x1 = x + len
      if (!inOpening(x, x1, y0, y1)) {
        prims.push({
          kind: 'polyline',
          points: [
            { x, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x, y: y1 },
          ],
          closed: true,
          layer: isTop ? 'ARMADURA' : 'LAJES',
        })
      }
      x = x1 + 0.01 // junta
    }
  }

  // ---- aberturas: contorno + verga ----
  opens.forEach((o, i) => {
    prims.push({
      kind: 'polyline',
      points: [
        { x: o.x0, y: o.sill },
        { x: o.x1, y: o.sill },
        { x: o.x1, y: o.top },
        { x: o.x0, y: o.top },
      ],
      closed: true,
      layer: 'CONTORNO',
    })
    const lv = lintelLength(o.x1 - o.x0)
    const vx0 = Math.max((o.x0 + o.x1) / 2 - lv / 2, 0)
    const vx1 = Math.min(vx0 + lv, L)
    prims.push({
      kind: 'polyline',
      points: [
        { x: vx0, y: o.top },
        { x: vx1, y: o.top },
        { x: vx1, y: o.top + BLOCK.height },
        { x: vx0, y: o.top + BLOCK.height },
      ],
      closed: true,
      layer: 'ARMADURA',
    })
    prims.push({
      kind: 'text',
      x: (o.x0 + o.x1) / 2,
      y: o.top + BLOCK.height + 0.08,
      text: `VERGA ${i + 1} — canaleta grauteada 1 φ 10, C=${Math.round(lv * 100)} (apoio 30 cm p/ lado)`,
      height: 0.11,
      layer: 'TEXTOS',
      align: 'center',
    })
    if (o.sill > 0.05) {
      // CONTRAVERGA sob o peitoril da janela (mesmo apoio de 30 cm)
      prims.push({
        kind: 'polyline',
        points: [
          { x: vx0, y: o.sill - BLOCK.height },
          { x: vx1, y: o.sill - BLOCK.height },
          { x: vx1, y: o.sill },
          { x: vx0, y: o.sill },
        ],
        closed: true,
        layer: 'ARMADURA',
      })
      prims.push({
        kind: 'text',
        x: (o.x0 + o.x1) / 2,
        y: o.sill - BLOCK.height - 0.16,
        text: `CONTRAVERGA ${i + 1} — canaleta 1 φ 10, C=${Math.round(lv * 100)}`,
        height: 0.11,
        layer: 'TEXTOS',
        align: 'center',
      })
    }
  })

  // ---- cotas e quadro ----
  prims.push({ kind: 'line', x1: 0, y1: -0.3, x2: L, y2: -0.3, layer: 'COTAS' })
  prims.push({
    kind: 'text',
    x: L / 2,
    y: -0.55,
    text: `${Math.round(L * 100)} (${mod.halfModules} módulos M-20)${mod.leftover > 0.015 ? ' — AJUSTAR: não modular' : ''}`,
    height: 0.13,
    layer: 'COTAS',
    align: 'center',
  })
  prims.push({ kind: 'line', x1: -0.3, y1: 0, x2: -0.3, y2: rows * BLOCK.halfModule, layer: 'COTAS' })
  prims.push({
    kind: 'text',
    x: -0.45,
    y: (rows * BLOCK.halfModule) / 2,
    text: `${rows} fiadas`,
    height: 0.13,
    layer: 'COTAS',
    align: 'center',
    rotation: 90,
  })
  const t = mod.totals
  const quadro = [
    `QUADRO DE BLOCOS (por pavimento) — família ${Math.round(wall.thickness * 100)}:`,
    `inteiros 14×19×39: ${t.inteiro} un. · meios: ${t.meio} un. · canaletas (cinta): ${t.canaleta} un.${t.canaletaMeia > 0 ? ` + ${t.canaletaMeia} meia(s)` : ''}`,
    ...mod.notes,
    'Amarração defasada meio bloco (juntas verticais descontínuas); graute/armadura de extremidade conforme aba Alvenaria (vento).',
  ]
  quadro.forEach((txt, i) => {
    prims.push({
      kind: 'text',
      x: 0,
      y: -0.9 - i * 0.26,
      text: txt,
      height: i === 0 ? 0.15 : 0.13,
      layer: 'TEXTOS',
    })
  })
  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 0.6) }
}
