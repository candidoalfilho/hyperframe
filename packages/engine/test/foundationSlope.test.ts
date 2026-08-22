import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { createSampleProject } from '../src/model/factory'
import {
  checkAdjacentFootings,
  MIN_ALPHA_DEG,
  soilClassFromSigma,
  type FootingFootprint,
} from '../src/nbr/nbr6122/adjacentFootings'

/**
 * Fundações em desnível (terreno em aclive/declive):
 *  - NBR 6122 §7.7: reta entre bordos com ângulo α mínimo com a VERTICAL
 *    (60° solos pouco resistentes / 45° resistentes / 30° rochas)
 *    ⇒ afastamento a ≥ Δh·tan(α);
 *  - cota de assentamento por pilar vira APOIO REBAIXADO + tramo de arranque.
 */
function fp(name: string, x: number, cota: number, dim = 1.0): FootingFootprint {
  return { columnId: name, name, x, y: 0, dimX: dim, dimY: dim, cota }
}

describe('NBR 6122 §7.7 — sapatas vizinhas em cotas diferentes', () => {
  it('afastamento mínimo a = Δh·tan(α) calculado à mão por classe', () => {
    // Δh = 1,0 m; bordos afastados de gap = |x2−x1| − (dim1+dim2)/2
    // resistente (45°): a_min = 1,00 m
    const near = checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 1.8, -1)], 'resistente')
    expect(near).toHaveLength(1)
    expect(near[0].gap).toBeCloseTo(0.8, 9)
    expect(near[0].required).toBeCloseTo(1.0, 9)
    expect(near[0].ok).toBe(false)
    expect(near[0].deeperName).toBe('P2')

    // mesmo par em rocha (30°): a_min = tan30° = 0,577 → 0,8 passa
    const rock = checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 1.8, -1)], 'rocha')
    expect(rock[0].required).toBeCloseTo(Math.tan((30 * Math.PI) / 180), 6)
    expect(rock[0].ok).toBe(true)

    // pouco resistente (60°): a_min = 1,732 m
    const weak = checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 1.8, -1)], 'pouco-resistente')
    expect(weak[0].required).toBeCloseTo(Math.sqrt(3), 6)
    expect(weak[0].ok).toBe(false)
  })

  it('sobreposição em planta ⇒ gap 0; mesma cota ⇒ sem verificação', () => {
    const over = checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 0.5, -0.5)], 'resistente')
    expect(over[0].gap).toBe(0)
    expect(over[0].ok).toBe(false)
    expect(checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 2, 0)], 'resistente')).toHaveLength(0)
  })

  it('pares muito afastados (> 3·a_min) não são reportados', () => {
    const far = checkAdjacentFootings([fp('P1', 0, 0), fp('P2', 20, -1)], 'resistente')
    expect(far).toHaveLength(0)
  })

  it('classe do solo pela tensão admissível (orientativo)', () => {
    expect(soilClassFromSigma(100)).toBe('pouco-resistente')
    expect(soilClassFromSigma(200)).toBe('resistente')
    expect(soilClassFromSigma(800)).toBe('rocha')
    expect(MIN_ALPHA_DEG).toEqual({ 'pouco-resistente': 60, resistente: 45, rocha: 30 })
  })
})

describe('cota de assentamento estrutural — apoio rebaixado + arranque', () => {
  const flat = analyze(createSampleProject())

  function withDepth(depth: number) {
    const p = createSampleProject()
    const col = p.columns[0]
    p.foundationOverrides = [{ columnId: col.id, depth }]
    return { p, col, r: analyze(p) }
  }

  it('o nó de apoio desce p/ a cota da sapata e ganha tramo de arranque', () => {
    const { r, col, p } = withDepth(1.5)
    const base = [...p.levels].sort((a, b) => a.elevation - b.elevation)[0].elevation
    const sup = r.model.nodes.find(
      (n) =>
        n.support && Math.abs(n.x - col.pos.x) < 0.05 && Math.abs(n.y - col.pos.y) < 0.05,
    )!
    expect(sup.z).toBeCloseTo(base - 1.5, 9)
    // um membro de pilar a mais (o arranque, spanIndex -1, comprimento 1,5 m)
    expect(r.model.members.length).toBe(flat.model.members.length + 1)
    const arranque = r.model.members.find(
      (m) => m.ref.kind === 'column' && m.ref.sourceId === col.id && m.ref.spanIndex === -1,
    )!
    expect(arranque.length).toBeCloseTo(1.5, 6)
  })

  it('equilíbrio vertical preservado (diferença = peso próprio do arranque)', () => {
    const { r } = withDepth(1.5)
    const sumFlat = flat.cases.els.G!.reactions.reduce((a, x) => a + x.fz, 0)
    const sumDeep = r.cases.els.G!.reactions.reduce((a, x) => a + x.fz, 0)
    // o arranque de 1,5 m tem peso próprio (γc·A·L ≈ 5,6 kN no sample)
    const diff = sumDeep - sumFlat
    expect(diff).toBeGreaterThan(0)
    expect(diff).toBeLessThan(20)
  })

  it('desnível entre sapatas próximas dispara a verificação §7.7 no analyze', () => {
    const shallow = withDepth(2).r
    // Δh = 2 m: no sample os bordos ficam a ~2,2 m > mínimo 2,0 m (resistente) — passa
    expect(shallow.foundationAdjacency.length).toBeGreaterThan(0)
    expect(shallow.foundationAdjacency.every((i) => i.ok)).toBe(true)
    // Δh = 3,5 m: mínimo 3,5 m > afastamentos reais — REPROVA e avisa
    const deep = withDepth(3.5).r
    const bad = deep.foundationAdjacency.filter((i) => !i.ok)
    expect(bad.length).toBeGreaterThan(0)
    expect(deep.model.warnings.some((w) => w.includes('§7.7'))).toBe(true)
    // sem desnível: nenhuma issue
    expect(flat.foundationAdjacency).toHaveLength(0)
  })
})
