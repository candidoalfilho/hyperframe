import { memo, type ReactElement } from 'react'

interface Props {
  w: number
  h: number
  k: number
  ox: number
  oy: number
}

/**
 * Grade de fundo: linhas finas a cada 0,5 m e mais fortes a cada 5 m.
 * Implementada com um único <pattern> de 5×5 m ancorado na origem do mundo
 * (patternTransform acompanha o pan/zoom) — O(1) elementos React.
 */
export default memo(function GridLayer({ w, h, k, ox, oy }: Props) {
  const tile = 5 * k
  const fine: ReactElement[] = []
  if (0.5 * k >= 7) {
    for (let i = 1; i <= 9; i++) {
      const t = i * 0.5 * k
      fine.push(
        <line key={`v${i}`} x1={t} y1={0} x2={t} y2={tile} stroke="var(--grid-line)" strokeWidth={1} />,
        <line key={`h${i}`} x1={0} y1={t} x2={tile} y2={t} stroke="var(--grid-line)" strokeWidth={1} />,
      )
    }
  }
  return (
    <g>
      <defs>
        <pattern
          id="hf2d-grid"
          width={tile}
          height={tile}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${ox} ${oy})`}
        >
          <g shapeRendering="crispEdges">
            {fine}
            {/* linhas fortes nas bordas do tile (metade em cada tile vizinho) */}
            <line x1={0} y1={0} x2={0} y2={tile} stroke="var(--border)" strokeWidth={1} />
            <line x1={tile} y1={0} x2={tile} y2={tile} stroke="var(--border)" strokeWidth={1} />
            <line x1={0} y1={0} x2={tile} y2={0} stroke="var(--border)" strokeWidth={1} />
            <line x1={0} y1={tile} x2={tile} y2={tile} stroke="var(--border)" strokeWidth={1} />
          </g>
        </pattern>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="url(#hf2d-grid)" />
    </g>
  )
})
