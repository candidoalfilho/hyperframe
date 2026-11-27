/**
 * Prancha COMPOSTA (issue #23): vários desenhos do projeto na mesma folha,
 * cada um com a sua posição, escala e rotação. Este módulo resolve o desenho
 * de cada item, calcula a caixa que ele ocupa no papel, organiza a folha
 * automaticamente, aponta sobreposições e desenhos fora da área útil, e monta
 * o desenho final (moldura + carimbo + itens) em METROS DE PAPEL — o mesmo
 * formato das pranchas simples, então PDF e DXF saem pelos mesmos escritores.
 */

import type { AnalysisResults } from '../analysis/types'
import type { Project, SheetFormatId, SheetItem, SheetLayout, SheetSource } from '../model/types'
import { buildBeamDetailDrawing } from './beamDetail'
import { buildColumnDetailDrawing } from './columnDetail'
import { buildColumnElevationDrawing } from './columnElevation'
import { buildFormworkDrawing } from './formwork'
import { buildFoundationDetailDrawing } from './foundationDetail'
import { buildFoundationPlanDrawing } from './foundationPlan'
import { buildLoadPlanDrawing } from './loadPlan'
import { buildMasonryElevationDrawing } from './masonryElevation'
import { buildSectionCutDrawing } from './sectionCut'
import { buildSlabRebarDrawing } from './slabRebar'
import {
  SHEET_FORMATS,
  STAMP_H,
  STAMP_W,
  STANDARD_SCALES,
  mapPrimitive,
  sheetFrame,
  sheetMargins,
  type SheetInfo,
} from './sheet'
import { buildQuantitiesTableDrawing, buildSteelTableDrawing } from './tables'
import type { Drawing, DrawingPrimitive } from './types'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** folga entre desenhos e faixa do título sob cada desenho, m de papel */
export const SHEET_GAP = 0.008
export const SHEET_TITLE_STRIP = 0.007

/** área útil da folha (dentro da moldura, com 5 mm de folga) e a caixa do carimbo */
export function sheetAreas(format: SheetFormatId): { usable: Box; stamp: Box } {
  const fmt = SHEET_FORMATS[format]
  const mg = sheetMargins(format)
  const pad = 0.005
  const usable = { x0: mg.left + pad, y0: mg.other + pad, x1: fmt.w - mg.other - pad, y1: fmt.h - mg.other - pad }
  const sx1 = fmt.w - mg.other
  const sx0 = sx1 - Math.min(STAMP_W, sx1 - mg.left)
  return { usable, stamp: { x0: sx0 - pad, y0: mg.other, x1: sx1, y1: mg.other + STAMP_H + pad } }
}

const byName = <T extends { name: string }>(l: T[]) =>
  [...l].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

/** nome do desenho, para o título sob o item e para as listas */
export function sheetSourceLabel(project: Project, src: SheetSource): string {
  const plan = (id: string) => project.plans.find((p) => p.id === id)?.name ?? '?'
  switch (src.kind) {
    case 'forma':
      return `Planta de forma — ${plan(src.planId)}`
    case 'lajes':
      return `Armação de lajes — ${plan(src.planId)}`
    case 'corte': {
      const ax = (src.dir === 'x' ? project.grid.xAxes : project.grid.yAxes).find((a) => a.id === src.axisId)
      return `Corte pelo eixo ${ax?.label ?? '?'}`
    }
    case 'cargas':
      return 'Planta de cargas — fundações'
    case 'fundacoes':
      return 'Planta de fundações'
    case 'fundacoes-det':
      return 'Detalhamento de fundações'
    case 'viga': {
      for (const pl of project.plans) {
        const b = pl.beams.find((x) => x.id === src.beamId)
        if (b) return `Viga ${b.name} — ${pl.name}`
      }
      return 'Viga ?'
    }
    case 'pilares':
      return 'Pilares — seções e armaduras'
    case 'pilar-elev':
      return `Pilar ${project.columns.find((c) => c.id === src.columnId)?.name ?? '?'} — elevação`
    case 'alv-elev': {
      for (const pl of project.plans) {
        const w = pl.masonryWalls?.find((x) => x.id === src.wallId)
        if (w) return `Parede ${w.name} — elevação`
      }
      return 'Parede ?'
    }
    case 'aco':
      return 'Resumo de aço'
    case 'quantitativos':
      return 'Quantitativos'
  }
}

