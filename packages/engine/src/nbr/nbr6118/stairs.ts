/**
 * Dimensionamento de escadas de concreto armado — lance como laje maciça
 * armada em uma direção (NBR 6118 §17.2 p/ flexão; NBR 6120 p/ cargas).
 *
 * Modelo: lance biapoiado no vão horizontal L (a favor da segurança p/ o
 * momento; apoios reais = vigas/patamares). Cargas por m² de PROJEÇÃO
 * horizontal:
 *   peso da laje inclinada  g1 = γc·t/cos θ    (θ = atan(espelho/piso))
 *   peso dos degraus        g2 = γc·e/2        (triângulos de concreto)
 *   revestimento            g3 (informado)
 *   sobrecarga NBR 6120     q  (2,5 residencial · 3,0 uso coletivo)
 */

import { designBeamFlexure } from './beamDesign'
import { pickSlabBars } from './slabDesign'

export interface StairDesignInput {
  /** vão horizontal do lance entre apoios, m */
  span: number
  /** espessura da laje do lance, m */
  waist: number
  /** espelho, m */
  riser: number
  /** piso (passo), m */
  tread: number
  /** revestimento, kN/m² */
  finish: number
  /** sobrecarga de utilização, kN/m² (NBR 6120) */
  q: number
  /** peso específico do concreto, kN/m³ */
  unitWeight: number
  cover: number // m
  fck: number // kPa
  fcd: number
  fyd: number
  fctm: number
  ecs: number
  /** ψ2 p/ flecha quase-permanente */
  psi2: number
}

export interface StairDesignOutput {
  span: number
  /** inclinação do lance, graus */
  thetaDeg: number
  /** nº de degraus no lance (aprox. pelo vão) */
  steps: number
  /** carga permanente total, kN/m² (projeção horizontal) */
  g: number
  q: number
  /** momento de cálculo no vão, kN·m/m */
  md: number
  /** cortante de cálculo no apoio, kN/m */
  vd: number
  /** armadura longitudinal (direção do lance), m²/m */
  as: number
  asMin: number
  spec: string
  /** armadura de distribuição (transversal), m²/m */
  asDist: number
  distSpec: string
  /** flecha total estimada (Branson + fluência), m */
  deflection: number
  deflectionLimit: number
  /** verificação da blondel (60 ≤ p + 2e ≤ 65 cm) */
  blondel: number
  blondelOk: boolean
  ok: boolean
  notes: string[]
}

export function designStair(inp: StairDesignInput): StairDesignOutput {
  const notes: string[] = []
  const theta = Math.atan2(inp.riser, inp.tread)
  const thetaDeg = (theta * 180) / Math.PI
  const steps = Math.max(1, Math.round(inp.span / inp.tread))

  // cargas (por m² de projeção horizontal)
  const gSlab = (inp.unitWeight * inp.waist) / Math.cos(theta)
  const gSteps = (inp.unitWeight * inp.riser) / 2
  const g = gSlab + gSteps + inp.finish
  const q = inp.q

  // esforços de lance biapoiado
  const wd = 1.4 * (g + q)
  const md = (wd * inp.span ** 2) / 8
  const vd = (wd * inp.span) / 2

  // flexão como laje (faixa de 1 m)
  const d = Math.max(inp.waist - inp.cover - 0.005, 0.5 * inp.waist)
  const flex = designBeamFlexure({
    md,
    bw: 1,
    h: inp.waist,
    d,
    fcd: inp.fcd,
    fyd: inp.fyd,
    fck: inp.fck,
  })
  const asMin = 0.0015 * inp.waist // ρmin C20–C30 aplicada à laje do lance
  const as = Math.max(flex.as, asMin)
  // distribuição (tab. 19.1): ≥ 20% da principal, ≥ 0,9 cm²/m, ≥ 0,5·ρmin
  const asDist = Math.max(0.2 * as, 0.9e-4, 0.5 * 0.0015 * inp.waist)

  // flecha (biapoiada, carga quase-permanente, Branson aproximado + fluência)
  const wQp = g + inp.psi2 * q
  const iC = inp.waist ** 3 / 12
  const deltaElastic = (5 * wQp * inp.span ** 4) / (384 * inp.ecs * iC)
  const maQp = (wQp * inp.span ** 2) / 8
  const mr = 0.25 * inp.fctm * inp.waist * inp.waist // 1,5·fctm·W0, b=1
  let ieqRatio = 1
  if (maQp > mr) {
    const iii = 0.3 * iC
    const r3 = (mr / maQp) ** 3
    ieqRatio = iC / Math.min(iC, r3 * iC + (1 - r3) * iii)
  }
  const deflection = deltaElastic * ieqRatio * (1 + 1.32)
  const deflectionLimit = inp.span / 250

  // conforto (fórmula de Blondel), em cm
  const blondel = (inp.tread + 2 * inp.riser) * 100
  const blondelOk = blondel >= 60 && blondel <= 65
  if (!blondelOk) {
    notes.push(
      `Blondel p+2e = ${blondel.toFixed(0)} cm fora de 60–65 cm — rever espelho/piso.`,
    )
  }
  if (!flex.ok) notes.push(flex.note ?? 'Seção insuficiente à flexão.')
  if (deflection > deflectionLimit) notes.push('Flecha acima de L/250 — aumentar espessura.')
  if (inp.waist < 0.08) notes.push('Espessura do lance < 8 cm (mínimo usual p/ escadas).')

  return {
    span: inp.span,
    thetaDeg,
    steps,
    g,
    q,
    md,
    vd,
    as,
    asMin,
    spec: pickSlabBars(as, inp.waist),
    asDist,
    distSpec: pickSlabBars(asDist, inp.waist),
    deflection,
    deflectionLimit,
    blondel,
    blondelOk,
    ok: flex.ok && deflection <= deflectionLimit && inp.waist >= 0.08,
    notes,
  }
}

