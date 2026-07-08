/**
 * Solver direto LDLᵀ com armazenamento em perfil (skyline / active column),
 * p/ sistemas simétricos positivos definidos — algoritmo COLSOL (Bathe).
 */

export class SkylineMatrix {
  readonly n: number
  /** primeira linha não nula de cada coluna */
  readonly minRow: Int32Array
  /** dados por coluna: colData[j][r - minRow[j]] = A[r][j], r ∈ [minRow[j], j] */
  private colData: Float64Array[]
  private factorized = false

  constructor(minRow: Int32Array) {
    this.n = minRow.length
    this.minRow = minRow
    this.colData = new Array(this.n)
    for (let j = 0; j < this.n; j++) {
      this.colData[j] = new Float64Array(j - minRow[j] + 1)
    }
  }

  /** acumula em A[i][j] (exige i ≤ j e i ≥ minRow[j]) */
  add(i: number, j: number, v: number): void {
    if (i > j) {
      const t = i
      i = j
      j = t
    }
    this.colData[j][i - this.minRow[j]] += v
  }

  get(i: number, j: number): number {
    if (i > j) {
      const t = i
      i = j
      j = t
    }
    if (i < this.minRow[j]) return 0
    return this.colData[j][i - this.minRow[j]]
  }

  /** fatoração LDLᵀ in place (A = L·D·Lᵀ, L unit-lower). */
  factorize(): void {
    const { n, minRow, colData } = this
    for (let j = 0; j < n; j++) {
      const mj = minRow[j]
      const cj = colData[j]
      // reduz coluna j: g_i = A[i][j] − Σ_r L[r][i]·D[r]·L[r][j]  (r < i)
      for (let i = mj + 1; i < j; i++) {
        const mi = minRow[i]
        const ci = colData[i]
        const rStart = Math.max(mi, mj)
        let s = 0
        for (let r = rStart; r < i; r++) {
          s += ci[r - mi] * cj[r - mj]
        }
        cj[i - mj] -= s
      }
      // diagonal e normalização: L[i][j] = g_i / D[i]; D[j] = A[j][j] − Σ L·g
      let d = cj[j - mj]
      for (let i = mj; i < j; i++) {
        const g = cj[i - mj]
        const di = colData[i][i - minRow[i]]
        const l = g / di
        d -= l * g
        cj[i - mj] = l
      }
      if (d <= 0 || !Number.isFinite(d)) {
        throw new Error(
          `Matriz de rigidez singular ou mal-condicionada (pivô ${d.toExponential(2)} no GDL ${j}). ` +
            'Verifique se há elementos soltos ou mecanismo (estrutura hipostática).',
        )
      }
      cj[j - mj] = d
    }
    this.factorized = true
  }

  /** resolve A·x = b (após factorize); não modifica b */
  solve(b: ArrayLike<number>): Float64Array {
    if (!this.factorized) throw new Error('factorize() antes de solve()')
    const { n, minRow, colData } = this
    const x = Float64Array.from(b as ArrayLike<number>)
    // L·y = b (forward)
    for (let j = 0; j < n; j++) {
      const mj = minRow[j]
      const cj = colData[j]
      let s = x[j]
      for (let i = mj; i < j; i++) {
        s -= cj[i - mj] * x[i]
      }
      x[j] = s
    }
    // D·z = y
    for (let j = 0; j < n; j++) {
      x[j] /= colData[j][j - minRow[j]]
    }
    // Lᵀ·x = z (backward, por colunas)
    for (let j = n - 1; j >= 0; j--) {
      const mj = minRow[j]
      const cj = colData[j]
      const xj = x[j]
      for (let i = mj; i < j; i++) {
        x[i] -= cj[i - mj] * xj
      }
    }
    return x
  }
}

/**
 * Constrói o envelope de perfil a partir da conectividade:
 * para cada lista de GDL de um elemento, minRow[g] = min(todos os g da lista).
 */
export function buildProfile(n: number, connect: (cb: (dofs: number[]) => void) => void): Int32Array {
  const minRow = new Int32Array(n)
  for (let i = 0; i < n; i++) minRow[i] = i
  connect((dofs) => {
    let lo = Infinity
    for (const d of dofs) if (d >= 0 && d < lo) lo = d
    if (!Number.isFinite(lo)) return
    for (const d of dofs) {
      if (d >= 0 && lo < minRow[d]) minRow[d] = lo
    }
  })
  return minRow
}
