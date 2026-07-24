/**
 * Vibração de piso — NBR 6118 §23.3 (conforto): a frequência fundamental f1
 * deve se afastar da crítica: f1 ≥ 1,2·fcrit (análise simplificada).
 *
 * f1 pela correlação de Rayleigh consagrada: f1 ≈ 18/√δ, com δ em mm =
 * flecha IMEDIATA na combinação quase-permanente (sem fluência — vibração é
 * fenômeno de curta duração; a fissuração de serviço é mantida, a favor da
 * segurança).
 *
 * fcrit (Tabela 23.1, valores adotados): ginásio/academia 8,0 Hz · salas de
 * dança/concerto sem cadeiras fixas 7,0 Hz · escritórios 4,0 Hz (topo da
 * faixa) · demais usos (residencial etc., fora da tabela): 3,5 Hz — prática
 * corrente; o limite pode ser sobreposto pelo chamador.
 */

export interface FloorVibrationInput {
  /** flecha imediata quase-permanente, m */
  deltaQpImmediate: number
  /** frequência crítica do uso, Hz */
  fcrit: number
}
export interface FloorVibrationOutput {
  f1: number
  fcrit: number
  /** limite 1,2·fcrit */
  limit: number
  ok: boolean
}

export function checkFloorVibration(inp: FloorVibrationInput): FloorVibrationOutput {
  const deltaMm = Math.max(inp.deltaQpImmediate * 1000, 1e-6)
  const f1 = 18 / Math.sqrt(deltaMm)
  const limit = 1.2 * inp.fcrit
  return { f1, fcrit: inp.fcrit, limit, ok: f1 >= limit }
}

/** fcrit pelo rótulo de uso da laje (presets NBR 6120) — default 3,5 Hz */
export function fcritForUse(label?: string): number {
  const l = (label ?? '').toLowerCase()
  if (l.includes('academia') || l.includes('gin')) return 8
  if (l.includes('dan') || l.includes('concerto') || l.includes('show')) return 7
  if (l.includes('escrit')) return 4
  return 3.5
}
