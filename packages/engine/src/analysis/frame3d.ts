import type { Vec3 } from './types'

/**
 * Elemento de pórtico espacial (Euler-Bernoulli), 12 GDL.
 * GDL locais: [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]
 * Eixo x local ao longo do membro; flexão em torno de z (deslocamento em y)
 * usa Iz; flexão em torno de y (deslocamento em z) usa Iy.
 */

export interface ElementProps {
  L: number
  EA: number
  EIy: number
  EIz: number
  GJ: number
}

/** matriz de rigidez local 12×12 (simétrica, densa row-major) */
export function localStiffness(p: ElementProps): Float64Array {
  const { L, EA, EIy, EIz, GJ } = p
  const L2 = L * L
  const L3 = L2 * L
  const k = new Float64Array(144)
  const set = (i: number, j: number, v: number) => {
    k[i * 12 + j] = v
    k[j * 12 + i] = v
  }

  // axial
  set(0, 0, EA / L)
  set(0, 6, -EA / L)
  set(6, 6, EA / L)

  // torção
  set(3, 3, GJ / L)
  set(3, 9, -GJ / L)
  set(9, 9, GJ / L)

  // flexão em torno de z (v em y): gdl 1,5,7,11
  set(1, 1, (12 * EIz) / L3)
  set(1, 5, (6 * EIz) / L2)
  set(1, 7, (-12 * EIz) / L3)
  set(1, 11, (6 * EIz) / L2)
  set(5, 5, (4 * EIz) / L)
  set(5, 7, (-6 * EIz) / L2)
  set(5, 11, (2 * EIz) / L)
  set(7, 7, (12 * EIz) / L3)
  set(7, 11, (-6 * EIz) / L2)
  set(11, 11, (4 * EIz) / L)

  // flexão em torno de y (w em z): gdl 2,4,8,10 — sinais padrão
  set(2, 2, (12 * EIy) / L3)
  set(2, 4, (-6 * EIy) / L2)
  set(2, 8, (-12 * EIy) / L3)
  set(2, 10, (-6 * EIy) / L2)
  set(4, 4, (4 * EIy) / L)
  set(4, 8, (6 * EIy) / L2)
  set(4, 10, (2 * EIy) / L)
  set(8, 8, (12 * EIy) / L3)
  set(8, 10, (6 * EIy) / L2)
  set(10, 10, (4 * EIy) / L)

  return k
}

/**
 * Cargas nodais equivalentes (vetor local, 12) p/ cargas uniformes distribuídas
 * ao longo de TODO o vão: wx (axial), wy (transversal y), wz (transversal z),
 * em kN/m nos eixos locais.
 */
export function equivalentNodalLoads(L: number, wx: number, wy: number, wz: number): Float64Array {
  const f = new Float64Array(12)
  const L2 = L * L
  // axial
  f[0] = (wx * L) / 2
  f[6] = (wx * L) / 2
  // transversal y (flexão em z)
  f[1] = (wy * L) / 2
  f[5] = (wy * L2) / 12
  f[7] = (wy * L) / 2
  f[11] = -(wy * L2) / 12
  // transversal z (flexão em y) — momentos com sinal trocado (orientação dos eixos)
  f[2] = (wz * L) / 2
  f[4] = -(wz * L2) / 12
  f[8] = (wz * L) / 2
  f[10] = (wz * L2) / 12
  return f
}

/** rotação global→local: linhas = versores x,y,z locais em coords globais */
export function rotationMatrix(x: Vec3, y: Vec3, z: Vec3): Float64Array {
  const r = new Float64Array(9)
  r[0] = x[0]
  r[1] = x[1]
  r[2] = x[2]
  r[3] = y[0]
  r[4] = y[1]
  r[5] = y[2]
  r[6] = z[0]
  r[7] = z[1]
  r[8] = z[2]
  return r
}

/** u_local = T·u_global, com T = blocdiag(R,R,R,R) */
export function toLocal(r: Float64Array, ug: ArrayLike<number>): Float64Array {
  const ul = new Float64Array(12)
  for (let b = 0; b < 4; b++) {
    const o = b * 3
    for (let i = 0; i < 3; i++) {
      ul[o + i] =
        r[i * 3 + 0] * ug[o + 0] + r[i * 3 + 1] * ug[o + 1] + r[i * 3 + 2] * ug[o + 2]
    }
  }
  return ul
}

