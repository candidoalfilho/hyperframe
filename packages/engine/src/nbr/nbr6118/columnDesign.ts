import type { Vec2 } from '../../model/types'
import { clipHalfPlane, areaCentroid } from '../../geometry/clip'
import { pointInPolygon } from '../../geometry/geometry'
import { insetRectilinear } from '../../model/columnSection'

/**
 * Dimensionamento de pilares (retangulares, circulares e em L) a
 * flexo-compressão oblíqua — NBR 6118 §17.2 (domínios) e §15.8 (esbeltez,
 * pilar-padrão).
 *
 * Método: integração da seção com bloco retangular de tensões (0,85·fcd,
 * profundidade 0,8x) e barras discretas. Para cada arranjo candidato, a curva
 * de interação (Mu, Mv) é traçada p/ o Nd de cada solicitação (varredura do
 * ângulo da linha neutra + bisseção da profundidade p/ equilíbrio de N) e a
 * utilização é a razão radial demanda/capacidade.
 *
 * Eixos da seção: u ao longo de bw, v ao longo de h (origem no centroide).
 * Mu = ∫σ·u dA (gradiente ao longo de bw) · Mv = ∫σ·v dA (ao longo de h).
 * Seções não retangulares entram pelo `polygon` (contorno no centróide);
 * círculos usam polígono de 48 lados (erro de área < 0,3%, a favor da
 * segurança).
 */

export interface ColumnSectionDef {
  /** caixa envolvente: bw ao longo de u, h ao longo de v, m */
  bw: number
  h: number
  cover: number // ao estribo, m
  fcd: number // kPa
  fyd: number // kPa
  es: number // kPa
  /** forma da seção (default 'rect') */
  shape?: 'rect' | 'circle' | 'L'
  /** contorno (u,v) centrado no centróide — default: retângulo bw×h */
  polygon?: Vec2[]
  /** área real da seção, m² (default bw·h) */
  ac?: number
  /** menor espessura (limita espaçamento do estribo), m (default min(bw,h)) */
  minDim?: number
}

/** contorno efetivo da seção */
function outlineOf(sec: ColumnSectionDef): Vec2[] {
  return (
    sec.polygon ?? [
      { x: -sec.bw / 2, y: -sec.h / 2 },
      { x: sec.bw / 2, y: -sec.h / 2 },
      { x: sec.bw / 2, y: sec.h / 2 },
      { x: -sec.bw / 2, y: sec.h / 2 },
    ]
  )
}

/** área efetiva da seção */
function areaOf(sec: ColumnSectionDef): number {
  return sec.ac ?? sec.bw * sec.h
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

/** espaçamento livre mínimo entre barras: max(20 mm, φ, 1,2·d_agregado≈23 mm) */
function minClearOf(phi: number): number {
  return Math.max(0.02, phi, 0.023)
}

/** verifica espaçamento livre mínimo entre todas as barras */
function clearanceOk(pos: Vec2[], phi: number): boolean {
  const minClear = minClearOf(phi)
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y)
      if (d < minClear + phi) return false
    }
  }
  return true
}

/** n barras em anel (seção circular) — mínimo 6 (§18.4.2.1) */
function placeBarsCircle(sec: ColumnSectionDef, n: number, phi: number): Vec2[] | null {
  if (n < 6) return null
  const rb = sec.bw / 2 - sec.cover - STIRRUP_PHI - phi / 2
  if (rb <= 0.02) return null
  const pos: Vec2[] = []
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 + (2 * Math.PI * k) / n
    pos.push({ x: rb * Math.cos(a), y: rb * Math.sin(a) })
  }
  return clearanceOk(pos, phi) ? pos : null
}

/**
 * n barras no contorno recuado de seção retilínea (L): uma barra em cada
 * vértice (§18.4.2.1) e as demais nos maiores vãos do perímetro.
 */
