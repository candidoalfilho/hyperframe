import type { RebarCategory, RebarGroup3D } from '@hyperframe/engine'

/**
 * Armaduras no 3D (issue #25): filtro, segmentos prontos para desenhar e a
 * escolha da barra sob o cursor. Sem three.js aqui — só números, testável.
 * Coordenadas three.js (y para cima): projeto (x, y, cota) → [x, cota, −y].
 */

/** cores por categoria (legíveis nos temas claro e escuro) */
export const REBAR_COLOR: Record<RebarCategory, string> = {
  'viga-positiva': '#f59e0b',
  'viga-negativa': '#3b82f6',
  'viga-estribo': '#22c55e',
  'pilar-barra': '#ef4444',
  'pilar-estribo': '#a855f7',
}

/** barra selecionada */
export const REBAR_SEL_COLOR = '#ff2bd6'

/** raio mínimo desenhado, m — abaixo disso a barra some na tela */
const MIN_RADIUS = 0.004

export interface RebarFilter {
  cats: Record<RebarCategory, boolean>
  element: { kind: 'beam' | 'column'; id: string } | null
}

export function filterRebar(groups: RebarGroup3D[], f: RebarFilter): RebarGroup3D[] {
  return groups.filter(
    (g) => f.cats[g.category] && (!f.element || (g.elementKind === f.element.kind && g.elementId === f.element.id)),
  )
}

export interface RebarSegments {
  /** [ax, ay, az, bx, by, bz] de cada segmento, coordenadas three.js */
  pos: Float32Array
  /** índice (em `groups`) do grupo de cada segmento */
  group: Uint32Array
  /** raio de cada segmento, m */
  radius: Float32Array
  count: number
}

/** segmentos retos de todas as barras dos grupos (opcionalmente só de uma categoria) */
export function rebarSegments(groups: RebarGroup3D[], only?: (g: RebarGroup3D) => boolean): RebarSegments {
  let count = 0
  groups.forEach((g) => {
    if (only && !only(g)) return
    for (const p of g.paths) count += Math.max(p.length / 3 - 1, 0)
  })
  const pos = new Float32Array(count * 6)
  const group = new Uint32Array(count)
  const radius = new Float32Array(count)
  let k = 0
  groups.forEach((g, gi) => {
    if (only && !only(g)) return
    const r = Math.max(g.phi / 2, MIN_RADIUS)
    for (const p of g.paths) {
      for (let i = 0; i + 5 < p.length; i += 3) {
        pos[k * 6] = p[i]
        pos[k * 6 + 1] = p[i + 2]
        pos[k * 6 + 2] = -p[i + 1]
        pos[k * 6 + 3] = p[i + 3]
        pos[k * 6 + 4] = p[i + 5]
        pos[k * 6 + 5] = -p[i + 4]
        group[k] = gi
        radius[k] = r
        k++
      }
    }
  })
  return { pos, group, radius, count }
}

/**
 * Grupo da barra sob o raio do cursor. `tolAt(t)` = distância aceita (m) a uma
 * profundidade `t` ao longo do raio — alguns pixels, o que deixa a escolha
 * igual de perto e de longe. Entre as barras dentro da tolerância, ganha a
 * mais próxima da câmera. null = nada sob o cursor.
 */
export function pickRebar(
  seg: RebarSegments,
  origin: [number, number, number],
  dir: [number, number, number],
  tolAt: (t: number) => number,
): number | null {
  const [ox, oy, oz] = origin
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const dx = dir[0] / dl
  const dy = dir[1] / dl
  const dz = dir[2] / dl
  let best: number | null = null
  let bestT = Infinity
  for (let k = 0; k < seg.count; k++) {
    const ax = seg.pos[k * 6]
    const ay = seg.pos[k * 6 + 1]
    const az = seg.pos[k * 6 + 2]
    const ex = seg.pos[k * 6 + 3] - ax
    const ey = seg.pos[k * 6 + 4] - ay
    const ez = seg.pos[k * 6 + 5] - az
    // pontos mais próximos entre o raio (t ≥ 0) e o segmento (0 ≤ s ≤ 1)
    const wx = ox - ax
    const wy = oy - ay
    const wz = oz - az
    const b = dx * ex + dy * ey + dz * ez
    const c = ex * ex + ey * ey + ez * ez
    const d = dx * wx + dy * wy + dz * wz
    const e = ex * wx + ey * wy + ez * wz
    const den = c - b * b
    let s = den > 1e-12 ? (e - b * d) / den : 0
    s = Math.min(1, Math.max(0, s))
    const t = b * s - d
    if (t <= 0 || t >= bestT) continue
    const px = ox + dx * t - (ax + ex * s)
    const py = oy + dy * t - (ay + ey * s)
    const pz = oz + dz * t - (az + ez * s)
    const dist = Math.hypot(px, py, pz)
    if (dist <= tolAt(t) + seg.radius[k]) {
      bestT = t
      best = seg.group[k]
    }
  }
  return best
}

/** bitola em mm, com vírgula: 0,0125 → "12,5" */
export function phiLabel(phi: number): string {
  const mm = Math.round(phi * 10000) / 10
  return String(mm).replace('.', ',')
}
