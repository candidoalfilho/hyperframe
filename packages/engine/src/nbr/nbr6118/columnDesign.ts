import type { Vec2 } from '../../model/types'
import { clipHalfPlane, areaCentroid } from '../../geometry/clip'
import { pointInPolygon } from '../../geometry/geometry'

/**
 * Dimensionamento de pilares retangulares a flexo-compressão oblíqua —
 * NBR 6118 §17.2 (domínios) e §15.8 (esbeltez, pilar-padrão).
 *
 * Método: integração da seção com bloco retangular de tensões (0,85·fcd,
 * profundidade 0,8x) e barras discretas. Para cada arranjo candidato, a curva
 * de interação (Mu, Mv) é traçada p/ o Nd de cada solicitação (varredura do
 * ângulo da linha neutra + bisseção da profundidade p/ equilíbrio de N) e a
 * utilização é a razão radial demanda/capacidade.
 *
 * Eixos da seção: u ao longo de bw, v ao longo de h (origem no centroide).
 * Mu = ∫σ·u dA (gradiente ao longo de bw) · Mv = ∫σ·v dA (ao longo de h).
 */

export interface ColumnSectionDef {
  bw: number
  h: number
  cover: number // ao estribo, m
  fcd: number // kPa
  fyd: number // kPa
  es: number // kPa
}

export interface BarArrangement {
  n: number
  phi: number // m
  positions: Vec2[] // (u,v)
  as: number // m² total
  spec: string // "8 φ 16"
}

export interface ColumnDemandPoint {
  label: string
  nd: number // compressão +, kN
  /** momentos de cálculo JÁ com efeitos locais (e2) e mínimos incluídos */
  mu: number // kN·m (gradiente ao longo de bw)
  mv: number // kN·m (ao longo de h)
}

const EPS_CU = 0.0035
const EPS_C2 = 0.002
const EPS_SU = 0.01
const ALPHA_C = 0.85
const LAMBDA_BLOCK = 0.8
const STIRRUP_PHI = 0.0063

/** distribui n barras no perímetro (cantos + faces, proporcional aos lados) */
export function placeBars(sec: ColumnSectionDef, n: number, phi: number): Vec2[] | null {
  if (n < 4 || n % 2 !== 0) return null
  const du = sec.bw / 2 - sec.cover - STIRRUP_PHI - phi / 2
  const dv = sec.h / 2 - sec.cover - STIRRUP_PHI - phi / 2
  if (du <= 0.01 || dv <= 0.01) return null
  const corners: Vec2[] = [
    { x: -du, y: -dv },
    { x: du, y: -dv },
    { x: du, y: dv },
    { x: -du, y: dv },
  ]
  let extra = n - 4
  // pares extras alternando: faces maiores primeiro
  let nFaceV = 0 // barras extras por face vertical (lado h)
  let nFaceU = 0 // por face horizontal (lado bw)
  while (extra >= 2) {
    const faceVGap = (2 * dv) / (nFaceV + 1)
    const faceUGap = (2 * du) / (nFaceU + 1)
    if (faceVGap >= faceUGap) nFaceV++
    else nFaceU++
    extra -= 2
  }
  const pos: Vec2[] = [...corners]
  for (let i = 1; i <= nFaceV; i++) {
    const v = -dv + (2 * dv * i) / (nFaceV + 1)
    pos.push({ x: -du, y: v }, { x: du, y: v })
  }
  for (let i = 1; i <= nFaceU; i++) {
    const u = -du + (2 * du * i) / (nFaceU + 1)
    pos.push({ x: u, y: -dv }, { x: u, y: dv })
  }
  // espaçamento livre mínimo: max(20 mm, φ, 1,2·d_agregado≈23 mm)
  const minClear = Math.max(0.02, phi, 0.023)
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y)
      if (d < minClear + phi) return null
    }
  }
  return pos
}

interface SectionState {
  n: number // kN (compressão +)
  mu: number
  mv: number
}

