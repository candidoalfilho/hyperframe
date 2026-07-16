/**
 * Punção em lajes lisas/cogumelo — NBR 6118 §19.5.
 *
 * Verifica pilares INTERNOS, de BORDA e de CANTO (§19.5.2.1 a §19.5.2.3):
 * τSd = FSd/(u·d) + K·MSd/(Wp·d) nos contornos C (esmagamento, τRd2) e
 * C′ a 2d (τRd1 sem armadura de punção). Borda/canto usam o perímetro
 * crítico REDUZIDO u* (trechos junto à borda livre limitados a
 * a = mín(1,5d; 0,5·c)) e o momento corrigido MSd = (MSd1 − FSd·e*) ≥ 0,
 * com e* = excentricidade do perímetro reduzido. K pela Tabela 19.2
 * (borda/canto: relação c1/2c2, espelhando o MC90/EC2 que a norma adota).
 *
 * Wp e e* são calculados por INTEGRAÇÃO NUMÉRICA do contorno
 * (Wp = ∫|e|·dl — definição da norma), o que vale p/ qualquer geometria e
 * é validado nos testes contra as fórmulas fechadas dos casos clássicos.
 * No contorno C de borda/canto, na ausência de expressão explícita na NBR,
 * adota-se o perímetro reduzido com os MESMOS trechos a = mín(1,5d; 0,5c)
 * do u* — ligeiramente mais conservador que o u0 do EC2 (c2 + 3d).
 */

export type PunchingPosition = 'internal' | 'edge' | 'corner'

export interface PunchingInput {
  /** força de punção de cálculo (reação do pilar na laje), kN */
  fsd: number
  /**
   * seção do pilar: retangular c1×c2 ou circular ød, m. Em pilar de BORDA,
   * c1 = dimensão PERPENDICULAR à borda livre e c2 = paralela (fig. 19.2).
   */
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
  /** posição do pilar (§19.5.2) — padrão 'internal' */
  position?: PunchingPosition
  /**
   * momento desbalanceado de cálculo transferido laje→pilar, kN·m:
   * msd1 no plano PERPENDICULAR à borda livre (borda/canto) ou na direção
   * de c1 (interno); msd2 no plano paralelo (borda) / direção de c2 (interno).
   */
  msd1?: number
  msd2?: number
}

// ---------------------------------------------------------------------------
// contornos críticos como peças (segmentos + arcos) e integração numérica
// ---------------------------------------------------------------------------

type Piece =
  | { kind: 'seg'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }

const N_INT = 256

/** integra comprimento, ∫|x|dl, ∫|y|dl e ∫x/∫y dl (centroide) das peças */
function integrate(pieces: Piece[]): {
  u: number
  wpx: number
  wpy: number
  sx: number
  sy: number
} {
  let u = 0
  let wpx = 0 // ∫|x| dl — módulo p/ momento com excentricidade ao longo de x
  let wpy = 0 // ∫|y| dl
  let sx = 0 // ∫x dl — centroide
  let sy = 0
  const acc = (x: number, y: number, dl: number): void => {
    u += dl
    wpx += Math.abs(x) * dl
    wpy += Math.abs(y) * dl
    sx += x * dl
    sy += y * dl
  }
  for (const p of pieces) {
    if (p.kind === 'seg') {
      const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1)
      const dl = len / N_INT
      for (let i = 0; i < N_INT; i++) {
        const t = (i + 0.5) / N_INT
        acc(p.x1 + (p.x2 - p.x1) * t, p.y1 + (p.y2 - p.y1) * t, dl)
      }
    } else {
      const dl = (Math.abs(p.a1 - p.a0) * p.r) / N_INT
      for (let i = 0; i < N_INT; i++) {
        const a = p.a0 + ((p.a1 - p.a0) * (i + 0.5)) / N_INT
        acc(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), dl)
      }
    }
  }
  return { u, wpx, wpy, sx, sy }
}

