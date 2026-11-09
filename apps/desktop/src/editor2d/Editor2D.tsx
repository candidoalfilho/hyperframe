import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  dist,
  type Column,
  type ElementRef,
  type FloorPlan,
  type Grid,
  type Vec2,
} from '@hyperframe/engine'
import { useActivePlan, useStore, type AiGhost } from '../store'
import {
  fitBounds,
  screenToWorld,
  useViewport,
  zoomAt,
  type WorldBounds,
} from './useViewport'
import { eventPoint } from '../ui/zoom'
import { buildSnapData, computeSnap, roundPoint05 } from './snap'
import { hitTest, nearestBeam, type HitContext } from './hittest'
import GridLayer from './layers/GridLayer'
import UnderlayLayer from './layers/UnderlayLayer'
import AxesLayer from './layers/AxesLayer'
import SlabsLayer from './layers/SlabsLayer'
import RegionsLayer from './layers/RegionsLayer'
import BeamsLayer from './layers/BeamsLayer'
import ColumnsLayer from './layers/ColumnsLayer'
import WallLoadsLayer from './layers/WallLoadsLayer'
import FoundationsLayer from './layers/FoundationsLayer'
import PreviewLayer, { type CursorSnap } from './layers/PreviewLayer'
import GhostLayer from './layers/GhostLayer'

const ORTHO_MAX_RAD = (15 * Math.PI) / 180
/** tolerância de snap em px de tela */
const SNAP_PX = 12

/** bbox de mundo do conteúdo (eixos + pilares + vigas + lajes) */
function contentBounds(grid: Grid, columns: Column[], plan: FloorPlan | null): WorldBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (p: Vec2) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const a of grid.xAxes) {
    minX = Math.min(minX, a.pos)
    maxX = Math.max(maxX, a.pos)
  }
  for (const a of grid.yAxes) {
    minY = Math.min(minY, a.pos)
    maxY = Math.max(maxY, a.pos)
  }
  for (const c of columns) add(c.pos)
  if (plan) {
    for (const b of plan.beams) for (const p of b.path) add(p)
    for (const s of plan.slabs) for (const p of s.polygon) add(p)
  }
  if (!isFinite(minX) || !isFinite(maxX)) {
    minX = 0
    maxX = 10
  }
  if (!isFinite(minY) || !isFinite(maxY)) {
    minY = 0
    maxY = 10
  }
  return { minX, minY, maxX, maxY }
}

/**
 * trava ortogonal: zera dx ou dy quando a direção está a menos de 15° de um
 * eixo; com strict (modo ORTO ligado, como o ORTHOMODE/F8 do AutoCAD) trava
 * SEMPRE no eixo dominante
 */
function applyOrtho(last: Vec2, p: Vec2, strict = false): Vec2 {
  const dx = p.x - last.x
  const dy = p.y - last.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < 1e-9 && ady < 1e-9) return p
  if (!strict) {
    const dev = Math.atan2(Math.min(adx, ady), Math.max(adx, ady))
    if (dev > ORTHO_MAX_RAD) return p
  }
  return adx > ady ? { x: p.x, y: last.y } : { x: last.x, y: p.y }
}

/** arredonda ao passo de 0,05 m */
const r05 = (v: number) => Math.round(v / 0.05) * 0.05

/** estado de um arrasto de elemento (ferramenta selecionar) */
interface DragState {
  kind: 'column' | 'beam' | 'loadRegion' | 'mwall'
  id: string
  name: string
  /** ponto de mundo onde o arrasto começou */
  start: Vec2
  /** ponto de tela do pointerdown (p/ limiar de 5 px) */
  startScreen: Vec2
  moved: boolean
  /** pilar: posição original; demais: polilinha/polígono original */
  colStart?: Vec2
  path?: Vec2[]
  bw?: number
  /** snap sem o próprio elemento (só p/ pilar) */
  snap?: ReturnType<typeof buildSnapData>
  /** proposta corrente: pilar = posição nova; demais = delta */
  proposal?: Vec2
}

