/**
 * Leitor de DXF ASCII (pares código de grupo / valor) para underlay 2D.
 *
 * Escopo deliberadamente pequeno: LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND,
 * CIRCLE, ARC, TEXT, MTEXT e INSERT (com expansão de blocos). Todo o resto
 * (HATCH, DIMENSION, SPLINE, xrefs…) é ignorado em silêncio — o underlay é
 * apenas referência visual para modelar a estrutura por cima.
 *
 * As coordenadas são repassadas CRUAS, sem conversão de unidade: o DXF não
 * garante unidade ($INSUNITS raramente é confiável em arquivos reais), então
 * o app aplica o fator de escala escolhido pelo usuário após a importação.
 */

import type { UnderlayEntity, Vec2 } from '../model/types'

/** teto de entidades — suficiente para underlay sem estourar memória */
const MAX_ENTITIES = 50_000

/** profundidade máxima de INSERT aninhado (bloco dentro de bloco) */
const MAX_INSERT_DEPTH = 4

interface Pair {
  code: number
  value: string
}

/** INSERT ainda não expandido (representação interna do parser) */
interface RawInsert {
  type: 'insert'
  block: string
  x: number
  y: number
  sx: number
  sy: number
  rotation: number
  layer?: string
}

type RawEntity = UnderlayEntity | RawInsert

interface BlockDef {
  /** ponto-base do bloco (grupos 10/20 do BLOCK) — origem usada no INSERT */
  baseX: number
  baseY: number
  entities: RawEntity[]
}

export function parseDxf(text: string): UnderlayEntity[] {
  const pairs = toPairs(text)
  const blocks = new Map<string, BlockDef>()
  const raw: RawEntity[] = []
  let sawSection = false

  let i = 0
  while (i < pairs.length) {
    const p = pairs[i]
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      sawSection = true
      const nx = pairs[i + 1]
      const hasName = nx !== undefined && nx.code === 2
      const secName = hasName ? nx.value.trim() : ''
      i += hasName ? 2 : 1
      if (secName === 'BLOCKS') i = parseBlocksSection(pairs, i, blocks)
      else if (secName === 'ENTITIES') i = parseEntityList(pairs, i, 'ENDSEC', raw)
      else i = skipSection(pairs, i)
    } else {
      i++
    }
  }

  if (!sawSection) throw new Error('Arquivo DXF inválido')

  // Expande INSERTs em geometria concreta (blocos referenciados → transformados)
  const out: UnderlayEntity[] = []
  for (const e of raw) {
    if (out.length >= MAX_ENTITIES) break
    if (e.type === 'insert') expandInsert(e, blocks, 1, out)
    else out.push(e)
  }
  return out
}

// ---------------------------------------------------------------------------
// Tokenização — o DXF ASCII é uma sequência estrita de pares (linha com o
// código de grupo, linha com o valor). Aceita \r\n, \r ou \n. Linhas de
// código ilegíveis são puladas preservando o pareamento: arquivo malformado
// ⇒ lê-se o que der, nunca lança por código desconhecido.
// ---------------------------------------------------------------------------

function toPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/)
  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10)
    if (Number.isNaN(code)) continue
    pairs.push({ code, value: lines[i + 1] })
  }
  return pairs
}

function pf(value: string): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/** coleta os grupos de uma entidade: tudo até o próximo código 0 (exclusive) */
function readGroups(pairs: Pair[], i: number): { groups: Pair[]; next: number } {
  const groups: Pair[] = []
  while (i < pairs.length && pairs[i].code !== 0) {
    groups.push(pairs[i])
    i++
  }
  return { groups, next: i }
}

function grp(groups: Pair[], code: number): string | undefined {
  for (const g of groups) if (g.code === code) return g.value
  return undefined
}

function gnum(groups: Pair[], code: number, dflt = 0): number {
  const v = grp(groups, code)
  return v === undefined ? dflt : pf(v)
}

function glayer(groups: Pair[]): string | undefined {
  const v = grp(groups, 8)
  return v === undefined ? undefined : v.trim()
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

/** avança até consumir `0 ENDSEC` (ou fim do arquivo) */
function skipSection(pairs: Pair[], i: number): number {
  while (i < pairs.length) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === 'ENDSEC') return i + 1
    i++
  }
  return i
}

function parseBlocksSection(pairs: Pair[], i: number, blocks: Map<string, BlockDef>): number {
  while (i < pairs.length) {
    const p = pairs[i]
    if (p.code !== 0) {
      i++
      continue
    }
    const name = p.value.trim()
    if (name === 'ENDSEC') return i + 1
    if (name === 'EOF') return i
    if (name === 'BLOCK') {
      const head = readGroups(pairs, i + 1)
      const blockName = (grp(head.groups, 2) ?? '').trim()
      const def: BlockDef = {
        baseX: gnum(head.groups, 10, 0),
        baseY: gnum(head.groups, 20, 0),
        entities: [],
      }
      i = parseEntityList(pairs, head.next, 'ENDBLK', def.entities)
      if (blockName !== '') blocks.set(blockName, def)
      continue
    }
    i++ // ENDBLK órfão ou grupo inesperado — segue adiante
  }
  return i
}

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

