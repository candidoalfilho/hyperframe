import type { CAA } from './types'

/**
 * Presets normativos. Valores de norma transcritos para consulta rápida na UI.
 * Fontes: NBR 6120:2019 (cargas), NBR 6118:2023 (cobrimentos, ψ), NBR 6123 (vento).
 */

// ---------------------------------------------------------------------------
// NBR 6120:2019 — sobrecargas de utilização (kN/m²) — seleção usual
// ---------------------------------------------------------------------------

export interface LiveLoadPreset {
  label: string
  q: number
}

export const LIVE_LOAD_PRESETS: LiveLoadPreset[] = [
  { label: 'Residencial — dormitórios/salas/cozinhas', q: 1.5 },
  { label: 'Residencial — despensa/área de serviço', q: 2.0 },
  { label: 'Corredores de uso comum', q: 3.0 },
  { label: 'Escritórios — salas de uso geral', q: 2.5 },
  { label: 'Lojas / comércio varejista', q: 4.0 },
  { label: 'Salas de aula', q: 3.0 },
  { label: 'Garagens — veículos leves', q: 3.0 },
  { label: 'Cobertura — acesso apenas p/ manutenção', q: 1.0 },
  { label: 'Terraços com acesso ao público', q: 3.0 },
]

// ---------------------------------------------------------------------------
// Cargas de parede (kN/m por m de altura de parede → preset já em kN/m p/ pé-direito típico)
// ---------------------------------------------------------------------------

export interface WallPreset {
  label: string
  /** peso por área de parede (kN/m² de parede), inclui revestimento */
  wPerArea: number
}

export const WALL_PRESETS: WallPreset[] = [
  { label: 'Bloco cerâmico 14 cm + revestimento', wPerArea: 2.5 },
  { label: 'Bloco cerâmico 19 cm + revestimento', wPerArea: 3.2 },
  { label: 'Bloco de concreto 14 cm + revestimento', wPerArea: 3.4 },
  { label: 'Drywall / divisória leve', wPerArea: 0.8 },
]

// ---------------------------------------------------------------------------
// Revestimento de piso (g2) usuais
// ---------------------------------------------------------------------------

export const FINISH_LOAD_PRESETS = [
  { label: 'Contrapiso + cerâmica (~5 cm)', g: 1.0 },
  { label: 'Contrapiso + porcelanato + forro', g: 1.5 },
  { label: 'Piso elevado / enchimento (~8 cm)', g: 2.0 },
]

// ---------------------------------------------------------------------------
// NBR 6123 — velocidade básica V0 por cidade (APROXIMADO — conferir isopletas!)
// ---------------------------------------------------------------------------

export interface CityWind {
  city: string
  v0: number
}

/** Valores aproximados lidos do mapa de isopletas — o usuário deve confirmar. */
export const CITY_V0_PRESETS: CityWind[] = [
  { city: 'São Paulo — SP', v0: 40 },
  { city: 'Rio de Janeiro — RJ', v0: 35 },
  { city: 'Belo Horizonte — MG', v0: 32 },
  { city: 'Brasília — DF', v0: 35 },
  { city: 'Curitiba — PR', v0: 43 },
  { city: 'Porto Alegre — RS', v0: 46 },
  { city: 'Florianópolis — SC', v0: 43 },
  { city: 'Salvador — BA', v0: 30 },
  { city: 'Recife — PE', v0: 30 },
  { city: 'Fortaleza — CE', v0: 30 },
  { city: 'Goiânia — GO', v0: 33 },
  { city: 'Campo Grande — MS', v0: 40 },
  { city: 'Belém — PA', v0: 30 },
  { city: 'Manaus — AM', v0: 30 },
]

// ---------------------------------------------------------------------------
// Concreto — classes usuais
// ---------------------------------------------------------------------------

export const CONCRETE_CLASSES = [20, 25, 30, 35, 40, 45, 50].map((c) => ({
  label: `C${c}`,
  fck: c * 1000, // kPa
}))

// ---------------------------------------------------------------------------
// NBR 6118 tab. 7.2 — cobrimento nominal (m) por CAA
// ---------------------------------------------------------------------------

export const COVER_BY_CAA: Record<CAA, { slab: number; beam: number; column: number }> = {
  I: { slab: 0.02, beam: 0.025, column: 0.025 },
  II: { slab: 0.025, beam: 0.03, column: 0.03 },
  III: { slab: 0.035, beam: 0.04, column: 0.04 },
  IV: { slab: 0.045, beam: 0.05, column: 0.05 },
}

// ---------------------------------------------------------------------------
// NBR 6118 tab. 11.2 — fatores ψ usuais
// ---------------------------------------------------------------------------

export const PSI_PRESETS = {
  residencial: { psi0: 0.5, psi1: 0.4, psi2: 0.3, label: 'Edifícios residenciais' },
  comercial: { psi0: 0.7, psi1: 0.6, psi2: 0.4, label: 'Comercial / escritórios / público' },
  deposito: { psi0: 0.8, psi1: 0.7, psi2: 0.6, label: 'Bibliotecas / arquivos / garagens' },
  vento: { psi0: 0.6, psi1: 0.3, psi2: 0 },
} as const

