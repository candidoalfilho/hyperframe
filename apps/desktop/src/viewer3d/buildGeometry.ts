import {
  STAIR_DEFAULTS,
  TANK_DEFAULTS,
  columnFootprint,
  columnHalfExtents,
  pointInPolygon,
  slabOpeningPolygons,
  type Project,
  type Vec2,
} from '@hyperframe/engine'

/**
 * Geometria do edifício em instâncias simples (caixas + lajes + regiões:
 * escadas com degraus e reservatórios), já em coordenadas three.js
 * (y-up; mundo → three: [x, cota, -y]).
 */

export interface BoxInstance {
  key: string
  kind: 'column' | 'beam'
  /** id do elemento de modelagem (seleção destaca o elemento inteiro) */
  id: string
  /** índices de nível tocados — p/ "isolar pavimento ativo" */
  levels: number[]
  position: [number, number, number]
  rotationY: number
  /** [comprimento em x local, altura, largura] */
  size: [number, number, number]
  /** pilar circular: cilindro de diâmetro d (ignora size x/z) */
  round?: { d: number }
  /** pilar em L: prisma extrudado do contorno em planta (coords absolutas) */
  prism?: { polygon: Vec2[] }
  /**
   * furos na alma (vigas): retângulos no plano da elevação LOCAL do trecho —
   * x ao longo do eixo e y na altura, ambos a partir do CENTRO do box, m.
   * Presente ⇒ o box vira extrusão com holes em vez de boxGeometry.
   */
  webHoles?: { x: number; y: number; w: number; h: number }[]
}

export interface SlabInstance {
  key: string
  id: string
  levelIndex: number
  polygon: Vec2[]
  /** furos/aberturas (recortados pela laje) — viram holes na extrusão */
  holes: Vec2[][]
  thickness: number
  /** cota do topo da laje, m */
  elevation: number
}

export function buildBoxes(project: Project): BoxInstance[] {
  const boxes: BoxInstance[] = []
  const levelIdx = new Map<string, number>()
  project.levels.forEach((l, i) => levelIdx.set(l.id, i))

  // ---- pilares: um segmento por pé-direito entre níveis consecutivos ----
  for (const col of project.columns) {
    const i0 = levelIdx.get(col.baseLevelId) ?? 0
    const i1 = levelIdx.get(col.topLevelId) ?? project.levels.length - 1
    const { dx: hx, dy: hy } = columnHalfExtents(col)
    const isCircle = col.section.shape === 'circle'
    const isL = col.section.shape === 'L'
    // L: contorno absoluto em planta p/ extrusão
    const footprint = isL ? columnFootprint(col) : null
    for (let i = i0; i < i1; i++) {
      const zBot = project.levels[i].elevation
      const zTop = project.levels[i + 1].elevation
      const hStory = zTop - zBot
      if (hStory <= 1e-6) continue
      boxes.push({
        key: `col:${col.id}:${i}`,
        kind: 'column',
        id: col.id,
        levels: [i, i + 1],
        position: [col.pos.x, zBot + hStory / 2, -col.pos.y],
        rotationY: 0,
        size: [hx * 2, hStory, hy * 2],
        round: isCircle ? { d: hx * 2 } : undefined,
        prism: footprint ? { polygon: footprint } : undefined,
      })
    }
  }

  // ---- vigas: uma caixa por trecho da polilinha (seção do trecho) ----
  project.levels.forEach((level, li) => {
    if (!level.planId) return
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) return
    for (const beam of plan.beams) {
      let cum = 0 // distância acumulada — BeamOpening.x é medido desde o 1º vértice
      for (let s = 0; s + 1 < beam.path.length; s++) {
        const { bw, h } = beam.segmentSections?.[s] ?? beam.section
        const a = beam.path[s]
        const b = beam.path[s + 1]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy)
        if (len <= 1e-6) continue
        // furos na alma deste trecho (§13.2.5) — recorte real na elevação local
        const webHoles: { x: number; y: number; w: number; h: number }[] = []
        for (const op of beam.openings ?? []) {
          if (op.x < cum - 1e-9 || op.x > cum + len + 1e-9) continue
          const cx = op.x - cum - len / 2
          // clampa dentro do trecho/altura: furo mal posicionado não corrompe o mesh
          const x0 = Math.max(cx - op.width / 2, -len / 2 + 0.01)
          const x1 = Math.min(cx + op.width / 2, len / 2 - 0.01)
          const y0 = Math.max(op.yOffset - op.height / 2, -h / 2 + 0.01)
          const y1 = Math.min(op.yOffset + op.height / 2, h / 2 - 0.01)
          if (x1 - x0 > 0.005 && y1 - y0 > 0.005) {
            webHoles.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 })
          }
        }
        boxes.push({
          key: `bm:${level.id}:${beam.id}:${s}`,
          kind: 'beam',
          id: beam.id,
          levels: [li],
          position: [(a.x + b.x) / 2, level.elevation - h / 2, -(a.y + b.y) / 2],
          // eixo X local do box aponta p/ (cosθ, 0, -sinθ) em three ⇒ θ = atan2(dy, dx)
          rotationY: Math.atan2(dy, dx),
          size: [len, h, bw],
          webHoles: webHoles.length > 0 ? webHoles : undefined,
        })
        cum += len
      }
    }
  })

  return boxes
}