/** f_global = Tᵀ·f_local */
export function toGlobal(r: Float64Array, fl: ArrayLike<number>): Float64Array {
  const fg = new Float64Array(12)
  for (let b = 0; b < 4; b++) {
    const o = b * 3
    for (let i = 0; i < 3; i++) {
      fg[o + i] =
        r[0 * 3 + i] * fl[o + 0] + r[1 * 3 + i] * fl[o + 1] + r[2 * 3 + i] * fl[o + 2]
    }
  }
  return fg
}

/** K_global = Tᵀ·k_local·T (12×12 densas) */
export function globalStiffness(r: Float64Array, kl: Float64Array): Float64Array {
  // T é bloco-diagonal: K_g[3a..][3b..] = Rᵀ · k_l[3a..][3b..] · R por blocos 3×3
  const kg = new Float64Array(144)
  const tmp = new Float64Array(9)
  for (let bi = 0; bi < 4; bi++) {
    for (let bj = 0; bj < 4; bj++) {
      // bloco 3×3 de k_local
      // tmp = Rᵀ · kl_block
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0
          for (let m = 0; m < 3; m++) {
            s += r[m * 3 + i] * kl[(bi * 3 + m) * 12 + (bj * 3 + j)]
          }
          tmp[i * 3 + j] = s
        }
      }
      // kg_block = tmp · R
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0
          for (let m = 0; m < 3; m++) {
            s += tmp[i * 3 + m] * r[m * 3 + j]
          }
          kg[(bi * 3 + i) * 12 + (bj * 3 + j)] = s
        }
      }
    }
  }
  return kg
}

/** propriedades geométricas de seção retangular bw×h (bw ao longo de z local, h ao longo de y local) */
export function rectSectionProps(bw: number, h: number): {
  A: number
  Iy: number
  Iz: number
  J: number
} {
  const A = bw * h
  const Iz = (bw * h * h * h) / 12
  const Iy = (h * bw * bw * bw) / 12
  const a = Math.max(bw, h)
  const b = Math.min(bw, h)
  // torção de Saint-Venant p/ retângulo
  const J = a * b * b * b * (1 / 3 - 0.21 * (b / a) * (1 - (b * b * b * b) / (12 * a * a * a * a)))
  return { A, Iy, Iz, J }
}

export interface EndForces {
  /** vetor local de esforços nas extremidades (12): f = k·u_l − f_eq */
  f: Float64Array
}

/**
 * Diagramas amostrados. Convenções (validadas nos testes):
 *  N(x)  = −(Fxi + wx·x)            (tração +)
 *  Vy(x) = Fyi + wy·x
 *  Mz(x) = −Mzi + Fyi·x + wy·x²/2   (sagging + p/ vigas com y local ↑)
 *  Vz(x) = Fzi + wz·x
 *  My(x) = Myi + Fzi·x + wz·x²/2
 *  T(x)  = −Mxi
 */
export function sampleDiagrams(
  f: Float64Array,
  L: number,
  wx: number,
  wy: number,
  wz: number,
  nStations = 11,
): { x: number[]; N: number[]; Vy: number[]; Vz: number[]; T: number[]; My: number[]; Mz: number[] } {
  const x: number[] = []
  const N: number[] = []
  const Vy: number[] = []
  const Vz: number[] = []
  const T: number[] = []
  const My: number[] = []
  const Mz: number[] = []
  for (let s = 0; s < nStations; s++) {
    const xi = (L * s) / (nStations - 1)
    x.push(xi)
    N.push(-(f[0] + wx * xi))
    Vy.push(f[1] + wy * xi)
    Vz.push(f[2] + wz * xi)
    T.push(-f[3])
    My.push(f[4] + f[2] * xi + (wz * xi * xi) / 2)
    Mz.push(-f[5] + f[1] * xi + (wy * xi * xi) / 2)
  }
  return { x, N, Vy, Vz, T, My, Mz }
}
