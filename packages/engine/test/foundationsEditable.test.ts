import { describe, expect, it } from 'vitest'
import { designFooting } from '../src/nbr/nbr6118/foundations'
import { designPileCap } from '../src/nbr/nbr6118/pileCaps'
import { foundationShape } from '../src/design/foundationGeometry'
import { buildFoundationPlanDrawing } from '../src/drawing/foundationPlan'
import { createSampleProject } from '../src/model/factory'
import type { FoundationResultItem } from '../src/analysis/types'

// ---------------------------------------------------------------------------
// Fundações editáveis (v0.2.17): verificação com dimensões fixadas, geometria
// em planta e planta de fundações.
// ---------------------------------------------------------------------------

const FYD = 434_782.6 // CA-50, kPa

describe('designFooting com dimensões fixadas (verificação)', () => {
  const base = { nServ: 800, ma: 0, mb: 0, ap: 0.25, bp: 0.6, sigmaAdm: 200, fyd: FYD }

  it('fixada MENOR que o necessário ⇒ σ > σadm e falha', () => {
    // necessário: A ≈ 1,05·800/200 = 4,2 m² — fixar 1,5×1,5 = 2,25 m²
    const r = designFooting({ ...base, fixed: { a: 1.5, b: 1.5 } })
    expect(r.a).toBeCloseTo(1.5, 6)
    expect(r.b).toBeCloseTo(1.5, 6)
    expect(r.sigma).toBeGreaterThan(base.sigmaAdm)
    expect(r.status).toBe('falha')
    expect(r.notes.join(' ')).toMatch(/fixadas manualmente/i)
  })

  it('fixada FOLGADA ⇒ verificação passa com as dimensões do engenheiro', () => {
    const r = designFooting({ ...base, fixed: { a: 2.4, b: 2.2 } })
    expect(r.a).toBeCloseTo(2.4, 6)
    expect(r.b).toBeCloseTo(2.2, 6)
    expect(r.sigma).toBeLessThan(base.sigmaAdm)
    expect(r.status).toBe('ok')
  })

  it('momento de excentricidade (N·e) aumenta σmáx da sapata fixada', () => {
    const semM = designFooting({ ...base, fixed: { a: 2.4, b: 2.2 } })
    // offset de 30 cm na direção a ⇒ ma = N·e = 800·0,3 = 240 kN·m
    const comM = designFooting({ ...base, ma: 240, fixed: { a: 2.4, b: 2.2 } })
    expect(comM.sigmaMax).toBeGreaterThan(semM.sigmaMax * 1.2)
    // e = M/N (peso próprio da sapata não gera excentricidade)
    expect(comM.ea).toBeCloseTo(240 / 800, 3)
  })
})

describe('designPileCap com nº de estacas fixado', () => {
  const base = {
    ap: 0.6,
    bp: 0.25,
    pileCapacity: 300,
    pileDiameter: 0.4,
    spacingFactor: 3,
    fcd: 17_857.1,
    fyd: FYD,
  }

  it('N=750 exige 3 estacas; fixar 2 ⇒ sobrecarga por estaca e falha', () => {
    const r = designPileCap({ nServ: 750, ...base, nPilesFixed: 2 })
    expect(r.nPiles).toBe(2)
    expect(r.pileLoad).toBeCloseTo((1.05 * 750) / 2, 1) // 393,75 > 300
    expect(r.status).toBe('falha')
    expect(r.notes.join(' ')).toMatch(/fixado manualmente/i)
  })

  it('fixar 4 p/ carga de 2 ⇒ verificação passa (superdimensionado)', () => {
    const r = designPileCap({ nServ: 500, ...base, nPilesFixed: 4 })
    expect(r.nPiles).toBe(4)
    expect(r.pileLoad).toBeLessThan(base.pileCapacity)
    expect(r.pileDiameter).toBeCloseTo(0.4, 6)
  })
})

// ---------------------------------------------------------------------------

function itemFor(
  columnId: string,
  kind: FoundationResultItem['kind'],
  extra?: Partial<FoundationResultItem>,
): FoundationResultItem {
  const footing =
    kind === 'sapata'
      ? designFooting({ nServ: 600, ma: 0, mb: 0, ap: 0.25, bp: 0.6, sigmaAdm: 200, fyd: FYD })
      : null
  const pileCap =
    kind === 'bloco'
      ? designPileCap({
          nServ: 750,
          ap: 0.6,
          bp: 0.25,
          pileCapacity: 300,
          pileDiameter: 0.4,
          spacingFactor: 3,
          fcd: 17_857.1,
          fyd: FYD,
        })
      : null
  return {
    columnId,
    name: 'P1',
    nServ: 600,
    kind,
    footing,
    pileCap,
    caisson: null,
    status: footing?.status ?? pileCap?.status ?? 'ok',
    ...extra,
  }
}