export default function Editor2D() {
  // ---- store ----
  const grid = useStore((s) => s.project.grid)
  const columns = useStore((s) => s.project.columns)
  const underlay = useStore((s) => s.project.underlay ?? null)
  const foundations = useStore((s) => s.results?.foundations ?? null)
  const isLowestLevel = useStore((s) => s.activeLevelId === s.project.levels[0]?.id)
  const plan = useActivePlan()
  const tool = useStore((s) => s.tool)
  const display = useStore((s) => s.display)
  const selection = useStore((s) => s.selection)
  const hoverRef = useStore((s) => s.hoverRef)
  const defaults = useStore((s) => s.defaults)
  const aiGhost = useStore((s) => s.aiGhost)

  // ---- viewport ----
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { size, vp, setVp } = useViewport(containerRef)

  // ---- estado local de interação ----
  const [spaceDown, setSpaceDown] = useState(false)
  const [handMode, setHandMode] = useState(false)
  const [orthoMode, setOrthoMode] = useState(false)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  // arrasto de elemento (ferramenta selecionar) — commit único no pointerup
  const dragRef = useRef<DragState | null>(null)
  const [dragGhost, setDragGhost] = useState<AiGhost | null>(null)

  const [chain, setChain] = useState<Vec2[]>([])
  const chainRef = useRef<Vec2[]>(chain)
  chainRef.current = chain

  const [cursorSnap, setCursorSnap] = useState<CursorSnap | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef(0)

  // ---- derivados ----
  const bounds = useMemo(() => contentBounds(grid, columns, plan), [grid, columns, plan])
  const ext = useMemo<WorldBounds>(
    () => ({
      minX: bounds.minX - 2,
      minY: bounds.minY - 2,
      maxX: bounds.maxX + 2,
      maxY: bounds.maxY + 2,
    }),
    [bounds],
  )
  const snapData = useMemo(
    () => buildSnapData(grid, columns, plan?.beams ?? []),
    [grid, columns, plan],
  )

  // ---- fit inicial (quando o tamanho chega do ResizeObserver) ----
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && size.w > 0 && size.h > 0) {
      fitted.current = true
      setVp(fitBounds(size, ext))
    }
  }, [size, ext, setVp])

  const fitView = () => setVp(fitBounds(size, ext))

  /** zoom por botão, centrado no meio do viewport (funciona sem roda/gesto) */
  const zoomBy = (factor: number) => {
    const el = svgRef.current
    if (!el) return
    setVp((v) => zoomAt(v, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor))
  }

  // ---- zoom com roda (nativo, passive:false, centrado no cursor) ----
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pt = eventPoint(el, e)
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY
      const factor = Math.pow(1.1, -dy / 100)
      setVp((v) => zoomAt(v, pt, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setVp])

  // ---- espaço = pan ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---- F8 = modo ORTO (como no AutoCAD) · Escape cancela arrasto ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault()
        setOrthoMode((o) => !o)
      } else if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault()
        e.stopPropagation()
        dragRef.current = null
        setDragGhost(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---- toast ----
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // ---- Enter finaliza / Escape cancela a polilinha (viga/região) ----
  // (captura antes do handler global do App, que trocaria a ferramenta)
  const finishChain = useCallback(() => {
    const c = chainRef.current
    const t = useStore.getState().tool
    if (t === 'beam' || t === 'mwall') {
      if (c.length >= 2) {
        if (t === 'beam') useStore.getState().addBeamPath(c)
        else useStore.getState().addMasonryWallPath(c)
      }
      setChain([])
    } else if (t === 'region') {
      if (c.length < 3) {
        showToast('Região precisa de pelo menos 3 pontos')
        return
      }
      useStore.getState().addLoadRegion(c)
      setChain([])
    }
  }, [showToast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = useStore.getState().tool
      if (t !== 'beam' && t !== 'region' && t !== 'mwall') return
      if (e.key === 'Escape' && chainRef.current.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        setChain([])
      } else if (e.key === 'Enter' && chainRef.current.length > 0) {
        e.preventDefault()
        finishChain()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [finishChain])

  // ---- limpeza ao trocar ferramenta / nível ----
  const planId = plan?.id ?? null
  useEffect(() => {
    setChain([])
    setCursorSnap(null)
    const st = useStore.getState()
    if (st.hoverRef) st.setHover(null)
  }, [tool, planId])

  // ---- helpers de evento ----
  // em px CSS do SVG — eventPoint compensa o zoom da UI (⌘+/modo apresentação)
  const toScreenPt = (e: { clientX: number; clientY: number }): Vec2 =>
    eventPoint(svgRef.current!, e)

  const setHoverIfChanged = (ref: ElementRef | null) => {
    const st = useStore.getState()
    const cur = st.hoverRef
    if ((cur?.kind ?? null) === (ref?.kind ?? null) && (cur?.id ?? null) === (ref?.id ?? null))
      return
    st.setHover(ref)
  }

  /** ponto efetivo do cursor por ferramenta: snap > orto (viga/região) > arredondar 0,05 m */
  const effectiveCursor = (raw: Vec2, alt: boolean): CursorSnap => {
    const tolW = SNAP_PX / vp.k
    if (tool === 'column') {
      const snap = computeSnap(raw, snapData, tolW)
      return snap ?? { point: roundPoint05(raw), kind: null }
    }
    if (tool === 'beam' || tool === 'region' || tool === 'mwall') {
      const snap = computeSnap(raw, snapData, tolW)
      if (snap) return snap
      let pt = roundPoint05(raw)
      const c = chainRef.current
      if (c.length > 0 && !alt) pt = applyOrtho(c[c.length - 1], pt, orthoMode)
      return { point: pt, kind: null }
    }
    return { point: raw, kind: null }
  }

  const hitCtx = (): HitContext => ({
    columns,
    beams: plan?.beams ?? [],
    slabs: plan?.slabs ?? [],
    wallLoads: plan?.wallLoads ?? [],
    loadRegions: plan?.loadRegions ?? [],
    showLoads: display.showLoads,
    showSlabs: display.showSlabs,
    k: vp.k,
  })

  // ---- ponteiro ----
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = toScreenPt(e)
    // pan: botão do meio OU espaço/modo mão + botão esquerdo
    if (e.button === 1 || (e.button === 0 && (spaceDown || handMode))) {
      e.preventDefault()
      panRef.current = { px: s.x, py: s.y, ox: vp.ox, oy: vp.oy }
      setPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const raw = screenToWorld(vp, s)
    const st = useStore.getState()
    switch (tool) {
      case 'select': {
        const hit = hitTest(raw, hitCtx())
        st.select(hit)
        // prepara possível arrasto (vira movimento após 5 px) — lajes seguem
        // as vigas e cargas de parede seguem a viga, então não são arrastáveis
        if (hit) {
          if (hit.kind === 'column') {
            const c = columns.find((x) => x.id === hit.id)
            if (c) {
              dragRef.current = {
                kind: 'column',
                id: c.id,
                name: c.name,
                start: raw,
                startScreen: s,
                moved: false,
                colStart: { ...c.pos },
                snap: buildSnapData(
                  grid,
                  columns.filter((x) => x.id !== c.id),
                  plan?.beams ?? [],
                ),
              }
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          } else if (hit.kind === 'beam') {
            const b = plan?.beams.find((x) => x.id === hit.id)
            if (b) {
              dragRef.current = {
                kind: 'beam',
                id: b.id,
                name: b.name,
                start: raw,
                startScreen: s,
                moved: false,
                path: b.path.map((p) => ({ ...p })),
                bw: b.section.bw,
              }
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          } else if (hit.kind === 'loadRegion') {
            const r = plan?.loadRegions.find((x) => x.id === hit.id)
            if (r) {
              dragRef.current = {
                kind: 'loadRegion',
                id: r.id,
                name: r.name,
                start: raw,
                startScreen: s,
                moved: false,
                path: r.polygon.map((p) => ({ ...p })),
              }
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          }
        }
        break
      }
      case 'column':
        st.addColumn(effectiveCursor(raw, e.altKey).point)
        break
      case 'beam':
      case 'region': {
        if (!plan) break
        const pt = effectiveCursor(raw, e.altKey).point
        setChain((c) => {
          const last = c[c.length - 1]
          if (last && dist(last, pt) < 1e-6) return c
          return [...c, pt]
        })
        break
      }
      case 'slab': {
        if (!plan) break
        const r = st.addSlabAt(raw)
        if (r === 'no-face') showToast('Contorno de vigas não encontrado')
        else if (r === 'exists') showToast('Já existe laje aqui')
        break
      }
      case 'wall': {
        if (!plan) break
        const b = nearestBeam(raw, plan.beams, 0.3)
        if (b) st.addWallLoad(b.id)
        break
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = toScreenPt(e)
    if (panRef.current) {
      const { px, py, ox, oy } = panRef.current
      setVp((v) => ({ ...v, ox: ox + (s.x - px), oy: oy + (s.y - py) }))
      return
    }
    const raw = screenToWorld(vp, s)
    const st = useStore.getState()
    // ---- arrasto de elemento em andamento ----
    const drag = dragRef.current
    if (drag) {
      if (!drag.moved && Math.hypot(s.x - drag.startScreen.x, s.y - drag.startScreen.y) < 5) {
        return
      }
      drag.moved = true
      const lock = orthoMode !== e.shiftKey // Shift inverte o modo ORTO só durante o gesto
      if (drag.kind === 'column' && drag.colStart && drag.snap) {
        const tolW = SNAP_PX / vp.k
        let pt = computeSnap(raw, drag.snap, tolW)?.point ?? roundPoint05(raw)
        if (lock) pt = applyOrtho(drag.colStart, pt, true)
        drag.proposal = pt
        setDragGhost({
          kind: 'column',
          pts: [pt],
          mode: 'add',
          label: `mover ${drag.name}`,
        })
      } else if (drag.path) {
        let delta = { x: r05(raw.x - drag.start.x), y: r05(raw.y - drag.start.y) }
        if (lock) {
          delta =
            Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
        }
        drag.proposal = delta
        setDragGhost({
          kind: drag.kind === 'loadRegion' ? 'slab' : 'beam',
          pts: drag.path.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
          bw: drag.bw,
          mode: 'add',
          label: `mover ${drag.name}`,
        })
      }
      st.setCursorWorld(raw)
      return
    }
    if (tool === 'select') {
      setHoverIfChanged(hitTest(raw, hitCtx()))
      st.setCursorWorld(raw)
    } else if (tool === 'wall') {
      const b = plan ? nearestBeam(raw, plan.beams, 0.3) : null
      setHoverIfChanged(b ? { kind: 'beam', id: b.id } : null)
      st.setCursorWorld(raw)
    } else if (tool === 'slab') {
      st.setCursorWorld(raw)
    } else {
      const eff = effectiveCursor(raw, e.altKey)
      setCursorSnap(eff)
      st.setCursorWorld(eff.point)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      panRef.current = null
      setPanning(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    }
    const drag = dragRef.current
    if (drag) {
      dragRef.current = null
      setDragGhost(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (drag.moved && drag.proposal) {
        const st = useStore.getState()
        if (drag.kind === 'column') {
          if (st.moveColumn(drag.id, drag.proposal) === 'duplicate') {
            showToast('Já existe pilar neste ponto')
          }
        } else if (drag.kind === 'beam') {
          st.moveBeam(drag.id, drag.proposal)
        } else if (drag.kind === 'loadRegion') {
          st.moveLoadRegion(drag.id, drag.proposal)
        }
      }
    }
  }

  const onPointerLeave = () => {
    useStore.getState().setCursorWorld(null)
    setHoverIfChanged(null)
    setCursorSnap(null)
  }

  const onDoubleClick = () => {
    if (tool === 'beam' || tool === 'region' || tool === 'mwall') finishChain()
  }

  // ---- ids de seleção/hover por camada (props primitivas p/ React.memo) ----
  const selColumn = selection?.kind === 'column' ? selection.id : null
  const selBeam = selection?.kind === 'beam' ? selection.id : null
  const selSlab = selection?.kind === 'slab' ? selection.id : null
  const selWall = selection?.kind === 'wallLoad' ? selection.id : null
  const selRegion = selection?.kind === 'loadRegion' ? selection.id : null
  const hovColumn = hoverRef?.kind === 'column' ? hoverRef.id : null
  const hovBeam = hoverRef?.kind === 'beam' ? hoverRef.id : null
  const hovSlab = hoverRef?.kind === 'slab' ? hoverRef.id : null
  const hovWall = hoverRef?.kind === 'wallLoad' ? hoverRef.id : null
  const hovRegion = hoverRef?.kind === 'loadRegion' ? hoverRef.id : null

  const cursorCss = panning
    ? 'grabbing'
    : dragGhost
      ? 'move'
      : spaceDown || handMode
        ? 'grab'
        : tool === 'select'
          ? 'default'
          : tool === 'wall'
            ? 'pointer'
            : 'crosshair'

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: cursorCss,
          fontFamily: 'var(--sans)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {underlay && underlay.visible && (
          <g transform={`translate(${vp.ox} ${vp.oy})`}>
            <UnderlayLayer underlay={underlay} k={vp.k} />
          </g>
        )}
        <GridLayer w={size.w} h={size.h} k={vp.k} ox={vp.ox} oy={vp.oy} />
        {/* tudo abaixo em "coords de mundo × k" (y invertido); pan é só o translate */}
        <g transform={`translate(${vp.ox} ${vp.oy})`}>
          {display.showAxes && (
            <AxesLayer
              xAxes={grid.xAxes}
              yAxes={grid.yAxes}
              k={vp.k}
              showDims={display.showDims}
              x0={ext.minX}
              y0={ext.minY}
              x1={ext.maxX}
              y1={ext.maxY}
            />
          )}
          {plan && display.showSlabs && (
            <SlabsLayer slabs={plan.slabs} k={vp.k} selectedId={selSlab} hoveredId={hovSlab} />
          )}
          {plan && display.showLoads && (
            <RegionsLayer
              regions={plan.loadRegions}
              k={vp.k}
              selectedId={selRegion}
              hoveredId={hovRegion}
            />
          )}
          {plan && (
            <BeamsLayer
              beams={plan.beams}
              k={vp.k}
              showNames={display.showNames}
              selectedId={selBeam}
              hoveredId={hovBeam}
            />
          )}
          {plan && (plan.masonryWalls?.length ?? 0) > 0 && (
            <g pointerEvents="none">
              {plan.masonryWalls!.map((w) =>
                w.path.slice(0, -1).map((a, i) => {
                  const b = w.path[i + 1]
                  return (
                    <line
                      key={`${w.id}:${i}`}
                      x1={a.x * vp.k}
                      y1={-a.y * vp.k}
                      x2={b.x * vp.k}
                      y2={-b.y * vp.k}
                      stroke="#b07ad1"
                      strokeWidth={Math.max(w.thickness * vp.k, 3)}
                      strokeLinecap="butt"
                      opacity={0.55}
                    />
                  )
                }),
              )}
              {display.showNames &&
                vp.k >= 12 &&
                plan.masonryWalls!.map((w) => (
                  <text
                    key={`${w.id}:lbl`}
                    x={((w.path[0].x + w.path[w.path.length - 1].x) / 2) * vp.k}
                    y={-((w.path[0].y + w.path[w.path.length - 1].y) / 2) * vp.k - 5}
                    fontSize={10}
                    fill="#b07ad1"
                    textAnchor="middle"
                  >
                    {w.name}
                  </text>
                ))}
            </g>
          )}
          {isLowestLevel && foundations && (
            <FoundationsLayer items={foundations} columns={columns} k={vp.k} />
          )}
          <ColumnsLayer
            columns={columns}
            k={vp.k}
            showNames={display.showNames}
            selectedId={selColumn}
            hoveredId={hovColumn}
          />
          {plan && display.showLoads && (
            <WallLoadsLayer
              wallLoads={plan.wallLoads}
              beams={plan.beams}
              k={vp.k}
              selectedId={selWall}
              hoveredId={hovWall}
            />
          )}
          <PreviewLayer
            tool={tool}
            k={vp.k}
            cursor={cursorSnap}
            chain={chain}
            columnSection={defaults.columnSection}
            columnRotation={defaults.columnRotation}
          />
          {aiGhost && <GhostLayer ghost={aiGhost} k={vp.k} />}
          {dragGhost && <GhostLayer ghost={dragGhost} k={vp.k} />}
        </g>
      </svg>

      {(
        [
          ['+', 'Aproximar (ou role a roda do mouse)', 8, () => zoomBy(1.4), false],
          ['−', 'Afastar', 44, () => zoomBy(1 / 1.4), false],
          ['⛶', 'Enquadrar tudo', 80, fitView, false],
          [
            '✋',
            'Mover a vista — arraste com o botão esquerdo (ou segure espaço / use o botão do meio)',
            116,
            () => setHandMode((h) => !h),
            handMode,
          ],
          [
            '⟂',
            'Modo ORTO (F8) — restringe desenho e arrasto às direções X/Y; Shift inverte durante o gesto',
            152,
            () => setOrthoMode((o) => !o),
            orthoMode,
          ],
        ] as const
      ).map(([label, title, top, fn, active]) => (
        <button
          key={label}
          type="button"
          className="btn-icon"
          title={title}
          onClick={(e) => {
            fn()
            e.currentTarget.blur()
          }}
          style={{
            position: 'absolute',
            top,
            right: 8,
            zIndex: 4,
            background: active ? 'var(--accent)' : 'var(--bg-2)',
            border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
            color: active ? 'var(--accent-fg)' : undefined,
            fontSize: 15,
          }}
        >
          {label}
        </button>
      ))}

      {!plan && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 16px',
              color: 'var(--text-dim)',
              fontSize: 12.5,
            }}
          >
            Este nível não possui planta editável — selecione um pavimento.
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 12.5,
            color: 'var(--text)',
            boxShadow: 'var(--shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
