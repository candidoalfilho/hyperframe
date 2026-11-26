import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  columnFootprint,
  columnHalfExtents,
  computeLoadPath,
  loadPathBeamKey,
  loadPathFoundationKey,
  loadPathOptions,
  loadPathSlabKey,
  polygonCentroid,
  projectOnSegment,
  traceLoadPath,
  type AnalysisResults,
  type Beam,
  type ElementRef,
  type LoadPath,
  type LoadPathElement,
  type LoadPathFlow,
  type Project,
  type Vec2,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { fitBounds, useViewport, zoomAt, type WorldBounds } from '../editor2d/useViewport'
import { eventPoint } from '../ui/zoom'
import { fmt } from './format'

/**
 * Caminho das cargas (issue #9): planta do pavimento com os quinhões das lajes,
 * o que cada borda entrega às vigas, as reações das vigas nos apoios e o
 * acumulado nos pilares; ao escolher um elemento, de onde vem e para onde vai a
 * carga dele. Os números vêm de `computeLoadPath` (equilíbrio do pórtico).
 */

type Mark = 'sel' | 'up' | 'down' | 'dim' | 'none'

const UP = 'var(--blue)'
const DOWN = 'var(--accent)'
const KIND_LABEL: Record<LoadPathElement['kind'], string> = {
  slab: 'Laje',
  beam: 'Viga',
  column: 'Pilar',
  foundation: 'Fundação',
  soil: 'Solo',
  direct: 'Carga direta',
}

const halo: CSSProperties = { fontFamily: 'var(--mono)', pointerEvents: 'none' }
const HALO = { stroke: 'var(--canvas-bg)', strokeWidth: 3.5, paintOrder: 'stroke' as const }

/** aba ligada ao editor: pavimento ativo e seleção são os do projeto aberto */
export default function LoadPathTab({
  results,
  project,
  onExpand,
}: {
  results: AnalysisResults
  project: Project
  /** amplia o painel de resultados (ausente = já ampliado) */
  onExpand?: () => void
}) {
  const activeLevelId = useStore((s) => s.activeLevelId)
  const setActiveLevel = useStore((s) => s.setActiveLevel)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  return (
    <LoadPathView
      results={results}
      project={project}
      activeLevelId={activeLevelId}
      setActiveLevel={setActiveLevel}
      selection={selection}
      select={select}
      onExpand={onExpand}
    />
  )
}

