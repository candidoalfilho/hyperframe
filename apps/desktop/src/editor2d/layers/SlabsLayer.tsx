import { memo } from 'react'
import { polygonCentroid, type Slab } from '@hyperframe/engine'
import { cm } from '../format'

interface Props {
  slabs: Slab[]
  k: number
  selectedId: string | null
  hoveredId: string | null
}

/** lajes: polígono com hachura diagonal + rótulo central "L1 / h=12" */
export default memo(function SlabsLayer({ slabs, k, selectedId, hoveredId }: Props) {
  return (
    <g>
      <defs>
        <pattern
          id="hf2d-hatch"
          width={10}
          height={10}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={10} stroke="#3a4050" strokeWidth={1} opacity={0.4} />
        </pattern>
      </defs>
      {slabs.map((sl) => {
        const pts = sl.polygon.map((p) => `${p.x * k},${-p.y * k}`).join(' ')
        const cen = polygonCentroid(sl.polygon)
        const cx = cen.x * k
        const cy = -cen.y * k
        const sel = sl.id === selectedId
        const hov = sl.id === hoveredId && !sel
        return (
          <g key={sl.id}>
            {hov && <polygon points={pts} fill="none" stroke="var(--blue)" strokeWidth={5} opacity={0.3} />}
            <polygon points={pts} fill={sel ? 'rgba(77,163,255,0.14)' : 'rgba(90,110,150,0.10)'} />
            <polygon
              points={pts}
              fill="url(#hf2d-hatch)"
              stroke={sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#3a4050'}
              strokeWidth={sel ? 2.5 : 1}
            />
            {k >= 9 && (
              <text x={cx} y={cy} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
                <tspan x={cx} dy="-0.15em">
                  {sl.name}
                </tspan>
                <tspan x={cx} dy="1.25em">
                  h={cm(sl.thickness)}
                </tspan>
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
