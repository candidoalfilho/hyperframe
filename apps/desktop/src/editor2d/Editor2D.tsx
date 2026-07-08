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
import { useActivePlan, useStore } from '../store'
import {
  fitBounds,
  screenToWorld,
  useViewport,
  zoomAt,
  type WorldBounds,
} from './useViewport'
import { buildSnapData, computeSnap, roundPoint05 } from './snap'
import { hitTest, nearestBeam, type HitContext } from './hittest'
import GridLayer from './layers/GridLayer'
import AxesLayer from './layers/AxesLayer'
import SlabsLayer from './layers/SlabsLayer'
import BeamsLayer from './layers/BeamsLayer'
import ColumnsLayer from './layers/ColumnsLayer'
import WallLoadsLayer from './layers/WallLoadsLayer'
import PreviewLayer, { type CursorSnap } from './layers/PreviewLayer'

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

/** trava ortogonal: zera dx ou dy quando a direção está a menos de 15° de um eixo */
function applyOrtho(last: Vec2, p: Vec2): Vec2 {
  const dx = p.x - last.x
  const dy = p.y - last.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < 1e-9 && ady < 1e-9) return p
  const dev = Math.atan2(Math.min(adx, ady), Math.max(adx, ady))
  if (dev > ORTHO_MAX_RAD) return p
  return adx > ady ? { x: p.x, y: last.y } : { x: last.x, y: p.y }
}

export default function Editor2D() {
  // ---- store ----
  const grid = useStore((s) => s.project.grid)
  const columns = useStore((s) => s.project.columns)
  const plan = useActivePlan()
  const tool = useStore((s) => s.tool)
  const display = useStore((s) => s.display)
  const selection = useStore((s) => s.selection)
  const hoverRef = useStore((s) => s.hoverRef)
  const defaults = useStore((s) => s.defaults)

  // ---- viewport ----
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { size, vp, setVp } = useViewport(containerRef)

  // ---- estado local de interação ----
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

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

  // ---- zoom com roda (nativo, passive:false, centrado no cursor) ----
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const pt = { x: e.clientX - r.left, y: e.clientY - r.top }
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

  // ---- Enter finaliza / Escape cancela a polilinha da viga ----
  // (captura antes do handler global do App, que trocaria a ferramenta)
  const finishChain = useCallback(() => {
    const c = chainRef.current
    if (c.length >= 2) useStore.getState().addBeamPath(c)
    setChain([])
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().tool !== 'beam') return
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

  // ---- toast ----
  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // ---- helpers de evento ----
  const toScreenPt = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const setHoverIfChanged = (ref: ElementRef | null) => {
    const st = useStore.getState()
    const cur = st.hoverRef
    if ((cur?.kind ?? null) === (ref?.kind ?? null) && (cur?.id ?? null) === (ref?.id ?? null))
      return
    st.setHover(ref)
  }

  /** ponto efetivo do cursor por ferramenta: snap > orto (viga) > arredondar 0,05 m */
  const effectiveCursor = (raw: Vec2, alt: boolean): CursorSnap => {
    const tolW = SNAP_PX / vp.k
    if (tool === 'column') {
      const snap = computeSnap(raw, snapData, tolW)
      return snap ?? { point: roundPoint05(raw), kind: null }
    }
    if (tool === 'beam') {
      const snap = computeSnap(raw, snapData, tolW)
      if (snap) return snap
      let pt = roundPoint05(raw)
      const c = chainRef.current
      if (c.length > 0 && !alt) pt = applyOrtho(c[c.length - 1], pt)
      return { point: pt, kind: null }
    }
    return { point: raw, kind: null }
  }

  const hitCtx = (): HitContext => ({
    columns,
    beams: plan?.beams ?? [],
    slabs: plan?.slabs ?? [],
    wallLoads: plan?.wallLoads ?? [],
    showLoads: display.showLoads,
    showSlabs: display.showSlabs,
    k: vp.k,
  })

  // ---- ponteiro ----
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = toScreenPt(e)
    // pan: botão do meio OU espaço + botão esquerdo
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
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
      case 'select':
        st.select(hitTest(raw, hitCtx()))
        break
      case 'column':
        st.addColumn(effectiveCursor(raw, e.altKey).point)
        break
      case 'beam': {
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
  }

  const onPointerLeave = () => {
    useStore.getState().setCursorWorld(null)
    setHoverIfChanged(null)
    setCursorSnap(null)
  }

  const onDoubleClick = () => {
    if (tool === 'beam') finishChain()
  }

  // ---- ids de seleção/hover por camada (props primitivas p/ React.memo) ----
  const selColumn = selection?.kind === 'column' ? selection.id : null
  const selBeam = selection?.kind === 'beam' ? selection.id : null
  const selSlab = selection?.kind === 'slab' ? selection.id : null
  const selWall = selection?.kind === 'wallLoad' ? selection.id : null
  const hovColumn = hoverRef?.kind === 'column' ? hoverRef.id : null
  const hovBeam = hoverRef?.kind === 'beam' ? hoverRef.id : null
  const hovSlab = hoverRef?.kind === 'slab' ? hoverRef.id : null
  const hovWall = hoverRef?.kind === 'wallLoad' ? hoverRef.id : null

  const cursorCss = panning
    ? 'grabbing'
    : spaceDown
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
          {plan && (
            <BeamsLayer
              beams={plan.beams}
              k={vp.k}
              showNames={display.showNames}
              selectedId={selBeam}
              hoveredId={hovBeam}
            />
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
        </g>
      </svg>

      <button
        type="button"
        className="btn-icon"
        title="Enquadrar tudo"
        onClick={(e) => {
          fitView()
          e.currentTarget.blur()
        }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 4,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          fontSize: 15,
        }}
      >
        ⛶
      </button>

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
