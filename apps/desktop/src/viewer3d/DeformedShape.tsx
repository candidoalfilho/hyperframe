import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { comboDisplacements, type Vec3 } from '@hyperframe/engine'
import { useStore } from '../store'

/**
 * Deformada da estrutura: curva de 9 pontos por membro, interpolação de
 * Hermite (cúbica) dos deslocamentos transversais locais + axial linear.
 */

const SAMPLES = 9

const C_LOW = new THREE.Color('#4da3ff')
const C_MID = new THREE.Color('#ffa028')
const C_HIGH = new THREE.Color('#ff5c69')

function rampColor(t: number): [number, number, number] {
  const c = new THREE.Color()
  if (t <= 0.5) c.lerpColors(C_LOW, C_MID, t * 2)
  else c.lerpColors(C_MID, C_HIGH, (t - 0.5) * 2)
  return [c.r, c.g, c.b]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export default function DeformedShape() {
  const results = useStore((s) => s.results)
  const show = useStore((s) => s.d3.showDeformed)
  const comboId = useStore((s) => s.d3.activeComboId)
  const scale = useStore((s) => s.d3.deformScale)

  const data = useMemo(() => {
    if (!show || !results || !comboId) return null
    let disp: number[][]
    try {
      disp = comboDisplacements(results, comboId)
    } catch (err) {
      console.warn('[viewer3d] comboDisplacements indisponível:', err)
      return null
    }
    const { nodes, members } = results.model
    const idxOf = new Map<number, number>()
    nodes.forEach((n, i) => idxOf.set(n.id, i))

    interface Curve {
      pts: [number, number, number][]
      maxMag: number
    }
    const curves: Curve[] = []
    let globalMax = 0

    for (const m of members) {
      const ii = idxOf.get(m.ni)
      const jj = idxOf.get(m.nj)
      if (ii === undefined || jj === undefined) continue
      const ni = nodes[ii]
      const di = disp[ii]
      const dj = disp[jj]
      if (!di || !dj) continue

      const xL = m.xLocal
      const yL = m.yLocal
      const zL = m.zLocal
      const L = m.length
      const ui: Vec3 = [di[0], di[1], di[2]]
      const ri: Vec3 = [di[3], di[4], di[5]]
      const uj: Vec3 = [dj[0], dj[1], dj[2]]
      const rj: Vec3 = [dj[3], dj[4], dj[5]]

      // valores locais nas extremidades
      const a1 = dot(ui, xL) // axial
      const a2 = dot(uj, xL)
      const v1 = dot(ui, yL) // transversal y (flexão em torno de zLocal)
      const v2 = dot(uj, yL)
      const t1 = dot(ri, zL) // θ = dv/dx
      const t2 = dot(rj, zL)
      const w1 = dot(ui, zL) // transversal z (flexão em torno de yLocal)
      const w2 = dot(uj, zL)
      const p1 = -dot(ri, yL) // dw/dx = -θy (verificar sinal: viga deve "cair" no meio do vão)
      const p2 = -dot(rj, yL)

      const pts: [number, number, number][] = []
      let maxMag = 0
      for (let k = 0; k < SAMPLES; k++) {
        const xi = k / (SAMPLES - 1)
        const xi2 = xi * xi
        const xi3 = xi2 * xi
        const N1 = 1 - 3 * xi2 + 2 * xi3
        const N2 = xi - 2 * xi2 + xi3
        const N3 = 3 * xi2 - 2 * xi3
        const N4 = -xi2 + xi3

        const ax = a1 + (a2 - a1) * xi
        const v = N1 * v1 + N2 * L * t1 + N3 * v2 + N4 * L * t2
        const w = N1 * w1 + N2 * L * p1 + N3 * w2 + N4 * L * p2

        // deslocamento global no ponto
        const dx = xL[0] * ax + yL[0] * v + zL[0] * w
        const dy = xL[1] * ax + yL[1] * v + zL[1] * w
        const dz = xL[2] * ax + yL[2] * v + zL[2] * w
        const mag = Math.hypot(dx, dy, dz)
        if (mag > maxMag) maxMag = mag

        // posição = indeformada + escala × deslocamento (coords do projeto)
        const px = ni.x + xL[0] * xi * L + scale * dx
        const py = ni.y + xL[1] * xi * L + scale * dy
        const pz = ni.z + xL[2] * xi * L + scale * dz
        pts.push([px, pz, -py]) // → three.js
      }
      curves.push({ pts, maxMag })
      if (maxMag > globalMax) globalMax = maxMag
    }
    if (curves.length === 0) return null

    // achatado em pares de segmentos (um único LineSegments2 p/ todo o modelo)
    const points: [number, number, number][] = []
    const colors: [number, number, number][] = []
    for (const c of curves) {
      const col = rampColor(globalMax > 1e-12 ? c.maxMag / globalMax : 0)
      for (let k = 0; k + 1 < c.pts.length; k++) {
        points.push(c.pts[k], c.pts[k + 1])
        colors.push(col, col)
      }
    }
    return { points, colors }
  }, [show, results, comboId, scale])

  if (!data) return null
  return (
    <Line
      segments
      points={data.points}
      vertexColors={data.colors}
      color="#ffffff"
      lineWidth={2}
    />
  )
}
