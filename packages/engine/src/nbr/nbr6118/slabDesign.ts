import { designBeamFlexure } from './beamDesign'
import { SLAB_BAR_DIAMETERS } from '../../model/presets'

/**
 * Dimensionamento de lajes maciças retangulares pelo método de Marcus
 * (grelha de faixas com compatibilização de flechas), SEM a redução de
 * momentos por torção — a favor da segurança. NBR 6118 §19 p/ armaduras
 * mínimas e §13.3 p/ espessuras.
 *
 * Condições de apoio por direção: número de bordas engastadas (0, 1 ou 2)
 * nas DUAS bordas que servem de apoio à faixa daquela direção.
 */

export type EdgeCondition = 0 | 1 | 2

export interface SlabStripInput {
  /** vão da faixa, m */
  span: number
  /** bordas engastadas no apoio da faixa (0=biapoiada, 1=um engaste, 2=dois) */
  fixedEnds: EdgeCondition
}

export interface SlabDesignInput {
  /** direção A e B (A = ao longo da 1ª borda do polígono) */
  a: SlabStripInput
  b: SlabStripInput
  thickness: number // m
  /** carga total de cálculo? NÃO — característica: g e q separados, kN/m² */
  g: number
  q: number
  /** ψ2 p/ flecha quase-permanente */
  psi2: number
  cover: number // m
  fcd: number
  fck: number
  fyd: number
  fctm: number
  ecs: number // kPa
}

export interface SlabDirectionResult {
  span: number
  fixedEnds: EdgeCondition
  /** quinhão de carga da direção (característico), kN/m² */
  w: number
  mSpanD: number // kN·m/m (de cálculo, 1,4·(g+q) rateado)
  mSupportD: number // kN·m/m nos engastes (0 se biapoiada)
  asSpan: number // m²/m
  asSpanMin: number
  asSupport: number
  spanSpec: string // "φ8 c/ 15"
  supportSpec: string
  ok: boolean
  note?: string
}

export interface SlabDesignOutput {
  dirA: SlabDirectionResult
  dirB: SlabDirectionResult
  oneWay: boolean
  /** flecha total estimada (imediata×(1+αf)) na combinação QP, m */
  deflection: number
  deflectionLimit: number // lx/250
  deflectionOk: boolean
  minThicknessOk: boolean
  notes: string[]
}

/** coeficiente de flecha (multiplicador de w·l⁴/(384·EI)) por condição */
const DEFLECTION_COEF: Record<EdgeCondition, number> = { 0: 5, 1: 384 / 185, 2: 1 }
/** divisor do momento de vão: M = w·l²/m */
const SPAN_M: Record<EdgeCondition, number> = { 0: 8, 1: 128 / 9, 2: 24 }
/** divisor do momento de engaste: X = w·l²/n */
const SUPPORT_M: Record<EdgeCondition, number> = { 0: Infinity, 1: 8, 2: 12 }

/** escolha de malha: menor φ com espaçamento dentro de [7,5 cm; min(2h, 20 cm)] */
export function pickSlabBars(as: number, thickness: number): string {
  const sMax = Math.min(2 * thickness, 0.2)
  if (as < 1e-9) return '—'
  for (const phi of SLAB_BAR_DIAMETERS) {
    const aPhi = (Math.PI * phi * phi) / 4
    let s = aPhi / as
    if (s > sMax) s = sMax
    if (s >= 0.075) {
      const mm = Math.round(phi * 10000) / 10
      const scm = Math.floor(s * 100)
      return `φ${mm % 1 === 0 ? mm.toFixed(0) : mm} c/ ${scm}`
    }
  }
  const phi = SLAB_BAR_DIAMETERS[SLAB_BAR_DIAMETERS.length - 1]
  const aPhi = (Math.PI * phi * phi) / 4
  const s = Math.max(0.05, aPhi / as)
  return `φ12.5 c/ ${Math.floor(s * 100)} (adensar/aumentar h)`
}

/** ρmin de tab. 17.3 (mesma do beamDesign) aplicada a lajes */
function rhoMin(fck: number): number {
  const fckMPa = fck / 1000
  if (fckMPa <= 30) return 0.0015
  const table: [number, number][] = [
    [30, 0.0015],
    [35, 0.00164],
    [40, 0.00179],
    [45, 0.00194],
    [50, 0.00208],
  ]
  for (let i = 0; i + 1 < table.length; i++) {
    const [f1, r1] = table[i]
    const [f2, r2] = table[i + 1]
    if (fckMPa <= f2) return r1 + ((r2 - r1) * (fckMPa - f1)) / (f2 - f1)
  }
  return 0.00208
}