/** aço CA-50 padrão */
export const STEEL_CA50 = { fyk: 500_000, gammaS: 1.15, Es: 210_000_000 }

/** diâmetros comerciais de barras longitudinais (m) */
export const BAR_DIAMETERS = [0.0063, 0.008, 0.01, 0.0125, 0.016, 0.02, 0.025]

/** diâmetros de estribos (m) */
export const STIRRUP_DIAMETERS = [0.005, 0.0063, 0.008]

/** diâmetros usuais de armadura de laje (m) */
export const SLAB_BAR_DIAMETERS = [0.0063, 0.008, 0.01, 0.0125]

// ---------------------------------------------------------------------------
// Solo — tensões admissíveis ORIENTATIVAS (exigem sondagem SPT / laudo)
// ---------------------------------------------------------------------------

export interface SoilPreset {
  label: string
  sigmaAdm: number // kPa
}

export const SOIL_PRESETS: SoilPreset[] = [
  { label: 'Rocha sã / alterada dura', sigmaAdm: 1000 },
  { label: 'Areia compacta', sigmaAdm: 400 },
  { label: 'Areia medianamente compacta', sigmaAdm: 300 },
  { label: 'Argila rija', sigmaAdm: 250 },
  { label: 'Argila média', sigmaAdm: 150 },
  { label: 'Areia fofa / argila mole (verificar!)', sigmaAdm: 80 },
]

// ---------------------------------------------------------------------------
// Estacas — cargas admissíveis ORIENTATIVAS por tipo/diâmetro (exigem laudo
// geotécnico e verificação estrutural da estaca — NBR 6122)
// ---------------------------------------------------------------------------

export interface PilePreset {
  label: string
  diameter: number // m
  capacity: number // kN (carga admissível usual)
}

export const PILE_PRESETS: PilePreset[] = [
  { label: 'Broca φ25', diameter: 0.25, capacity: 80 },
  { label: 'Strauss φ32', diameter: 0.32, capacity: 250 },
  { label: 'Pré-moldada φ33', diameter: 0.33, capacity: 400 },
  { label: 'Hélice contínua φ40', diameter: 0.4, capacity: 600 },
  { label: 'Hélice contínua φ50', diameter: 0.5, capacity: 900 },
  { label: 'Raiz φ31', diameter: 0.31, capacity: 500 },
]

// ---------------------------------------------------------------------------
// NBR 14432 — grupos de ocupação (tab. A.1, seleção usual)
// ---------------------------------------------------------------------------

export const OCCUPANCY_OPTIONS: { value: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'; label: string }[] = [
  { value: 'A', label: 'A — Residencial' },
  { value: 'B', label: 'B — Serviços de hospedagem (hotéis)' },
  { value: 'C', label: 'C — Comercial varejista' },
  { value: 'D', label: 'D — Serviços profissionais (escritórios)' },
  { value: 'E', label: 'E — Educacional' },
  { value: 'F', label: 'F — Locais de reunião de público' },
  { value: 'G', label: 'G — Serviços automotivos (garagens)' },
  { value: 'H', label: 'H — Serviços de saúde (hospitais)' },
]

// ---------------------------------------------------------------------------
// Defaults de escada e reservatório (dimensionamento das regiões)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lajes nervuradas — defaults e enchimentos usuais
// ---------------------------------------------------------------------------

export const RIBBED_DEFAULTS = {
  dirs: 'xy' as const,
  ribWidth: 0.1, // m
  spacing: 0.55, // m (entre eixos → l0 = 45 cm ≤ 65 cm)
  topping: 0.05, // m
  fillerWeight: 0, // forma removível (vazio)
}

export const RIBBED_FILLER_PRESETS = [
  { label: 'Forma plástica removível (vazio)', weight: 0 },
  { label: 'EPS (isopor)', weight: 0.25 },
  { label: 'Bloco cerâmico', weight: 8.0 },
  { label: 'Bloco de concreto celular', weight: 5.5 },
]

// ---------------------------------------------------------------------------
// Lajes treliçadas (NBR 14859) — catálogo de armações, telas e composições
// ---------------------------------------------------------------------------

/**
 * Armações treliçadas eletrossoldadas usuais (NBR 14859-3), aço CA-60.
 * Designação TR HHSDI: altura (cm) + φ banzo superior + φ diagonal + φ banzo
 * inferior (mm inteiros; "4" = 4,2 mm). Passo das diagonais: 20 cm.
 * Valores de catálogo comercial — confira com o fabricante; todos os campos
 * são editáveis na laje (treliça especial).
 */