/** identidade de uma origem: duas origens com a mesma chave são o mesmo desenho */
export function sheetSourceKey(src: SheetSource): string {
  switch (src.kind) {
    case 'forma':
    case 'lajes':
      return `${src.kind}:${src.planId}`
    case 'corte':
      return `corte:${src.dir}:${src.axisId}`
    case 'viga':
      return `viga:${src.beamId}`
    case 'pilar-elev':
      return `pilar-elev:${src.columnId}`
    case 'alv-elev':
      return `alv-elev:${src.wallId}`
    default:
      return src.kind
  }
}

/** desenho que pode entrar numa prancha */
export interface SheetSourceOption {
  /** categoria, para agrupar e filtrar */
  group: string
  label: string
  source: SheetSource
  key: string
  /** planta (pavimento) a que o desenho pertence, quando pertence a uma */
  planId?: string
}

/** categorias na ordem em que aparecem nas listas */
export const SHEET_SOURCE_GROUPS = [
  'Plantas de forma',
  'Lajes',
  'Vigas',
  'Pilares',
  'Fundações',
  'Cortes',
  'Alvenaria',
  'Tabelas',
] as const

/** desenhos que podem ser inseridos, por categoria; os que dependem da análise só entram com resultados */
export function sheetSourceOptions(project: Project, results: AnalysisResults | null): SheetSourceOption[] {
  const out: SheetSourceOption[] = []
  const add = (group: (typeof SHEET_SOURCE_GROUPS)[number], source: SheetSource, planId?: string) =>
    out.push({
      group,
      label: sheetSourceLabel(project, source),
      source,
      key: sheetSourceKey(source),
      ...(planId ? { planId } : {}),
    })
  for (const pl of project.plans) add('Plantas de forma', { kind: 'forma', planId: pl.id }, pl.id)
  if (results) {
    for (const pl of project.plans) add('Lajes', { kind: 'lajes', planId: pl.id }, pl.id)
    for (const pl of project.plans) {
      for (const b of byName(pl.beams)) {
        if (results.detailing.beams.some((d) => d.beamId === b.id)) add('Vigas', { kind: 'viga', beamId: b.id }, pl.id)
      }
    }
    add('Pilares', { kind: 'pilares' })
    for (const c of byName(project.columns)) {
      if (results.detailing.columns.some((d) => d.columnId === c.id)) add('Pilares', { kind: 'pilar-elev', columnId: c.id })
    }
    add('Fundações', { kind: 'cargas' })
    add('Fundações', { kind: 'fundacoes' })
    add('Fundações', { kind: 'fundacoes-det' })
  }
  for (const a of project.grid.xAxes) add('Cortes', { kind: 'corte', dir: 'x', axisId: a.id })
  for (const a of project.grid.yAxes) add('Cortes', { kind: 'corte', dir: 'y', axisId: a.id })
  for (const pl of project.plans) {
    for (const w of byName(pl.masonryWalls ?? [])) add('Alvenaria', { kind: 'alv-elev', wallId: w.id }, pl.id)
  }
  if (results) {
    add('Tabelas', { kind: 'aco' })
    add('Tabelas', { kind: 'quantitativos' })
  }
  return out
}

/** monta o desenho de um item; null = origem inexistente ou análise ausente */
export function buildSourceDrawing(
  project: Project,
  results: AnalysisResults | null,
  src: SheetSource,
): Drawing | null {
  try {
    switch (src.kind) {
      case 'forma':
        return project.plans.some((p) => p.id === src.planId) ? buildFormworkDrawing(project, src.planId) : null
      case 'corte': {
        const ax = (src.dir === 'x' ? project.grid.xAxes : project.grid.yAxes).find((a) => a.id === src.axisId)
        // 1 cm ao lado do eixo, para pegar os pilares do alinhamento
        return ax ? buildSectionCutDrawing(project, { dir: src.dir, pos: ax.pos + 0.01, label: ax.label }) : null
      }
      case 'alv-elev': {
        for (const pl of project.plans) {
          const w = pl.masonryWalls?.find((x) => x.id === src.wallId)
          if (w) return buildMasonryElevationDrawing(project, w)
        }
        return null
      }
    }
    if (!results) return null
    switch (src.kind) {
      case 'lajes':
        return project.plans.some((p) => p.id === src.planId)
          ? buildSlabRebarDrawing(project, src.planId, results.slabDesign)
          : null
      case 'cargas':
        return buildLoadPlanDrawing(project, results.foundationLoads)
      case 'fundacoes':
        return buildFoundationPlanDrawing(project, results.foundations)
      case 'fundacoes-det':
        return buildFoundationDetailDrawing(project, results.foundations)
      case 'viga': {
        const spans = results.detailing.beams.filter((b) => b.beamId === src.beamId)
        if (spans.length === 0) return null
        const items = results.detailing.steel.items.filter((it) => it.elementId === src.beamId)
        return buildBeamDetailDrawing(spans[0].beamName, spans, undefined, items)
      }
      case 'pilares':
        return buildColumnDetailDrawing(results.detailing.columns)
      case 'pilar-elev': {
        const det = results.detailing.columns.find((c) => c.columnId === src.columnId)
        return det ? buildColumnElevationDrawing(project, det) : null
      }
      case 'aco':
        return buildSteelTableDrawing(results.detailing.steel)
      case 'quantitativos':
        return buildQuantitiesTableDrawing(results.quantities)
    }
  } catch {
    return null
  }
}

