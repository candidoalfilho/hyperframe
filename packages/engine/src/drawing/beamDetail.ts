/**
 * Armação de viga em elevação no estilo de prancha BR: vãos em sequência no
 * comprimento real, apoios hachurados, barras com GANCHOS desenhados
 * (pernas verticais) e rótulos "N{i} {n} φ {mm} C={cm}" casados com o quadro
 * de ferros, TODOS os estribos na distribuição real, corte da seção ao lado,
 * cotas dos vãos e QUADRO DE FERROS por posição (φ, quant., C unit./total, kg).
 *
 * Coordenadas em METROS, y para CIMA. Zero dependências e zero DOM.
 * A prancha continua exigindo revisão/assinatura de engenheiro.
 */

import type { BeamDetailSpan, RebarItem } from '../analysis/types'
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
  steelItems?: RebarItem[],
): Drawing {
  const k = sectionScale ?? 2
  const prims: DrawingPrimitive[] = []
  const title = `VIGA ${beamName} — ARMAÇÃO (revisão obrigatória)`

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

  // numeração das posições: usa a do detalhamento (casa com o quadro de
  // ferros); dados fabricados sem `pos` caem na sequência local
  let nPos = 0
  const barLabel = (n: number, phi: number, len: number, pos?: number): string =>
    `N${pos ?? ++nPos} ${n} φ ${mmTxt(phi)} C=${Math.round(len * 100)}`

  /** barra em elevação com pernas de gancho opcionais (p/ baixo ou p/ cima) */
  const bar = (
    xa: number,
    xb: number,
    y: number,
    legA: number,
    legB: number,
    dir: 1 | -1,
    hMax: number,
  ): void => {
    const la = Math.min(legA, hMax)
    const lb = Math.min(legB, hMax)
    if (la <= 0 && lb <= 0) {
      prims.push({ kind: 'line', x1: xa, y1: y, x2: xb, y2: y, layer: 'ARMADURA' })
      return
    }
    const points = []
    if (la > 0) points.push({ x: xa, y: y + dir * la })
    points.push({ x: xa, y }, { x: xb, y })
    if (lb > 0) points.push({ x: xb, y: y + dir * lb })
    prims.push({ kind: 'polyline', points, closed: false, layer: 'ARMADURA' })
  }

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

    // ---- armadura positiva: 0,08 m acima do fundo, centrada no vão,
    //      ganchos VERTICAIS p/ cima nas pontas extremas da viga ----
    const pos = s.positive
    if (pos.n > 0) {
      const legS = pos.legStart ?? 0
      const legE = pos.legEnd ?? 0
      const run = Math.max(pos.length - legS - legE, 0.1)
      bar(mid - run / 2, mid + run / 2, 0.08, legS, legE, 1, h - 0.16)
      // marcas de emenda por traspasse (peça comercial ≤ 12 m)
      const nSp = pos.splices ?? 0
      for (let j = 1; j <= nSp; j++) {
        const x = mid - run / 2 + (run * j) / (nSp + 1)
        prims.push({ kind: 'line', x1: x - 0.06, y1: 0.03, x2: x - 0.06, y2: 0.13, layer: 'ARMADURA' })
        prims.push({ kind: 'line', x1: x + 0.06, y1: 0.03, x2: x + 0.06, y2: 0.13, layer: 'ARMADURA' })
      }
      const spliceTxt =
        nSp > 0 && pos.spliceLap
          ? ` (${nSp} em. l0t=${Math.round(pos.spliceLap * 100)})`
          : ''
      prims.push({
        kind: 'text',
        x: mid,
        y: -0.5,
        text: barLabel(pos.n, pos.phi, pos.length, pos.pos) + spliceTxt,
        height: 0.12,
        layer: 'ARMADURA',
        align: 'center',
      })
    }

    // ---- negativas: 0,08 m abaixo do topo, cavalgando os apoios, com
    //      pernas p/ baixo; no apoio interno os negativos dos dois vãos
    //      coexistem → pequeno escalonamento vertical ----
    /** negativo com grupo escalonado opcional (barra mais curta logo abaixo) */
    const negDraw = (
      f: NonNullable<BeamDetailSpan['negLeft']>,
      xc: number,
      yBar: number,
      yTxt: number,
    ): void => {
      const leg = f.leg ?? 0
      const run = Math.max(f.length - 2 * leg, 0.1)
      bar(xc - run / 2, xc + run / 2, yBar, leg, leg, -1, yBar - 0.08)
      let label = barLabel(f.n, f.phi, f.length, f.pos)
      if (f.cut) {
        const runC = Math.max(f.cut.length - 2 * leg, 0.1)
        bar(xc - runC / 2, xc + runC / 2, yBar - 0.07, leg, leg, -1, yBar - 0.15)
        label += ` + ${barLabel(f.cut.n, f.phi, f.cut.length, f.cut.pos)}`
      }
      prims.push({
        kind: 'text',
        x: xc,
        y: yTxt,
        text: label,
        height: 0.12,
        layer: 'ARMADURA',
        align: 'center',
      })
    }
    if (s.negLeft) negDraw(s.negLeft, x0, h - 0.08, h + 0.1)
    if (s.negRight) {
      const shared = i + 1 < segs.length && segs[i + 1].s.negLeft !== null
      negDraw(s.negRight, x1, shared ? h - 0.16 : h - 0.08, shared ? h + 0.3 : h + 0.1)
    }

    // ---- estribos: distribuição REAL (todos os traços, passo s) ----
    const st = s.stirrup
    const step = Math.max(st.spacing, 0.03)
    const xs0 = x0 + 0.05
    const xs1 = x1 - 0.05
    const nDraw = Math.max(2, Math.min(st.count, Math.floor((xs1 - xs0) / step) + 1))
    for (let j = 0; j < nDraw; j++) {
      const x = Math.min(xs0 + j * step, xs1)
      prims.push({ kind: 'line', x1: x, y1: 0.05, x2: x, y2: h - 0.05, layer: 'ESTRIBOS' })
    }
    prims.push({
      kind: 'text',
      x: mid,
      y: h + 0.5,
      text: `${st.pos ? `N${st.pos} ` : ''}${st.count}×φ${mmTxt(st.phi)} c/${Math.round(st.spacing * 100)}`,
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
      height: 0.16,
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

  // ---- QUADRO DE FERROS (posições do detalhamento desta viga) ----
  if (steelItems && steelItems.length > 0) {
    const rows = [...steelItems].sort((a, b) => a.pos - b.pos)
    const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',')
    const cols = [0.7, 0.9, 1.0, 1.4, 1.4, 1.2] // larguras das colunas, m
    const header = ['POS', 'φ (mm)', 'QUANT.', 'C.UNIT (cm)', 'C.TOTAL (m)', 'PESO (kg)']
    const rowH = 0.3
    const tx = b0.minX
    const ty = b0.minY - 1.1 // topo da grade (título do quadro logo acima)
    const totalW = cols.reduce((s, w) => s + w, 0)
    const nRows = rows.length + 2 // cabeçalho + linhas + total
    prims.push({
      kind: 'text',
      x: tx,
      y: ty + 0.1,
      text: 'QUADRO DE FERROS',
      height: 0.16,
      layer: 'TEXTOS',
    })
    for (let r = 0; r <= nRows; r++) {
      prims.push({
        kind: 'line',
        x1: tx,
        y1: ty - r * rowH,
        x2: tx + totalW,
        y2: ty - r * rowH,
        layer: 'CONTORNO',
      })
    }
    let vx = tx
    for (let c = 0; c <= cols.length; c++) {
      prims.push({
        kind: 'line',
        x1: vx,
        y1: ty,
        x2: vx,
        y2: ty - nRows * rowH,
        layer: 'CONTORNO',
      })
      if (c < cols.length) vx += cols[c]
    }
    const cell = (col: number, row: number, text: string): void => {
      const x = tx + cols.slice(0, col).reduce((s, w) => s + w, 0) + cols[col] / 2
      prims.push({
        kind: 'text',
        x,
        y: ty - (row + 1) * rowH + 0.09,
        text,
        height: 0.12,
        layer: 'TEXTOS',
        align: 'center',
      })
    }
    header.forEach((t, c) => cell(c, 0, t))
    rows.forEach((it, r) => {
      cell(0, r + 1, `N${it.pos}`)
      cell(1, r + 1, mmTxt(it.phi))
      cell(2, r + 1, String(it.n))
      cell(3, r + 1, String(Math.round(it.unitLength * 100)))
      cell(4, r + 1, fmt1(it.totalLength))
      cell(5, r + 1, fmt1(it.kg))
    })
    cell(0, rows.length + 1, 'TOTAL')
    cell(5, rows.length + 1, fmt1(rows.reduce((s, it) => s + it.kg, 0)))
    prims.push({
      kind: 'text',
      x: tx,
      y: ty - nRows * rowH - 0.28,
      text: 'Quantidades somam os pavimentos que repetem a planta.',
      height: 0.11,
      layer: 'TEXTOS',
    })
  }

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