export function designSlab(inp: SlabDesignInput): SlabDesignOutput {
  const notes: string[] = []
  const h = inp.thickness
  const wk = inp.g + inp.q // característico
  const gammaF = 1.4
  const la = inp.a.span
  const lb = inp.b.span
  const lx = Math.min(la, lb)
  const oneWay = Math.max(la, lb) / Math.max(lx, 1e-6) > 2

  // distribuição de Marcus (flechas compatíveis) — característica
  let wa: number
  let wb: number
  if (oneWay) {
    if (la <= lb) {
      wa = wk
      wb = 0
    } else {
      wa = 0
      wb = wk
    }
    notes.push('Laje armada em uma direção (λ > 2) — armadura de distribuição na outra.')
  } else {
    const da = DEFLECTION_COEF[inp.a.fixedEnds] * la ** 4
    const db = DEFLECTION_COEF[inp.b.fixedEnds] * lb ** 4
    wa = (wk * db) / (da + db)
    wb = wk - wa
  }

  const dPos = Math.max(h - inp.cover - 0.005, 0.5 * h) // φ~10 estimado
  const asMinSpan = 0.67 * rhoMin(inp.fck) * h // tab. 19.1: positiva ≥ 0,67·ρmin
  const asMinSupport = rhoMin(inp.fck) * h

  const designDir = (
    strip: SlabStripInput,
    w: number,
    otherAsSpan: number,
  ): SlabDirectionResult => {
    const wd = gammaF * w
    const mSpanD = strip.span > 0 ? (wd * strip.span ** 2) / SPAN_M[strip.fixedEnds] : 0
    const mSupportD =
      strip.fixedEnds > 0 ? (wd * strip.span ** 2) / SUPPORT_M[strip.fixedEnds] : 0

    const flexSpan = designBeamFlexure({
      md: mSpanD,
      bw: 1,
      h,
      d: dPos,
      fcd: inp.fcd,
      fyd: inp.fyd,
      fck: inp.fck,
    })
    // armadura de distribuição quando a direção quase não trabalha
    const asDist = Math.max(0.2 * otherAsSpan, 0.9e-4, 0.5 * rhoMin(inp.fck) * h)
    const asSpan = Math.max(flexSpan.as, asMinSpan, w < 1e-9 ? asDist : 0)

    let asSupport = 0
    if (mSupportD > 0) {
      const flexSup = designBeamFlexure({
        md: mSupportD,
        bw: 1,
        h,
        d: dPos,
        fcd: inp.fcd,
        fyd: inp.fyd,
        fck: inp.fck,
      })
      asSupport = Math.max(flexSup.as, asMinSupport)
    }
    return {
      span: strip.span,
      fixedEnds: strip.fixedEnds,
      w,
      mSpanD,
      mSupportD,
      asSpan,
      asSpanMin: asMinSpan,
      asSupport,
      spanSpec: pickSlabBars(asSpan, h),
      supportSpec: mSupportD > 0 ? pickSlabBars(asSupport, h) : '—',
      ok: flexSpan.ok,
      note: flexSpan.note,
    }
  }

  // duas passadas p/ resolver a dependência da armadura de distribuição
  let dirA = designDir(inp.a, wa, 0)
  let dirB = designDir(inp.b, wb, dirA.asSpan)
  dirA = designDir(inp.a, wa, dirB.asSpan)

  // flecha: faixa governante (a que carrega mais na direção do menor vão)
  const wQp = inp.g + inp.psi2 * inp.q
  const ratio = wk > 1e-9 ? wQp / wk : 0
  const govern = dirA.span <= dirB.span ? { strip: inp.a, w: wa } : { strip: inp.b, w: wb }
  const iC = h ** 3 / 12 // por metro
  const coef = DEFLECTION_COEF[govern.strip.fixedEnds]
  const deltaElastic =
    (coef * (govern.w * ratio) * govern.strip.span ** 4) / (384 * inp.ecs * iC)
  // fissuração (Branson) na faixa: Ma em serviço QP
  const maQp =
    govern.strip.span > 0
      ? ((govern.w * ratio) * govern.strip.span ** 2) / SPAN_M[govern.strip.fixedEnds]
      : 0
  const mr = 0.25 * inp.fctm * 1 * h * h // α=1,5 · fct · W0, W0 = h²/6 (b=1)
  let ieqRatio = 1
  if (maQp > mr) {
    // laje fissurada: aproximação com III ≈ 0,3·Ic (típico p/ ρ baixas)
    const iii = 0.3 * iC
    const r3 = (mr / maQp) ** 3
    ieqRatio = iC / Math.min(iC, r3 * iC + (1 - r3) * iii)
    notes.push('Laje fissura em serviço (Ma > Mr) — flecha ampliada por Branson (III≈0,3·Ic).')
  }
  const alphaF = 1.32 // ξ(∞)=2, ξ(1 mês)=0,68, ρ′=0
  const deflection = deltaElastic * ieqRatio * (1 + alphaF)
  const deflectionLimit = lx / 250

  const minThicknessOk = h >= 0.08 // NBR 13.2.4.1: piso ≥ 8 cm (não em balanço)
  if (!minThicknessOk) notes.push('Espessura < 8 cm — mínimo da NBR 6118 §13.2.4.1 p/ laje de piso.')

  return {
    dirA,
    dirB,
    oneWay,
    deflection,
    deflectionLimit,
    deflectionOk: deflection <= deflectionLimit,
    minThicknessOk,
    notes,
  }
}