/** largura e altura do desenho no papel (m), na escala e rotação do item */
export function itemPaperSize(d: Drawing, scale: number, rotation: 0 | 90 = 0): { w: number; h: number } {
  const w = Math.max(d.bounds.maxX - d.bounds.minX, 0.01) / scale
  const h = Math.max(d.bounds.maxY - d.bounds.minY, 0.01) / scale
  return rotation === 90 ? { w: h, h: w } : { w, h }
}

/** menor escala-padrão (maior desenho) com que o desenho cabe em w × h de papel */
export function fitItemScale(d: Drawing, w: number, h: number, rotation: 0 | 90 = 0): number {
  for (const s of STANDARD_SCALES) {
    const size = itemPaperSize(d, s, rotation)
    if (size.w <= w + 1e-9 && size.h <= h + 1e-9) return s
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]
}

export interface PlacedItem {
  item: SheetItem
  label: string
  /** null = desenho indisponível (origem excluída ou análise não rodada) */
  drawing: Drawing | null
  /** caixa ocupada no papel (com a faixa do título embaixo) */
  box: Box
}

export interface SheetIssue {
  itemId: string
  kind: 'fora' | 'sobreposto' | 'carimbo' | 'indisponivel'
  /** outro item envolvido (sobreposição) */
  otherId?: string
  message: string
}

/** resolve e posiciona os itens da prancha */
export function placeSheetItems(
  project: Project,
  results: AnalysisResults | null,
  layout: SheetLayout,
): PlacedItem[] {
  return layout.items.map((item) => {
    const drawing = buildSourceDrawing(project, results, item.source)
    // desenho indisponível ocupa um marcador de 6 × 3 cm
    const size = drawing ? itemPaperSize(drawing, item.scale, item.rotation ?? 0) : { w: 0.06, h: 0.03 }
    return {
      item,
      label: sheetSourceLabel(project, item.source),
      drawing,
      box: { x0: item.x, y0: item.y - SHEET_TITLE_STRIP, x1: item.x + size.w, y1: item.y + size.h },
    }
  })
}

const overlap = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6

/** desenhos sobrepostos, fora da área útil, sobre o carimbo ou indisponíveis */
export function sheetIssues(format: SheetFormatId, placed: PlacedItem[]): SheetIssue[] {
  const { usable, stamp } = sheetAreas(format)
  const out: SheetIssue[] = []
  placed.forEach((p, i) => {
    if (!p.drawing) {
      out.push({
        itemId: p.item.id,
        kind: 'indisponivel',
        message: `${p.label}: desenho indisponível (elemento excluído ou análise não rodada).`,
      })
    }
    const b = p.box
    if (b.x0 < usable.x0 - 1e-6 || b.y0 < usable.y0 - 1e-6 || b.x1 > usable.x1 + 1e-6 || b.y1 > usable.y1 + 1e-6) {
      out.push({ itemId: p.item.id, kind: 'fora', message: `${p.label}: passa da área útil da folha.` })
    }
    if (overlap(b, stamp)) {
      out.push({ itemId: p.item.id, kind: 'carimbo', message: `${p.label}: está sobre o carimbo.` })
    }
    for (let j = i + 1; j < placed.length; j++) {
      if (overlap(b, placed[j].box)) {
        out.push({
          itemId: p.item.id,
          kind: 'sobreposto',
          otherId: placed[j].item.id,
          message: `${p.label} e ${placed[j].label} estão sobrepostos.`,
        })
      }
    }
  })
  return out
}

