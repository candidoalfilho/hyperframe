import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { columnStirrupOffsets, runDetailing } from '../src/design/detailing'
import {
  barLayers,
  flexureCapacity,
  stirrupMaxSpacing,
  stirrupRequired,
} from '../src/design/rebarCheck'
import { designBeamFlexure } from '../src/nbr/nbr6118/beamDesign'
import { buildBeamDetailDrawing } from '../src/drawing/beamDetail'
import { buildColumnElevationDrawing } from '../src/drawing/columnElevation'
import { buildMemorialPdf } from '../src/report/memorial'
import { parseProject, serializeProject } from '../src/io/serialize'
import type { Project, RebarOverride } from '../src/model/types'
import type { AnalysisResults } from '../src/analysis/types'

/** issue #12 — editor de armaduras: vigas, pilares e verificação da armadura adotada */

const FCD = 30_000 / 1.4
const FYD = 500_000 / 1.15
const base = createSampleProject()
const ref = analyze(base)

/** detalhamento com ajustes, sem refazer a análise (como o app faz ao editar) */
const detail = (mut: (p: Project) => void, r: AnalysisResults = ref) => {
  const p: Project = JSON.parse(JSON.stringify(base))
  mut(p)
  return { p, d: runDetailing(p, r.beamDesign, r.columnDesign, r.beamService) }
}
/** vão mais solicitado no negativo (tem negativo dos dois lados e estribos) */
const span = [...ref.beamDesign]
  .filter((b) => b.negLeft && b.negRight)
  .sort((a, b) => b.negLeft!.md - a.negLeft!.md)[0]
const key = { beamId: span.beamId, spanIndex: span.spanIndex }
const ov = (slot: RebarOverride['slot'], patch: Partial<RebarOverride>): RebarOverride => ({ ...key, slot, ...patch })
const spanOf = (d: ReturnType<typeof runDetailing>) =>
  d.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!
const checkOf = (d: ReturnType<typeof runDetailing>) =>
  d.checks!.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!
const item = (c: { items: { id: string; ok: boolean; detail: string }[] }, id: string) =>
  c.items.find((i) => i.id === id)!

