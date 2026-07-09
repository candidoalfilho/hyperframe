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

export interface Column {
  id: string
  /** P1, P2… */
  name: string
  /** posição do centro em planta, m */
  pos: Vec2
  section: SectionRect
  /**
   * 0  → dimensão `h` da seção ao longo do eixo global X
   * 90 → dimensão `h` ao longo do eixo global Y
   */
  rotationDeg: 0 | 90
  /** nível da base (normalmente a fundação) */
  baseLevelId: string
  /** nível do topo (normalmente o último pavimento) */
  topLevelId: string
}

export interface Beam {
  id: string
  /** V1, V2… */
  name: string
  /** polilinha (≥ 2 vértices), m. Cada trecho entre apoios vira um vão na análise. */
  path: Vec2[]
  section: SectionRect
}

export interface Slab {
  id: string
  /** L1, L2… */
  name: string
  /** polígono fechado (sem repetir o 1º ponto), sentido anti-horário, m */
  polygon: Vec2[]
  /** espessura, m */
  thickness: number
  /** revestimento + contrapiso etc. (permanente g2), kN/m² */
  finishLoad: number
  /** sobrecarga de utilização (variável q), kN/m² — NBR 6120 */
  liveLoad: number
  /** rótulo do preset de uso (ex.: "Residencial — dormitórios") */
  liveLoadLabel?: string
}

/** Carga linear permanente sobre uma viga (alvenaria etc.), kN/m */
export interface WallLoad {
  id: string
  beamId: string
  w: number
  label?: string
}

/**
 * Região de carga adicional sobre lajes (escada, reservatório/caixa d'água,
 * equipamento, jardim…). A carga é distribuída às lajes sobrepostas
 * proporcionalmente à área de interseção.
 */
export interface LoadRegion {
  id: string
  name: string
  kind: 'escada' | 'reservatorio' | 'generica'
  polygon: Vec2[]
  /** permanente adicional, kN/m² */
  g: number
  /** variável adicional, kN/m² */
  q: number
  label?: string
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

export interface ProjectSettings {
  concrete: ConcreteMaterial
  steel: SteelMaterial
  caa: CAA
  wind: WindParams
  soil: SoilParams
  /**
   * Não-linearidade física aproximada p/ análise global ELU — NBR 6118 §15.7.3:
   * vigas 0,4·EI, pilares 0,8·EI
   */
  stiffnessReduction: { beams: number; columns: number }
  /** redutor de rigidez à torção das vigas (torção de compatibilidade) */
  torsionFactor: number
  considerSelfWeight: boolean
  /** peso específico do concreto armado, kN/m³ */
  concreteUnitWeight: number
  /** ψ0, ψ1, ψ2 da sobrecarga (NBR 6118 tab. 11.2) */
  psiLive: { psi0: number; psi1: number; psi2: number }
  /** ψ0, ψ1, ψ2 do vento */
  psiWind: { psi0: number; psi1: number; psi2: number }
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
}

export type ElementKind = 'column' | 'beam' | 'slab' | 'wallLoad' | 'loadRegion'

export interface ElementRef {
  kind: ElementKind
  id: string
}
