import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { DDim, Drawing, DrawingLayer } from '@hyperframe/engine'

/**
 * Visualizador de desenho técnico (primitivas do engine → SVG).
 *  - mundo: metros, +y para CIMA · tela: px, +y para baixo
 *  - enquadra ao montar/trocar de desenho, zoom na roda (no cursor),
 *    pan por arrasto e duplo clique para reenquadrar
 */

const LAYER_COLORS: Record<DrawingLayer, string> = {
  CONTORNO: '#e8eaf0',
  EIXOS: '#8b93a7',
  PILARES: '#ffd9a8',
  VIGAS: '#aab3c5',
  LAJES: '#7d879c',
  COTAS: '#4da3ff',
  TEXTOS: '#e8eaf0',
  ARMADURA: '#ff8a5c',
  ESTRIBOS: '#3ecf8e',
  MARGEM: '#566078',
}

/** espessura de traço (px) por camada — armadura mais grossa, como em prancha */
const STROKE: Partial<Record<DrawingLayer, number>> = {
  ARMADURA: 2.2,
  EIXOS: 1,
  MARGEM: 1,
  COTAS: 1,
}

interface Vp {
  k: number // px por metro
  ox: number // origem do mundo na tela, px
  oy: number
}

const clampK = (k: number): number => Math.min(5000, Math.max(0.5, k))

function fitViewport(b: Drawing['bounds'], w: number, h: number): Vp {
  const dx = Math.max(b.maxX - b.minX, 1e-3)
  const dy = Math.max(b.maxY - b.minY, 1e-3)
  const m = 24
  const k = clampK(Math.min(Math.max(w - 2 * m, 40) / dx, Math.max(h - 2 * m, 40) / dy))
  return {
    k,
    ox: w / 2 - ((b.minX + b.maxX) / 2) * k,
    oy: h / 2 + ((b.minY + b.maxY) / 2) * k,
  }
}

/** mantém o texto em pé: ângulo equivalente em (−90°, 90°] */
function uprightDeg(rot: number): number {
  let a = ((rot % 360) + 360) % 360
  if (a > 90 && a <= 270) a -= 180
  else if (a > 270) a -= 360
  return a
}

interface DimText {
  x: number
  y: number
  text: string
  height: number
  rotation: number
}

interface DimParts {
  lines: [number, number, number, number][]
  text: DimText
}

/** decompõe a cota em linha + chamadas + traços 45° + texto — mesma regra do dxf/write.ts */
function decomposeDim(d: DDim): DimParts {
  const dx = d.x2 - d.x1
  const dy = d.y2 - d.y1
  const len = Math.hypot(dx, dy)
  const height = d.height ?? Math.min(0.3, Math.max(0.1, Math.abs(d.offset) * 0.55))
  if (len < 1e-9) {
    return { lines: [], text: { x: d.x1, y: d.y1, text: d.text, height, rotation: 0 } }
  }
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const ox = nx * d.offset
  const oy = ny * d.offset
  const ax = d.x1 + ox
  const ay = d.y1 + oy
  const bx = d.x2 + ox
  const by = d.y2 + oy
  const lines: [number, number, number, number][] = [
    [ax, ay, bx, by], // linha de cota
    [d.x1, d.y1, d.x1 + ox * 1.1, d.y1 + oy * 1.1], // chamadas
    [d.x2, d.y2, d.x2 + ox * 1.1, d.y2 + oy * 1.1],
  ]
  const t = height / 2
  const tx = (ux + nx) / Math.SQRT2
  const ty = (uy + ny) / Math.SQRT2
  lines.push([ax - tx * t, ay - ty * t, ax + tx * t, ay + ty * t])
  lines.push([bx - tx * t, by - ty * t, bx + tx * t, by + ty * t])
  const sgn = d.offset < 0 ? -1 : 1
  const kk = d.offset + 0.4 * Math.abs(d.offset) * sgn
  return {
    lines,
    text: {
      x: (d.x1 + d.x2) / 2 + nx * kk,
      y: (d.y1 + d.y2) / 2 + ny * kk,
      text: d.text,
      height,
      rotation: (Math.atan2(uy, ux) * 180) / Math.PI,
    },
  }
}

