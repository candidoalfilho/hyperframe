import { memo } from 'react'
import {
  foundationShape,
  type Column,
  type FoundationResultItem,
} from '@hyperframe/engine'

interface Props {
  items: FoundationResultItem[]
  columns: Column[]
  k: number
}

const COLOR: Record<FoundationResultItem['status'], string> = {
  ok: '#8a93a6',
  atencao: '#c9a227',
  falha: '#d06565',
}

/** fundações em planta (nível térreo): contornos tracejados sob os pilares */
export default memo(function FoundationsLayer({ items, columns, k }: Props) {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const withLabel = k >= 18
  return (
    <g>
      {items.map((it) => {
        const col = byId.get(it.columnId)
        if (!col) return null
        const shape = foundationShape(it, col)
        if (!shape) return null
        const stroke = COLOR[it.status]
        const label = `${it.kind === 'sapata' ? 'S' : it.kind === 'bloco' ? 'B' : 'T'}${col.name.replace(/^\D+/, '')} ${shape.dims}`
        const yBottom = shape.polygon
          ? Math.min(...shape.polygon.map((p) => p.y))
          : shape.center.y - Math.max(...shape.circles.map((c) => c.r))
        return (
          <g key={it.columnId} pointerEvents="none">
            {shape.polygon && (
              <polygon
                points={shape.polygon.map((p) => `${p.x * k},${-p.y * k}`).join(' ')}
                fill="none"
                stroke={stroke}
                strokeWidth={1.2}
                strokeDasharray="6 4"
              />
            )}
            {shape.circles.map((c, i) => (
              <circle
                key={i}
                cx={c.c.x * k}
                cy={-c.c.y * k}
                r={c.r * k}
                fill="none"
                stroke={stroke}
                strokeWidth={1.2}
                strokeDasharray="4 3"
              />
            ))}
            {withLabel && (
              <text
                x={shape.center.x * k}
                y={-(yBottom - 0.12) * k}
                fontSize={10}
                fill={stroke}
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {label}
                {it.manual ? ' *' : ''}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
