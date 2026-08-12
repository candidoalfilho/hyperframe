/**
 * NBR 15421:2023 — projeto de estruturas resistentes a sismos.
 * Zonas sísmicas (tab. 1), classes de terreno (§6.2), amplificação Ca/Cv
 * (tab. 3, interpolação linear entre 0,10g e 0,15g), espectro de resposta de
 * projeto Sa(T) (§5), coeficientes de sistema R/Ω0/Cd (tab. 6), método das
 * forças horizontais equivalentes (§9: Cs, H, distribuição vertical Cvx) e
 * deslocamentos (§9.5: δx = Cd·δxe/I, limites por categoria).
 *
 * Acelerações em FRAÇÃO de g (adimensionais); pesos em kN; alturas em m.
 */

export type SoilClass = 'A' | 'B' | 'C' | 'D' | 'E'
export type SeismicZone = 0 | 1 | 2 | 3 | 4
export type UtilizationCategory = 1 | 2 | 3

/** NBR 15421 tab. 1 — aceleração característica (fração de g) por zona
 *  (valor superior da faixa; zonas 1–3 admitem ag intermediário no mapa) */
export const ZONE_AG: Record<SeismicZone, number> = {
  0: 0.025,
  1: 0.05,
  2: 0.1,
  3: 0.15,
  4: 0.15,
}

/** NBR 15421 tab. 3 — fatores de amplificação sísmica no solo.
 *  Colunas: ag ≤ 0,10g e ag = 0,15g (interpolação linear entre elas). */
const AMPLIFICATION: Record<SoilClass, { ca10: number; ca15: number; cv10: number; cv15: number }> = {
  A: { ca10: 0.8, ca15: 0.8, cv10: 0.8, cv15: 0.8 },
  B: { ca10: 1.0, ca15: 1.0, cv10: 1.0, cv15: 1.0 },
  C: { ca10: 1.2, ca15: 1.2, cv10: 1.7, cv15: 1.7 },
  D: { ca10: 1.6, ca15: 1.5, cv10: 2.4, cv15: 2.2 },
  E: { ca10: 2.5, ca15: 2.1, cv10: 3.5, cv15: 3.4 },
}

export function seismicAmplification(ag: number, soil: SoilClass): { Ca: number; Cv: number } {
  const t = AMPLIFICATION[soil]
  if (ag <= 0.1) return { Ca: t.ca10, Cv: t.cv10 }
  const f = Math.min((ag - 0.1) / 0.05, 1)
  return { Ca: t.ca10 + f * (t.ca15 - t.ca10), Cv: t.cv10 + f * (t.cv15 - t.cv10) }
}

export interface DesignSpectrum {
  ag: number
  soil: SoilClass
  Ca: number
  Cv: number
  /** acelerações espectrais p/ T = 0 s e T = 1,0 s, fração de g */
  ags0: number
  ags1: number
  /** limites dos ramos do espectro, s */
  t0: number
  t1: number
  /** Sa(T) em fração de g */
  Sa: (T: number) => number
}

/** Espectro de resposta de projeto (§5.3): ramo linear até 0,08·Cv/Ca,
 *  platô 2,5·ags0 até 0,4·Cv/Ca e ramo descendente ags1/T. */
export function designSpectrum(ag: number, soil: SoilClass): DesignSpectrum {
  const { Ca, Cv } = seismicAmplification(ag, soil)
  const ags0 = Ca * ag
  const ags1 = Cv * ag
  const t0 = 0.08 * (Cv / Ca)
  const t1 = 0.4 * (Cv / Ca)
  const Sa = (T: number): number => {
    if (T <= 0) return ags0
    if (T < t0) return ags0 * (18.75 * T * (Ca / Cv) + 1.0)
    if (T <= t1) return 2.5 * ags0
    return ags1 / T
  }
  return { ag, soil, Ca, Cv, ags0, ags1, t0, t1, Sa }
}

/** NBR 15421 §7 — fator de importância por categoria de utilização */
export const IMPORTANCE: Record<UtilizationCategory, number> = { 1: 1.0, 2: 1.25, 3: 1.5 }

/** Limite de deslocamento relativo de pavimento (Δx/hsx) por categoria */
export const DRIFT_LIMIT: Record<UtilizationCategory, number> = { 1: 0.02, 2: 0.015, 3: 0.01 }

export type SeismicSystemId =
  | 'portico-concreto-usual'
  | 'portico-concreto-intermediario'
  | 'pilar-parede-usual'
  | 'dual-usual'
  | 'dual-intermediario'
  | 'pendulo-invertido'

/** NBR 15421 tab. 6 — coeficientes de projeto dos sistemas sismorresistentes
 *  de concreto (R, Ω0, Cd) + período aproximado Ta = CT·hn^x (§9.2) */
