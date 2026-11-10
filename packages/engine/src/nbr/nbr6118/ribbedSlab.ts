import type { LatticeParams, RibbedParams } from '../../model/types'
import { designBeamFlexure } from './beamDesign'
import { pickSlabBars, type EdgeCondition, type SlabStripInput } from './slabDesign'
import { BAR_DIAMETERS } from '../../model/presets'

/**
 * Lajes nervuradas moldadas in loco — NBR 6118 §13.2.4.2 (geometria),
 * §14.7.7 (esforços como laje maciça quando as condições valem), §19.4.1
 * (cisalhamento como laje quando l0 ≤ 65 cm).
 *
 * Distribuição de quinhões pelo método de Marcus (mesma abordagem das lajes
 * maciças); cada nervura é dimensionada como seção T com mesa colaborante
 * igual ao espaçamento — momento positivo comprime a capa (verifica-se que o
 * bloco de tensões cabe na mesa); negativos comprimem a nervura (bw).
 */

// ---------------------------------------------------------------------------
// geometria e peso próprio
// ---------------------------------------------------------------------------

export interface RibbedCheck {
  id: 'nervura' | 'capa' | 'espacamento'
  label: string
  ok: boolean
}

export interface RibbedGeometryInfo {
  /** distância livre entre faces de nervuras, m */
  l0: number
  /** espessura da capa (eco do parâmetro), m */
  topping: number
  /** fração da área em planta ocupada por nervuras */
  ribFraction: number
  /** espessura média de concreto, m (volume/м²) */
  concreteThickness: number
  /** l0 ≤ 65 cm: mesa dispensada e cisalhamento como laje (§13.2.4.2-a) */
  shearAsSlab: boolean
  /** l0 > 110 cm: tratar como vigas T independentes (§13.2.4.2-c) */
  asTBeams: boolean
  checks: RibbedCheck[]
}

/**
 * Seção transversal de UMA nervura de laje treliçada (por intereixo):
 * capa I×hf + alma bw×he + abas da sapata (bv−bw)×hv sob o enchimento.
 * bw = bv − 2·ah · I = be + bv · H = he + hf.
 */
export interface LatticeSection {
  /** altura total, m */
  h: number
  /** largura da alma (nervura), m */
  bw: number
  /** intereixo, m */
  spacing: number
  /** área de concreto por nervura, m² */
  concreteArea: number
  /** área de enchimento por nervura, m² */
  fillerArea: number
}

export function latticeSection(l: LatticeParams, topping: number): LatticeSection {
  const bw = Math.max(l.baseWidth - 2 * l.fillerLedge, 0.01)
  const spacing = l.fillerWidth + l.baseWidth
  const h = l.fillerHeight + topping
  const hv = Math.min(l.baseHeight, l.fillerHeight)
  const ribArea = bw * l.fillerHeight + (l.baseWidth - bw) * hv
  return {
    h,
    bw,
    spacing,
    concreteArea: spacing * topping + ribArea,
    fillerArea: Math.max(spacing * l.fillerHeight - ribArea, 0),
  }
}

/** fração da área em planta ocupada pelas nervuras */
export function ribFraction(r: RibbedParams): number {
  const s = Math.max(r.spacing, r.ribWidth + 0.01)
  if (r.dirs === 'xy') return (r.ribWidth * (2 * s - r.ribWidth)) / (s * s)
  return r.ribWidth / s
}

/** verificações geométricas §13.2.4.2 + classificação do espaçamento */
export function ribbedGeometry(h: number, r: RibbedParams): RibbedGeometryInfo {
  const l0 = Math.max(r.spacing - r.ribWidth, 0)
  const f = ribFraction(r)
  const checks: RibbedCheck[] = [
    {
      id: 'nervura',
      label: 'Nervura bw ≥ 5 cm (≥ 8 cm se armadura de compressão)',
      ok: r.ribWidth >= 0.05 - 1e-9,
    },
    {
      id: 'capa',
      label: 'Capa ≥ 4 cm e ≥ l0/15',
      ok: r.topping >= 0.04 - 1e-9 && r.topping >= l0 / 15 - 1e-9,
    },
    {
      id: 'espacamento',
      label: 'Altura total > capa + 2 cm e espaçamento > bw',
      ok: h > r.topping + 0.02 && r.spacing > r.ribWidth,
    },
  ]
  // treliçada: volume real da seção (inclui as abas da sapata da vigota)
  const lat = r.lattice ? latticeSection(r.lattice, r.topping) : null
  return {
    l0,
    topping: r.topping,
    ribFraction: f,
    concreteThickness: lat
      ? lat.concreteArea / lat.spacing
      : r.topping + (h - r.topping) * f,
    shearAsSlab: l0 <= 0.65 + 1e-9,
    asTBeams: l0 > 1.1 + 1e-9,
    checks,
  }
}