/**
 * Distribui caixas (w × h, m de papel) em fileiras de cima para baixo, da
 * esquerda para a direita, das mais altas para as mais baixas; as fileiras que
 * descem até o carimbo terminam antes dele. Devolve o canto inferior esquerdo
 * de cada caixa e se tudo coube na área útil.
 */
export function packSheet(
  format: SheetFormatId,
  sizes: { id: string; w: number; h: number }[],
): { pos: Map<string, { x: number; y: number }>; fits: boolean } {
  const { usable, stamp } = sheetAreas(format)
  const pos = new Map<string, { x: number; y: number }>()
  const order = [...sizes].sort((a, b) => b.h - a.h || b.w - a.w)
  let fits = true
  let top = usable.y1
  let i = 0
  while (i < order.length) {
    const rowH = order[i].h + SHEET_TITLE_STRIP
    const bottom = top - rowH
    // fileira que entra na faixa do carimbo perde a largura dele
    const right = bottom < stamp.y1 ? stamp.x0 - SHEET_GAP : usable.x1
    let x = usable.x0
    let placedInRow = 0
    while (i < order.length) {
      const it = order[i]
      if (placedInRow > 0 && x + it.w > right + 1e-9) break
      if (x + it.w > right + 1e-9) fits = false // sozinho já não cabe na largura
      pos.set(it.id, { x, y: top - it.h })
      x += it.w + SHEET_GAP
      placedInRow++
      i++
    }
    if (bottom < usable.y0 - 1e-9) fits = false
    top = bottom - SHEET_GAP
  }
  return { pos, fits }
}

/**
 * Organiza a prancha: reposiciona os itens em fileiras. Com `shrink`, reduz a
 * escala (para a escala-padrão seguinte) do desenho que mais ocupa até tudo
 * caber. Itens indisponíveis mantêm a escala.
 */
