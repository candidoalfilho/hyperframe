import {
  STAIR_DEFAULTS,
  TANK_DEFAULTS,
  columnFootprint,
  columnHalfExtents,
  foundationShape,
  pointInPolygon,
  slabOpeningPolygons,
  type FoundationResultItem,
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
  /** consolo: perfil trapezoidal (raiz cheia, ponta tipH) extrudado na largura */
  wedge?: { tipH: number }
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

  // ---- consolos (§22.5): caixa na face do pilar, topo no nível ----
  for (const col of project.columns) {
    for (const cb of col.corbels ?? []) {
      const lvl = project.levels.find((l) => l.id === cb.levelId)
      if (!lvl) continue
      const li = levelIdx.get(cb.levelId) ?? 0
      const { dx: hx, dy: hy } = columnHalfExtents(col)
      const rad = (cb.rotationDeg * Math.PI) / 180
      const ux = Math.cos(rad)
      const uy = Math.sin(rad)
      const half = Math.abs(ux) * hx + Math.abs(uy) * hy
      const proj = cb.a + 0.15
      const hC = cb.d + 0.05
      const hCorb = cb.d + 0.05
      boxes.push({
        wedge: { tipH: Math.min(Math.max(cb.tipH ?? 0.5 * hCorb, 0.5 * hCorb), hCorb) },
        key: `corbel:${col.id}:${cb.id}`,
        kind: 'column',
        id: col.id,
        levels: [li],
        position: [
          col.pos.x + ux * (half + proj / 2),
          lvl.elevation - hC / 2,
          -(col.pos.y + uy * (half + proj / 2)),
        ],
        rotationY: Math.atan2(uy, ux),
        size: [proj, hC, cb.bw],
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
        const kind = st.kind ?? 'reto'
        const alongX = dx >= dy
        const runLen = alongX ? dx : dy
        const width = alongX ? dy : dx
        const dirMain: Vec2 = alongX
          ? { x: st.reverse ? -1 : 1, y: 0 }
          : { x: 0, y: st.reverse ? -1 : 1 }
        const perp: Vec2 = alongX ? { x: 0, y: 1 } : { x: 1, y: 0 }
        const s0: Vec2 = {
          x: alongX ? (st.reverse ? maxX : minX) : cx,
          y: alongX ? cy : st.reverse ? maxY : minY,
        }

        // um lance: degraus + mísula, subindo hRise a partir de z0
        const pushFlight = (
          keyBase: string,
          ox: number,
          oy: number,
          dir: Vec2,
          run: number,
          z0: number,
          hRise: number,
          w: number,
        ) => {
          const rotY = Math.atan2(dir.y, dir.x)
          const n = Math.max(3, Math.round(hRise / Math.max(st.riser, 0.12)))
          const e = hRise / n
          const pEff = Math.min((n * st.tread) / n, run / n)
          const used = pEff * n
          for (let k = 0; k < n; k++) {
            const sK = (k + 0.5) * pEff
            out.push({
              key: `rg:${level.id}:${region.id}:${keyBase}:st:${k}`,
              id: region.id,
              regionKind: 'escada',
              levels: [li - 1, li],
              position: [ox + dir.x * sK, z0 + k * e + e / 2, -(oy + dir.y * sK)],
              rotationY: rotY,
              rotationZ: 0,
              size: [pEff, e, w],
            })
          }
          const theta = Math.atan2(hRise, used)
          out.push({
            key: `rg:${level.id}:${region.id}:${keyBase}:waist`,
            id: region.id,
            regionKind: 'escada',
            levels: [li - 1, li],
            position: [
              ox + dir.x * (used / 2),
              z0 + hRise / 2 - st.waist / (2 * Math.cos(theta)),
              -(oy + dir.y * (used / 2)),
            ],
            rotationY: rotY,
            rotationZ: theta,
            size: [Math.hypot(used, hRise), st.waist, w],
          })
          return used
        }
        const pushLanding = (keyBase: string, ox: number, oy: number, lw: number, ldep: number, zTopL: number, rotY: number) => {
          out.push({
            key: `rg:${level.id}:${region.id}:${keyBase}`,
            id: region.id,
            regionKind: 'escada',
            levels: [li - 1, li],
            position: [ox, zTopL - st.waist / 2, -oy],
            rotationY: rotY,
            rotationZ: 0,
            size: [ldep, st.waist, lw],
          })
        }

        if (kind === 'reto') {
          const used = pushFlight('a', s0.x, s0.y, dirMain, runLen, zBot, H, width)
          const rest = runLen - used
          if (rest > 0.06) {
            pushLanding(
              'landing',
              s0.x + dirMain.x * (used + rest / 2),
              s0.y + dirMain.y * (used + rest / 2),
              width,
              rest,
              zTop,
              Math.atan2(dirMain.y, dirMain.x),
            )
          }
        } else if (kind === 'U') {
          const ld = Math.min(st.landingDepth ?? 1.2, runLen * 0.45)
          const runA = runLen - ld
          const wHalf = Math.max((width - 0.04) / 2, 0.3)
          const offA = -width / 4
          const offB = width / 4
          // lance A sobe até o patamar (meia altura)
          pushFlight('a', s0.x + perp.x * offA, s0.y + perp.y * offA, dirMain, runA, zBot, H / 2, wHalf)
          // patamar no fundo, largura total
          pushLanding(
            'mid',
            s0.x + dirMain.x * (runA + ld / 2),
            s0.y + dirMain.y * (runA + ld / 2),
            width,
            ld,
            zBot + H / 2,
            Math.atan2(dirMain.y, dirMain.x),
          )
          // lance B volta (180°) subindo do patamar ao topo
          const back: Vec2 = { x: -dirMain.x, y: -dirMain.y }
          pushFlight(
            'b',
            s0.x + dirMain.x * runA + perp.x * offB,
            s0.y + dirMain.y * runA + perp.y * offB,
            back,
            runA,
            zBot + H / 2,
            H / 2,
            wHalf,
          )
        } else {
          // L: lance A ao longo do lado maior até o patamar de canto; lance B ⊥
          const ld = Math.min(st.landingDepth ?? 1.2, runLen * 0.45, (alongX ? dy : dx))
          const runA = runLen - ld
          const wA = Math.min(ld, width)
          // faixa do lance A encostada na borda perp-mín
          const offA = -(width - wA) / 2
          pushFlight('a', s0.x + perp.x * offA, s0.y + perp.y * offA, dirMain, runA, zBot, H / 2, wA)
          const cornerX = s0.x + dirMain.x * (runA + ld / 2) + perp.x * offA
          const cornerY = s0.y + dirMain.y * (runA + ld / 2) + perp.y * offA
          pushLanding('mid', cornerX, cornerY, wA, ld, zBot + H / 2, Math.atan2(dirMain.y, dirMain.x))
          // lance B sobe ⊥ a partir do patamar
          const runB = Math.max(width - wA, 0.6)
          pushFlight(
            'b',
            cornerX + perp.x * (wA / 2) - dirMain.x * 0,
            cornerY + perp.y * (wA / 2),
            perp,
            runB,
            zBot + H / 2,
            H / 2,
            ld,
          )
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

export interface FoundationInstance {
  key: string
  /** clique seleciona o pilar dono da fundação */
  columnId: string
  shape: 'box' | 'cyl'
  position: [number, number, number]
  /** box: [sx, sy, sz]; cyl: [d, h, d] */
  size: [number, number, number]
  /** viga alavanca: box girado no plano (mesma convenção das vigas) */
  rotationY?: number
  /** tronco de pirâmide: dimensões do TOPO (frustum) — size = base */
  top?: [number, number]
  status: FoundationResultItem['status']
}

/**
 * Sólidos das fundações sob o nível mais baixo: sapata/bloco = caixa (topo em
 * elevação − profundidade), estacas/tubulão = cilindros. Estacas usam o
 * comprimento das configurações limitado a 6 m (representação — o comprimento
 * real entra no orçamento/laudo).
 */
export function buildFoundations(
  project: Project,
  foundations: FoundationResultItem[],
): FoundationInstance[] {
  const out: FoundationInstance[] = []
  const z0 = project.levels[0]?.elevation ?? 0
  const byId = new Map(project.columns.map((c) => [c.id, c]))
  const pileLen = Math.min(Math.max(project.settings.foundation.pileLength ?? 3, 1.5), 6)
  // radier: uma placa sob todos os pilares (substitui as fundações diretas)
  const raft = project.settings.foundation.raft
  if (raft && project.columns.length >= 2) {
    const xsR = project.columns.map((c) => c.pos.x)
    const ysR = project.columns.map((c) => c.pos.y)
    const aR = Math.max(...xsR) - Math.min(...xsR) + 2 * raft.overhang
    const bR = Math.max(...ysR) - Math.min(...ysR) + 2 * raft.overhang
    out.push({
      key: 'fnd:raft',
      columnId: project.columns[0].id,
      shape: 'box',
      position: [
        (Math.min(...xsR) + Math.max(...xsR)) / 2,
        z0 - raft.thickness / 2,
        -(Math.min(...ysR) + Math.max(...ysR)) / 2,
      ],
      size: [aR, raft.thickness, bR],
      status: 'ok',
    })
    return out
  }

  for (const it of foundations) {
    const col = byId.get(it.columnId)
    if (!col) continue
    const partner = it.combined ? byId.get(it.combined.partnerId) : undefined
    const s = foundationShape(it, col, partner)
    if (!s) continue
    const depth = it.depth ?? 0
    const top = z0 - depth
    if (it.combined && partner) {
      // associada: box girado na linha dos pilares (polígono é rotacionado)
      out.push({
        key: `fnd:${it.columnId}:comb`,
        columnId: it.columnId,
        shape: 'box',
        position: [s.center.x, top - s.h / 2, -s.center.y],
        rotationY: Math.atan2(partner.pos.y - col.pos.y, partner.pos.x - col.pos.x),
        size: [it.combined.a, s.h, it.combined.b],
        status: it.status,
      })
    } else if (s.polygon) {
      const xsP = s.polygon.map((p) => p.x)
      const ysP = s.polygon.map((p) => p.y)
      const sa = Math.max(...xsP) - Math.min(...xsP)
      const sb = Math.max(...ysP) - Math.min(...ysP)
      const pyramidal =
        it.kind === 'sapata' && it.footing && (it.footingShape ?? 'piramidal') === 'piramidal'
      if (pyramidal) {
        // tronco de pirâmide: rodapé h0 + frustum até o topo junto ao pilar
        const h0 = it.footing!.h0 ?? Math.max(s.h / 3, 0.15)
        const he = columnHalfExtents(col)
        out.push({
          key: `fnd:${it.columnId}:base`,
          columnId: it.columnId,
          shape: 'box',
          position: [s.center.x, top - s.h + h0 / 2, -s.center.y],
          size: [sa, h0, sb],
          status: it.status,
        })
        out.push({
          key: `fnd:${it.columnId}:tronco`,
          columnId: it.columnId,
          shape: 'box',
          position: [s.center.x, top - (s.h - h0) / 2, -s.center.y],
          size: [sa, s.h - h0, sb],
          top: [Math.min(2 * he.dx + 0.1, sa), Math.min(2 * he.dy + 0.1, sb)],
          status: it.status,
        })
      } else {
        out.push({
          key: `fnd:${it.columnId}:box`,
          columnId: it.columnId,
          shape: 'box',
          position: [s.center.x, top - s.h / 2, -s.center.y],
          size: [sa, s.h, sb],
          status: it.status,
        })
      }
      if (it.kind === 'bloco') {
        s.circles.forEach((c, i) =>
          out.push({
            key: `fnd:${it.columnId}:p${i}`,
            columnId: it.columnId,
            shape: 'cyl',
            position: [c.c.x, top - s.h - pileLen / 2, -c.c.y],
            size: [c.r * 2, pileLen, c.r * 2],
            status: it.status,
          }),
        )
      }
    } else if (it.kind === 'tubulao' && it.caisson) {
      const shaftLen = Math.max(pileLen - s.h, 1.5)
      out.push({
        key: `fnd:${it.columnId}:fuste`,
        columnId: it.columnId,
        shape: 'cyl',
        position: [s.center.x, top - shaftLen / 2, -s.center.y],
        size: [it.caisson.shaftD, shaftLen, it.caisson.shaftD],
        status: it.status,
      })
      out.push({
        key: `fnd:${it.columnId}:base`,
        columnId: it.columnId,
        shape: 'cyl',
        position: [s.center.x, top - shaftLen - s.h / 2, -s.center.y],
        size: [it.caisson.baseD, s.h, it.caisson.baseD],
        status: it.status,
      })
    }
    // viga alavanca: box do CG da sapata ao eixo do pilar interno, topo = topo da sapata
    if (it.strap) {
      const p2 = byId.get(it.strap.partnerId)
      if (p2) {
        const dx = p2.pos.x - s.center.x
        const dy = p2.pos.y - s.center.y
        const len = Math.hypot(dx, dy)
        if (len > 0.1) {
          out.push({
            key: `fnd:${it.columnId}:strap`,
            columnId: it.columnId,
            shape: 'box',
            position: [(s.center.x + p2.pos.x) / 2, top - it.strap.h / 2, -(s.center.y + p2.pos.y) / 2],
            rotationY: Math.atan2(dy, dx),
            size: [len, it.strap.h, it.strap.bw],
            status: it.strap.status,
          })
        }
      }
    }
    // arranque: profundidade > 0 deixa vão entre a base do pilar e o topo da fundação
    if (depth > 0.01) {
      const { dx, dy } = columnHalfExtents(col)
      out.push({
        key: `fnd:${it.columnId}:neck`,
        columnId: it.columnId,
        shape: col.section.shape === 'circle' ? 'cyl' : 'box',
        position: [col.pos.x, z0 - depth / 2, -col.pos.y],
        size: [dx * 2, depth, dy * 2],
        status: it.status,
      })
    }
  }
  return out
}