describe('contas à mão', () => {
  it('barras na largura: 20 cm, c = 3, φt = 5 ⇒ 5 φ10 por camada; a 6ª vai para a 2ª', () => {
    // largura útil 20 − 6 − 1 = 13 cm; cada barra ocupa φ + 2 cm
    expect(barLayers(5, 0.01, 0.2, 0.03, 0.005)).toMatchObject({ perLayer: 5, layers: 1 })
    expect(barLayers(5, 0.01, 0.2, 0.03, 0.005).yBar).toBeCloseTo(0.04, 12)
    const two = barLayers(6, 0.01, 0.2, 0.03, 0.005)
    expect(two).toMatchObject({ perLayer: 5, layers: 2 })
    // 5 barras a 4,0 cm e 1 a 7,0 cm da face ⇒ CG a 4,5 cm
    expect(two.yBar).toBeCloseTo(0.045, 12)
    // φ20: espaçamento livre = φ ⇒ (13 + 2)/(2 + 2) = 3 por camada
    expect(barLayers(4, 0.02, 0.2, 0.03, 0.005)).toMatchObject({ perLayer: 3, layers: 2 })
    // estribo mais grosso rouba largura
    expect(barLayers(5, 0.01, 0.2, 0.03, 0.01).perLayer).toBe(4)
  })

  it('momento resistente: 4 φ10 em 20×(d = 46) ⇒ 60,3 kN·m', () => {
    const as = 4 * Math.PI * 0.005 ** 2
    const r = flexureCapacity({ as, d: 0.46, bw: 0.2, fcd: FCD, fyd: FYD })
    // Rs = 3,1416 cm² × 434,78 MPa = 136,6 kN · a = Rs/(0,85·fcd·bw) = 3,75 cm
    expect(as * FYD).toBeCloseTo(136.59, 1)
    expect(r.mrd).toBeCloseTo(136.59 * (0.46 - 0.01875), 1)
    expect(r.xd).toBeCloseTo(0.0375 / 0.8 / 0.46, 4)
    expect(r.ductile).toBe(true)
  })

  it('é o inverso do dimensionamento: MRd(As calculada) = Md', () => {
    for (const md of [15, 40, 80, 120]) {
      const d = designBeamFlexure({ md, bw: 0.2, h: 0.5, d: 0.456, fcd: FCD, fyd: FYD, fck: 30_000 })
      expect(flexureCapacity({ as: d.as, d: 0.456, bw: 0.2, fcd: FCD, fyd: FYD }).mrd).toBeCloseTo(md, 6)
    }
  })

  it('mesa colaborante aumenta o braço; LN na alma soma as duas parcelas', () => {
    const as = 6e-4
    const rect = flexureCapacity({ as, d: 0.46, bw: 0.2, fcd: FCD, fyd: FYD })
    const tee = flexureCapacity({ as, d: 0.46, bw: 0.2, fcd: FCD, fyd: FYD, flange: { bf: 0.6, hf: 0.1 } })
    expect(tee.mrd).toBeGreaterThan(rect.mrd)
    // a = Rs/(0,85·fcd·bf) = 260,9/(18214·0,6) = 2,39 cm < hf
    expect(tee.mrd).toBeCloseTo(as * FYD * (0.46 - (as * FYD) / (0.85 * FCD * 0.6) / 2), 6)
    // mesa fina: o bloco passa da mesa e entra na alma
    const thin = flexureCapacity({ as: 12e-4, d: 0.46, bw: 0.2, fcd: FCD, fyd: FYD, flange: { bf: 0.6, hf: 0.03 } })
    const cFlange = 0.85 * FCD * 0.4 * 0.03
    const a = (12e-4 * FYD - cFlange) / (0.85 * FCD * 0.2)
    expect(thin.mrd).toBeCloseTo(cFlange * (0.46 - 0.015) + 0.85 * FCD * 0.2 * a * (0.46 - a / 2), 6)
  })

  it('armadura demais não rende: x/d > 0,45 limita o MRd', () => {
    const r = flexureCapacity({ as: 30e-4, d: 0.46, bw: 0.2, fcd: FCD, fyd: FYD })
    expect(r.ductile).toBe(false)
    expect(r.xd).toBeGreaterThan(0.45)
    const x = 0.45 * 0.46
    expect(r.mrd).toBeCloseTo(0.85 * FCD * 0.2 * 0.8 * x * (0.46 - 0.4 * x), 6)
  })

  it('estribos: passo máximo e área necessária', () => {
    // Vd ≤ 0,67·VRd2 ⇒ 0,6·d ≤ 30 cm; senão 0,3·d ≤ 20 cm
    expect(stirrupMaxSpacing(100, 464, 0.46)).toBeCloseTo(0.276, 12)
    expect(stirrupMaxSpacing(100, 464, 0.6)).toBe(0.3)
    expect(stirrupMaxSpacing(400, 464, 0.46)).toBeCloseTo(0.138, 12)
    // Vd = 150, Vc = 79,2, d = 0,46, fywd = 435 MPa ⇒ (150 − 79,2)/(0,9·0,46·435000) = 3,93 cm²/m
    const r = stirrupRequired(150, 79.2, 0.46, 435_000, 2.32e-4, 0)
    expect(r.shear * 1e4).toBeCloseTo(3.931, 2)
    // abaixo de Vc vale o mínimo; a torção soma 2·A90/s
    expect(stirrupRequired(50, 79.2, 0.46, 435_000, 2.32e-4, 1e-4)).toEqual({ shear: 2.32e-4, torsion: 2e-4 })
  })

  it('estribos de pilar com trecho junto aos nós', () => {
    // tramo de 3 m, c/ 15 corrente e c/ 7,5 em 50 cm junto aos dois nós
    const offs = columnStirrupOffsets(3, 0.15, 0.5, 0.075)
    const plain = columnStirrupOffsets(3, 0.15)
    expect(offs.length).toBeGreaterThan(plain.length)
    expect(offs[0]).toBeCloseTo(0.05, 12)
    expect(offs[1] - offs[0]).toBeCloseTo(0.075, 12)
    expect(offs[offs.length - 1]).toBeLessThanOrEqual(2.95 + 1e-9)
    // no meio do tramo o passo é o corrente
    const mid = offs.findIndex((y) => y > 1.4)
    expect(offs[mid + 1] - offs[mid]).toBeCloseTo(0.15, 12)
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThanOrEqual(offs[i - 1])
  })
})

