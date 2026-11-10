import type { LatticeParams, RibbedParams } from '../../model/types'
import {
  CA60_FYK,
  LATTICE_DIAGONAL_PITCH,
  LATTICE_FILLER_WEIGHT,
  WELDED_MESHES,
} from '../../model/presets'
import { designBeamFlexure, rhoMin } from './beamDesign'
import { designTBeamFlexure } from './tSection'
import { pickSlabBars, type EdgeCondition } from './slabDesign'
import { latticeSection, slabShearVrd1 } from './ribbedSlab'

/**
 * Lajes TRELIÇADAS unidirecionais (vigota pré-fabricada com armação
 * treliçada + enchimento + capa moldada in loco) — NBR 14859 (elementos) e
 * NBR 6118 (dimensionamento como nervurada: §13.2.4.2, §17.2, §19.4, §17.3).
 *
 * Modelo: cada vigota é uma viga T (mesa = intereixo × capa, alma = bw) que
 * vence o vão entre as vigas de apoio. Banzo inferior da treliça (2 fios
 * CA-60) é a armadura positiva base; barras adicionais na sapata completam.
 * Fase de montagem (escoramento) NÃO é verificada — seguir o fabricante.
 */

// ---------------------------------------------------------------------------
// geometria
// ---------------------------------------------------------------------------

/** designação comercial: "LT 16 (12+4)" */
export function latticeDesignation(l: LatticeParams, topping: number): string {
  const cmv = (v: number) => {
    const c = Math.round(v * 1000) / 10
    return c % 1 === 0 ? c.toFixed(0) : String(c).replace('.', ',')
  }
  return `LT ${cmv(l.fillerHeight + topping)} (${cmv(l.fillerHeight)}+${cmv(topping)})`
}

/**
 * Parâmetros de nervura + altura total derivados da vigota (mantém
 * `Slab.ribbed`/`Slab.thickness` coerentes com a composição treliçada).
 */
export function latticeRibbed(
  l: LatticeParams,
  topping: number,
  dirs: 'x' | 'y',
  fillerWeight: number = LATTICE_FILLER_WEIGHT[l.filler],
): { ribbed: RibbedParams; thickness: number } {
  const sec = latticeSection(l, topping)
  return {
    thickness: sec.h,
    ribbed: {
      dirs,
      ribWidth: sec.bw,
      spacing: sec.spacing,
      topping,
      fillerWeight,
      label: latticeDesignation(l, topping),
      lattice: l,
    },
  }
}

/** massa linear da armação treliçada, kg/m (1 banzo sup. + 2 inf. + 2 sinusoides) */
export function trussLinearMass(l: LatticeParams): number {
  const a = (phi: number) => (Math.PI * phi * phi) / 4
  const half = LATTICE_DIAGONAL_PITCH / 2
  const diagFactor = Math.hypot(half, l.trussHeight) / half
  return 7850 * (a(l.phiTop) + 2 * a(l.phiBottom) + 2 * a(l.phiDiag) * diagFactor)
}

// ---------------------------------------------------------------------------
// dimensionamento
// ---------------------------------------------------------------------------

export interface LatticeDesignInput {
  lattice: LatticeParams
  /** capa, m */
  topping: number
  /** vão teórico das vigotas, m */
  span: number
  /** engaste por continuidade no apoio inicial/final (só com lattice.continuous) */
  fixedStart: boolean
  fixedEnd: boolean
  /** cargas características, kN/m² (g JÁ inclui o peso próprio) */
  g: number
  q: number
  /** peso próprio (informativo), kN/m² */
  g0: number
  psi1: number
  psi2: number
  fck: number
  fcd: number
  fctm: number
  fctd: number
  ecs: number
  /** fyd das barras adicionais/negativas (aço do projeto, CA-50), kPa */
  fyd: number
  /** γs e Es do aço */
  gammaS: number
  es: number
  /** limite de abertura de fissuras (tab. 13.4), m */
  wkLimit: number
  /** as vigotas vencem o vão da faixa A da laje (1ª borda)? — p/ pranchas */
  ribsAlongA: boolean
}

export interface LatticeCheck {
  id: 'capa' | 'nervura' | 'intereixo' | 'trelica'
  label: string
  ok: boolean
}