/**
 * Percorre entidades a partir de `i` até consumir `0 <stopAt>`, chegar ao fim
 * do arquivo ou atingir o teto de entidades. Retorna o índice seguinte.
 * Usada tanto na seção ENTITIES (stopAt = ENDSEC) quanto dentro de um BLOCK
 * (stopAt = ENDBLK).
 */
function parseEntityList(
  pairs: Pair[],
  i: number,
  stopAt: 'ENDSEC' | 'ENDBLK',
  sink: RawEntity[],
): number {
  while (i < pairs.length) {
    // teto atingido: para de ler — o restante não interessa para o underlay
    if (sink.length >= MAX_ENTITIES) return pairs.length
    const p = pairs[i]
    if (p.code !== 0) {
      i++ // grupo solto fora de entidade — ignora
      continue
    }
    const name = p.value.trim()
    if (name === stopAt) return i + 1
    // marcadores estruturais fora de lugar (arquivo malformado): devolve sem consumir
    if (name === 'ENDSEC' || name === 'ENDBLK' || name === 'EOF') return i
    if (name === 'POLYLINE') {
      i = parsePolyline(pairs, i + 1, sink)
      continue
    }
    const { groups, next } = readGroups(pairs, i + 1)
    const ent = buildEntity(name, groups)
    if (ent !== null) sink.push(ent)
    i = next
  }
  return i
}

function buildEntity(name: string, groups: Pair[]): RawEntity | null {
  switch (name) {
    case 'LINE':
      return buildLine(groups)
    case 'LWPOLYLINE':
      return buildLwpolyline(groups)
    case 'CIRCLE':
      return buildCircle(groups)
    case 'ARC':
      return buildArc(groups)
    case 'TEXT':
      return buildText(groups)
    case 'MTEXT':
      return buildMtext(groups)
    case 'INSERT':
      return buildInsert(groups)
    default:
      return null // entidade não suportada — ignorada em silêncio
  }
}

function buildLine(groups: Pair[]): UnderlayEntity {
  return {
    type: 'line',
    x1: gnum(groups, 10),
    y1: gnum(groups, 20),
    x2: gnum(groups, 11),
    y2: gnum(groups, 21),
    layer: glayer(groups),
  }
}

function buildLwpolyline(groups: Pair[]): UnderlayEntity | null {
  const points: Vec2[] = []
  let closed = false
  for (const g of groups) {
    // cada grupo 10 inicia um vértice novo; o 20 seguinte completa o y
    if (g.code === 10) points.push({ x: pf(g.value), y: 0 })
    else if (g.code === 20 && points.length > 0) points[points.length - 1].y = pf(g.value)
    else if (g.code === 70) closed = (Math.trunc(pf(g.value)) & 1) === 1
  }
  if (points.length < 2) return null
  return { type: 'polyline', points, closed, layer: glayer(groups) }
}

function buildCircle(groups: Pair[]): UnderlayEntity | null {
  const r = gnum(groups, 40)
  if (r <= 0) return null // raio ausente/inválido (ex.: entidade truncada)
  return { type: 'circle', cx: gnum(groups, 10), cy: gnum(groups, 20), r, layer: glayer(groups) }
}

function buildArc(groups: Pair[]): UnderlayEntity | null {
  const r = gnum(groups, 40)
  if (r <= 0) return null
  return {
    type: 'arc',
    cx: gnum(groups, 10),
    cy: gnum(groups, 20),
    r,
    a1: gnum(groups, 50), // ângulos em graus, como no DXF
    a2: gnum(groups, 51),
    layer: glayer(groups),
  }
}

function buildText(groups: Pair[]): UnderlayEntity | null {
  const text = grp(groups, 1) ?? ''
  if (text === '') return null
  return {
    type: 'text',
    x: gnum(groups, 10),
    y: gnum(groups, 20),
    text,
    height: gnum(groups, 40, 1), // grupo 40 é obrigatório no DXF; 1 = fallback defensivo
    rotation: gnum(groups, 50),
    layer: glayer(groups),
  }
}

function buildMtext(groups: Pair[]): UnderlayEntity | null {
  // o texto pode vir fatiado: grupos 3 (continuação) antes do 1 final —
  // concatenar na ordem do arquivo reconstrói a string completa
  let rawText = ''
  for (const g of groups) if (g.code === 3 || g.code === 1) rawText += g.value
  const text = stripMtextFormatting(rawText)
  if (text === '') return null
  return {
    type: 'text',
    x: gnum(groups, 10),
    y: gnum(groups, 20),
    text,
    height: gnum(groups, 40, 1),
    rotation: gnum(groups, 50),
    layer: glayer(groups),
  }
}

/**
 * Remove a formatação inline do MTEXT: `\P` (parágrafo) vira espaço, códigos
 * `\f…;` `\A1;` `\H…;` etc. são descartados e as chaves de agrupamento somem.
 * A ordem importa: `\P` primeiro, senão o regex genérico poderia engolir texto
 * até um `;` distante.
 */