export function LoadPathView({
  results,
  project,
  activeLevelId,
  setActiveLevel,
  selection,
  select,
  onExpand,
}: {
  results: AnalysisResults
  project: Project
  activeLevelId: string
  setActiveLevel: (id: string) => void
  selection: ElementRef | null
  select: (ref: ElementRef | null) => void
  onExpand?: () => void
}) {
  const options = useMemo(() => loadPathOptions(results), [results])
  const [optionId, setOptionId] = useState('G+Q')
  const option = options.find((o) => o.id === optionId) ?? options[0]
  const lp = useMemo(() => computeLoadPath(project, results, option), [project, results, option])

  const levels = useMemo(
    () => [...project.levels].sort((a, b) => a.elevation - b.elevation),
    [project.levels],
  )
  const li = Math.max(
    0,
    levels.findIndex((l) => l.id === activeLevelId),
  )
  const plan = project.plans.find((p) => p.id === levels[li]?.planId) ?? null
  const byKey = useMemo(() => new Map(lp.elements.map((e) => [e.key, e])), [lp])

  /** elemento que representa o pilar na planta do nível: o tramo sob o piso, a fundação ou o tramo que nasce ali */
  const columnKeyAt = useMemo(() => {
    const cols = lp.elements.filter((e) => e.kind === 'column')
    return (columnId: string, level: number): string | null => {
      const under = cols.find((e) => e.id === columnId && e.levelIndex === level)
      if (under) return under.key
      const fk = loadPathFoundationKey(columnId)
      if (byKey.get(fk)?.levelIndex === level) return fk
      const above = cols
        .filter((e) => e.id === columnId && e.levelIndex > level)
        .sort((a, b) => a.levelIndex - b.levelIndex)[0]
      return above?.key ?? null
    }
  }, [lp, byKey])

  // ---- elemento escolhido: segue a seleção do editor (laje, viga, pilar) ----
  const [picked, setPicked] = useState<string | null>(null)
  const ownSelect = useRef(false)
  useEffect(() => {
    if (ownSelect.current) {
      ownSelect.current = false
      return
    }
    if (!selection) return setPicked(null)
    const key =
      selection.kind === 'slab'
        ? loadPathSlabKey(li, selection.id)
        : selection.kind === 'beam'
          ? loadPathBeamKey(li, selection.id)
          : selection.kind === 'column'
            ? columnKeyAt(selection.id, li)
            : null
    setPicked(key && byKey.has(key) ? key : null)
  }, [selection, li, columnKeyAt, byKey])

  const pick = (key: string | null) => {
    const e = key ? byKey.get(key) : undefined
    setPicked(e ? e.key : null)
    ownSelect.current = true
    if (e && (e.kind === 'slab' || e.kind === 'beam' || e.kind === 'column')) {
      select({ kind: e.kind, id: e.id })
    } else {
      select(null)
    }
    // o elemento pode estar em outro pavimento (tramo de cima, fundação…)
    if (e && e.levelIndex !== li && levels[e.levelIndex]) setActiveLevel(levels[e.levelIndex].id)
  }

  const sel = picked ? (byKey.get(picked) ?? null) : null
  const trace = useMemo(() => (sel ? traceLoadPath(lp, sel.key) : null), [lp, sel])
  const up = useMemo(() => new Set(trace?.up ?? []), [trace])
  const down = useMemo(() => new Set(trace?.down ?? []), [trace])
  const markOf = (key: string | null): Mark => {
    if (!sel) return 'none'
    if (!key) return 'dim'
    if (key === sel.key) return 'sel'
    if (up.has(key)) return 'up'
    if (down.has(key)) return 'down'
    return 'dim'
  }

  const scale = Math.max(1, Math.abs(lp.check.applied), Math.abs(lp.check.reactions))
  const closed =
    Math.abs(lp.check.applied - lp.check.reactions) < 1e-4 * scale && lp.check.residual < 1e-4 * scale
  const schematic = lp.slabEdges.some((e) => e.levelIndex === li && !e.exact && e.polygon.length > 0)

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="label" style={{ margin: 0 }}>
          Pavimento
        </span>
        <select
          className="select"
          aria-label="Pavimento"
          value={levels[li]?.id ?? ''}
          onChange={(e) => {
            ownSelect.current = false
            setPicked(null)
            select(null)
            setActiveLevel(e.target.value)
          }}
        >
          {[...levels].reverse().map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="label" style={{ margin: '0 0 0 8px' }}>
          Caso ou combinação
        </span>
        <select
          className="select"
          aria-label="Caso ou combinação"
          style={{ minWidth: 240 }}
          value={option.id}
          onChange={(e) => setOptionId(e.target.value)}
        >
          {(['Casos', 'Combinações'] as const).map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span
          className={`chip ${closed ? 'ok' : 'err'}`}
          title="Soma das cargas aplicadas nos elementos × soma das reações de apoio"
        >
          aplicado {fmt(lp.check.applied, 1)} kN {closed ? '=' : '≠'} reações {fmt(lp.check.reactions, 1)} kN
        </span>
        {lp.check.lost > 0.01 && (
          <span className="chip warn" title="Laje sem viga nem pilar que a receba — carga fora do pórtico">
            {fmt(lp.check.lost, 1)} kN de laje sem apoio
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100% - 40px)', minHeight: 330 }}>
        <PlanView
          lp={lp}
          project={project}
          li={li}
          beams={plan?.beams ?? []}
          markOf={markOf}
          columnKeyAt={columnKeyAt}
          hasSelection={!!sel}
          onPick={pick}
          onExpand={onExpand}
        />
        <div
          style={{
            width: 320,
            flex: 'none',
            overflowY: 'auto',
            borderLeft: '1px solid var(--border)',
            paddingLeft: 12,
          }}
        >
          {sel ? (
            <Details lp={lp} el={sel} byKey={byKey} levels={levels} up={up} down={down} onPick={pick} />
          ) : (
            <Hint schematic={schematic} levelName={levels[li]?.name ?? ''} />
          )}
        </div>
      </div>

      <Descent lp={lp} li={li} picked={sel?.key ?? null} onPick={pick} />
    </>
  )
}

// ---------------------------------------------------------------------------
// planta
// ---------------------------------------------------------------------------

function Arrow({ a, b, color, w = 1.4 }: { a: Vec2; b: Vec2; color: string; w?: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 6) return null
  const ux = dx / len
  const uy = dy / len
  const h = 6
  const bx = b.x - ux * h
  const by = b.y - uy * h
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={bx} y2={by} stroke={color} strokeWidth={w} />
      <polygon
        points={`${b.x},${b.y} ${bx - uy * 3},${by + ux * 3} ${bx + uy * 3},${by - ux * 3}`}
        fill={color}
      />
    </g>
  )
}

/** direção (unitária, mundo) da viga para DENTRO do vão a partir do ponto `at`; null = apoio intermediário */
function inwardDir(beam: Beam | undefined, at: Vec2): { dir: Vec2 | null; along: Vec2 } {
  let best = { d: Infinity, t: 0, a: at, b: at }
  if (beam) {
    for (let i = 0; i + 1 < beam.path.length; i++) {
      const pr = projectOnSegment(at, beam.path[i], beam.path[i + 1])
      if (pr.d < best.d) best = { d: pr.d, t: pr.t, a: beam.path[i], b: beam.path[i + 1] }
    }
  }
  const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y) || 1
  const along = { x: (best.b.x - best.a.x) / len, y: (best.b.y - best.a.y) / len }
  // extremo da viga inteira (não só do trecho): a carga vem de um lado só
  const first = beam?.path[0]
  const last = beam?.path[beam.path.length - 1]
  if (first && Math.hypot(first.x - at.x, first.y - at.y) < 0.35) return { dir: along, along }
  if (last && Math.hypot(last.x - at.x, last.y - at.y) < 0.35)
    return { dir: { x: -along.x, y: -along.y }, along }
  return { dir: null, along }
}

