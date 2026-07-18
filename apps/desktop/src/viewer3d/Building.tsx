import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ElementRef } from '@hyperframe/engine'
import { useStore } from '../store'
import { NO_RAYCAST } from './coords'
import {
  buildBoxes,
  buildFoundations,
  buildRegionSolids,
  buildSlabs,
  type BoxInstance,
  type SlabInstance,
} from './buildGeometry'

type SolidKind = 'column' | 'beam' | 'slab' | 'loadRegion'

const BASE_COLOR: Record<SolidKind, string> = {
  column: '#9aa2b1',
  beam: '#8d95a6',
  slab: '#6f7889',
  loadRegion: '#a09884',
}

/** fundações: concreto mais escuro; âmbar/vermelho sinalizam atenção/falha */
const FOUNDATION_COLOR: Record<'ok' | 'atencao' | 'falha', string> = {
  ok: '#7e8697',
  atencao: '#b3985a',
  falha: '#b06a6a',
}

/** cor por tipo de região (escada = concreto claro; reservatório = azulado) */
const REGION_COLOR: Record<'escada' | 'reservatorio', string> = {
  escada: '#a09884',
  reservatorio: '#7f96ad',
}

function lighten(hex: string, amt = 0.22): string {
  return `#${new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt).getHexString()}`
}

const HOVER_COLOR: Record<SolidKind, string> = {
  column: lighten(BASE_COLOR.column),
  beam: lighten(BASE_COLOR.beam),
  slab: lighten(BASE_COLOR.slab),
  loadRegion: lighten(BASE_COLOR.loadRegion),
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

  const showRegions = useStore((s) => s.d3.showRegions)
  const showFoundations = useStore((s) => s.d3.showFoundations)
  const foundations = useStore((s) => s.results?.foundations ?? null)
  const boxes = useMemo(() => buildBoxes(project), [project])
  const foundationSolids = useMemo(
    () => (foundations ? buildFoundations(project, foundations) : []),
    [project, foundations],
  )
  const slabs = useMemo(() => buildSlabs(project), [project])
  const regionSolids = useMemo(() => buildRegionSolids(project), [project])
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
        if (b.prism) {
          return (
            <PrismMesh
              key={b.key}
              box={b}
              paint={paint}
              opacity={opacity}
              solid={solid}
              faded={faded}
              onClick={faded ? undefined : handleClick(b.kind, b.id)}
              onPointerOver={faded ? undefined : handleOver(b.kind, b.id)}
              onPointerOut={faded ? undefined : handleOut(b.kind, b.id)}
            />
          )
        }
        if (b.webHoles && b.webHoles.length > 0) {
          return (
            <WebBoxMesh
              key={b.key}
              box={b}
              paint={paint}
              opacity={opacity}
              solid={solid}
              faded={faded}
              onClick={faded ? undefined : handleClick(b.kind, b.id)}
              onPointerOver={faded ? undefined : handleOver(b.kind, b.id)}
              onPointerOut={faded ? undefined : handleOut(b.kind, b.id)}
            />
          )
        }
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
            {b.round ? (
              <cylinderGeometry args={[b.round.d / 2, b.round.d / 2, b.size[1], 24]} />
            ) : (
              <boxGeometry args={b.size} />
            )}
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
            {solid && !b.round && <Edges threshold={20} color={EDGE_COLOR} />}
          </mesh>
        )
      })}

      {showFoundations &&
        !isolate &&
        foundationSolids.map((f) => {
          const solid = !ghostAll
          const opacity = ghostAll ? 0.15 : 1
          const paint = paintFor('column', f.columnId, selection, hoverRef)
          const base = FOUNDATION_COLOR[f.status]
          const color = paint.emissiveIntensity > 0 ? paint.color : base
          return (
            <mesh
              key={f.key}
              position={f.position}
              castShadow={false}
              receiveShadow
              userData={{ kind: 'column', id: f.columnId }}
              raycast={DEFAULT_RAYCAST}
              onClick={handleClick('column', f.columnId)}
              onPointerOver={handleOver('column', f.columnId)}
              onPointerOut={handleOut('column', f.columnId)}
            >
              {f.shape === 'cyl' ? (
                <cylinderGeometry args={[f.size[0] / 2, f.size[0] / 2, f.size[1], 24]} />
              ) : (
                <boxGeometry args={f.size} />
              )}
              <meshStandardMaterial
                color={color}
                roughness={0.95}
                metalness={0.03}
                transparent={!solid}
                opacity={opacity}
                depthWrite={solid}
                emissive={paint.emissive}
                emissiveIntensity={paint.emissiveIntensity}
              />
              {solid && f.shape === 'box' && <Edges threshold={20} color={EDGE_COLOR} />}
            </mesh>
          )
        })}

      {showRegions &&
        regionSolids.map((r) => {
          const faded = isolate && !r.levels.includes(activeIdx)
          const solid = !faded && !ghostAll
          const opacity = faded ? 0.07 : ghostAll ? 0.15 : 1
          const selected =
            selection?.kind === 'loadRegion' && selection.id === r.id
          const hovered = hoverRef?.kind === 'loadRegion' && hoverRef.id === r.id
          const base = REGION_COLOR[r.regionKind]
          const color = selected ? SEL_COLOR : hovered ? lighten(base) : base
          return (
            <mesh
              key={r.key}
              position={r.position}
              rotation={[0, r.rotationY, r.rotationZ]}
              castShadow={solid}
              receiveShadow
              userData={{ kind: 'loadRegion', id: r.id }}
              raycast={faded ? NO_RAYCAST : DEFAULT_RAYCAST}
              onClick={faded ? undefined : handleClick('loadRegion', r.id)}
              onPointerOver={faded ? undefined : handleOver('loadRegion', r.id)}
              onPointerOut={faded ? undefined : handleOut('loadRegion', r.id)}
            >
              <boxGeometry args={r.size} />
              <meshStandardMaterial
                color={color}
                roughness={0.9}
                metalness={0.05}
                transparent={!solid}
                opacity={opacity}
                depthWrite={solid}
                emissive={selected ? SEL_COLOR : '#000000'}
                emissiveIntensity={selected ? 0.35 : 0}
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

interface PrismMeshProps {
  box: BoxInstance
  paint: Paint
  opacity: number
  solid: boolean
  faded: boolean
  onClick?: (e: ThreeEvent<MouseEvent>) => void
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
}

/** pilar de seção em L: extrusão vertical do contorno em planta */
function PrismMesh({
  box,
  paint,
  opacity,
  solid,
  faded,
  onClick,
  onPointerOver,
  onPointerOut,
}: PrismMeshProps) {
  const zBot = box.position[1] - box.size[1] / 2
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    const poly = box.prism!.polygon
    poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: box.size[1], bevelEnabled: false })
  }, [box.prism, box.size])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      position={[0, zBot, 0]}
      castShadow={solid}
      receiveShadow
      userData={{ kind: box.kind, id: box.id }}
      raycast={faded ? NO_RAYCAST : DEFAULT_RAYCAST}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
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
}