// ---------------------------------------------------------------------------
// regiões: escadas (lance com degraus + laje inclinada + patamar) e
// reservatórios (fundo + paredes + tampa)
// ---------------------------------------------------------------------------

export interface RegionSolidInstance {
  key: string
  /** id da LoadRegion (seleção sincronizada com a planta) */
  id: string
  regionKind: 'escada' | 'reservatorio'
  /** níveis tocados (escada liga o nível inferior ao nível da planta) */
  levels: number[]
  position: [number, number, number]
  rotationY: number
  /** inclinação da laje do lance (aplicada antes do yaw — ordem XYZ do three) */
  rotationZ: number
  size: [number, number, number]
}

export function buildRegionSolids(project: Project): RegionSolidInstance[] {
  const out: RegionSolidInstance[] = []
  const levels = project.levels

  levels.forEach((level, li) => {
    if (!level.planId) return
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) return

    for (const region of plan.loadRegions ?? []) {
      if (region.polygon.length < 3) continue
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of region.polygon) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      const dx = maxX - minX
      const dy = maxY - minY
      if (dx < 0.05 || dy < 0.05) continue
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2

      // -------------------------------------------------------------- escada
      if (region.kind === 'escada') {
        if (li === 0) continue
        const zTop = level.elevation
        const zBot = levels[li - 1].elevation
        const H = zTop - zBot
        if (H <= 0.1) continue

        const st = { ...STAIR_DEFAULTS, ...(region.stair ?? {}) }
        const alongX = dx >= dy
        const runLen = alongX ? dx : dy
        const width = alongX ? dy : dx
        // sobe do início ao fim do lado maior (reverse inverte)
        const dir: Vec2 = alongX
          ? { x: st.reverse ? -1 : 1, y: 0 }
          : { x: 0, y: st.reverse ? -1 : 1 }
        const start: Vec2 = {
          x: alongX ? (st.reverse ? maxX : minX) : cx,
          y: alongX ? cy : st.reverse ? maxY : minY,
        }
        const rotY = Math.atan2(dir.y, dir.x)

        const n = Math.max(3, Math.round(H / Math.max(st.riser, 0.12)))
        const e = H / n
        const runNeeded = n * st.tread
        const runUsed = Math.min(runNeeded, runLen)
        const pEff = runUsed / n

        // degraus (caixas de 1 espelho de altura sobre a linha inclinada)
        for (let k = 0; k < n; k++) {
          const s = (k + 0.5) * pEff
          out.push({
            key: `rg:${level.id}:${region.id}:st:${k}`,
            id: region.id,
            regionKind: 'escada',
            levels: [li - 1, li],
            position: [start.x + dir.x * s, zBot + k * e + e / 2, -(start.y + dir.y * s)],
            rotationY: rotY,
            rotationZ: 0,
            size: [pEff, e, width],
          })
        }

        // laje inclinada (mísula) sob os degraus
        const theta = Math.atan2(H, runUsed)
        const lIncl = Math.hypot(runUsed, H)
        const sMid = runUsed / 2
        out.push({
          key: `rg:${level.id}:${region.id}:waist`,
          id: region.id,
          regionKind: 'escada',
          levels: [li - 1, li],
          position: [
            start.x + dir.x * sMid,
            zBot + H / 2 - st.waist / (2 * Math.cos(theta)),
            -(start.y + dir.y * sMid),
          ],
          rotationY: rotY,
          rotationZ: theta,
          size: [lIncl, st.waist, width],
        })

        // patamar de chegada no restante da região
        const landing = runLen - runUsed
        if (landing > 0.06) {
          const s = runUsed + landing / 2
          out.push({
            key: `rg:${level.id}:${region.id}:landing`,
            id: region.id,
            regionKind: 'escada',
            levels: [li],
            position: [start.x + dir.x * s, zTop - st.waist / 2 - 0.0015, -(start.y + dir.y * s)],
            rotationY: rotY,
            rotationZ: 0,
            size: [landing, st.waist, width],
          })
        }
        continue
      }

      // --------------------------------------------------------- reservatório
      if (region.kind === 'reservatorio') {
        const tk = { ...TANK_DEFAULTS, ...(region.tank ?? {}) }
        const t = tk.wallThickness
        const zBase = level.elevation
        const wallH = tk.waterHeight + 0.25 // borda livre
        const zWall = zBase + tk.bottomThickness
        const parts: { key: string; position: [number, number, number]; size: [number, number, number] }[] = [
          {
            key: 'bottom',
            position: [cx, zBase + tk.bottomThickness / 2, -cy],
            size: [dx, tk.bottomThickness, dy],
          },
          { key: 'wx0', position: [minX + t / 2, zWall + wallH / 2, -cy], size: [t, wallH, dy] },
          { key: 'wx1', position: [maxX - t / 2, zWall + wallH / 2, -cy], size: [t, wallH, dy] },
          {
            key: 'wy0',
            position: [cx, zWall + wallH / 2, -(minY + t / 2)],
            size: [Math.max(dx - 2 * t, 0.05), wallH, t],
          },
          {
            key: 'wy1',
            position: [cx, zWall + wallH / 2, -(maxY - t / 2)],
            size: [Math.max(dx - 2 * t, 0.05), wallH, t],
          },
          {
            key: 'top',
            position: [cx, zWall + wallH + tk.topThickness / 2, -cy],
            size: [dx, tk.topThickness, dy],
          },
        ]
        for (const part of parts) {
          out.push({
            key: `rg:${level.id}:${region.id}:${part.key}`,
            id: region.id,
            regionKind: 'reservatorio',
            levels: [li],
            position: part.position,
            rotationY: 0,
            rotationZ: 0,
            size: part.size,
          })
        }
      }
    }
  })
  return out
}

