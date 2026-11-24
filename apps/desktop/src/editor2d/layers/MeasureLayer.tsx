import { memo, type ReactElement } from 'react'
import type { Vec2 } from '@hyperframe/engine'
import { fmt } from '../format'

interface Props {
  /** pontos já clicados */
  points: Vec2[]
  /** cursor (com snap) — trecho em andamento; null = medição concluída */
  cursor: Vec2 | null
  k: number
}

/**
 * Ferramenta de medição: polilinha com a distância de cada trecho (e Δx/Δy
 * nos oblíquos). O acumulado fica no painel fixo do editor (Editor2D).
 */
export default memo(function MeasureLayer({ points, cursor, k }: Props) {
  const all = cursor && points.length > 0 ? [...points, cursor] : points
  if (all.length === 0) return null
  const parts: ReactElement[] = []
  const color = '#50c878'

  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i]
    const b = all[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) continue
    const live = cursor !== null && i === all.length - 2
    const ax = a.x * k
    const ay = -a.y * k
    const bx = b.x * k
    const by = -b.y * k
    // normal na tela, sempre p/ o lado "de cima"
    let nx = -(by - ay) / (len * k)
    let ny = (bx - ax) / (len * k)
    if (ny > 0 || (Math.abs(ny) < 1e-9 && nx > 0)) {
      nx = -nx
      ny = -ny
    }
    const mx = (ax + bx) / 2 + nx * 14
    const my = (ay + by) / 2 + ny * 14
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    const oblique = dx > 0.005 && dy > 0.005
    const label = `${fmt(len, 2)} m${oblique ? `  (Δx ${fmt(dx, 2)} · Δy ${fmt(dy, 2)})` : ''}`
    parts.push(
      <g key={`s-${i}`}>
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray={live ? '6 4' : undefined}
        />
        {/* traços de cota nas extremidades */}
        <line x1={ax - nx * 6} y1={ay - ny * 6} x2={ax + nx * 6} y2={ay + ny * 6} stroke={color} strokeWidth={1.4} />
        <line x1={bx - nx * 6} y1={by - ny * 6} x2={bx + nx * 6} y2={by + ny * 6} stroke={color} strokeWidth={1.4} />
        <rect
          x={mx - label.length * 3.3 - 4}
          y={my - 9}
          width={label.length * 6.6 + 8}
          height={17}
          rx={3}
          fill="var(--bg-1)"
          opacity={0.92}
        />
        <text x={mx} y={my} dy="0.32em" textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill={color} fontWeight={600}>
          {label}
        </text>
      </g>,
    )
  }

  for (let i = 0; i < points.length; i++) {
    parts.push(<circle key={`p-${i}`} cx={points[i].x * k} cy={-points[i].y * k} r={3.2} fill={color} />)
  }

  return <g style={{ pointerEvents: 'none' }}>{parts}</g>
})
