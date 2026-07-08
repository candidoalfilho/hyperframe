import type { SectionRect } from '../model/types'

/**
 * Modelo de análise: pórtico espacial (6 GDL/nó) com diafragma rígido por
 * pavimento (nó mestre com ux, uy, rz).
 */

export type Vec3 = [number, number, number]

export interface ANode {
  id: number
  x: number
  y: number
  z: number
  /** índice do nível no projeto */
  levelIndex: number
  kind: 'structural' | 'master'
  /** engastado na base */
  support: boolean
}

export interface MemberRef {
  kind: 'column' | 'beam'
  /** id do elemento de modelagem (Column.id / Beam.id) */
  sourceId: string
  sourceName: string
  /** índice do vão (vigas divididas em vãos entre apoios) */
  spanIndex: number
}

export interface AMember {
  id: number
  ni: number
  nj: number
  ref: MemberRef
  section: SectionRect
  length: number
  /** eixos locais (x ao longo do membro; y "para cima" nas vigas) */
  xLocal: Vec3
  yLocal: Vec3
  zLocal: Vec3
}

/** Casos de carga fundamentais */
export type CaseId = 'G' | 'Q' | 'WXP' | 'WXN' | 'WYP' | 'WYN'
export const ALL_CASES: CaseId[] = ['G', 'Q', 'WXP', 'WXN', 'WYP', 'WYN']

export type ComboType = 'ELU' | 'ELS-QP' | 'ELS-FREQ' | 'ELS-VENTO'

export interface LoadCombo {
  id: string
  label: string
  type: ComboType
  /** fatores γ·ψ por caso */
  factors: Partial<Record<CaseId, number>>
  /** qual passe de rigidez usar: 'elu' (EI reduzido §15.7.3) ou 'els' (EI integral) */
  stiffness: 'elu' | 'els'
}

/** esforços amostrados ao longo do membro (convenção local: N, Vy, Vz, T, My, Mz) */
export interface MemberDiagrams {
  /** posições das estações, m (0 → L) */
  x: number[]
  N: number[]
  Vy: number[]
  Vz: number[]
  T: number[]
  My: number[]
  Mz: number[]
}

export interface Reaction {
  nodeId: number
  fx: number
  fy: number
  fz: number
  mx: number
  my: number
  mz: number
}

export interface CaseResult {
  /** deslocamentos globais por nó: [ux, uy, uz, rx, ry, rz] (m, rad) */
  displacements: number[][]
  /** diagramas por membro (mesmo índice de model.members) */
  memberDiagrams: MemberDiagrams[]
  reactions: Reaction[]
}

export interface WindLevelForce {
  levelIndex: number
  z: number
  /** força total aplicada no diafragma do nível, kN */
  F: number
  /** pressão dinâmica na cota, kN/m² */
  q: number
  /** área de fachada tributária, m² */
  area: number
}

export interface WindDirectionLoads {
  dir: 'XP' | 'XN' | 'YP' | 'YN'
  ca: number
  /** largura de fachada exposta, m */
  facadeWidth: number
  perLevel: WindLevelForce[]
  totalForce: number
}

export interface AnalysisModel {
  nodes: ANode[]
  members: AMember[]
  masters: { levelIndex: number; nodeId: number }[]
  /** cargas de vento geradas (se habilitado) */
  wind: WindDirectionLoads[] | null
  /** carga vertical total característica por nível (G, Q), kN — p/ γz */
  levelWeights: { levelIndex: number; z: number; G: number; Q: number }[]
  warnings: string[]
  /** estatísticas p/ relatório */
  stats: { nodes: number; members: number; dofs: number }
}

export interface GammaZResult {
  dir: 'X+' | 'X-' | 'Y+' | 'Y-'
  comboId: string
  comboLabel: string
  /** momento de tombamento de 1ª ordem, kN·m */
  m1: number
  /** ΔM = Σ P·δ, kN·m */
  deltaM: number
  value: number
  /** γz ≤ 1,10 → nós fixos; ≤ 1,30 válido p/ majoração */
  classification: 'nos-fixos' | 'nos-moveis' | 'invalido'
}