/**
 * Contornos do pilar retangular com centro na origem. Convenção de borda:
 * borda livre em x = −c1/2 (canto: segunda borda livre em y = −c2/2).
 * `at` = afastamento do contorno (0 = contorno C; 2d = contorno C′);
 * `reduced` aplica os trechos limitados junto à(s) borda(s) livre(s).
 */
function rectContour(
  c1: number,
  c2: number,
  at: number,
  position: PunchingPosition,
  reduced: boolean,
  d: number,
): Piece[] {
  const hx = c1 / 2
  const hy = c2 / 2
  const pieces: Piece[] = []
  if (position === 'internal') {
    // 4 retas + 4 quartos de círculo (at = 0 degenera nos cantos)
    pieces.push({ kind: 'seg', x1: -hx, y1: hy + at, x2: hx, y2: hy + at })
    pieces.push({ kind: 'seg', x1: -hx, y1: -hy - at, x2: hx, y2: -hy - at })
    pieces.push({ kind: 'seg', x1: hx + at, y1: -hy, x2: hx + at, y2: hy })
    pieces.push({ kind: 'seg', x1: -hx - at, y1: -hy, x2: -hx - at, y2: hy })
    if (at > 1e-9) {
      pieces.push({ kind: 'arc', cx: hx, cy: hy, r: at, a0: 0, a1: Math.PI / 2 })
      pieces.push({ kind: 'arc', cx: -hx, cy: hy, r: at, a0: Math.PI / 2, a1: Math.PI })
      pieces.push({ kind: 'arc', cx: -hx, cy: -hy, r: at, a0: Math.PI, a1: 1.5 * Math.PI })
      pieces.push({ kind: 'arc', cx: hx, cy: -hy, r: at, a0: 1.5 * Math.PI, a1: 2 * Math.PI })
    }
    return pieces
  }
  if (position === 'edge') {
    // envolve as 3 faces internas; junto à borda livre os trechos retos
    // valem a = mín(1,5d; 0,5·c1) quando reduzido (fig. 19.2)
    const a = reduced ? Math.min(1.5 * d, 0.5 * c1) : c1
    pieces.push({ kind: 'seg', x1: -hx, y1: hy + at, x2: -hx + a, y2: hy + at })
    pieces.push({ kind: 'seg', x1: -hx, y1: -hy - at, x2: -hx + a, y2: -hy - at })
    pieces.push({ kind: 'seg', x1: hx + at, y1: -hy, x2: hx + at, y2: hy })
    if (at > 1e-9) {
      pieces.push({ kind: 'arc', cx: hx, cy: hy, r: at, a0: 0, a1: Math.PI / 2 })
      pieces.push({ kind: 'arc', cx: hx, cy: -hy, r: at, a0: 1.5 * Math.PI, a1: 2 * Math.PI })
    }
    return pieces
  }
  // canto: bordas livres em x = −c1/2 e y = −c2/2 — envolve as 2 faces internas
  const a1 = reduced ? Math.min(1.5 * d, 0.5 * c1) : c1
  const a2 = reduced ? Math.min(1.5 * d, 0.5 * c2) : c2
  pieces.push({ kind: 'seg', x1: -hx, y1: hy + at, x2: -hx + a1, y2: hy + at })
  pieces.push({ kind: 'seg', x1: hx + at, y1: -hy, x2: hx + at, y2: -hy + a2 })
  if (at > 1e-9) {
    pieces.push({ kind: 'arc', cx: hx, cy: hy, r: at, a0: 0, a1: Math.PI / 2 })
  }
  return pieces
}

