import { designBeamFlexure } from '../nbr/nbr6118/beamDesign'
import { pickSlabBars } from '../nbr/nbr6118/slabDesign'

/**
 * MURO DE ARRIMO à flexão (L/T invertido) — empuxo ativo de RANKINE
 * (Ka = tan²(45° − φ/2)), verificações clássicas (NBR 11682/6122 + prática
 * Moliterno/Gerscovich): TOMBAMENTO FS ≥ 1,5 · DESLIZAMENTO FS ≥ 1,5 ·
 * tensões na base ≤ σadm (resultante de preferência no núcleo central).
 * Fuste e talões dimensionados como lajes em balanço por metro (§17).
 */
export interface RetainingWallInput {
  /** altura total do muro (desnível + base), m */
  h: number
  /** espessura do fuste, m */
  stemT: number
  /** largura total da base, m */
  baseB: number
  /** comprimento da ponta (lado do desnível/talude externo), m */
  toe: number
  /** altura da base, m */
  baseH: number
  /** solo: peso específico (kN/m³) e ângulo de atrito (graus) */
  gammaSoil: number
  phiDeg: number
  /** sobrecarga no terrapleno, kN/m² */
  q: number
  sigmaAdm: number // kPa
  /** atrito base-solo (tan δ ≈ 0,5 usual) */
  mu: number
  concreteUnitWeight: number
  cover: number
  fck: number
  fcd: number
  fyd: number
}
export interface RetainingWallOutput {
  ka: number
  /** empuxo ativo total por metro, kN/m */
  ea: number
  fsOverturn: number
  fsSliding: number
  sigmaMax: number
  sigmaMin: number
  insideKern: boolean
  /** fuste: momento de cálculo na raiz e malha, por metro */
  mdStem: number
  asStem: number
  stemSpec: string
  /** talão interno (heel): momento e malha */
  mdHeel: number
  asHeel: number
  heelSpec: string
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

export function designRetainingWall(inp: RetainingWallInput): RetainingWallOutput {
  const notes: string[] = []
  const phi = (inp.phiDeg * Math.PI) / 180
  const ka = Math.tan(Math.PI / 4 - phi / 2) ** 2
  const H = inp.h
  const eaSoil = 0.5 * ka * inp.gammaSoil * H * H
  const eaQ = ka * inp.q * H
  const ea = eaSoil + eaQ
  const mOver = eaSoil * (H / 3) + eaQ * (H / 2) // sobre a ponta da base

  const heel = inp.baseB - inp.toe - inp.stemT
  const hStem = H - inp.baseH
  const gc = inp.concreteUnitWeight
  // pesos e braços (a partir da ponta externa da base)
  const parts = [
    { w: inp.stemT * hStem * gc, x: inp.toe + inp.stemT / 2 },
    { w: inp.baseB * inp.baseH * gc, x: inp.baseB / 2 },
    { w: heel * hStem * inp.gammaSoil, x: inp.toe + inp.stemT + heel / 2 },
    { w: heel * inp.q, x: inp.toe + inp.stemT + heel / 2 },
  ]
  const sumV = parts.reduce((s, p) => s + p.w, 0)
  const mRes = parts.reduce((s, p) => s + p.w * p.x, 0)
  const fsOverturn = mRes / Math.max(mOver, 1e-9)
  const fsSliding = (inp.mu * sumV) / Math.max(ea, 1e-9)

  // tensões na base: resultante com excentricidade
  const xRes = (mRes - mOver) / sumV
  const e = inp.baseB / 2 - xRes
  const insideKern = Math.abs(e) <= inp.baseB / 6
  let sigmaMax: number
  let sigmaMin: number
  if (insideKern) {
    sigmaMax = (sumV / inp.baseB) * (1 + (6 * e) / inp.baseB)
    sigmaMin = (sumV / inp.baseB) * (1 - (6 * e) / inp.baseB)
  } else {
    const c = 3 * xRes
    sigmaMax = (2 * sumV) / Math.max(c, 0.05)
    sigmaMin = 0
    notes.push('Resultante FORA do núcleo central — base parcialmente descolada; rever geometria.')
  }

  // fuste: balanço sob empuxo (raiz), por metro
  const mdStem = 1.4 * ((ka * inp.gammaSoil * hStem ** 3) / 6 + (ka * inp.q * hStem ** 2) / 2)
  const dStem = Math.max(inp.stemT - inp.cover - 0.008, 0.5 * inp.stemT)
  const fS = designBeamFlexure({ md: mdStem, bw: 1, h: inp.stemT, d: dStem, fcd: inp.fcd, fyd: inp.fyd, fck: inp.fck })
  const asStem = Math.max(fS.as, 0.0015 * inp.stemT)
  // talão interno: peso solo+q+pp p/ baixo − reação do solo (conservador: ignora reação)
  const wHeel = hStem * inp.gammaSoil + inp.q + inp.baseH * gc
  const mdHeel = (1.4 * wHeel * heel * heel) / 2
  const dB = Math.max(inp.baseH - inp.cover - 0.008, 0.5 * inp.baseH)
  const fH = designBeamFlexure({ md: mdHeel, bw: 1, h: inp.baseH, d: dB, fcd: inp.fcd, fyd: inp.fyd, fck: inp.fck })
  const asHeel = Math.max(fH.as, 0.0015 * inp.baseH)

  let status: RetainingWallOutput['status'] = 'ok'
  if (fsOverturn < 1.5 || fsSliding < 1.5 || sigmaMax > inp.sigmaAdm || !fS.ok || !fH.ok) status = 'falha'
  else if (!insideKern || fsOverturn < 2 || fsSliding < 1.8) status = 'atencao'
  if (fsOverturn < 1.5) notes.push(`Tombamento FS = ${fsOverturn.toFixed(2)} < 1,5 — alargar a base/ponta.`)
  if (fsSliding < 1.5) notes.push(`Deslizamento FS = ${fsSliding.toFixed(2)} < 1,5 — dente na base ou alargar.`)
  if (sigmaMax > inp.sigmaAdm) notes.push(`σmáx = ${sigmaMax.toFixed(0)} kPa > σadm.`)
  notes.push(`Rankine Ka = ${ka.toFixed(3)} (terrapleno horizontal, sem coesão, sem água — prever DRENAGEM: barbacãs + dreno de brita; NA atrás do muro invalida o empuxo adotado).`)
  notes.push('Face do fuste junto ao terrapleno TRACIONADA — malha principal vertical nessa face; talão interno tracionado em CIMA.')
  return {
    ka,
    ea,
    fsOverturn,
    fsSliding,
    sigmaMax,
    sigmaMin,
    insideKern,
    mdStem,
    asStem,
    stemSpec: pickSlabBars(asStem, inp.stemT),
    mdHeel,
    asHeel,
    heelSpec: pickSlabBars(asHeel, inp.baseH),
    status,
    notes,
  }
}