describe('a solução do programa passa nas próprias verificações', () => {
  it('todos os vãos e pilares do edifício de exemplo atendem, sem ajuste manual', () => {
    const ch = ref.detailing.checks!
    expect(ch.beams).toHaveLength(ref.beamDesign.length)
    expect(ch.columns).toHaveLength(ref.columnDesign.length)
    expect(ch.beams.filter((c) => c.status !== 'ok')).toEqual([])
    expect(ch.columns.filter((c) => c.status !== 'ok')).toEqual([])
    expect(ch.beams.some((c) => c.manual) || ch.columns.some((c) => c.manual)).toBe(false)
    expect(ref.warnings.some((w) => w.startsWith('Armadura editada'))).toBe(false)
    // cada vão tem flexão, estribos e fissuração verificados
    const ids = ch.beams[0].items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['pos-fit', 'pos-min', 'pos-mrd', 'st-phi', 'st-vrd2', 'st-area-0', 'st-smax-0', 'st-legs']))
  })
})

describe('vigas: armadura editada', () => {
  it('menos barra do que precisa: momento resistente não atende e o vão é reprovado', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('negLeft', { n: 2, phi: 0.008 })]
    })
    const c = checkOf(d)
    expect(c.manual).toBe(true)
    expect(c.status).toBe('falha')
    expect(item(c, 'negL-mrd').ok).toBe(false)
    expect(item(c, 'negL-mrd').detail).toMatch(/MRd = [\d,]+ < Md = /)
    expect(item(c, 'negL-min').ok).toBe(false)
    // o lado que não foi mexido continua atendendo
    expect(item(c, 'negR-mrd').ok).toBe(true)
  })

  it('mais barra: atende, e muitas barras finas vão para a 2ª camada com d menor', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('negLeft', { n: 8, phi: 0.01 })]
    })
    const c = checkOf(d)
    expect(item(c, 'negL-mrd').ok).toBe(true)
    expect(item(c, 'negL-fit').detail).toContain('2 camadas')
    expect(c.status).toBe('ok')
    // 14 φ10 ⇒ 3 camadas: cabe, mas pede atenção
    const { d: d3 } = detail((p) => {
      p.rebarOverrides = [ov('negLeft', { n: 14, phi: 0.01 })]
    })
    expect(item(checkOf(d3), 'negL-fit').ok).toBe(false)
    expect(checkOf(d3).status).toBe('atencao')
  })

  it('comprimento de corte: o informado vale; menor que o necessário é apontado', () => {
    const auto = spanOf(ref.detailing).positive
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('positive', { length: auto.length - 0.5 })]
    })
    const s = spanOf(d).positive
    expect(s.length).toBeCloseTo(auto.length - 0.5, 9)
    expect(s.lengthAuto).toBeCloseTo(auto.length, 9)
    expect(s.manual).toBe(true)
    expect(item(checkOf(d), 'pos-len').ok).toBe(false)
    // maior que o necessário: sem apontamento
    const { d: d2 } = detail((p) => {
      p.rebarOverrides = [ov('positive', { length: auto.length + 0.3 })]
    })
    expect(checkOf(d2).items.find((i) => i.id === 'pos-len')).toBeUndefined()
    expect(checkOf(d2).status).toBe('ok')
    // o quadro de ferros acompanha
    const it0 = d2.steel.items.find((i) => i.elementId === span.beamId && i.note?.includes('comprimento de corte ajustado'))
    expect(it0?.unitLength).toBeCloseTo(auto.length + 0.3, 9)
  })

  it('negativa prolongada até o outro apoio: cobre o vão inteiro, sem escalonar', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('negLeft', { through: true })]
    })
    const nl = spanOf(d).negLeft!
    expect(nl.through).toBe(true)
    expect(nl.cut).toBeUndefined()
    expect(nl.length).toBeGreaterThan(span.length)
    expect(nl.length).toBeGreaterThan(spanOf(ref.detailing).negLeft!.length)
    expect(checkOf(d).status).toBe('ok')
  })

  it('estribo: bitola e ramos mudam a área; o quadro usa a bitola adotada', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('stirrup', { phi: 0.0063, spacing: 0.2 })]
    })
    const st = spanOf(d).stirrup
    expect(st).toMatchObject({ phi: 0.0063, spacing: 0.2, manual: true })
    // 2 ramos φ6,3 c/ 20 ⇒ 2 × 0,3117 / 0,20 = 3,12 cm²/m
    expect(item(checkOf(d), 'st-area-0').detail).toContain('Asw/s = 3,12')
    expect(d.steel.items.some((i) => i.elementId === span.beamId && Math.abs(i.phi - 0.0063) < 1e-9)).toBe(true)
    const { d: d4 } = detail((p) => {
      p.rebarOverrides = [ov('stirrup', { phi: 0.0063, spacing: 0.2, legs: 4 })]
    })
    expect(item(checkOf(d4), 'st-area-0').detail).toContain('Asw/s = 6,23')
    expect(spanOf(d4).stirrup.legs).toBe(4)
    expect(spanOf(d4).stirrup.count).toBe(2 * st.count)
  })

  it('trechos com passos diferentes: cada um é verificado com o cortante do trecho', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [
        ov('stirrup', { spacing: 0.25, left: { length: 1, spacing: 0.1 }, right: { length: 1, spacing: 0.1 } }),
      ]
    })
    const st = spanOf(d).stirrup
    expect(st.zones).toHaveLength(3)
    expect(st.zones!.map((z) => z.spacing)).toEqual([0.1, 0.25, 0.1])
    expect(st.zones!.reduce((s, z) => s + z.length, 0)).toBeCloseTo(span.length, 9)
    expect(st.count).toBe(st.zones!.reduce((s, z) => s + z.count, 0))
    const c = checkOf(d)
    // o cortante do trecho central é menor que o dos apoios
    const v = (id: string) => Number(/Vd no trecho = ([\d,]+)/.exec(item(c, id).detail)![1].replace(',', '.'))
    expect(v('st-area-1')).toBeLessThan(v('st-area-0'))
    expect(v('st-area-0')).toBeCloseTo(span.shear.vd, 0)
    expect(c.items.filter((i) => i.id.startsWith('st-smax')).every((i) => i.ok)).toBe(true)
    // passo de 30 cm no meio passa do máximo (0,6·d ≈ 27,6 cm)
    const { d: d2 } = detail((p) => {
      p.rebarOverrides = [ov('stirrup', { spacing: 0.3, left: { length: 1, spacing: 0.1 } })]
    })
    expect(spanOf(d2).stirrup.zones).toHaveLength(2)
    expect(item(checkOf(d2), 'st-smax-1').ok).toBe(false)
    // trechos que cobrem o vão inteiro são ignorados
    const { d: d3 } = detail((p) => {
      p.rebarOverrides = [ov('stirrup', { left: { length: span.length, spacing: 0.1 } })]
    })
    expect(spanOf(d3).stirrup.zones).toBeUndefined()
  })

  it('ver a solução do programa: os ajustes ficam guardados e o detalhamento volta ao automático', () => {
    const { p, d } = detail((q) => {
      q.rebarOverrides = [ov('negLeft', { n: 2, phi: 0.008 }), ov('stirrup', { phi: 0.008, spacing: 0.1 })]
      q.rebarOverridesOff = true
    })
    expect(p.rebarOverrides).toHaveLength(2)
    expect(d.beams).toEqual(ref.detailing.beams)
    expect(d.steel.totalKg).toBeCloseTo(ref.detailing.steel.totalKg, 9)
    expect(checkOf(d).manual).toBe(false)
    // religando, a tabela de aço muda
    p.rebarOverridesOff = false
    const on = runDetailing(p, ref.beamDesign, ref.columnDesign, ref.beamService)
    expect(on.steel.totalKg).not.toBeCloseTo(ref.detailing.steel.totalKg, 3)
    expect(checkOf(on).status).toBe('falha')
  })
})