/** K da Tabela 19.2 — interpolação em c1/c2 (clampado em [0,5; 3]) */
export function punchingK(ratio: number): number {
  const r = Math.min(3, Math.max(0.5, ratio))
  const xs = [0.5, 1, 2, 3]
  const ks = [0.45, 0.6, 0.7, 0.8]
  for (let i = 0; i + 1 < xs.length; i++) {
    if (r <= xs[i + 1]) {
      const t = (r - xs[i]) / (xs[i + 1] - xs[i])
      return ks[i] + t * (ks[i + 1] - ks[i])
    }
  }
  return 0.8
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
  /** posição verificada (interno/borda/canto) */
  position: PunchingPosition
  /** perímetros EFETIVOS dos contornos C e C' (borda/canto: reduzidos), m */
  u0: number
  u1: number
  /** tensões atuantes (incluem a parcela K·MSd/Wp quando há momento), kPa */
  tauSd0: number
  tauSd1: number
  /** resistências, kPa */
  tauRd2: number
  tauRd1: number
  okC: boolean
  okC1: boolean
  /** exige armadura de punção (τSd1 > τRd1) */
  needsShearReinf: boolean
  /** excentricidade do perímetro reduzido (borda/canto), m */
  eStar?: number
  /** soma dos momentos efetivamente aplicados na verificação, kN·m */
  msdUsed?: number
  notes: string[]
}

export interface PunchingReinfDesign {
  /** nº de linhas (contornos paralelos a C′) de conectores */
  lines: number
  /** espaçamento radial entre linhas, m (≤ 0,75d) */
  sr: number
  /** distância da 1ª linha à face do pilar, m (≤ 0,5d) */
  s0: number
  /** conectores por linha (espaçamento na linha ≤ 2d) e bitola, m */
  studsPerLine: number
  phi: number
  /** Asw NECESSÁRIO e fornecido por linha, m² */
  aswRequired: number
  aswProvided: number
  /** fywd adotado (≤ 300 MPa conectores, ajuste §19.4.2 p/ h > 15 cm), kPa */
  fywdUsed: number
  /** contorno C″: perímetro efetivo e tensão (deve ficar ≤ τRd1) */
  uC2: number
  tauSdC2: number
  /** distância do último contorno de armadura à face do pilar, m */
  lastLineAt: number
  ok: boolean
  /** ex.: "4 linhas × 14 conectores φ 10 (s0 = 8 cm, sr = 12 cm)" */
  spec: string
  notes: string[]
}

/**
 * Dimensiona a armadura de punção (conectores tipo pino/studs, α = 90°) —
 * NBR 6118 §19.5.3.3/§19.5.3.4 e detalhamento da fig. 20.2:
 *  · Asw por linha a partir de τRd3 = 0,10·(1+√(20/d))·(100ρfck)^⅓ +
 *    1,5·(d/sr)·(Asw·fywd)/(u·d) ≥ τSd, com u = perímetro (reduzido em
 *    borda/canto) do contorno C′;
 *  · linhas estendidas até o contorno C″ (2d além da última linha)
 *    dispensar armadura: τSd(C″) ≤ τRd1 — u″/Wp″/e*″ integrados no contorno;
 *  · s0 ≤ 0,5d, sr ≤ 0,75d, espaçamento na linha ≤ 2d;
 *  · fywd ≤ 300 MPa (conectores), elevado linearmente até 435 MPa p/
 *    15 cm < h ≤ 35 cm (§19.4.2).
 * `h` = espessura da laje, m. Momentos/aberturas herdados da verificação.
 */
