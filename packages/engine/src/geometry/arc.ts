import type { Vec2 } from '../model/types'

/**
 * Discretização de ARCO circular por corda + flecha (sagitta) — base do
 * pacote de geometria curva: vigas curvas e bordas curvas de laje viram
 * polilinhas densas e todo o pipeline (pórtico, grelha, quinhões, 3D,
 * pranchas) funciona sem casos especiais.
 *
 * Convenção: flecha s > 0 abaúla p/ a ESQUERDA do sentido a→b.
 * R = c²/(8|s|) + |s|/2 (relação corda-flecha exata).
 * Retorna só os pontos INTERMEDIÁRIOS (exclui a e b).
 */
export function arcPoints(a: Vec2, b: Vec2, sagitta: number, nOverride?: number): Vec2[] {
  const c = Math.hypot(b.x - a.x, b.y - a.y)
  const sAbs = Math.abs(sagitta)
  if (c < 1e-6 || sAbs < 0.005) return []
  const r = (c * c) / (8 * sAbs) + sAbs / 2
  const half = Math.asin(Math.min(c / (2 * r), 1)) // meio-ângulo do arco
  const theta = 2 * half
  // nº de subdivisões p/ erro de corda ≤ ~2 cm (limites 2..24)
  const tol = 0.02
  const maxSeg = 2 * Math.acos(Math.max(1 - tol / r, -1))
  const n = nOverride ?? Math.min(24, Math.max(2, Math.ceil(theta / Math.max(maxSeg, 1e-3))))

  const ux = (b.x - a.x) / c
  const uy = (b.y - a.y) / c
  // normal à esquerda de a→b
  const nx = -uy
  const ny = ux
  const side = Math.sign(sagitta)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  // centro no lado OPOSTO ao abaulamento
  const cx = mid.x - side * nx * (r - sAbs)
  const cy = mid.y - side * ny * (r - sAbs)
  const angA = Math.atan2(a.y - cy, a.x - cx)
  const angB = Math.atan2(b.y - cy, b.x - cx)
  // varre de a p/ b pelo lado do abaulamento (Δ com o sinal do lado)
  let delta = angB - angA
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  const out: Vec2[] = []
  for (let i = 1; i < n; i++) {
    const t = angA + (delta * i) / n
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) })
  }
  return out
}

/** comprimento do arco corda+flecha (p/ quantitativos/verificações) */
export function arcLength(chord: number, sagitta: number): number {
  const sAbs = Math.abs(sagitta)
  if (chord < 1e-6 || sAbs < 1e-6) return chord
  const r = (chord * chord) / (8 * sAbs) + sAbs / 2
  return 2 * r * Math.asin(Math.min(chord / (2 * r), 1))
}