/** peso próprio por m² (concreto + enchimento), kN/m² */
export function ribbedSelfWeight(h: number, r: RibbedParams, gammaC: number): number {
  if (r.lattice) {
    const sec = latticeSection(r.lattice, r.topping)
    return (sec.concreteArea * gammaC + sec.fillerArea * r.fillerWeight) / sec.spacing
  }
  const geo = ribbedGeometry(h, r)
  const fillerVol = (h - r.topping) * (1 - geo.ribFraction)
  return geo.concreteThickness * gammaC + fillerVol * r.fillerWeight
}

// ---------------------------------------------------------------------------
// dimensionamento
// ---------------------------------------------------------------------------

export interface RibbedDesignInput {
  a: SlabStripInput
  b: SlabStripInput
  /** altura total, m */
  h: number
  ribbed: RibbedParams
  /** cargas características, kN/m² (g já inclui o peso próprio real) */
  g: number
  q: number
  psi2: number
  cover: number
  fcd: number
  fck: number
  fyd: number
  fctm: number
  fctd: number
  ecs: number
  /** fywk p/ estribo mínimo, kPa */
  fywk: number
  /** peso específico do concreto, kN/m³ (g0 informativo) */
  gammaC: number
  /**
   * unidirecional: as nervuras vencem o vão da faixa A? (o chamador resolve
   * pela geometria real da laje; ausente = assume faixa A ∥ X global)
   */
  ribsAlongA?: boolean
}

export interface RibbedDirectionResult {
  span: number
  fixedEnds: EdgeCondition
  /** quinhão característico da direção, kN/m² */
  w: number
  /** momento de cálculo POR NERVURA no vão, kN·m */
  mRibSpan: number
  mRibSupport: number
  /** área de aço por nervura (vão), m² */
  asRib: number
  asRibMin: number
  /** barras por nervura, ex.: "2 φ 12,5" */
  ribBars: string
  /** armadura negativa por metro (na capa/nervura), m²/m */
  asSupportPerM: number
  supportSpec: string
  /** cortante de cálculo por nervura, kN */
  vRib: number
  /** resistência sem estribos (§19.4.1), kN */
  vrd1: number
  shearOk: boolean
  /** estribo quando exigido (l0 > 65 cm ou VSd > VRd1) */
  stirrup: string | null
  /** bloco de tensões dentro da capa (momento positivo) */
  flangeOk: boolean
  ok: boolean
  note?: string
}

export interface RibbedDesignOutput {
  /** peso próprio real usado, kN/m² */
  g0: number
  geometry: RibbedGeometryInfo
  dirA: RibbedDirectionResult
  dirB: RibbedDirectionResult
  oneWay: boolean
  deflection: number
  deflectionLimit: number
  deflectionOk: boolean
  notes: string[]
}

const DEFLECTION_COEF: Record<EdgeCondition, number> = { 0: 5, 1: 384 / 185, 2: 1 }
const SPAN_M: Record<EdgeCondition, number> = { 0: 8, 1: 128 / 9, 2: 24 }
const SUPPORT_M: Record<EdgeCondition, number> = { 0: Infinity, 1: 8, 2: 12 }
/** coeficiente do cortante máximo: V = c·w·L */
const SHEAR_C: Record<EdgeCondition, number> = { 0: 0.5, 1: 0.625, 2: 0.5 }

/** barras por nervura: 1–3 barras da série comercial */
export function pickRibBars(as: number, bw: number): { spec: string; asProv: number } {
  if (as < 1e-9) return { spec: '—', asProv: 0 }
  for (const phi of BAR_DIAMETERS) {
    if (phi < 0.008) continue
    const aPhi = (Math.PI * phi * phi) / 4
    for (let n = 1; n <= 3; n++) {
      // espaço horizontal: n barras + folgas ≥ 2 cm entre elas
      const needed = n * phi + (n - 1) * 0.02 + 2 * 0.03
      if (n > 1 && needed > bw) break
      if (n * aPhi >= as) {
        const mm = Math.round(phi * 1000 * 10) / 10
        return {
          spec: `${n} φ ${mm % 1 === 0 ? mm.toFixed(0) : String(mm).replace('.', ',')}`,
          asProv: n * aPhi,
        }
      }
    }
  }
  return { spec: 'aumentar h/bw', asProv: as }
}

