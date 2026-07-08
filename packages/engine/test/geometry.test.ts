import { describe, expect, it } from 'vitest'
import { detectFaces } from '../src/geometry/faces'
import { polygonArea, pointInPolygon, segIntersection } from '../src/geometry/geometry'
import { tributaryAreas } from '../src/analysis/buildModel'

describe('geometria básica', () => {
  it('interseção de segmentos em cruz', () => {
    const p = segIntersection({ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 })
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(1, 9)
    expect(p!.y).toBeCloseTo(1, 9)
  })

  it('interseção em T (extremidade sobre o vão)', () => {
    const p = segIntersection({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 })
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(2, 9)
  })

  it('ponto em polígono', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    expect(pointInPolygon({ x: 2, y: 2 }, sq)).toBe(true)
    expect(pointInPolygon({ x: 5, y: 2 }, sq)).toBe(false)
  })
})

describe('detecção de faces (painéis de laje)', () => {
  it('um quadrado fechado → 1 face com área correta', () => {
    const faces = detectFaces([
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
      { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
    ])
    expect(faces).toHaveLength(1)
    expect(polygonArea(faces[0])).toBeCloseTo(12, 6)
  })

  it('grelha 2×1 (vigas contínuas) → 2 faces', () => {
    const faces = detectFaces([
      // contorno 8×3 + viga central em x=4
      { a: { x: 0, y: 0 }, b: { x: 8, y: 0 } },
      { a: { x: 8, y: 0 }, b: { x: 8, y: 3 } },
      { a: { x: 8, y: 3 }, b: { x: 0, y: 3 } },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
    ])
    expect(faces).toHaveLength(2)
    const areas = faces.map(polygonArea).sort()
    expect(areas[0]).toBeCloseTo(12, 5)
    expect(areas[1]).toBeCloseTo(12, 5)
  })

  it('grelha 3×2 de vigas → 6 painéis', () => {
    const xs = [0, 4, 8, 12]
    const ys = [0, 4.5, 9]
    const segs = []
    for (const y of ys) segs.push({ a: { x: 0, y }, b: { x: 12, y } })
    for (const x of xs) segs.push({ a: { x, y: 0 }, b: { x, y: 9 } })
    const faces = detectFaces(segs)
    expect(faces).toHaveLength(6)
    const total = faces.reduce((s, f) => s + polygonArea(f), 0)
    expect(total).toBeCloseTo(12 * 9, 4)
  })
})

describe('quinhões de carga (áreas de influência)', () => {
  it('retângulo 4×6: triângulos nos lados menores, trapézios nos maiores', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ]
    const shares = tributaryAreas(poly)
    // lados: 6 (trapézio), 4 (triângulo), 6, 4
    expect(shares[0]).toBeCloseTo((4 * (2 * 6 - 4)) / 4, 4) // 8
    expect(shares[1]).toBeCloseTo(16 / 4, 4) // 4
    expect(shares[2]).toBeCloseTo(8, 4)
    expect(shares[3]).toBeCloseTo(4, 4)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(24, 6)
  })

  it('quadrado: 4 triângulos iguais', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const shares = tributaryAreas(poly)
    for (const s of shares) expect(s).toBeCloseTo(4, 4)
  })

  it('polígono genérico conserva a área total', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 6, y: 3 },
      { x: 2, y: 5 },
      { x: -1, y: 2 },
    ]
    const shares = tributaryAreas(poly)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(polygonArea(poly), 6)
  })
})
