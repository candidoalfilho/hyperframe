import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import {
  DIM_STYLE_DEFAULT,
  autoDimension,
  dimRefAt,
  dimRefLabel,
  dimensionLayout,
  dimensionValues,
  formatDim,
  lostDimRefs,
  refreshDimensions,
  resolveDimRef,
} from '../src/model/dimensions'
import { dimensionPrimitives } from '../src/drawing/userDims'
import { buildFormworkDrawing } from '../src/drawing/formwork'
import { buildDrawingPdf } from '../src/drawing/drawingPdf'
import { writeDxf } from '../src/dxf/write'
import { checkConsistency } from '../src/model/consistency'
import { analyze } from '../src/analyze'
import { parseProject, serializeProject } from '../src/io/serialize'
import type { DimStyle, Dimension, Project, Vec2 } from '../src/model/types'

/** issue #10 — cotas permanentes, associadas ao modelo, nas pranchas e no DXF */

const S = DIM_STYLE_DEFAULT
const free = (pts: [number, number][], patch: Partial<Dimension> = {}): Dimension => ({
  id: 'd',
  name: 'Cota 1',
  dir: 'h',
  form: 'chain',
  points: pts.map(([x, y]) => ({ p: { x, y } })),
  offset: -1,
  ...patch,
})
const near = (a: Vec2, b: Vec2, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol

describe('formato', () => {
  it('cm sem zeros à direita, metros com as casas, mm', () => {
    expect(formatDim(4.5, S)).toBe('450')
    expect(formatDim(0.125, S)).toBe('12,5')
    expect(formatDim(4.5, { ...S, unit: 'm', decimals: 2 })).toBe('4,50')
    expect(formatDim(0.125, { ...S, unit: 'mm', decimals: 0 })).toBe('125')
    expect(formatDim(-2, S)).toBe('200') // distância não tem sinal
  })
})

describe('geometria — contas à mão', () => {
  it('linear horizontal entre pontos em alturas diferentes mede só Δx', () => {
    const d = free([[1, 2], [5, 3]], { offset: -1 })
    const lay = dimensionLayout(d, S)
    // linha de cota em y = 2 − 1 = 1, de x = 1 a x = 5
    expect(near(lay.main.a, { x: 1, y: 1 })).toBe(true)
    expect(near(lay.main.b, { x: 5, y: 1 })).toBe(true)
    expect(lay.labels).toHaveLength(1)
    expect(lay.labels[0].value).toBeCloseTo(4, 12)
    expect(lay.labels[0].text).toBe('400')
    expect(lay.labels[0].angleDeg).toBeCloseTo(0, 9)
    // texto centrado no meio do trecho, logo acima da linha
    expect(lay.labels[0].x).toBeCloseTo(3, 12)
    expect(lay.labels[0].y).toBeCloseTo(1 + 0.3 * S.textHeight, 12)
    // duas chamadas, cada uma do ponto até passar a linha
    const ext = lay.lines.filter((l) => l.role === 'ext')
    expect(ext).toHaveLength(2)
    for (const l of ext) expect(l.b.y).toBeCloseTo(1 - 0.5 * S.textHeight, 12)
    expect(ext[0].a.y).toBeCloseTo(2 - 0.35 * S.textHeight, 12)
    expect(lay.marks).toHaveLength(2)
  })

  it('linear vertical: mede Δy e o offset positivo joga a linha para a esquerda', () => {
    const d = free([[2, 0], [3, 6]], { dir: 'v', offset: 1.5 })
    const lay = dimensionLayout(d, S)
    expect(near(lay.main.a, { x: 0.5, y: 0 })).toBe(true)
    expect(near(lay.main.b, { x: 0.5, y: 6 })).toBe(true)
    expect(lay.labels[0].value).toBeCloseTo(6, 12)
    expect(lay.labels[0].angleDeg).toBeCloseTo(90, 9)
  })

  it('alinhada: mede a distância real (triângulo 3-4-5)', () => {
    const d = free([[0, 0], [3, 4]], { dir: 'aligned', offset: 1 })
    const lay = dimensionLayout(d, S)
    expect(lay.labels[0].value).toBeCloseTo(5, 12)
    expect(lay.u.x).toBeCloseTo(0.6, 12)
    expect(lay.u.y).toBeCloseTo(0.8, 12)
    // linha paralela ao trecho, afastada 1 m na normal (−0,8; 0,6)
    expect(near(lay.main.a, { x: -0.8, y: 0.6 })).toBe(true)
    expect(near(lay.main.b, { x: 2.2, y: 4.6 })).toBe(true)
    expect(lay.labels[0].angleDeg).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 9)
  })

  it('cadeia: um valor por trecho, na ordem do desenho, mesmo com pontos fora de ordem', () => {
    const d = free([[0, 0], [8.5, 0], [4, 0], [12.5, 0]])
    expect(dimensionValues(d)).toEqual([4, 4.5, 4])
    const lay = dimensionLayout(d, S)
    expect(lay.marks).toHaveLength(4)
    expect(lay.labels.map((l) => l.text)).toEqual(['400', '450', '400'])
    // marcas internas recebem os dois trechos (duas setas ponta a ponta)
    expect(lay.marks[1].dirs).toEqual([1, -1])
    expect(lay.marks[0].dirs).toEqual([1])
    expect(lay.marks[3].dirs).toEqual([-1])
  })

  it('cadeia com total: 2ª linha mais afastada com a soma, e as chamadas dos extremos chegam nela', () => {
    const d = free([[0, 0], [4, 0], [8.5, 0], [12.5, 0]], { total: true, offset: -1 })
    const lay = dimensionLayout(d, S)
    expect(lay.labels.map((l) => l.value)).toEqual([4, 4.5, 4, 12.5])
    const dimLines = lay.lines.filter((l) => l.role === 'dim')
    expect(dimLines).toHaveLength(2)
    const yTotal = -1 - 2.4 * S.textHeight
    expect(dimLines[1].a.y).toBeCloseTo(yTotal, 12)
    const ext = lay.lines.filter((l) => l.role === 'ext')
    expect(ext[0].b.y).toBeCloseTo(yTotal - 0.5 * S.textHeight, 12)
    expect(ext[1].b.y).toBeCloseTo(-1 - 0.5 * S.textHeight, 12)
    // total só faz sentido com 3+ pontos
    expect(dimensionValues(free([[0, 0], [4, 0]], { total: true }))).toEqual([4])
  })

  it('acumulada: distâncias desde o 1º ponto, uma por marca, com a origem marcada', () => {
    const d = free([[0, 0], [4, 0], [8.5, 0], [12.5, 0]], { form: 'baseline' })
    const lay = dimensionLayout(d, S)
    expect(lay.labels.map((l) => l.text)).toEqual(['0', '400', '850', '1250'])
    expect(lay.marks.filter((m) => m.origin)).toHaveLength(1)
    // textos escritos ao lado das chamadas (perpendiculares à linha de cota)
    for (const l of lay.labels) expect(Math.abs(l.angleDeg)).toBeCloseTo(90, 9)
    // origem no meio: mede para os dois lados
    const mid = free([[4, 0], [0, 0], [8.5, 0]], { form: 'baseline' })
    expect(dimensionLayout(mid, S).labels.map((l) => l.text)).toEqual(['400', '0', '450'])
  })

  it('pontos repetidos no mesmo alinhamento não geram trecho nulo', () => {
    const d = free([[0, 0], [4, 0], [4, 3], [8, 1]])
    expect(dimensionValues(d)).toEqual([4, 4])
  })

  it('altura de texto do editor muda o traçado, não os valores', () => {
    const d = free([[0, 0], [4, 0], [9, 0]], { total: true })
    const a = dimensionLayout(d, S)
    const b = dimensionLayout(d, S, 0.5)
    expect(b.labels.map((l) => l.value)).toEqual(a.labels.map((l) => l.value))
    expect(b.height).toBe(0.5)
    expect(b.lines.filter((l) => l.role === 'dim')[1].a.y).toBeCloseTo(-1 - 2.4 * 0.5, 12)
  })
})

