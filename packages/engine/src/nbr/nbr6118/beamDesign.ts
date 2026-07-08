/**
 * NBR 6118:2023 — dimensionamento de vigas retangulares de concreto armado:
 * flexão simples (§17.2, bloco retangular) e força cortante — modelo I (§17.4.2).
 * Válido p/ fck ≤ 50 MPa. Unidades: m, kN, kN·m, kPa.
 */

import type {
  BeamFlexureInput,
  BeamFlexureOutput,
  BeamShearInput,
  BeamShearOutput,
} from '../api'
import { BAR_DIAMETERS } from '../../model/presets'

// ---------------------------------------------------------------------------
// Flexão simples
// ---------------------------------------------------------------------------

/**
 * NBR 6118 tab. 17.3 — taxa mínima de armadura de flexão ρmin (ωmin = 0,035,
 * seção retangular, CA-50). Interpolação linear entre classes; clamp fora.
 */
const RHO_MIN: { fckMPa: number; rho: number }[] = [
  { fckMPa: 30, rho: 0.0015 }, // C20–C30 → 0,150%
  { fckMPa: 35, rho: 0.00164 },
  { fckMPa: 40, rho: 0.00179 },
  { fckMPa: 45, rho: 0.00194 },
  { fckMPa: 50, rho: 0.00208 },
]

function rhoMin(fckMPa: number): number {
  const first = RHO_MIN[0]
  const last = RHO_MIN[RHO_MIN.length - 1]
  if (fckMPa <= first.fckMPa) return first.rho
  if (fckMPa >= last.fckMPa) return last.rho
  for (let i = 0; i < RHO_MIN.length - 1; i++) {
    const a = RHO_MIN[i]
    const b = RHO_MIN[i + 1]
    if (fckMPa <= b.fckMPa) {
      const t = (fckMPa - a.fckMPa) / (b.fckMPa - a.fckMPa)
      return a.rho + t * (b.rho - a.rho)
    }
  }
  return last.rho
}

/**
 * Flexão simples com bloco retangular de tensões (NBR 6118 §17.2.2):
 *   Md = 0,85·fcd·bw·0,8x·(d − 0,4x)  →  resolver x (menor raiz da quadrática)
 *   As = Md / (fyd·(d − 0,4x))
 * Limite de dutilidade x/d ≤ 0,45 (§14.6.4.3, fck ≤ 50 MPa).
 * O `as` retornado é o calculado — o chamador aplica max(as, asMin).
 */
export function designBeamFlexure(input: BeamFlexureInput): BeamFlexureOutput {
  const { md, bw, h, d, fcd, fyd, fck } = input
  const asMin = rhoMin(fck / 1000) * bw * h

  // momento desprezível — sem armadura calculada (mínimos a cargo do chamador)
  if (md < 0.1) {
    return { as: 0, asMin, xd: 0, ok: true }
  }

  // 0,85·fcd·bw·0,8·x·(d − 0,4x) = Md  →  0,4c·x² − c·d·x + Md = 0, c = 0,85·fcd·bw·0,8
  const c = 0.85 * fcd * bw * 0.8
  const a = 0.4 * c
  const b = -c * d
  const disc = b * b - 4 * a * md
  const noteFail = 'seção insuficiente — aumente a seção ou use armadura dupla'

  if (disc < 0) {
    // sem raiz real — Md acima da capacidade da seção; As estimada c/ x = 0,45d
    // (melhor esforço) e x/d reportado como 1 (LN além do limite útil)
    const xLim = 0.45 * d
    const as = md / (fyd * (d - 0.4 * xLim))
    return { as, asMin, xd: 1, ok: false, note: noteFail }
  }

  const x = (-b - Math.sqrt(disc)) / (2 * a) // menor raiz (ramo físico)
  const xd = x / d

  if (xd > 0.45) {
    // dutilidade violada (§14.6.4.3) — As estimada c/ x = 0,45d como melhor esforço
    const xLim = 0.45 * d
    const as = md / (fyd * (d - 0.4 * xLim))
    return { as, asMin, xd, ok: false, note: noteFail }
  }

  const as = md / (fyd * (d - 0.4 * x))
  return { as, asMin, xd, ok: true }
}

// ---------------------------------------------------------------------------
// Cisalhamento — modelo I
// ---------------------------------------------------------------------------