/** viga com furos na alma: elevação local (x ao longo, y na altura) com holes,
 *  extrudada pela largura bw — mesma pose do boxGeometry que substitui */
function WebBoxMesh({
  box,
  paint,
  opacity,
  solid,
  faded,
  onClick,
  onPointerOver,
  onPointerOut,
}: PrismMeshProps) {
  const geometry = useMemo(() => {
    const [len, h, bw] = box.size
    const shape = new THREE.Shape()
    shape.moveTo(-len / 2, -h / 2)
    shape.lineTo(len / 2, -h / 2)
    shape.lineTo(len / 2, h / 2)
    shape.lineTo(-len / 2, h / 2)
    shape.closePath()
    for (const o of box.webHoles!) {
      const path = new THREE.Path()
      path.moveTo(o.x - o.w / 2, o.y - o.h / 2)
      path.lineTo(o.x + o.w / 2, o.y - o.h / 2)
      path.lineTo(o.x + o.w / 2, o.y + o.h / 2)
      path.lineTo(o.x - o.w / 2, o.y + o.h / 2)
      path.closePath()
      shape.holes.push(path)
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: bw, bevelEnabled: false })
    g.translate(0, 0, -bw / 2) // centra a extrusão como o boxGeometry
    return g
  }, [box.size, box.webHoles])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      position={box.position}
      rotation-y={box.rotationY}
      castShadow={solid}
      receiveShadow
      userData={{ kind: box.kind, id: box.id }}
      raycast={faded ? NO_RAYCAST : DEFAULT_RAYCAST}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
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
}

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
  // com o topo de vigas/pilares, coplanares). Furos/aberturas viram holes.
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    slab.polygon.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    for (const hole of slab.holes) {
      const path = new THREE.Path()
      hole.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)))
      path.closePath()
      shape.holes.push(path)
    }
    return new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false })
  }, [slab.polygon, slab.holes, slab.thickness])
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