export const SEISMIC_SYSTEMS: Record<
  SeismicSystemId,
  { label: string; R: number; omega0: number; Cd: number; CT: number; x: number }
> = {
  'portico-concreto-usual': {
    label: 'Pórticos de concreto — detalhamento usual',
    R: 3.0, omega0: 3.0, Cd: 2.5, CT: 0.0466, x: 0.9,
  },
  'portico-concreto-intermediario': {
    label: 'Pórticos de concreto — detalhamento intermediário',
    R: 5.0, omega0: 3.0, Cd: 4.5, CT: 0.0466, x: 0.9,
  },
  'pilar-parede-usual': {
    label: 'Pilares-parede de concreto — detalhamento usual',
    R: 4.0, omega0: 2.5, Cd: 4.0, CT: 0.0488, x: 0.75,
  },
  'dual-usual': {
    label: 'Dual: pórticos + pilares-parede (usual)',
    R: 4.5, omega0: 2.5, Cd: 4.0, CT: 0.0488, x: 0.75,
  },
  'dual-intermediario': {
    label: 'Dual: pórticos intermediários + pilares-parede',
    R: 5.5, omega0: 2.5, Cd: 4.5, CT: 0.0488, x: 0.75,
  },
  'pendulo-invertido': {
    label: 'Pêndulo invertido / colunas em balanço',
    R: 2.5, omega0: 2.0, Cd: 2.5, CT: 0.0488, x: 0.75,
  },
}

/** §9.2 — período natural aproximado Ta = CT·hn^x (hn em m) */
export function approxPeriod(hn: number, system: SeismicSystemId): number {
  const s = SEISMIC_SYSTEMS[system]
  return s.CT * Math.pow(Math.max(hn, 0), s.x)
}

/** §9.2 tab. — coeficiente de limitação do período obtido por extração modal:
 *  T ≤ Cup·Ta (zona 2: 1,7; zona 3: 1,6; zona 4: 1,5; zonas 0–1: 1,7) */
export const CUP: Record<SeismicZone, number> = { 0: 1.7, 1: 1.7, 2: 1.7, 3: 1.6, 4: 1.5 }

/** §9.1 — coeficiente de resposta sísmica Cs:
 *  Cs = 2,5·(ags0)/(R/I), limitado a (ags1)/(T·(R/I)) e no mínimo 0,01. */
export function seismicResponseCoefficient(
  spectrum: Pick<DesignSpectrum, 'ags0' | 'ags1'>,
  T: number,
  R: number,
  I: number,
): { cs: number; governedBy: 'plato' | 'periodo' | 'minimo' } {
  const base = (2.5 * spectrum.ags0) / (R / I)
  const upper = T > 0 ? spectrum.ags1 / (T * (R / I)) : Infinity
  let cs = Math.min(base, upper)
  let governedBy: 'plato' | 'periodo' | 'minimo' = upper < base ? 'periodo' : 'plato'
  if (cs < 0.01) {
    cs = 0.01
    governedBy = 'minimo'
  }
  return { cs, governedBy }
}

/** §9.3 — expoente k de distribuição vertical em função do período */
export function distributionExponent(T: number): number {
  if (T <= 0.5) return 1
  if (T >= 2.5) return 2
  return (T + 1.5) / 2
}

/** §9.3 — distribuição vertical das forças sísmicas: Fx = Cvx·H com
 *  Cvx = wx·hx^k / Σ wi·hi^k. Pesos em kN, alturas em m (acima da base). */
export function verticalDistribution(
  weights: number[],
  heights: number[],
  H: number,
  T: number,
): { k: number; forces: number[] } {
  const k = distributionExponent(T)
  const num = weights.map((w, i) => w * Math.pow(Math.max(heights[i], 0), k))
  const sum = num.reduce((a, b) => a + b, 0)
  if (sum <= 0) return { k, forces: weights.map(() => 0) }
  return { k, forces: num.map((n) => (H * n) / sum) }
}

/** §9.5 — deslocamento absoluto amplificado: δx = Cd·δxe/I */
export function amplifiedDisplacement(deltaXe: number, Cd: number, I: number): number {
  return (Cd * deltaXe) / I
}

/** §9.6 — coeficiente de estabilidade sísmico θ = P·Δ/(Hx·hsx·Cd);
 *  2ª ordem dispensável se θ ≤ 0,10; limite θmax = 0,5/Cd ≤ 0,25 */
export function stabilityCoefficient(
  pCum: number,
  drift: number,
  storyShear: number,
  storyHeight: number,
  Cd: number,
): { theta: number; thetaMax: number } {
  const theta =
    storyShear > 0 && storyHeight > 0 ? (pCum * drift) / (storyShear * storyHeight * Cd) : 0
  return { theta, thetaMax: Math.min(0.5 / Cd, 0.25) }
}
