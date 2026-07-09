import { memo } from 'react'
import { polygonCentroid, type LoadRegion } from '@hyperframe/engine'
import { fmt } from '../format'

interface Props {
  regions: LoadRegion[]
  k: number
  selectedId: string | null
  hoveredId: string | null
}

/** regiões de carga (escada/reservatório…): polígono tracejado + rótulo "nome / g,q" no centroide */
export default memo(function RegionsLayer({ regions, k, selectedId, hoveredId }: Props) {
  return (
    <g>
      {regions.map((rg) => {
        const pts = rg.polygon.map((p) => `${p.x * k},${-p.y * k}`).join(' ')
        const cen = polygonCentroid(rg.polygon)
        const cx = cen.x * k
        const cy = -cen.y * k
        const sel = rg.id === selectedId
        const hov = rg.id === hoveredId && !sel
        return (
          <g key={rg.id}>
            {hov && (
              <polygon points={pts} fill="none" stroke="var(--blue)" strokeWidth={5} opacity={0.3} />
            )}
            <polygon
              points={pts}
              fill="rgba(255,160,40,0.08)"
              stroke={sel ? 'var(--sel)' : hov ? 'var(--blue)' : 'var(--accent)'}
              strokeWidth={sel ? 2.5 : 1.5}
              strokeDasharray="4 2"
            />
            {k >= 9 && (
              <text x={cx} y={cy} textAnchor="middle" fontSize={11} fill="var(--accent)">
                <tspan x={cx} dy="-0.15em">
                  {rg.name}
                </tspan>
                <tspan x={cx} dy="1.35em" fontSize={9}>
                  g={fmt(rg.g, 1)} q={fmt(rg.q, 1)} kN/m²
                </tspan>
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
