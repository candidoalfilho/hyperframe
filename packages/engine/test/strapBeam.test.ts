import { describe, expect, it } from 'vitest'
import { designStrapBeam } from '../src/nbr/nbr6122/strapBeam'
import { concreteProps } from '../src/nbr/nbr6118/materials'
import { designFooting } from '../src/nbr/nbr6118/foundations'
import { buildFoundationDetailDrawing } from '../src/drawing/foundationDetail'
import { buildFoundationPlanDrawing } from '../src/drawing/foundationPlan'
import { createSampleProject } from '../src/model/factory'
import type { FoundationResultItem } from '../src/analysis/types'

// ---------------------------------------------------------------------------
// Viga alavanca (sapata de divisa) — modelo clássico (Alonso):
//   R1 = N·L/(L−e) · alívio = N·e/(L−e) · M = N·e (tração superior)
// Âncora: N1 = 600 kN, e = 0,50 m, L = 5,0 m, C25/CA-50, bw = 30 cm
//   R1 = 600·5/4,5 = 666,67 kN · ΔP = 66,67 kN · M = 300 kN·m (MSd = 420)
//   h = L/8 = 0,625 → 0,65 m (d = 0,59): x = 0,2319 m (x/d = 0,39) →
//   As = 420/(434 783·(0,59 − 0,4·0,2319)) = 19,43 cm² → 4 φ 25
//   VSd = 1,4·66,67 = 93,3 < Vc = 136 kN → estribo mínimo φ6,3 c/ 20
// ---------------------------------------------------------------------------

const cp = concreteProps(25_000, 'granito', 1.4)
const BASE = {
  bw: 0.3,
  fck: cp.fck,
  fcd: cp.fcd,
  fctd: cp.fctd,
  fctm: cp.fctm,
  fyd: 434_782.6,
  fywk: 500_000,
}

describe('designStrapBeam (viga alavanca)', () => {
  it('âncora manual: R1, alívio, momento e armadura superior 4 φ 25', () => {
    const r = designStrapBeam({ n1Serv: 600, e: 0.5, L: 5, ...BASE })
    expect(r.r1).toBeCloseTo(666.67, 1)
    expect(r.relief).toBeCloseTo(66.67, 1)
    expect(r.mChar).toBeCloseTo(300, 6)
    expect(r.mSd).toBeCloseTo(420, 6)
    expect(r.h).toBeCloseTo(0.65, 6)
    expect(r.asTop).toBeCloseTo(19.43e-4, 3)
    expect(r.topSpec).toContain('25')
    expect(r.stirrupSpec).toBe('φ 6,3 c/ 20')
    expect(r.status).toBe('ok')
    expect(r.notes.join(' ')).toMatch(/SUPERIOR/i)
  })

  it('momento alto força crescimento da altura em passos de 5 cm', () => {
    const r = designStrapBeam({ n1Serv: 2000, e: 1.0, L: 6, ...BASE })
    // h inicial = 6/8 = 0,75 — MSd = 2800 kN·m não cabe: h precisa crescer
    expect(r.h).toBeGreaterThan(0.75)
    expect(r.mSd).toBeCloseTo(2800, 6)
    expect(r.r1).toBeCloseTo((2000 * 6) / 5, 1)
  })

  it('excentricidade alta (e > L/4) ⇒ atenção', () => {
    const r = designStrapBeam({ n1Serv: 400, e: 1.4, L: 5, ...BASE })
    expect(r.status).toBe('atencao')
    expect(r.notes.join(' ')).toMatch(/excentricidade alta/i)
  })
})

// ---------------------------------------------------------------------------

function sapataItem(
  columnId: string,
  extra?: Partial<FoundationResultItem>,
): FoundationResultItem {
  return {
    columnId,
    name: 'P1',
    nServ: 600,
    kind: 'sapata',
    footing: designFooting({
      nServ: 600,
      ma: 0,
      mb: 0,
      ap: 0.25,
      bp: 0.6,
      sigmaAdm: 200,
      fyd: 434_782.6,
    }),
    pileCap: null,
    caisson: null,
    status: 'ok',
    ...extra,
  }
}

describe('desenhos com viga alavanca e armaduras', () => {
  const project = createSampleProject()
  const c1 = project.columns[0]
  const c2 = project.columns[1]
  const sb = designStrapBeam({ n1Serv: 600, e: 0.5, L: 5, ...BASE })
  const items = [
    sapataItem(c1.id, {
      manual: true,
      offset: { x: 0.5, y: 0 },
      strap: { ...sb, partnerId: c2.id, partnerName: c2.name, e: 0.5, L: 5 },
    }),
    sapataItem(c2.id, { name: c2.name }),
  ]

  it('planta de fundações traça o eixo da VA com rótulo bw×h', () => {
    const d = buildFoundationPlanDrawing(project, items)
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.some((t) => t.startsWith('VA ') && t.includes('30×65'))).toBe(true)
    expect(texts.some((t) => t.includes('VA→'))).toBe(true)
  })

  it('detalhamento: armaduras da sapata (dir. a/b) e quadro das VAs', () => {
    const d = buildFoundationDetailDrawing(project, items)
    expect(d.title).toBe('DETALHAMENTO DAS FUNDAÇÕES')
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.some((t) => t.startsWith('armadura dir. a:'))).toBe(true)
    expect(texts.some((t) => t.includes('QUADRO — VIGAS ALAVANCA'))).toBe(true)
    expect(texts.some((t) => t.includes('R1=667 kN') || t.includes('R1=666 kN'))).toBe(true)
    expect(texts.some((t) => t.includes('estribos φ 6,3 c/ 20'))).toBe(true)
  })
})