describe('pilares: armadura editada', () => {
  const cd = [...ref.columnDesign].sort((a, b) => b.nd - a.nd)[0]
  const colCheck = (d: ReturnType<typeof runDetailing>) => d.checks!.columns.find((c) => c.columnId === cd.columnId)!

  it('arranjo menor que o necessário: reprovado pela curva de interação e pela mínima', () => {
    const { d } = detail((p) => {
      p.columnRebarOverrides = [{ columnId: cd.columnId, n: 4, phi: 0.01 }]
    })
    const det = d.columns.find((c) => c.columnId === cd.columnId)!
    expect(det).toMatchObject({ barsN: 4, barsPhi: 0.01, manual: true })
    expect(det.barPositions).toHaveLength(4)
    const c = colCheck(d)
    expect(c.status).toBe('falha')
    expect(item(c, 'rho-min').ok).toBe(false)
    // traspasse acompanha a bitola
    expect(det.lapLength).toBeLessThan(ref.detailing.columns.find((x) => x.columnId === cd.columnId)!.lapLength)
  })

  it('arranjo maior: atende com aproveitamento menor que o do programa', () => {
    const { d } = detail((p) => {
      p.columnRebarOverrides = [{ columnId: cd.columnId, n: cd.barsN + 2, phi: Math.max(cd.barsPhi, 0.016) }]
    })
    const c = colCheck(d)
    expect(c.status).toBe('ok')
    const u = Number(/aproveitamento (\d+)%/.exec(item(c, 'capacity').detail)![1])
    expect(u).toBeLessThanOrEqual(Math.round(cd.utilization * 100))
    expect(d.columns.find((x) => x.columnId === cd.columnId)!.barPositions).toHaveLength(cd.barsN + 2)
  })

  it('barras que não cabem na seção são apontadas', () => {
    const { d } = detail((p) => {
      p.columnRebarOverrides = [{ columnId: cd.columnId, n: 20, phi: 0.025 }]
    })
    const c = colCheck(d)
    // 20 φ25 numa 25×60: ou não cabem ou passam da taxa máxima
    expect(c.status).toBe('falha')
    expect(c.items.filter((i) => !i.ok).map((i) => i.id)).toEqual(
      expect.arrayContaining([item(c, 'fit').ok ? 'rho-max' : 'fit']),
    )
  })

  it('estribos: bitola e passo fora dos limites; trecho junto aos nós aumenta a contagem', () => {
    const { d } = detail((p) => {
      p.columnRebarOverrides = [{ columnId: cd.columnId, n: cd.barsN, phi: 0.025, stirrupPhi: 0.005, stirrupSpacing: 0.3 }]
    })
    const c = colCheck(d)
    expect(item(c, 'st-phi').ok).toBe(false) // φ25 pede φt ≥ 6,3
    expect(item(c, 'st-s').ok).toBe(false) // 30 cm > 20 cm
    const kgSt = (x: ReturnType<typeof runDetailing>, phi: number) =>
      x.steel.items.filter((i) => i.elementId === cd.columnId && Math.abs(i.phi - phi) < 1e-9).reduce((s, i) => s + i.n, 0)
    const { d: dj } = detail((p) => {
      p.columnRebarOverrides = [{ columnId: cd.columnId, jointLength: 0.5, jointSpacing: 0.075 }]
    })
    expect(dj.columns.find((x) => x.columnId === cd.columnId)).toMatchObject({ jointLength: 0.5, jointSpacing: 0.075 })
    expect(kgSt(dj, cd.stirrupPhi)).toBeGreaterThan(kgSt(ref.detailing, cd.stirrupPhi))
    expect(item(colCheck(dj), 'st-joint').ok).toBe(true)
    expect(colCheck(dj).status).toBe('ok')
  })
})

