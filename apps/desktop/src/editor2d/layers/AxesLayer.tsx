import { memo } from 'react'
import type { GridAxis } from '@hyperframe/engine'
import { fmt } from '../format'

const AXIS_STROKE = '#3a4050'
/** raio das bolhas de eixo, fixo em px de tela */
const R = 11

interface Props {
  xAxes: GridAxis[]
  yAxes: GridAxis[]
  k: number
  showDims: boolean
  /** bbox do conteúdo já estendida ~2 m (coords de mundo) */
  x0: number
  y0: number
  x1: number
  y1: number
}

function Bubble({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={R} fill="var(--bg-1)" stroke={AXIS_STROKE} strokeWidth={1.2} />
      <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={11} fill="var(--text-dim)">
        {label}
      </text>
    </g>
  )
}

/** eixos da grelha (A,B,C… verticais / 1,2,3… horizontais) com bolhas e cotas */
export default memo(function AxesLayer({ xAxes, yAxes, k, showDims, x0, y0, x1, y1 }: Props) {
  // tela: y invertido (mundo +y ↑)
  const top = -y1 * k
  const bottom = -y0 * k
  const left = x0 * k
  const right = x1 * k
  const xs = [...xAxes].sort((a, b) => a.pos - b.pos)
  const ys = [...yAxes].sort((a, b) => a.pos - b.pos)

  return (
    <g>
      {xs.map((a) => {
        const X = a.pos * k
        return (
          <g key={a.id}>
            <line
              x1={X}
              y1={top + R}
              x2={X}
              y2={bottom - R}
              stroke={AXIS_STROKE}
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <Bubble x={X} y={top} label={a.label} />
            <Bubble x={X} y={bottom} label={a.label} />
          </g>
        )
      })}
      {ys.map((a) => {
        const Y = -a.pos * k
        return (
          <g key={a.id}>
            <line
              x1={left + R}
              y1={Y}
              x2={right - R}
              y2={Y}
              stroke={AXIS_STROKE}
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <Bubble x={left} y={Y} label={a.label} />
            <Bubble x={right} y={Y} label={a.label} />
          </g>
        )
      })}

      {/* cotas entre eixos adjacentes, junto às bolhas */}
      {showDims &&
        xs.slice(1).map((a, i) => {
          const prev = xs[i]
          const gap = a.pos - prev.pos
          if (gap * k < 48) return null
          const mx = ((a.pos + prev.pos) / 2) * k
          return (
            <text
              key={a.id}
              x={mx}
              y={top}
              dy="0.35em"
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--mono)"
              fill="var(--text-dim)"
            >
              {fmt(gap)}
            </text>
          )
        })}
      {showDims &&
        ys.slice(1).map((a, i) => {
          const prev = ys[i]
          const gap = a.pos - prev.pos
          if (gap * k < 48) return null
          const my = -((a.pos + prev.pos) / 2) * k
          return (
            <text
              key={a.id}
              transform={`translate(${left} ${my}) rotate(-90)`}
              dy="0.35em"
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--mono)"
              fill="var(--text-dim)"
            >
              {fmt(gap)}
            </text>
          )
        })}
    </g>
  )
})
