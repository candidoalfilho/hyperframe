/**
 * Prancha de pilares — grade de seções transversais (4 por linha) com
 * estribo, barras longitudinais nas posições calculadas e textos de
 * identificação (seção, armadura, estribo e traspasse).
 *
 * Coordenadas em METROS, y para CIMA; seções desenhadas em escala ×2.
 * Zero dependências e zero DOM. Detalhamento PRELIMINAR.
 */

import type { ColumnDetailInfo } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'

/** φ em m → rótulo em mm: "5", "12,5" */
function mmTxt(phi: number): string {
  const mm = Math.round(phi * 1000 * 10) / 10
  return Number.isInteger(mm) ? String(mm) : String(mm).replace('.', ',')
}

/** metros → rótulo em cm: "25", "12,5" */
function cmTxt(m: number): string {
  const c = Math.round(m * 1000) / 10
  return Number.isInteger(c) ? String(c) : String(c).replace('.', ',')
}

/** escala das seções e nº de seções por linha */
const SC = 2
const PER_ROW = 4

export function buildColumnDetailDrawing(details: ColumnDetailInfo[]): Drawing {
  const prims: DrawingPrimitive[] = []
  const title = 'PILARES — SEÇÕES E ARMADURAS (PRELIMINAR)'

  if (details.length === 0) {
    prims.push({ kind: 'text', x: 0, y: 0, text: title, height: 0.25, layer: 'TEXTOS' })
    return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
  }

  // rótulos sob cada seção (calculados antes p/ dimensionar a grade)
  const line2 = (d: ColumnDetailInfo): string =>
    `${cmTxt(d.section.bw)}×${cmTxt(d.section.h)} cm · ${d.barsN} φ ${mmTxt(d.barsPhi)}`
  const line3 = (d: ColumnDetailInfo): string =>
    `estribo φ${mmTxt(d.stirrupPhi)} c/${Math.round(d.stirrupSpacing * 100)} · traspasse ${Math.round(d.lapLength * 100)}`

  // passo da grade: 2,2 m; cresce se houver seção alta ou rótulo largo demais
  // (fonte mono ≈ 0,62·altura por caractere)
  const maxH = details.reduce((m, d) => Math.max(m, d.section.h), 0.2)
  const maxW = details.reduce((m, d) => Math.max(m, d.section.bw), 0.2)
  const maxChars = details.reduce((m, d) => Math.max(m, line2(d).length, line3(d).length), 0)
  const pitchX = Math.max(2.2, maxW * SC + 0.8, maxChars * 0.12 * 0.62 + 0.3)
  const pitchY = Math.max(2.2, maxH * SC + 1.15)

  details.forEach((d, i) => {
    const cx = (i % PER_ROW) * pitchX
    const cy = -Math.floor(i / PER_ROW) * pitchY
    const hw = (d.section.bw * SC) / 2 // meia-largura desenhada
    const hh = (d.section.h * SC) / 2 // meia-altura desenhada

    // seção (aspecto preenchido no SVG; contorno no DXF)
    prims.push({
      kind: 'polyline',
      points: [
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx + hw, y: cy + hh },
        { x: cx - hw, y: cy + hh },
      ],
      closed: true,
      layer: 'PILARES',
    })

    // estribo: retângulo recuado do cobrimento (~2,5 cm reais)
    const ins = 0.025 * SC
    prims.push({
      kind: 'polyline',
      points: [
        { x: cx - hw + ins, y: cy - hh + ins },
        { x: cx + hw - ins, y: cy - hh + ins },
        { x: cx + hw - ins, y: cy + hh - ins },
        { x: cx - hw + ins, y: cy + hh - ins },
      ],
      closed: true,
      layer: 'ESTRIBOS',
    })

    // barras longitudinais nas posições calculadas (u ao longo de bw, v de h)
    for (const p of d.barPositions) {
      prims.push({
        kind: 'circle',
        cx: cx + p.x * SC,
        cy: cy + p.y * SC,
        r: d.barsPhi,
        layer: 'ARMADURA',
        filled: true,
      })
    }

    // textos sob a seção
    prims.push({
      kind: 'text',
      x: cx,
      y: cy - hh - 0.28,
      text: d.name,
      height: 0.16,
      layer: 'TEXTOS',
      align: 'center',
    })
    prims.push({
      kind: 'text',
      x: cx,
      y: cy - hh - 0.5,
      text: line2(d),
      height: 0.12,
      layer: 'TEXTOS',
      align: 'center',
    })
    prims.push({
      kind: 'text',
      x: cx,
      y: cy - hh - 0.7,
      text: line3(d),
      height: 0.12,
      layer: 'TEXTOS',
      align: 'center',
    })
  })

  // título no canto inferior esquerdo
  const b0 = boundsOfPrimitives(prims, 0)
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.6,
    text: title,
    height: 0.25,
    layer: 'TEXTOS',
  })

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
