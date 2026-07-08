import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ElementRef } from '@hyperframe/engine'
import { useStore } from '../store'
import { NO_RAYCAST } from './coords'
import { buildBoxes, buildSlabs, type SlabInstance } from './buildGeometry'

type SolidKind = 'column' | 'beam' | 'slab'

const BASE_COLOR: Record<SolidKind, string> = {
  column: '#9aa2b1',
  beam: '#8d95a6',
  slab: '#6f7889',
}

function lighten(hex: string, amt = 0.22): string {
  return `#${new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt).getHexString()}`
}

const HOVER_COLOR: Record<SolidKind, string> = {
  column: lighten(BASE_COLOR.column),
  beam: lighten(BASE_COLOR.beam),
  slab: lighten(BASE_COLOR.slab),
}

const SEL_COLOR = '#4da3ff' // var(--sel)
const EDGE_COLOR = '#3a4152'
const DEFAULT_RAYCAST = THREE.Mesh.prototype.raycast

interface Paint {
  color: string
  emissive: string
  emissiveIntensity: number
}

function paintFor(
  kind: SolidKind,
  id: string,
  selection: ElementRef | null,
  hover: ElementRef | null,
): Paint {
  if (selection && selection.kind === kind && selection.id === id)
    return { color: SEL_COLOR, emissive: SEL_COLOR, emissiveIntensity: 0.35 }
  if (hover && hover.kind === kind && hover.id === id)
    return { color: HOVER_COLOR[kind], emissive: '#000000', emissiveIntensity: 0 }
  return { color: BASE_COLOR[kind], emissive: '#000000', emissiveIntensity: 0 }
}

export default function Building() {
  const project = useStore((s) => s.project)
  const activeLevelId = useStore((s) => s.activeLevelId)
  const selection = useStore((s) => s.selection)
  const hoverRef = useStore((s) => s.hoverRef)
  const showSlabs = useStore((s) => s.d3.showSlabs)
  const isolateOpt = useStore((s) => s.d3.isolateActiveLevel)
  const showDeformed = useStore((s) => s.d3.showDeformed)
  const activeComboId = useStore((s) => s.d3.activeComboId)
  const hasResults = useStore((s) => s.results !== null)
  const select = useStore((s) => s.select)
  const setHover = useStore((s) => s.setHover)

  const boxes = useMemo(() => buildBoxes(project), [project])
  const slabs = useMemo(() => buildSlabs(project), [project])
  const activeIdx = useMemo(
    () => project.levels.findIndex((l) => l.id === activeLevelId),
    [project, activeLevelId],
  )

  const isolate = isolateOpt && activeIdx >= 0
  // estrutura indeformada vira fantasma quando a deformada está visível
  const ghostAll = showDeformed && hasResults && activeComboId !== null

  const handleClick = (kind: SolidKind, id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return // arrasto do orbit — não é clique de seleção
    e.stopPropagation()
    select({ kind, id })
  }
  const handleOver = (kind: SolidKind, id: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover({ kind, id })
  }
  const handleOut = (kind: SolidKind, id: string) => () => {
    const h = useStore.getState().hoverRef
    if (h && h.kind === kind && h.id === id) setHover(null)
  }

  return (
    <group>
      {boxes.map((b) => {
        const faded = isolate && !b.levels.includes(activeIdx)
        const solid = !faded && !ghostAll
        const opacity = faded ? 0.07 : ghostAll ? 0.15 : 1
        const paint = paintFor(b.kind, b.id, selection, hoverRef)
        return (
          <mesh
            key={b.key}
            position={b.position}
            rotation-y={b.rotationY}
            castShadow={solid}
            receiveShadow
            userData={{ kind: b.kind, id: b.id }}
            raycast={faded ? NO_RAYCAST : DEFAULT_RAYCAST}
            onClick={faded ? undefined : handleClick(b.kind, b.id)}
            onPointerOver={faded ? undefined : handleOver(b.kind, b.id)}
            onPointerOut={faded ? undefined : handleOut(b.kind, b.id)}
          >
            <boxGeometry args={b.size} />
            <meshStandardMaterial
              color={paint.color}
              roughness={0.9}
              metalness={0.05}
              transparent={!solid}
              opacity={opacity}
              depthWrite={solid}
              emissive={paint.emissive}
              emissiveIntensity={paint.emissiveIntensity}
            />
            {solid && <Edges threshold={20} color={EDGE_COLOR} />}
          </mesh>
        )
      })}

      {showSlabs &&
        slabs.map((s) => {
          const faded = isolate && s.levelIndex !== activeIdx
          const solid = !faded && !ghostAll
          const opacity = faded ? 0.07 : ghostAll ? 0.15 : 0.92
          const paint = paintFor('slab', s.id, selection, hoverRef)
          return (
            <SlabMesh
              key={s.key}
              slab={s}
              paint={paint}
              opacity={opacity}
              solid={solid}
              faded={faded}
              onClick={faded ? undefined : handleClick('slab', s.id)}
              onPointerOver={faded ? undefined : handleOver('slab', s.id)}
              onPointerOut={faded ? undefined : handleOut('slab', s.id)}
            />
          )
        })}
    </group>
  )
}

// ---------------------------------------------------------------------------

interface SlabMeshProps {
  slab: SlabInstance
  paint: Paint
  opacity: number
  solid: boolean
  faded: boolean
  onClick?: (e: ThreeEvent<MouseEvent>) => void
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
}

function SlabMesh({
  slab,
  paint,
  opacity,
  solid,
  faded,
  onClick,
  onPointerOver,
  onPointerOut,
}: SlabMeshProps) {
  // Shape em (x, y) da planta; extrusão em +z (espessura). rotation.x = -π/2
  // leva (x, y, z) → (x, z, -y): y da planta vira -z do three e a extrusão
  // vira altura. Topo da laje na cota do nível (−1,5 mm p/ evitar z-fighting
  // com o topo de vigas/pilares, coplanares).
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    slab.polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false })
  }, [slab.polygon, slab.thickness])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      position={[0, slab.elevation - slab.thickness - 0.0015, 0]}
      castShadow={solid}
      receiveShadow
      userData={{ kind: 'slab', id: slab.id }}
      raycast={faded ? NO_RAYCAST : DEFAULT_RAYCAST}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <meshStandardMaterial
        color={paint.color}
        roughness={0.9}
        metalness={0.05}
        transparent
        opacity={opacity}
        depthWrite={solid}
        emissive={paint.emissive}
        emissiveIntensity={paint.emissiveIntensity}
      />
      {solid && <Edges threshold={20} color={EDGE_COLOR} />}
    </mesh>
  )
}
