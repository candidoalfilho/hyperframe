import type { ReactElement } from 'react'
import { dist, type SectionRect, type Vec2 } from '@hyperframe/engine'
import type { Tool } from '../../store'
import type { SnapKind } from '../snap'
import { fmt } from '../format'

export interface CursorSnap {
  point: Vec2
  kind: SnapKind | null
}

interface Props {
  tool: Tool
  k: number
  cursor: CursorSnap | null
  chain: Vec2[]
  columnSection: SectionRect
  columnRotation: 0 | 90
}

/** pré-visualizações das ferramentas: fantasma do pilar, polilinha da viga/região, marcador de snap */
export default function PreviewLayer({
  tool,
  k,
  cursor,
  chain,
  columnSection,
  columnRotation,
}: Props) {
  if (!cursor && chain.length === 0) return null
  const parts: ReactElement[] = []

  if (tool === 'column' && cursor) {
    const w = (columnRotation === 0 ? columnSection.h : columnSection.bw) * k
    const h = (columnRotation === 0 ? columnSection.bw : columnSection.h) * k
    parts.push(
      <rect
        key="ghost"
        x={cursor.point.x * k - w / 2}
        y={-cursor.point.y * k - h / 2}
        width={w}
        height={h}
        fill="rgba(170,179,197,0.30)"
        stroke="var(--accent)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />,
    )
  }

  if (tool === 'beam' || tool === 'region') {
    const isRegion = tool === 'region'
    if (chain.length > 0) {
      const pts = chain.map((p) => `${p.x * k},${-p.y * k}`).join(' ')
      // fantasma do polígono da região (contorno atual + cursor)
      if (isRegion && chain.length >= 2) {
        const fillPts = cursor ? `${pts} ${cursor.point.x * k},${-cursor.point.y * k}` : pts
        parts.push(
          <polygon key="ghost" points={fillPts} fill="rgba(255,160,40,0.08)" stroke="none" />,
        )
      }
      parts.push(
        <polyline
          key="chain"
          points={pts}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.6}
          strokeDasharray={isRegion ? '4 2' : undefined}
        />,
      )
      chain.forEach((p, i) =>
        parts.push(
          isRegion ? (
            <circle key={`v${i}`} cx={p.x * k} cy={-p.y * k} r={3} fill="var(--accent)" />
          ) : (
            <rect
              key={`v${i}`}
              x={p.x * k - 3}
              y={-p.y * k - 3}
              width={6}
              height={6}
              fill="var(--accent)"
            />
          ),
        ),
      )
      if (cursor) {
        const last = chain[chain.length - 1]
        const L = dist(last, cursor.point)
        const ax = last.x * k
        const ay = -last.y * k
        const bx = cursor.point.x * k
        const by = -cursor.point.y * k
        parts.push(
          <line
            key="rubber"
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke="var(--accent)"
            strokeWidth={1.2}
            strokeDasharray="6 4"
          />,
        )
        if (L > 1e-6) {
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          let deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
          if (deg > 90) deg -= 180
          if (deg <= -90) deg += 180
          parts.push(
            <g key="len" transform={`translate(${mx} ${my}) rotate(${deg})`}>
              <text y={-7} textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--accent)">
                {fmt(L)} m
              </text>
            </g>,
          )
        }
        // prévia da aresta de fechamento até o primeiro ponto
        if (isRegion && chain.length >= 2) {
          parts.push(
            <line
              key="close"
              x1={bx}
              y1={by}
              x2={chain[0].x * k}
              y2={-chain[0].y * k}
              stroke="var(--accent)"
              strokeWidth={1.2}
              strokeDasharray="6 4"
              opacity={0.45}
            />,
          )
        }
      }
    } else if (cursor) {
      parts.push(
        <circle key="cur" cx={cursor.point.x * k} cy={-cursor.point.y * k} r={2} fill="var(--accent)" />,
      )
    }
  }

  if (cursor && cursor.kind) {
    parts.push(
      <SnapMarker key="snap" x={cursor.point.x * k} y={-cursor.point.y * k} kind={cursor.kind} />,
    )
  }

  return <g pointerEvents="none">{parts}</g>
}

/** marcador de snap (tamanhos fixos em px): ▢ interseção/extremidade · ◯ pilar · △ meio · × projeção */
function SnapMarker({ x, y, kind }: { x: number; y: number; kind: SnapKind }) {
  const c = 'var(--accent)'
  switch (kind) {
    case 'intersection':
    case 'endpoint':
      return <rect x={x - 5} y={y - 5} width={10} height={10} fill="none" stroke={c} strokeWidth={1.5} />
    case 'column':
      return <circle cx={x} cy={y} r={6} fill="none" stroke={c} strokeWidth={1.5} />
    case 'midpoint':
      return (
        <polygon
          points={`${x},${y - 6} ${x - 6},${y + 5} ${x + 6},${y + 5}`}
          fill="none"
          stroke={c}
          strokeWidth={1.5}
        />
      )
    default: // 'axis' | 'online'
      return (
        <g stroke={c} strokeWidth={1.5}>
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
          <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} />
        </g>
      )
  }
}