export interface LatticeDesignOutput {
  /** "LT 16 (12+4)" */
  designation: string
  truss: string
  /** geometria da seção (m) */
  h: number
  hf: number
  bw: number
  spacing: number
  d: number
  /** espessura média de concreto, m (volume por m²) */
  concreteThickness: number
  checks: LatticeCheck[]
  span: number
  fixedEnds: EdgeCondition
  ribsAlongA: boolean
  /** cargas características, kN/m² */
  g0: number
  g: number
  q: number
  // ---- ELU flexão (por vigota) ----
  /** momentos de cálculo por vigota, kN·m */
  mdSpan: number
  mdSupport: number
  xd: number
  /** bloco de compressão dentro da capa */
  flangeOk: boolean
  /** As necessária em área EQUIVALENTE CA-60, m² */
  asReq: number
  asMin: number
  /** banzo inferior da treliça (2 fios), m² */
  asTruss: number
  /** barras adicionais adotadas (null = treliça basta) */
  extra: { n: number; phi: number; auto: boolean } | null
  /** As efetiva equivalente CA-60 (treliça + adicionais), m² */
  asProvided: number
  /** "2 φ5 (treliça) + 1 φ8" */
  bars: string
  flexOk: boolean
  // ---- negativos / capa ----
  /** As negativa por metro sobre apoio contínuo (CA-50), m²/m — 0 se biapoiada */
  asSupportPerM: number
  supportSpec: string
  /** alma não resiste ao negativo: prever faixa maciça junto ao apoio */
  solidStrip: boolean
  /** negativa construtiva (anti-fissuração) em apoios tratados como simples, m²/m */
  asNegConstructivePerM: number
  negConstructiveSpec: string
  mesh: { name: string; as: number; asMin: number; ok: boolean }
  // ---- cisalhamento (por vigota) ----
  vd: number
  vrd1: number
  /** verificação precisou das diagonais da treliça como armadura transversal */
  usesDiagonals: boolean
  /** resistência com diagonais: mín(VRd2, Vc + Vsw), kN (0 se não usada) */
  vrd3: number
  shearOk: boolean
  // ---- ELS ----
  /** flecha imediata (quase permanente) e total com fluência, m */
  deflectionImmediate: number
  deflection: number
  deflectionLimit: number
  deflectionOk: boolean
  /** contraflecha sugerida p/ atender L/250 (≤ L/350), m — 0 se dispensada/insuficiente */
  counterCamber: number
  /** abertura de fissuras na combinação frequente, m */
  wk: number
  wkLimit: number
  crackOk: boolean
  // ---- integração ----
  /** reações características por metro de apoio [inicial, final], kN/m */
  reactions: { g: [number, number]; q: [number, number] }
  /** consumo de aço (treliça + adicionais + tela), kg/m² */
  steelKgPerM2: number
  ok: boolean
  notes: string[]
}

const GAMMA_F = 1.4
const SPAN_M: Record<EdgeCondition, number> = { 0: 8, 1: 128 / 9, 2: 24 }
const SUPPORT_M: Record<EdgeCondition, number> = { 0: Infinity, 1: 8, 2: 12 }
const DEFLECTION_COEF: Record<EdgeCondition, number> = { 0: 5, 1: 384 / 185, 2: 1 }
/** η1 de fios entalhados CA-60 (§9.3.2.1) — a favor da segurança p/ wk */
const ETA1_CA60 = 1.4
/** αf da flecha diferida (§17.3.2.1.2: t0 = 1 mês, t → ∞, ρ' = 0) */
const ALPHA_F = 1.32

const area = (phi: number) => (Math.PI * phi * phi) / 4

const fmtPhi = (phi: number) => {
  const mm = Math.round(phi * 10000) / 10
  return mm % 1 === 0 ? mm.toFixed(0) : String(mm).replace('.', ',')
}

/** fração do cortante/reação em cada extremo [inicial, final] */
export function latticeEndShares(fixedStart: boolean, fixedEnd: boolean): [number, number] {
  if (fixedStart && !fixedEnd) return [0.625, 0.375]
  if (!fixedStart && fixedEnd) return [0.375, 0.625]
  return [0.5, 0.5]
}

/** barras adicionais candidatas (φ ≤ 6 mm = CA-60; acima = aço do projeto) */
const EXTRA_PHIS = [0.005, 0.006, 0.0063, 0.008, 0.01, 0.0125]

