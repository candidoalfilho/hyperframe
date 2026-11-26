import { memo } from 'react'
import { slabLoadG, type SlabLoad } from '@hyperframe/engine'
import { fmt } from '../format'

interface Props {
  loads: SlabLoad[]
  k: number
  selectedId: string | null
  hoveredId: string | null
}

/**
 * Cargas sobre lajes (issue #8): pontual = alvo com seta p/ baixo e valor em
 * kN; linear = traço grosso tracejado com valor em kN/m.
 */
export default memo(function SlabLoadsLayer({ loads, k, selectedId, hoveredId }: Props) {
  return (
    <g>
      {loads.map((l) => {
        const sel = l.id === selectedId
        const hov = l.id === hoveredId && !sel
        const color = sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#e05a9c'
        const g = slabLoadG(l)
        const value = `${fmt(g + l.q, 1)} ${l.kind === 'line' ? 'kN/m' : 'kN'}`
        const ax = l.a.x * k
        const ay = -l.a.y * k
        if (l.kind === 'line' && l.b) {
          const bx = l.b.x * k
          const by = -l.b.y * k
          const len = Math.hypot(bx - ax, by - ay) || 1
          // normal p/ o rótulo, sempre do lado "de cima" da tela
          let nx = -(by - ay) / len
          let ny = (bx - ax) / len
          if (ny > 0 || (Math.abs(ny) < 1e-9 && nx > 0)) {
            nx = -nx
            ny = -ny
          }
          return (
            <g key={l.id}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={sel ? 5 : 4} strokeOpacity={0.35} strokeLinecap="round" />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={1.6} strokeDasharray="7 4" />
              <circle cx={ax} cy={ay} r={2.6} fill={color} />
              <circle cx={bx} cy={by} r={2.6} fill={color} />
              <text
                x={(ax + bx) / 2 + nx * 11}
                y={(ay + by) / 2 + ny * 11}
                fontSize={10.5}
                textAnchor="middle"
                dominantBaseline="central"
                fill={color}
                stroke="var(--bg-0, #0f1218)"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}
              >
                {l.name} · {value}
              </text>
            </g>
          )
        }
        return (
          <g key={l.id}>
            <circle cx={ax} cy={ay} r={sel ? 9 : 7.5} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} />
            <path d={`M${ax},${ay - 4.5}V${ay + 3}M${ax - 3},${ay + 0.5}L${ax},${ay + 4.5}L${ax + 3},${ay + 0.5}`} stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text
              x={ax + 12}
              y={ay - 9}
              fontSize={10.5}
              fill={color}
              stroke="var(--bg-0, #0f1218)"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}
            >
              {l.name} · {value}
            </text>
          </g>
        )
      })}
    </g>
  )
})
