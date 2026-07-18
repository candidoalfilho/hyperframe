import { designBeamFlexure, designBeamShear, pickBars } from '../nbr6118/beamDesign'

/**
 * Viga alavanca (viga de equilíbrio) p/ sapata de divisa — modelo clássico
 * (Alonso, "Projeto e Execução de Fundações"; NBR 6122 §6.4 remete o
 * equilíbrio de excentricidades ao projeto estrutural):
 *
 *   ordem na linha: divisa | eixo P1 | CG da sapata | … | eixo P2
 *   e = distância eixo P1 → CG da sapata; L = distância entre eixos P1–P2
 *
 *   R1 (sapata de divisa, CENTRADA) = N1·L/(L − e)
 *   alívio no pilar interno        ΔP = N1·e/(L − e)
 *   momento máximo (no CG)         M  = N1·e   (tração SUPERIOR)
 *   cortante no vão CG→P2          V  = ΔP
 *
 * O trecho embutido na sapata absorve o cortante N1 pela altura da própria
 * sapata rígida. Dimensionamento a flexão/cisalhamento via NBR 6118 §17.
 */

export interface StrapBeamInput {
  /** carga de serviço do pilar de divisa (G+Q), kN */
  n1Serv: number
  /** excentricidade eixo do pilar → CG da sapata, m (projeção na direção P1→P2) */
  e: number
  /** distância entre eixos dos pilares P1–P2, m */
  L: number
  /** largura da viga, m (≥ largura do pilar de divisa) */
  bw: number
  fck: number // kPa
  fcd: number // kPa
  fctd: number // kPa
  fctm: number // kPa
  fyd: number // kPa
  fywk: number // kPa
}

export interface StrapBeamResult {
  /** reação amplificada na sapata de divisa (serviço), kN */
  r1: number
  /** alívio no pilar interno (serviço), kN */
  relief: number
  /** momento característico máximo = N1·e, kN·m */
  mChar: number
  mSd: number
  vSd: number
  bw: number
  h: number
  d: number
  /** armadura superior (tração), m² */
  asTop: number
  topSpec: string
  stirrupSpec: string
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

const D_PRIME = 0.06 // eixo da armadura à face (cobrimento 4 cm + estribo + φ/2)
const round5up = (v: number) => Math.ceil(v / 0.05 - 1e-9) * 0.05

/** estribo de 2 ramos: menor φ que atende asw/s com passo em múltiplos de 2,5 cm */
function pickStirrups(aswS: number, sMax: number): string {
  for (const phi of [0.0063, 0.008, 0.01]) {
    const twoLegs = 2 * ((Math.PI * phi * phi) / 4)
    let s = Math.min(sMax, twoLegs / Math.max(aswS, 1e-9))
    s = Math.floor(s / 0.025) * 0.025
    if (s >= 0.08) {
      const mm = Math.round(phi * 10000) / 10
      return `φ ${mm % 1 === 0 ? mm.toFixed(0) : String(mm).replace('.', ',')} c/ ${Math.round(s * 100)}`
    }
  }
  return 'φ 10 c/ 8'
}

export function designStrapBeam(inp: StrapBeamInput): StrapBeamResult {
  const notes: string[] = []
  const span = inp.L - inp.e
  const r1 = (inp.n1Serv * inp.L) / span
  const relief = (inp.n1Serv * inp.e) / span
  const mChar = inp.n1Serv * inp.e
  const mSd = 1.4 * mChar
  const vSd = 1.4 * relief

  // altura: prática L/8 (≥ 50 cm); sobe em passos de 5 cm se a flexão não couber
  let h = Math.max(0.5, round5up(inp.L / 8))
  let flex = designBeamFlexure({
    md: mSd,
    bw: inp.bw,
    h,
    d: h - D_PRIME,
    fcd: inp.fcd,
    fyd: inp.fyd,
    fck: inp.fck,
  })
  while (!flex.ok && h < 2.0) {
    h = round5up(h + 0.05)
    flex = designBeamFlexure({
      md: mSd,
      bw: inp.bw,
      h,
      d: h - D_PRIME,
      fcd: inp.fcd,
      fyd: inp.fyd,
      fck: inp.fck,
    })
  }
  const d = h - D_PRIME
  const asTop = Math.max(flex.as, flex.asMin)
  const top = pickBars(asTop, inp.bw, 0.04)

  const shear = designBeamShear({
    vd: vSd,
    bw: inp.bw,
    d,
    fck: inp.fck,
    fcd: inp.fcd,
    fctd: inp.fctd,
    fctm: inp.fctm,
    fywk: inp.fywk,
    fywd: inp.fywk / 1.15,
  })
  const stirrupSpec = pickStirrups(Math.max(shear.aswS, shear.aswSMin), shear.sMax)

  let status: StrapBeamResult['status'] = 'ok'
  if (!flex.ok || !shear.ok) {
    status = 'falha'
    notes.push('Seção da viga alavanca insuficiente — aumente bw/h ou reduza a excentricidade.')
  }
  if (inp.e / inp.L > 0.25) {
    if (status === 'ok') status = 'atencao'
    notes.push('Excentricidade alta (e > L/4) — amplificação de R1 relevante; revisar geometria.')
  }
  if (h >= 0.6) {
    notes.push('h ≥ 60 cm — prever armadura de pele (§17.3.5.2.3).')
  }
  notes.push(
    'Armadura principal SUPERIOR (tração em cima); manter contínua da sapata ao pilar interno com ancoragem total.',
  )
  notes.push('Trecho embutido na sapata: cortante absorvido pela altura da sapata rígida.')

  return {
    r1,
    relief,
    mChar,
    mSd,
    vSd,
    bw: inp.bw,
    h,
    d,
    asTop,
    topSpec: top.spec,
    stirrupSpec,
    status,
    notes,
  }
}
