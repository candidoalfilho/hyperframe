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
        // unidirecional (treliçada/nervurada): linhas no sentido das vigotas
        const oneWay = sl.ribbed && sl.ribbed.dirs !== 'xy' ? sl.ribbed.dirs : null
        const step = oneWay ? Math.max(sl.ribbed!.spacing * k, 5) : 0
        const fillId = oneWay ? `hf2d-joist-${sl.id}` : 'hf2d-hatch'
        return (
          <g key={sl.id}>
            {oneWay && (
              <defs>
                <pattern id={fillId} width={step} height={step} patternUnits="userSpaceOnUse">
                  <line
                    x1={oneWay === 'x' ? 0 : step / 2}
                    y1={oneWay === 'x' ? step / 2 : 0}
                    x2={oneWay === 'x' ? step : step / 2}
                    y2={oneWay === 'x' ? step / 2 : step}
                    stroke={sl.ribbed!.lattice ? 'var(--accent)' : '#5a6a8a'}
                    strokeWidth={1}
                    opacity={sl.ribbed!.lattice ? 0.45 : 0.6}
                  />
                </pattern>
              </defs>
            )}
            {hov && <polygon points={pts} fill="none" stroke="var(--blue)" strokeWidth={5} opacity={0.3} />}
            <polygon points={pts} fill={sel ? 'rgba(77,163,255,0.14)' : 'rgba(90,110,150,0.10)'} />
            <polygon
              points={pts}
              fill={`url(#${fillId})`}
              stroke={sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#3a4050'}
              strokeWidth={sel ? 2.5 : 1}
            />
            {k >= 9 && (
              <text x={cx} y={cy} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
                <tspan x={cx} dy="-0.15em">
                  {sl.name}
                </tspan>
                <tspan x={cx} dy="1.25em">
                  {sl.ribbed?.lattice ? (sl.ribbed.label ?? `h=${cm(sl.thickness)}`) : `h=${cm(sl.thickness)}`}
                </tspan>
                {oneWay && (
                  <tspan x={cx} dy="1.25em" fill={sl.ribbed!.lattice ? 'var(--accent)' : undefined}>
                    {oneWay === 'x' ? '⟷' : '↕'} {sl.ribbed!.lattice ? 'vigotas' : 'nervuras'}
                  </tspan>
                )}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})
