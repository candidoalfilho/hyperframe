/**
 * Blocos rígidos sobre estacas — método das bielas (Blévot & Frémy), conforme
 * NBR 6118 §22.7 (blocos) e prática consagrada (Machado/EPUSP; Bastos/UNESP).
 *
 * Fórmulas (N = carga do pilar; e = espaçamento entre eixos de estacas;
 * ap = pilar quadrado equivalente √(ap·bp); d = altura útil):
 *
 *  2 estacas: tgα = d/(e/2 − ap/4)         Rs = N(2e − ap)/(8d)   [×1,15 exp.]
 *  3 estacas: tgα = d/(e√3/3 − 0,3ap)      Rs,med = N(e√3 − 0,9ap)/(9d)
 *             armadura sobre estacas (lados): R's = Rs,med/√3
 *  4 estacas: tgα = d/(√2/2·(e − ap/2))    Rs,diag = N√2(2e − ap)/(16d)
 *             armadura sobre estacas (lados): R's = N(2e − ap)/(16d)
 *  5 estacas (4 + centro): como 4 estacas com N′ = 4N/5.
 *
 *  Bielas (esmagamento): σ,pil = Nd/(Ap·sen²α) · σ,est = Nd/(n·Ae·sen²α)
 *  Limites (Blévot): 1,4·KR·fcd (2 est.) · 1,75·KR·fcd (3) · 2,1·KR·fcd (4/5),
 *  KR = 0,9 (efeito Rüsch). Ângulo recomendado: 45° ≤ α ≤ 55°.
 */

export interface PileCapInput {
  /** carga vertical de serviço do pilar (G+Q), kN */
  nServ: number
  /** dimensões do pilar, m */
  ap: number
  bp: number
  /** carga admissível por estaca, kN */
  pileCapacity: number
  /** diâmetro da estaca, m */
  pileDiameter: number
  /** espaçamento entre eixos = fator × diâmetro (2,5–3) */
  spacingFactor: number
  /** nº de estacas FIXADO pelo engenheiro (verificação em vez de dimensionamento) */
  nPilesFixed?: number
  fcd: number // kPa
  fyd: number // kPa
}