function stripMtextFormatting(s: string): string {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

function buildInsert(groups: Pair[]): RawInsert | null {
  const block = (grp(groups, 2) ?? '').trim()
  if (block === '') return null
  return {
    type: 'insert',
    block,
    x: gnum(groups, 10),
    y: gnum(groups, 20),
    sx: gnum(groups, 41, 1),
    sy: gnum(groups, 42, 1),
    rotation: gnum(groups, 50),
    layer: glayer(groups),
  }
}

// ---------------------------------------------------------------------------
// POLYLINE clássica: entidade-mãe + sequência de VERTEX encerrada por SEQEND
// ---------------------------------------------------------------------------

function parsePolyline(pairs: Pair[], i: number, sink: RawEntity[]): number {
  const head = readGroups(pairs, i)
  i = head.next
  // bit 1 do grupo 70 = fechada (demais bits — 3D, malha — são ignorados: 2D)
  const closed = (Math.trunc(gnum(head.groups, 70, 0)) & 1) === 1
  const layer = glayer(head.groups)
  const points: Vec2[] = []
  while (i < pairs.length && pairs[i].code === 0 && pairs[i].value.trim() === 'VERTEX') {
    const v = readGroups(pairs, i + 1)
    points.push({ x: gnum(v.groups, 10), y: gnum(v.groups, 20) })
    i = v.next
  }
  if (i < pairs.length && pairs[i].code === 0 && pairs[i].value.trim() === 'SEQEND') {
    i = readGroups(pairs, i + 1).next // consome o SEQEND e seus grupos
  }
  if (points.length >= 2 && sink.length < MAX_ENTITIES) {
    sink.push({ type: 'polyline', points, closed, layer })
  }
  return i
}

// ---------------------------------------------------------------------------
// Expansão de INSERT — transforma a geometria do bloco por
// p' = inserção + R(rotação) · S(escala) · (p − base do bloco)
// ---------------------------------------------------------------------------

function expandInsert(
  ins: RawInsert,
  blocks: Map<string, BlockDef>,
  depth: number,
  out: UnderlayEntity[],
): void {
  if (depth > MAX_INSERT_DEPTH) return
  const block = blocks.get(ins.block)
  if (block === undefined) return // bloco desconhecido — ignora
  const rad = (ins.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // raios e alturas de texto sob escala não uniforme: usa a média dos módulos
  // (aproximação — círculo viraria elipse, irrelevante para underlay)
  const rScale = (Math.abs(ins.sx) + Math.abs(ins.sy)) / 2
  const tp = (x: number, y: number): Vec2 => {
    const dx = (x - block.baseX) * ins.sx
    const dy = (y - block.baseY) * ins.sy
    return { x: ins.x + dx * cos - dy * sin, y: ins.y + dx * sin + dy * cos }
  }
  for (const e of block.entities) {
    if (out.length >= MAX_ENTITIES) return
    if (e.type === 'insert') {
      // aninhado: expande no sistema do bloco e reaplica a transformação atual
      const nested: UnderlayEntity[] = []
      expandInsert(e, blocks, depth + 1, nested)
      for (const n of nested) {
        if (out.length >= MAX_ENTITIES) return
        out.push(transformEntity(n, tp, rScale, ins.rotation, ins.layer))
      }
    } else {
      out.push(transformEntity(e, tp, rScale, ins.rotation, ins.layer))
    }
  }
}

function transformEntity(
  e: UnderlayEntity,
  tp: (x: number, y: number) => Vec2,
  rScale: number,
  rotDeg: number,
  insertLayer: string | undefined,
): UnderlayEntity {
  // semântica clássica do DXF: entidades no layer "0" herdam o layer do INSERT
  const layer = e.layer === undefined || e.layer === '0' ? (insertLayer ?? e.layer) : e.layer
  switch (e.type) {
    case 'line': {
      const a = tp(e.x1 ?? 0, e.y1 ?? 0)
      const b = tp(e.x2 ?? 0, e.y2 ?? 0)
      return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer }
    }
    case 'polyline':
      return {
        type: 'polyline',
        points: (e.points ?? []).map((pt) => tp(pt.x, pt.y)),
        closed: e.closed,
        layer,
      }
    case 'circle': {
      const c = tp(e.cx ?? 0, e.cy ?? 0)
      return { type: 'circle', cx: c.x, cy: c.y, r: (e.r ?? 0) * rScale, layer }
    }
    case 'arc': {
      const c = tp(e.cx ?? 0, e.cy ?? 0)
      return {
        type: 'arc',
        cx: c.x,
        cy: c.y,
        r: (e.r ?? 0) * rScale,
        a1: (e.a1 ?? 0) + rotDeg,
        a2: (e.a2 ?? 0) + rotDeg,
        layer,
      }
    }
    case 'text': {
      const pos = tp(e.x ?? 0, e.y ?? 0)
      return {
        type: 'text',
        x: pos.x,
        y: pos.y,
        text: e.text,
        height: (e.height ?? 0) * rScale,
        rotation: (e.rotation ?? 0) + rotDeg,
        layer,
      }
    }
  }
}
