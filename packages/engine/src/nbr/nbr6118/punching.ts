/**
 * Punção em lajes lisas/cogumelo — NBR 6118 §19.5. Verificações do pilar
 * INTERNO sem transferência de momento (K·M): contorno C (esmagamento da
 * biela, τRd2) e contorno C' a 2d (τRd1 sem armadura de punção).
 *
 * É o núcleo normativo do futuro módulo de lajes lisas: o modelo de esforços
 * (pórtico equivalente / grelha) entra no roadmap; a verificação já nasce
 * testada com âncoras manuais.
 */

export interface PunchingInput {
  /** força de punção de cálculo (reação do pilar na laje), kN */
  fsd: number
  /** seção do pilar: retangular c1×c2 ou circular ød, m */
  column: { shape: 'rect'; c1: number; c2: number } | { shape: 'circle'; d: number }
  /** altura útil média da laje (dx+dy)/2, m */
  d: number
  /** taxas de armadura de flexão aderente nas duas direções (ρx, ρy) */
  rhoX: number
  rhoY: number
  /** fck, kPa */
  fck: number
  gammaC: number
  /**
   * fração dos perímetros descontada por ABERTURAS a menos de 8d do pilar
   * (§19.5.1): trecho entre as tangentes traçadas do centro do pilar à
   * abertura não conta. Calcule com `openingPerimeterReduction`. 0 = sem furo.
   */
  openingFraction?: number
}

/**
 * Fração do perímetro crítico descontada por furos próximos (§19.5.1):
 * p/ cada furo com ponto a menos de 8d do CENTRO do pilar (a favor da
 * segurança — a norma mede do contorno C), soma o setor angular subtendido
 * pelo furo visto do centro (tangentes ≈ vértices do polígono do furo).
 */
export function openingPerimeterReduction(
  center: { x: number; y: number },
  holes: { x: number; y: number }[][],
  d: number,
): number {
  let total = 0
  for (const hole of holes) {
    if (hole.length < 3) continue
    let near = false
    const angles: number[] = []
    for (const p of hole) {
      const dx = p.x - center.x
      const dy = p.y - center.y
      if (Math.hypot(dx, dy) <= 8 * d) near = true
      angles.push(Math.atan2(dy, dx))
    }
    if (!near) continue
    // menor arco que contém todos os vértices = 2π − maior lacuna angular
    angles.sort((a, b) => a - b)
    let maxGap = 2 * Math.PI - (angles[angles.length - 1] - angles[0])
    for (let i = 0; i + 1 < angles.length; i++) {
      maxGap = Math.max(maxGap, angles[i + 1] - angles[i])
    }
    total += 2 * Math.PI - maxGap
  }
  // desconto máximo de 50% — acima disso a laje lisa exige estudo dedicado
  return Math.min(total / (2 * Math.PI), 0.5)
}

export interface PunchingOutput {
  /** perímetros dos contornos C e C' (2d), m */
  u0: number
  u1: number
  /** tensões atuantes, kPa */
  tauSd0: number
  tauSd1: number
  /** resistências, kPa */
  tauRd2: number
  tauRd1: number
  okC: boolean
  okC1: boolean
  /** exige armadura de punção (τSd1 > τRd1) */
  needsShearReinf: boolean
  notes: string[]
}

export function checkPunching(inp: PunchingInput): PunchingOutput {
  const notes: string[] = []
  const { d } = inp
  const fckMPa = inp.fck / 1000
  const fcd = inp.fck / inp.gammaC

  // §19.5.1: aberturas a menos de 8d descontam o trecho entre as tangentes
  const red = Math.min(Math.max(inp.openingFraction ?? 0, 0), 0.5)
  const u0 =
    (inp.column.shape === 'rect'
      ? 2 * (inp.column.c1 + inp.column.c2)
      : Math.PI * inp.column.d) *
    (1 - red)
  const u1 =
    (inp.column.shape === 'rect'
      ? 2 * (inp.column.c1 + inp.column.c2) + 4 * Math.PI * d
      : Math.PI * (inp.column.d + 4 * d)) *
    (1 - red)

  const tauSd0 = inp.fsd / (u0 * d)
  const tauSd1 = inp.fsd / (u1 * d)
  if (red > 1e-9) {
    notes.push(
      `Abertura a menos de 8d do pilar: perímetros C/C′ reduzidos em ${Math.round(red * 100)}% (§19.5.1).`,
    )
  }

  // contorno C: τRd2 = 0,27·αv·fcd (§19.5.3.1)
  const alphaV = 1 - fckMPa / 250
  const tauRd2 = 0.27 * alphaV * fcd

  // contorno C': τRd1 = 0,13·(1 + √(20/d[cm]))·(100·ρ·fck[MPa])^{1/3} MPa (§19.5.3.2)
  const rho = Math.min(Math.sqrt(Math.max(inp.rhoX, 0) * Math.max(inp.rhoY, 0)), 0.02)
  const dCm = d * 100
  const tauRd1MPa = 0.13 * (1 + Math.sqrt(20 / dCm)) * Math.cbrt(100 * rho * fckMPa)
  const tauRd1 = tauRd1MPa * 1000

  const okC = tauSd0 <= tauRd2 + 1e-9
  const okC1 = tauSd1 <= tauRd1 + 1e-9
  if (!okC) {
    notes.push('Esmagamento no contorno C — aumente d, fck ou a seção do pilar (capitel).')
  }
  if (!okC1) {
    notes.push(
      'τSd > τRd1 no contorno C′ — necessária armadura de punção (studs/estribos) e verificação do contorno C″ (§19.5.3.3).',
    )
  }
  notes.push('Pilar interno sem transferência de momento (K·MSd) — cargas centradas.')
  return {
    u0,
    u1,
    tauSd0,
    tauSd1,
    tauRd2,
    tauRd1,
    okC,
    okC1,
    needsShearReinf: !okC1,
    notes,
  }
}