describe('associação ao modelo', () => {
  const setup = () => {
    const p = createSampleProject()
    const plan = p.plans[0]
    const [c1, c2] = [...p.columns].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    return { p, plan, c1, c2 }
  }

  it('o ponto do snap vira referência: pilar (centro, face, canto) > viga > eixo', () => {
    const { p, plan, c1 } = setup()
    expect(dimRefAt(p, plan, c1.pos)).toEqual({ kind: 'column', id: c1.id, at: 'c' })
    const he = { dx: 0.125, dy: 0.3 } // 25×60 com h ao longo de Y? conferido abaixo
    const east = resolveDimRef(p, plan, { kind: 'column', id: c1.id, at: 'e' }, c1.pos)!
    expect(east.y).toBeCloseTo(c1.pos.y, 12)
    expect(east.x).toBeGreaterThan(c1.pos.x)
    expect(dimRefAt(p, plan, east)).toEqual({ kind: 'column', id: c1.id, at: 'e' })
    const ne = resolveDimRef(p, plan, { kind: 'column', id: c1.id, at: 'ne' }, c1.pos)!
    expect(dimRefAt(p, plan, ne)).toEqual({ kind: 'column', id: c1.id, at: 'ne' })
    expect(he.dx + he.dy).toBeGreaterThan(0)
    // ponto qualquer sobre um eixo: preso só a ele
    const ax = p.grid.xAxes[1]
    expect(dimRefAt(p, plan, { x: ax.pos, y: 2.37 })).toEqual({ kind: 'grid', x: ax.id })
    // fora de tudo: livre
    expect(dimRefAt(p, plan, { x: 1.111, y: 2.37 })).toBeNull()
    expect(dimRefLabel(p, plan, { kind: 'column', id: c1.id, at: 'c' })).toBe(`${c1.name} — centro`)
    expect(dimRefLabel(p, plan, { kind: 'grid', x: ax.id })).toBe(`eixo ${ax.label}`)
  })

  it('vértice de viga sem pilar embaixo prende à viga', () => {
    const { p, plan } = setup()
    plan.beams.push({
      id: 'solta',
      name: 'V99',
      path: [
        { x: 1.3, y: 1.7 },
        { x: 2.9, y: 1.7 },
      ],
      section: { bw: 0.15, h: 0.4 },
    })
    expect(dimRefAt(p, plan, { x: 2.9, y: 1.7 })).toEqual({ kind: 'beam', id: 'solta', vertex: 1 })
    expect(dimRefLabel(p, plan, { kind: 'beam', id: 'solta', vertex: 1 })).toBe('V99 — fim')
  })

  const anchored = (p: Project, a: string, b: string): Dimension => ({
    id: 'd1',
    name: 'Cota 1',
    dir: 'h',
    form: 'chain',
    offset: -1,
    points: [a, b].map((id) => ({
      p: { ...p.columns.find((c) => c.id === id)!.pos },
      ref: { kind: 'column' as const, id, at: 'c' as const },
    })),
  })

  it('mover o pilar atualiza a cota; sem mudança devolve o mesmo objeto', () => {
    const { p, plan, c1, c2 } = setup()
    plan.dimensions = [anchored(p, c1.id, c2.id)]
    expect(refreshDimensions(p)).toBe(p)
    const before = dimensionValues(plan.dimensions[0])[0]
    const moved: Project = {
      ...p,
      columns: p.columns.map((c) => (c.id === c2.id ? { ...c, pos: { x: c.pos.x + 0.35, y: c.pos.y } } : c)),
    }
    const next = refreshDimensions(moved)
    expect(next).not.toBe(moved)
    expect(dimensionValues(next.plans[0].dimensions![0])[0]).toBeCloseTo(before + 0.35, 9)
    // as outras plantas não são recriadas
    expect(next.plans[1]).toBe(moved.plans[1])
  })

  it('mudar a seção do pilar move a cota presa à face', () => {
    const { p, plan, c1, c2 } = setup()
    const d = anchored(p, c1.id, c2.id)
    d.points[0] = { p: resolveDimRef(p, plan, { kind: 'column', id: c1.id, at: 'e' }, c1.pos)!, ref: { kind: 'column', id: c1.id, at: 'e' } }
    d.points[1] = { p: resolveDimRef(p, plan, { kind: 'column', id: c2.id, at: 'w' }, c2.pos)!, ref: { kind: 'column', id: c2.id, at: 'w' } }
    plan.dimensions = [d]
    const clear0 = dimensionValues(d)[0]
    // os dois pilares 10 cm mais largos em X ⇒ vão livre 10 cm menor
    const grow = (c: Project['columns'][number]) => {
      const sec = c.section as { bw: number; h: number }
      const alongX = c.rotationDeg === 0 || c.rotationDeg === 180
      return { ...c, section: alongX ? { ...sec, h: sec.h + 0.1 } : { ...sec, bw: sec.bw + 0.1 } }
    }
    const next = refreshDimensions({
      ...p,
      columns: p.columns.map((c) => (c.id === c1.id || c.id === c2.id ? grow(c) : c)),
    })
    expect(dimensionValues(next.plans[0].dimensions![0])[0]).toBeCloseTo(clear0 - 0.1, 9)
  })

  it('eixo deslocado leva o ponto; ponto preso a um só eixo mantém a outra coordenada', () => {
    const { p, plan } = setup()
    const ax = p.grid.xAxes[1]
    plan.dimensions = [
      free([[0, 0], [ax.pos, 2.37]]),
    ]
    plan.dimensions[0].points[1].ref = { kind: 'grid', x: ax.id }
    const next = refreshDimensions({
      ...p,
      grid: { ...p.grid, xAxes: p.grid.xAxes.map((a) => (a.id === ax.id ? { ...a, pos: a.pos + 0.5 } : a)) },
    })
    expect(next.plans[0].dimensions![0].points[1].p).toEqual({ x: ax.pos + 0.5, y: 2.37 })
  })

  it('referência perdida: a cota fica onde estava e é apontada', () => {
    const { p, plan, c1, c2 } = setup()
    plan.dimensions = [anchored(p, c1.id, c2.id)]
    const gone: Project = { ...p, columns: p.columns.filter((c) => c.id !== c2.id) }
    const next = refreshDimensions(gone)
    const d = next.plans[0].dimensions![0]
    expect(d.points[1].p).toEqual(c2.pos)
    expect(lostDimRefs(next, next.plans[0], d)).toEqual([1])
    expect(dimRefLabel(next, next.plans[0], d.points[1].ref!)).toBe('pilar excluído')
    const issue = checkConsistency(next).find((i) => i.ref?.kind === 'dimension')
    expect(issue?.severity).toBe('leve')
    expect(issue?.message).toContain('perderam a referência')
    // o elemento volta (desfazer): a referência vale de novo
    expect(lostDimRefs(p, plan, plan.dimensions[0])).toEqual([])
  })

  it('cotas não mudam a análise', () => {
    const { p, plan, c1, c2 } = setup()
    const ref = analyze(p)
    plan.dimensions = [anchored(p, c1.id, c2.id)]
    const r = analyze(p)
    expect(r.model.members.length).toBe(ref.model.members.length)
    expect(r.foundationLoads.map((f) => f.fzServ)).toEqual(ref.foundationLoads.map((f) => f.fzServ))
  })
})

