import { memo, useMemo, type ReactElement } from 'react'
import type { DxfUnderlay, UnderlayEntity } from '@hyperframe/engine'

/** teto de entidades renderizadas — protege o SVG de arquivos gigantes */
const MAX_RENDER = 20_000
const STROKE = '#6b7284'

/** arredonda a 0,1 mm de mundo — strings mais curtas no JSX estático */
function rd(v: number): number {
  return Math.round(v * 10000) / 10000
}

/**
 * Uma entidade DXF em coords de MUNDO (m, +y↑): world = offset + scale·raw.
 * O flip de y fica no transform do grupo pai (`scale(k -k)`).
 */
function entityEl(
  e: UnderlayEntity,
  sc: number,
  offX: number,
  offY: number,
  key: number,
): ReactElement | null {
  const mx = (v: number) => rd(offX + v * sc)
  const my = (v: number) => rd(offY + v * sc)
  switch (e.type) {
    case 'line':
      return (
        <line
          key={key}
          x1={mx(e.x1 ?? 0)}
          y1={my(e.y1 ?? 0)}
          x2={mx(e.x2 ?? 0)}
          y2={my(e.y2 ?? 0)}
        />
      )
    case 'polyline': {
      const pts = e.points ?? []
      if (pts.length < 2) return null
      const s = pts.map((p) => `${mx(p.x)},${my(p.y)}`).join(' ')
      return e.closed ? <polygon key={key} points={s} /> : <polyline key={key} points={s} />
    }
    case 'circle':
      return <circle key={key} cx={mx(e.cx ?? 0)} cy={my(e.cy ?? 0)} r={rd((e.r ?? 0) * sc)} />
    case 'arc': {
      const cx = offX + (e.cx ?? 0) * sc
      const cy = offY + (e.cy ?? 0) * sc
      const r = (e.r ?? 0) * sc
      const a1 = e.a1 ?? 0
      const a2 = e.a2 ?? 0
      // arco de a1 → a2 em graus, CCW (convenção DXF)
      const delta = (((a2 - a1) % 360) + 360) % 360
      const large = delta > 180 ? 1 : 0
      const r1 = (a1 * Math.PI) / 180
      const r2 = (a2 * Math.PI) / 180
      // em coords locais y↑ (flip no grupo pai), CCW ⇔ sweep=1
      const d =
        `M ${rd(cx + r * Math.cos(r1))} ${rd(cy + r * Math.sin(r1))} ` +
        `A ${rd(r)} ${rd(r)} 0 ${large} 1 ${rd(cx + r * Math.cos(r2))} ${rd(cy + r * Math.sin(r2))}`
      return <path key={key} d={d} />
    }
    case 'text': {
      if (!e.text) return null
      const rot = e.rotation ?? 0
      // scale(1 -1) desfaz o flip do grupo — texto em pé; rotate em graus CCW de mundo
      const tf =
        `translate(${mx(e.x ?? 0)} ${my(e.y ?? 0)})` +
        (rot ? ` rotate(${rd(rot)})` : '') +
        ' scale(1 -1)'
      return (
        <text key={key} transform={tf} fontSize={(e.height ?? 0.25) * sc} fill={STROKE} stroke="none">
          {e.text}
        </text>
      )
    }
    default:
      return null
  }
}

interface Props {
  underlay: DxfUnderlay
  k: number
}

/**
 * Underlay DXF: referência visual desenhada ABAIXO da grade.
 * O JSX das entidades é estático (coords de mundo, memoizado) — zoom e opacidade
 * mudam só os atributos do <g>, sem re-renderizar milhares de elementos.
 */
export default memo(function UnderlayLayer({ underlay, k }: Props) {
  const { entities, scale, offset } = underlay
  const content = useMemo<ReactElement[]>(() => {
    const els: ReactElement[] = []
    const n = Math.min(entities.length, MAX_RENDER)
    for (let i = 0; i < n; i++) {
      const el = entityEl(entities[i], scale, offset.x, offset.y, i)
      if (el) els.push(el)
    }
    return els
  }, [entities, scale, offset.x, offset.y])

  return (
    <g
      transform={`scale(${k} ${-k})`}
      opacity={underlay.opacity}
      stroke={STROKE}
      strokeWidth={1 / k}
      fill="none"
      pointerEvents="none"
    >
      {content}
    </g>
  )
})