export interface PileCapResult {
  nPiles: number
  /** diâmetro da estaca adotada, m (p/ desenho) */
  pileDiameter: number
  /** carga de serviço por estaca (com peso próprio do bloco), kN */
  pileLoad: number
  pileCapacity: number
  /** espaçamento entre eixos, m */
  e: number
  d: number
  h: number
  alphaDeg: number
  /** dimensões do bloco em planta, m */
  planA: number
  planB: number
  /** armadura principal (tirante) por direção/lado, m² */
  asMain: number
  mainSpec: string
  /** tensões nas bielas, kPa */
  sigmaPil: number
  sigmaEst: number
  sigmaLim: number
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

const KR = 0.9
const D_PRIME = 0.06 // eixo da armadura à face inferior (5 cm + φ/2)

const REBARS = [0.01, 0.0125, 0.016, 0.02, 0.025]

function pickTieBars(as: number): string {
  if (as < 1e-9) return 'malha mínima'
  for (const phi of REBARS) {
    const aPhi = (Math.PI * phi * phi) / 4
    const n = Math.max(2, Math.ceil(as / aPhi))
    if (n <= 8) {
      const mm = Math.round(phi * 10000) / 10
      return `${n} φ ${mm % 1 === 0 ? mm.toFixed(0) : mm}`
    }
  }
  const phi = REBARS[REBARS.length - 1]
  const n = Math.ceil(as / ((Math.PI * phi * phi) / 4))
  return `${n} φ 25`
}

const round5up = (v: number) => Math.ceil(v / 0.05 - 1e-9) * 0.05

export function designPileCap(inp: PileCapInput): PileCapResult {
  const notes: string[] = []
  const phi = inp.pileDiameter
  const apEq = Math.sqrt(inp.ap * inp.bp)
  const spacing = Math.max(inp.spacingFactor, 2.5) * phi

  // nº de estacas (com ~5% de peso próprio do bloco), limitado a 5 no método
  let n = inp.nPilesFixed ?? Math.max(1, Math.ceil((1.05 * inp.nServ) / inp.pileCapacity))
  if (inp.nPilesFixed) {
    notes.push('Nº de estacas fixado manualmente — verificação, não dimensionamento.')
  }
  if (n > 5) {
    notes.push(
      `Carga exige ${n} estacas — bloco acima de 5 estacas fora do escopo (dimensionar bloco especial ou aumentar a capacidade da estaca).`,
    )
    n = 5
  }
  const pileLoad = (1.05 * inp.nServ) / n
  const nd = 1.4 * inp.nServ

  // altura útil no meio da faixa recomendada (α ≈ 50°)
  const lever = spacing - apEq / 2 // (e − ap/2)
  let dTarget: number
  if (n <= 1) dTarget = Math.max(0.6 * phi, 0.4)
  else if (n === 2) dTarget = 0.6 * lever
  else if (n === 3) dTarget = 0.7 * lever
  else dTarget = 0.85 * lever
  const h = Math.max(round5up(dTarget + D_PRIME), 0.4)
  const d = h - D_PRIME

  // ângulo da biela
  let tanAlpha: number
  if (n === 2) tanAlpha = d / (spacing / 2 - apEq / 4)
  else if (n === 3) tanAlpha = d / ((spacing * Math.sqrt(3)) / 3 - 0.3 * apEq)
  else tanAlpha = d / ((Math.sqrt(2) / 2) * (spacing - apEq / 2))
  const alpha = Math.atan(Math.max(tanAlpha, 0.1))
  const alphaDeg = (alpha * 180) / Math.PI
  const sin2 = Math.sin(alpha) ** 2

  // tirantes
  let asMain = 0
  if (n === 2) {
    asMain = (1.15 * nd * (2 * spacing - apEq)) / (8 * d * inp.fyd)
  } else if (n === 3) {
    const rsMed = (nd * (spacing * Math.sqrt(3) - 0.9 * apEq)) / (9 * d)
    asMain = rsMed / Math.sqrt(3) / inp.fyd // por lado, sobre as estacas
  } else if (n >= 4) {
    const nEff = n === 5 ? 0.8 * nd : nd
    asMain = (nEff * (2 * spacing - apEq)) / (16 * d * inp.fyd) // por lado
  }

  // bielas
  const ap2 = inp.ap * inp.bp
  const ae = (Math.PI * phi * phi) / 4
  const sigmaPil = n <= 1 ? nd / ap2 : nd / (ap2 * sin2)
  const sigmaEst = n <= 1 ? nd / ae : nd / (n * ae * sin2)
  const limFactor = n <= 2 ? 1.4 : n === 3 ? 1.75 : 2.1
  const sigmaLim = limFactor * KR * inp.fcd

  // dimensões em planta (folga de 15 cm da face da estaca à borda)
  const edge = phi + 0.3
  let planA: number
  let planB: number
  if (n <= 1) {
    planA = planB = Math.max(edge, inp.ap + 0.2, inp.bp + 0.2)
  } else if (n === 2) {
    planA = spacing + edge
    planB = edge
  } else if (n === 3) {
    planA = spacing + edge
    planB = (spacing * Math.sqrt(3)) / 2 + edge
  } else {
    planA = planB = spacing + edge
  }

  // status
  let status: PileCapResult['status'] = 'ok'
  if (pileLoad > inp.pileCapacity + 1e-6) status = 'falha'
  if (n > 1 && (alphaDeg < 45 - 3 || alphaDeg > 55 + 3)) {
    status = status === 'falha' ? 'falha' : 'atencao'
    notes.push(`Ângulo da biela α = ${alphaDeg.toFixed(0)}° fora de 45–55° — revisar altura.`)
  }
  if (sigmaPil > sigmaLim || sigmaEst > sigmaLim) {
    status = 'falha'
    notes.push('Esmagamento de biela — aumentar seção do pilar/estacas ou fck.')
  }
  if (n === 3) notes.push('Prever armadura de suspensão e malha ortogonal (NBR 6118 §22.7.4).')
  if (n >= 2) notes.push('Verificar ancoragem dos tirantes sobre as estacas (ganchos/laços).')
  notes.push('Capacidade da estaca é geotécnica ORIENTATIVA — exige laudo e prova de carga (NBR 6122).')

  return {
    nPiles: n,
    pileDiameter: phi,
    pileLoad,
    pileCapacity: inp.pileCapacity,
    e: spacing,
    d,
    h,
    alphaDeg,
    planA,
    planB,
    asMain,
    mainSpec: n <= 1 ? 'malha mínima' : pickTieBars(asMain),
    sigmaPil,
    sigmaEst,
    sigmaLim,
    status,
    notes,
  }
}