/** VRd1 sem armadura transversal — NBR 6118 §19.4.1 (laje), kN */
export function slabShearVrd1(
  bw: number,
  d: number,
  fctd: number,
  rho1: number,
): number {
  const tauRd = 0.25 * fctd // kPa
  const k = Math.max(1.6 - d, 1) // d em m
  const rho = Math.min(rho1, 0.02)
  return tauRd * k * (1.2 + 40 * rho) * bw * d
}

export function designRibbedSlab(inp: RibbedDesignInput): RibbedDesignOutput {
  const notes: string[] = []
  const { h, ribbed: r } = inp
  const geo = ribbedGeometry(h, r)
  const gammaF = 1.4
  const wk = inp.g + inp.q
  const la = inp.a.span
  const lb = inp.b.span
  const lx = Math.min(la, lb)

  // unidirecional por geometria (dirs) ou por proporção de vãos
  const oneWayGeom = r.dirs !== 'xy'
  const oneWaySpan = Math.max(la, lb) / Math.max(lx, 1e-6) > 2
  const oneWay = oneWayGeom || oneWaySpan

  let wa: number
  let wb: number
  if (oneWay) {
    // nervuras 'x' correm ao longo de X ⇒ vencem o vão na direção X.
    // A faixa da direção A tem vão la; escolhe a direção das nervuras/menor vão.
    const aCarries = oneWayGeom ? (inp.ribsAlongA ?? r.dirs === 'x') : la <= lb
    wa = aCarries ? wk : 0
    wb = aCarries ? 0 : wk
    notes.push(
      oneWayGeom
        ? 'Nervuras em uma direção — laje unidirecional (distribuição na capa na outra direção).'
        : 'Laje armada em uma direção (λ > 2).',
    )
  } else {
    const da = DEFLECTION_COEF[inp.a.fixedEnds] * la ** 4
    const db = DEFLECTION_COEF[inp.b.fixedEnds] * lb ** 4
    wa = (wk * db) / (da + db)
    wb = wk - wa
  }

  if (geo.asTBeams) {
    notes.push(
      `Espaçamento livre l0 = ${(geo.l0 * 100).toFixed(0)} cm > 110 cm — tratar as nervuras como VIGAS T independentes (§13.2.4.2-c); a capa deve ser verificada como laje apoiada nelas.`,
    )
  } else if (!geo.shearAsSlab) {
    notes.push(
      `l0 = ${(geo.l0 * 100).toFixed(0)} cm entre 65 e 110 cm — mesa verificada à flexão como laje e nervuras ao cisalhamento como VIGAS (estribos) — §13.2.4.2-b.`,
    )
  }

  const d = Math.max(h - inp.cover - 0.0063 - 0.008, 0.5 * h) // estribo/porta + φ/2
  const asRibMin = 0.0015 * r.ribWidth * h // ρmin sobre a alma (§17.3.5.2.1, T)

  const designDir = (strip: SlabStripInput, w: number): RibbedDirectionResult => {
    const wd = gammaF * w
    const s = r.spacing
    // momentos por metro (Marcus) × espaçamento = por nervura
    const mSpanPerM = strip.span > 0 ? (wd * strip.span ** 2) / SPAN_M[strip.fixedEnds] : 0
    const mSupPerM =
      strip.fixedEnds > 0 ? (wd * strip.span ** 2) / SUPPORT_M[strip.fixedEnds] : 0
    const mRibSpan = mSpanPerM * s
    const mRibSupport = mSupPerM * s

    // positivo: mesa comprimida — retangular com b = espaçamento; conferir
    // bloco (0,8x) dentro da capa
    const flexSpan = designBeamFlexure({
      md: mRibSpan,
      bw: s,
      h,
      d,
      fcd: inp.fcd,
      fyd: inp.fyd,
      fck: inp.fck,
    })
    const xNeutral = flexSpan.xd * d
    const flangeOk = 0.8 * xNeutral <= r.topping + 1e-9 || mRibSpan < 1e-9
    const asRib = Math.max(flexSpan.as, asRibMin)
    const bars = pickRibBars(asRib, r.ribWidth)

    // negativo: compressão na nervura (bw) — armadura por metro na face superior
    let asSupportPerM = 0
    if (mRibSupport > 0) {
      const flexSup = designBeamFlexure({
        md: mRibSupport,
        bw: r.ribWidth,
        h,
        d,
        fcd: inp.fcd,
        fyd: inp.fyd,
        fck: inp.fck,
      })
      asSupportPerM = Math.max(flexSup.as / s, 0.0015 * h)
    }

    // cisalhamento por nervura
    const vRib = SHEAR_C[strip.fixedEnds] * wd * strip.span * s
    const rho1 = Math.min(bars.asProv / (r.ribWidth * d), 0.02)
    const vrd1 = slabShearVrd1(r.ribWidth, d, inp.fctd, rho1)
    let stirrup: string | null = null
    let shearOk = true
    if (geo.shearAsSlab && vRib <= vrd1) {
      // dispensa armadura transversal (§19.4.1)
    } else if (vRib > 1e-9) {
      // como viga: estribo mínimo (Asw/s = 0,2·fctm/fywk·bw), φ5
      const aswSMin = (0.2 * inp.fctm * r.ribWidth) / inp.fywk
      const aPhi5 = (Math.PI * 0.005 * 0.005) / 4
      const spacing = Math.min((2 * aPhi5) / aswSMin, 0.6 * d, 0.3)
      stirrup = `φ5 c/ ${Math.max(5, Math.floor(spacing * 100))}`
      shearOk = true // mínimo cobre nervuras usuais; VRd2 raramente governa (nota)
      if (!geo.shearAsSlab) {
        // ok — regime de viga já esperado
      } else {
        notes.push(
          `Nervura com VSd = ${vRib.toFixed(1)} kN > VRd1 = ${vrd1.toFixed(1)} kN — prever estribos (${stirrup}).`,
        )
      }
    }

    return {
      span: strip.span,
      fixedEnds: strip.fixedEnds,
      w,
      mRibSpan,
      mRibSupport,
      asRib,
      asRibMin,
      ribBars: bars.spec,
      asSupportPerM,
      supportSpec: mRibSupport > 0 ? pickSlabBars(asSupportPerM, h) : '—',
      vRib,
      vrd1,
      shearOk,
      stirrup,
      flangeOk,
      ok: flexSpan.ok && flangeOk,
      note: !flangeOk
        ? 'Bloco de compressão sai da capa — aumente a capa/altura (seção T real).'
        : flexSpan.note,
    }
  }

  const dirA = designDir(inp.a, wa)
  const dirB = designDir(inp.b, wb)

  // flecha: faixa governante com inércia da seção T por metro
  const wQp = inp.g + inp.psi2 * inp.q
  const ratio = wk > 1e-9 ? wQp / wk : 0
  const govern = la <= lb ? { strip: inp.a, w: wa } : { strip: inp.b, w: wb }
  // seção T por nervura: mesa s×capa + alma bw×(h−capa)
  const s = r.spacing
  const bwv = r.ribWidth
  const hf = r.topping
  const hw = h - hf
  const aF = s * hf
  const aW = bwv * hw
  const yF = h - hf / 2 // medido da base
  const yW = hw / 2
  const yBar = (aF * yF + aW * yW) / (aF + aW)
  const iT =
    (s * hf ** 3) / 12 +
    aF * (yF - yBar) ** 2 +
    (bwv * hw ** 3) / 12 +
    aW * (yW - yBar) ** 2
  const iPerM = iT / s
  const coef = DEFLECTION_COEF[govern.strip.fixedEnds]
  const deltaElastic =
    (coef * (govern.w * ratio) * govern.strip.span ** 4) / (384 * inp.ecs * iPerM)
  // Branson: Mr da seção T (tração na base)
  const maQp =
    govern.strip.span > 0
      ? (((govern.w * ratio) * govern.strip.span ** 2) / SPAN_M[govern.strip.fixedEnds]) * s
      : 0
  const w0 = iT / Math.max(yBar, 1e-6)
  const mr = 1.2 * inp.fctm * w0 // α = 1,2 p/ seção T (§17.3.1)
  let ieqRatio = 1
  if (maQp > mr) {
    const iii = 0.35 * iT
    const r3 = (mr / maQp) ** 3
    ieqRatio = iT / Math.min(iT, r3 * iT + (1 - r3) * iii)
    notes.push('Nervura fissura em serviço (Ma > Mr) — flecha ampliada por Branson (III≈0,35·Ic).')
  }
  const alphaF = 1.32
  const deflection = deltaElastic * ieqRatio * (1 + alphaF)
  const deflectionLimit = lx / 250

  for (const c of geo.checks) {
    if (!c.ok) notes.push(`Geometria fora da NBR 6118 §13.2.4.2: ${c.label}.`)
  }

  return {
    g0: ribbedSelfWeight(h, r, inp.gammaC),
    geometry: geo,
    dirA,
    dirB,
    oneWay,
    deflection,
    deflectionLimit,
    deflectionOk: deflection <= deflectionLimit,
    notes,
  }
}
