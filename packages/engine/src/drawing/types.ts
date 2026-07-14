/**
 * Primitivas neutras de desenho técnico — renderizadas em SVG (app) e
 * exportadas em DXF. Coordenadas em METROS no plano do desenho (y p/ cima).
 */

export type DrawingLayer =
  | 'EIXOS'
  | 'PILARES'
  | 'VIGAS'
  | 'LAJES'
  | 'COTAS'
  | 'TEXTOS'
  | 'ARMADURA'
  | 'ESTRIBOS'
  | 'CONTORNO'
  | 'MARGEM'

export interface DLine {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  layer: DrawingLayer
  /** tracejada (eixos etc.) */
  dashed?: boolean
}

export interface DPolyline {
  kind: 'polyline'
  points: { x: number; y: number }[]
  closed?: boolean
  layer: DrawingLayer
  dashed?: boolean
}

export interface DCircle {
  kind: 'circle'
  cx: number
  cy: number
  r: number
  layer: DrawingLayer
  filled?: boolean
}

export interface DText {
  kind: 'text'
  x: number
  y: number
  text: string
  /** altura da fonte em m do desenho */
  height: number
  layer: DrawingLayer
  /** rotação em graus (ccw) */
  rotation?: number
  align?: 'left' | 'center' | 'right'
}

/** cota linear simples (linha + traços + texto no meio) */
export interface DDim {
  kind: 'dim'
  x1: number
  y1: number
  x2: number
  y2: number
  /** afastamento da linha de cota (perpendicular, m) */
  offset: number
  /**
   * altura do texto da cota, m (mesma unidade das coordenadas). Escala junto
   * com o conteúdo na prancha (composeSheet divide por k, como DText.height).
   * Ausente: derivada do |offset| (compatibilidade com desenhos antigos).
   */
  height?: number
  text: string
  layer: DrawingLayer
}

export type DrawingPrimitive = DLine | DPolyline | DCircle | DText | DDim

export interface Drawing {
  title: string
  primitives: DrawingPrimitive[]
  /** bounding box em m */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