export default function DrawingSvg({ drawing }: { drawing: Drawing }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [vp, setVp] = useState<Vp>({ k: 50, ox: 40, oy: 400 })
  const [panning, setPanning] = useState(false)
  const fittedFor = useRef<Drawing | null>(null)
  const panRef = useRef<{ id: number; x: number; y: number } | null>(null)

  // tamanho do container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // enquadra ao montar / ao trocar de desenho
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return
    if (fittedFor.current === drawing) return
    fittedFor.current = drawing
    setVp(fitViewport(drawing.bounds, size.w, size.h))
  }, [drawing, size])

  // zoom na roda mantendo o ponto sob o cursor (listener nativo p/ preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      setVp((v) => {
        const k = clampK(v.k * Math.pow(1.0015, -e.deltaY))
        if (k === v.k) return v
        const r = k / v.k
        return { k, ox: sx - (sx - v.ox) * r, oy: sy - (sy - v.oy) * r }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const X = (x: number): number => vp.ox + x * vp.k
  const Y = (y: number): number => vp.oy - y * vp.k

  const textEl = (
    key: string,
    x: number,
    y: number,
    text: string,
    height: number,
    color: string,
    rotation = 0,
    align: 'left' | 'center' | 'right' = 'left',
  ): ReactElement => {
    const a = uprightDeg(rotation)
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    return (
      <text
        key={key}
        // rotação do mundo é anti-horária; na tela (y p/ baixo) o sinal inverte
        transform={`translate(${X(x)} ${Y(y)}) rotate(${-a})`}
        fontSize={height * vp.k}
        fontFamily="var(--mono)"
        fill={color}
        textAnchor={anchor}
      >
        {text}
      </text>
    )
  }

  const els: ReactElement[] = []
  drawing.primitives.forEach((p, i) => {
    const color = LAYER_COLORS[p.layer]
    const sw = STROKE[p.layer] ?? 1.2
    switch (p.kind) {
      case 'line':
        els.push(
          <line
            key={i}
            x1={X(p.x1)}
            y1={Y(p.y1)}
            x2={X(p.x2)}
            y2={Y(p.y2)}
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={p.dashed ? '6 4' : undefined}
            strokeLinecap="round"
          />,
        )
        break
      case 'polyline': {
        const pts = p.points.map((pt) => `${X(pt.x)},${Y(pt.y)}`).join(' ')
        // "aspecto preenchido": polilinhas fechadas de PILARES ganham fill
        const fill = p.closed && p.layer === 'PILARES' ? color : 'none'
        els.push(
          p.closed ? (
            <polygon
              key={i}
              points={pts}
              fill={fill}
              stroke={color}
              strokeWidth={sw}
              strokeDasharray={p.dashed ? '6 4' : undefined}
              strokeLinejoin="round"
            />
          ) : (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeDasharray={p.dashed ? '6 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )
        break
      }
      case 'circle':
        els.push(
          <circle
            key={i}
            cx={X(p.cx)}
            cy={Y(p.cy)}
            r={p.r * vp.k}
            fill={p.filled ? color : 'none'}
            stroke={color}
            strokeWidth={sw}
          />,
        )
        break
      case 'text':
        els.push(textEl(String(i), p.x, p.y, p.text, p.height, color, p.rotation ?? 0, p.align ?? 'left'))
        break
      case 'dim': {
        const parts = decomposeDim(p)
        parts.lines.forEach(([x1, y1, x2, y2], j) => {
          els.push(
            <line
              key={`${i}-${j}`}
              x1={X(x1)}
              y1={Y(y1)}
              x2={X(x2)}
              y2={Y(y2)}
              stroke={color}
              strokeWidth={sw}
              strokeLinecap="round"
            />,
          )
        })
        const t = parts.text
        els.push(textEl(`${i}-t`, t.x, t.y, t.text, t.height, color, t.rotation, 'center'))
        break
      }
    }
  })

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--canvas-bg)',
        overflow: 'hidden',
        cursor: panning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <svg
        width="100%"
        height="100%"
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return
          e.currentTarget.setPointerCapture(e.pointerId)
          panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
          setPanning(true)
        }}
        onPointerMove={(e) => {
          const pan = panRef.current
          if (!pan || pan.id !== e.pointerId) return
          const dx = e.clientX - pan.x
          const dy = e.clientY - pan.y
          pan.x = e.clientX
          pan.y = e.clientY
          setVp((v) => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }))
        }}
        onPointerUp={(e) => {
          if (panRef.current?.id === e.pointerId) {
            panRef.current = null
            setPanning(false)
          }
        }}
        onPointerCancel={() => {
          panRef.current = null
          setPanning(false)
        }}
        onDoubleClick={() => {
          if (size.w > 0) setVp(fitViewport(drawing.bounds, size.w, size.h))
        }}
      >
        {els}
      </svg>
    </div>
  )
}
