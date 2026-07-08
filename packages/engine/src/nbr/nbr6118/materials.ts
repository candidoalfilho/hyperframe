/**
 * NBR 6118:2023 §8.2 — propriedades mecânicas do concreto e do aço.
 * Unidades internas: kPa (1 MPa = 1000 kPa). Válido p/ grupo I (fck ≤ 50 MPa).
 */

import type { Aggregate, CAA, SteelMaterial } from '../../model/types'
import type { ConcreteProps } from '../api'
import { COVER_BY_CAA } from '../../model/presets'

/** NBR 6118 §8.2.8 — αE conforme a natureza do agregado graúdo */
const ALPHA_E: Record<Aggregate, number> = {
  basalto: 1.2, // basalto e diabásio
  granito: 1.0, // granito e gnaisse
  calcario: 0.9,
  arenito: 0.7,
}

/**
 * Propriedades do concreto (NBR 6118 §8.2). `fck` em kPa.
 * As fórmulas da norma usam MPa — conversão interna kPa ↔ MPa.
 */
export function concreteProps(fck: number, aggregate: Aggregate, gammaC: number): ConcreteProps {
  const fckMPa = fck / 1000
  // NBR 6118 §12.3.3 — resistência de cálculo à compressão
  const fcd = fck / gammaC
  // NBR 6118 §8.2.5 — fct,m = 0,3·fck^(2/3) [MPa] (fck ≤ 50 MPa)
  const fctm = 0.3 * Math.pow(fckMPa, 2 / 3) * 1000
  // fctk,inf = 0,7·fct,m
  const fctkInf = 0.7 * fctm
  // fctd = fctk,inf/γc
  const fctd = fctkInf / gammaC
  // NBR 6118 §8.2.8 — Eci = αE·5600·√fck [MPa]
  const eci = ALPHA_E[aggregate] * 5600 * Math.sqrt(fckMPa) * 1000
  // αi = 0,8 + 0,2·fck/80 ≤ 1,0
  const alphaI = Math.min(0.8 + (0.2 * fckMPa) / 80, 1.0)
  // Ecs = αi·Eci (módulo secante)
  const ecs = alphaI * eci
  // §8.2.9 — módulo transversal Gc = Ecs/2,4 (ν = 0,2)
  const gc = ecs / 2.4
  return { fck, fcd, fctm, fctkInf, fctd, eci, ecs, gc }
}

/** NBR 6118 §8.3.3 — resistência de cálculo do aço: fyd = fyk/γs (kPa) */
export function fyd(steel: SteelMaterial): number {
  return steel.fyk / steel.gammaS
}

/** NBR 6118 tab. 7.2 — cobrimento nominal (m) por classe de agressividade ambiental */
export function coverFor(caa: CAA): { slab: number; beam: number; column: number } {
  return { ...COVER_BY_CAA[caa] }
}
