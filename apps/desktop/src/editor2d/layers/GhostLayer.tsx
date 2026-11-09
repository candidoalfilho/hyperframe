import { memo } from 'react'
import type { AiGhost } from '../../store'

/**
 * Pré-visualização fantasma — proposta do Copiloto pendente de aprovação OU
 * arrasto de elemento em andamento: tracejado pulsante em coords de mundo × k
 * (y invertido), como os demais layers.
 * mode 'add' = laranja (posição nova); 'target' = vermelho (será alterado/removido).
 */
export default memo(function GhostLayer({ ghost, k }: { ghost: AiGhost; k: number }) {
  const color = ghost.mode === 'add' ? 'var(--accent)' : 'var(--err)'
  const pts = ghost.pts
  if (pts.length === 0) return null
  const anchor = pts[0]

  return (
    <g style={{ pointerEvents: 'none' }}>
      <style>{`@keyframes hf-ghost-dash { to { stroke-dashoffset: -16; } }`}</style>
      {ghost.kind === 'column' && (
        <>
          <circle
            cx={anchor.x * k}
            cy={-anchor.y * k}
            r={Math.max(0.18 * k, 7)}
            fill={color}
            opacity={0.18}
          />
          <circle
            cx={anchor.x * k}
            cy={-anchor.y * k}
            r={Math.max(0.18 * k, 7)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="6 4"
            style={{ animation: 'hf-ghost-dash 0.8s linear infinite' }}
          />
        </>
      )}
      {ghost.kind === 'beam' && (
        <polyline
          points={pts.map((p) => `${p.x * k},${-p.y * k}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={Math.max((ghost.bw ?? 0.2) * k, 4)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10 6"
          opacity={0.75}
          style={{ animation: 'hf-ghost-dash 0.8s linear infinite' }}
        />
      )}
      {ghost.kind === 'slab' && (
        <polygon
          points={pts.map((p) => `${p.x * k},${-p.y * k}`).join(' ')}
          fill={color}
          fillOpacity={0.12}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="8 5"
          style={{ animation: 'hf-ghost-dash 0.8s linear infinite' }}
        />
      )}
      <text
        x={anchor.x * k}
        y={-anchor.y * k - Math.max(0.25 * k, 14)}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill={color}
        style={{ fontFamily: 'var(--mono)' }}
      >
        {ghost.label}
      </text>
    </g>
  )
})