describe('foundationShape (geometria em planta)', () => {
  const project = createSampleProject()
  const col = project.columns[0]

  it('sapata: retângulo a×b centrado no pilar + offset; dims em cm', () => {
    const it0 = itemFor(col.id, 'sapata', { offset: { x: 0.4, y: -0.2 } })
    const s = foundationShape(it0, col)!
    expect(s.center.x).toBeCloseTo(col.pos.x + 0.4, 6)
    expect(s.center.y).toBeCloseTo(col.pos.y - 0.2, 6)
    expect(s.polygon).toHaveLength(4)
    const f = it0.footing!
    const w = Math.max(...s.polygon!.map((p) => p.x)) - Math.min(...s.polygon!.map((p) => p.x))
    const hgt = Math.max(...s.polygon!.map((p) => p.y)) - Math.min(...s.polygon!.map((p) => p.y))
    // rotação 0 ⇒ a (direção de h do pilar) ao longo de X
    const alongX = col.rotationDeg === 0 || col.rotationDeg === 180
    expect(w).toBeCloseTo(alongX ? f.a : f.b, 6)
    expect(hgt).toBeCloseTo(alongX ? f.b : f.a, 6)
    expect(s.dims).toBe(`${Math.round(f.a * 100)}×${Math.round(f.b * 100)}`)
  })

  it('bloco: nº de círculos = nº de estacas, raio = φ/2', () => {
    const it0 = itemFor(col.id, 'bloco')
    const s = foundationShape(it0, col)!
    expect(s.circles).toHaveLength(it0.pileCap!.nPiles)
    expect(s.circles[0].r).toBeCloseTo(0.2, 6)
    expect(s.polygon).toHaveLength(4)
    expect(s.h).toBeCloseTo(it0.pileCap!.h, 6)
  })

  it('tubulão: fuste + base como 2 círculos concêntricos', () => {
    const it0: FoundationResultItem = {
      columnId: col.id,
      name: 'P1',
      nServ: 900,
      kind: 'tubulao',
      footing: null,
      pileCap: null,
      caisson: {
        shaftD: 0.9,
        baseD: 1.8,
        baseH: 0.9,
        sigmaShaft: 100,
        sigmaBase: 400,
        shaftAreaM2: 2.8,
        baseVolume: 1.5,
        status: 'ok',
        notes: [],
      },
      status: 'ok',
    }
    const s = foundationShape(it0, col)!
    expect(s.polygon).toBeNull()
    expect(s.circles).toHaveLength(2)
    expect(Math.max(...s.circles.map((c) => c.r))).toBeCloseTo(0.9, 6)
    expect(s.dims).toBe('ø90/180')
  })
})

describe('buildFoundationPlanDrawing', () => {
  const project = createSampleProject()

  it('planta com eixos, contornos, rótulos S# e resumo; nota de assentamento', () => {
    const items = project.columns
      .slice(0, 2)
      .map((c, i) => itemFor(c.id, 'sapata', i === 1 ? { depth: 1.2, manual: true } : undefined))
    const d = buildFoundationPlanDrawing(project, items)
    expect(d.title).toBe('PLANTA DE FUNDAÇÕES')
    const texts = d.primitives.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text)
    expect(texts.some((t) => t.startsWith('S'))).toBe(true)
    expect(texts.some((t) => t.includes('RESUMO DAS FUNDAÇÕES'))).toBe(true)
    expect(texts.some((t) => t.includes('ass. −1,20 m'))).toBe(true)
    expect(texts.some((t) => t.includes('NBR 6122'))).toBe(true)
    // contorno tracejado da sapata existe
    expect(d.primitives.some((p) => p.kind === 'polyline' && p.layer === 'CONTORNO')).toBe(true)
    expect(d.bounds.maxX).toBeGreaterThan(d.bounds.minX)
  })

  it('bloco desenha as estacas como círculos', () => {
    const items = [itemFor(project.columns[0].id, 'bloco')]
    const d = buildFoundationPlanDrawing(project, items)
    const circles = d.primitives.filter((p) => p.kind === 'circle' && p.layer === 'CONTORNO')
    expect(circles.length).toBe(items[0].pileCap!.nPiles)
  })
})

describe('sapata troncopiramidal (h0 na borda)', () => {
  it('h0 = máx(h/3; 15 cm) arredondado a 5 cm, com nota das faces inclinadas', () => {
    const r = designFooting({ nServ: 800, ma: 0, mb: 0, ap: 0.25, bp: 0.6, sigmaAdm: 200, fyd: 434_782.6 })
    expect(r.h0).toBeGreaterThanOrEqual(0.15)
    expect(r.h0).toBeGreaterThanOrEqual(r.h / 3 - 1e-9)
    expect(Math.round((r.h0 * 100) % 5)).toBe(0)
    expect(r.h0).toBeLessThan(r.h)
    expect(r.notes.join(' ')).toMatch(/tronco de pirâmide/i)
  })
})
