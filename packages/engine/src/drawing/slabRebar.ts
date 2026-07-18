import type { Project, Slab, Vec2 } from '../model/types'
import type { SlabDesignResultItem } from '../analysis/types'
import type { Drawing, DrawingPrimitive } from './types'
import { boundsOfPrimitives } from './formwork'
import { polygonCentroid } from '../geometry/geometry'

/**
 * ARMAÇÃO DE LAJES EM PLANTA (executiva, prática usual de escritório):
 *  - POSITIVA (face inferior): uma barra representativa por direção dentro de
 *    cada laje, com a malha do dimensionamento (φ c/ s) e o comprimento do vão;
 *  - NEGATIVA (face superior): sobre CADA apoio contínuo entre lajes vizinhas
 *    (bordas coincidentes), estendendo 0,25·ℓ p/ cada lado do eixo (ℓ = vão
 *    perpendicular de cada laje) — detalhe clássico NBR 6118/prática.
 * Fonte das armaduras: Marcus (spanSpec/supportSpec por direção), nervurada
 * (barras por nervura + negativa na capa) e grelha (malhas X/Y ± superiores).
 */

interface SlabInfo {
  slab: Slab
  item: SlabDesignResultItem
  /** direção dos ferros da faixa A = paralela à 1ª borda do polígono */
  uA: Vec2
  centroid: Vec2
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}
const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x })
const cmTxt = (m: number): string => String(Math.round(m * 100))

/** extensão do polígono na direção u (largura projetada), m */
function extentAlong(poly: Vec2[], u: Vec2): number {
  const ts = poly.map((p) => p.x * u.x + p.y * u.y)
  return Math.max(...ts) - Math.min(...ts)
}

/** specs de vão/apoio da direção que corre ao longo de u (barras ∥ u) */
function dirSpecs(
  info: SlabInfo,
  u: Vec2,
): { span: string; support: string; asSupport: number } {
  const it = info.item
  // barras ∥ u pertencem à faixa A se u ∥ uA (grelha usa eixos globais X/Y)
  if (it.gridDesign) {
    const g = it.gridDesign
    const alongX = Math.abs(u.x) >= Math.abs(u.y)
    return alongX
      ? { span: g.specX, support: g.specXSup, asSupport: g.asXSup }
      : { span: g.specY, support: g.specYSup, asSupport: g.asYSup }
  }
  const isA = Math.abs(u.x * info.uA.x + u.y * info.uA.y) >= 0.7
  if (it.ribbedDesign) {
    const d = isA ? it.ribbedDesign.dirA : it.ribbedDesign.dirB
    return { span: `${d.ribBars} /nerv.`, support: d.supportSpec, asSupport: d.asSupportPerM }
  }
  if (it.design) {
    const d = isA ? it.design.dirA : it.design.dirB
    return { span: d.spanSpec, support: d.supportSpec, asSupport: d.asSupport }
  }
  return { span: '—', support: '—', asSupport: 0 }
}

/** barra com ganchos (ticks) nas pontas, ∥ u, centrada em c */
function barPrims(
  c: Vec2,
  u: Vec2,
  len: number,
  hook: number,
  hookSign: 1 | -1,
): DrawingPrimitive[] {
  const n = perp(u)
  const a = { x: c.x - (u.x * len) / 2, y: c.y - (u.y * len) / 2 }
  const b = { x: c.x + (u.x * len) / 2, y: c.y + (u.y * len) / 2 }
  const ha = { x: a.x + n.x * hook * hookSign, y: a.y + n.y * hook * hookSign }
  const hb = { x: b.x + n.x * hook * hookSign, y: b.y + n.y * hook * hookSign }
  return [
    { kind: 'polyline', points: [ha, a, b, hb], closed: false, layer: 'ARMADURA' },
  ]
}

