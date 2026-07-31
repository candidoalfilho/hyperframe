/**
 * MODULAÇÃO de alvenaria estrutural (família 14/19, módulo M-20):
 * bloco inteiro 39 cm + junta 1 cm = módulo 40 cm; meio bloco 19 cm (módulo
 * 20). Fiadas de 20 cm (bloco 19 + junta 1). AMARRAÇÃO: fiadas ímpares
 * começam com bloco inteiro, pares com meio bloco (juntas defasadas 20 cm).
 * Última fiada = CANALETAS (cinta de respaldo grauteada + armada).
 */

export const BLOCK = { length: 0.39, half: 0.19, height: 0.19, module: 0.4, halfModule: 0.2 }

export interface FiadaCount {
  inteiro: number
  meio: number
}
export interface WallModulation {
  /** nº de módulos de 20 cm no comprimento */
  halfModules: number
  /** comprimento modular efetivo, m */
  modularLength: number
  /** sobra não modular, m (avisar ajuste) */
  leftover: number
  fiadaA: FiadaCount // começa com inteiro
  fiadaB: FiadaCount // começa com meio (amarração)
  /** nº de fiadas no pé-direito (20 cm cada) */
  rows: number
  /** contagens totais por pavimento (última fiada vira canaleta) */
  totals: { inteiro: number; meio: number; canaleta: number; canaletaMeia: number }
  notes: string[]
}

/** modula um trecho reto de comprimento L com pé-direito h */
export function modulateWall(length: number, storyHeight: number): WallModulation {
  const notes: string[] = []
  const halfModules = Math.max(1, Math.round(length / BLOCK.halfModule))
  const modularLength = halfModules * BLOCK.halfModule
  const leftover = Math.abs(length - modularLength)
  if (leftover > 0.015) {
    notes.push(
      `Comprimento ${length.toFixed(2).replace('.', ',')} m NÃO modular (M-20): ajustar p/ ${modularLength.toFixed(2).replace('.', ',')} m ou prever bloco compensador.`,
    )
  }
  const even = halfModules % 2 === 0
  const nInt = Math.floor(halfModules / 2)
  // fiada A: inteiros + (1 meio se módulo ímpar)
  const fiadaA: FiadaCount = { inteiro: nInt, meio: even ? 0 : 1 }
  // fiada B (defasada meio bloco): meio + inteiros + (meio se par)
  const fiadaB: FiadaCount = even
    ? { inteiro: Math.max(nInt - 1, 0), meio: 2 }
    : { inteiro: nInt, meio: 1 }
  const rows = Math.max(1, Math.round(storyHeight / BLOCK.halfModule))
  const nA = Math.ceil(rows / 2)
  const nB = Math.floor(rows / 2)
  // última fiada (respaldo) vira canaleta com a MESMA contagem da sua fiada
  const lastIsA = rows % 2 === 1
  const last = lastIsA ? fiadaA : fiadaB
  const totals = {
    inteiro: fiadaA.inteiro * nA + fiadaB.inteiro * nB - last.inteiro,
    meio: fiadaA.meio * nA + fiadaB.meio * nB - last.meio,
    canaleta: last.inteiro,
    canaletaMeia: last.meio,
  }
  notes.push('Última fiada em CANALETA: cinta de respaldo grauteada com 1 φ 10 contínua (amarrar nos cantos).')
  return { halfModules, modularLength, leftover, fiadaA, fiadaB, rows, totals, notes }
}

/** verga/contraverga de uma abertura: comprimento com apoio mínimo de 30 cm */
export function lintelLength(openingWidth: number): number {
  return openingWidth + 2 * 0.3
}
