import { describe, expect, it } from 'vitest'
import { wallLoadFromCalc } from '../src/model/wallLoad'
import { WALL_CALC_DEFAULTS } from '../src/model/presets'

describe('carga de alvenaria pela composição da parede (NBR 6120)', () => {
  it('bloco cerâmico 14 cm, 2 faces de 2 cm, h = 2,60 m: (0,14·8 + 2·0,02·19)·2,6 = 4,888 kN/m', () => {
    const r = wallLoadFromCalc({ ...WALL_CALC_DEFAULTS }, 5)
    expect(r.blockPerArea).toBeCloseTo(1.12, 9)
    expect(r.coatingPerArea).toBeCloseTo(0.76, 9)
    expect(r.perArea).toBeCloseTo(1.88, 9)
    expect(r.w).toBeCloseTo(4.888, 9)
  })
  it('desconta aberturas pela área: porta 0,80×2,10 em 5 m de parede', () => {
    const r = wallLoadFromCalc({ ...WALL_CALC_DEFAULTS, openingsArea: 1.68 }, 5)
    // 1,88 · (13 − 1,68)/5 = 4,25632
    expect(r.grossArea).toBeCloseTo(13, 9)
    expect(r.netArea).toBeCloseTo(11.32, 9)
    expect(r.w).toBeCloseTo(4.25632, 9)
  })
  it('abertura maior que a parede não gera carga negativa', () => {
    expect(wallLoadFromCalc({ ...WALL_CALC_DEFAULTS, openingsArea: 99 }, 2).w).toBe(0)
  })
})
