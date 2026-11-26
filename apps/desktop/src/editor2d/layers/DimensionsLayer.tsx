import { memo, type ReactElement } from 'react'
import { dimensionLayout, type DimStyle, type Dimension } from '@hyperframe/engine'
import { dimTextHeight } from '../dimTool'

interface Props {
  dimensions: Dimension[]
  style: DimStyle
  k: number
  selectedIds: string[]
  hoveredId: string | null
  /** ids das cotas com alguma referência perdida */
  lostIds: string[]
  /** cota em criação ou em arrasto (tracejada, não interativa) */
  preview?: Dimension | null
}

const COLOR = '#3fb8af'

/**
 * Cotas permanentes (issue #10): mesma geometria das pranchas
 * (`dimensionLayout`), com o texto em tamanho legível na tela.
 */
export default memo(function DimensionsLayer({
  dimensions,
  style,
  k,
  selectedIds,
  hoveredId,
  lostIds,
  preview,
}: Props) {
  const h = dimTextHeight(style, k)
  const px = h * k

  const draw = (d: Dimension, mode: 'normal' | 'sel' | 'hov' | 'preview'): ReactElement | null => {
    if (d.points.length < 2) return null
    const lay = dimensionLayout(d, style, h)
    const lost = lostIds.includes(d.id)
    const color = mode === 'sel' ? 'var(--sel)' : mode === 'hov' ? 'var(--blue)' : lost ? 'var(--warn)' : COLOR
    const w = mode === 'sel' ? 1.8 : 1.1
    const dash = mode === 'preview' ? '5 4' : lost ? '3 3' : undefined
    const { u, n } = lay
    const X = (v: number) => v * k
    const Y = (v: number) => -v * k
    return (
      <g key={`${d.id}:${mode}`} opacity={d.hidden && mode !== 'sel' ? 0.4 : 1} data-dim={d.id}>
        {lay.lines.map((l, i) => (
          <line
            key={`l${i}`}
            x1={X(l.a.x)}
            y1={Y(l.a.y)}
            x2={X(l.b.x)}
            y2={Y(l.b.y)}
            stroke={color}
            strokeWidth={l.role === 'dim' ? w : w * 0.8}
            strokeOpacity={l.role === 'dim' ? 1 : 0.75}
            strokeDasharray={dash}
          />
        ))}
        {lay.marks.map((m, i) => {
          const cx = X(m.at.x)
          const cy = Y(m.at.y)
          if (m.origin)
            return <circle key={`m${i}`} cx={cx} cy={cy} r={0.3 * px} fill="var(--canvas-bg)" stroke={color} strokeWidth={w} />
          if (style.terminator === 'dot') return <circle key={`m${i}`} cx={cx} cy={cy} r={0.2 * px} fill={color} />
          if (style.terminator === 'arrow')
            return (
              <g key={`m${i}`}>
                {m.dirs.map((dir) => {
                  const bx = m.at.x + u.x * dir * 0.9 * h
                  const by = m.at.y + u.y * dir * 0.9 * h
                  return (
                    <polygon
                      key={dir}
                      points={`${cx},${cy} ${X(bx + n.x * 0.16 * h)},${Y(by + n.y * 0.16 * h)} ${X(bx - n.x * 0.16 * h)},${Y(by - n.y * 0.16 * h)}`}
                      fill={color}
                    />
                  )
                })}
              </g>
            )
          // traço a 45°
          const tx = ((u.x + n.x) / Math.SQRT2) * 0.5 * px
          const ty = ((u.y + n.y) / Math.SQRT2) * 0.5 * px
          return <line key={`m${i}`} x1={cx - tx} y1={cy + ty} x2={cx + tx} y2={cy - ty} stroke={color} strokeWidth={w * 1.3} />
        })}
        {lay.labels.map((t, i) => (
          <text
            key={`t${i}`}
            // rotação do mundo é anti-horária; na tela (y p/ baixo) o sinal inverte
            transform={`translate(${X(t.x)} ${Y(t.y)}) rotate(${-t.angleDeg})`}
            fontSize={px}
            textAnchor={t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start'}
            fill={color}
            fontWeight={mode === 'sel' ? 700 : 500}
            stroke="var(--canvas-bg)"
            strokeWidth={3}
            paintOrder="stroke"
            style={{ fontFamily: 'var(--mono)' }}
          >
            {t.text}
          </text>
        ))}
      </g>
    )
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      {dimensions.map((d) =>
        draw(d, selectedIds.includes(d.id) ? 'sel' : d.id === hoveredId ? 'hov' : 'normal'),
      )}
      {preview && draw(preview, 'preview')}
    </g>
  )
})