/** esforços resistentes p/ LN de direção β e profundidade x (do bordo mais comprimido) */
function sectionForces(
  sec: ColumnSectionDef,
  bars: BarArrangement,
  beta: number,
  x: number,
): SectionState {
  const w = { x: Math.cos(beta), y: Math.sin(beta) } // direção de compressão crescente
  const rect: Vec2[] = [
    { x: -sec.bw / 2, y: -sec.h / 2 },
    { x: sec.bw / 2, y: -sec.h / 2 },
    { x: sec.bw / 2, y: sec.h / 2 },
    { x: -sec.bw / 2, y: sec.h / 2 },
  ]
  let sMax = -Infinity
  let sMin = Infinity
  for (const p of rect) {
    const s = p.x * w.x + p.y * w.y
    if (s > sMax) sMax = s
    if (s < sMin) sMin = s
  }
  const hSec = sMax - sMin

  // deformação no bordo comprimido conforme domínio
  let dExt = 0
  for (const b of bars.positions) {
    const s = b.x * w.x + b.y * w.y
    dExt = Math.max(dExt, sMax - s)
  }
  let epsTop: number
  if (x < hSec) {
    // domínios 2-3-4: pivô A (εs=10‰) ou B (εc=3,5‰)
    epsTop = dExt > x ? Math.min(EPS_CU, (EPS_SU * x) / (dExt - x)) : EPS_CU
  } else {
    // domínio 5: pivô C a 3h/7 do bordo comprimido, εc2=2‰
    epsTop = (EPS_C2 * x) / (x - (3 / 7) * hSec)
  }
  const sNA = sMax - x
  const strainAt = (s: number) => (x <= 1e-9 ? 0 : (epsTop * (s - sNA)) / x)

  // concreto: bloco retangular 0,8x
  const yBlock = LAMBDA_BLOCK * x
  const cBlock = sMax - yBlock
  // região s ≥ cBlock  ⇔  −w·p ≤ −cBlock
  const comp = clipHalfPlane(rect, { x: -w.x, y: -w.y }, -cBlock)
  const { area, cx, cy } = areaCentroid(comp)
  const sigmaC = ALPHA_C * sec.fcd
  let N = sigmaC * area
  let Mu = sigmaC * area * cx
  let Mv = sigmaC * area * cy

  // barras (desconta concreto deslocado dentro do bloco)
  const aPhi = (Math.PI * bars.phi * bars.phi) / 4
  for (const b of bars.positions) {
    const s = b.x * w.x + b.y * w.y
    const eps = strainAt(s)
    let sigma = Math.max(-sec.fyd, Math.min(sec.fyd, sec.es * eps))
    if (s >= cBlock) sigma -= sigmaC // barra dentro do bloco comprimido
    N += sigma * aPhi
    Mu += sigma * aPhi * b.x
    Mv += sigma * aPhi * b.y
  }
  return { n: N, mu: Mu, mv: Mv }
}

/** capacidade máxima de compressão centrada (x → ∞): εc = 2‰ uniforme */
export function squashLoad(sec: ColumnSectionDef, bars: BarArrangement): number {
  const sigmaS = Math.min(sec.fyd, sec.es * EPS_C2)
  const ac = sec.bw * sec.h
  return ALPHA_C * sec.fcd * (ac - bars.as) + sigmaS * bars.as
}

/** tração pura (todas as barras escoando) */
function tensionCapacity(sec: ColumnSectionDef, bars: BarArrangement): number {
  return -bars.as * sec.fyd
}

