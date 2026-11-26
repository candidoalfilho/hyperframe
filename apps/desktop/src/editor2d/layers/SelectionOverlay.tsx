import { memo, type ReactElement } from 'react'
import {
  columnFootprint,
  simplifyPolygon,
  type Column,
  type ElementRef,
  type FloorPlan,
  type Vec2,
} from '@hyperframe/engine'
import { fmt } from '../format'

interface Props {
  /** seleção múltipla (≥ 2) a realçar */
  refs: ElementRef[]
  /** seleção simples: laje/viga/região ganham as cotas dos lados */
  single: ElementRef | null
  columns: Column[]
  plan: FloorPlan | null
  k: number
  marquee: { a: Vec2; b: Vec2; crossing: boolean } | null
}

const pts = (poly: Vec2[], k: number) => poly.map((p) => `${p.x * k},${-p.y * k}`).join(' ')

/** cota (comprimento em m) no meio de cada trecho, deslocada p/ fora da linha */
function edgeDims(points: Vec2[], closed: boolean, k: number, key: string): ReactElement[] {
  const out: ReactElement[] = []
  const n = points.length
  const cx = points.reduce((s, p) => s + p.x, 0) / n
  const cy = points.reduce((s, p) => s + p.y, 0) / n
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len * k < 34) continue // trecho curto demais na tela p/ caber o texto
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // normal apontando p/ dentro do polígono (lajes) — texto fica sobre a laje
    let nx = -(b.y - a.y) / len
    let ny = (b.x - a.x) / len
    if (closed && (cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    const x = mx * k + nx * 13
    const y = -my * k - ny * 13
    const label = `${fmt(len, 2)} m`
    out.push(
      <g key={`${key}-${i}`}>
        <rect
          x={x - label.length * 3.3 - 3}
          y={y - 8}
          width={label.length * 6.6 + 6}
          height={15}
          rx={3}
          fill="var(--bg-1)"
          opacity={0.88}
        />
        <text
          x={x}
          y={y}
          dy="0.32em"
          textAnchor="middle"
          fontSize={10.5}
          fontFamily="var(--mono)"
          fill="var(--sel)"
        >
          {label}
        </text>
      </g>,
    )
  }
  return out
}

/**
 * Sobreposição da seleção: realce dos elementos da seleção múltipla, cotas
 * dos lados do elemento selecionado e a janela de seleção em andamento.
 */
export default memo(function SelectionOverlay({ refs, single, columns, plan, k, marquee }: Props) {
  const parts: ReactElement[] = []

  for (const r of refs) {
    if (r.kind === 'column') {
      const c = columns.find((x) => x.id === r.id)
      if (c)
        parts.push(
          <polygon
            key={`c-${r.id}`}
            points={pts(columnFootprint(c), k)}
            fill="rgba(77,163,255,0.25)"
            stroke="var(--sel)"
            strokeWidth={2.5}
          />,
        )
    } else if (r.kind === 'beam') {
      const b = plan?.beams.find((x) => x.id === r.id)
      if (b)
        parts.push(
          <polyline
            key={`b-${r.id}`}
            points={pts(b.path, k)}
            fill="none"
            stroke="var(--sel)"
            strokeWidth={Math.max(b.section.bw * k, 4) + 3}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.45}
          />,
        )
    } else if (r.kind === 'slabLoad') {
      const l = plan?.slabLoads?.find((x) => x.id === r.id)
      if (l && l.b)
        parts.push(
          <polyline
            key={`sl-${r.id}`}
            points={pts([l.a, l.b], k)}
            fill="none"
            stroke="var(--sel)"
            strokeWidth={8}
            strokeLinecap="round"
            opacity={0.45}
          />,
        )
      else if (l)
        parts.push(
          <circle
            key={`sl-${r.id}`}
            cx={l.a.x * k}
            cy={-l.a.y * k}
            r={12}
            fill="rgba(77,163,255,0.25)"
            stroke="var(--sel)"
            strokeWidth={2.5}
          />,
        )
    } else if (r.kind === 'slab' || r.kind === 'loadRegion') {
      const poly =
        r.kind === 'slab'
          ? plan?.slabs.find((x) => x.id === r.id)?.polygon
          : plan?.loadRegions.find((x) => x.id === r.id)?.polygon
      if (poly)
        parts.push(
          <polygon
            key={`${r.kind}-${r.id}`}
            points={pts(poly, k)}
            fill="rgba(77,163,255,0.12)"
            stroke="var(--sel)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />,
        )
    }
  }

  if (single && plan) {
    if (single.kind === 'slab') {
      const sl = plan.slabs.find((x) => x.id === single.id)
      if (sl) parts.push(...edgeDims(simplifyPolygon(sl.polygon), true, k, 'ds'))
    } else if (single.kind === 'loadRegion') {
      const rg = plan.loadRegions.find((x) => x.id === single.id)
      if (rg) parts.push(...edgeDims(rg.polygon, true, k, 'dr'))
    } else if (single.kind === 'beam') {
      const b = plan.beams.find((x) => x.id === single.id)
      if (b) parts.push(...edgeDims(b.path, false, k, 'db'))
    }
  }

  if (marquee) {
    const x = Math.min(marquee.a.x, marquee.b.x) * k
    const y = -Math.max(marquee.a.y, marquee.b.y) * k
    const w = Math.abs(marquee.b.x - marquee.a.x) * k
    const h = Math.abs(marquee.b.y - marquee.a.y) * k
    parts.push(
      <rect
        key="marquee"
        x={x}
        y={y}
        width={w}
        height={h}
        fill={marquee.crossing ? 'rgba(80,200,120,0.10)' : 'rgba(77,163,255,0.10)'}
        stroke={marquee.crossing ? '#50c878' : 'var(--sel)'}
        strokeWidth={1.2}
        strokeDasharray={marquee.crossing ? '5 4' : undefined}
      />,
    )
  }

  if (parts.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{parts}</g>
})
