import type { Project } from '../model/types'
import type { FoundationResultItem } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'
import { foundationShape } from '../design/foundationGeometry'
import { columnSectionInfo } from '../model/columnSection'

/**
 * DETALHAMENTO DAS FUNDAÇÕES: uma célula por fundação (planta na escala real,
 * pilar, dimensões e ARMADURAS — malha da sapata, tirantes do bloco) + quadro
 * das vigas alavanca (seção, armadura superior, estribos, R1/alívio).
 */
export function buildFoundationDetailDrawing(
  project: Project,
  foundations: FoundationResultItem[],
): Drawing {
  const prims: DrawingPrimitive[] = []
  const title = 'DETALHAMENTO DAS FUNDAÇÕES'
  const byId = new Map(project.columns.map((c) => [c.id, c]))
  const PREFIX = { sapata: 'S', bloco: 'B', tubulao: 'T' } as const

  // tamanho da célula: maior fundação + margem p/ textos
  let maxExt = 1.5
  const shapes = foundations
    .map((it) => {
      const col = byId.get(it.columnId)
      if (!col) return null
      const s = foundationShape(it, col)
      if (!s) return null
      const ext = s.polygon
        ? Math.max(
            Math.max(...s.polygon.map((p) => p.x)) - Math.min(...s.polygon.map((p) => p.x)),
            Math.max(...s.polygon.map((p) => p.y)) - Math.min(...s.polygon.map((p) => p.y)),
          )
        : 2 * Math.max(...s.circles.map((c) => c.r))
      maxExt = Math.max(maxExt, ext)
      return { it, col, s }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const cellW = maxExt + 1.8
  const cellH = maxExt + 2.6
  const perRow = 4

  shapes.forEach(({ it, col, s }, idx) => {
    const cx = (idx % perRow) * cellW
    const cy = -Math.floor(idx / perRow) * cellH
    const dx = cx - s.center.x
    const dy = cy - s.center.y

    if (s.polygon) {
      prims.push({
        kind: 'polyline',
        points: s.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        closed: true,
        layer: 'CONTORNO',
      })
    }
    for (const c of s.circles) {
      prims.push({
        kind: 'circle',
        cx: c.c.x + dx,
        cy: c.c.y + dy,
        r: c.r,
        layer: 'CONTORNO',
      })
    }
    // pilar no centro da célula (offset aparece invertido: pilar fora do CG)
    const info = columnSectionInfo(col.section)
    const alongX = col.rotationDeg === 0 || col.rotationDeg === 180
    const hx = (alongX ? info.bv : info.bu) / 2
    const hy = (alongX ? info.bu : info.bv) / 2
    const pcx = col.pos.x + dx
    const pcy = col.pos.y + dy
    prims.push({
      kind: 'polyline',
      points: [
        { x: pcx - hx, y: pcy - hy },
        { x: pcx + hx, y: pcy - hy },
        { x: pcx + hx, y: pcy + hy },
        { x: pcx - hx, y: pcy + hy },
      ],
      closed: true,
      layer: 'PILARES',
    })

    const num = col.name.replace(/^\D+/, '')
    const fname = `${PREFIX[it.kind]}${num}`
    const lines: string[] = [`${fname} (${col.name}) — ${s.dims}${it.manual ? ' · manual' : ''}`]
    if (it.kind === 'sapata' && it.footing) {
      const f = it.footing
      lines.push(`h=${Math.round(f.h * 100)} cm · σmáx ${f.sigmaMax.toFixed(0)} kPa`)
      lines.push(`armadura dir. a: ${f.specA}`)
      lines.push(`armadura dir. b: ${f.specB}`)
    } else if (it.kind === 'bloco' && it.pileCap) {
      const pc = it.pileCap
      lines.push(
        `h=${Math.round(pc.h * 100)} cm · ${pc.nPiles} est. ø${Math.round(pc.pileDiameter * 100)} · ${pc.pileLoad.toFixed(0)} kN/est.`,
      )
      lines.push(`tirantes: ${pc.mainSpec} (por direção/lado)`)
    } else if (it.caisson) {
      lines.push(`fuste ø${Math.round(it.caisson.shaftD * 100)} · base ø${Math.round(it.caisson.baseD * 100)}`)
      lines.push('armadura do fuste conforme pilar (mín. §23)')
    }
    if (it.depth) lines.push(`assentamento −${it.depth.toFixed(2).replace('.', ',')} m`)
    if (it.strap) lines.push(`viga alavanca → ${it.strap.partnerName} (ver quadro VA)`)

    const yBase = cy - maxExt / 2 - 0.25
    lines.forEach((t, i) => {
      prims.push({
        kind: 'text',
        x: cx,
        y: yBase - i * 0.26,
        text: t,
        height: i === 0 ? 0.17 : 0.14,
        layer: 'TEXTOS',
        align: 'center',
      })
    })
  })

  // ---- quadro das vigas alavanca ----
  const straps = shapes.filter(({ it }) => it.strap)
  if (straps.length > 0) {
    const rows = Math.ceil(shapes.length / perRow)
    let ty = -rows * cellH - 0.6
    prims.push({
      kind: 'text',
      x: 0,
      y: ty,
      text: 'QUADRO — VIGAS ALAVANCA (armadura principal SUPERIOR, contínua até o pilar interno)',
      height: 0.2,
      layer: 'TEXTOS',
    })
    for (const { it, col } of straps) {
      const sb = it.strap!
      ty -= 0.34
      prims.push({
        kind: 'text',
        x: 0,
        y: ty,
        text: `VA ${col.name}–${sb.partnerName}: ${Math.round(sb.bw * 100)}×${Math.round(sb.h * 100)} · sup ${sb.topSpec} · estribos ${sb.stirrupSpec} · R1=${sb.r1.toFixed(0)} kN (e=${Math.round(sb.e * 100)} cm, alívio ${sb.relief.toFixed(0)} kN)`,
        height: 0.15,
        layer: 'TEXTOS',
      })
    }
  }

  const b0 = boundsOfPrimitives(prims, 0)
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.6,
    text: `${title} — cotas em cm; cobrimento 4 cm (contato c/ solo: 4,5 cm sobre lastro); verificar com sondagem (NBR 6122)`,
    height: 0.2,
    layer: 'TEXTOS',
  })
  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
