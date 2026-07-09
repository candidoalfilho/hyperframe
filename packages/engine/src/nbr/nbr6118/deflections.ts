/**
 * Flechas de vigas — NBR 6118 §17.3.2: inércia equivalente de Branson,
 * flecha diferida por fluência (§17.3.2.1.2).
 */

/** momento de fissuração: Mr = α·fct·Ic/yt (α=1,5 p/ seção T? retangular=1,5) */
export function crackingMoment(bw: number, h: number, fctm: number): number {
  // α = 1,5 (retangular), W0 = bw·h²/6 → Mr = 1,5·fctm·bw·h²/6
  return 0.25 * fctm * bw * h * h
}

/** inércia da seção fissurada (estádio II puro), armadura simples */
export function crackedInertia(bw: number, d: number, as: number, alphaE: number): number {
  if (as < 1e-12) return (bw * d ** 3) / 12
  const k = alphaE * as
  // (bw/2)·x² + k·x − k·d = 0
  const x = (-k + Math.sqrt(k * k + 2 * bw * k * d)) / bw
  return (bw * x ** 3) / 3 + k * (d - x) ** 2
}

/** inércia equivalente de Branson */
export function bransonInertia(mr: number, ma: number, ic: number, iii: number): number {
  if (ma <= mr || ma < 1e-9) return ic
  const r3 = (mr / ma) ** 3
  return Math.min(ic, r3 * ic + (1 - r3) * iii)
}

/**
 * Fator de flecha diferida αf = Δξ/(1+50ρ′) — carga aplicada ~1 mês (ξ=0,68),
 * tempo infinito (ξ=2). Sem armadura de compressão: αf = 1,32.
 */
export function creepFactor(rhoCompression = 0): number {
  const deltaXi = 2 - 0.68
  return deltaXi / (1 + 50 * rhoCompression)
}
