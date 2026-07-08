import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { comboDiagrams, type MemberDiagrams } from '@hyperframe/engine'
import { useStore } from '../store'

/**
 * Diagramas de esforços como fitas (triangle strips) do eixo do membro até
 * eixo + direção×(valor×escala). Cor por sinal: + laranja, − azul.
 *  - Mz (flexão em torno de z local, flecha em y local) → plotado ao longo de yLocal
 *  - My (flexão em torno de y local) → plotado ao longo de zLocal
 *  - N → plotado ao longo de yLocal
 */

const POS_COLOR = new THREE.Color('#ffa028')
const NEG_COLOR = new THREE.Color('#4da3ff')
const AXIS_COLOR = '#79819a'

export default function DiagramRibbons() {
  const results = useStore((s) => s.results)
  const comboId = useStore((s) => s.d3.activeComboId)
  const diagram = useStore((s) => s.d3.diagram)
  const diagramScale = useStore((s) => s.d3.diagramScale)

  const geoms = useMemo(() => {
    if (!results || !comboId || diagram === 'none') return null
    let dg: MemberDiagrams[]
    try {
      dg = comboDiagrams(results, comboId)
    } catch (err) {
      console.warn('[viewer3d] comboDiagrams indisponível:', err)
      return null
    }
    const { nodes, members } = results.model
    const idxOf = new Map<number, number>()
    nodes.forEach((n, i) => idxOf.set(n.id, i))

    // escala automática: 1,2 m para o máximo global do esforço escolhido
    let gmax = 0
    members.forEach((_, mi) => {
      const d = dg[mi]
      if (!d) return
      for (const v of d[diagram]) {
        const a = Math.abs(v)
        if (a > gmax) gmax = a
      }
    })
    if (gmax <= 1e-9) return null
    const scale = (1.2 / gmax) * diagramScale

    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const axisPositions: number[] = []

    members.forEach((m, mi) => {
      const d = dg[mi]
      if (!d) return
      const values = d[diagram]
      const xs = d.x
      if (!values || values.length !== xs.length || xs.length < 2) return
      const ii = idxOf.get(m.ni)
      const jj = idxOf.get(m.nj)
      if (ii === undefined || jj === undefined) return
      const ni = nodes[ii]
      const nj = nodes[jj]
      const dir = diagram === 'My' ? m.zLocal : m.yLocal

      const base = positions.length / 3
      for (let k = 0; k < xs.length; k++) {
        const t = xs[k]
        // ponto no eixo (coords do projeto)
        const px = ni.x + m.xLocal[0] * t
        const py = ni.y + m.xLocal[1] * t
        const pz = ni.z + m.xLocal[2] * t
        const v = values[k] * scale
        const qx = px + dir[0] * v
        const qy = py + dir[1] * v
        const qz = pz + dir[2] * v
        // pares [eixo_k, ponta_k], já em three.js ([x, z, -y])
        positions.push(px, pz, -py, qx, qz, -qy)
        const c = values[k] >= 0 ? POS_COLOR : NEG_COLOR
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
      for (let k = 0; k + 1 < xs.length; k++) {
        const a = base + 2 * k
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
      }
      axisPositions.push(ni.x, ni.z, -ni.y, nj.x, nj.z, -nj.y)
    })

    if (indices.length === 0) return null

    const ribbon = new THREE.BufferGeometry()
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    ribbon.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    ribbon.setIndex(indices)

    const axis = new THREE.BufferGeometry()
    axis.setAttribute('position', new THREE.Float32BufferAttribute(axisPositions, 3))

    return { ribbon, axis }
  }, [results, comboId, diagram, diagramScale])

  useEffect(() => {
    if (!geoms) return
    return () => {
      geoms.ribbon.dispose()
      geoms.axis.dispose()
    }
  }, [geoms])

  if (!geoms) return null
  return (
    <group>
      <mesh geometry={geoms.ribbon}>
        <meshBasicMaterial
          vertexColors
          side={THREE.DoubleSide}
          transparent
          opacity={0.8}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* eixo fino do membro como referência da fita (sempre visível) */}
      <lineSegments geometry={geoms.axis} renderOrder={10}>
        <lineBasicMaterial color={AXIS_COLOR} depthTest={false} transparent opacity={0.7} />
      </lineSegments>
    </group>
  )
}