describe('depois de recalcular a estrutura', () => {
  it('a edição é reaplicada e reverificada com os esforços novos; se deixa de atender, vira aviso', () => {
    // armadura editada igual à do programa: atende hoje
    const p: Project = JSON.parse(JSON.stringify(base))
    const nl = spanOf(ref.detailing).negLeft!
    p.rebarOverrides = [ov('negLeft', { n: nl.n + (nl.cut?.n ?? 0), phi: nl.phi })]
    const r1 = analyze(p)
    const c1 = r1.detailing.checks!.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!
    expect(c1.manual).toBe(true)
    expect(c1.status).toBe('ok')
    expect(r1.warnings.some((w) => w.startsWith('Armadura editada'))).toBe(false)
    // revestimento pesado em todas as lajes (+12 kN/m²): a mesma armadura deixa de atender
    for (const pl of p.plans) for (const s of pl.slabs) s.finishLoad += 12
    const r2 = analyze(p)
    const c2 = r2.detailing.checks!.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!
    expect(r2.detailing.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!.negLeft!.phi).toBe(nl.phi)
    expect(c2.status).toBe('falha')
    expect(item(c2, 'negL-mrd').ok).toBe(false)
    const w = r2.warnings.find((x) => x.startsWith(`Armadura editada da viga ${span.beamName}`))
    expect(w).toContain('NÃO ATENDE')
    // sem a edição, o programa redimensiona e atende
    const q: Project = JSON.parse(JSON.stringify(p))
    q.rebarOverrides = []
    const r3 = analyze(q)
    expect(r3.detailing.checks!.beams.find((b) => b.beamId === span.beamId && b.spanIndex === span.spanIndex)!.items.find((i) => i.id === 'negL-mrd')!.ok).toBe(true)
  })
})