/**
 * NBR 6118 §17.4.2.2 — modelo I (θ = 45°):
 *   VRd2 = 0,27·αv2·fcd·bw·d, αv2 = 1 − fck[MPa]/250
 *   Vc   = 0,6·fctd·bw·d
 *   Asw/s = (Vd − Vc)/(0,9·d·fywd) ≥ 0, fywd ≤ 435 MPa
 *   ρsw,min = 0,2·fctm/fywk (§17.4.1.1) → (Asw/s)min = ρsw,min·bw
 *   smax (§18.3.3.2): 0,6d ≤ 300 mm se Vd ≤ 0,67·VRd2; senão 0,3d ≤ 200 mm
 */
export function designBeamShear(input: BeamShearInput): BeamShearOutput {
  const { vd, bw, d, fck, fcd, fctd, fctm, fywk } = input
  // §17.4.2.2c — tensão na armadura transversal limitada a 435 MPa
  const fywd = Math.min(input.fywd, 435_000)

  const alphaV2 = 1 - fck / 1000 / 250
  const vrd2 = 0.27 * alphaV2 * fcd * bw * d
  const vc = 0.6 * fctd * bw * d
  const aswS = Math.max(0, (vd - vc) / (0.9 * d * fywd))
  const aswSMin = 0.2 * (fctm / fywk) * bw
  const sMax = vd <= 0.67 * vrd2 ? Math.min(0.6 * d, 0.3) : Math.min(0.3 * d, 0.2)

  return { vrd2, vc, aswS, aswSMin, sMax, ok: vd <= vrd2 }
}

// ---------------------------------------------------------------------------
// Escolha de barras
// ---------------------------------------------------------------------------

/** estribo assumido na verificação de largura útil, m (φt = 6,3 mm) */
const STIRRUP_PHI = 0.0063

function areaOf(phi: number): number {
  return (Math.PI * phi * phi) / 4
}

/** 0.0125 → "12.5" · 0.016 → "16" */
function fmtMm(phi: number): string {
  return Number((phi * 1000).toFixed(1)).toString()
}

/**
 * NBR 6118 §18.3.2.2 — espaçamento livre horizontal ≥ max(20 mm, φ)
 * (agregado não considerado). Verifica se nPerLayer barras cabem na largura útil.
 */
function layerFits(nPerLayer: number, phi: number, usableWidth: number): boolean {
  const gap = Math.max(0.02, phi)
  const needed = nPerLayer * phi + (nPerLayer - 1) * gap
  return needed <= usableWidth
}

/**
 * Escolha de barras comerciais para As requerida (m²) numa viga de largura bw
 * com cobrimento `cover` e estribo φ6,3. Prefere 1 camada com 2–6 barras e a
 * menor área provida; se nada couber, admite 2 camadas (até 12 barras,
 * verificação de largura com ceil(n/2) barras por camada).
 */
export function pickBars(
  asRequired: number,
  bw: number,
  cover: number,
): { spec: string; asProvided: number; n: number; phi: number } {
  if (asRequired <= 0) {
    return { spec: '—', asProvided: 0, n: 0, phi: 0 }
  }

  // largura útil entre faces internas dos estribos
  const usable = bw - 2 * cover - 2 * STIRRUP_PHI

  let best: { spec: string; asProvided: number; n: number; phi: number } | null = null

  // 1ª tentativa: camada única, 2 ≤ n ≤ 6
  for (const phi of BAR_DIAMETERS) {
    const n = Math.max(2, Math.ceil(asRequired / areaOf(phi)))
    if (n > 6) continue
    if (!layerFits(n, phi, usable)) continue
    const asProvided = n * areaOf(phi)
    if (!best || asProvided < best.asProvided) {
      best = { spec: `${n} φ ${fmtMm(phi)}`, asProvided, n, phi }
    }
  }
  if (best) return best

  // 2ª tentativa: 2 camadas, n ≤ 12 (ceil(n/2) barras por camada)
  for (const phi of BAR_DIAMETERS) {
    const n = Math.max(2, Math.ceil(asRequired / areaOf(phi)))
    if (n > 12) continue
    if (!layerFits(Math.ceil(n / 2), phi, usable)) continue
    const asProvided = n * areaOf(phi)
    if (!best || asProvided < best.asProvided) {
      best = { spec: `${n} φ ${fmtMm(phi)} (2 camadas)`, asProvided, n, phi }
    }
  }
  if (best) return best

  // melhor esforço: nada coube — maior bitola em 2 camadas (revisar a seção)
  const phi = BAR_DIAMETERS[BAR_DIAMETERS.length - 1]
  const n = Math.max(2, Math.ceil(asRequired / areaOf(phi)))
  return { spec: `${n} φ ${fmtMm(phi)} (2 camadas)`, asProvided: n * areaOf(phi), n, phi }
}
