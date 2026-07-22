/**
 * HyperFrame — modelo de dados do edifício.
 *
 * UNIDADES INTERNAS (SI):
 *  - comprimento: m
 *  - força: kN
 *  - momento: kN·m
 *  - tensão / módulo E: kPa (kN/m²)  →  1 MPa = 1000 kPa
 *  - carga linear: kN/m · carga de área: kN/m²
 *  - peso específico: kN/m³
 * A UI converte para cm / MPa apenas na borda (inputs e labels).
 */

export interface Vec2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Grelha de eixos (como em plantas de forma: eixos verticais A,B,C… em x
// e horizontais 1,2,3… em y)
// ---------------------------------------------------------------------------

export interface GridAxis {
  id: string
  label: string
  /** posição do eixo, m (x para eixos verticais, y para horizontais) */
  pos: number
}

export interface Grid {
  /** eixos verticais (constantes em x), rotulados A, B, C… */
  xAxes: GridAxis[]
  /** eixos horizontais (constantes em y), rotulados 1, 2, 3… */
  yAxes: GridAxis[]
}

// ---------------------------------------------------------------------------
// Níveis e plantas
// ---------------------------------------------------------------------------

export interface Level {
  id: string
  name: string
  /** cota do plano estrutural (topo do pavimento), m */
  elevation: number
  /** planta de forma usada neste nível (null = sem vigas/lajes, ex.: fundação) */
  planId: string | null
}

/** Seção retangular. bw = largura (base), h = altura (na direção de maior inércia p/ vigas). Em m. */
export interface SectionRect {
  bw: number
  h: number
}

/** Seção circular de pilar (diâmetro, m) */
export interface SectionCircle {
  shape: 'circle'
  d: number
}

/**
 * Seção em L: caixa envolvente b×h com abas de espessura tb (aba vertical,
 * ao longo de b) e th (aba horizontal, ao longo de h). Em m.
 */
export interface SectionLShape {
  shape: 'L'
  b: number
  h: number
  tb: number
  th: number
}

/** Seção de pilar: retangular (shape ausente em arquivos antigos), circular ou em L */
export type ColumnSection = ({ shape?: 'rect' } & SectionRect) | SectionCircle | SectionLShape

export interface Column {
  id: string
  /** P1, P2… */
  name: string
  /** posição do CENTRÓIDE da seção em planta, m */
  pos: Vec2
  section: ColumnSection
  /**
   * 0   → dimensão `h` da seção ao longo do eixo global X
   * 90  → dimensão `h` ao longo do eixo global Y
   * 180/270 → idem, invertidos (relevante p/ seções em L)
   */
  rotationDeg: 0 | 90 | 180 | 270
  /** nível da base (normalmente a fundação) */
  baseLevelId: string
  /** nível do topo (normalmente o último pavimento) */
  topLevelId: string
  /** consolos (§22.5) pendurados no pilar */
  corbels?: CorbelDef[]
}

/** consolo curto no pilar: geometria + carga de cálculo (§22.5) */
export interface CorbelDef {
  id: string
  /** nível do topo do consolo */
  levelId: string
  /** face: 0 = +X, 90 = +Y, 180 = −X, 270 = −Y */
  rotationDeg: 0 | 90 | 180 | 270
  /** largura, m */
  bw: number
  /** altura útil na raiz, m */
  d: number
  /** distância da carga à face do pilar, m */
  a: number
  /** carga vertical de CÁLCULO, kN */
  fd: number
  hd?: number
  /** altura da PONTA (perfil trapezoidal); ausente = 0,5·(d+5cm), ≥ h/2 §22.5 */
  tipH?: number
}

/**
 * Furo/abertura que atravessa a viga na direção da largura —
 * verificação de dispensa pela NBR 6118 §13.2.5.2.
 */
export interface BeamOpening {
  id: string
  /** posição do CENTRO do furo ao longo do eixo da viga (desde o 1º vértice), m */
  x: number
  /** comprimento do furo ao longo do eixo, m */
  width: number
  /** altura do furo, m */
  height: number
  /** desvio do centro do furo em relação ao meio da altura da viga (+ p/ cima), m */
  yOffset: number
  label?: string
}

export interface Beam {
  id: string
  /** V1, V2… */
  name: string
  /** polilinha (≥ 2 vértices), m. Cada trecho entre apoios vira um vão na análise. */
  path: Vec2[]
  section: SectionRect
  /**
   * Seção por trecho da polilinha (mesmo índice dos segmentos; null/ausente =
   * usa `section`). Mudança de seção corta o vão de dimensionamento no ponto.
   */
  segmentSections?: (SectionRect | null)[]
  /** furos que atravessam a alma (NBR 6118 §13.2.5) */
  openings?: BeamOpening[]
}

/**
 * Laje nervurada moldada in loco (NBR 6118 §13.2.4.2). A espessura da laje
 * (`Slab.thickness`) é a altura TOTAL (capa + nervura).
 */
export interface RibbedParams {
  /** direções das nervuras: bidirecional ou unidirecional */
  dirs: 'xy' | 'x' | 'y'
  /** largura da nervura (bw), m */
  ribWidth: number
  /** espaçamento entre EIXOS de nervuras, m */
  spacing: number
  /** espessura da capa (mesa), m */
  topping: number
  /** peso específico do enchimento entre nervuras, kN/m³ (0 = forma removível/vazio) */
  fillerWeight: number
  label?: string
}

export interface Slab {
  id: string
  /** L1, L2… */
  name: string
  /** polígono fechado (sem repetir o 1º ponto), sentido anti-horário, m */
  polygon: Vec2[]
  /** espessura (altura total), m */
  thickness: number
  /** revestimento + contrapiso etc. (permanente g2), kN/m² */
  finishLoad: number
  /** sobrecarga de utilização (variável q), kN/m² — NBR 6120 */
  liveLoad: number
  /** rótulo do preset de uso (ex.: "Residencial — dormitórios") */
  liveLoadLabel?: string
  /** laje nervurada (ausente = maciça) */
  ribbed?: RibbedParams
}

/**
 * Carga linear permanente sobre uma viga (alvenaria etc.), kN/m.
 * `x0`/`x1` (m, medidos ao longo do eixo desde o 1º vértice) limitam a carga a
 * um trecho; ausentes = viga inteira.
 */
export interface WallLoad {
  id: string
  beamId: string
  w: number
  x0?: number
  x1?: number
  label?: string
}

/** Geometria do lance p/ dimensionamento da escada (região kind 'escada') */
export interface StairParams {
  /** espessura da laje do lance (mísula/waist), m */
  waist: number
  /** espelho do degrau, m */
  riser: number
  /** piso (passo) do degrau, m */
  tread: number
  /** revestimento sobre a escada, kN/m² */
  finish: number
  /** vão do lance entre apoios, m (0/ausente = automático: maior lado do retângulo envolvente) */
  span?: number
  /** inverte o sentido de subida do lance (visualização 3D) */
  reverse?: boolean
  /** abre furo na laje deste pavimento sob a escada (default: true) */
  opening?: boolean
  /** tipologia: lance reto (default), L ou U com patamar */
  kind?: 'reto' | 'L' | 'U'
  /** profundidade do patamar (L/U), m */
  landingDepth?: number
}

/** Geometria p/ dimensionamento de reservatório retangular apoiado (kind 'reservatorio') */
export interface TankParams {
  /** lâmina d'água máxima, m */
  waterHeight: number
  /** espessura das paredes, m */
  wallThickness: number
  /** espessura da laje de fundo, m */
  bottomThickness: number
  /** espessura da tampa, m */
  topThickness: number
}

/**
 * Região sobre lajes: carga adicional (escada, reservatório/caixa d'água,
 * equipamento…) ou FURO/abertura (shaft, elevador — remove a laje na área).
 * Cargas são distribuídas às lajes sobrepostas proporcionalmente à área de
 * interseção; furos descontam peso próprio/revestimento/sobrecarga da laje.
 * Escadas abrem furo na laje do próprio pavimento por padrão (stair.opening)
 * e também são dimensionadas como elementos próprios (stair/tank).
 */
export interface LoadRegion {
  id: string
  name: string
  kind: 'escada' | 'reservatorio' | 'generica' | 'furo'
  polygon: Vec2[]
  /** permanente adicional, kN/m² */
  g: number
  /** variável adicional, kN/m² */
  q: number
  label?: string
  /** parâmetros do lance (apenas kind 'escada'; ausente = defaults) */
  stair?: StairParams
  /** parâmetros do reservatório (apenas kind 'reservatorio'; ausente = defaults) */
  tank?: TankParams
}

export interface FloorPlan {
  id: string
  name: string
  beams: Beam[]
  slabs: Slab[]
  wallLoads: WallLoad[]
  loadRegions: LoadRegion[]
}

/** entidade de underlay importada de DXF (coordenadas já em m, após escala) */
export interface UnderlayEntity {
  type: 'line' | 'polyline' | 'circle' | 'arc' | 'text'
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  points?: Vec2[]
  closed?: boolean
  cx?: number
  cy?: number
  r?: number
  /** ângulos do arco, graus */
  a1?: number
  a2?: number
  x?: number
  y?: number
  text?: string
  height?: number
  rotation?: number
  layer?: string
}

export interface DxfUnderlay {
  entities: UnderlayEntity[]
  /** fator aplicado sobre as coordenadas do arquivo (ex.: 0,01 p/ desenho em cm) */
  scale: number
  offset: Vec2
  visible: boolean
  opacity: number
  fileName?: string
}

// ---------------------------------------------------------------------------
// Materiais e parâmetros normativos
// ---------------------------------------------------------------------------

export type Aggregate = 'basalto' | 'granito' | 'calcario' | 'arenito'

export interface ConcreteMaterial {
  /** resistência característica, kPa (ex.: C30 → 30000) */
  fck: number
  aggregate: Aggregate
  gammaC: number
}

export interface SteelMaterial {
  /** kPa (CA-50 → 500000) */
  fyk: number
  gammaS: number
  /** módulo de elasticidade do aço, kPa (210e6) */
  Es: number
}

/** Classe de agressividade ambiental — NBR 6118 tabela 6.1 */
export type CAA = 'I' | 'II' | 'III' | 'IV'

export type WindCategory = 1 | 2 | 3 | 4 | 5
export type WindClass = 'A' | 'B' | 'C'

export interface WindParams {
  enabled: boolean
  /** velocidade básica V0, m/s (isopletas NBR 6123) */
  v0: number
  /** fator topográfico */
  s1: number
  /** categoria de rugosidade do terreno (I a V) */
  category: WindCategory
  /** classe da edificação (A ≤20 m, B 20–50 m, C >50 m — maior dimensão frontal) */
  windClass: WindClass
  /** grupo estatístico para S3 (2 = residencial/comercial → 1,00) */
  s3Group: 1 | 2 | 3 | 4 | 5
  /** override manual do coeficiente de arrasto por direção (senão estimado da Fig. 4) */
  caOverride?: { x?: number; y?: number }
}

export interface SoilParams {
  /** tensão admissível do solo, kPa (orientativo — exige sondagem SPT) */
  sigmaAdm: number
  label: string
}

/** Tipos de solo p/ correlações com SPT (Teixeira & Godoy; Aoki–Velloso) */
export type SoilKind =
  | 'areia'
  | 'areia-siltosa'
  | 'areia-argilosa'
  | 'silte-arenoso'
  | 'silte'
  | 'silte-argiloso'
  | 'argila-arenosa'
  | 'argila-siltosa'
  | 'argila'

/** Camada do perfil de sondagem (a partir da cota de apoio das fundações) */
export interface SoilLayerSPT {
  /** espessura da camada, m */
  thickness: number
  soil: SoilKind
  /** NSPT médio da camada */
  nspt: number
  label?: string
}

/**
 * Interação solo-estrutura: sondagem SPT → molas de apoio (CRV/CRH) nas bases
 * dos pilares e estimativa de recalques. Métodos: recalque elástico com
 * Es = α·K·NSPT (Teixeira & Godoy) p/ sapatas; Aoki–Velloso p/ estacas.
 */
export interface SoilInteractionParams {
  enabled: boolean
  /** camadas a partir da cota de apoio das fundações */
  layers: SoilLayerSPT[]
  /** profundidade do nível d'água abaixo da cota de apoio, m (null = não encontrado) */
  waterDepth: number | null
  /** CRH = chFactor·CRV quando não há ensaio específico (prática usual 0,5) */
  chFactor: number
  /** coeficiente de Poisson do solo (recalque elástico) */
  poisson: number
}

/** Custos unitários p/ estimativa (R$) */
export interface CostParams {
  enabled: boolean
  /** concreto lançado, R$/m³ */
  concretePerM3: number
  /** aço CA-50 cortado/dobrado/montado, R$/kg */
  steelPerKg: number
  /** fôrma (material + mão de obra), R$/m² */
  formworkPerM2: number
}

/** Tempo requerido de resistência ao fogo, min (NBR 14432) */
export type TRRF = 30 | 60 | 90 | 120 | 180

/** Grupos de ocupação da NBR 14432 tab. A.1 (seleção usual) */
export type OccupancyGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export interface FireParams {
  enabled: boolean
  /** TRRF manual (min) ou 'auto' — sugerido pela NBR 14432 conforme grupo/altura */
  trrf: TRRF | 'auto'
  occupancy: OccupancyGroup
}

/** Tipo executivo da estaca (fatores F1/F2 de Aoki–Velloso) */
export type PileKind = 'pre-moldada' | 'escavada' | 'helice' | 'franki' | 'raiz' | 'metalica'

export interface FoundationParams {
  type: 'sapata' | 'estacas' | 'tubulao'
  /** RADIER sob todo o edifício (substitui as fundações diretas na exibição) */
  raft?: { thickness: number; overhang: number }
  /** carga admissível geotécnica por estaca, kN (orientativo — exige laudo) */
  pileCapacity: number
  /** diâmetro da estaca, m */
  pileDiameter: number
  /** espaçamento entre eixos = fator × diâmetro (≥2,5 pré-moldada, ≥3 moldada in loco) */
  pileSpacingFactor: number
  pileLabel: string
  /** tipo executivo (Aoki–Velloso; usado na interação solo-estrutura) */
  pileKind?: PileKind
  /** comprimento da estaca/tubulão, m (capacidade, mola vertical e volume) */
  pileLength?: number
  /** tubulão: tensão admissível no concreto do fuste (não armado), kPa — usual 5 MPa */
  caissonSigmaConcrete?: number
}

export interface ProjectSettings {
  concrete: ConcreteMaterial
  steel: SteelMaterial
  caa: CAA
  wind: WindParams
  soil: SoilParams
  /** interação solo-estrutura (molas de fundação + recalques) */
  soilInteraction: SoilInteractionParams
  /** custos unitários p/ estimativa nos quantitativos */
  costs: CostParams
  /** fundação: sapatas diretas ou blocos sobre estacas */
  foundation: FoundationParams
  /** verificação em situação de incêndio (NBR 14432 + NBR 15200) */
  fire: FireParams
  /**
   * Não-linearidade física aproximada p/ análise global ELU — NBR 6118 §15.7.3:
   * vigas 0,4·EI, pilares 0,8·EI
   */
  stiffnessReduction: { beams: number; columns: number }
  /** redutor de rigidez à torção das vigas (torção de compatibilidade) */
  torsionFactor: number
  /**
   * redistribuição de momentos negativos das vigas (§14.6.4.3): δ ∈ [0,75; 1].
   * 1 (ou ausente) = sem redistribuição. Nós móveis: usar δ ≥ 0,90.
   */
  momentRedistribution?: number
  considerSelfWeight: boolean
  /** peso específico do concreto armado, kN/m³ */
  concreteUnitWeight: number
  /** ψ0, ψ1, ψ2 da sobrecarga (NBR 6118 tab. 11.2) */
  psiLive: { psi0: number; psi1: number; psi2: number }
  /** ψ0, ψ1, ψ2 do vento */
  psiWind: { psi0: number; psi1: number; psi2: number }
  /** desaprumo global (NBR 6118 §11.3.3.4.1) combinado ao vento pela regra da norma */
  notionalImperfections: boolean
  /** majoração 0,95·γz dos esforços horizontais ELU quando 1,1 < γz ≤ 1,3 (§15.7.2) */
  secondOrderGammaZ: boolean
  /**
   * Método de análise/dimensionamento de lajes maciças:
   * 'marcus' (quinhões a 45° + Marcus) ou 'grelha' (analogia de grelha —
   * suporta lajes não retangulares, furos e LAJES LISAS com pilar interno).
   */
  slabMethod: 'marcus' | 'grelha'
  /**
   * Vigas no nível da fundação (baldrames) sobre apoio elástico de Winkler.
   * ks em kN/m³; 0/ausente = estimado da sondagem (Es médio).
   */
  groundBeamKs?: number
}

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  author?: string
  city?: string
  /** cliente/proprietário (carimbo das pranchas) */
  client?: string
  /** endereço da obra (carimbo das pranchas) */
  address?: string
  createdAt: string
  grid: Grid
  /** ordenados por elevação crescente; levels[0] = fundação (planId null) */
  levels: Level[]
  plans: FloorPlan[]
  /** pilares em escopo de edifício (contínuos da base ao topo) */
  columns: Column[]
  settings: ProjectSettings
  underlay?: DxfUnderlay | null
  notes?: string
  /** ajustes manuais do editor de armaduras (por vão de viga) */
  rebarOverrides?: RebarOverride[]
  /** ajustes manuais das fundações (por pilar — editor de fundações) */
  foundationOverrides?: FoundationOverride[]
}

