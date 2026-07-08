import { describe, expect, it } from 'vitest'
import {
  equivalentNodalLoads,
  localStiffness,
  rectSectionProps,
  sampleDiagrams,
} from '../src/analysis/frame3d'
import { SkylineMatrix, buildProfile } from '../src/analysis/skyline'

describe('seção retangular', () => {
  it('propriedades geométricas 20×50', () => {
    const { A, Iy, Iz, J } = rectSectionProps(0.2, 0.5)
    expect(A).toBeCloseTo(0.1, 10)
    expect(Iz).toBeCloseTo((0.2 * 0.5 ** 3) / 12, 10) // 2.0833e-3
    expect(Iy).toBeCloseTo((0.5 * 0.2 ** 3) / 12, 10)
    expect(J).toBeGreaterThan(0)
    expect(J).toBeLessThan(Iy + Iz) // J < Ip sempre p/ retângulo
  })
})

describe('matriz de rigidez local', () => {
  it('é simétrica e positiva na diagonal', () => {
    const k = localStiffness({ L: 4, EA: 2e6, EIy: 5e4, EIz: 8e4, GJ: 1e4 })
    for (let i = 0; i < 12; i++) {
      expect(k[i * 12 + i]).toBeGreaterThanOrEqual(0)
      for (let j = 0; j < 12; j++) {
        expect(k[i * 12 + j]).toBeCloseTo(k[j * 12 + i], 8)
      }
    }
    expect(k[0]).toBeCloseTo(2e6 / 4, 6)
    expect(k[1 * 12 + 1]).toBeCloseTo((12 * 8e4) / 64, 6)
  })
})

describe('diagramas — viga biengastada (u = 0)', () => {
  // com nós indeslocáveis, f = −f_eq: valida convenções de sinal dos diagramas
  const L = 6
  const w = 10 // carga p/ baixo: wy = −10 kN/m
  const feq = equivalentNodalLoads(L, 0, -w, 0)
  const fl = Float64Array.from(feq, (v) => -v)
  const dg = sampleDiagrams(fl, L, 0, -w, 0)

  it('momento de engastamento −wL²/12 nos apoios', () => {
    expect(dg.Mz[0]).toBeCloseTo(-(w * L * L) / 12, 6) // −30
    expect(dg.Mz[dg.Mz.length - 1]).toBeCloseTo(-(w * L * L) / 12, 6)
  })
  it('momento no meio do vão +wL²/24 (sagging)', () => {
    expect(dg.Mz[5]).toBeCloseTo((w * L * L) / 24, 6) // +15
  })
  it('cortante ±wL/2 nas extremidades e 0 no meio', () => {
    expect(dg.Vy[0]).toBeCloseTo((w * L) / 2, 6)
    expect(dg.Vy[10]).toBeCloseTo(-(w * L) / 2, 6)
    expect(dg.Vy[5]).toBeCloseTo(0, 6)
  })
})

describe('skyline LDLT', () => {
  it('resolve sistema denso conhecido', () => {
    // A = [[4,1,0],[1,3,1],[0,1,2]], b = [1,2,3] → x = A⁻¹b
    const minRow = new Int32Array([0, 0, 1])
    const A = new SkylineMatrix(minRow)
    A.add(0, 0, 4)
    A.add(0, 1, 1)
    A.add(1, 1, 3)
    A.add(1, 2, 1)
    A.add(2, 2, 2)
    A.factorize()
    const x = A.solve([1, 2, 3])
    // verificação: A·x = b
    expect(4 * x[0] + 1 * x[1]).toBeCloseTo(1, 9)
    expect(1 * x[0] + 3 * x[1] + 1 * x[2]).toBeCloseTo(2, 9)
    expect(1 * x[1] + 2 * x[2]).toBeCloseTo(3, 9)
  })

  it('resolve SPD aleatória com perfil variável (vs verificação A·x=b)', () => {
    const n = 40
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const minRow = new Int32Array(n)
    for (let j = 0; j < n; j++) {
      minRow[j] = Math.max(0, j - 1 - Math.floor(rnd() * 6))
    }
    const dense: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const A = new SkylineMatrix(minRow)
    for (let j = 0; j < n; j++) {
      for (let i = minRow[j]; i < j; i++) {
        const v = rnd() - 0.5
        A.add(i, j, v)
        dense[i][j] = v
        dense[j][i] = v
      }
      const d = 10 + rnd() * 5 // dominância diagonal → SPD
      A.add(j, j, d)
      dense[j][j] = d
    }
    const b = Array.from({ length: n }, () => rnd() * 10 - 5)
    A.factorize()
    const x = A.solve(b)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < n; j++) s += dense[i][j] * x[j]
      expect(s).toBeCloseTo(b[i], 7)
    }
  })

  it('detecta matriz singular', () => {
    const A = new SkylineMatrix(new Int32Array([0, 0]))
    A.add(0, 0, 1)
    A.add(0, 1, 1)
    A.add(1, 1, 1) // det = 0
    expect(() => A.factorize()).toThrow(/singular|mal-condicionada/)
  })

  it('buildProfile calcula envelope por conectividade', () => {
    const p = buildProfile(6, (cb) => {
      cb([0, 1, 2])
      cb([2, 5])
      cb([3, 4])
    })
    expect([...p]).toEqual([0, 0, 0, 3, 3, 2])
  })
})
