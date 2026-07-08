import type { SectionRect } from '@hyperframe/engine'

/** número com vírgula decimal (pt-BR): fmt(4.5) → "4,50" */
export function fmt(n: number, dec = 2): string {
  const v = Object.is(n, -0) ? 0 : n
  return v.toFixed(dec).replace('.', ',')
}

/** metros → centímetros inteiros */
export function cm(m: number): number {
  return Math.round(m * 100)
}

/** rótulo de seção em cm: {bw:0.2,h:0.5} → "20x50" */
export function sectionLabel(s: SectionRect): string {
  return `${cm(s.bw)}x${cm(s.h)}`
}