/**
 * Fundação editada pelo engenheiro (por pilar). Dimensões presentes viram
 * VERIFICAÇÃO (σ/núcleo/bielas ou carga por estaca) em vez de
 * dimensionamento; offset desloca o CG da fundação em relação ao eixo do
 * pilar (a excentricidade N·e entra nos momentos — divisa); depth é a
 * profundidade do topo abaixo do nível da fundação (desenho/3D).
 */
export interface FoundationOverride {
  columnId: string
  /** tipo por pilar (sobrepõe settings.foundation.type) */
  kind?: 'sapata' | 'estacas' | 'tubulao'
  /** sapata: a×b em planta, m (a na direção de h do pilar) */
  a?: number
  b?: number
  /** bloco: nº de estacas (1–5) */
  nPiles?: number
  /** deslocamento do CG da fundação, m (global x/y) */
  offset?: Vec2
  /** sapata: reta (h constante) ou piramidal (faces inclinadas, default) */
  footingShape?: 'reta' | 'piramidal'
  /** sapata de divisa: pilar interno que recebe a viga alavanca */
  strapToColumnId?: string
  /** sapata ASSOCIADA: pilar vizinho que divide a mesma sapata */
  combineWithColumnId?: string
  /** profundidade do topo abaixo do nível da fundação, m */
  depth?: number
}

/**
 * Ajuste manual de uma posição de armadura (editor de armaduras). O
 * detalhamento usa n/φ do ajuste no lugar do arranjo automático e SINALIZA
 * quando As efetivo < As calculado — a responsabilidade é do engenheiro.
 */
export interface RebarOverride {
  beamId: string
  spanIndex: number
  slot: 'positive' | 'negLeft' | 'negRight' | 'stirrup'
  /** barras longitudinais: quantidade */
  n?: number
  /** barras longitudinais: bitola, m */
  phi?: number
  /** estribos: passo, m */
  spacing?: number
}

export type ElementKind = 'column' | 'beam' | 'slab' | 'wallLoad' | 'loadRegion'

export interface ElementRef {
  kind: ElementKind
  id: string
}
