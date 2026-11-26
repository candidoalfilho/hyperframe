import { memo, type ReactElement } from 'react'
import type { AnalysisModel } from '@hyperframe/engine'

interface Props {
  model: AnalysisModel
  /** índice (ordenado por cota) do nível ativo */
  levelIndex: number
  k: number
}

/**
 * Braços rígidos viga–pilar do modelo analisado (issue #13): do centro de
 * gravidade do pilar (cruz) ao extremo flexível da viga (ponto), com a
 * excentricidade transversal e o trecho rígido longitudinal cotados em cm.
 */
export default memo(function RigidArmsLayer({ model, levelIndex, k }: Props) {
  const parts: ReactElement[] = []
  const color = '#e6883c'
  const seen = new Set<string>()
  /** um rótulo por pilar: valores distintos de excentricidade e de trecho rígido */
  const labels = new Map<number, Set<string>>()
  for (const m of model.members) {
    if (m.ref.kind !== 'beam') continue
    for (const [nodeId, off] of [
      [m.ni, m.offI],
      [m.nj, m.offJ],
    ] as const) {
      if (!off) continue
      const n = model.nodes[nodeId]
      if (n.levelIndex !== levelIndex) continue
      // vãos consecutivos da mesma viga compartilham o braço no pilar
      const key = `${nodeId}|${off[0].toFixed(3)}|${off[1].toFixed(3)}`
      if (seen.has(key)) continue
      seen.add(key)
      const cx = n.x * k
      const cy = -n.y * k
      const ex = (n.x + off[0]) * k
      const ey = -(n.y + off[1]) * k
      // decomposição no eixo da viga: longitudinal (trecho rígido) e transversal (excentricidade)
      const along = off[0] * m.xLocal[0] + off[1] * m.xLocal[1]
      const ecc = Math.hypot(off[0] - along * m.xLocal[0], off[1] - along * m.xLocal[1])
      const set = labels.get(nodeId) ?? new Set<string>()
      if (ecc > 0.005) set.add(`e = ${(ecc * 100).toFixed(0)}`)
      if (Math.abs(along) > 0.005) set.add(`rígido ${(Math.abs(along) * 100).toFixed(0)}`)
      labels.set(nodeId, set)
      parts.push(
        <g key={`${m.id}-${nodeId}-${key}`}>
          <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth={3} strokeLinecap="round" />
          <path
            d={`M${cx - 5},${cy}H${cx + 5}M${cx},${cy - 5}V${cy + 5}`}
            stroke={color}
            strokeWidth={1.4}
            fill="none"
          />
          <circle cx={ex} cy={ey} r={3} fill={color} stroke="var(--bg-0, #0f1218)" strokeWidth={1} />
        </g>
      )
    }
  }
  if (k > 45) {
    for (const [nodeId, set] of labels) {
      if (set.size === 0) continue
      const n = model.nodes[nodeId]
      parts.push(
        <text
          key={`t${nodeId}`}
          x={n.x * k + 9}
          y={-n.y * k - 9}
          fontSize={10.5}
          fill={color}
          stroke="var(--bg-0, #0f1218)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}
        >
          {[...set].sort().join(' · ')} cm
        </text>,
      )
    }
  }
  if (parts.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{parts}</g>
})