/**
 * Seção T fissurada (estádio II puro): LN e inércia, com mesa bf×hf e alma bw.
 */
export function crackedTSection(
  bf: number,
  bw: number,
  hf: number,
  d: number,
  as: number,
  alphaE: number,
): { x: number; i2: number } {
  const k = alphaE * as
  // LN na mesa: (bf/2)·x² + k·x − k·d = 0
  let x = (-k + Math.sqrt(k * k + 2 * bf * k * d)) / bf
  if (x > hf) {
    // LN na alma: (bw/2)x² + [(bf−bw)hf + k]x − [(bf−bw)hf²/2 + k·d] = 0
    const a = bw / 2
    const b = (bf - bw) * hf + k
    const c = -((bf - bw) * hf * hf) / 2 - k * d
    x = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
  }
  const i2 =
    (bf * x ** 3) / 3 -
    (x > hf ? ((bf - bw) * (x - hf) ** 3) / 3 : 0) +
    k * (d - x) ** 2
  return { x, i2 }
}

export function designLatticeSlab(inp: LatticeDesignInput): LatticeDesignOutput {
  const notes: string[] = []
  const l = inp.lattice
  const sec = latticeSection(l, inp.topping)
  const { h, bw, spacing } = sec
  const hf = inp.topping
  const L = inp.span
  const fixedEnds = ((inp.fixedStart ? 1 : 0) + (inp.fixedEnd ? 1 : 0)) as EdgeCondition
  const fyd60 = CA60_FYK / inp.gammaS
  // armaduras positivas no meio da altura da sapata da vigota
  const d = h - l.baseHeight / 2
  const l0 = spacing - bw

  // ------------------------------------------------------------- geometria
  const topChord = l.baseHeight / 2 + l.trussHeight // cota do banzo superior
  const checks: LatticeCheck[] = [
    {
      id: 'capa',
      label: 'Capa ≥ 4 cm e ≥ l0/15 (NBR 6118 §13.2.4.2)',
      ok: hf >= 0.04 - 1e-9 && hf >= l0 / 15 - 1e-9,
    },
    { id: 'nervura', label: 'Nervura bw ≥ 5 cm (§13.2.4.2)', ok: bw >= 0.05 - 1e-9 },
    {
      id: 'intereixo',
      label: 'Distância livre entre nervuras l0 ≤ 65 cm (dimensionamento como laje)',
      ok: l0 <= 0.65 + 1e-9,
    },
    {
      id: 'trelica',
      label: 'Treliça cabe na altura (banzo superior com ≥ 1,5 cm de capa acima)',
      ok: topChord + 0.015 <= h + 1e-9,
    },
  ]
  for (const c of checks) if (!c.ok) notes.push(`Geometria: ${c.label} — NÃO atendido.`)

  // ------------------------------------------------------------ ELU flexão
  const wd = GAMMA_F * (inp.g + inp.q) * spacing // kN/m por vigota
  const mdSpan = L > 0 ? (wd * L * L) / SPAN_M[fixedEnds] : 0
  const mdSupport = fixedEnds > 0 ? (wd * L * L) / SUPPORT_M[fixedEnds] : 0

  // positivo: seção T (mesa = intereixo), aço de referência CA-60 (treliça)
  const flex = designTBeamFlexure({
    md: mdSpan,
    bw,
    bf: spacing,
    hf,
    h,
    d,
    fcd: inp.fcd,
    fyd: fyd60,
    fck: inp.fck,
  })
  const asMin = rhoMin(inp.fck / 1000) * bw * h
  const asReq = Math.max(flex.as, asMin)
  const asTruss = 2 * area(l.phiBottom)
  /** fator de equivalência da barra adicional em área CA-60 */
  const eqFactor = (phi: number) => (phi <= 0.006 + 1e-9 ? 1 : Math.min(inp.fyd / fyd60, 1))

  let extra: LatticeDesignOutput['extra'] = null
  let extraOk = true
  if (l.extraBars && l.extraBars.n > 0) {
    extra = { n: l.extraBars.n, phi: l.extraBars.phi, auto: false }
  } else if (asTruss < asReq - 1e-12) {
    // menor área de aço que cobre o déficit (até 2 barras na sapata)
    const deficit = asReq - asTruss
    let best: { n: number; phi: number; a: number } | null = null
    for (const phi of EXTRA_PHIS) {
      for (const n of [1, 2]) {
        if (n * area(phi) * eqFactor(phi) < deficit - 1e-12) continue
        if (!best || n * area(phi) < best.a - 1e-12) best = { n, phi, a: n * area(phi) }
      }
    }
    if (best) extra = { n: best.n, phi: best.phi, auto: true }
    else {
      extra = { n: 2, phi: 0.0125, auto: true }
      extraOk = false
      notes.push(
        'Armadura adicional máxima na sapata (2 φ12,5) insuficiente — aumente a altura/treliça, reduza o intereixo ou use vigotas justapostas.',
      )
    }
  }
  const asExtraEq = extra ? extra.n * area(extra.phi) * eqFactor(extra.phi) : 0
  const asProvided = asTruss + asExtraEq
  const asActual = asTruss + (extra ? extra.n * area(extra.phi) : 0)
  const bars =
    `2 φ${fmtPhi(l.phiBottom)} (treliça)` + (extra ? ` + ${extra.n} φ${fmtPhi(extra.phi)}` : '')
  const steelOk = extraOk && asProvided >= asReq - 1e-10
  if (extra && !extra.auto && !steelOk) {
    notes.push(
      `Armadura adicional informada insuficiente: As,ef = ${(asProvided * 1e4).toFixed(2)} cm² < As,nec = ${(asReq * 1e4).toFixed(2)} cm² (equivalente CA-60).`,
    )
  }
  if (!flex.flangeOnly) {
    notes.push('Linha neutra sai da capa — aumente a capa/altura (compressão na alma).')
  }
  const flexOk = flex.ok && flex.flangeOnly && steelOk

  // -------------------------------------------------- negativos e capa
  const mesh = WELDED_MESHES.find((m) => m.name === l.mesh) ?? WELDED_MESHES[0]
  // tab. 19.1: armadura de distribuição ≥ 20% da principal; NBR 14859-1: ≥ 0,6 cm²/m (CA-60)
  const meshMin = Math.max(0.6e-4, (0.2 * asActual) / spacing)
  const meshOk = mesh.as >= meshMin - 1e-12
  if (!meshOk) {
    notes.push(
      `Tela ${mesh.name} (${(mesh.as * 1e4).toFixed(2)} cm²/m) abaixo da armadura de distribuição mínima de ${(meshMin * 1e4).toFixed(2)} cm²/m.`,
    )
  }
  const meshEq50 = (mesh.as * fyd60) / inp.fyd // tela em área equivalente CA-50
  let asSupportPerM = 0
  let supportSpec = '—'
  let solidStrip = false
  let supportOk = true
  if (mdSupport > 0) {
    const dNeg = h - 0.02 // barras/tela na capa
    let flexSup = designBeamFlexure({
      md: mdSupport,
      bw,
      h,
      d: dNeg,
      fcd: inp.fcd,
      fyd: inp.fyd,
      fck: inp.fck,
    })
    if (!flexSup.ok) {
      // alma comprimida não passa: faixa maciça (compressão em toda a largura)
      solidStrip = true
      flexSup = designBeamFlexure({
        md: mdSupport,
        bw: spacing,
        h,
        d: dNeg,
        fcd: inp.fcd,
        fyd: inp.fyd,
        fck: inp.fck,
      })
      supportOk = flexSup.ok
      notes.push(
        'Momento negativo: a alma da nervura não resiste à compressão (x/d > 0,45) — prever FAIXA MACIÇA junto ao apoio contínuo (sem enchimento até o ponto de momento nulo) ou tratar a laje como biapoiada.',
      )
    }
    asSupportPerM = Math.max(flexSup.as / spacing, 0.67 * rhoMin(inp.fck / 1000) * h)
    const deficit = asSupportPerM - meshEq50
    supportSpec = deficit > 1e-9 ? `${mesh.name} + ${pickSlabBars(deficit, h)}` : mesh.name
  }
  // apoios simples com laje vizinha: negativa construtiva (tab. 19.1: 0,67·ρmin)
  const asNegConstructivePerM = 0.67 * rhoMin(inp.fck / 1000) * h
  const constrDeficit = asNegConstructivePerM - meshEq50
  const negConstructiveSpec =
    constrDeficit > 1e-9 ? `${mesh.name} + ${pickSlabBars(constrDeficit, h)}` : mesh.name

  // --------------------------------------------------------- cisalhamento
  const shares = latticeEndShares(inp.fixedStart, inp.fixedEnd)
  const vd = Math.max(...shares) * wd * L
  const rho1 = Math.min(asActual / (bw * d), 0.02)
  const vrd1 = slabShearVrd1(bw, d, inp.fctd, rho1) // §19.4.1
  let usesDiagonals = false
  let vrd3 = 0
  let shearOk = vd <= vrd1 + 1e-9
  if (!shearOk) {
    // §19.4.2 → §17.4.2 (modelo I) com as diagonais tracionadas da treliça:
    // 2 fios por passo; fywd ≤ 250 MPa (h ≤ 15 cm) … 435 MPa (h ≥ 35 cm)
    usesDiagonals = true
    const anchored = topChord >= h - hf - 1e-9 // banzo superior dentro da capa
    const alpha = Math.atan(l.trussHeight / (LATTICE_DIAGONAL_PITCH / 2))
    const aswS = (2 * area(l.phiDiag)) / LATTICE_DIAGONAL_PITCH
    const t = Math.min(Math.max((h - 0.15) / 0.2, 0), 1)
    const fywd = Math.min(250_000 + t * 185_000, fyd60)
    const vsw = aswS * 0.9 * d * fywd * (Math.sin(alpha) + Math.cos(alpha))
    const vc = 0.6 * inp.fctd * bw * d
    const vrd2 = 0.27 * (1 - inp.fck / 1000 / 250) * inp.fcd * bw * d
    vrd3 = anchored ? Math.min(vrd2, vc + vsw) : 0
    shearOk = anchored && vd <= vrd3 + 1e-9
    notes.push(
      shearOk
        ? `VSd = ${vd.toFixed(1)} kN > VRd1 = ${vrd1.toFixed(1)} kN — cortante resistido com as diagonais da treliça (VRd = ${vrd3.toFixed(1)} kN, §19.4.2).`
        : anchored
          ? `Cisalhamento: VSd = ${vd.toFixed(1)} kN > VRd = ${vrd3.toFixed(1)} kN mesmo com as diagonais — aumente a altura ou reduza o intereixo.`
          : `Cisalhamento: VSd = ${vd.toFixed(1)} kN > VRd1 = ${vrd1.toFixed(1)} kN e a treliça não alcança a capa (diagonais não ancoradas) — use treliça mais alta.`,
    )
  }

  // ------------------------------------------------------------------ ELS
  // seção T bruta por vigota (mesa I×hf + alma bw×he; abas da sapata desprezadas)
  const hw = h - hf
  const aF = spacing * hf
  const aW = bw * hw
  const yBar = (aF * (h - hf / 2) + aW * (hw / 2)) / (aF + aW) // da base
  const ic =
    (spacing * hf ** 3) / 12 +
    aF * (h - hf / 2 - yBar) ** 2 +
    (bw * hw ** 3) / 12 +
    aW * (hw / 2 - yBar) ** 2
  const alphaE = inp.es / inp.ecs
  const cr = crackedTSection(spacing, bw, hf, d, asActual, alphaE)

  // flecha (quase permanente) — Branson (§17.3.2.1.1), α = 1,2 (seção T)
  const wQp = (inp.g + inp.psi2 * inp.q) * spacing
  const maQp = L > 0 ? (wQp * L * L) / SPAN_M[fixedEnds] : 0
  const mr = (1.2 * inp.fctm * ic) / Math.max(yBar, 1e-6)
  let ieq = ic
  if (maQp > mr) {
    const r3 = (mr / maQp) ** 3
    ieq = Math.min(ic, r3 * ic + (1 - r3) * cr.i2)
    notes.push('Vigota fissura em serviço (Ma > Mr) — flecha com inércia equivalente de Branson.')
  }
  const deflectionImmediate =
    L > 0 ? (DEFLECTION_COEF[fixedEnds] * wQp * L ** 4) / (384 * inp.ecs * ieq) : 0
  const deflection = deflectionImmediate * (1 + ALPHA_F)
  const deflectionLimit = L / 250
  const deflectionOk = deflection <= deflectionLimit + 1e-12
  let counterCamber = 0
  if (!deflectionOk) {
    // tab. 13.3: contraflecha admite compensar, limitada a L/350
    const need = deflection - deflectionLimit
    if (need <= L / 350 + 1e-12) {
      counterCamber = Math.ceil(need * 200 - 1e-9) / 200 // múltiplos de 0,5 cm
      notes.push(
        `Flecha total ${(deflection * 100).toFixed(1)} cm > L/250 = ${(deflectionLimit * 100).toFixed(1)} cm — atende com CONTRAFLECHA de ${(counterCamber * 100).toFixed(1)} cm no escoramento (≤ L/350, tab. 13.3).`,
      )
    } else {
      notes.push(
        `Flecha total ${(deflection * 100).toFixed(1)} cm > L/250 = ${(deflectionLimit * 100).toFixed(1)} cm e a contraflecha máxima (L/350) não compensa — aumente a altura da laje.`,
      )
    }
  }

  // fissuração (combinação frequente) — §17.3.3.2, estádio II na seção T
  const wFreq = (inp.g + inp.psi1 * inp.q) * spacing
  const ms = L > 0 ? (wFreq * L * L) / SPAN_M[fixedEnds] : 0
  let wk = 0
  if (ms > 1e-9 && asActual > 1e-12) {
    const sigmaS = (alphaE * ms * (d - cr.x)) / cr.i2
    const hef = Math.min(2.5 * (h - d), (h - cr.x) / 3, h / 2)
    const rhoRi = asActual / Math.max(l.baseWidth * hef, 1e-9)
    const phi = Math.max(l.phiBottom, extra?.phi ?? 0)
    const base = (phi / (12.5 * ETA1_CA60)) * (sigmaS / inp.es)
    wk = Math.min(base * ((3 * sigmaS) / inp.fctm), base * (4 / rhoRi + 45))
  }
  const crackOk = wk <= inp.wkLimit + 1e-12
  if (!crackOk) {
    notes.push(
      `Fissuração: wk = ${(wk * 1000).toFixed(2)} mm > ${(inp.wkLimit * 1000).toFixed(1)} mm (combinação frequente) — aumente a armadura positiva.`,
    )
  }

  // ------------------------------------------------------------ integração
  const reactions = {
    g: [shares[0] * inp.g * L, shares[1] * inp.g * L] as [number, number],
    q: [shares[0] * inp.q * L, shares[1] * inp.q * L] as [number, number],
  }
  const steelKgPerM2 =
    (trussLinearMass(l) + (extra ? extra.n * area(extra.phi) * 7850 : 0)) / spacing +
    2 * mesh.as * 7850

  if (fixedEnds === 0) {
    notes.push(
      `Calculada como biapoiada — sobre apoios com laje vizinha prever negativa construtiva ${negConstructiveSpec} (≥ ${(asNegConstructivePerM * 1e4).toFixed(2)} cm²/m, tab. 19.1) p/ controle de fissuração.`,
    )
  }
  if (L > 4 + 1e-9) {
    notes.push(
      'Vão > 4 m: prever nervura(s) transversal(is) de travamento (prática corrente dos fabricantes) — obrigatória(s) se houver carga concentrada ou parede sobre a laje.',
    )
  }
  notes.push('Fase de montagem não verificada: escoramento e contraflecha conforme o fabricante da vigota.')

  return {
    designation: latticeDesignation(l, hf),
    truss: l.truss,
    h,
    hf,
    bw,
    spacing,
    d,
    concreteThickness: sec.concreteArea / spacing,
    checks,
    span: L,
    fixedEnds,
    ribsAlongA: inp.ribsAlongA,
    g0: inp.g0,
    g: inp.g,
    q: inp.q,
    mdSpan,
    mdSupport,
    xd: flex.xd,
    flangeOk: flex.flangeOnly,
    asReq,
    asMin,
    asTruss,
    extra,
    asProvided,
    bars,
    flexOk,
    asSupportPerM,
    supportSpec,
    solidStrip,
    asNegConstructivePerM,
    negConstructiveSpec,
    mesh: { name: mesh.name, as: mesh.as, asMin: meshMin, ok: meshOk },
    vd,
    vrd1,
    usesDiagonals,
    vrd3,
    shearOk,
    deflectionImmediate,
    deflection,
    deflectionLimit,
    deflectionOk,
    counterCamber,
    wk,
    wkLimit: inp.wkLimit,
    crackOk,
    reactions,
    steelKgPerM2,
    ok: flexOk && shearOk && supportOk && checks.every((c) => c.ok),
    notes,
  }
}
