import type { ColumnSection, SectionRect, Vec2 } from '../model/types'

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
  /** apoio na base (engaste ou molas) */
  support: boolean
  /**
   * Molas de apoio [kx, ky, kz, krx, kry, krz] (kN/m, kN·m/rad) — interação
   * solo-estrutura. Valor ≤ 0 = GDL prescrito (engastado). Ausente = engaste
   * total.
   */
  springs?: number[]
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
  /** caixa envolvente da seção (bw×h); seções não retangulares trazem `props` */
  section: SectionRect
  /** propriedades reais (círculo/L): área, inércias, torção e perímetro de fôrma */
  props?: { A: number; Iy: number; Iz: number; J: number; perimeter: number }
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
  /** cargas de vento geradas (se habilitado) — já compostas com o desaprumo */
  wind: WindDirectionLoads[] | null
  /** desaprumo global (NBR 6118 §11.3.3.4.1) aplicado às ações laterais */
  imperfections: {
    theta1: number
    thetaA: number
    /** momento de tombamento característico do desaprumo, kN·m */
    baseMoment: number
    rules: {
      dir: 'XP' | 'XN' | 'YP' | 'YN'
      rule: 'somente-vento' | 'somente-desaprumo' | 'vento+desaprumo'
      /** momento de tombamento característico do vento puro, kN·m */
      mWind: number
    }[]
  } | null
  /** carga vertical total característica por nível (G, Q), kN — p/ γz */
  levelWeights: { levelIndex: number; z: number; G: number; Q: number }[]
  /** molas de Winkler dos baldrames (nó, rigidez kz e área de contato) */
  winkler: { nodeId: number; kz: number; area: number }[] | null
  /** ks efetivo dos baldrames, kN/m³ (null = sem baldrames) */
  winklerKs: number | null
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

/** majoração aproximada de 2ª ordem global 0,95·γz (NBR 6118 §15.7.2) */
export interface SecondOrderResult {
  applied: boolean
  /** fator aplicado aos casos de vento por direção (1,0 = sem majoração) */
  factors: { dir: 'X+' | 'X-' | 'Y+' | 'Y-'; gammaZ: number; factor: number }[]
  notes: string[]
}

export interface StabilityResults {
  gammaZ: GammaZResult[]
  alpha: AlphaResult[]
  drift: DriftResult[]
  secondOrder: SecondOrderResult
}

// ---------------------------------------------------------------------------
// Dimensionamento de vigas (NBR 6118)
// ---------------------------------------------------------------------------