describe('cotagem automática da seleção', () => {
  const p = createSampleProject()
  const plan = p.plans[0]
  const allCols = p.columns.map((c) => ({ kind: 'column' as const, id: c.id }))
  const xs = [...new Set(p.columns.map((c) => c.pos.x))].sort((a, b) => a - b)
  const ys = [...new Set(p.columns.map((c) => c.pos.y))].sort((a, b) => a - b)

  it('entre eixos em X: um ponto por alinhamento (12 pilares → 4), com total', () => {
    const d = autoDimension(p, plan, allCols, { dir: 'h', mode: 'axes', side: 'min', total: true })!
    expect(d.points).toHaveLength(xs.length)
    expect(d.points.map((pt) => pt.p.x)).toEqual(xs)
    // presos aos pilares da fila de baixo (a mais próxima da linha de cota)
    for (const pt of d.points) {
      expect(pt.ref).toMatchObject({ kind: 'column', at: 'c' })
      expect(pt.p.y).toBeCloseTo(ys[0], 12)
    }
    const full = { ...d, id: 'x', name: 'Cota' }
    const values = dimensionValues(full)
    expect(values.slice(0, -1)).toEqual(xs.slice(1).map((x, i) => x - xs[i]))
    expect(values[values.length - 1]).toBeCloseTo(xs[xs.length - 1] - xs[0], 12)
    expect(d.category).toBe('locacao')
    // linha 60 cm abaixo da face dos pilares de baixo
    const lay = dimensionLayout(full, S)
    const faceY = Math.min(...p.columns.map((c) => resolveDimRef(p, plan, { kind: 'column', id: c.id, at: 's' }, c.pos)!.y))
    expect(lay.main.a.y).toBeCloseTo(faceY - 0.6, 9)
  })

  it('em Y pelo lado direito: linha à direita dos pilares', () => {
    const d = autoDimension(p, plan, allCols, { dir: 'v', mode: 'axes', side: 'max', total: false })!
    expect(d.points.map((pt) => pt.p.y)).toEqual(ys)
    expect(d.total).toBeUndefined()
    const lay = dimensionLayout({ ...d, id: 'x', name: 'Cota' }, S)
    expect(lay.main.a.x).toBeGreaterThan(xs[xs.length - 1])
    for (const pt of d.points) expect(pt.p.x).toBeCloseTo(xs[xs.length - 1], 12)
  })

  it('entre faces: largura de cada pilar e vão livre entre eles', () => {
    const row = p.columns.filter((c) => Math.abs(c.pos.y - ys[0]) < 1e-9).map((c) => ({ kind: 'column' as const, id: c.id }))
    const d = autoDimension(p, plan, row, { dir: 'h', mode: 'faces', side: 'min', total: true })!
    expect(d.points).toHaveLength(2 * row.length)
    expect(d.category).toBe('dimensao')
    const v = dimensionValues({ ...d, id: 'x', name: 'Cota' })
    // alterna largura do pilar e vão livre; a soma dos trechos é o total
    expect(v.slice(0, -1).reduce((a, b) => a + b, 0)).toBeCloseTo(v[v.length - 1], 9)
    const widths = v.slice(0, -1).filter((_, i) => i % 2 === 0)
    for (const w of widths) expect(w).toBeGreaterThan(0.1)
    expect(widths.length).toBe(row.length)
  })

  it('um pilar só, ou pilares no mesmo alinhamento, não geram cota', () => {
    expect(autoDimension(p, plan, [allCols[0]], { dir: 'h', mode: 'axes', side: 'min', total: true })).toBeNull()
    const col = p.columns.filter((c) => Math.abs(c.pos.x - xs[0]) < 1e-9).map((c) => ({ kind: 'column' as const, id: c.id }))
    expect(autoDimension(p, plan, col, { dir: 'h', mode: 'axes', side: 'min', total: true })).toBeNull()
    expect(autoDimension(p, plan, col, { dir: 'v', mode: 'axes', side: 'min', total: true })).not.toBeNull()
  })

  it('vigas selecionadas entram pelos vértices do eixo', () => {
    const b = plan.beams[0]
    const d = autoDimension(p, plan, [{ kind: 'beam', id: b.id }], { dir: 'h', mode: 'axes', side: 'min', total: false })
    const span = Math.abs(b.path[b.path.length - 1].x - b.path[0].x)
    if (span > 0.01) {
      expect(d).not.toBeNull()
      const v = dimensionValues({ ...d!, id: 'x', name: 'Cota' })
      expect(v.reduce((a, c) => a + c, 0)).toBeCloseTo(span, 9)
    } else expect(d).toBeNull()
  })
})

