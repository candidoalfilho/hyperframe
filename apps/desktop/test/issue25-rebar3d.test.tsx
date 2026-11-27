import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  REBAR_CATEGORIES,
  analyze,
  buildRebar3D,
  createSampleProject,
  type AnalysisResults,
  type Project,
  type RebarGroup3D,
} from '@hyperframe/engine'
import { useStore } from '../src/store'
import {
  REBAR_COLOR,
  filterRebar,
  phiLabel,
  pickRebar,
  rebarSegments,
} from '../src/viewer3d/rebarGeometry'
import RebarCard, { rebarElementLabel, rebarSpecLabel } from '../src/viewer3d/RebarCard'

/** issue #25 — armaduras na vista 3D: filtro, segmentos, escolha da barra e identificação */

let project: Project
let results: AnalysisResults
let groups: RebarGroup3D[]
beforeAll(() => {
  project = createSampleProject()
  results = analyze(project)
  groups = buildRebar3D(project, results)
})
const allOn = Object.fromEntries(REBAR_CATEGORIES.map((c) => [c.id, true])) as Record<RebarGroup3D['category'], boolean>
const fake = (id: string, paths: number[][], extra: Partial<RebarGroup3D> = {}): RebarGroup3D => ({
  id,
  category: 'viga-positiva',
  elementKind: 'beam',
  elementId: 'b1',
  elementName: 'V1',
  levelIndex: 1,
  spanIndex: 0,
  pos: 1,
  phi: 0.0125,
  n: paths.length,
  unitLength: 4.2,
  label: 'positiva',
  paths,
  ...extra,
})

describe('exibição', () => {
  it('começa desligada, com todas as categorias marcadas e uma cor para cada', () => {
    const d3 = useStore.getState().d3
    expect(d3.showRebar).toBe(false)
    expect(d3.rebarElement).toBeNull()
    expect(d3.rebarSel).toBeNull()
    expect(d3.rebarCats).toEqual(allOn)
    expect(new Set(REBAR_CATEGORIES.map((c) => REBAR_COLOR[c.id])).size).toBe(REBAR_CATEGORIES.length)
  })

  it('filtra por categoria e por elemento', () => {
    expect(filterRebar(groups, { cats: allOn, element: null })).toEqual(groups)
    const semEstribos = filterRebar(groups, { cats: { ...allOn, 'viga-estribo': false, 'pilar-estribo': false }, element: null })
    expect(semEstribos.length).toBeGreaterThan(0)
    expect(semEstribos.some((g) => g.category.endsWith('estribo'))).toBe(false)
    expect(semEstribos.length).toBe(groups.filter((g) => !g.category.endsWith('estribo')).length)
    const col = project.columns[0]
    const soPilar = filterRebar(groups, { cats: allOn, element: { kind: 'column', id: col.id } })
    expect(soPilar.length).toBeGreaterThan(0)
    expect(soPilar.every((g) => g.elementKind === 'column' && g.elementId === col.id)).toBe(true)
    expect(filterRebar(groups, { cats: allOn, element: { kind: 'beam', id: 'nao-existe' } })).toEqual([])
  })
})

describe('segmentos para desenhar', () => {
  it('um segmento por trecho reto, em coordenadas da cena (x, cota, −y)', () => {
    const g = [fake('a', [[0, 0, 3, 4, 0, 3], [1, 2, 3, 1, 2, 5, 6, 2, 5]]), fake('b', [[0, 1, 0, 0, 1, 2]], { phi: 0.005 })]
    const seg = rebarSegments(g)
    expect(seg.count).toBe(4)
    expect([...seg.pos.slice(0, 6)]).toEqual([0, 3, -0, 4, 3, -0])
    expect([...seg.pos.slice(6, 12)]).toEqual([1, 3, -2, 1, 5, -2])
    expect([...seg.pos.slice(12, 18)]).toEqual([1, 5, -2, 6, 5, -2])
    expect([...seg.group]).toEqual([0, 0, 0, 1])
    // raio = meia bitola, com um mínimo para a barra fina não sumir
    expect(seg.radius[0]).toBeCloseTo(0.00625, 6)
    expect(seg.radius[3]).toBeCloseTo(0.004, 6)
    // só uma categoria: os índices continuam apontando para a lista inteira
    const onlyB = rebarSegments(g, (x) => x.id === 'b')
    expect(onlyB.count).toBe(1)
    expect([...onlyB.group]).toEqual([1])
    expect(rebarSegments([]).count).toBe(0)
  })

  it('no projeto de exemplo: o total de trechos é a soma dos trechos de cada barra', () => {
    const seg = rebarSegments(groups)
    const expected = groups.reduce((n, g) => n + g.paths.reduce((m, p) => m + p.length / 3 - 1, 0), 0)
    expect(seg.count).toBe(expected)
    expect(seg.count).toBeGreaterThan(20000)
    expect(seg.pos.every(Number.isFinite)).toBe(true)
    expect(Math.max(...seg.group)).toBe(groups.length - 1)
  })
})

