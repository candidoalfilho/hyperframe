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
// Regiões de carga (escada, reservatório…)
// ---------------------------------------------------------------------------

export interface RegionPreset {
  kind: 'escada' | 'reservatorio' | 'generica'
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
]