/** move cada vértice ~1,5 cm em direção ao centro do furo (limitado a 25% da distância) */
function shrinkHole(poly: Vec2[]): Vec2[] {
  let cx = 0
  let cy = 0
  for (const p of poly) {
    cx += p.x
    cy += p.y
  }
  cx /= poly.length
  cy /= poly.length
  return poly.map((p) => {
    const dx = cx - p.x
    const dy = cy - p.y
    const d = Math.hypot(dx, dy)
    if (d < 1e-9) return p
    const eps = Math.min(0.015, 0.25 * d)
    return { x: p.x + (dx / d) * eps, y: p.y + (dy / d) * eps }
  })
}

export function buildSlabs(project: Project): SlabInstance[] {
  const out: SlabInstance[] = []
  project.levels.forEach((level, li) => {
    if (!level.planId) return
    const plan = project.plans.find((p) => p.id === level.planId)
    if (!plan) return
    for (const slab of plan.slabs) {
      if (slab.polygon.length < 3) continue
      // encolhe cada furo ~1,5 cm p/ dentro: a triangulação (earcut) falha e
      // PREENCHE o furo quando ele encosta/coincide com o contorno da laje
      // (poço rente à viga de borda). Furos com vértice fora do contorno
      // (laje não-convexa recortada pelo bbox) são descartados no 3D.
      const holes = slabOpeningPolygons(plan, slab)
        .map(shrinkHole)
        .filter((hole) => hole.every((p) => pointInPolygon(p, slab.polygon)))
      out.push({
        key: `sl:${level.id}:${slab.id}`,
        id: slab.id,
        levelIndex: li,
        polygon: slab.polygon,
        holes,
        thickness: slab.thickness,
        elevation: level.elevation,
      })
    }
  })
  return out
}