export function designPunchingReinf(
  inp: PunchingInput & { h: number },
): PunchingReinfDesign {
  const notes: string[] = []
  const { d } = inp
  const position = inp.position ?? 'internal'
  const base = checkPunching(inp)
  const red = Math.min(Math.max(inp.openingFraction ?? 0, 0), 0.5)
  const fac = 1 - red
  const fckMPa = inp.fck / 1000
  const rho = Math.min(Math.sqrt(Math.max(inp.rhoX, 0) * Math.max(inp.rhoY, 0)), 0.02)

  // parcela do concreto de τRd3 (coeficiente 0,10 — não os 0,13 de τRd1)
  const tauC3 =
    0.1 * (1 + Math.sqrt(20 / (d * 100))) * Math.cbrt(100 * rho * fckMPa) * 1000

  // fywd: 300 MPa (conectores) com elevação linear do §19.4.2 até 435 MPa
  const hFac = Math.min(Math.max((inp.h - 0.15) / 0.2, 0), 1)
  const fywd = (300 + (435 - 300) * hFac) * 1000 // kPa

  // detalhamento: 1ª linha a 0,5d da face; linhas a 0,75d (fig. 20.2)
  const s0 = 0.5 * d
  const sr = 0.75 * d

  // Asw por linha p/ τRd3 ≥ τSd no contorno C′ (u efetivo já reduzido)
  const aswRequired = Math.max(
    ((base.tauSd1 - tauC3) * base.u1 * d) / (1.5 * (d / sr) * fywd),
    0,
  )

  // geometria p/ os contornos C″ (mesma máquina de contornos)
  const col = inp.column
  const isCircle = col.shape === 'circle'
  const c1 = col.shape === 'circle' ? col.d : col.c1
  const c2 = col.shape === 'circle' ? col.d : col.c2
  const contourAt = (
    at: number,
  ): { u: number; wpx: number; wpy: number; ex: number; ey: number } => {
    if (isCircle) {
      const R = c1 / 2 + at
      return { u: 2 * Math.PI * R * fac, wpx: 4 * R * R * fac, wpy: 4 * R * R * fac, ex: 0, ey: 0 }
    }
    const full = integrate(rectContour(c1, c2, at, position, false, d))
    const redC = integrate(rectContour(c1, c2, at, position, true, d))
    return {
      u: redC.u * fac,
      wpx: full.wpx * fac,
      wpy: full.wpy * fac,
      ex: Math.max(redC.sx / redC.u, 0),
      ey: Math.max(redC.sy / redC.u, 0),
    }
  }
  const m1In = Math.max(inp.msd1 ?? 0, 0)
  const m2In = Math.max(inp.msd2 ?? 0, 0)
  const K1 = punchingK(position === 'internal' ? c1 / c2 : c1 / (2 * c2))
  const K2 = punchingK(position === 'internal' ? c2 / c1 : c2 / (2 * c1))
  const tauAt = (at: number): { tau: number; u: number } => {
    const c = contourAt(at)
    let mom = 0
    if (position === 'internal') {
      mom = (K1 * m1In) / c.wpx + (K2 * m2In) / c.wpy
    } else if (position === 'edge') {
      const m1 = Math.max(m1In - inp.fsd * c.ex, 0)
      mom = (K1 * m1) / c.wpx + (K2 * m2In) / c.wpy
    } else {
      const mX = Math.max(m1In - inp.fsd * c.ex, 0)
      const mY = Math.max(m2In - inp.fsd * c.ey, 0)
      mom = Math.max((K1 * mX) / c.wpx, (K2 * mY) / c.wpy)
    }
    return { tau: inp.fsd / (c.u * d) + mom / d, u: c.u }
  }

  // estende linhas até τSd(C″) ≤ τRd1, com C″ a 2d da última linha (§19.5.3.4)
  const MAX_LINES = 12
  let lines = 2 // mínimo prático: duas linhas de conectores
  let c2Info = tauAt(s0 + (lines - 1) * sr + 2 * d)
  while (c2Info.tau > base.tauRd1 + 1e-9 && lines < MAX_LINES) {
    lines++
    c2Info = tauAt(s0 + (lines - 1) * sr + 2 * d)
  }
  const lastLineAt = s0 + (lines - 1) * sr
  const okC2 = c2Info.tau <= base.tauRd1 + 1e-9

  // conectores por linha: espaçamento ≤ 2d na linha MAIS EXTERNA + Asw
  const uOuter = isCircle
    ? 2 * Math.PI * (c1 / 2 + lastLineAt) * fac
    : integrate(rectContour(c1, c2, lastLineAt, position, true, d)).u * fac
  const nSpacing = Math.max(2, Math.ceil(uOuter / (2 * d)))
  const PHIS = [0.008, 0.01, 0.0125, 0.016]
  let phi = PHIS[PHIS.length - 1]
  let studsPerLine = nSpacing
  for (const p of PHIS) {
    const aP = (Math.PI * p * p) / 4
    const n = Math.max(nSpacing, Math.ceil(aswRequired / aP))
    if (n <= Math.max(nSpacing, 30)) {
      phi = p
      studsPerLine = n
      break
    }
  }
  const aswProvided = studsPerLine * ((Math.PI * phi * phi) / 4)

  const ok = okC2 && base.okC && aswProvided + 1e-12 >= aswRequired
  if (!base.okC) {
    notes.push('τSd > τRd2 no contorno C — armadura de punção NÃO resolve; usar capitel/maior d.')
  }
  if (!okC2) {
    notes.push(`Contorno C″ não dispensou com ${MAX_LINES} linhas — revisar espessura/capitel.`)
  }
  notes.push(
    'Conectores tipo pino (α = 90°), fig. 20.2: s0 ≤ 0,5d, sr ≤ 0,75d, ≤ 2d na linha; ancorar nas duas faces.',
  )
  const mm = Math.round(phi * 1000 * 10) / 10
  const spec = `${lines} linhas × ${studsPerLine} conectores φ ${String(mm).replace('.', ',')} (s0 = ${Math.round(s0 * 100)} cm, sr = ${Math.round(sr * 100)} cm)`
  return {
    lines,
    sr,
    s0,
    studsPerLine,
    phi,
    aswRequired,
    aswProvided,
    fywdUsed: fywd,
    uC2: c2Info.u,
    tauSdC2: c2Info.tau,
    lastLineAt,
    ok,
    spec,
    notes,
  }
}