describe('escolha da barra sob o cursor', () => {
  // duas barras paralelas ao eixo x: uma perto da câmera (z=1), outra atrás (z=-3)
  const g = [
    fake('frente', [[0, -1, 2, 4, -1, 2]]),
    fake('fundo', [[0, 3, 2, 4, 3, 2]]),
    fake('lado', [[0, -1, 5, 4, -1, 5]]),
  ]
  const seg = rebarSegments(g)
  const tol = (t: number) => 0.01 * t

  it('o raio que passa pela barra a escolhe; entre duas na mesma linha, a da frente', () => {
    // câmera em (2, 2, 10) olhando para −z: passa por "frente" (z=1) e por "fundo" (z=−3)
    expect(pickRebar(seg, [2, 2, 10], [0, 0, -1], tol)).toBe(0)
    // do outro lado, a ordem inverte
    expect(pickRebar(seg, [2, 2, -10], [0, 0, 1], tol)).toBe(1)
    // mais alto: só a barra "lado" (cota 5)
    expect(pickRebar(seg, [2, 5, 10], [0, 0, -1], tol)).toBe(2)
  })

  it('aceita o que está a poucos pixels e recusa o que está longe', () => {
    // a 9 m, tolerância de 9 cm (+ raio): 8 cm acima da barra pega, 30 cm não
    expect(pickRebar(seg, [2, 2.08, 10], [0, 0, -1], tol)).toBe(0)
    expect(pickRebar(seg, [2, 2.3, 10], [0, 0, -1], tol)).toBeNull()
    // fora do comprimento da barra
    expect(pickRebar(seg, [4.5, 2, 10], [0, 0, -1], tol)).toBeNull()
    expect(pickRebar(seg, [3.99, 2, 10], [0, 0, -1], tol)).toBe(0)
  })

  it('ignora o que está atrás da câmera e lida com lista vazia e direção não normalizada', () => {
    expect(pickRebar(seg, [2, 2, 10], [0, 0, 1], tol)).toBeNull()
    expect(pickRebar(rebarSegments([]), [0, 0, 0], [0, 0, -1], tol)).toBeNull()
    expect(pickRebar(seg, [2, 2, 10], [0, 0, -7], tol)).toBe(0)
  })

  it('no projeto de exemplo: mirar o meio de uma barra devolve o grupo dela', () => {
    const real = rebarSegments(groups)
    const gi = groups.findIndex((x) => x.category === 'pilar-barra')
    const p = groups[gi].paths[0]
    // meio da barra em coordenadas da cena, visto de fora do prédio, na horizontal
    const mid: [number, number, number] = [(p[0] + p[3]) / 2, (p[2] + p[5]) / 2, -(p[1] + p[4]) / 2]
    const from: [number, number, number] = [mid[0] - 40, mid[1], mid[2] - 30]
    const dir: [number, number, number] = [mid[0] - from[0], mid[1] - from[1], mid[2] - from[2]]
    const hit = pickRebar(real, from, dir, () => 0.002)
    expect(hit).not.toBeNull()
    // o raio pode cruzar outra barra antes; a que ele devolve tem de estar no caminho
    const t = Math.hypot(...dir)
    const hitG = groups[hit!]
    expect(hitG).toBeDefined()
    if (hit !== gi) {
      const q = hitG.paths.flat()
      let near = Infinity
      for (let i = 0; i + 2 < q.length; i += 3) near = Math.min(near, Math.hypot(q[i] - from[0], q[i + 2] - from[1], -q[i + 1] - from[2]))
      expect(near).toBeLessThan(t + 1)
    }
  })
})

describe('identificação da barra', () => {
  it('rótulos: elemento, vão ou tramo, bitola com vírgula e comprimento em cm', () => {
    expect(phiLabel(0.0125)).toBe('12,5')
    expect(phiLabel(0.01)).toBe('10')
    expect(phiLabel(0.0063)).toBe('6,3')
    expect(rebarElementLabel({ elementKind: 'beam', elementName: 'V3', spanIndex: 1 })).toBe('Viga V3 · vão 2')
    expect(rebarElementLabel({ elementKind: 'column', elementName: 'P4', spanIndex: 0 })).toBe('Pilar P4 · tramo 1')
    expect(rebarSpecLabel({ n: 3, phi: 0.0125, unitLength: 4.2 })).toBe('3 Ø 12,5 · C = 420 cm')
  })

  it('o cartão mostra a posição, a barra, o pavimento e a linha do quadro de ferros', () => {
    const g = groups.find((x) => x.category === 'viga-negativa')!
    const row = results.detailing.steel.items.find((it) => it.elementId === g.elementId && it.pos === g.pos)!
    const html = renderToStaticMarkup(
      <RebarCard group={g} levelName="3º Pavimento" steelRow={row} isolated={false} onIsolate={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain(rebarElementLabel(g))
    expect(html).toContain('3º Pavimento')
    expect(html).toContain(`N${g.pos}`)
    expect(html).toContain('negativa')
    expect(html).toContain(rebarSpecLabel(g))
    expect(html).toContain(`No quadro de ferros: N${row.pos} · ${row.n} peças de ${Math.round(row.unitLength * 100)} cm`)
    expect(html).toContain(`(${row.reps} pavimentos)`)
    expect(html).toContain('kg')
    expect(html).toContain('Ver só esta viga')
    expect(html).toContain(REBAR_COLOR['viga-negativa'])
  })

  it('pilar, vista já restrita e barra sem linha no quadro', () => {
    const g = groups.find((x) => x.category === 'pilar-estribo')!
    const html = renderToStaticMarkup(
      <RebarCard group={g} levelName="Fundação → 1º Pavimento" steelRow={null} isolated onIsolate={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain(rebarElementLabel(g))
    expect(html).toContain('Fundação → 1º Pavimento')
    expect(html).toContain('estribos')
    expect(html).toContain('Ver todos os elementos')
    expect(html).not.toContain('No quadro de ferros')
    const semPos = renderToStaticMarkup(
      <RebarCard group={{ ...g, pos: undefined }} levelName="" steelRow={null} isolated={false} onIsolate={() => {}} onClose={() => {}} />,
    )
    expect(semPos).toContain('Posição')
    expect(semPos).toContain('Ver só este pilar')
  })
})
