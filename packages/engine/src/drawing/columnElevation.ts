import type { Project } from '../model/types'
import type { ColumnDetailInfo } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'
import { columnSectionInfo } from '../model/columnSection'
import { concreteProps, fyd as fydOf } from '../nbr/nbr6118/materials'
import { designCorbel } from '../nbr/nbr6118/deepBeam'

/**
 * PILAR EXECUTIVO — ELEVAÇÃO: arranques da fundação, emendas por TRASPASSE em
 * cada pavimento (§9.5.2 — comprimento adotado = lb, a favor da segurança p/
 * emenda comprimida), estribos na distribuição real por tramo, cotas de nível
 * e pé-direito, seção transversal com as barras e QUADRO DE FERROS do pilar.
 */
export function buildColumnElevationDrawing(
  project: Project,
  det: ColumnDetailInfo,
): Drawing {
  const prims: DrawingPrimitive[] = []
  const title = `PILAR ${det.name} — ELEVAÇÃO`
  const col = project.columns.find((c) => c.id === det.columnId)
  if (!col) return { title, primitives: prims, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }

  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const iBase = Math.max(0, levels.findIndex((l) => l.id === col.baseLevelId))
  const info = columnSectionInfo(col.section)
  const wEl = Math.max(info.bu, info.bv) // largura da elevação
  const half = wEl / 2
  const barX = half - 0.05 // face da barra na elevação
  const lap = det.lapLength
  const phi = det.barsPhi
  const mm = Math.round(phi * 10000) / 10
  const phiTxt = mm % 1 === 0 ? mm.toFixed(0) : String(mm).replace('.', ',')
  const smm = Math.round(det.stirrupPhi * 10000) / 10
  const stirrupPhiTxt = smm % 1 === 0 ? smm.toFixed(0) : String(smm).replace('.', ',')

  const z0 = levels[iBase].elevation
  const nT = det.storyHeights.length
  const zAt = (i: number): number =>
    z0 + det.storyHeights.slice(0, i).reduce((s, h) => s + h, 0)
  const zTop = zAt(nT)

  // ---- fundação (esquemática) + arranques ----
  const fndH = 0.5
  prims.push({
    kind: 'polyline',
    points: [
      { x: -half - 0.35, y: z0 },
      { x: half + 0.35, y: z0 },
      { x: half + 0.35, y: z0 - fndH },
      { x: -half - 0.35, y: z0 - fndH },
    ],
    closed: true,
    layer: 'CONTORNO',
  })
  for (const sx of [-1, 1]) {
    prims.push({
      kind: 'polyline',
      points: [
        { x: sx * (barX - 0.03) - sx * 0.12, y: z0 - fndH + 0.08 },
        { x: sx * (barX - 0.03), y: z0 - fndH + 0.08 },
        { x: sx * (barX - 0.03), y: z0 + lap },
      ],
      closed: false,
      layer: 'ARMADURA',
    })
  }
  prims.push({
    kind: 'text',
    x: half + 0.5,
    y: z0 + lap / 2,
    text: `ARRANQUES ${det.barsN} φ ${phiTxt} — l0 = ${Math.round(lap * 100)} cm acima da fundação (gancho no fundo)`,
    height: 0.13,
    layer: 'TEXTOS',
  })

  // ---- tramos ----
  for (let i = 0; i < nT; i++) {
    const zb = zAt(i)
    const zt = zAt(i + 1)
    // contorno do tramo
    prims.push({
      kind: 'polyline',
      points: [
        { x: -half, y: zb },
        { x: half, y: zb },
        { x: half, y: zt },
        { x: -half, y: zt },
      ],
      closed: true,
      layer: 'PILARES',
    })
    // linha do pavimento
    prims.push({ kind: 'line', x1: -half - 0.6, y1: zt, x2: half + 0.6, y2: zt, layer: 'EIXOS', dashed: true })
    const lvl = levels[iBase + i + 1]
    prims.push({
      kind: 'text',
      x: -half - 0.65,
      y: zt + 0.05,
      text: `${lvl?.name ?? ''} (${zt.toFixed(2).replace('.', ',')})`,
      height: 0.12,
      layer: 'TEXTOS',
      align: 'right',
    })
    // cota do pé-direito
    prims.push({ kind: 'line', x1: -half - 0.45, y1: zb, x2: -half - 0.45, y2: zt, layer: 'COTAS' })
    prims.push({
      kind: 'text',
      x: -half - 0.5,
      y: (zb + zt) / 2,
      text: `${Math.round(det.storyHeights[i] * 100)}`,
      height: 0.12,
      layer: 'COTAS',
      align: 'right',
      rotation: 90,
    })

    // barras do tramo: sobem do nível i até o nível i+1 + traspasse (último: topo)
    const isLast = i === nT - 1
    const yEnd = isLast ? zt - 0.04 : zt + lap
    for (const sx of [-1, 1]) {
      const x = sx * barX + (i % 2 === 0 ? 0 : sx * -0.018) // alterna p/ visual da emenda
      prims.push({
        kind: 'polyline',
        points: [
          { x, y: zb },
          { x, y: yEnd },
        ],
        closed: false,
        layer: 'ARMADURA',
      })
      if (isLast) {
        // gancho horizontal no topo (10φ)
        prims.push({
          kind: 'polyline',
          points: [
            { x, y: yEnd },
            { x: x - sx * Math.min(10 * phi, half), y: yEnd },
          ],
          closed: false,
          layer: 'ARMADURA',
        })
      }
    }
    if (!isLast) {
      prims.push({
        kind: 'text',
        x: half + 0.5,
        y: zt + lap / 2,
        text: `traspasse ${Math.round(lap * 100)} cm (§9.5.2)`,
        height: 0.12,
        layer: 'TEXTOS',
      })
    }

    // estribos do tramo
    const s = det.stirrupSpacing
    const nSt = Math.max(2, Math.ceil(det.storyHeights[i] / s))
    for (let k = 0; k <= nSt; k++) {
      const y = Math.min(zb + 0.05 + k * s, zt - 0.05)
      prims.push({ kind: 'line', x1: -barX, y1: y, x2: barX, y2: y, layer: 'ESTRIBOS' })
      if (y >= zt - 0.05) break
    }
    prims.push({
      kind: 'text',
      x: half + 0.1,
      y: (zb + zt) / 2,
      text: `TRAMO ${i + 1}: ${det.barsN} φ ${phiTxt} · estr. φ ${stirrupPhiTxt} c/ ${Math.round(s * 100)} (${nSt} un.)`,
      height: 0.13,
      layer: 'TEXTOS',
    })
  }

  // ---- consolos (§22.5): caixa na face + verificação ----
  const cpC = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydC = fydOf(project.settings.steel)
  for (const cb of col.corbels ?? []) {
    const lvl = project.levels.find((l) => l.id === cb.levelId)
    if (!lvl) continue
    const sideC = cb.rotationDeg === 0 || cb.rotationDeg === 90 ? 1 : -1
    const proj = cb.a + 0.15
    const hC = cb.d + 0.05
    const x0 = sideC * half
    const x1 = sideC * (half + proj)
    const zT = lvl.elevation
    prims.push({
      kind: 'polyline',
      points: [
        { x: x0, y: zT },
        { x: x1, y: zT },
        { x: x1, y: zT - 0.55 * hC },
        { x: x0, y: zT - hC },
      ],
      closed: false,
      layer: 'PILARES',
    })
    // tirante no topo (barra horizontal ancorada com alça)
    prims.push({
      kind: 'polyline',
      points: [
        { x: sideC * (half - 0.1), y: zT - 0.06 },
        { x: x1 - sideC * 0.04, y: zT - 0.06 },
        { x: x1 - sideC * 0.04, y: zT - 0.2 },
      ],
      closed: false,
      layer: 'ARMADURA',
    })
    const r = designCorbel({
      fd: cb.fd,
      a: cb.a,
      d: cb.d,
      bw: cb.bw,
      hd: cb.hd,
      fck: cpC.fck,
      fcd: cpC.fcd,
      fyd: fydC,
    })
    prims.push({
      kind: 'text',
      x: x1 + sideC * 0.15,
      y: zT - hC / 2,
      text: `CONSOLO ${Math.round(cb.bw * 100)}×${Math.round((cb.d + 0.05) * 100)} · a=${Math.round(cb.a * 100)} · Fd=${cb.fd.toFixed(0)} kN — tirante ${(r.asTie * 1e4).toFixed(1)} cm² + costura ${(r.asStitch * 1e4).toFixed(1)} cm² (${r.kind}, §22.5)${r.ok ? '' : ' — BIELA FALHA'}`,
      height: 0.12,
      layer: 'TEXTOS',
      align: sideC > 0 ? 'left' : 'right',
    })
  }

  // ---- seção transversal (escala real) à direita ----
  const secX = half + 3.2
  const secY = z0 + Math.max(1.2, (zTop - z0) * 0.15)
  if (info.kind === 'circle') {
    prims.push({ kind: 'circle', cx: secX, cy: secY, r: info.bu / 2, layer: 'PILARES' })
  } else {
    prims.push({
      kind: 'polyline',
      points: info.polygon.map((p) => ({ x: secX + p.x, y: secY + p.y })),
      closed: true,
      layer: 'PILARES',
    })
  }
  for (const b of det.barPositions) {
    prims.push({ kind: 'circle', cx: secX + b.x, cy: secY + b.y, r: Math.max(phi / 2, 0.008), layer: 'ARMADURA' })
  }
  prims.push({
    kind: 'text',
    x: secX,
    y: secY - Math.max(info.bu, info.bv) / 2 - 0.18,
    text: `SEÇÃO ${det.sectionLabel} — ${det.barsN} φ ${phiTxt} · estr. φ ${stirrupPhiTxt} c/ ${Math.round(det.stirrupSpacing * 100)}`,
    height: 0.14,
    layer: 'TEXTOS',
    align: 'center',
  })

  // ---- quadro de ferros do pilar ----
  const rho = 7850 // kg/m³
  const aBar = (Math.PI * phi * phi) / 4
  const aSt = (Math.PI * det.stirrupPhi * det.stirrupPhi) / 4
  let ty = z0 - fndH - 0.5
  prims.push({ kind: 'text', x: -half - 0.6, y: ty, text: `QUADRO DE FERROS — PILAR ${det.name}`, height: 0.16, layer: 'TEXTOS' })
  let totalKg = 0
  const stirrupPerimTxt = () => {
    // comprimento unitário estimado do estribo: perímetro − 2·cobrimento + gancho
    const per = info.kind === 'circle' ? Math.PI * (info.bu - 0.05) : 2 * (info.bu + info.bv) - 8 * 0.025
    return per + 0.15
  }
  for (let i = 0; i < nT; i++) {
    const len = det.storyHeights[i] + (i === nT - 1 ? 0 : lap)
    const kgL = det.barsN * len * aBar * rho
    const nSt = Math.max(2, Math.ceil(det.storyHeights[i] / det.stirrupSpacing))
    const su = stirrupPerimTxt()
    const kgS = nSt * su * aSt * rho
    totalKg += kgL + kgS
    ty -= 0.28
    prims.push({
      kind: 'text',
      x: -half - 0.6,
      y: ty,
      text: `T${i + 1}: ${det.barsN} φ ${phiTxt} × C=${Math.round(len * 100)} (${kgL.toFixed(1)} kg) · ${nSt} estr. φ ${stirrupPhiTxt} × C=${Math.round(su * 100)} (${kgS.toFixed(1)} kg)`,
      height: 0.13,
      layer: 'TEXTOS',
    })
  }
  const kgArr = det.barsN * (lap + 0.6 + 0.2) * aBar * rho
  totalKg += kgArr
  ty -= 0.28
  prims.push({
    kind: 'text',
    x: -half - 0.6,
    y: ty,
    text: `Arranques: ${det.barsN} φ ${phiTxt} × C=${Math.round((lap + 0.6 + 0.2) * 100)} (${kgArr.toFixed(1)} kg) — embutir na fundação c/ gancho`,
    height: 0.13,
    layer: 'TEXTOS',
  })
  ty -= 0.3
  prims.push({
    kind: 'text',
    x: -half - 0.6,
    y: ty,
    text: `TOTAL ≈ ${totalKg.toFixed(1)} kg (sem perdas) — traspasse comprimido adotado = lb (§9.5.2, a favor da segurança); emendar fora de regiões de máximo momento.`,
    height: 0.13,
    layer: 'TEXTOS',
  })

  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 0.8) }
}
