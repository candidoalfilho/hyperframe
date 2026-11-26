/**
 * Altura do painel de resultados ajustada pelo usuário (arrasto da borda de
 * cima) — guardada por máquina. Funções puras + leitura/gravação tolerante.
 */

const KEY = 'hyperframe-results-height'
/** menor altura útil do painel e o que precisa sobrar acima dele (barra + folga), px */
export const PANEL_MIN = 180
export const PANEL_TOP_RESERVE = 68

/** limita a altura ao que cabe na janela */
export function clampPanelHeight(h: number, viewportH: number): number {
  const max = Math.max(PANEL_MIN, viewportH - PANEL_TOP_RESERVE)
  return Math.round(Math.min(max, Math.max(PANEL_MIN, h)))
}

/**
 * altura do painel para a borda de cima ficar sob o ponteiro. `clientY` e
 * `innerHeight` vêm em px visuais; com o zoom da interface ativo, 1 px CSS =
 * `zoom` px visuais. O painel termina 24 px acima do fim da janela (barra de status).
 */
export function panelHeightFromPointer(clientY: number, innerHeight: number, zoom: number): number {
  const z = zoom > 0 ? zoom : 1
  return clampPanelHeight((innerHeight - clientY) / z - 24, innerHeight / z)
}

export function readPanelHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v >= PANEL_MIN ? v : null
  } catch {
    return null
  }
}

export function writePanelHeight(h: number | null): void {
  try {
    if (h === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(Math.round(h)))
  } catch {
    // melhor esforço
  }
}