export interface FlexureDesign {
  /** momento de cálculo, kN·m (>0) */
  md: number
  /** área de aço necessária, m² */
  as: number
  /** área de aço efetiva do arranjo escolhido, m² */
  asProvided: number
  /** área de aço mínima, m² */
  asMin: number
  /** profundidade relativa da LN */
  xd: number
  /** arranjo sugerido, ex.: "3 φ 12.5" */
  bars: string
  barsN: number
  /**
   * negativos: distâncias do apoio, pela ENVOLTÓRIA de Mz do vão —
   * cutZero = ponto de momento nulo; cutHalf = ponto onde |M| cai a 50%
   * do momento do apoio (escalonamento). Ausentes p/ positivos.
   */
  cutZero?: number
  cutHalf?: number
  /** m */
  barsPhi: number
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

/** torção (NBR 6118 §17.5) — seção vazada equivalente, θ = 45° */
export interface TorsionDesign {
  /** momento torçor de cálculo (envoltória), kN·m */
  td: number
  /** espessura da parede equivalente, m */
  he: number
  /** resistência da biela: TRd2, kN·m */
  trd2: number
  /** estribos adicionais (1 ramo): A90/s, m²/m */
  a90S: number
  /** armadura longitudinal adicional total, m² */
  asl: number
  /** interação biela: Vd/VRd2 + Td/TRd2 ≤ 1 */
  interaction: number
  ok: boolean
  /** torção desprezível (Td < limite de compatibilidade) */
  negligible: boolean
}

/** armadura de pele (§17.3.5.2.3) — obrigatória p/ h > 60 cm */
export interface SkinReinforcement {
  required: boolean
  /** As por face, m² */
  asPerFace: number
  spec: string
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
  torsion: TorsionDesign
  skin: SkinReinforcement
  /** massa de aço estimada do vão, kg */
  steelKg: number
  status: 'ok' | 'atencao' | 'falha'
}

/** dimensionamento completo do pilar (flexo-compressão oblíqua) */
export interface ColumnDesignResult {
  columnId: string
  name: string
  section: ColumnSection
  /** rótulo da seção: "25x60", "ø40", "L 50x50 t20/20" */
  sectionLabel: string
  /** solicitação governante (já com e2 e momentos mínimos) */
  nd: number
  /** momento na direção de bw (gradiente ao longo de bw), kN·m */
  mdU: number
  /** momento na direção de h, kN·m */
  mdV: number
  /** ν = Nd/(Ac·fcd) do caso governante */
  nu: number
  lambdaU: number
  lambdaV: number
  needsRigorous: boolean
  as: number
  rho: number
  bars: string
  barsN: number
  barsPhi: number
  /** posições (u ao longo de bw, v ao longo de h) p/ desenho da seção, m */
  barPositions: { x: number; y: number }[]
  stirrupSpec: string
  stirrupPhi: number
  stirrupSpacing: number
  utilization: number
  governing: string
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

export interface SlabEdgeInfo {
  fixedEndsA: 0 | 1 | 2
  fixedEndsB: 0 | 1 | 2
}

/** punção verificada num pilar interno/borda/canto (laje lisa via grelha) */
export interface SlabGridPunchingItem {
  columnId: string
  name: string
  /** força de punção de cálculo, kN */
  fsd: number
  check: import('../nbr/nbr6118/punching').PunchingOutput
  /** armadura de punção dimensionada (studs) quando τSd1 > τRd1 */
  reinf?: import('../nbr/nbr6118/punching').PunchingReinfDesign
  /** armadura contra colapso progressivo (§19.5.4): As exigido + sugestão */
  collapse: { as: number; spec: string }
}

/** dimensionamento de laje pelo método da GRELHA (qualquer contorno) */
export interface SlabGridDesign {
  /** momentos de cálculo POR METRO (grelha × 1,4·(g+q)), kN·m/m */
  mxSpan: number
  mxSupport: number
  mySpan: number
  mySupport: number
  /** armaduras por metro, m²/m + malhas escolhidas */
  asX: number
  asXSup: number
  asY: number
  asYSup: number
  specX: string
  specXSup: string
  specY: string
  specYSup: string
  deflection: number
  deflectionLimit: number
  deflectionOk: boolean
  /** punção nos pilares internos (com a reação real da grelha) */
  punching: SlabGridPunchingItem[]
  stats: { nodes: number; members: number }
  ok: boolean
  notes: string[]
}

export interface SlabDesignResultItem {
  slabId: string
  name: string
  levelName: string
  /** vãos das faixas A (ao longo da 1ª borda) e B, m */
  spanA: number
  spanB: number
  thickness: number
  rectangular: boolean
  /** tipologia da laje */
  kind: 'macica' | 'nervurada'
  /** presente apenas p/ lajes MACIÇAS retangulares (método de Marcus) */
  design: import('../nbr/nbr6118/slabDesign').SlabDesignOutput | null
  /** presente apenas p/ lajes NERVURADAS retangulares */
  ribbedDesign: import('../nbr/nbr6118/ribbedSlab').RibbedDesignOutput | null
  /** presente quando o método de lajes é GRELHA (maciças de qualquer forma) */
  gridDesign: SlabGridDesign | null
  status: 'ok' | 'atencao' | 'falha'
  notes: string[]
}

export interface FoundationResultItem {
  columnId: string
  name: string
  /** carga vertical de serviço (G+Q), kN */
  nServ: number
  kind: 'sapata' | 'bloco' | 'tubulao'
  /** houve ajuste manual (editor de fundações) */
  manual?: boolean
  /** deslocamento do CG em relação ao eixo do pilar, m */
  offset?: Vec2
  /** profundidade do topo abaixo do nível da fundação, m */
  depth?: number
  /** presente quando kind = 'sapata' */
  footing: import('../nbr/nbr6118/foundations').FootingResult | null
  /** presente quando kind = 'bloco' (estacas) */
  pileCap: import('../nbr/nbr6118/pileCaps').PileCapResult | null
  /** presente quando kind = 'tubulao' */
  caisson: import('../nbr/nbr6122/caisson').CaissonResult | null
  status: 'ok' | 'atencao' | 'falha'
}

export interface BeamCrackResult {
  /** momento na combinação frequente, kN·m */
  mFreq: number
  /** tensão na armadura (estádio II), kPa */
  sigmaS: number
  /** abertura característica estimada, m */
  wk: number
  /** limite por CAA (tab. 13.4), m */
  wkLimit: number
  ok: boolean
}

export interface StairDesignResultItem {
  regionId: string
  name: string
  levelName: string
  design: import('../nbr/nbr6118/stairs').StairDesignOutput
  status: 'ok' | 'atencao' | 'falha'
}

export interface TankDesignResultItem {
  regionId: string
  name: string
  levelName: string
  design: import('../nbr/nbr6118/tanks').TankDesignOutput
  status: 'ok' | 'atencao' | 'falha'
}

// ---------------------------------------------------------------------------
// incêndio (NBR 14432 + NBR 15200)
// ---------------------------------------------------------------------------

export interface FireCheckItem {
  element: string
  kind: 'viga' | 'laje' | 'pilar'
  /** dimensão relevante (bw/h/bmin), mm */
  dim: number
  dimRequired: number
  /** distância do eixo da armadura à face, mm */
  c1: number
  c1Required: number
  /** TRF calculado (pilares, método analítico), min */
  trf?: number
  ok: boolean
  notes: string[]
}

export interface FireCheckResults {
  enabled: boolean
  /** TRRF adotado, min */
  trrf: number
  /** TRRF sugerido pela NBR 14432 (grupo/altura) */
  trrfSuggested: number
  occupancy: string
  buildingHeight: number
  items: FireCheckItem[]
  allOk: boolean
  notes: string[]
}

/** verificação de furo em viga — NBR 6118 §13.2.5 */
export interface BeamOpeningCheckItem {
  beamId: string
  beamName: string
  openingId: string
  planName: string
  levelNames: string[]
  /** posição do centro no eixo, m */
  x: number
  width: number
  height: number
  yOffset: number
  label?: string
  conditions: { id: string; label: string; ok: boolean }[]
  status: 'dispensada' | 'verificar' | 'inadequada'
  notes: string[]
}

/** molas de fundação e recalque por pilar (interação solo-estrutura) */
export interface SoilSpringItem {
  columnId: string
  name: string
  kind: 'sapata' | 'bloco' | 'tubulao'
  /** molas de translação, kN/m */
  kv: number
  kh: number
  /** molas de rotação, kN·m/rad */
  krx: number
  kry: number
  krz: number
  /** recalque estimado na combinação quase-permanente, m */
  settlementQP: number
  notes: string[]
}

export interface SoilInteractionResults {
  enabled: boolean
  items: SoilSpringItem[]
  /** recalque máximo e distorção angular máxima entre pilares vizinhos */
  maxSettlement: number
  maxDistortion: { value: number; pair: string } | null
  notes: string[]
}

/** reações características na fundação por pilar (planta de cargas) */
export interface FoundationLoadRow {
  columnId: string
  name: string
  /** posição em planta, m */
  x: number
  y: number
  /** por caso característico (G, Q, WXP, WXN, WYP, WYN): kN, kN·m */
  cases: { caseId: CaseId; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[]
  /** envoltória de Fz nas combinações ELU, kN */
  fzEluMax: number
  /** Fz de serviço (G+Q), kN */
  fzServ: number
}

export interface BeamServiceResult {
  beamId: string
  beamName: string
  spanIndex: number
  length: number
  /** flecha elástica (pórtico, EI íntegro) na combinação quase-permanente, m */
  deltaElastic: number
  /** amplificação por fissuração (Ic/Ieq de Branson) */
  crackFactor: number
  /** flecha total: elástica × fissuração × (1 + αf fluência), m */
  deltaTotal: number
  limit: number
  ok: boolean
  /** abertura de fissuras ELS-W (§17.3.3.2), combinação frequente */
  crack: BeamCrackResult | null
}

// ---------------------------------------------------------------------------
// detalhamento (preliminar) — posições e tabela de aço
// ---------------------------------------------------------------------------

export interface RebarItem {
  /** número da posição DENTRO do elemento (N1, N2… reinicia por viga/pilar) */
  pos: number
  /** m */
  phi: number
  n: number
  unitLength: number
  totalLength: number
  kg: number
  element: string
  /** id do elemento de modelagem (filtra o quadro de ferros da prancha) */
  elementId?: string
  note?: string
}

export interface BeamDetailSpan {
  beamId: string
  beamName: string
  spanIndex: number
  length: number
  section: SectionRect
  /**
   * comprimentos são DESENVOLVIDOS (incluem pernas de gancho). pos = número
   * da posição no quadro de ferros; legStart/legEnd/leg = perna vertical do
   * gancho (m). splices/spliceLap = emendas por traspasse (§9.5.2) quando a
   * barra excede 12 m. cut = grupo escalonado (corte a 50% do momento).
   */
  positive: {
    n: number
    phi: number
    length: number
    pos?: number
    legStart?: number
    legEnd?: number
    splices?: number
    spliceLap?: number
  }
  negLeft: {
    n: number
    phi: number
    length: number
    pos?: number
    leg?: number
    cut?: { n: number; length: number; pos?: number }
  } | null
  negRight: {
    n: number
    phi: number
    length: number
    pos?: number
    leg?: number
    cut?: { n: number; length: number; pos?: number }
  } | null
  stirrup: { phi: number; spacing: number; count: number; unitLength: number; pos?: number }
}

export interface ColumnDetailInfo {
  columnId: string
  name: string
  section: ColumnSection
  sectionLabel: string
  barsN: number
  barsPhi: number
  barPositions: { x: number; y: number }[]
  stirrupPhi: number
  stirrupSpacing: number
  /** alturas dos tramos, m */
  storyHeights: number[]
  /** traspasse por tramo, m */
  lapLength: number
}

export interface SteelSummary {
  items: RebarItem[]
  byPhi: { phi: number; kg: number }[]
  totalKg: number
  /** com 10% de perdas */
  totalWithWaste: number
}

export interface DetailingResults {
  beams: BeamDetailSpan[]
  columns: ColumnDetailInfo[]
  steel: SteelSummary
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
  /** estimativa de custo (custos unitários das configurações), R$ */
  cost: {
    enabled: boolean
    concrete: number
    steel: number
    formwork: number
    total: number
    /** custo por m² de laje (área construída estrutural aproximada) */
    perSlabArea: number | null
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
  columnDesign: ColumnDesignResult[]
  slabDesign: SlabDesignResultItem[]
  foundations: FoundationResultItem[]
  beamService: BeamServiceResult[]
  stairDesign: StairDesignResultItem[]
  tankDesign: TankDesignResultItem[]
  fire: FireCheckResults
  detailing: DetailingResults
  quantities: Quantities
  /** verificação de furos em vigas (§13.2.5) */
  beamOpenings: BeamOpeningCheckItem[]
  /** interação solo-estrutura (molas e recalques) */
  soilInteraction: SoilInteractionResults
  /** planta de cargas — reações características por pilar */
  foundationLoads: FoundationLoadRow[]
  /** log de avisos da geração do modelo + análise */
  warnings: string[]
  /** duração da análise, ms */
  elapsedMs: number
}
