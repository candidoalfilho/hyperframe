/**
 * Formatação numérica pt-BR e conversões de unidade para a UI.
 * Interno: m / kN / kPa — UI: cm / MPa onde natural.
 */

const THIN_SPACE = ' '

/** Formata número em pt-BR: vírgula decimal, espaço fino como separador de milhar. */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—'
  const fixed = Math.abs(n).toFixed(digits)
  const [intPart, decPart] = fixed.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : ''
  return sign + grouped + (decPart ? ',' + decPart : '')
}

/** metros → centímetros (número), precisão 0,1 cm */
export function cm(m: number): number {
  return Math.round(m * 1000) / 10
}

/** m² → cm² (número), precisão 0,01 cm² */
export function cm2(m2: number): number {
  return Math.round(m2 * 1e4 * 100) / 100
}

/** Dimensão em cm p/ rótulos de seção: inteiro quando possível ("25", "12,5"). */
export function fmtCmDim(m: number): string {
  const c = cm(m)
  return fmt(c, Number.isInteger(c) ? 0 : 1)
}

/**
 * Interpreta entrada numérica aceitando vírgula OU ponto decimal.
 * "1.234,5" → 1234.5 · "2.88" → 2.88 · inválido → null.
 */
export function parseNum(s: string): number | null {
  let t = s.trim().replace(/[\s  ]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(/,/g, '.')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Valor p/ dentro de <input>: vírgula decimal, sem milhar. trim remove zeros finais. */
export function fmtInput(n: number, digits = 2, trim = true): string {
  if (!Number.isFinite(n)) return ''
  let s = n.toFixed(digits)
  if (trim && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s.replace('.', ',')
}

/** numerais romanos p/ categoria de rugosidade (NBR 6123) e CAA */
export const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const
