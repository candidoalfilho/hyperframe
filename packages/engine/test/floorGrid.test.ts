import { describe, expect, it } from 'vitest'
import { analyzeFloorGrid } from '../src/analysis/floorGrid'
import { analyzeSlabGrid } from '../src/analysis/grid'
import { runSlabDesign } from '../src/design/slabRun'
import { createSampleProject } from '../src/model/factory'

// ---------------------------------------------------------------------------
// Grelha de pavimento UNIFICADA: duas lajes 4×8 lado a lado (borda comum em
// x = 4) sobre vigas rígidas apoiadas em 6 pilares. Cada faixa de 1 m em X
// vira uma VIGA CONTÍNUA de 2 vãos de 4 m com extremos ~rotulados:
//   M_apoio = w·l²/8 = 10·16/8 = 20 kN·m/m
//   M_vão  = (9/128)·w·l² = 11,25 kN·m/m
// (tolerância da analogia de grelha + efeito de placa: ±20%)
// ---------------------------------------------------------------------------

const E = 25_000_000 // kPa
const W = 10 // kN/m²

const slabA = { x0: 0, x1: 4 }
const slabB = { x0: 4, x1: 8 }
const rect = (x0: number, x1: number) => [
  { x: x0, y: 0 },
  { x: x1, y: 0 },
  { x: x1, y: 8 },
  { x: x0, y: 8 },
]
const STIFF = { bw: 0.3, h: 2.0 } // vigas quase rígidas
const beams = [
  { path: [{ x: 0, y: 0 }, { x: 0, y: 8 }], sections: [STIFF] },
  { path: [{ x: 4, y: 0 }, { x: 4, y: 8 }], sections: [STIFF] },
  { path: [{ x: 8, y: 0 }, { x: 8, y: 8 }], sections: [STIFF] },
  { path: [{ x: 0, y: 0 }, { x: 8, y: 0 }], sections: [STIFF] },
  { path: [{ x: 0, y: 8 }, { x: 8, y: 8 }], sections: [STIFF] },
]
const columns = [
  { id: 'c1', pos: { x: 0, y: 0 } },
  { id: 'c2', pos: { x: 4, y: 0 } },
  { id: 'c3', pos: { x: 8, y: 0 } },
  { id: 'c4', pos: { x: 0, y: 8 } },
  { id: 'c5', pos: { x: 4, y: 8 } },
  { id: 'c6', pos: { x: 8, y: 8 } },
]

function floorInput() {
  return {
    slabs: [
      { id: 'A', polygon: rect(slabA.x0, slabA.x1), holes: [], thickness: 0.12, pTot: W, pQp: W },
      { id: 'B', polygon: rect(slabB.x0, slabB.x1), holes: [], thickness: 0.12, pTot: W, pQp: W },
    ],
    beams,
    columns,
    e: E,
  }
}

describe('analyzeFloorGrid (grelha de pavimento unificada)', () => {
  const out = analyzeFloorGrid(floorInput())
  const a = out.slabs.get('A')!
  const b = out.slabs.get('B')!

  it('equilíbrio global: Σ reações ≈ carga total', () => {
    expect(out.totalReaction).toBeCloseTo(out.totalLoad, 0)
    expect(out.totalLoad).toBeCloseTo(W * 64, 0)
  })

  it('CONTINUIDADE: momento negativo na borda comum ≈ w·l²/8 = 20 kN·m/m', () => {
    expect(a.mxSupportMax).toBeGreaterThan(16)
    expect(a.mxSupportMax).toBeLessThan(24)
    expect(b.mxSupportMax).toBeGreaterThan(16)
    // simetria entre as duas lajes
    expect(Math.abs(a.mxSupportMax - b.mxSupportMax) / a.mxSupportMax).toBeLessThan(0.05)
  })

  it('momento de vão ≈ 9/128·w·l² = 11,25 kN·m/m (menor que o de apoio)', () => {
    expect(a.mxSpanMax).toBeGreaterThan(8)
    expect(a.mxSpanMax).toBeLessThan(14)
    expect(a.mxSpanMax).toBeLessThan(a.mxSupportMax)
  })

  it('toda a carga desce pelos 6 pilares', () => {
    let sum = 0
    for (const v of out.columnLoads.values()) sum += v
    expect(sum).toBeCloseTo(out.totalReaction, 0)
    expect(out.columnLoads.size).toBe(6)
  })

  it('grelha POR LAJE (bordas rotuladas) não vê a continuidade — unificada vê', () => {
    const per = analyzeSlabGrid({
      polygon: rect(slabA.x0, slabA.x1),
      supportedEdges: [0, 1, 2, 3],
      thickness: 0.12,
      e: E,
      q: W,
    })
    // rotulada: o "momento de apoio" reportado é artefato de borda (twisting),
    // bem ABAIXO do negativo real de continuidade (w·l²/8) que a unificada vê
    expect(per.result.mxSupportMax).toBeLessThan(0.7 * a.mxSupportMax)
    expect(a.mxSupportMax).toBeGreaterThan(16)
  })

  it('sem pilares ⇒ mecanismo (erro) e o chamador cai no método por laje', () => {
    expect(() => analyzeFloorGrid({ ...floorInput(), columns: [] })).toThrow(/pilar|mecanismo/i)
  })
})

describe('runSlabDesign com slabMethod = grelha usa a unificada', () => {
  it('projeto exemplo: lajes maciças ganham nota "unificada" e negativo de continuidade', () => {
    const project = createSampleProject()
    project.settings.slabMethod = 'grelha'
    const items = runSlabDesign(project)
    const gridItems = items.filter((i) => i.gridDesign !== null)
    expect(gridItems.length).toBeGreaterThan(0)
    const unified = gridItems.filter((i) => i.notes.some((n) => n.includes('PAVIMENTO unificada')))
    expect(unified.length).toBeGreaterThan(0)
    // pelo menos uma laje com momento negativo de continuidade relevante
    expect(
      unified.some((i) => i.gridDesign!.mxSupport > 1 || i.gridDesign!.mySupport > 1),
    ).toBe(true)
  })
})