describe('desenhos, memorial e arquivo', () => {
  it('detalhe da viga mostra os trechos de estribo; elevação do pilar, o trecho junto aos nós', () => {
    const { d } = detail((p) => {
      p.rebarOverrides = [ov('stirrup', { phi: 0.0063, spacing: 0.25, left: { length: 1, spacing: 0.1 } })]
      p.columnRebarOverrides = [{ columnId: ref.columnDesign[0].columnId, jointLength: 0.5, jointSpacing: 0.075 }]
    })
    const texts = (dr: { primitives: { kind: string }[] }) =>
      dr.primitives.flatMap((x) => (x.kind === 'text' ? [(x as unknown as { text: string }).text] : []))
    const beamTexts = texts(buildBeamDetailDrawing(span.beamName, d.beams.filter((b) => b.beamId === span.beamId)))
    expect(beamTexts.some((t) => /φ6[.,]3: \d+ c\/10 \+ \d+ c\/25/.test(t))).toBe(true)
    const colDet = d.columns.find((c) => c.columnId === ref.columnDesign[0].columnId)!
    const { p } = detail(() => {})
    const colTexts = texts(buildColumnElevationDrawing(p, colDet))
    expect(colTexts.some((t) => t.includes('c/ 8 em 50 cm junto aos nós') || t.includes('c/ 7 em 50 cm junto aos nós'))).toBe(true)
  })

  it('memorial lista as armaduras editadas com a verificação; sem edição a seção não aparece', () => {
    const textOf = (pdf: Uint8Array) => new TextDecoder('latin1').decode(pdf)
    const plain = textOf(buildMemorialPdf(base, ref, { generatedAt: 'x' }))
    expect(plain).not.toContain('14.2 Armaduras ajustadas')
    const { p, d } = detail((q) => {
      q.rebarOverrides = [ov('negLeft', { n: 2, phi: 0.008 })]
    })
    const pdf = textOf(buildMemorialPdf(p, { ...ref, detailing: d }, { generatedAt: 'x' }))
    expect(pdf).toContain('14.2 Armaduras ajustadas pelo engenheiro')
    expect(pdf).toContain(`Viga ${span.beamName} v`)
    expect(pdf).toContain('FALHA')
  })

  it('os ajustes novos vão e voltam no arquivo do projeto', () => {
    const { p } = detail((q) => {
      q.rebarOverrides = [
        ov('negLeft', { n: 4, phi: 0.0125, length: 3.2, through: true }),
        ov('stirrup', { phi: 0.008, legs: 4, spacing: 0.2, left: { length: 0.8, spacing: 0.1 } }),
      ]
      q.columnRebarOverrides = [{ columnId: 'c', n: 8, phi: 0.016, stirrupPhi: 0.0063, stirrupSpacing: 0.15, jointLength: 0.5, jointSpacing: 0.1 }]
      q.rebarOverridesOff = true
    })
    const back = parseProject(serializeProject(p))
    expect(back.rebarOverrides).toEqual(p.rebarOverrides)
    expect(back.columnRebarOverrides).toEqual(p.columnRebarOverrides)
    expect(back.rebarOverridesOff).toBe(true)
  })
})
