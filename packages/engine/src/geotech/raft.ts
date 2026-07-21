import { checkPunching, type PunchingOutput } from '../nbr/nbr6118/punching'
import { designBeamFlexure } from '../nbr/nbr6118/beamDesign'
import { pickSlabBars } from '../nbr/nbr6118/slabDesign'
import type { Vec2 } from '../model/types'

/**
 * RADIER RÍGIDO (pré-dimensionamento — NBR 6122 + prática Dória/Velloso):
 * pressão LINEAR no solo pela resultante (N, ex, ey) sobre a planta A×B;
 * σmáx ≤ σadm; PUNÇÃO §19.5 em cada pilar com a carga real; flexão por
 * FAIXAS entre eixos de pilares (M ≈ σd·l²/10, contínuo — aproximação
 * documentada) com malha dupla (inferior/superior). Radier FLEXÍVEL (placa
 * sobre Winkler) fica p/ evolução.
 */
export interface RaftInput {
  /** pilares: posição + carga de serviço característica (kN) + seção */
  columns: { id: string; name: string; pos: Vec2; nServ: number; c1: number; c2: number }[]
  /** balanço da borda além dos eixos externos, m */
  overhang: number
  thickness: number
  sigmaAdm: number
  concreteUnitWeight: number
  cover: number
  fck: number
  gammaC: number
  fcd: number
  fyd: number
}
export interface RaftOutput {
  a: number
  b: number
  sigmaAvg: number
  sigmaMax: number
  ex: number
  ey: number
  /** flexão por faixa: momentos de cálculo por metro e malhas */
  mdX: number
  mdY: number
  asX: number
  asY: number
  specX: string
  specY: string
  punching: { id: string; name: string; fsd: number; check: PunchingOutput }[]
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

export function designRaft(inp: RaftInput): RaftOutput {
  const notes: string[] = []
  if (inp.columns.length < 2) throw new Error('Radier precisa de ≥ 2 pilares.')
  const xs = inp.columns.map((c) => c.pos.x)
  const ys = inp.columns.map((c) => c.pos.y)
  const x0 = Math.min(...xs) - inp.overhang
  const x1 = Math.max(...xs) + inp.overhang
  const y0 = Math.min(...ys) - inp.overhang
  const y1 = Math.max(...ys) + inp.overhang
  const a = x1 - x0
  const b = y1 - y0
  const area = a * b
  const nTot = inp.columns.reduce((s, c) => s + c.nServ, 0)
  const pp = inp.thickness * inp.concreteUnitWeight * area
  const nAll = nTot + pp
  // resultante e excentricidades (pp centrado)
  const cgx = inp.columns.reduce((s, c) => s + c.nServ * c.pos.x, 0) / nTot
  const cgy = inp.columns.reduce((s, c) => s + c.nServ * c.pos.y, 0) / nTot
  const ex = cgx - (x0 + x1) / 2
  const ey = cgy - (y0 + y1) / 2
  const sigmaAvg = nAll / area
  const sigmaMax = sigmaAvg * (1 + (6 * Math.abs(ex)) / a + (6 * Math.abs(ey)) / b)

  // vãos entre eixos de pilares por direção (maior vão governa)
  const gaps = (vals: number[]): number => {
    const u = [...new Set(vals.map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q)
    let g = 0
    for (let i = 1; i < u.length; i++) g = Math.max(g, u[i] - u[i - 1])
    return Math.max(g, 1)
  }
  const lx = gaps(xs)
  const ly = gaps(ys)
  const sigmaD = 1.4 * (sigmaAvg - inp.thickness * inp.concreteUnitWeight) // líquida p/ flexão
  const mdX = (sigmaD * lx * lx) / 10
  const mdY = (sigmaD * ly * ly) / 10
  const d = Math.max(inp.thickness - inp.cover - 0.02, 0.5 * inp.thickness)
  const flex = (md: number) => {
    const f = designBeamFlexure({ md, bw: 1, h: inp.thickness, d, fcd: inp.fcd, fyd: inp.fyd, fck: inp.fck })
    return { as: Math.max(f.as, 0.0015 * inp.thickness), ok: f.ok }
  }
  const fX = flex(mdX)
  const fY = flex(mdY)

  // punção por pilar (carga real de cálculo)
  const rho = Math.min(Math.max(fX.as, fY.as) / d, 0.02)
  const punching = inp.columns.map((c) => ({
    id: c.id,
    name: c.name,
    fsd: 1.4 * c.nServ,
    check: checkPunching({
      fsd: 1.4 * c.nServ,
      column: { shape: 'rect' as const, c1: c.c1, c2: c.c2 },
      d,
      rhoX: rho,
      rhoY: rho,
      fck: inp.fck,
      gammaC: inp.gammaC,
    }),
  }))
  const punchFail = punching.some((p) => !p.check.okC || p.check.needsShearReinf)

  let status: RaftOutput['status'] = 'ok'
  if (sigmaMax > inp.sigmaAdm || !fX.ok || !fY.ok || punching.some((p) => !p.check.okC)) status = 'falha'
  else if (punchFail || sigmaMax > 0.9 * inp.sigmaAdm) status = 'atencao'
  if (sigmaMax > inp.sigmaAdm) notes.push(`σmáx = ${sigmaMax.toFixed(0)} kPa > σadm = ${inp.sigmaAdm.toFixed(0)}.`)
  notes.push('Método RÍGIDO com faixas (M ≈ σd·l²/10 contínuo) — pré-dimensionamento; radier flexível (placa sobre Winkler) e recalques diferenciais exigem análise dedicada (NBR 6122).')
  notes.push('Malha DUPLA (inferior e superior) nas 2 direções; verificar punção com armadura §19.5.3 onde indicado.')
  return {
    a,
    b,
    sigmaAvg,
    sigmaMax,
    ex,
    ey,
    mdX,
    mdY,
    asX: fX.as,
    asY: fY.as,
    specX: pickSlabBars(fX.as, inp.thickness),
    specY: pickSlabBars(fY.as, inp.thickness),
    punching,
    status,
    notes,
  }
}
