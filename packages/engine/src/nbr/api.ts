/**
 * CONTRATO dos módulos normativos (ABNT). Todas as funções são puras.
 * Unidades SI internas: m, kN, kN·m, kPa.
 *
 * Implementações em:
 *  - nbr6118/materials.ts   (propriedades do concreto/aço)
 *  - nbr6118/beamDesign.ts  (flexão simples + cisalhamento de vigas)
 *  - nbr6118/stability.ts   (γz, α, limites de deslocamento)
 *  - nbr6123/wind.ts        (S2, q(z), Ca, forças por pavimento)
 *  - nbr8681/combinations.ts (combinações ELU/ELS)
 */

import type { CAA, Aggregate, WindParams } from '../model/types'
import type { LoadCombo, WindDirectionLoads, WindLevelForce } from '../analysis/types'

// ---------------------------------------------------------------------------
// NBR 6118 — materiais
// ---------------------------------------------------------------------------

export interface ConcreteProps {
  fck: number // kPa
  fcd: number // fck/γc
  /** resistência média à tração: fctm = 0,3·(fck[MPa])^(2/3) [MPa] → kPa (fck ≤ 50 MPa) */
  fctm: number
  /** fctk,inf = 0,7·fctm */
  fctkInf: number
  /** fctd = fctk,inf/γc */
  fctd: number
  /** Eci = αE·5600·√(fck[MPa]) [MPa] → kPa */
  eci: number
  /** Ecs = αi·Eci, αi = 0,8 + 0,2·fck/80 ≤ 1,0 */
  ecs: number
  /** G = Ecs/2,4 (ν = 0,2) */
  gc: number
}

/** αE: basalto/diabásio 1,2 · granito/gnaisse 1,0 · calcário 0,9 · arenito 0,7 */
export type ConcretePropsFn = (fck: number, aggregate: Aggregate, gammaC: number) => ConcreteProps

// ---------------------------------------------------------------------------
// NBR 6118 — dimensionamento de vigas (flexão simples retangular, fck ≤ 50)
// ---------------------------------------------------------------------------

export interface BeamFlexureInput {
  md: number // momento de cálculo (valor absoluto), kN·m
  bw: number // m
  h: number // m
  d: number // altura útil, m
  fcd: number // kPa
  fyd: number // kPa
  fck: number // kPa (p/ ρmin)
}

export interface BeamFlexureOutput {
  as: number // m²
  asMin: number // m²  — ρmin = max(0,15%, 0,035·(0,85·fcd)/fyd... ver tabela 17.3) · bw·h
  xd: number // x/d
  ok: boolean // x/d ≤ 0,45 e seção suficiente
  note?: string
}

/**
 * Bloco retangular: Md = 0,85·fcd·bw·0,8x·(d − 0,4x) → resolver x.
 * As = Md / (fyd·(d − 0,4x)). Limite de dutilidade x/d ≤ 0,45 (fck ≤ 50 MPa).
 * Se x/d > 0,45 → ok=false, note "aumentar seção ou armadura dupla".
 * ρmin (tab. 17.3, CA-50): 0,150% p/ C20–C30; 0,164% C35; 0,179% C40; 0,194% C45; 0,208% C50
 * (equivale a ωmin = 0,035). As,min = ρmin·bw·h. Retornar As = max(As_calc, As_min) com nota.
 */
export type BeamFlexureFn = (input: BeamFlexureInput) => BeamFlexureOutput

export interface BeamShearInput {
  vd: number // kN
  bw: number
  d: number
  fck: number // kPa
  fcd: number // kPa
  fctd: number // kPa
  /** fywd ≤ 435 MPa p/ CA-50 */
  fywd: number // kPa
  fctm: number // kPa
  fywk: number // kPa
}

export interface BeamShearOutput {
  vrd2: number // kN — biela: 0,27·αv2·fcd·bw·d, αv2 = 1 − fck[MPa]/250
  vc: number // kN — 0,6·fctd·bw·d
  aswS: number // m²/m — (Vd − Vc)/(0,9·d·fywd), ≥ 0
  aswSMin: number // m²/m — ρsw,min = 0,2·fctm/fywk → Asw/s = ρsw·bw
  sMax: number // m — 0,6d ≤ 300 mm se Vd ≤ 0,67·Vrd2; senão 0,3d ≤ 200 mm
  ok: boolean // Vd ≤ Vrd2
}

export type BeamShearFn = (input: BeamShearInput) => BeamShearOutput

/**
 * Escolha de barras: dado As (m²) e bw, escolher diâmetro/quantidade dentre
 * BAR_DIAMETERS respeitando espaçamento livre ≥ max(20 mm, φ) com cobrimento
 * `cover` e estribo φt=6,3 mm. Preferir 2–6 barras. Retorna ex.: "4 φ 12.5 (4,91 cm²)".
 */
export type PickBarsFn = (
  asRequired: number,
  bw: number,
  cover: number,
) => { spec: string; asProvided: number; n: number; phi: number }

