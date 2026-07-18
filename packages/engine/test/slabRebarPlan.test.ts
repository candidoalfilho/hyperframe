import { describe, expect, it } from 'vitest'
import { buildSlabRebarDrawing } from '../src/drawing/slabRebar'
import { designSlab } from '../src/nbr/nbr6118/slabDesign'
import { concreteProps } from '../src/nbr/nbr6118/materials'
import { createSampleProject } from '../src/model/factory'
import type { SlabDesignResultItem } from '../src/analysis/types'

// ---------------------------------------------------------------------------
// Armação de lajes em planta: positivas por direção dentro de cada laje e
// negativas sobre bordas contínuas entre lajes vizinhas (0,25·ℓ p/ cada lado).
// ---------------------------------------------------------------------------

const cp = concreteProps(25_000, 'granito', 1.4)

function marcusItem(slabId: string, name: string, lx: number, ly: number): SlabDesignResultItem {
  const design = designSlab({
    a: { span: lx, fixedEnds: 1 },
    b: { span: ly, fixedEnds: 1 },
    thickness: 0.12,
    g: 4.2,
    q: 1.5,
    psi2: 0.3,
    cover: 0.025,
    fcd: cp.fcd,
    fck: cp.fck,
    fyd: 434_782.6,
    fctm: cp.fctm,
    ecs: cp.ecs,
  })
  return {
    slabId,
    name,
    levelName: 'Tipo',
    spanA: lx,
    spanB: ly,
    thickness: 0.12,
    rectangular: true,
    kind: 'macica',
    design,
    ribbedDesign: null,
    gridDesign: null,
    status: 'ok',
    notes: [],
  }
}

describe('buildSlabRebarDrawing', () => {
  const project = createSampleProject()
  // planta com mais lajes do projeto exemplo
  const plan = [...project.plans].sort((a, b) => b.slabs.length - a.slabs.length)[0]
  const items = plan.slabs.map((s) => marcusItem(s.id, s.name, 4, 5))

  it('projeto exemplo tem lajes vizinhas com borda coincidente (pré-condição)', () => {
    let shared = 0
    const TOL = 0.03
    for (let i = 0; i < plan.slabs.length; i++) {
      for (let j = i + 1; j < plan.slabs.length; j++) {
        const p1 = plan.slabs[i].polygon
        const p2 = plan.slabs[j].polygon
        for (let e1 = 0; e1 < p1.length; e1++) {
          const a = p1[e1]
          const b = p1[(e1 + 1) % p1.length]
          const el = Math.hypot(b.x - a.x, b.y - a.y)
          if (el < 0.2) continue
          const ux = (b.x - a.x) / el
          const uy = (b.y - a.y) / el
          for (let e2 = 0; e2 < p2.length; e2++) {
            const r = p2[e2]
            const q = p2[(e2 + 1) % p2.length]
            const d1 = Math.abs((r.x - a.x) * -uy + (r.y - a.y) * ux)
            const d2 = Math.abs((q.x - a.x) * -uy + (q.y - a.y) * ux)
            if (d1 > TOL || d2 > TOL) continue
            const t = (p: { x: number; y: number }) => (p.x - a.x) * ux + (p.y - a.y) * uy
            const lo = Math.max(Math.min(t(r), t(q)), 0)
            const hi = Math.min(Math.max(t(r), t(q)), el)
            if (hi - lo >= 0.25) shared++
          }
        }
      }
    }
    expect(shared).toBeGreaterThan(0)
  })

  it('positivas: barra + rótulo "inf. φ… · L≈" por direção em cada laje', () => {
    const d = buildSlabRebarDrawing(project, plan.id, items)
    expect(d.title).toContain('ARMAÇÃO DE LAJES')
    const bars = d.primitives.filter((p) => p.kind === 'polyline' && p.layer === 'ARMADURA')
    expect(bars.length).toBeGreaterThanOrEqual(2 * plan.slabs.length)
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.filter((t) => t.startsWith('inf. φ')).length).toBeGreaterThanOrEqual(
      2 * plan.slabs.length,
    )
    expect(texts.some((t) => t.includes('L≈'))).toBe(true)
    // nome + espessura de cada laje
    for (const s of plan.slabs) {
      expect(texts.some((t) => t.startsWith(`${s.name} h=12`))).toBe(true)
    }
  })

  it('negativas: "sup. φ… · 0,25·ℓ" sobre as bordas contínuas', () => {
    const d = buildSlabRebarDrawing(project, plan.id, items)
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    const sups = texts.filter((t) => t.startsWith('sup. φ'))
    expect(sups.length).toBeGreaterThan(0)
    expect(sups[0]).toContain('0,25·ℓ')
    // supportSpec do Marcus com engaste ≠ '—'
    expect(items[0].design!.dirA.supportSpec).not.toBe('—')
  })

  it('nota executiva de posicionamento (inferior/superior/ancoragem §9.4)', () => {
    const d = buildSlabRebarDrawing(project, plan.id, items)
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.some((t) => t.includes('POSITIVA na face inferior'))).toBe(true)
    expect(texts.some((t) => t.includes('§9.4'))).toBe(true)
  })
})
