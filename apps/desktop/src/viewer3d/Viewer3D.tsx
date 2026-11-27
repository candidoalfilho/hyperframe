import { useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { buildRebar3D } from '@hyperframe/engine'
import { useStore } from '../store'
import { computeBounds, NO_RAYCAST } from './coords'
import Building from './Building'
import DeformedShape from './DeformedShape'
import DiagramRibbons from './DiagramRibbons'
import ControlPanel from './ControlPanel'
import Rebar3D from './Rebar3D'
import RebarCard from './RebarCard'
import { filterRebar } from './rebarGeometry'

/** Visualizador 3D do edifício (three.js é y-up; mundo → three: [x, cota, -y]). */
export default function Viewer3D() {
  const project = useStore((s) => s.project)
  const select = useStore((s) => s.select)

  const bounds = useMemo(() => computeBounds(project), [project])

  // ---- armaduras (issue #25): barras do detalhamento, filtradas pela exibição
  const results = useStore((s) => s.results)
  const showRebar = useStore((s) => s.d3.showRebar)
  const rebarCats = useStore((s) => s.d3.rebarCats)
  const rebarElement = useStore((s) => s.d3.rebarElement)
  const rebarSel = useStore((s) => s.d3.rebarSel)
  const isolateLevel = useStore((s) => s.d3.isolateActiveLevel)
  const activeLevelId = useStore((s) => s.activeLevelId)
  const setD3 = useStore((s) => s.setD3)
  const rebarAll = useMemo(() => {
    if (!showRebar || !results) return []
    const li = project.levels.findIndex((l) => l.id === activeLevelId)
    return buildRebar3D(project, results, isolateLevel && li >= 0 ? { levels: [li] } : {})
  }, [showRebar, results, project, isolateLevel, activeLevelId])
  const rebar = useMemo(
    () => filterRebar(rebarAll, { cats: rebarCats, element: rebarElement }),
    [rebarAll, rebarCats, rebarElement],
  )
  const rebarGroup = rebar.find((g) => g.id === rebarSel) ?? null
  const shadowExt = Math.ceil(bounds.originRadius + 10)
  // cores do cenário vêm dos tokens CSS do tema ativo (dark/light)
  const theme = useStore((s) => s.theme)
  const scene = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb
    return {
      bg: v('--canvas-bg', '#1a1712'),
      cell: v('--grid-line', '#272216'),
      section: v('--grid-strong', '#39321f'),
      label: v('--text', '#f0ece2'),
    }
  }, [theme])
  // guarda a posição do pointerdown p/ não desselecionar ao soltar um arrasto do orbit
  const downAt = useRef<{ x: number; y: number } | null>(null)

  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  /** zoom por botão: aproxima/afasta a câmera do alvo (funciona sem roda) */
  const zoomBy = (f: number): void => {
    const c = controlsRef.current
    if (!c) return
    c.object.position.sub(c.target).multiplyScalar(1 / f).add(c.target)
    c.update()
  }
  const resetView = (): void => {
    const c = controlsRef.current
    if (!c) return
    c.reset()
    c.target.set(bounds.center[0], bounds.center[1], bounds.center[2])
    c.update()
  }

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDownCapture={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [25, 20, 25], fov: 45, near: 0.1, far: 2000 }}
        onCreated={(state) => {
          // só em desenvolvimento: cena à mão para os roteiros de verificação
          if (import.meta.env.DEV) (window as unknown as { __hfThree?: unknown }).__hfThree = state
        }}
        onPointerMissed={(e) => {
          const d = downAt.current
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
          select(null)
        }}
      >
        <color attach="background" args={[scene.bg]} />

        <ambientLight intensity={0.55} />
        <directionalLight
          key={`dl-${shadowExt}`}
          position={[30, 50, 20]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowExt}
          shadow-camera-right={shadowExt}
          shadow-camera-top={shadowExt}
          shadow-camera-bottom={-shadowExt}
          shadow-camera-near={1}
          shadow-camera-far={500}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        />

        {/* plano invisível que recebe a sombra do edifício (contato com o chão) */}
        <mesh
          rotation-x={-Math.PI / 2}
          position={[bounds.center[0], -0.005, bounds.center[2]]}
          receiveShadow
          raycast={NO_RAYCAST}
        >
          <planeGeometry args={[shadowExt * 4, shadowExt * 4]} />
          <shadowMaterial transparent opacity={0.3} depthWrite={false} />
        </mesh>

        <Grid
          position={[0, -0.01, 0]}
          infiniteGrid
          followCamera={false}
          cellSize={1}
          sectionSize={5}
          cellColor={scene.cell}
          sectionColor={scene.section}
          fadeDistance={80}
          fadeStrength={1}
          raycast={NO_RAYCAST}
        />

        <Building />
        <DeformedShape />
        <DiagramRibbons />
        {showRebar && results && (
          <Rebar3D groups={rebar} selectedId={rebarGroup?.id ?? null} onSelect={(id) => setD3({ rebarSel: id })} />
        )}

        <OrbitControls
          ref={controlsRef}
          makeDefault
          target={bounds.center}
          enableDamping
          dampingFactor={0.1}
        />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport
            axisColors={['#ff5c69', '#3ecf8e', '#4da3ff']}
            labelColor={scene.label}
          />
        </GizmoHelper>
      </Canvas>

      <ControlPanel />

      {showRebar && results && rebarGroup && (
        <RebarCard
          group={rebarGroup}
          levelName={
            rebarGroup.elementKind === 'beam'
              ? (project.levels[rebarGroup.levelIndex]?.name ?? '')
              : `${project.levels[rebarGroup.levelIndex]?.name ?? ''} → ${project.levels[rebarGroup.levelTop ?? rebarGroup.levelIndex]?.name ?? ''}`
          }
          steelRow={
            results.detailing.steel.items.find(
              (it) => it.elementId === rebarGroup.elementId && it.pos === rebarGroup.pos,
            ) ?? null
          }
          isolated={rebarElement?.id === rebarGroup.elementId}
          onIsolate={(on) =>
            setD3({ rebarElement: on ? { kind: rebarGroup.elementKind, id: rebarGroup.elementId } : null })
          }
          onClose={() => setD3({ rebarSel: null })}
        />
      )}

      {(
        [
          ['+', 'Aproximar (ou role a roda do mouse)', 8, () => zoomBy(1.3)],
          ['−', 'Afastar', 44, () => zoomBy(1 / 1.3)],
          ['⛶', 'Vista inicial', 80, resetView],
        ] as const
      ).map(([label, title, top, fn]) => (
        <button
          key={label}
          type="button"
          className="btn-icon"
          title={title}
          onClick={(e) => {
            fn()
            e.currentTarget.blur()
          }}
          style={{
            position: 'absolute',
            top,
            right: 8,
            zIndex: 4,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            fontSize: 15,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
