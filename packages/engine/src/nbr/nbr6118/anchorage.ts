/**
 * Ancoragem de barras nervuradas — NBR 6118 §9.4.2.
 */

/** tensão de aderência de cálculo: fbd = η1·η2·η3·fctd (η1=2,25 nervurada) */
export function fbd(fctd: number, goodBond = true, phi = 0.02): number {
  const eta1 = 2.25
  const eta2 = goodBond ? 1.0 : 0.7
  const eta3 = phi <= 0.032 ? 1.0 : (132 - phi * 1000) / 100
  return eta1 * eta2 * eta3 * fctd
}

/** comprimento de ancoragem básico: lb = (φ/4)·(fyd/fbd) */
export function basicAnchorage(phi: number, fyd: number, fbdVal: number): number {
  return (phi / 4) * (fyd / fbdVal)
}

/** comprimento necessário: lb,nec = α·lb·(As,calc/As,ef) ≥ lb,min */
export function requiredAnchorage(
  lb: number,
  asCalc: number,
  asEf: number,
  phi: number,
  withHook = false,
): number {
  const alpha = withHook ? 0.7 : 1.0
  const lbNec = alpha * lb * (asEf > 1e-12 ? Math.min(1, asCalc / asEf) : 1)
  const lbMin = Math.max(0.3 * lb, 10 * phi, 0.1)
  return Math.max(lbNec, lbMin)
}