export const LATTICE_TRUSSES = [
  { name: 'TR 8644', h: 0.08, top: 0.006, diag: 0.0042, bottom: 0.0042 },
  { name: 'TR 8645', h: 0.08, top: 0.006, diag: 0.0042, bottom: 0.005 },
  { name: 'TR 12645', h: 0.12, top: 0.006, diag: 0.0042, bottom: 0.005 },
  { name: 'TR 12646', h: 0.12, top: 0.006, diag: 0.0042, bottom: 0.006 },
  { name: 'TR 16745', h: 0.16, top: 0.007, diag: 0.0042, bottom: 0.005 },
  { name: 'TR 16746', h: 0.16, top: 0.007, diag: 0.0042, bottom: 0.006 },
  { name: 'TR 20745', h: 0.2, top: 0.007, diag: 0.0042, bottom: 0.005 },
  { name: 'TR 20756', h: 0.2, top: 0.007, diag: 0.005, bottom: 0.006 },
  { name: 'TR 25856', h: 0.25, top: 0.008, diag: 0.005, bottom: 0.006 },
  { name: 'TR 25858', h: 0.25, top: 0.008, diag: 0.005, bottom: 0.008 },
] as const

/** passo longitudinal das diagonais da treliça, m */
export const LATTICE_DIAGONAL_PITCH = 0.2

/** aço das treliças e telas: CA-60 (fyk em kPa) */
export const CA60_FYK = 600_000

/** telas soldadas quadradas (CA-60): área por metro em cada direção, m²/m */
export const WELDED_MESHES = [
  { name: 'Q-61', as: 0.61e-4 },
  { name: 'Q-75', as: 0.75e-4 },
  { name: 'Q-92', as: 0.92e-4 },
  { name: 'Q-113', as: 1.13e-4 },
  { name: 'Q-138', as: 1.38e-4 },
  { name: 'Q-159', as: 1.59e-4 },
  { name: 'Q-196', as: 1.96e-4 },
  { name: 'Q-246', as: 2.46e-4 },
  { name: 'Q-283', as: 2.83e-4 },
] as const

/** peso específico APARENTE do enchimento, kN/m³ */
export const LATTICE_FILLER_WEIGHT = {
  ceramico: 6.0, // lajota cerâmica vazada (~600 kgf/m³)
  eps: 0.25,
  concreto: 13.0, // bloco vazado de concreto
} as const

export const LATTICE_FILLER_LABEL = {
  ceramico: 'Cerâmico (lajota)',
  eps: 'EPS (isopor)',
  concreto: 'Bloco de concreto',
} as const

/** composições usuais: LT H (he + capa) com a treliça típica */
export const LATTICE_COMPOSITIONS = [
  { label: 'LT 12 (8+4)', fillerHeight: 0.08, topping: 0.04, truss: 'TR 8644' },
  { label: 'LT 16 (12+4)', fillerHeight: 0.12, topping: 0.04, truss: 'TR 12645' },
  { label: 'LT 20 (16+4)', fillerHeight: 0.16, topping: 0.04, truss: 'TR 16745' },
  { label: 'LT 25 (20+5)', fillerHeight: 0.2, topping: 0.05, truss: 'TR 20745' },
  { label: 'LT 30 (25+5)', fillerHeight: 0.25, topping: 0.05, truss: 'TR 25856' },
] as const

/** vigota padrão: LT 16 (12+4), TR 12645, lajota cerâmica 30 cm, tela Q-61 */
export const LATTICE_DEFAULTS = {
  truss: 'TR 12645',
  trussHeight: 0.12,
  phiTop: 0.006,
  phiDiag: 0.0042,
  phiBottom: 0.005,
  baseWidth: 0.12,
  baseHeight: 0.03,
  filler: 'ceramico' as const,
  fillerHeight: 0.12,
  fillerWidth: 0.3,
  fillerLedge: 0.015,
  mesh: 'Q-61',
}

export const STAIR_DEFAULTS = {
  waist: 0.12, // espessura da laje do lance, m
  riser: 0.175, // espelho, m
  tread: 0.27, // piso, m
  finish: 1.0, // revestimento, kN/m²
}

export const TANK_DEFAULTS = {
  waterHeight: 1.5, // lâmina d'água, m
  wallThickness: 0.15,
  bottomThickness: 0.15,
  topThickness: 0.1,
}

// ---------------------------------------------------------------------------
// Regiões de carga (escada, reservatório…)
// ---------------------------------------------------------------------------

export interface RegionPreset {
  kind: 'escada' | 'reservatorio' | 'generica' | 'furo'
  label: string
  g: number
  q: number
}

export const REGION_PRESETS: RegionPreset[] = [
  {
    kind: 'escada',
    label: 'Escada (lance + patamar sobre a laje)',
    g: 5.0, // laje inclinada + degraus + revestimento (típico)
    q: 3.0, // NBR 6120 — escadas de uso coletivo (2,5 p/ residencial interno)
  },
  {
    kind: 'reservatorio',
    label: 'Reservatório / caixa d’água (lâmina 1,5 m)',
    g: 3.0, // estrutura (tampa + fundo + paredes rateadas)
    q: 15.0, // água como variável (some nas combinações favoráveis)
  },
  { kind: 'generica', label: 'Carga adicional genérica', g: 2.0, q: 0 },
  { kind: 'furo', label: 'Furo / abertura na laje (shaft, elevador)', g: 0, q: 0 },
]
