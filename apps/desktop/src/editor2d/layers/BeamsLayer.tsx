import { memo, type ReactElement } from 'react'
import type { Beam } from '@hyperframe/engine'
import { sectionLabel } from '../format'

interface Props {
  beams: Beam[]
  k: number
  showNames: boolean
  selectedId: string | null
  hoveredId: string | null
}

/** vigas: contorno duplo ±bw/2 + linha de centro tracejada + rótulo rotacionado */
export default memo(function BeamsLayer({ beams, k, showNames, selectedId, hoveredId }: Props) {
  const withNames = showNames && k >= 8
  return (
    <g>
      {beams.map((b) => (
        <BeamGlyph
          key={b.id}
          beam={b}
          k={k}
          showName={withNames}
          sel={b.id === selectedId}
          hov={b.id === hoveredId && b.id !== selectedId}
        />
      ))}
    </g>
  )
})

function BeamGlyph({
  beam,
  k,
  showName,
  sel,
  hov,
}: {
  beam: Beam
  k: number
  showName: boolean
  sel: boolean
  hov: boolean
}) {
  const half = (beam.section.bw / 2) * k
  const edge = sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#7d879c'
  const edgeW = sel ? 2.5 : 1
  const center = sel ? 'var(--sel)' : hov ? 'var(--blue)' : '#566078'

  const parts: ReactElement[] = []
  let longest = -1
  let li = 0
  for (let i = 0; i + 1 < beam.path.length; i++) {
    const a = beam.path[i]
    const c = beam.path[i + 1]
    const ax = a.x * k
    const ay = -a.y * k
    const cx = c.x * k
    const cy = -c.y * k
    const dx = cx - ax
    const dy = cy - ay
    const L = Math.hypot(dx, dy)
    if (L < 1e-9) continue
    if (L > longest) {
      longest = L
      li = i
    }
    const nx = (-dy / L) * half
    const ny = (dx / L) * half
    parts.push(
      <g key={i}>
        {(sel || hov) && (
          <line
            x1={ax}
            y1={ay}
            x2={cx}
            y2={cy}
            stroke={sel ? 'var(--sel)' : 'var(--blue)'}
            strokeWidth={half * 2 + 8}
            opacity={sel ? 0.14 : 0.16}
            strokeLinecap="round"
          />
        )}
        <line x1={ax + nx} y1={ay + ny} x2={cx + nx} y2={cy + ny} stroke={edge} strokeWidth={edgeW} />
        <line x1={ax - nx} y1={ay - ny} x2={cx - nx} y2={cy - ny} stroke={edge} strokeWidth={edgeW} />
        <line x1={ax} y1={ay} x2={cx} y2={cy} stroke={center} strokeWidth={1} strokeDasharray="4 2" />
      </g>,
    )
  }

  let label: ReactElement | null = null
  if (showName && longest > 30) {
    const a = beam.path[li]
    const c = beam.path[li + 1]
    const ax = a.x * k
    const ay = -a.y * k
    const cx = c.x * k
    const cy = -c.y * k
    const mx = (ax + cx) / 2
    const my = (ay + cy) / 2
    let deg = (Math.atan2(cy - ay, cx - ax) * 180) / Math.PI
    if (deg > 90) deg -= 180
    if (deg <= -90) deg += 180
    label = (
      <g transform={`translate(${mx} ${my}) rotate(${deg})`}>
        <text y={-(half + 4)} textAnchor="middle" fontSize={10} fill="var(--text-dim)">
          {beam.name} {sectionLabel(beam.section)}
        </text>
      </g>
    )
  }

  return (
    <g>
      {parts}
      {label}
    </g>
  )
}