function placeBarsPolygon(sec: ColumnSectionDef, n: number, phi: number): Vec2[] | null {
  const outline = sec.polygon
  if (!outline || n < outline.length) return null
  const inset = insetRectilinear(outline, sec.cover + STIRRUP_PHI + phi / 2)
  // extensões degeneradas (aba mais fina que 2·(cobrimento+estribo+φ/2))
  for (let i = 0; i < inset.length; i++) {
    const p = inset[i]
    const q = inset[(i + 1) % inset.length]
    if (Math.hypot(q.x - p.x, q.y - p.y) < 0.005) return null
  }
  // posições por comprimento de arco: vértices primeiro, extras nos maiores vãos
  const sVerts: number[] = []
  let per = 0
  for (let i = 0; i < inset.length; i++) {
    sVerts.push(per)
    const q = inset[(i + 1) % inset.length]
    per += Math.hypot(q.x - inset[i].x, q.y - inset[i].y)
  }
  const sAll = [...sVerts].sort((a, b) => a - b)
  let extra = n - inset.length
  while (extra > 0) {
    // maior vão entre posições consecutivas (fechando o anel)
    let bestGap = -1
    let bestAt = 0
    for (let i = 0; i < sAll.length; i++) {
      const s0 = sAll[i]
      const s1 = i + 1 < sAll.length ? sAll[i + 1] : sAll[0] + per
      if (s1 - s0 > bestGap) {
        bestGap = s1 - s0
        bestAt = i
      }
    }
    const s0 = sAll[bestAt]
    const s1 = bestAt + 1 < sAll.length ? sAll[bestAt + 1] : sAll[0] + per
    sAll.push(((s0 + s1) / 2) % per)
    sAll.sort((a, b) => a - b)
    extra--
  }
  // arco → ponto
  const pointAt = (s: number): Vec2 => {
    let acc = 0
    for (let i = 0; i < inset.length; i++) {
      const p = inset[i]
      const q = inset[(i + 1) % inset.length]
      const l = Math.hypot(q.x - p.x, q.y - p.y)
      if (s <= acc + l + 1e-9) {
        const t = l < 1e-12 ? 0 : (s - acc) / l
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
      }
      acc += l
    }
    return { ...inset[0] }
  }
  const pos = sAll.map(pointAt)
  return clearanceOk(pos, phi) ? pos : null
}

/** distribui n barras no perímetro (cantos + faces, proporcional aos lados) */
export function placeBars(sec: ColumnSectionDef, n: number, phi: number): Vec2[] | null {
  if (sec.shape === 'circle') return placeBarsCircle(sec, n, phi)
  if (sec.shape === 'L') return placeBarsPolygon(sec, n, phi)
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
  return clearanceOk(pos, phi) ? pos : null
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
  const outline = outlineOf(sec)
  let sMax = -Infinity
  let sMin = Infinity
  for (const p of outline) {
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
  const comp = clipHalfPlane(outline, { x: -w.x, y: -w.y }, -cBlock)
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
  const ac = areaOf(sec)
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
  /** raio de giração i = √(I/A), m — default retangular hDir/√12 */
  i?: number
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
  const lambda = inp.le / (inp.i ?? inp.hDir / Math.sqrt(12))
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

/**
 * Aproveitamento de um arranjo de barras frente às solicitações: maior razão
 * radial na curva de interação (≤ 1 atende). `feasible` = false quando algum
 * Nd está fora da capacidade da seção com essas barras.
 */
export function evaluateArrangement(
  sec: ColumnSectionDef,
  bars: BarArrangement,
  demands: ColumnDemandPoint[],
): { utilization: number; governing: string; feasible: boolean } {
  let worst = 0
  let governing = ''
  const cache = new Map<number, Vec2[] | null>()
  for (const d of demands) {
    // mesmos degraus de 25 kN do dimensionamento (reaproveita curvas)
    const key = Math.round(d.nd / 25) * 25
    let curve = cache.get(key)
    if (curve === undefined) {
      curve = interactionCurve(sec, bars, key)
      cache.set(key, curve)
    }
    if (!curve) return { utilization: Infinity, governing: `${d.label} (Nd fora da capacidade)`, feasible: false }
    const u = radialUtilization(curve, d.mu, d.mv)
    if (u > worst) {
      worst = u
      governing = d.label
    }
  }
  return { utilization: worst, governing, feasible: true }
}

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
/** circular: mínimo 6 barras; L: uma barra por vértice (6) — §18.4.2.1 */
const CANDIDATE_NS_ROUND = [6, 8, 10, 12, 16, 20]

export function designColumnSection(
  sec: ColumnSectionDef,
  demands: ColumnDemandPoint[],
  asMinAbs: number,
): ColumnDesignOutput {
  const ac = areaOf(sec)
  const notes: string[] = []

  // candidatos ordenados por As
  const candidates: BarArrangement[] = []
  const ns = sec.shape === 'circle' || sec.shape === 'L' ? CANDIDATE_NS_ROUND : CANDIDATE_NS
  for (const phi of CANDIDATE_PHIS) {
    for (const n of ns) {
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
  const spacing = Math.min(0.2, sec.minDim ?? Math.min(sec.bw, sec.h), 12 * phiL)
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
