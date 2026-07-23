import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

/**
 * Linhas dos eixos do pórtico (modo unifilar) — contribuição de @danubiolagoa
 * (PR #1). Mostra só os eixos das barras do modelo, sem os sólidos.
 */
export default function FrameAxes() {
  const results = useStore((s) => s.results)

  const geometry = useMemo(() => {
    if (!results) return null
    const { nodes, members } = results.model
    const pos: number[] = []
    for (const m of members) {
      const ni = nodes[m.ni]
      const nj = nodes[m.nj]
      if (ni && nj) pos.push(ni.x, ni.z, -ni.y, nj.x, nj.z, -nj.y)
    }
    if (pos.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [results])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#4da3ff" />
    </lineSegments>
  )
}
