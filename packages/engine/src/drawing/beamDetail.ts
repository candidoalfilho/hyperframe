/**
 * Detalhamento de viga (armação em elevação) no estilo de prancha BR:
 * vãos em sequência no comprimento real, apoios hachurados, armaduras
 * positivas/negativas com rótulos "N{i} {n} φ {mm} C={cm}", estribos
 * amostrados, corte da seção ao lado e cotas dos vãos.
 *
 * Coordenadas em METROS, y para CIMA. Zero dependências e zero DOM.
 * Detalhamento PRELIMINAR — a prancha exige revisão de engenheiro.
 */

import type { BeamDetailSpan } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'

/** φ em m → rótulo em mm: "5", "12,5" */
function mmTxt(phi: number): string {
  const mm = Math.round(phi * 1000 * 10) / 10
  return Number.isInteger(mm) ? String(mm) : String(mm).replace('.', ',')
}

/** metros → rótulo em cm inteiro/decimal: "20", "12,5" */
function cmTxt(m: number): string {
  const c = Math.round(m * 1000) / 10
  return Number.isInteger(c) ? String(c) : String(c).replace('.', ',')
}

export function buildBeamDetailDrawing(
  beamName: string,
  spans: BeamDetailSpan[],
  sectionScale?: number,
): Drawing {
  const k = sectionScale ?? 2
  const prims: DrawingPrimitive[] = []
  const title = `VIGA ${beamName} — DETALHAMENTO PRELIMINAR (rev. obrigatória)`

  const ordered = [...spans].sort((a, b) => a.spanIndex - b.spanIndex)
  if (ordered.length === 0) {
    prims.push({ kind: 'text', x: 0, y: 0, text: title, height: 0.2, layer: 'TEXTOS' })
    return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
  }

  // ---- posições acumuladas dos vãos (esquerda → direita, comprimento real) ----
  let cursor = 0
  const segs = ordered.map((s) => {
    const x0 = cursor
    cursor += Math.max(s.length, 0.01)
    return { s, x0, x1: cursor }
  })
  const totalL = cursor

  // ---- apoios: hachuras diagonais curtas sob a viga nas divisas de vão ----
  const support = (x: number): void => {
    for (let i = 0; i < 4; i++) {
      const xi = x - 0.21 + i * 0.14
      prims.push({ kind: 'line', x1: xi, y1: -0.32, x2: xi + 0.14, y2: -0.06, layer: 'CONTORNO' })
    }
  }
  support(segs[0].x0)
  for (const seg of segs) support(seg.x1)

  // numeração sequencial das posições de armadura (N1, N2, …)
  let nPos = 0
  const barLabel = (n: number, phi: number, len: number): string =>
    `N${++nPos} ${n} φ ${mmTxt(phi)} C=${Math.round(len * 100)}`

  segs.forEach(({ s, x0, x1 }, i) => {
    const h = s.section.h
    const mid = (x0 + x1) / 2

    // contorno do vão (altura = h da seção)
    prims.push({
      kind: 'polyline',
      points: [
        { x: x0, y: 0 },
        { x: x1, y: 0 },
        { x: x1, y: h },
        { x: x0, y: h },
      ],
      closed: true,
      layer: 'VIGAS',
    })

    // ---- armadura positiva: 0,08 m acima do fundo, centrada no vão ----
    const pos = s.positive
    if (pos.n > 0) {
      const half = pos.length / 2
      prims.push({ kind: 'line', x1: mid - half, y1: 0.08, x2: mid + half, y2: 0.08, layer: 'ARMADURA' })
      prims.push({
        kind: 'text',
        x: mid,
        y: -0.5,
        text: barLabel(pos.n, pos.phi, pos.length),
        height: 0.12,
        layer: 'ARMADURA',
        align: 'center',
      })
    }

    // ---- negativas: 0,08 m abaixo do topo, cavalgando os apoios ----
    // no apoio interno os negativos dos dois vãos coexistem → pequeno
    // escalonamento vertical p/ ambos permanecerem visíveis
    if (s.negLeft) {
      const half = s.negLeft.length / 2
      prims.push({ kind: 'line', x1: x0 - half, y1: h - 0.08, x2: x0 + half, y2: h - 0.08, layer: 'ARMADURA' })
      prims.push({
        kind: 'text',
        x: x0,
        y: h + 0.1,
        text: barLabel(s.negLeft.n, s.negLeft.phi, s.negLeft.length),
        height: 0.12,
        layer: 'ARMADURA',
        align: 'center',
      })
    }
    if (s.negRight) {
      const shared = i + 1 < segs.length && segs[i + 1].s.negLeft !== null
      const yBar = shared ? h - 0.16 : h - 0.08
      const yTxt = shared ? h + 0.3 : h + 0.1
      const half = s.negRight.length / 2
      prims.push({ kind: 'line', x1: x1 - half, y1: yBar, x2: x1 + half, y2: yBar, layer: 'ARMADURA' })
      prims.push({
        kind: 'text',
        x: x1,
        y: yTxt,
        text: barLabel(s.negRight.n, s.negRight.phi, s.negRight.length),
        height: 0.12,
        layer: 'ARMADURA',
        align: 'center',
      })
    }

    // ---- estribos: 3 traços verticais de amostra + especificação ----
    const st = s.stirrup
    const dx = Math.min(Math.max(st.spacing, 0.05), s.length / 4)
    for (const off of [-dx, 0, dx]) {
      prims.push({ kind: 'line', x1: mid + off, y1: 0.05, x2: mid + off, y2: h - 0.05, layer: 'ESTRIBOS' })
    }
    prims.push({
      kind: 'text',
      x: mid,
      y: h + 0.5,
      text: `${st.count}×φ${mmTxt(st.phi)} c/${Math.round(st.spacing * 100)}`,
      height: 0.12,
      layer: 'ESTRIBOS',
      align: 'center',
    })

    // ---- cota do vão, abaixo de tudo ----
    prims.push({
      kind: 'dim',
      x1: x0,
      y1: -0.55,
      x2: x1,
      y2: -0.55,
      offset: -0.45,
      text: String(Math.round(s.length * 100)),
      layer: 'COTAS',
    })
  })

  // ---- corte da seção ao lado da elevação (1 m à direita), escala ×k ----
  const sec = ordered[0]
  const bwS = sec.section.bw * k
  const hS = sec.section.h * k
  const sx = totalL + 1.0
  const scx = sx + bwS / 2
  prims.push({
    kind: 'polyline',
    points: [
      { x: sx, y: 0 },
      { x: sx + bwS, y: 0 },
      { x: sx + bwS, y: hS },
      { x: sx, y: hS },
    ],
    closed: true,
    layer: 'VIGAS',
  })
  // estribo: retângulo recuado do cobrimento (~3 cm reais)
  const ins = 0.03 * k
  prims.push({
    kind: 'polyline',
    points: [
      { x: sx + ins, y: ins },
      { x: sx + bwS - ins, y: ins },
      { x: sx + bwS - ins, y: hS - ins },
      { x: sx + ins, y: hS - ins },
    ],
    closed: true,
    layer: 'ESTRIBOS',
  })
  /** fileira de pontos de barra dentro do estribo */
  const barRow = (n: number, phi: number, y: number): void => {
    if (n <= 0) return
    const r = (phi * k) / 2
    const m = ins + r + 0.01 * k // margem lateral até o eixo da barra
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      prims.push({
        kind: 'circle',
        cx: sx + m + t * (bwS - 2 * m),
        cy: y,
        r,
        layer: 'ARMADURA',
        filled: true,
      })
    }
  }
  const eb = ins + ((sec.positive.phi * k) / 2 + 0.01 * k) // eixo da fileira
  barRow(sec.positive.n, sec.positive.phi, eb)
  prims.push({
    kind: 'text',
    x: scx,
    y: -0.3,
    text: `${sec.positive.n} φ ${mmTxt(sec.positive.phi)}`,
    height: 0.12,
    layer: 'ARMADURA',
    align: 'center',
  })
  const negTop =
    (sec.negLeft?.n ?? 0) >= (sec.negRight?.n ?? 0) ? sec.negLeft : sec.negRight
  if (negTop && negTop.n > 0) {
    barRow(negTop.n, negTop.phi, hS - (ins + (negTop.phi * k) / 2 + 0.01 * k))
    prims.push({
      kind: 'text',
      x: scx,
      y: hS + 0.1,
      text: `${negTop.n} φ ${mmTxt(negTop.phi)}`,
      height: 0.12,
      layer: 'ARMADURA',
      align: 'center',
    })
  }
  prims.push({
    kind: 'text',
    x: scx,
    y: -0.56,
    text: `SEÇÃO ${cmTxt(sec.section.bw)}x${cmTxt(sec.section.h)}`,
    height: 0.13,
    layer: 'TEXTOS',
    align: 'center',
  })

  // ---- título no canto inferior esquerdo ----
  const b0 = boundsOfPrimitives(prims, 0)
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.55,
    text: title,
    height: 0.2,
    layer: 'TEXTOS',
  })

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
