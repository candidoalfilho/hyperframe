import { memo, type ReactElement } from 'react'
import type { Beam, WallLoad } from '@hyperframe/engine'
import { fmt } from '../format'

interface Props {
  wallLoads: WallLoad[]
  beams: Beam[]
  k: number
  selectedId: string | null
  hoveredId: string | null
}

/** cargas de alvenaria: "pente" de tracinhos na linha de centro da viga + valor em kN/m */
export default memo(function WallLoadsLayer({ wallLoads, beams, k, selectedId, hoveredId }: Props) {
  const byId = new Map(beams.map((b) => [b.id, b]))
  return (
    <g>
      {wallLoads.map((wl) => {
        const beam = byId.get(wl.beamId)
        if (!beam) return null
        return (
          <WallGlyph
            key={wl.id}
            wl={wl}
            beam={beam}
            k={k}
            sel={wl.id === selectedId}
            hov={wl.id === hoveredId && wl.id !== selectedId}
          />
        )
      })}
    </g>
  )
})

function WallGlyph({
  wl,
  beam,
  k,
  sel,
  hov,
}: {
  wl: WallLoad
  beam: Beam
  k: number
  sel: boolean
  hov: boolean
}) {
  const color = sel ? 'var(--sel)' : hov ? 'var(--blue)' : 'var(--accent)'
  const half = (beam.section.bw / 2) * k
  const ticks: ReactElement[] = []

  let longest = -1
  let lmx = 0
  let lmy = 0
  let lnx = 0
  let lny = 1

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
    const nx = -dy / L
    const ny = dx / L
    if (L > longest) {
      longest = L
      lmx = (ax + cx) / 2
      lmy = (ay + cy) / 2
      lnx = nx
      lny = ny
    }
    // tracinhos a cada ~0,4 m (mínimo 9 px na tela), centrados no trecho
    const step = Math.max(0.4 * k, 9)
    const count = Math.floor(L / step)
    const pad = (L - count * step) / 2
    for (let j = 0; j <= count; j++) {
      const s = count === 0 ? L / 2 : pad + j * step
      if (s > L + 1e-6) break
      const px = ax + (dx * s) / L
      const py = ay + (dy * s) / L
      ticks.push(
        <line
          key={`${i}-${j}`}
          x1={px - nx * 4.5}
          y1={py - ny * 4.5}
          x2={px + nx * 4.5}
          y2={py + ny * 4.5}
          stroke={color}
          strokeWidth={sel ? 1.8 : 1.1}
          opacity={0.9}
        />,
      )
    }
  }

  // rótulo no meio do trecho mais longo, deslocado para o lado "de baixo" da tela
  let ox = lnx
  let oy = lny
  if (oy < -1e-9 || (Math.abs(oy) < 1e-9 && ox < 0)) {
    ox = -ox
    oy = -oy
  }
  const off = half + 13

  return (
    <g>
      {ticks}
      {longest > 26 && (
        <text
          x={lmx + ox * off}
          y={lmy + oy * off}
          dy="0.35em"
          textAnchor="middle"
          fontSize={9}
          fontFamily="var(--mono)"
          fill={color}
        >
          {fmt(wl.w, 1)} kN/m
        </text>
      )}
    </g>
  )
}