export interface StairLandingInput extends Omit<StairDesignInput, 'span'> {
  /** projeção horizontal do lance, m */
  flightSpan: number
  /** profundidade do patamar, m */
  landingSpan: number
  kind: 'L' | 'U'
}

/**
 * Lance + PATAMAR contínuos (escadas L/U, §14 + prática Bastos/Araújo):
 * viga biapoiada de vão L = lance + patamar SEM apoio próprio no patamar
 * (esquema conservador usual); cargas por trecho (lance inclinado ×1/cosθ +
 * meia altura de degraus; patamar plano). Mmax exato onde V = 0.
 * ARMADURA DA DOBRA: barras devem CRUZAR o canto lance-patamar ancoradas
 * (nunca dobrar acompanhando o canto reentrante — empuxo ao vazio).
 */
export function designStairLanding(inp: StairLandingInput): StairDesignOutput {
  const lf = Math.max(inp.flightSpan, 0.3)
  const lp = Math.max(inp.landingSpan, 0.3)
  const L = lf + lp
  const theta = Math.atan2(inp.riser, inp.tread)
  const cosT = Math.cos(theta)
  const g1 = (inp.waist / cosT) * inp.unitWeight + (inp.riser / 2) * inp.unitWeight + inp.finish
  const g2 = inp.waist * inp.unitWeight + inp.finish
  const w1 = 1.4 * (g1 + inp.q)
  const w2 = 1.4 * (g2 + inp.q)

  // reações (lance em [0, lf], patamar em [lf, L]); momentos sobre B:
  const ra = (w1 * lf * (L - lf / 2) + w2 * lp * (lp / 2)) / L
  const rb = w1 * lf + w2 * lp - ra
  const x0 = ra / w1 <= lf ? ra / w1 : lf + (ra - w1 * lf) / w2
  const md =
    x0 <= lf
      ? ra * x0 - (w1 * x0 * x0) / 2
      : ra * x0 - w1 * lf * (x0 - lf / 2) - (w2 * (x0 - lf) ** 2) / 2
  const vd = Math.max(ra, rb)

  const d = Math.max(inp.waist - inp.cover - 0.005, 0.5 * inp.waist)
  const flex = designBeamFlexure({
    md,
    bw: 1,
    h: inp.waist,
    d,
    fcd: inp.fcd,
    fyd: inp.fyd,
    fck: inp.fck,
  })
  const asMin = 0.0015 * inp.waist
  const as = Math.max(flex.as, asMin)
  const asDist = Math.max(0.2 * as, 0.9e-4, 0.5 * 0.0015 * inp.waist)
  const steps = Math.max(3, Math.round(lf / inp.tread))
  // flecha QP (Branson aproximado como no lance reto), carga média no vão
  const wQpAvg = ((g1 * lf + g2 * lp) / L) + inp.psi2 * inp.q
  const iC = inp.waist ** 3 / 12
  const deltaElastic = (5 * wQpAvg * L ** 4) / (384 * inp.ecs * iC)
  const maQp = (wQpAvg * L * L) / 8
  const mr = 0.25 * inp.fctm * inp.waist * inp.waist
  let ieqRatio = 1
  if (maQp > mr) {
    const iii = 0.3 * iC
    const r3 = (mr / maQp) ** 3
    ieqRatio = iC / Math.min(iC, r3 * iC + (1 - r3) * iii)
  }
  const deflection = deltaElastic * ieqRatio * (1 + 1.32)
  const blondel = (inp.tread + 2 * inp.riser) * 100
  const notes = [
    `Escada em ${inp.kind} — lance ${lf.toFixed(2).replace('.', ',')} m + patamar ${lp
      .toFixed(2)
      .replace('.', ',')} m contínuos (patamar sem apoio próprio, esquema conservador).`,
    `Mmax = ${md.toFixed(1)} kN·m/m em x = ${x0.toFixed(2).replace('.', ',')} m ${x0 <= lf ? '(no lance)' : '(no patamar)'}.`,
    'DOBRA lance↔patamar: barras CRUZANDO o canto, ancoradas — nunca dobrar acompanhando o canto reentrante (empuxo ao vazio).',
    inp.kind === 'U'
      ? 'Dimensionamento POR LANCE (os dois lances são iguais e simétricos).'
      : 'Dimensionar os dois lances (o maior governa) — patamar de canto compartilhado.',
  ]
  return {
    span: L,
    thetaDeg: (theta * 180) / Math.PI,
    steps,
    g: g1,
    q: inp.q,
    md,
    vd,
    as,
    asMin,
    spec: pickSlabBars(as, inp.waist),
    asDist,
    distSpec: pickSlabBars(asDist, inp.waist),
    deflection,
    deflectionLimit: L / 250,
    blondel,
    blondelOk: blondel >= 60 && blondel <= 65,
    ok: flex.ok,
    notes,
  }
}