/** curva de interação (Mu, Mv) p/ N = nd — polígono com nBeta vértices */
export function interactionCurve(
  sec: ColumnSectionDef,
  bars: BarArrangement,
  nd: number,
  nBeta = 24,
): Vec2[] | null {
  const hDiag = Math.hypot(sec.bw, sec.h)
  const nMax = squashLoad(sec, bars)
  const nMin = tensionCapacity(sec, bars)
  if (nd >= nMax || nd <= nMin) return null
  const curve: Vec2[] = []
  for (let k = 0; k < nBeta; k++) {
    const beta = (2 * Math.PI * k) / nBeta
    // bisseção em x p/ N(x) = nd (N é crescente em x)
    let lo = 1e-6
    let hi = 12 * hDiag
    for (let it = 0; it < 44; it++) {
      const mid = (lo + hi) / 2
      const st = sectionForces(sec, bars, beta, mid)
      if (st.n < nd) lo = mid
      else hi = mid
    }
    const st = sectionForces(sec, bars, beta, (lo + hi) / 2)
    curve.push({ x: st.mu, y: st.mv })
  }
  return curve
}

/**
 * Utilização radial de (mu, mv) frente à curva de interação (polígono que
 * contém a origem): util = |M_d| / |M_capacidade na direção de M_d|.
 *
 * Interseção do raio s·dir (s>0) com a aresta a + t·(b−a), t∈[0,1]:
 *   t·e − s·dir = −a  →  det = dir.x·e.y − dir.y·e.x
 *   t = (a.x·dir.y − a.y·dir.x)/det · s = (a.x·e.y − a.y·e.x)/det
 */
export function radialUtilization(curve: Vec2[], mu: number, mv: number): number {
  const r = Math.hypot(mu, mv)
  if (r < 1e-6) return 0
  const dir = { x: mu / r, y: mv / r }
  let capacity = 0
  for (let i = 0; i < curve.length; i++) {
    const a = curve[i]
    const b = curve[(i + 1) % curve.length]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const det = dir.x * ey - dir.y * ex
    if (Math.abs(det) < 1e-12) continue
    const t = (a.x * dir.y - a.y * dir.x) / det
    const s = (a.x * ey - a.y * ex) / det
    if (t >= -1e-9 && t <= 1 + 1e-9 && s > 0) capacity = Math.max(capacity, s)
  }
  if (capacity < 1e-9) {
    // curva degenerada (N próximo do esmagamento): sem capacidade de momento
    return pointInPolygon({ x: mu, y: mv }, curve) ? 1 : 99
  }
  return r / capacity
}

// ---------------------------------------------------------------------------
// esbeltez — pilar-padrão com curvatura aproximada (§15.8.3.3.2)
// ---------------------------------------------------------------------------

export interface SlendernessInput {
  le: number // m
  hDir: number // dimensão da seção na direção analisada, m
  nd: number // kN
  ac: number // m²
  fcd: number // kPa
  /** momentos de 1ª ordem nas extremidades (|MA| ≥ |MB|), com sinal relativo */
  ma: number
  mb: number
}

export interface SlendernessResult {
  lambda: number
  lambda1: number
  alphaB: number
  e2: number // m
  m2: number // kN·m (Nd·e2, 0 se λ ≤ λ1)
  needsRigorous: boolean // λ > 90
}

export function slenderness(inp: SlendernessInput): SlendernessResult {
  const lambda = (3.464 * inp.le) / inp.hDir
  const maAbs = Math.abs(inp.ma)
  // αb p/ pilar biapoiado sem cargas transversais
  let alphaB = 1
  if (maAbs > 1e-6) {
    const ratio = inp.mb / inp.ma // >0 curvatura simples
    alphaB = Math.min(1, Math.max(0.4, 0.6 + 0.4 * ratio))
  } else {
    alphaB = 1
  }
  const e1 = maAbs > 1e-6 && inp.nd > 1e-6 ? maAbs / inp.nd : 0
  const lambda1 = Math.min(90, Math.max(35, (25 + 12.5 * (e1 / inp.hDir)) / alphaB))
  let e2 = 0
  let m2 = 0
  if (lambda > lambda1 && inp.nd > 1e-6) {
    const nu = inp.nd / (inp.ac * inp.fcd)
    const curv = Math.min(0.005 / (inp.hDir * (nu + 0.5)), 0.005 / inp.hDir)
    e2 = ((inp.le * inp.le) / 10) * curv
    m2 = inp.nd * e2
  }
  return { lambda, lambda1, alphaB, e2, m2, needsRigorous: lambda > 90 }
}

