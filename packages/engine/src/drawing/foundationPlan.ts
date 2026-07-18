import type { Project } from '../model/types'
import type { FoundationResultItem } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'
import { foundationShape } from '../design/foundationGeometry'
import { columnSectionInfo } from '../model/columnSection'

/**
 * PLANTA DE FUNDAÇÕES: locação (eixos com bulbos), pilares, contorno de cada
 * fundação (sapata/bloco/tubulão) com estacas, nome (S/B/T + nº do pilar),
 * dimensões em cm, cota de assentamento quando informada e tabela-resumo.
 * Coordenadas em metros, y p/ cima.
 */
export function buildFoundationPlanDrawing(
  project: Project,
  foundations: FoundationResultItem[],
): Drawing {
  const prims: DrawingPrimitive[] = []
  const title = 'PLANTA DE FUNDAÇÕES'
  const byId = new Map(project.columns.map((c) => [c.id, c]))

  // ---- eixos com bulbos ----
  const xs = [...project.grid.xAxes].sort((a, b) => a.pos - b.pos)
  const ys = [...project.grid.yAxes].sort((a, b) => a.pos - b.pos)
  const minX = Math.min(...xs.map((a) => a.pos), ...project.columns.map((c) => c.pos.x)) - 1.6
  const maxX = Math.max(...xs.map((a) => a.pos), ...project.columns.map((c) => c.pos.x)) + 1.6
  const minY = Math.min(...ys.map((a) => a.pos), ...project.columns.map((c) => c.pos.y)) - 1.6
  const maxY = Math.max(...ys.map((a) => a.pos), ...project.columns.map((c) => c.pos.y)) + 1.6
  for (const ax of xs) {
    prims.push({ kind: 'line', x1: ax.pos, y1: minY, x2: ax.pos, y2: maxY, layer: 'EIXOS', dashed: true })
    prims.push({ kind: 'circle', cx: ax.pos, cy: maxY + 0.35, r: 0.3, layer: 'EIXOS' })
    prims.push({ kind: 'text', x: ax.pos, y: maxY + 0.25, text: ax.label, height: 0.28, layer: 'EIXOS', align: 'center' })
  }
  for (const ax of ys) {
    prims.push({ kind: 'line', x1: minX, y1: ax.pos, x2: maxX, y2: ax.pos, layer: 'EIXOS', dashed: true })
    prims.push({ kind: 'circle', cx: minX - 0.35, cy: ax.pos, r: 0.3, layer: 'EIXOS' })
    prims.push({ kind: 'text', x: minX - 0.35, y: ax.pos - 0.1, text: ax.label, height: 0.28, layer: 'EIXOS', align: 'center' })
  }

  // ---- pilares + fundações ----
  const PREFIX = { sapata: 'S', bloco: 'B', tubulao: 'T' } as const
  const rows: string[][] = []
  for (const item of foundations) {
    const col = byId.get(item.columnId)
    if (!col) continue
    const shape = foundationShape(item, col)
    if (!shape) continue

    // pilar (retângulo/círculo da seção)
    const info = columnSectionInfo(col.section)
    const alongX = col.rotationDeg === 0 || col.rotationDeg === 180
    const hx = (alongX ? info.bv : info.bu) / 2
    const hy = (alongX ? info.bu : info.bv) / 2
    prims.push({
      kind: 'polyline',
      points: [
        { x: col.pos.x - hx, y: col.pos.y - hy },
        { x: col.pos.x + hx, y: col.pos.y - hy },
        { x: col.pos.x + hx, y: col.pos.y + hy },
        { x: col.pos.x - hx, y: col.pos.y + hy },
      ],
      closed: true,
      layer: 'PILARES',
    })

    if (shape.polygon) {
      prims.push({ kind: 'polyline', points: shape.polygon, closed: true, layer: 'CONTORNO' })
    }
    for (const c of shape.circles) {
      prims.push({ kind: 'circle', cx: c.c.x, cy: c.c.y, r: c.r, layer: 'CONTORNO' })
    }

    const fname = `${PREFIX[item.kind]}${col.name.replace(/^\D+/, '')}`
    const label = `${fname} ${shape.dims}`
    const yTxt = shape.polygon
      ? Math.min(...shape.polygon.map((p) => p.y)) - 0.18
      : shape.center.y - Math.max(...shape.circles.map((c) => c.r)) - 0.18
    prims.push({ kind: 'text', x: shape.center.x, y: yTxt, text: label, height: 0.16, layer: 'TEXTOS', align: 'center' })
    if (item.depth) {
      prims.push({
        kind: 'text',
        x: shape.center.x,
        y: yTxt - 0.24,
        text: `ass. −${item.depth.toFixed(2).replace('.', ',')} m`,
        height: 0.13,
        layer: 'TEXTOS',
        align: 'center',
      })
    }

    const detail =
      item.kind === 'sapata' && item.footing
        ? `h=${Math.round(item.footing.h * 100)} · σmáx=${item.footing.sigmaMax.toFixed(0)} kPa`
        : item.kind === 'bloco' && item.pileCap
          ? `${item.pileCap.nPiles} est. ø${Math.round(item.pileCap.pileDiameter * 100)} · ${item.pileCap.pileLoad.toFixed(0)} kN/est.`
          : item.caisson
            ? `fuste ø${Math.round(item.caisson.shaftD * 100)} · base ø${Math.round(item.caisson.baseD * 100)}`
            : ''
    rows.push([fname, col.name, shape.dims, detail, item.manual ? 'manual' : 'auto', item.status])
  }

  // ---- tabela-resumo à direita ----
  const tx = maxX + 1.6
  let ty = maxY
  prims.push({ kind: 'text', x: tx, y: ty, text: 'RESUMO DAS FUNDAÇÕES', height: 0.24, layer: 'TEXTOS' })
  ty -= 0.42
  prims.push({ kind: 'text', x: tx, y: ty, text: 'Fund.  Pilar  Dimensões  Detalhe  Origem  Status', height: 0.15, layer: 'TEXTOS' })
  for (const r of rows) {
    ty -= 0.3
    prims.push({ kind: 'text', x: tx, y: ty, text: r.join('   '), height: 0.14, layer: 'TEXTOS' })
  }

  const b0 = boundsOfPrimitives(prims, 0)
  prims.push({
    kind: 'text',
    x: b0.minX,
    y: b0.minY - 0.6,
    text: `${title} — cotas em cm; assentamentos conforme indicado; verificar com sondagem (NBR 6122)`,
    height: 0.2,
    layer: 'TEXTOS',
  })
  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
