import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

/**
 * Linhas dos eixos do pórtico estrutural (modo unifilar).
 * Mostra apenas os eixos dos membros (barras) do modelo estrutural,
 * sem os sólidos 3D. Útil para visualização de diagramas.
 */
export default function FrameAxes() {
  const results = useStore((s) => s.results)

  const lines = useMemo(() => {
    if (!results) return []

    const { nodes, members } = results.model
    const positions: number[] = []

    members.forEach((m) => {
      const ni = nodes.find((n) => n.id === m.ni)
      const nj = nodes.find((n) => n.id === m.nj)
      if (ni && nj) {
        // Coordenadas three.js: [x, cota, -y]
        positions.push(ni.x, ni.z, -ni.y, nj.x, nj.z, -nj.y)
      }
    })

    return positions
  }, [results])

  const geometry = useMemo(() => {
    if (lines.length === 0) return null
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    return geom
  }, [lines])

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose()
    }
  }, [geometry])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#4da3ff" linewidth={2} />
    </lineSegments>
  )
}
