/**
 * Regiões especiais — NBR 6118 §22 (bielas e tirantes, métodos clássicos
 * CEB/Leonhardt apud Bastos/UNESP e Araújo):
 *
 * VIGA-PAREDE (§22.4): l/h < 2 (biapoiada) ou < 3 (contínua). Braço de
 * alavanca (CEB): biapoiada z = 0,2·(l + 2h) se 1 ≤ l/h < 2; z = 0,6·l se
 * l/h < 1; contínua z = 0,2·(l + 1,5h). Tirante As = Md/(z·fyd) CONCENTRADO
 * na base (faixa de 0,15·h), armadura de alma em malha nas 2 faces e
 * verificação da biela/apoio (§22.4.4).
 *
 * CONSOLO (§22.5): curto (0,5 ≤ a/d ≤ 1) por biela-tirante com z = 0,8·d;
 * muito curto (a/d < 0,5) por atrito-cisalhamento (μ = 1,4 monolítico);
 * a/d > 1 = viga em balanço comum. Hd ≥ 0,2·Fd obrigatório; costura
 * As,cost = 0,4·As,tir em estribos horizontais nos 2/3 superiores de d.
 */
import { designBeamFlexure } from './beamDesign'

export interface DeepBeamInput {
  span: number
  h: number
  bw: number
  /** momento de cálculo no vão, kN·m */
  md: number
  /** reação de cálculo no apoio, kN */
  vd: number
  continuous: boolean
  fck: number
  fcd: number
  fyd: number
}
export interface DeepBeamOutput {
  isDeep: boolean
  z: number
  asTie: number
  tieSpec: string
  /** malha de alma por face, m²/m (≥ 0,075% b por face — prática §22.4.4) */
  asWebPerM: number
  /** tensão no apoio × limite (esmagamento da biela) */
  sigmaSupport: number
  sigmaLim: number
  ok: boolean
  notes: string[]
}

export function designDeepBeam(inp: DeepBeamInput): DeepBeamOutput {
  const ratio = inp.span / inp.h
  const isDeep = inp.continuous ? ratio < 3 : ratio < 2
  const notes: string[] = []
  if (!isDeep) {
    return { isDeep, z: 0, asTie: 0, tieSpec: '—', asWebPerM: 0, sigmaSupport: 0, sigmaLim: 0, ok: true, notes }
  }
  const z = inp.continuous
    ? 0.2 * (inp.span + 1.5 * inp.h)
    : ratio >= 1
      ? 0.2 * (inp.span + 2 * inp.h)
      : 0.6 * inp.span
  const asTie = inp.md / (z * inp.fyd)
  const asWebPerM = 2 * 0.00075 * inp.bw // 0,075% b POR FACE, por metro
  // apoio: biela sobre comprimento ~0,2·h limitada a 0,85·fcd (nó CCT ~ conservador)
  const sigmaSupport = inp.vd / (inp.bw * 0.2 * inp.h)
  const sigmaLim = 0.85 * (1 - inp.fck / 1000 / 250) * inp.fcd
  const ok = sigmaSupport <= sigmaLim
  notes.push(
    `VIGA-PAREDE (§22.4): l/h = ${ratio.toFixed(2)} < ${inp.continuous ? 3 : 2} — flexão substituída por tirante com z = ${z.toFixed(2)} m (CEB); As concentrada na base (0,15·h) com ancoragem TOTAL nos apoios (sem escalonar).`,
  )
  notes.push('Malha de alma nas 2 faces (≥ 0,075%·b/face por metro, horizontal e vertical) e suspensão de cargas aplicadas na parte inferior (§22.4.4).')
  if (!ok) notes.push('Esmagamento no apoio — aumentar bw/almofada de apoio ou fck.')
  return {
    isDeep,
    z,
    asTie,
    tieSpec: `${(asTie * 1e4).toFixed(1)} cm² na base`,
    asWebPerM,
    sigmaSupport,
    sigmaLim,
    ok,
    notes,
  }
}

export interface CorbelInput {
  /** carga vertical de cálculo, kN */
  fd: number
  /** distância da carga à face do pilar, m */
  a: number
  /** altura útil na raiz, m */
  d: number
  bw: number
  /** força horizontal de cálculo (≥ 0,2·Fd aplicado automaticamente), kN */
  hd?: number
  fck: number
  fcd: number
  fyd: number
}
export interface CorbelOutput {
  kind: 'muito-curto' | 'curto' | 'balanco'
  asTie: number
  /** costura: estribos horizontais nos 2/3 superiores, m² total */
  asStitch: number
  sigmaStrut: number
  sigmaLim: number
  ok: boolean
  notes: string[]
}

export function designCorbel(inp: CorbelInput): CorbelOutput {
  const notes: string[] = []
  const ad = inp.a / inp.d
  const hd = Math.max(inp.hd ?? 0, 0.2 * inp.fd) // §22.5: Hd mínimo
  const alphaV2 = 1 - inp.fck / 1000 / 250
  const sigmaLim = 0.85 * alphaV2 * inp.fcd
  if (ad > 1) {
    // balanço comum: flexão na raiz
    const md = inp.fd * inp.a + hd * 0.1
    const f = designBeamFlexure({ md, bw: inp.bw, h: inp.d + 0.05, d: inp.d, fcd: inp.fcd, fyd: inp.fyd, fck: inp.fck })
    notes.push('a/d > 1: dimensionar como VIGA EM BALANÇO comum (flexão + cisalhamento, §17/§18).')
    return { kind: 'balanco', asTie: Math.max(f.as, f.asMin), asStitch: 0, sigmaStrut: 0, sigmaLim, ok: f.ok, notes }
  }
  if (ad < 0.5) {
    // muito curto: atrito-cisalhamento, μ = 1,4 (monolítico)
    const asTie = inp.fd / (1.4 * inp.fyd) + hd / inp.fyd
    const tau = inp.fd / (inp.bw * inp.d)
    const tauLim = Math.min(0.27 * alphaV2 * inp.fcd, 8000)
    notes.push('a/d < 0,5: consolo MUITO CURTO — atrito-cisalhamento (μ = 1,4 monolítico), tirante ancorado com alça/barra soldada.')
    const asStitch = 0.5 * asTie
    return { kind: 'muito-curto', asTie, asStitch, sigmaStrut: tau, sigmaLim: tauLim, ok: tau <= tauLim, notes }
  }
  // curto: biela-tirante, z = 0,8·d
  const z = 0.8 * inp.d
  const asTie = (inp.fd * inp.a) / (z * inp.fyd) + hd / inp.fyd
  const theta = Math.atan2(z, inp.a)
  const sigmaStrut = inp.fd / (inp.bw * 0.2 * inp.d * Math.sin(theta) ** 2)
  const asStitch = 0.4 * asTie
  notes.push(
    `Consolo CURTO (a/d = ${ad.toFixed(2)}): biela-tirante com z = 0,8·d, θ = ${((theta * 180) / Math.PI).toFixed(0)}°; tirante ancorado na extremidade (alça horizontal ou barra transversal soldada).`,
  )
  notes.push('Costura: 0,4·As,tir em estribos HORIZONTAIS nos 2/3 superiores de d (§22.5.4).')
  return { kind: 'curto', asTie, asStitch, sigmaStrut, sigmaLim, ok: sigmaStrut <= sigmaLim, notes }
}
