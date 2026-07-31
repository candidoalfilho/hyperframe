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

/**
 * FASE 2 — contraventamento ao vento (parede no plano):
 * cisalhamento: τd = Vd/(t·L) ≤ fvd = fvk/γm, com fvk = 0,15 + 0,5·σ (MPa,
 * argamassa 3,5–7,0 MPa) ≤ 1,4 MPa; σ = pré-compressão PERMANENTE 0,9·Gk/A.
 * flexocompressão: distribuição LINEAR σ = N/A ± M/W (W = t·L²/6);
 * borda comprimida σmáx ≤ fd; borda tracionada ⇒ bloco triangular
 * (Lt = L·|σmin|/(|σmin|+σmáx), T = |σmin|·t·Lt/2) → GRAUTE + armadura
 * As = T/fyd ancorada (aço integral na 16868).
 */
export interface MasonryShearFlexInput {
  /** cortante de cálculo no pavimento, kN */
  vd: number
  /** momento de cálculo na base do pavimento, kN·m */
  md: number
  /** normal de cálculo TOTAL (G+Q), kN */
  nd: number
  /** normal característica PERMANENTE, kN (p/ pré-compressão 0,9·Gk) */
  ngk: number
  /** comprimento da parede no plano, m */
  length: number
  thickness: number
  block: 'concreto' | 'ceramico'
  fpk: number
  fyd?: number
  gammaM?: number
}
export interface MasonryShearFlexOutput {
  tauD: number
  fvd: number
  shearOk: boolean
  sigmaMax: number
  sigmaMin: number
  fd: number
  compressionOk: boolean
  /** tração de borda ⇒ graute + armadura */
  tension: number
  asTie: number
  needsReinf: boolean
  notes: string[]
}

export function checkMasonryShearFlex(inp: MasonryShearFlexInput): MasonryShearFlexOutput {
  const notes: string[] = []
  const gammaM = inp.gammaM ?? 2.0
  const fyd = inp.fyd ?? 434_782.6
  const a = inp.thickness * inp.length
  const w = (inp.thickness * inp.length * inp.length) / 6
  // pré-compressão favorável mínima: 0,9·Gk
  const sigmaPre = (0.9 * inp.ngk) / a
  const fvk = Math.min(150 + 0.5 * sigmaPre, 1400) // kPa (argamassa 3,5–7,0 MPa)
  const fvd = fvk / gammaM
  const tauD = inp.vd / a
  const shearOk = tauD <= fvd

  const fd = (MASONRY_EFF[inp.block] * inp.fpk) / gammaM
  const sigmaMax = inp.nd / a + inp.md / w
  const sigmaMinRaw = (0.9 * inp.ngk) / a - inp.md / w
  const compressionOk = sigmaMax <= fd
  let tension = 0
  let asTie = 0
  const needsReinf = sigmaMinRaw < 0
  if (needsReinf) {
    const st = Math.abs(sigmaMinRaw)
    const lt = (inp.length * st) / (st + Math.max(sigmaMax, 1e-9))
    tension = (st * inp.thickness * lt) / 2
    asTie = tension / fyd
    notes.push(
      `Borda TRACIONADA (σmin = −${st.toFixed(0)} kPa, Lt = ${lt.toFixed(2).replace('.', ',')} m) — grautear a extremidade e armar As = ${(asTie * 1e4).toFixed(2)} cm² ancorada no pavimento inferior (aço integral, NBR 16868).`,
    )
  }
  if (!shearOk) {
    notes.push(`Cisalhamento τd = ${tauD.toFixed(0)} > fvd = ${fvd.toFixed(0)} kPa — grautear/armar horizontalmente ou alongar a parede.`)
  }
  if (!compressionOk) {
    notes.push(`Borda comprimida σmáx = ${sigmaMax.toFixed(0)} > fd = ${fd.toFixed(0)} kPa — aumentar fpk/espessura.`)
  }
  notes.push('fvk = 0,15 + 0,5·σ (argamassa 3,5–7,0 MPa) ≤ 1,4 MPa; σ = 0,9·Gk/A.')
  return { tauD, fvd, shearOk, sigmaMax, sigmaMin: sigmaMinRaw, fd, compressionOk, tension, asTie, needsReinf, notes }
}

/** trechos (grupos) entre aberturas + fator de concentração de carga */
export function masonryPiers(
  totalLength: number,
  openings: { x: number; width: number }[],
): { x0: number; x1: number; concentration: number }[] {
  const sorted = [...openings].sort((a, b) => a.x - b.x)
  const piers: { x0: number; x1: number; concentration: number }[] = []
  let cursor = 0
  const bounds: [number, number][] = []
  for (const op of sorted) {
    const o0 = Math.max(op.x - op.width / 2, 0)
    const o1 = Math.min(op.x + op.width / 2, totalLength)
    if (o0 > cursor + 0.05) bounds.push([cursor, o0])
    cursor = Math.max(cursor, o1)
  }
  if (totalLength > cursor + 0.05) bounds.push([cursor, totalLength])
  if (bounds.length === 0) return []
  for (let i = 0; i < bounds.length; i++) {
    const [x0, x1] = bounds[i]
    // tributária: meio das aberturas vizinhas (vergas descarregam nos trechos)
    const left = i === 0 ? 0 : (bounds[i - 1][1] + x0) / 2
    const right = i === bounds.length - 1 ? totalLength : (x1 + bounds[i + 1][0]) / 2
    piers.push({ x0, x1, concentration: (right - left) / Math.max(x1 - x0, 1e-6) })
  }
  return piers
}
