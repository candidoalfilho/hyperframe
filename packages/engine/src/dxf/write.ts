/**
 * Gerador de DXF R12 (AC1009) mínimo.
 *
 * R12 é o denominador comum dos leitores (AutoCAD, LibreCAD, QCAD, DWG
 * TrueView…): dispensa HANDLES, seção OBJECTS e estilos, e qualquer
 * visualizador o abre. Coordenadas em metros ($INSUNITS = 6), eixo Y para
 * cima — o mesmo sistema das primitivas de desenho, sem espelhamento.
 *
 * Simplificações assumidas: `dashed` e `filled` são atributos visuais do app
 * e não são exportados (traço contínuo, círculo sem hachura) — a camada já
 * carrega a semântica do elemento.
 */

import type { DDim, Drawing } from '../drawing/types'

/** camadas fixas do HyperFrame → cor ACI (AutoCAD Color Index) */
const LAYERS: ReadonlyArray<readonly [string, number]> = [
  ['CONTORNO', 7],
  ['EIXOS', 8],
  ['PILARES', 1],
  ['VIGAS', 3],
  ['LAJES', 5],
  ['COTAS', 2],
  ['TEXTOS', 7],
  ['ARMADURA', 1],
  ['ESTRIBOS', 3],
  ['MARGEM', 8],
]

/** número com até 6 casas decimais, sem notação científica */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const s = n
    .toFixed(6)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

export function writeDxf(drawing: Drawing): string {
  const out: string[] = []
  /** emite um par código/valor; quebras de linha no valor corromperiam o arquivo */
  const g = (code: number, value: string): void => {
    out.push(String(code), value.replace(/[\r\n]+/g, ' '))
  }
  const gn = (code: number, value: number): void => {
    out.push(String(code), fmt(value))
  }

  const emitLine = (x1: number, y1: number, x2: number, y2: number, layer: string): void => {
    g(0, 'LINE')
    g(8, layer)
    gn(10, x1)
    gn(20, y1)
    gn(30, 0)
    gn(11, x2)
    gn(21, y2)
    gn(31, 0)
  }

  const emitText = (
    x: number,
    y: number,
    text: string,
    height: number,
    layer: string,
    rotation: number,
    align: 'left' | 'center' | 'right',
  ): void => {
    g(0, 'TEXT')
    g(8, layer)
    gn(10, x)
    gn(20, y)
    gn(30, 0)
    gn(40, height)
    g(1, text)
    gn(50, rotation)
    if (align !== 'left') {
      // alinhamento horizontal exige o ponto de alinhamento nos grupos 11/21
      g(72, align === 'center' ? '1' : '2')
      gn(11, x)
      gn(21, y)
      gn(31, 0)
    }
  }

  /**
   * Cota linear decomposta em primitivas (sem entidade DIMENSION do DXF, que
   * exigiria estilos e blocos anônimos): linha de cota afastada `offset` na
   * perpendicular, duas linhas de chamada, traços a 45° nas extremidades
   * (estilo ABNT) e texto centrado acima da linha.
   */
  const emitDim = (d: DDim): void => {
    const dx = d.x2 - d.x1
    const dy = d.y2 - d.y1
    const len = Math.hypot(dx, dy)
    // altura explícita (escala com a prancha) ou, na ausência, proporcional
    // ao afastamento dentro de limites legíveis — mesma regra do DrawingSvg
    const height = d.height ?? Math.min(0.3, Math.max(0.1, Math.abs(d.offset) * 0.55))
    if (len < 1e-9) {
      emitText(d.x1, d.y1, d.text, height, d.layer, 0, 'center')
      return // cota degenerada: só o texto
    }
    const ux = dx / len
    const uy = dy / len
    // normal = direção do segmento girada +90° (anti-horário)
    const nx = -uy
    const ny = ux
    const ox = nx * d.offset
    const oy = ny * d.offset
    // linha de cota
    const ax = d.x1 + ox
    const ay = d.y1 + oy
    const bx = d.x2 + ox
    const by = d.y2 + oy
    emitLine(ax, ay, bx, by, d.layer)
    // linhas de chamada, do ponto medido até um pouco além da linha de cota
    const ext = 1.1
    emitLine(d.x1, d.y1, d.x1 + ox * ext, d.y1 + oy * ext, d.layer)
    emitLine(d.x2, d.y2, d.x2 + ox * ext, d.y2 + oy * ext, d.layer)
    // traços a 45° (bissetriz entre a direção da cota e a normal),
    // comprimento total ≈ altura do texto
    const t = height / 2
    const tx = (ux + nx) / Math.SQRT2
    const ty = (uy + ny) / Math.SQRT2
    emitLine(ax - tx * t, ay - ty * t, ax + tx * t, ay + ty * t, d.layer)
    emitLine(bx - tx * t, by - ty * t, bx + tx * t, by + ty * t, d.layer)
    // texto no meio, afastado mais 0,4·|offset| além da linha de cota
    const sgn = d.offset < 0 ? -1 : 1
    const k = d.offset + 0.4 * Math.abs(d.offset) * sgn
    const mx = (d.x1 + d.x2) / 2 + nx * k
    const my = (d.y1 + d.y2) / 2 + ny * k
    // texto ao longo do segmento, virado para manter a leitura em pé
    let ang = (Math.atan2(uy, ux) * 180) / Math.PI
    if (ang > 90 || ang <= -90) ang += 180
    if (ang > 180) ang -= 360
    emitText(mx, my, d.text, height, d.layer, ang, 'center')
  }

  // ---- comentário de origem (grupo 999 é ignorado por todos os leitores) ----
  g(999, `HyperFrame — ${drawing.title}`)

  // ---- HEADER ----
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009') // R12
  g(9, '$INSUNITS')
  g(70, '6') // 6 = metros
  g(0, 'ENDSEC')

  // ---- TABLES ----
  g(0, 'SECTION')
  g(2, 'TABLES')
  // LTYPE CONTINUOUS primeiro: leitores estritos exigem o tipo de linha
  // referenciado pelas camadas
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, '1')
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, '0')
  g(3, 'Linha continua')
  g(72, '65')
  g(73, '0')
  g(40, '0')
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, String(LAYERS.length))
  for (const [name, color] of LAYERS) {
    g(0, 'LAYER')
    g(2, name)
    g(70, '0')
    g(62, String(color))
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // ---- ENTITIES ----
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const p of drawing.primitives) {
    switch (p.kind) {
      case 'line':
        emitLine(p.x1, p.y1, p.x2, p.y2, p.layer)
        break
      case 'polyline': {
        g(0, 'POLYLINE')
        g(8, p.layer)
        g(66, '1') // vértices seguem em entidades VERTEX
        g(70, p.closed === true ? '1' : '0')
        for (const pt of p.points) {
          g(0, 'VERTEX')
          g(8, p.layer)
          gn(10, pt.x)
          gn(20, pt.y)
          gn(30, 0)
        }
        g(0, 'SEQEND')
        g(8, p.layer)
        break
      }
      case 'circle':
        g(0, 'CIRCLE')
        g(8, p.layer)
        gn(10, p.cx)
        gn(20, p.cy)
        gn(30, 0)
        gn(40, p.r)
        break
      case 'text':
        emitText(p.x, p.y, p.text, p.height, p.layer, p.rotation ?? 0, p.align ?? 'left')
        break
      case 'dim':
        emitDim(p)
        break
    }
  }
  g(0, 'ENDSEC')

  g(0, 'EOF')
  return out.join('\n') + '\n'
}