export function checkPunching(inp: PunchingInput): PunchingOutput {
  const notes: string[] = []
  const { d } = inp
  const position = inp.position ?? 'internal'
  const fckMPa = inp.fck / 1000
  const fcd = inp.fck / inp.gammaC

  // §19.5.1: aberturas a menos de 8d descontam o trecho entre as tangentes
  const red = Math.min(Math.max(inp.openingFraction ?? 0, 0), 0.5)
  const fac = 1 - red
  const m1In = Math.max(inp.msd1 ?? 0, 0)
  const m2In = Math.max(inp.msd2 ?? 0, 0)

  let u0: number
  let u1: number
  let tauSd0: number
  let tauSd1: number
  let eStar: number | undefined
  let msdUsed: number | undefined

  if (inp.column.shape === 'circle') {
    const D = inp.column.d
    u0 = Math.PI * D * fac
    u1 = Math.PI * (D + 4 * d) * fac
    // Wp do círculo: ∫|e|dl = 4R² ⇒ C: D² · C′: (D+4d)²; K = 0,60 (c1/c2 = 1)
    const m = m1In + m2In
    tauSd0 = inp.fsd / (u0 * d) + (m > 0 ? (0.6 * m) / (D * D * fac * d) : 0)
    tauSd1 = inp.fsd / (u1 * d) + (m > 0 ? (0.6 * m) / ((D + 4 * d) ** 2 * fac * d) : 0)
    if (m > 0) msdUsed = m
    if (position !== 'internal') {
      notes.push(
        'Pilar CIRCULAR de borda/canto verificado como interno — confirmar manualmente (§19.5.2).',
      )
    }
  } else {
    const { c1, c2 } = inp.column
    if (position === 'internal') {
      const C = integrate(rectContour(c1, c2, 0, 'internal', false, d))
      const C1 = integrate(rectContour(c1, c2, 2 * d, 'internal', false, d))
      u0 = C.u * fac
      u1 = C1.u * fac
      const K1 = punchingK(c1 / c2) // excentricidade ao longo de c1 (x)
      const K2 = punchingK(c2 / c1)
      tauSd0 =
        inp.fsd / (u0 * d) + ((K1 * m1In) / (C.wpx * fac) + (K2 * m2In) / (C.wpy * fac)) / d
      tauSd1 =
        inp.fsd / (u1 * d) + ((K1 * m1In) / (C1.wpx * fac) + (K2 * m2In) / (C1.wpy * fac)) / d
      if (m1In + m2In > 0) {
        msdUsed = m1In + m2In
        notes.push('τSd inclui a parcela K·MSd/(Wp·d) do momento transferido (§19.5.2.1).')
      } else {
        notes.push('Pilar interno sem transferência de momento (K·MSd) — cargas centradas.')
      }
    } else if (position === 'edge') {
      const full0 = integrate(rectContour(c1, c2, 0, 'edge', false, d))
      const red0 = integrate(rectContour(c1, c2, 0, 'edge', true, d))
      const full1 = integrate(rectContour(c1, c2, 2 * d, 'edge', false, d))
      const red1 = integrate(rectContour(c1, c2, 2 * d, 'edge', true, d))
      u0 = red0.u * fac
      u1 = red1.u * fac
      eStar = Math.max(red1.sx / red1.u, 0)
      // MSd = (MSd1 − MSd*) ≥ 0, com MSd* = FSd·e* (§19.5.2.2)
      const m1 = Math.max(m1In - inp.fsd * eStar, 0)
      const K1 = punchingK(c1 / (2 * c2))
      const K2 = punchingK(c2 / (2 * c1))
      tauSd0 =
        inp.fsd / (u0 * d) +
        ((K1 * m1) / (full0.wpx * fac) + (K2 * m2In) / (full0.wpy * fac)) / d
      tauSd1 =
        inp.fsd / (u1 * d) +
        ((K1 * m1) / (full1.wpx * fac) + (K2 * m2In) / (full1.wpy * fac)) / d
      msdUsed = m1 + m2In > 0 ? m1 + m2In : undefined
      notes.push(
        `Pilar de BORDA: u* reduzido e MSd corrigido por e* = ${(eStar * 100).toFixed(1)} cm (§19.5.2.2).`,
      )
    } else {
      // canto (§19.5.2.3): verificação de borda aplicada às DUAS bordas
      // livres, uma por vez; governa a pior
      const full0 = integrate(rectContour(c1, c2, 0, 'corner', false, d))
      const red0 = integrate(rectContour(c1, c2, 0, 'corner', true, d))
      const full1 = integrate(rectContour(c1, c2, 2 * d, 'corner', false, d))
      const red1 = integrate(rectContour(c1, c2, 2 * d, 'corner', true, d))
      u0 = red0.u * fac
      u1 = red1.u * fac
      const eX = Math.max(red1.sx / red1.u, 0)
      const eY = Math.max(red1.sy / red1.u, 0)
      const mX = Math.max(m1In - inp.fsd * eX, 0)
      const mY = Math.max(m2In - inp.fsd * eY, 0)
      const KX = punchingK(c1 / (2 * c2))
      const KY = punchingK(c2 / (2 * c1))
      const momC = Math.max((KX * mX) / (full0.wpx * fac), (KY * mY) / (full0.wpy * fac))
      const momC1 = Math.max((KX * mX) / (full1.wpx * fac), (KY * mY) / (full1.wpy * fac))
      tauSd0 = inp.fsd / (u0 * d) + momC / d
      tauSd1 = inp.fsd / (u1 * d) + momC1 / d
      eStar = Math.max(eX, eY)
      msdUsed = mX + mY > 0 ? Math.max(mX, mY) : undefined
      notes.push(
        `Pilar de CANTO: u* reduzido nas duas bordas livres; governa a pior direção (§19.5.2.3).`,
      )
    }
  }

  if (red > 1e-9) {
    notes.push(
      `Abertura a menos de 8d do pilar: perímetros e Wp reduzidos em ${Math.round(red * 100)}% (§19.5.1).`,
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
  return {
    position,
    u0,
    u1,
    tauSd0,
    tauSd1,
    tauRd2,
    tauRd1,
    okC,
    okC1,
    needsShearReinf: !okC1,
    eStar,
    msdUsed,
    notes,
  }
}
