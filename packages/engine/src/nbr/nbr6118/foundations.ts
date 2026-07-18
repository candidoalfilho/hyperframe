/**
 * Pré-dimensionamento de sapatas rígidas isoladas — NBR 6118 §22.6 + NBR 6122.
 * Método das bielas (CG) p/ armadura; tensão admissível do solo informada
 * pelo usuário (orientativa — projeto executivo exige sondagem SPT).
 */

export interface FootingInput {
  /** carga vertical de serviço (G+Q característica), kN */
  nServ: number
  /** momentos de serviço na base, kN·m (podem ser 0) */
  ma: number
  mb: number
  /** seção do pilar: ap = dimensão na direção a, bp na direção b, m */
  ap: number
  bp: number
  /** tensão admissível, kPa */
  sigmaAdm: number
  fyd: number // kPa
  /** dimensões FIXADAS pelo engenheiro (verificação em vez de dimensionamento) */
  fixed?: { a: number; b: number }
}

export interface FootingResult {
  /** dimensões em planta (a ≥ b), m — a alinhada com ap */
  a: number
  b: number
  h: number
  d: number
  /** tensão média e máxima (com excentricidade), kPa */
  sigma: number
  sigmaMax: number
  /** excentricidades e limites do núcleo central */
  ea: number
  eb: number
  insideKern: boolean
  /** armadura total por direção, m² */
  asA: number
  asB: number
  specA: string
  specB: string
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

const FOOTING_BARS = [0.01, 0.0125, 0.016, 0.02]

function pickFootingBars(asTotal: number, width: number): string {
  if (asTotal < 1e-9) return '—'
  for (const phi of FOOTING_BARS) {
    const aPhi = (Math.PI * phi * phi) / 4
    const n = Math.max(2, Math.ceil(asTotal / aPhi))
    const s = width / n
    if (s >= 0.1 && s <= 0.3) {
      const mm = Math.round(phi * 10000) / 10
      return `${n} φ ${mm % 1 === 0 ? mm.toFixed(0) : mm} c/ ${Math.floor(s * 100)}`
    }
  }
  const phi = FOOTING_BARS[FOOTING_BARS.length - 1]
  const aPhi = (Math.PI * phi * phi) / 4
  const n = Math.max(2, Math.ceil(asTotal / aPhi))
  return `${n} φ 20 c/ ${Math.max(8, Math.floor((width / n) * 100))}`
}

const round5up = (v: number) => Math.ceil(v / 0.05 - 1e-9) * 0.05

export function designFooting(inp: FootingInput): FootingResult {
  const notes: string[] = []
  // peso próprio da sapata ≈ 5%
  const nTotal = 1.05 * inp.nServ
  const aNec = nTotal / inp.sigmaAdm

  let a: number
  let b: number
  if (inp.fixed) {
    // geometria do engenheiro: só VERIFICA (σ, núcleo, bielas)
    a = Math.max(inp.fixed.a, inp.ap + 0.05)
    b = Math.max(inp.fixed.b, inp.bp + 0.05)
    notes.push('Dimensões fixadas manualmente — verificação, não dimensionamento.')
  } else {
    // balanços iguais: a − b = ap − bp (com a na direção de ap)
    const delta = inp.ap - inp.bp
    b = (-delta + Math.sqrt(delta * delta + 4 * aNec)) / 2
    a = aNec / b
    a = Math.max(round5up(a), 0.6, inp.ap + 0.1)
    b = Math.max(round5up(b), 0.6, inp.bp + 0.1)
  }

  // altura de sapata rígida: h ≥ (a − ap)/3
  const h = Math.max(round5up(Math.max((a - inp.ap) / 3, (b - inp.bp) / 3)), 0.3)
  const d = h - 0.05

  const area = a * b
  const sigma = nTotal / area
  const ea = inp.nServ > 1e-9 ? Math.abs(inp.ma) / inp.nServ : 0
  const eb = inp.nServ > 1e-9 ? Math.abs(inp.mb) / inp.nServ : 0
  const insideKern = ea <= a / 6 && eb <= b / 6
  const sigmaMax = insideKern
    ? sigma * (1 + (6 * ea) / a + (6 * eb) / b)
    : sigma * 2.5 // fora do núcleo: indicativo — exige verificação dedicada
  if (!insideKern) {
    notes.push('Excentricidade fora do núcleo central — verificar redistribuição/tração no solo.')
  }

  // método das bielas (CG): T = Nd·(a − ap)/(8·d)
  const nd = 1.4 * inp.nServ
  const ta = (nd * (a - inp.ap)) / (8 * d)
  const tb = (nd * (b - inp.bp)) / (8 * d)
  const asA = Math.max(ta / inp.fyd, 0.0008 * b * h) // malha mínima prática
  const asB = Math.max(tb / inp.fyd, 0.0008 * a * h)

  let status: FootingResult['status'] = 'ok'
  if (sigmaMax > 1.3 * inp.sigmaAdm || !insideKern) status = 'atencao'
  if (sigma > inp.sigmaAdm + 1e-9) status = 'falha'
  if (a > 4 || b > 4) {
    status = status === 'falha' ? 'falha' : 'atencao'
    notes.push('Sapata muito grande — avaliar estacas/tubulões.')
  }

  return {
    a,
    b,
    h,
    d,
    sigma,
    sigmaMax,
    ea,
    eb,
    insideKern,
    asA,
    asB,
    specA: pickFootingBars(asA, b),
    specB: pickFootingBars(asB, a),
    status,
    notes,
  }
}