export function arrangeSheet(
  project: Project,
  results: AnalysisResults | null,
  layout: SheetLayout,
  opts: { shrink?: boolean } = {},
): { layout: SheetLayout; fits: boolean } {
  const drawings = new Map(layout.items.map((it) => [it.id, buildSourceDrawing(project, results, it.source)]))
  let items = layout.items.map((it) => ({ ...it }))
  const sizeOf = (it: SheetItem) => {
    const d = drawings.get(it.id)
    return d ? itemPaperSize(d, it.scale, it.rotation ?? 0) : { w: 0.06, h: 0.03 }
  }
  let packed = packSheet(layout.format, items.map((it) => ({ id: it.id, ...sizeOf(it) })))
  for (let guard = 0; opts.shrink && !packed.fits && guard < 200; guard++) {
    // o maior desenho (em área de papel) que ainda pode reduzir
    const candidates = items
      .filter((it) => drawings.get(it.id) && STANDARD_SCALES.some((s) => s > it.scale))
      .sort((a, b) => sizeOf(b).w * sizeOf(b).h - sizeOf(a).w * sizeOf(a).h)
    const big = candidates[0]
    if (!big) break
    const next = STANDARD_SCALES.find((s) => s > big.scale)!
    items = items.map((it) => (it.id === big.id ? { ...it, scale: next } : it))
    packed = packSheet(layout.format, items.map((it) => ({ id: it.id, ...sizeOf(it) })))
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  items = items.map((it) => {
    const p = packed.pos.get(it.id)
    return p ? { ...it, x: r4(p.x), y: r4(p.y) } : it
  })
  return { layout: { ...layout, items }, fits: packed.fits }
}

/** item novo na escala que cabe em metade da largura e 60% da altura úteis */
export function newSheetItem(
  project: Project,
  results: AnalysisResults | null,
  format: SheetFormatId,
  source: SheetSource,
  id: string,
): SheetItem {
  const { usable } = sheetAreas(format)
  const d = buildSourceDrawing(project, results, source)
  const scale = d ? fitItemScale(d, (usable.x1 - usable.x0) / 2, (usable.y1 - usable.y0) * 0.6) : 50
  return { id, source, x: usable.x0, y: usable.y0 + SHEET_TITLE_STRIP, scale }
}

/**
 * Primeiro lugar livre para uma caixa w × h, de cima para baixo e da esquerda
 * para a direita. Candidatos: o canto superior esquerdo, à direita e abaixo de
 * cada desenho já posto e os cruzamentos entre a borda direita de um desenho e
 * a borda de baixo de outro (os cantos que sobram entre desenhos de tamanhos
 * diferentes). null = não há lugar livre.
 */
export function freeSheetSpot(
  format: SheetFormatId,
  taken: Box[],
  w: number,
  h: number,
): { x: number; y: number } | null {
  const { usable, stamp } = sheetAreas(format)
  const cands: { x: number; y: number }[] = [{ x: usable.x0, y: usable.y1 - h }]
  for (const b of taken) {
    cands.push({ x: b.x1 + SHEET_GAP, y: b.y1 - h })
    cands.push({ x: b.x0, y: b.y0 - SHEET_GAP - h })
  }
  const xs = [usable.x0, ...taken.map((b) => b.x1 + SHEET_GAP)]
  const tops = [usable.y1, ...taken.map((b) => b.y0 - SHEET_GAP)]
  for (const x of xs) for (const top of tops) cands.push({ x, y: top - h })
  // posições no décimo de milímetro em que são gravadas, arredondadas para longe
  // do vizinho (direita e baixo): a conferência vê a mesma caixa testada aqui
  const snapped = cands.map((c) => ({ x: Math.ceil(c.x * 1e4 - 1e-6) / 1e4, y: Math.floor(c.y * 1e4 + 1e-6) / 1e4 }))
  // de cima para baixo, da esquerda para a direita
  snapped.sort((p, q) => q.y - p.y || p.x - q.x)
  for (const c of snapped) {
    const box = { x0: c.x, y0: c.y - SHEET_TITLE_STRIP, x1: c.x + w, y1: c.y + h }
    const inside =
      box.x0 >= usable.x0 - 1e-9 && box.y0 >= usable.y0 - 1e-9 && box.x1 <= usable.x1 + 1e-9 && box.y1 <= usable.y1 + 1e-9
    if (inside && !overlap(box, stamp) && !taken.some((t) => overlap(box, t))) return c
  }
  return null
}

/** item novo já no primeiro lugar livre da prancha */
export function placeNewSheetItem(
  project: Project,
  results: AnalysisResults | null,
  layout: SheetLayout,
  source: SheetSource,
  id: string,
): SheetItem {
  return placeNewSheetItems(project, results, layout, [source], () => id).items[0]
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

/** quantas escalas-padrão um desenho pode descer para caber antes de ir para outra folha */
export const OVERFLOW_SHRINK_STEPS = 2

/**
 * Vários desenhos de uma vez (issue #28), cada um no primeiro lugar livre.
 *
 * `overflow: false` — tudo na mesma folha: sem lugar na escala padrão, o
 * desenho entra numa escala menor; folha cheia, vai para o canto superior
 * esquerdo, sobreposto (`unplaced` conta esses; a conferência os aponta).
 *
 * `overflow: true` — o que não cabe vai para folhas novas (`extra`, uma lista
 * de itens por folha, no mesmo formato), em vez de sobrepor. Antes de abrir
 * outra folha o desenho pode descer até `OVERFLOW_SHRINK_STEPS` escalas-padrão
 * (a escala padrão é generosa: a maior que cabe em meia folha).
 */
export function placeNewSheetItems(
  project: Project,
  results: AnalysisResults | null,
  layout: SheetLayout,
  sources: SheetSource[],
  makeId: () => string,
  opts: { overflow?: boolean } = {},
): { items: SheetItem[]; extra: SheetItem[][]; unplaced: number } {
  const { usable } = sheetAreas(layout.format)
  const taken = placeSheetItems(project, results, layout).map((p) => p.box)
  const boxOf = (x: number, y: number, w: number, h: number): Box => ({ x0: x, y0: y - SHEET_TITLE_STRIP, x1: x + w, y1: y + h })
  const items: SheetItem[] = []
  const extra: { items: SheetItem[]; taken: Box[] }[] = []
  let unplaced = 0
  for (const source of sources) {
    const item = newSheetItem(project, results, layout.format, source, makeId())
    const d = buildSourceDrawing(project, results, source)
    const sizeAt = (scale: number) => (d ? itemPaperSize(d, scale) : { w: 0.06, h: 0.03 })
    const tryOn = (boxes: Box[], scales: number[]): SheetItem | null => {
      for (const scale of scales) {
        const size = sizeAt(scale)
        const spot = freeSheetSpot(layout.format, boxes, size.w, size.h)
        if (spot) {
          // a caixa é a da posição gravada (arredondada), como numa inserção de cada vez
          const x = r4(spot.x)
          const y = r4(spot.y)
          boxes.push(boxOf(x, y, size.w, size.h))
          return { ...item, scale, x, y }
        }
      }
      return null
    }
    // sem lugar na escala padrão: as escalas-padrão seguintes (desenho menor)
    const smaller = d ? STANDARD_SCALES.filter((sc) => sc >= item.scale) : [item.scale]
    const near = smaller.slice(0, 1 + OVERFLOW_SHRINK_STEPS)
    const here = tryOn(taken, opts.overflow ? near : smaller)
    if (here) {
      items.push(here)
      continue
    }
    if (opts.overflow) {
      let put: SheetItem | null = null
      for (const sh of extra) {
        put = tryOn(sh.taken, near)
        if (put) {
          sh.items.push(put)
          break
        }
      }
      if (!put) {
        // folha nova: vazia, o desenho cabe (a escala padrão ocupa no máximo meia folha)
        const sh = { items: [] as SheetItem[], taken: [] as Box[] }
        put = tryOn(sh.taken, smaller)
        if (!put) {
          const size = sizeAt(item.scale)
          put = { ...item, x: r4(usable.x0), y: r4(usable.y1 - size.h) }
          sh.taken.push(boxOf(put.x, put.y, size.w, size.h))
          unplaced++
        }
        sh.items.push(put)
        extra.push(sh)
      }
      continue
    }
    // folha cheia: canto superior esquerdo (a conferência aponta a sobreposição)
    const size = sizeAt(item.scale)
    const x = r4(usable.x0)
    const y = r4(usable.y1 - size.h)
    taken.push(boxOf(x, y, size.w, size.h))
    items.push({ ...item, x, y })
    unplaced++
  }
  return { items, extra: extra.map((e) => e.items), unplaced }
}

/**
 * Desenho final da prancha, em metros de papel: moldura, carimbo (ESCALA =
 * a escala única ou "INDICADA") e cada item escalado, girado e com o título
 * "nome — ESC. 1:N" embaixo.
 */
export function composeSheetLayout(
  project: Project,
  results: AnalysisResults | null,
  layout: SheetLayout,
  info: Omit<SheetInfo, 'title1' | 'title2'>,
): { drawing: Drawing; placed: PlacedItem[]; issues: SheetIssue[] } {
  const fmt = SHEET_FORMATS[layout.format]
  const placed = placeSheetItems(project, results, layout)
  const prims: DrawingPrimitive[] = []
  for (const p of placed) {
    const { item, drawing, box } = p
    if (!drawing) {
      // marcador tracejado do desenho que não pôde ser montado
      prims.push({
        kind: 'polyline',
        points: [
          { x: box.x0, y: item.y },
          { x: box.x1, y: item.y },
          { x: box.x1, y: box.y1 },
          { x: box.x0, y: box.y1 },
        ],
        closed: true,
        dashed: true,
        layer: 'COTAS',
      })
    } else {
      const b = drawing.bounds
      const rot = item.rotation ?? 0
      // o canto inferior esquerdo da caixa (já girada) cai em (item.x, item.y)
      const ox = rot === 90 ? item.x + b.maxY / item.scale : item.x - b.minX / item.scale
      const oy = rot === 90 ? item.y - b.minX / item.scale : item.y - b.minY / item.scale
      for (const pr of drawing.primitives) prims.push(mapPrimitive(pr, item.scale, ox, oy, rot))
    }
    prims.push({
      kind: 'text',
      x: item.x,
      y: item.y - 0.0052,
      text: `${p.label.toUpperCase()} — ${drawing ? `ESC. 1:${item.scale}` : 'INDISPONÍVEL'}`,
      height: 0.0028,
      layer: 'TEXTOS',
    })
  }
  const scales = [...new Set(placed.filter((p) => p.drawing).map((p) => p.item.scale))]
  prims.push(
    ...sheetFrame(
      layout.format,
      { ...info, title1: layout.name, title2: placed.length === 1 ? placed[0].label : undefined, revision: layout.revision ?? info.revision },
      scales.length === 1 ? `1:${scales[0]}` : scales.length === 0 ? '—' : 'INDICADA',
    ),
  )
  return {
    drawing: {
      title: `${layout.name} (${layout.format})`,
      primitives: prims,
      bounds: { minX: 0, minY: 0, maxX: fmt.w, maxY: fmt.h },
    },
    placed,
    issues: sheetIssues(layout.format, placed),
  }
}