describe('salvar e abrir', () => {
  it('cotas e estilo voltam iguais; cota inválida no arquivo é descartada', () => {
    const p = createSampleProject()
    const c = p.columns[0]
    p.dimStyle = { ...DIM_STYLE_DEFAULT, unit: 'm', decimals: 2 }
    p.plans[0].dimensions = [
      {
        ...free([[0, 0], [4, 0], [8.5, 0]], { total: true, category: 'locacao', hidden: true }),
        points: [{ p: { ...c.pos }, ref: { kind: 'column', id: c.id, at: 'ne' } }, { p: { x: 4, y: 0 } }],
      },
    ]
    const back = parseProject(serializeProject(p))
    expect(back.plans[0].dimensions).toEqual(p.plans[0].dimensions)
    expect(back.dimStyle).toEqual(p.dimStyle)
    // arquivo antigo: sem o campo, continua sem
    expect(parseProject(serializeProject(createSampleProject())).plans[0].dimensions).toBeUndefined()
    const broken = JSON.parse(serializeProject(p))
    broken.project.plans[0].dimensions.push({ id: 'ruim', points: [{ p: { x: 0, y: 0 } }] }, { id: 'pior' })
    expect(parseProject(JSON.stringify(broken)).plans[0].dimensions).toHaveLength(1)
  })
})

