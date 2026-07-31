/**
 * Alvenaria estrutural — NBR 16868-1:2020 (Fase 1: compressão simples).
 *
 * fk (parede) por eficiência sobre o prisma: 0,7·fpk (bloco de CONCRETO) e
 * 0,6·fpk (bloco CERÂMICO); fpk referido à ÁREA BRUTA. fd = fk/γm, γm = 2,0
 * (combinações normais). Esbeltez λ = hef/tef ≤ 24 p/ alvenaria NÃO armada.
 * Resistência de cálculo por metro:
 *   NRd = fd · t · R,  R = 1 − (λ/40)³   (redutor de esbeltez)
 * Espessura mínima estrutural: 14 cm (bloco família 14).
 */

export interface MasonryCheckInput {
  /** carga vertical de cálculo na base da parede, kN/m */
  nd: number
  /** espessura efetiva (bloco), m */
  thickness: number
  /** altura efetiva do pavimento, m */
  height: number
  block: 'concreto' | 'ceramico'
  /** resistência característica de PRISMA (área bruta), kPa */
  fpk: number
  gammaM?: number
}
export interface MasonryCheckOutput {
  lambda: number
  /** redutor de esbeltez R = 1 − (λ/40)³ */
  r: number
  fk: number
  fd: number
  /** resistência de cálculo, kN/m */
  nRd: number
  utilization: number
  /** fpk mínimo p/ passar com folga de 5%, kPa */
  fpkRequired: number
  slendernessOk: boolean
  ok: boolean
  notes: string[]
}

export const MASONRY_EFF = { concreto: 0.7, ceramico: 0.6 } as const

export function checkMasonryWall(inp: MasonryCheckInput): MasonryCheckOutput {
  const notes: string[] = []
  const gammaM = inp.gammaM ?? 2.0
  const lambda = inp.height / inp.thickness
  const slendernessOk = lambda <= 24
  const r = Math.max(1 - (lambda / 40) ** 3, 0)
  const eff = MASONRY_EFF[inp.block]
  const fk = eff * inp.fpk
  const fd = fk / gammaM
  const nRd = fd * inp.thickness * r
  const utilization = inp.nd / Math.max(nRd, 1e-9)
  const fpkRequired = (1.05 * inp.nd * gammaM) / (eff * inp.thickness * Math.max(r, 1e-9))
  if (!slendernessOk) {
    notes.push(
      `Esbeltez λ = ${lambda.toFixed(1)} > 24 — alvenaria NÃO armada não permitida (§ esbeltez); armar ou enrijecer a parede.`,
    )
  }
  if (inp.thickness < 0.14 - 1e-9) {
    notes.push('Espessura < 14 cm — abaixo do mínimo estrutural usual (família 14).')
  }
  notes.push(
    `fk = ${(eff * 100).toFixed(0)}%·fpk (bloco ${inp.block === 'concreto' ? 'de concreto' : 'cerâmico'}, área bruta) · γm = ${gammaM.toFixed(1)} · R = 1 − (λ/40)³ = ${r.toFixed(3)}.`,
  )
  notes.push('fpk é de PRISMA — especificar bloco+argamassa que atinjam o valor e controlar por ensaio (NBR 16868-2/3).')
  return {
    lambda,
    r,
    fk,
    fd,
    nRd,
    utilization,
    fpkRequired,
    slendernessOk,
    ok: slendernessOk && utilization <= 1,
    notes,
  }
}
