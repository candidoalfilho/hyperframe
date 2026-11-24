import type { WallLoadCalc } from './types'

export interface WallLoadBreakdown {
  /** peso da alvenaria e do revestimento por m² de parede, kN/m² */
  blockPerArea: number
  coatingPerArea: number
  perArea: number
  /** área bruta (altura × comprimento) e líquida (sem aberturas), m² */
  grossArea: number
  netArea: number
  /** carga linear equivalente no comprimento da parede, kN/m */
  w: number
}

/**
 * Carga linear de uma parede de alvenaria sobre viga (ação permanente,
 * NBR 6120): peso por área = e·γalv + nfaces·erev·γrev; as aberturas são
 * descontadas pela área e o total é espalhado no comprimento da parede:
 *   w = perArea · (h·L − Aaberturas) / L
 */
export function wallLoadFromCalc(calc: WallLoadCalc, length: number): WallLoadBreakdown {
  const blockPerArea = calc.thickness * calc.unitWeight
  const coatingPerArea = calc.coatingFaces * calc.coatingThickness * calc.coatingUnitWeight
  const perArea = blockPerArea + coatingPerArea
  const L = Math.max(length, 1e-9)
  const grossArea = calc.height * L
  const netArea = Math.max(grossArea - Math.max(calc.openingsArea, 0), 0)
  return { blockPerArea, coatingPerArea, perArea, grossArea, netArea, w: (perArea * netArea) / L }
}