describe('pranchas, PDF e DXF', () => {
  const p = createSampleProject()
  const plan = p.plans[0]
  const style: DimStyle = { ...DIM_STYLE_DEFAULT }
  const chain = free([[0, 0], [4, 0], [8.5, 0]], { id: 'a', total: true, offset: -2.2 })
  const hidden = free([[0, 0], [0.37, 0]], { id: 'b', hidden: true })
  plan.dimensions = [chain, hidden]

  it('primitivas: linhas, um traço por marca e um texto por valor, na camada COTAS', () => {
    const prims = dimensionPrimitives(chain, style)
    expect(prims.every((x) => x.layer === 'COTAS')).toBe(true)
    const texts = prims.filter((x) => x.kind === 'text')
    expect(texts.map((t) => (t.kind === 'text' ? t.text : ''))).toEqual(['400', '450', '850'])
    for (const t of texts) if (t.kind === 'text') expect(t.height).toBe(style.textHeight)
    // 2 linhas de cota + 3 chamadas + 5 traços (3 marcas + 2 do total)
    expect(prims.filter((x) => x.kind === 'line')).toHaveLength(10)
  })

  it('terminadores: seta vira triângulo por trecho; ponto vira círculo cheio', () => {
    const arrows = dimensionPrimitives(chain, { ...style, terminator: 'arrow' })
    // marca do meio recebe 2 setas: 1 + 2 + 1 da cadeia + 2 do total
    expect(arrows.filter((x) => x.kind === 'polyline')).toHaveLength(6)
    const dots = dimensionPrimitives(chain, { ...style, terminator: 'dot' })
    expect(dots.filter((x) => x.kind === 'circle' && x.filled)).toHaveLength(5)
    const base = dimensionPrimitives(free([[0, 0], [4, 0]], { form: 'baseline' }), style)
    expect(base.filter((x) => x.kind === 'circle' && !x.filled)).toHaveLength(1)
  })

  it('planta de forma inclui as cotas visíveis; opção desliga; ocultas ficam de fora', () => {
    const withDims = buildFormworkDrawing(p, plan.id)
    const without = buildFormworkDrawing(p, plan.id, { userDims: false })
    expect(withDims.primitives.length - without.primitives.length).toBe(dimensionPrimitives(chain, style).length)
    const texts = withDims.primitives.filter((x) => x.kind === 'text').map((x) => (x.kind === 'text' ? x.text : ''))
    expect(texts).toContain('850')
    expect(texts).not.toContain('37')
    // a cota abaixo da planta alarga os limites do desenho
    expect(withDims.bounds.minY).toBeLessThan(without.bounds.minY + 1e-9)
  })

  it('filtro por finalidade e cotas automáticas entre eixos desligáveis', () => {
    const q: Project = JSON.parse(JSON.stringify(p))
    q.plans[0].dimensions = [
      free([[0, 0], [1.11, 0]], { id: 'l', category: 'locacao' }),
      free([[0, 0], [2.22, 0]], { id: 'g' }), // sem finalidade = geral
    ]
    const texts = (o: Parameters<typeof buildFormworkDrawing>[2]) =>
      buildFormworkDrawing(q, q.plans[0].id, o).primitives.flatMap((x) => (x.kind === 'text' ? [x.text] : []))
    expect(texts({ userDims: ['locacao'] })).toContain('111')
    expect(texts({ userDims: ['locacao'] })).not.toContain('222')
    expect(texts({ userDims: ['geral'] })).toContain('222')
    expect(texts({ userDims: ['geral'] })).not.toContain('111')
    const dimsOf = (o: Parameters<typeof buildFormworkDrawing>[2]) =>
      buildFormworkDrawing(q, q.plans[0].id, o).primitives.filter((x) => x.kind === 'dim').length
    expect(dimsOf({})).toBeGreaterThan(0)
    expect(dimsOf({ axisDims: false })).toBe(0)
  })

  it('unidade do projeto vale nas pranchas', () => {
    const q: Project = { ...p, dimStyle: { ...style, unit: 'm', decimals: 2 } }
    const texts = buildFormworkDrawing(q, plan.id).primitives.filter((x) => x.kind === 'text').map((x) => (x.kind === 'text' ? x.text : ''))
    expect(texts).toEqual(expect.arrayContaining(['4,00', '4,50', '8,50']))
  })

  it('DXF e PDF saem com as cotas', () => {
    const d = buildFormworkDrawing(p, plan.id)
    const dxf = writeDxf(d)
    expect(dxf).toContain('\n850\n')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    const pdf = buildDrawingPdf(d)
    expect(pdf.length).toBeGreaterThan(1000)
  })
})