/** momento mínimo de 1ª ordem — §11.3.3.4.3 */
export function minimumMoment(nd: number, hDir: number): number {
  return nd * (0.015 + 0.03 * hDir)
}

// ---------------------------------------------------------------------------
// laço de dimensionamento
// ---------------------------------------------------------------------------

export interface ColumnDesignOutput {
  arrangement: BarArrangement | null
  utilization: number
  governing: string
  rho: number
  stirrups: { phi: number; spacing: number; spec: string }
  notes: string[]
  ok: boolean
}

const CANDIDATE_PHIS = [0.0125, 0.016, 0.02, 0.025]
const CANDIDATE_NS = [4, 6, 8, 10, 12, 16, 20]

export function designColumnSection(
  sec: ColumnSectionDef,
  demands: ColumnDemandPoint[],
  asMinAbs: number,
): ColumnDesignOutput {
  const ac = sec.bw * sec.h
  const notes: string[] = []

  // candidatos ordenados por As
  const candidates: BarArrangement[] = []
  for (const phi of CANDIDATE_PHIS) {
    for (const n of CANDIDATE_NS) {
      const positions = placeBars(sec, n, phi)
      if (!positions) continue
      const as = (n * Math.PI * phi * phi) / 4
      if (as > 0.04 * ac) continue // ρmax = 4% (fora de emendas)
      const mm = Math.round(phi * 1000 * 10) / 10
      candidates.push({
        n,
        phi,
        positions,
        as,
        spec: `${n} φ ${mm % 1 === 0 ? mm.toFixed(0) : mm}`,
      })
    }
  }
  candidates.sort((a, b) => a.as - b.as)

  let best: BarArrangement | null = null
  let bestUtil = Infinity
  let governing = ''
  for (const cand of candidates) {
    if (cand.as < asMinAbs) continue
    let worst = 0
    let worstLabel = ''
    let feasible = true
    const cache = new Map<number, Vec2[] | null>()
    for (const d of demands) {
      // agrupa Nd em degraus de 25 kN p/ reaproveitar curvas de interação
      const key = Math.round(d.nd / 25) * 25
      let curve = cache.get(key)
      if (curve === undefined) {
        curve = interactionCurve(sec, cand, key)
        cache.set(key, curve)
      }
      if (!curve) {
        feasible = false
        worstLabel = `${d.label} (Nd fora da capacidade)`
        break
      }
      const u = radialUtilization(curve, d.mu, d.mv)
      if (u > worst) {
        worst = u
        worstLabel = d.label
      }
      if (worst > 1.0001) break
    }
    if (feasible && worst <= 1.0001) {
      best = cand
      bestUtil = worst
      governing = worstLabel
      break
    }
    if (feasible && worst < bestUtil) {
      bestUtil = worst
      governing = worstLabel
    }
  }

  const phiL = best?.phi ?? CANDIDATE_PHIS[CANDIDATE_PHIS.length - 1]
  const phiT = Math.max(0.005, phiL / 4)
  const phiTmm = phiT <= 0.005 ? 5 : phiT <= 0.0063 ? 6.3 : 8
  const spacing = Math.min(0.2, Math.min(sec.bw, sec.h), 12 * phiL)
  const stirrups = {
    phi: phiTmm / 1000,
    spacing,
    spec: `φ${phiTmm % 1 === 0 ? phiTmm.toFixed(0) : phiTmm} c/ ${Math.round(spacing * 100)}`,
  }

  if (!best) {
    notes.push('Nenhum arranjo até ρ=4% atende — aumente a seção do pilar.')
    return {
      arrangement: null,
      utilization: bestUtil,
      governing,
      rho: 0,
      stirrups,
      notes,
      ok: false,
    }
  }
  return {
    arrangement: best,
    utilization: bestUtil,
    governing,
    rho: best.as / ac,
    stirrups,
    notes,
    ok: true,
  }
}
