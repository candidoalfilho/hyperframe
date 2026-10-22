import { memo } from 'react'
import { columnFootprint, columnHalfExtents, columnSectionLabel, type Column } from '@hyperframe/engine'

interface Props {
  columns: Column[]
  k: number
  showNames: boolean
  selectedId: string | null
  hoveredId: string | null
}

/** pilares: seção real (retângulo, círculo ou L) centrada no centróide */
export default memo(function ColumnsLayer({ columns, k, showNames, selectedId, hoveredId }: Props) {
  const withLabel = showNames && k >= 12
  return (
    <g>
      {columns.map((c) => {
        const sel = c.id === selectedId
        const hov = c.id === hoveredId && !sel
        const fill = sel ? 'var(--el-column-sel)' : 'var(--el-column-fill)'
        const stroke = sel ? 'var(--sel)' : hov ? 'var(--blue)' : 'var(--el-column-stroke)'
        const sw = sel ? 2.5 : 1.5
        const { dx, dy } = columnHalfExtents(c)
        const isCircle = c.section.shape === 'circle'
        const pts = isCircle
          ? ''
          : columnFootprint(c)
              .map((p) => `${p.x * k},${-p.y * k}`)
              .join(' ')
        return (
          <g key={c.id}>
            {hov &&
              (isCircle ? (
                <circle
                  cx={c.pos.x * k}
                  cy={-c.pos.y * k}
                  r={dx * k + 3}
                  fill="none"
                  stroke="var(--blue)"
                  strokeWidth={5}
                  opacity={0.35}
                />
              ) : (
                <rect
                  x={c.pos.x * k - dx * k - 3}
                  y={-c.pos.y * k - dy * k - 3}
                  width={dx * 2 * k + 6}
                  height={dy * 2 * k + 6}
                  rx={2}
                  fill="none"
                  stroke="var(--blue)"
                  strokeWidth={5}
                  opacity={0.35}
                />
              ))}
            {isCircle ? (
              <circle
                cx={c.pos.x * k}
                cy={-c.pos.y * k}
                r={dx * k}
                fill={fill}
                stroke={stroke}
                strokeWidth={sw}
              />
            ) : (
              <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
            )}
            {withLabel && (
              <text
                x={c.pos.x * k}
                y={-c.pos.y * k + dy * k + 12}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-dim)"
              >
                {c.name} {columnSectionLabel(c.section)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