function PlanView({
  lp,
  project,
  li,
  beams,
  markOf,
  columnKeyAt,
  hasSelection,
  onPick,
  onExpand,
}: {
  lp: LoadPath
  project: Project
  li: number
  beams: Beam[]
  markOf: (key: string | null) => Mark
  columnKeyAt: (columnId: string, level: number) => string | null
  hasSelection: boolean
  onPick: (key: string | null) => void
  onExpand?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { size, vp, setVp } = useViewport(ref)
  const byKey = useMemo(() => new Map(lp.elements.map((e) => [e.key, e])), [lp])

  const levels = useMemo(
    () => [...project.levels].sort((a, b) => a.elevation - b.elevation),
    [project.levels],
  )
  const levelIndexById = useMemo(() => new Map(levels.map((l, i) => [l.id, i])), [levels])
  const columns = useMemo(
    () =>
      project.columns.filter((c) => {
        const ib = levelIndexById.get(c.baseLevelId) ?? 0
        const it = levelIndexById.get(c.topLevelId) ?? levels.length - 1
        return li >= ib && li <= it
      }),
    [project.columns, levelIndexById, levels.length, li],
  )
  const edges = useMemo(() => lp.slabEdges.filter((e) => e.levelIndex === li), [lp, li])
  const slabs = useMemo(() => lp.elements.filter((e) => e.kind === 'slab' && e.levelIndex === li), [lp, li])
  const beamById = useMemo(() => new Map(beams.map((b) => [b.id, b])), [beams])

  const bounds = useMemo<WorldBounds>(() => {
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
    for (const c of project.columns) add(c.pos)
    for (const b of beams) for (const p of b.path) add(p)
    for (const e of edges) {
      add(e.a)
      add(e.b)
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    return { minX, minY, maxX, maxY }
  }, [project.columns, beams, edges])

  // enquadra ao abrir, ao trocar de pavimento e quando o painel muda de tamanho
  useEffect(() => {
    if (size.w > 0 && size.h > 0) setVp(fitBounds(size, bounds, 44))
  }, [size, bounds, setVp])

  // pinça / Ctrl+roda aproxima; a roda sozinha continua rolando o painel
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const pt = eventPoint(el, e)
      setVp((v) => zoomAt(v, pt, Math.pow(1.1, -e.deltaY / 40)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setVp])

  // arrastar = mover a vista; clique sem arrasto = escolher
  const drag = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const s = eventPoint(svgRef.current!, e)
    drag.current = { px: s.x, py: s.y, ox: vp.ox, oy: vp.oy, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const s = eventPoint(svgRef.current!, e)
    if (!d.moved && Math.hypot(s.x - d.px, s.y - d.py) < 4) return
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId)
    d.moved = true
    setVp((v) => ({ ...v, ox: d.ox + (s.x - d.px), oy: d.oy + (s.y - d.py) }))
  }
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d && !d.moved && e.target === e.currentTarget) onPick(null)
  }
  const clickPick = (key: string | null) => () => {
    if (drag.current?.moved) return
    onPick(key)
  }

  const k = vp.k
  const P = (p: Vec2): Vec2 => ({ x: p.x * k, y: -p.y * k })
  const pts = (poly: Vec2[]) => poly.map((p) => `${p.x * k},${-p.y * k}`).join(' ')
  const colorOf = (m: Mark, base: string) => (m === 'sel' ? 'var(--text)' : m === 'up' ? UP : m === 'down' ? DOWN : base)
  const alpha = (m: Mark) => (m === 'dim' ? 0.28 : 1)

  // reações das vigas nos apoios deste pavimento (viga → pilar/fundação/viga)
  const beamFlows = useMemo(
    () =>
      lp.flows.filter((f) => {
        if (f.levelIndex !== li) return false
        const a = byKey.get(f.from)
        const b = byKey.get(f.to)
        return a?.kind === 'beam' && b?.kind !== undefined && b.kind !== 'slab'
      }),
    [lp, li, byKey],
  )

  /** texto da 2ª linha do pilar (o que chega no pavimento e o acumulado) */
  const columnInfo = (c: Project['columns'][number]) => {
    const key = columnKeyAt(c.id, li)
    const e = key ? byKey.get(key) : undefined
    const arriving = e
      ? lp.flows
          .filter((f) => f.to === e.key && byKey.get(f.from)?.kind !== 'column')
          .reduce((acc, f) => acc + f.value, 0)
      : 0
    const line2 = !e
      ? ''
      : e.kind === 'foundation'
        ? `R ${fmt(e.received - e.delivered, 0)}`
        : e.levelIndex === li
          ? `+${fmt(arriving, 0)} · N ${fmt(e.nBase ?? 0, 0)}`
          : 'nasce aqui'
    return { key, line2 }
  }

  // posição dos números das reações: junto ao apoio, sem cair sobre o pilar,
  // o rótulo dele ou outro número (tenta as posições em ordem e fica com a 1ª livre)
  const reactionLabels = useMemo(() => {
    if (k < 9) return []
    type Box = { x0: number; y0: number; x1: number; y1: number }
    const taken: Box[] = []
    const box = (cx: number, cy: number, w: number, h: number): Box => ({
      x0: cx - w / 2,
      y0: cy - h / 2,
      x1: cx + w / 2,
      y1: cy + h / 2,
    })
    const free = (bx: Box) => !taken.some((t) => bx.x0 < t.x1 && bx.x1 > t.x0 && bx.y0 < t.y1 && bx.y1 > t.y0)
    for (const c of columns) {
      const { dx, dy } = columnHalfExtents(c)
      const cx = c.pos.x * k
      const cy = -c.pos.y * k
      taken.push(box(cx, cy, dx * 2 * k, dy * 2 * k))
      const chars = Math.max(c.name.length, columnInfo(c).line2.length)
      taken.push(box(cx, cy + dy * k + 17, chars * 6.2, 26))
    }
    const out: { f: LoadPathFlow; x: number; y: number; text: string; onBeam: boolean }[] = []
    const withDir = beamFlows.map((f) => {
      const from = byKey.get(f.from)!
      const beam = beamById.get(from.id)
      return { f, beam, ...inwardDir(beam, f.at) }
    })
    // extremos primeiro: têm menos opções de lugar
    withDir.sort((p, q) => Number(!p.dir) - Number(!q.dir))
    for (const { f, beam, dir, along } of withDir) {
      const to = byKey.get(f.to)!
      const onBeam = to.kind === 'beam'
      const text = `${fmt(f.value, 1)}${onBeam ? ` → ${to.name}` : ''}`
      const w = text.length * 5.9 + 4
      const h = 11
      const at = { x: f.at.x * k, y: -f.at.y * k }
      const col = columns.find((c) => Math.hypot(c.pos.x - f.at.x, c.pos.y - f.at.y) < 0.06)
      const he = col ? columnHalfExtents(col) : { dx: 0, dy: 0 }
      const hx = he.dx * k
      const hy = he.dy * k
      const half = ((beam?.section.bw ?? 0.15) * k) / 2
      const cands: Vec2[] = []
      if (dir) {
        const sx = dir.x
        const sy = -dir.y
        const nx = -sy
        const ny = sx
        const side = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + half + 3
        for (const pad of [5, 24, 44]) {
          const run = Math.abs(sx) * (hx + w / 2) + Math.abs(sy) * (hy + h / 2) + pad
          // primeiro o lado de cima/esquerda da viga, depois o outro
          for (const sgn of ny < 0 || (Math.abs(ny) < 1e-9 && nx < 0) ? [1, -1] : [-1, 1])
            cands.push({ x: at.x + sx * run + nx * side * sgn, y: at.y + sy * run + ny * side * sgn })
        }
      } else {
        // apoio intermediário: nas diagonais do pilar (as vigas passam pelos eixos)
        const horiz = Math.abs(along.x) >= Math.abs(along.y)
        const ox = Math.max(hx, half) + w / 2 + 3
        const oy = Math.max(hy, half) + h / 2 + 3
        const order = horiz
          ? [[1, -1], [-1, -1], [1, 1], [-1, 1]]
          : [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        for (const mult of [1, 1.8]) for (const [qx, qy] of order) cands.push({ x: at.x + qx * ox * mult, y: at.y + qy * oy * mult })
      }
      const pos = cands.find((c) => free(box(c.x, c.y, w, h))) ?? cands[0]
      taken.push(box(pos.x, pos.y, w, h))
      out.push({ f, x: pos.x, y: pos.y, text, onBeam })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beamFlows, columns, k, byKey, beamById])

  const zoomBy = (factor: number) =>
    setVp((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, factor))

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        background: 'var(--canvas-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <svg
        ref={svgRef}
        data-testid="load-path-plan"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <pattern id="lp-free" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--text-faint)" strokeWidth="1" />
          </pattern>
        </defs>
        <g transform={`translate(${vp.ox} ${vp.oy})`}>
          {/* quinhões das lajes */}
          {edges.map((e) => {
            if (e.polygon.length < 3) return null
            const m = markOf(e.slabKey)
            const cw = polygonCentroid(e.polygon)
            const c = P(cw)
            const tt = projectOnSegment(cw, e.a, e.b).t
            const foot = P({ x: e.a.x + (e.b.x - e.a.x) * tt, y: e.a.y + (e.b.y - e.a.y) * tt })
            const dx = foot.x - c.x
            const dy = foot.y - c.y
            const len = Math.hypot(dx, dy) || 1
            const ux = dx / len
            const uy = dy / len
            const color = colorOf(m, 'var(--text-dim)')
            const room = len > 34
            // seta na horizontal: o rótulo fica atrás da cauda, sem cruzar a seta
            const sideways = Math.abs(ux) > Math.abs(uy)
            // quinhão estreito: só o número (a unidade está na legenda)
            const xsPx = e.polygon.map((q) => q.x * k)
            const wide = Math.max(...xsPx) - Math.min(...xsPx) >= 90
            return (
              <g key={`${e.slabKey}:${e.edgeIndex}`} opacity={alpha(m)}>
                <polygon
                  points={pts(e.polygon)}
                  fill={
                    !e.supported
                      ? 'url(#lp-free)'
                      : m === 'sel'
                        ? 'var(--accent-soft)'
                        : m === 'up'
                          ? 'var(--blue-soft)'
                          : 'var(--bg-2)'
                  }
                  fillOpacity={e.supported ? 0.75 : 0.5}
                  stroke={m === 'sel' ? 'var(--text)' : 'var(--border-strong)'}
                  strokeWidth={1}
                  strokeDasharray={e.exact ? '5 3' : '2 4'}
                  style={{ cursor: 'pointer' }}
                  onClick={clickPick(e.slabKey)}
                />
                {e.supported && e.value > 1e-6 && room && (
                  <Arrow
                    a={{ x: c.x + ux * (sideways ? 5 : 3), y: c.y + uy * (sideways ? 5 : 3) }}
                    b={{ x: foot.x - ux * 5, y: foot.y - uy * 5 }}
                    color={color}
                  />
                )}
                {k >= 9 && (
                  <text
                    x={c.x - (room && sideways ? ux * 2 : 0)}
                    y={c.y - (room && !sideways ? uy * 7 : 0)}
                    fontSize={10}
                    textAnchor={room && sideways ? (ux > 0 ? 'end' : 'start') : 'middle'}
                    dominantBaseline="central"
                    fill={color}
                    {...HALO}
                    style={halo}
                  >
                    {e.supported ? `${fmt(e.perMeter, 1)}${k >= 38 && wide ? ' kN/m' : ''}` : 'borda livre'}
                  </text>
                )}
              </g>
            )
          })}
          {/* nome das lajes */}
          {slabs.map((s) => {
            if (!s.pos) return null
            const m = markOf(s.key)
            const p = P(s.pos)
            return (
              <text
                key={s.key}
                x={p.x}
                y={p.y}
                fontSize={11}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                fill={colorOf(m, 'var(--text)')}
                opacity={alpha(m)}
                {...HALO}
                style={{ ...halo, fontFamily: 'var(--sans)' }}
              >
                {s.name}
                {s.lost ? ' — sem apoio' : ''}
              </text>
            )
          })}
          {/* vigas */}
          {beams.map((b) => {
            const key = loadPathBeamKey(li, b.id)
            const m = markOf(byKey.has(key) ? key : null)
            const color = colorOf(m, 'var(--el-column-stroke)')
            const path = b.path.map((p) => `${p.x * k},${-p.y * k}`).join(' ')
            // nome no meio do maior vão livre entre apoios (não em cima de um pilar)
            const cum = [0]
            for (let i = 0; i + 1 < b.path.length; i++)
              cum.push(cum[i] + Math.hypot(b.path[i + 1].x - b.path[i].x, b.path[i + 1].y - b.path[i].y))
            const total = cum[cum.length - 1]
            const stops = [0, total]
            for (const f of beamFlows) {
              if (f.from !== key && f.to !== key) continue
              let best = { d: Infinity, s: 0 }
              for (let i = 0; i + 1 < b.path.length; i++) {
                const pr = projectOnSegment(f.at, b.path[i], b.path[i + 1])
                if (pr.d < best.d) best = { d: pr.d, s: cum[i] + pr.t * (cum[i + 1] - cum[i]) }
              }
              stops.push(best.s)
            }
            stops.sort((x, y) => x - y)
            let sMid = total / 2
            let gap = 0
            for (let i = 0; i + 1 < stops.length; i++) {
              if (stops[i + 1] - stops[i] > gap + 1e-6) {
                gap = stops[i + 1] - stops[i]
                sMid = (stops[i] + stops[i + 1]) / 2
              }
            }
            let seg = 0
            while (seg + 2 < cum.length && cum[seg + 1] < sMid) seg++
            const tMid = (sMid - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-9)
            const a = P(b.path[seg])
            const c = P(b.path[seg + 1] ?? b.path[seg])
            const mid = { x: a.x + (c.x - a.x) * tMid, y: a.y + (c.y - a.y) * tMid }
            const horiz = Math.abs(c.x - a.x) >= Math.abs(c.y - a.y)
            const lineW = Math.max(b.section.bw * k, m === 'sel' ? 4 : 3)
            return (
              <g key={b.id} opacity={alpha(m)}>
                <polyline
                  points={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={lineW}
                  strokeLinejoin="round"
                />
                <polyline
                  points={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(b.section.bw * k, 12)}
                  style={{ cursor: 'pointer' }}
                  onClick={clickPick(byKey.has(key) ? key : null)}
                />
                {k >= 9 && (
                  <text
                    x={mid.x + (horiz ? 0 : -(lineW / 2 + 5))}
                    y={mid.y + (horiz ? -(lineW / 2 + 8) : 0)}
                    fontSize={10}
                    textAnchor={horiz ? 'middle' : 'end'}
                    dominantBaseline="central"
                    fill={colorOf(m, 'var(--text-dim)')}
                    {...HALO}
                    style={{ ...halo, fontFamily: 'var(--sans)' }}
                  >
                    {b.name}
                  </text>
                )}
              </g>
            )
          })}
          {/* reações das vigas nos apoios */}
          {reactionLabels.map(({ f, x, y, text, onBeam }) => {
            const m =
              markOf(f.from) === 'dim' && markOf(f.to) === 'dim' ? 'dim' : hasSelection ? markOf(f.from) : 'none'
            return (
              <text
                key={`${f.from}>${f.to}`}
                x={x}
                y={y}
                fontSize={9.5}
                textAnchor="middle"
                dominantBaseline="central"
                fill={colorOf(m, onBeam ? UP : 'var(--text)')}
                opacity={alpha(m)}
                {...HALO}
                style={halo}
              >
                {text}
              </text>
            )
          })}
          {/* pilares */}
          {columns.map((c) => {
            const { key, line2 } = columnInfo(c)
            const m = markOf(key)
            const color = colorOf(m, 'var(--el-column-stroke)')
            const { dx, dy } = columnHalfExtents(c)
            const isCircle = c.section.shape === 'circle'
            return (
              <g key={c.id} opacity={alpha(m)} style={{ cursor: 'pointer' }} onClick={clickPick(key)}>
                {isCircle ? (
                  <circle cx={c.pos.x * k} cy={-c.pos.y * k} r={Math.max(dx * k, 4)} fill="var(--el-column-fill)" stroke={color} strokeWidth={m === 'sel' ? 2.5 : 1.5} />
                ) : (
                  <polygon points={pts(columnFootprint(c))} fill="var(--el-column-fill)" stroke={color} strokeWidth={m === 'sel' ? 2.5 : 1.5} />
                )}
                <rect
                  x={c.pos.x * k - Math.max(dx * k, 8)}
                  y={-c.pos.y * k - Math.max(dy * k, 8)}
                  width={Math.max(dx * 2 * k, 16)}
                  height={Math.max(dy * 2 * k, 16)}
                  fill="transparent"
                />
                {k >= 9 && (
                  <text
                    x={c.pos.x * k}
                    y={-c.pos.y * k + dy * k + 11}
                    fontSize={10}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={colorOf(m, 'var(--text)')}
                    {...HALO}
                    style={halo}
                  >
                    <tspan fontWeight={700} style={{ fontFamily: 'var(--sans)' }}>
                      {c.name}
                    </tspan>
                    {line2 && (
                      <tspan x={c.pos.x * k} dy={12}>
                        {line2}
                      </tspan>
                    )}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {(
        [
          ['+', 'Aproximar (ou pinça / Ctrl + roda)', 8, () => zoomBy(1.4)],
          ['−', 'Afastar', 40, () => zoomBy(1 / 1.4)],
          ['⛶', 'Enquadrar o pavimento', 72, () => setVp(fitBounds(size, bounds, 44))],
        ] as const
      ).map(([label, title, top, fn]) => (
        <button
          key={label}
          type="button"
          className="btn-icon"
          title={title}
          onClick={fn}
          style={{
            position: 'absolute',
            top,
            right: 8,
            width: 28,
            height: 28,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            fontSize: 14,
          }}
        >
          {label}
        </button>
      ))}

      {onExpand && size.h > 0 && size.h < 480 && (
        <button
          type="button"
          className="btn"
          title="Ampliar o painel de resultados para ver a planta maior"
          onClick={onExpand}
          style={{ position: 'absolute', right: 8, bottom: 8, height: 24, fontSize: 11 }}
        >
          ▴ ampliar a planta
        </button>
      )}

      {edges.length === 0 && beams.length === 0 && (
        <div
          className="faint"
          style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11.5, pointerEvents: 'none' }}
        >
          Sem lajes nem vigas neste nível — só os apoios dos pilares.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// painel lateral
// ---------------------------------------------------------------------------

function Hint({ schematic, levelName }: { schematic: boolean; levelName: string }) {
  const li: CSSProperties = { margin: '0 0 7px', lineHeight: 1.45 }
  return (
    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
      <h3 className="panel-title">Como ler — {levelName}</h3>
      <p style={li}>
        <b style={{ color: 'var(--text)' }}>Lajes:</b> cada figura tracejada é o quinhão de uma borda; o
        número é a carga que essa borda entrega à viga, em kN/m.
      </p>
      <p style={li}>
        <b style={{ color: 'var(--text)' }}>Vigas:</b> o número na ponta é a reação no apoio, em kN. Em{' '}
        <span style={{ color: UP }}>azul</span>, viga apoiada em outra viga.
      </p>
      <p style={li}>
        <b style={{ color: 'var(--text)' }}>Pilares:</b> “+” é o que chega neste pavimento e “N” é o
        acumulado na base do tramo, em kN.
      </p>
      <p style={li}>
        Clique num elemento para ver de onde vem a carga dele (<span style={{ color: UP }}>azul</span>) e
        para onde ela vai (<span style={{ color: DOWN }}>laranja</span>).
      </p>
      {schematic && (
        <p style={{ ...li, color: 'var(--text-faint)' }}>
          Neste pavimento há lajes calculadas pela grelha ou de contorno não retangular: a divisão
          pontilhada é só esquemática; os valores são os da análise.
        </p>
      )}
    </div>
  )
}

function Details({
  lp,
  el,
  byKey,
  levels,
  up,
  down,
  onPick,
}: {
  lp: LoadPath
  el: LoadPathElement
  byKey: Map<string, LoadPathElement>
  levels: { name: string }[]
  up: Set<string>
  down: Set<string>
  onPick: (key: string | null) => void
}) {
  const levelName = (i: number) => levels[i]?.name ?? ''
  const title = (e: LoadPathElement): string =>
    e.kind === 'column'
      ? `${e.name} — tramo sob ${levelName(e.levelIndex)}`
      : e.kind === 'foundation' || e.kind === 'soil'
        ? e.name
        : `${e.name} — ${levelName(e.levelIndex)}`
  const inflow = lp.flows.filter((f) => f.to === el.key).sort((a, b) => b.value - a.value)
  const outflow = lp.flows.filter((f) => f.from === el.key).sort((a, b) => b.value - a.value)
  const foundations = [...down]
    .map((k) => byKey.get(k))
    .filter((e): e is LoadPathElement => e?.kind === 'foundation')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  const sources = [...up].map((k) => byKey.get(k)).filter((e): e is LoadPathElement => !!e)
  const count = (kind: LoadPathElement['kind']) => sources.filter((e) => e.kind === kind).length

  const row = (f: LoadPathFlow, other: string, color: string) => {
    const o = byKey.get(other)
    if (!o) return null
    return (
      <button
        key={`${f.from}>${f.to}>${f.levelIndex}`}
        type="button"
        className="lp-row"
        onClick={() => onPick(o.key)}
        title="Selecionar este elemento"
      >
        <span style={{ width: 7, height: 7, borderRadius: 4, background: color, flex: 'none' }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title(o)}
        </span>
        <b className="mono">{fmt(f.value, 1)}</b>
      </button>
    )
  }
  const head: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: 'var(--text-dim)',
    margin: '12px 0 4px',
    fontFamily: 'var(--mono)',
  }
  const line: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }

  return (
    <div data-testid="load-path-details">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="chip">{KIND_LABEL[el.kind]}</span>
        <b style={{ fontSize: 13 }}>{title(el)}</b>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11, height: 22 }} onClick={() => onPick(null)}>
          limpar
        </button>
      </div>

      {el.parts.length > 0 && (
        <>
          <div style={head}>
            <span>Carga no próprio elemento</span>
            <span>{fmt(el.own, 1)} kN</span>
          </div>
          {el.parts.map((p) => (
            <div key={p.label} style={line}>
              <span className="muted">{p.label}</span>
              <span className="mono">{fmt(p.value, 1)}</span>
            </div>
          ))}
        </>
      )}
      {el.lost ? (
        <div className="chip warn" style={{ marginTop: 8, height: 'auto', padding: '4px 8px', whiteSpace: 'normal' }}>
          {fmt(el.lost, 1)} kN sem viga nem pilar que receba — não entram no pórtico
        </div>
      ) : null}

      <div style={head}>
        <span style={{ color: UP }}>Recebe de</span>
        <span>{fmt(el.received, 1)} kN</span>
      </div>
      {inflow.length === 0 ? (
        <div className="faint" style={{ fontSize: 11.5 }}>
          {el.kind === 'slab' ? 'É a origem da carga.' : 'Nada.'}
        </div>
      ) : (
        inflow.map((f) => row(f, f.from, UP))
      )}

      <div style={head}>
        <span style={{ color: DOWN }}>Entrega a</span>
        <span>{fmt(el.delivered, 1)} kN</span>
      </div>
      {outflow.length === 0 ? (
        <div className="faint" style={{ fontSize: 11.5 }}>
          {el.kind === 'foundation' || el.kind === 'soil' ? 'É o destino final: vai para o terreno.' : 'Nada.'}
        </div>
      ) : (
        outflow.map((f) => row(f, f.to, DOWN))
      )}

      {el.kind === 'column' && (
        <>
          <div style={head}>
            <span>Normal no tramo</span>
          </div>
          <div style={line}>
            <span className="muted">no topo</span>
            <span className="mono">{fmt(el.nTop ?? 0, 1)} kN</span>
          </div>
          <div style={line}>
            <span className="muted">na base (com o peso do tramo)</span>
            <span className="mono">{fmt(el.nBase ?? 0, 1)} kN</span>
          </div>
        </>
      )}

      <div style={head}>
        <span>Caminho completo</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {sources.length > 0 ? (
          <div>
            <span style={{ color: UP }}>A montante:</span>{' '}
            {[
              [count('slab'), 'laje', 'lajes'],
              [count('beam'), 'viga', 'vigas'],
              [count('column'), 'tramo de pilar', 'tramos de pilar'],
            ]
              .filter(([n]) => (n as number) > 0)
              .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
              .join(', ')}
          </div>
        ) : (
          <div>Nenhum elemento a montante.</div>
        )}
        {foundations.length > 0 && (
          <div>
            <span style={{ color: DOWN }}>Chega ao terreno por:</span>{' '}
            {foundations.map((f, i) => (
              <span key={f.key}>
                {i > 0 ? ', ' : ''}
                <a
                  role="button"
                  style={{ color: 'var(--text)', cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => onPick(f.key)}
                >
                  {f.name.replace('Fundação de ', '')}
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// descida de cargas nos pilares
// ---------------------------------------------------------------------------

function Descent({
  lp,
  li,
  picked,
  onPick,
}: {
  lp: LoadPath
  li: number
  picked: string | null
  onPick: (key: string | null) => void
}) {
  // pavimentos que recebem carga, de cima para baixo
  const levelIdx = useMemo(() => {
    const set = new Set<number>()
    for (const c of lp.columns) for (const s of c.steps) set.add(s.levelIndex)
    return [...set].sort((a, b) => b - a)
  }, [lp])
  if (lp.columns.length === 0) return null
  const totals = levelIdx.map((L) =>
    lp.columns.reduce((s, c) => s + (c.steps.find((x) => x.levelIndex === L && !x.key.endsWith('|-1'))?.nBase ?? 0), 0),
  )
  const totalFdn = lp.columns.reduce((s, c) => s + (c.foundation ?? 0), 0)
  const num: CSSProperties = { textAlign: 'right' }
  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 18 }}>
        Descida de cargas nos pilares — {lp.label}
      </h3>
      <div className="faint" style={{ fontSize: 11, margin: '-4px 0 8px' }}>
        Normal na base de cada tramo, em kN (acumulado de cima para baixo). Entre parênteses, o que o
        pavimento acrescenta: reações das vigas e lajes apoiadas direto no pilar. Clique para ver o tramo.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" data-testid="load-path-descent">
          <thead>
            <tr>
              <th>Pilar</th>
              {levelIdx.map((L) => (
                <th key={L} style={{ ...num, color: L === li ? 'var(--accent)' : undefined }}>
                  {lp.levels[L]?.name ?? L}
                </th>
              ))}
              <th style={num}>Fundação</th>
            </tr>
          </thead>
          <tbody>
            {lp.columns.map((c) => (
              <tr key={c.columnId}>
                <td>
                  <b>{c.name}</b>
                </td>
                {levelIdx.map((L) => {
                  const s = c.steps.find((x) => x.levelIndex === L && !x.key.endsWith('|-1'))
                  if (!s) return <td key={L} style={num} className="faint">—</td>
                  const add = s.fromBeams + s.fromSlabs
                  return (
                    <td
                      key={L}
                      style={{
                        ...num,
                        cursor: 'pointer',
                        background: s.key === picked ? 'var(--accent-soft)' : undefined,
                      }}
                      title={`de cima ${fmt(s.fromAbove, 1)} + vigas ${fmt(s.fromBeams, 1)} + lajes ${fmt(s.fromSlabs, 1)} + peso próprio ${fmt(s.own, 1)} = ${fmt(s.nBase, 1)} kN`}
                      onClick={() => onPick(s.key)}
                    >
                      <span className="faint">({add >= 0 ? '+' : ''}{fmt(add, 0)})</span> <b>{fmt(s.nBase, 0)}</b>
                    </td>
                  )
                })}
                <td style={num}>{c.foundation === null ? '—' : fmt(c.foundation, 1)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Soma</b>
              </td>
              {totals.map((t, i) => (
                <td key={levelIdx[i]} style={num}>
                  <b>{fmt(t, 0)}</b>
                </td>
              ))}
              <td style={num}>
                <b>{fmt(totalFdn, 1)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