export function buildSlabRebarDrawing(
  project: Project,
  planId: string,
  slabDesign: SlabDesignResultItem[],
): Drawing {
  const plan = project.plans.find((p) => p.id === planId)
  const title = `ARMAÇÃO DE LAJES — ${plan?.name ?? '?'}`
  const prims: DrawingPrimitive[] = []
  if (!plan) return { title, primitives: prims, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }

  // eixos das vigas (contexto)
  for (const beam of plan.beams) {
    prims.push({ kind: 'polyline', points: beam.path, closed: false, layer: 'VIGAS' })
  }

  const infos: SlabInfo[] = []
  for (const slab of plan.slabs) {
    const item = slabDesign.find((d) => d.slabId === slab.id)
    prims.push({ kind: 'polyline', points: slab.polygon, closed: true, layer: 'LAJES' })
    if (!item) continue
    const uA = unit({
      x: slab.polygon[1].x - slab.polygon[0].x,
      y: slab.polygon[1].y - slab.polygon[0].y,
    })
    infos.push({ slab, item, uA, centroid: polygonCentroid(slab.polygon) })
  }

  // ---- positivas: uma barra representativa por direção ----
  for (const info of infos) {
    const { slab, item, centroid } = info
    const uA = item.gridDesign ? { x: 1, y: 0 } : info.uA
    const uB = perp(uA)
    const extA = extentAlong(slab.polygon, uA)
    const extB = extentAlong(slab.polygon, uB)
    const angA = (Math.atan2(uA.y, uA.x) * 180) / Math.PI

    prims.push({
      kind: 'text',
      x: centroid.x,
      y: centroid.y + extB * 0.34,
      text: `${slab.name} h=${cmTxt(slab.thickness)}${item.kind === 'nervurada' ? ' (nerv.)' : ''}`,
      height: 0.16,
      layer: 'TEXTOS',
      align: 'center',
    })

    const specA = dirSpecs(info, uA)
    const specB = dirSpecs(info, uB)
    const offA = { x: centroid.x - uB.x * extB * 0.16, y: centroid.y - uB.y * extB * 0.16 }
    const offB = { x: centroid.x + uA.x * extA * 0.16, y: centroid.y + uA.y * extA * 0.16 }

    if (specA.span !== '—') {
      prims.push(...barPrims(offA, uA, extA * 0.62, 0.1, 1))
      prims.push({
        kind: 'text',
        x: offA.x - uB.x * 0.16,
        y: offA.y - uB.y * 0.16,
        text: `inf. ${specA.span} · L≈${cmTxt(extA * 0.94)}`,
        height: 0.12,
        layer: 'TEXTOS',
        align: 'center',
        rotation: angA,
      })
    }
    if (specB.span !== '—') {
      prims.push(...barPrims(offB, uB, extB * 0.62, 0.1, 1))
      prims.push({
        kind: 'text',
        x: offB.x + uA.x * 0.16,
        y: offB.y + uA.y * 0.16,
        text: `inf. ${specB.span} · L≈${cmTxt(extB * 0.94)}`,
        height: 0.12,
        layer: 'TEXTOS',
        align: 'center',
        rotation: angA + 90,
      })
    }
  }

  // ---- negativas: bordas coincidentes entre lajes vizinhas ----
  const TOL = 0.03
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const s1 = infos[i]
      const s2 = infos[j]
      const p1 = s1.slab.polygon
      const p2 = s2.slab.polygon
      for (let e1 = 0; e1 < p1.length; e1++) {
        const a = p1[e1]
        const b = p1[(e1 + 1) % p1.length]
        const eDir = unit({ x: b.x - a.x, y: b.y - a.y })
        const eLen = Math.hypot(b.x - a.x, b.y - a.y)
        if (eLen < 0.2) continue
        for (let e2 = 0; e2 < p2.length; e2++) {
          const r = p2[e2]
          const q = p2[(e2 + 1) % p2.length]
          // colinearidade: r e q na reta (a,b)
          const dist = (p: Vec2) =>
            Math.abs((p.x - a.x) * -eDir.y + (p.y - a.y) * eDir.x)
          if (dist(r) > TOL || dist(q) > TOL) continue
          // sobreposição dos intervalos projetados
          const t = (p: Vec2) => (p.x - a.x) * eDir.x + (p.y - a.y) * eDir.y
          const lo = Math.max(Math.min(t(r), t(q)), 0)
          const hi = Math.min(Math.max(t(r), t(q)), eLen)
          if (hi - lo < 0.25) continue

          const mid = {
            x: a.x + eDir.x * ((lo + hi) / 2),
            y: a.y + eDir.y * ((lo + hi) / 2),
          }
          const n = perp(eDir)
          // vão perpendicular de cada laje e lado em que ela está
          const l1 = extentAlong(p1, n)
          const l2 = extentAlong(p2, n)
          const side1 =
            (s1.centroid.x - mid.x) * n.x + (s1.centroid.y - mid.y) * n.y >= 0 ? 1 : -1
          const sp1 = dirSpecs(s1, n)
          const sp2 = dirSpecs(s2, n)
          let spec = sp1.asSupport >= sp2.asSupport ? sp1.support : sp2.support
          if (spec === '—') spec = sp1.support !== '—' ? sp1.support : sp2.support
          if (spec === '—') continue // sem negativa (ambas biapoiadas no método)

          const ext1 = 0.25 * l1 * side1
          const ext2 = 0.25 * l2 * -side1
          const pA = { x: mid.x + n.x * ext1, y: mid.y + n.y * ext1 }
          const pB = { x: mid.x + n.x * ext2, y: mid.y + n.y * ext2 }
          const hook = 0.12
          prims.push({
            kind: 'polyline',
            points: [
              { x: pA.x - eDir.x * hook, y: pA.y - eDir.y * hook },
              pA,
              pB,
              { x: pB.x - eDir.x * hook, y: pB.y - eDir.y * hook },
            ],
            closed: false,
            layer: 'ARMADURA',
          })
          prims.push({
            kind: 'text',
            x: mid.x + eDir.x * 0.2,
            y: mid.y + eDir.y * 0.2,
            text: `sup. ${spec} · 0,25·ℓ`,
            height: 0.12,
            layer: 'TEXTOS',
            rotation: (Math.atan2(n.y, n.x) * 180) / Math.PI,
          })
        }
      }
    }
  }

  const b0 = boundsOfPrimitives(prims, 0)
  const notes = [
    `${title} — armadura POSITIVA na face inferior (barra representativa por direção; distribuir no vão inteiro com o passo indicado);`,
    'NEGATIVA na face superior sobre apoios contínuos, estendendo 0,25·ℓ p/ cada lado do eixo (ℓ = vão perpendicular de cada laje);',
    'ganchos/ancoragem conforme §9.4; emendas fora das seções de máximo momento; L≈ indica comprimento aproximado — conferir na obra.',
  ]
  notes.forEach((t, i) => {
    prims.push({
      kind: 'text',
      x: b0.minX,
      y: b0.minY - 0.5 - i * 0.3,
      text: t,
      height: 0.16,
      layer: 'TEXTOS',
    })
  })
  return { title, primitives: prims, bounds: boundsOfPrimitives(prims, 1) }
}
