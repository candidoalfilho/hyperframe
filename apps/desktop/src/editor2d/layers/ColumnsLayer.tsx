import { memo } from 'react'
import type { Column } from '@hyperframe/engine'
import { sectionLabel } from '../format'

interface Props {
  columns: Column[]
  k: number
  showNames: boolean
  selectedId: string | null
  hoveredId: string | null
}

/** pilares: retângulo preenchido centrado em pos (rotationDeg 0 → h ao longo de X) */
export default memo(function ColumnsLayer({ columns, k, showNames, selectedId, hoveredId }: Props) {
  const withLabel = showNames && k >= 12
  return (
    <g>
      {columns.map((c) => {
        const w = (c.rotationDeg === 0 ? c.section.h : c.section.bw) * k
        const h = (c.rotationDeg === 0 ? c.section.bw : c.section.h) * k
        const x = c.pos.x * k - w / 2
        const y = -c.pos.y * k - h / 2
        const sel = c.id === selectedId
        const hov = c.id === hoveredId && !sel
        return (
          <g key={c.id}>
            {hov && (
              <rect
                x={x - 3}
                y={y - 3}
                width={w + 6}
                height={h + 6}
                rx={2}
                fill="none"
                stroke="var(--blue)"
                strokeWidth={5}
                opacity={0.35}
              />
            )}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={sel ? '#bfd4f2' : '#aab3c5'}
              stroke={sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#d7dce6'}
              strokeWidth={sel ? 2.5 : 1.5}
            />
            {withLabel && (
              <text
                x={c.pos.x * k}
                y={y + h + 12}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-dim)"
              >
                {c.name} {sectionLabel(c.section)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
