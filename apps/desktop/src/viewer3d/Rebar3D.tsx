import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { REBAR_CATEGORIES, type RebarCategory, type RebarGroup3D } from '@hyperframe/engine'
import { NO_RAYCAST } from './coords'
import { REBAR_COLOR, REBAR_SEL_COLOR, pickRebar, rebarSegments, type RebarSegments } from './rebarGeometry'

/**
 * Armaduras no 3D (issue #25). Barras longitudinais como cilindros (bitola
 * real) mais uma linha no eixo, que as mantém visíveis de longe; estribos como
 * linhas. A escolha da barra é feita no clique, pelo raio do cursor.
 */

const LONGITUDINAL: RebarCategory[] = ['viga-positiva', 'viga-negativa', 'pilar-barra']
/** tolerância do clique, em pixels */
const PICK_PX = 6

const UP = new THREE.Vector3(0, 1, 0)

/** cilindros instanciados, um por segmento */
function Tubes({ seg, color, scale = 1 }: { seg: RebarSegments; color: string; scale?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const mid = new THREE.Vector3()
    const sc = new THREE.Vector3()
    for (let k = 0; k < seg.count; k++) {
      a.set(seg.pos[k * 6], seg.pos[k * 6 + 1], seg.pos[k * 6 + 2])
      b.set(seg.pos[k * 6 + 3], seg.pos[k * 6 + 4], seg.pos[k * 6 + 5])
      dir.subVectors(b, a)
      const len = dir.length()
      q.setFromUnitVectors(UP, len > 1e-9 ? dir.divideScalar(len) : UP)
      mid.addVectors(a, b).multiplyScalar(0.5)
      const r = seg.radius[k] * scale
      sc.set(r, Math.max(len, 1e-6), r)
      mesh.setMatrixAt(k, m.compose(mid, q, sc))
    }
    mesh.count = seg.count
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [seg, scale])
  if (seg.count === 0) return null
  return (
    <instancedMesh key={seg.count} ref={ref} args={[undefined, undefined, seg.count]} raycast={NO_RAYCAST} frustumCulled={false}>
      <cylinderGeometry args={[1, 1, 1, 8, 1, false]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.35} />
    </instancedMesh>
  )
}

/** linhas no eixo das barras */
function Lines({ seg, color }: { seg: RebarSegments; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(seg.pos, 3))
    return g
  }, [seg])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (seg.count === 0) return null
  return (
    <lineSegments geometry={geometry} raycast={NO_RAYCAST} frustumCulled={false}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  )
}

export default function Rebar3D({
  groups,
  selectedId,
  onSelect,
}: {
  /** grupos já filtrados (categorias, elemento, pavimento) */
  groups: RebarGroup3D[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const byCat = useMemo(
    () => REBAR_CATEGORIES.map((c) => ({ id: c.id, seg: rebarSegments(groups, (g) => g.category === c.id) })),
    [groups],
  )
  const all = useMemo(() => rebarSegments(groups), [groups])
  const selected = useMemo(
    () => rebarSegments(groups, (g) => g.id === selectedId),
    [groups, selectedId],
  )

  // ---- clique: a barra sob o cursor (tolerância em pixels, igual de perto e de longe)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const latest = useRef({ all, groups, onSelect })
  latest.current = { all, groups, onSelect }
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      const d = down
      down = null
      // arrasto do orbit não é clique
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const o = ray.ray.origin
      const dir = ray.ray.direction
      // metros por pixel a uma profundidade t (perspectiva) ou fixo (ortográfica)
      const persp = camera as THREE.PerspectiveCamera
      const perPx = persp.isPerspectiveCamera
        ? (t: number) => (2 * t * Math.tan((persp.fov * Math.PI) / 360)) / rect.height
        : () => 1 / ((camera as THREE.OrthographicCamera).zoom || 1)
      const { all: seg, groups: gs, onSelect: cb } = latest.current
      const gi = pickRebar(seg, [o.x, o.y, o.z], [dir.x, dir.y, dir.z], (t) => PICK_PX * perPx(t))
      cb(gi === null ? null : gs[gi].id)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl, camera])

  return (
    <group>
      {byCat.map(({ id, seg }) => (
        <group key={id}>
          <Lines seg={seg} color={REBAR_COLOR[id]} />
          {LONGITUDINAL.includes(id) && <Tubes seg={seg} color={REBAR_COLOR[id]} />}
        </group>
      ))}
      {/* a barra escolhida, mais grossa e em destaque */}
      <Tubes seg={selected} color={REBAR_SEL_COLOR} scale={1.9} />
      <Lines seg={selected} color={REBAR_SEL_COLOR} />
    </group>
  )
}