// ---------------------------------------------------------------------------
// NBR 6118 §15 — estabilidade global
// ---------------------------------------------------------------------------

export interface GammaZInput {
  /** Σ Fh,d·z de todos os pavimentos (momento de tombamento de cálculo), kN·m */
  m1: number
  /** Σ Pd,i·δ,i (carga vertical de cálculo do pavimento × desloc. horizontal), kN·m */
  deltaM: number
}

/** γz = 1/(1 − ΔM/M1). Classificação: ≤1,10 nós fixos; ≤1,30 nós móveis; >1,30 inválido. */
export type GammaZFn = (input: GammaZInput) => {
  value: number
  classification: 'nos-fixos' | 'nos-moveis' | 'invalido'
}

export interface AlphaInput {
  totalHeight: number // m
  /** Σ carga vertical característica total (G+Q), kN */
  nk: number
  /** rigidez equivalente EI do edifício na direção, kN·m² (do deslocamento de topo) */
  eiEq: number
  /** número de pavimentos */
  n: number
}

/**
 * α = Htot·√(Nk/EIeq). Limite α1 = 0,2 + 0,1·n (n ≤ 3); α1 = 0,6 (n ≥ 4)
 * (contraventamento por pórticos).
 */
export type AlphaFn = (input: AlphaInput) => { value: number; limit: number; ok: boolean }

/**
 * Limites de deslocamento lateral (tab. 13.3, vento freq. ψ1):
 * topo: H/1700 · entre pavimentos: Hi/850
 */
export const DRIFT_TOP_RATIO = 1 / 1700
export const DRIFT_STORY_RATIO = 1 / 850

// ---------------------------------------------------------------------------
// NBR 6123 — vento
// ---------------------------------------------------------------------------

export interface WindGeometry {
  /** dimensões do retângulo envolvente em planta, m */
  lx: number
  ly: number
  /** cota do topo, m */
  totalHeight: number
  /** níveis (índice, cota, altura tributária de fachada), da base ao topo */
  levels: { levelIndex: number; z: number; tributaryHeight: number }[]
}

/**
 * S2(z) = b·Fr·(z/10)^p — tabela 1 da NBR 6123 (b, p por categoria e classe;
 * Fr = 1,00/0,98/0,95 p/ classes A/B/C).
 * Valores (b; p) por categoria — classe A: I(1,10;0,06) II(1,00;0,085) III(0,94;0,10)
 * IV(0,86;0,12) V(0,74;0,15) · classe B: I(1,11;0,065) II(1,00;0,09) III(0,94;0,105)
 * IV(0,85;0,125) V(0,73;0,16) · classe C: I(1,12;0,07) II(1,00;0,10) III(0,93;0,115)
 * IV(0,84;0,135) V(0,71;0,175).
 * Vk = V0·S1·S2·S3 · q(z) = 0,613·Vk² [N/m²] → dividir por 1000 p/ kN/m².
 * S3 por grupo: 1→1,10 · 2→1,00 · 3→0,95 · 4→0,88 · 5→0,83.
 * Ca estimado da Fig. 4 (baixa turbulência) por interpolação bilinear em
 * (l1/l2, h/l1) — grade aproximada editável; usuário pode sobrescrever.
 * Força por nível: F = q(z)·Ca·(largura de fachada ⊥ vento)·(altura tributária).
 */
export type ComputeWindFn = (params: WindParams, geo: WindGeometry) => WindDirectionLoads[]

export type { WindDirectionLoads, WindLevelForce }

// ---------------------------------------------------------------------------
// NBR 8681 / 6118 §11 — combinações
// ---------------------------------------------------------------------------

export interface ComboGenInput {
  hasWind: boolean
  gammaG: number // 1,4
  gammaGFav: number // 1,0
  gammaQ: number // 1,4
  psiLive: { psi0: number; psi1: number; psi2: number }
  psiWind: { psi0: number; psi1: number; psi2: number }
}

/**
 * Gerar (com vento):
 *  ELU (rigidez 'elu'):
 *   1) 1,4G + 1,4Q
 *   2) 1,4G + 1,4Q + 1,4·ψ0w·W(dir)      — Q principal (4 direções)
 *   3) 1,4G + 1,4W(dir) + 1,4·ψ0q·Q      — vento principal (4)
 *   4) 1,0G + 1,4W(dir)                   — G favorável (4)
 *  ELS (rigidez 'els'):
 *   QP:   G + ψ2q·Q
 *   FREQ: G + ψ1q·Q
 *   VENTO (drift): G + ψ1w·W(dir) + ψ2q·Q (4)
 * Sem vento: apenas 1) + QP + FREQ.
 * Labels legíveis, ex.: "ELU 2: 1,4G + 1,4Q + 0,84Wx+".
 */
export type GenerateCombosFn = (input: ComboGenInput) => LoadCombo[]

// ---------------------------------------------------------------------------
// Cobrimentos por CAA (já em presets, repassado p/ conveniência)
// ---------------------------------------------------------------------------

export type CoverFn = (caa: CAA) => { slab: number; beam: number; column: number }