export interface AlphaResult {
  dir: 'x' | 'y'
  value: number
  limit: number
  ok: boolean
  /** rigidez equivalente usada, kN·m² */
  eiEq: number
}

export interface StoryDrift {
  levelIndex: number
  levelName: string
  z: number
  /** deslocamento horizontal do diafragma, m */
  disp: number
  /** deslocamento relativo ao pavimento inferior, m */
  rel: number
  relLimit: number
  ok: boolean
}

export interface DriftResult {
  comboId: string
  comboLabel: string
  dir: 'X+' | 'X-' | 'Y+' | 'Y-'
  topDisp: number
  topLimit: number
  stories: StoryDrift[]
  ok: boolean
}

export interface StabilityResults {
  gammaZ: GammaZResult[]
  alpha: AlphaResult[]
  drift: DriftResult[]
}

// ---------------------------------------------------------------------------
// Dimensionamento de vigas (NBR 6118)
// ---------------------------------------------------------------------------

export interface FlexureDesign {
  /** momento de cálculo, kN·m (>0) */
  md: number
  /** área de aço necessária, m² */
  as: number
  /** área de aço mínima, m² */
  asMin: number
  /** profundidade relativa da LN */
  xd: number
  /** arranjo sugerido, ex.: "3 φ 12.5" */
  bars: string
  ok: boolean
  note?: string
}

export interface ShearDesign {
  /** cortante de cálculo, kN */
  vd: number
  vrd2: number
  vc: number
  /** Asw/s necessário, m²/m */
  aswS: number
  aswSMin: number
  /** ex.: "φ5 c/ 15" */
  spec: string
  ok: boolean
  note?: string
}

export interface BeamSpanDesign {
  beamId: string
  beamName: string
  spanIndex: number
  /** comprimento do vão, m */
  length: number
  section: SectionRect
  /** flexão: momento positivo no vão e negativos nos apoios */
  positive: FlexureDesign
  negLeft: FlexureDesign | null
  negRight: FlexureDesign | null
  shear: ShearDesign
  /** massa de aço estimada do vão, kg */
  steelKg: number
  status: 'ok' | 'atencao' | 'falha'
}

export interface ColumnCheck {
  columnId: string
  name: string
  /** por trecho (nível a nível), pior caso ELU */
  nd: number
  mdx: number
  mdy: number
  /** ν = Nd/(Ac·fcd) */
  nu: number
  /** índice de esbeltez máximo */
  lambda: number
  /** As estimada (compressão simples + mínimos), m² */
  asEst: number
  status: 'ok' | 'atencao' | 'falha'
  note?: string
}

export interface Quantities {
  concrete: { columns: number; beams: number; slabs: number; total: number } // m³
  formwork: number // m²
  steel: {
    beamsDesigned: number // kg (dimensionado)
    columnsEstimated: number // kg (taxa típica)
    slabsEstimated: number // kg (taxa típica)
    total: number
    ratePerM3: number // kg/m³ global
  }
}

export interface AnalysisResults {
  model: AnalysisModel
  combos: LoadCombo[]
  /** resultados por caso fundamental, por passe de rigidez */
  cases: {
    elu: Partial<Record<CaseId, CaseResult>>
    els: Partial<Record<CaseId, CaseResult>>
  }
  /** envoltória ELU por membro (min/max de cada esforço nas estações) */
  envelopeELU: {
    N: { min: number[]; max: number[] }[]
    Vy: { min: number[]; max: number[] }[]
    Vz: { min: number[]; max: number[] }[]
    My: { min: number[]; max: number[] }[]
    Mz: { min: number[]; max: number[] }[]
    T: { min: number[]; max: number[] }[]
  }
  stability: StabilityResults
  beamDesign: BeamSpanDesign[]
  columnChecks: ColumnCheck[]
  quantities: Quantities
  /** log de avisos da geração do modelo + análise */
  warnings: string[]
  /** duração da análise, ms */
  elapsedMs: number
}
