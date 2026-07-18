import { useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStore } from '../store'
import { computeBounds, NO_RAYCAST } from './coords'
import Building from './Building'
import DeformedShape from './DeformedShape'
import DiagramRibbons from './DiagramRibbons'
import ControlPanel from './ControlPanel'

/** Visualizador 3D do edifício (three.js é y-up; mundo → three: [x, cota, -y]). */
export default function Viewer3D() {
  const project = useStore((s) => s.project)
  const select = useStore((s) => s.select)

  const bounds = useMemo(() => computeBounds(project), [project])
  const shadowExt = Math.ceil(bounds.originRadius + 10)
  const bg = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() ||
      '#191b21',
    [],
  )
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
        onPointerMissed={(e) => {
          const d = downAt.current
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
          select(null)
        }}
      >
        <color attach="background" args={[bg]} />

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
          cellColor="#262a34"
          sectionColor="#323644"
          fadeDistance={80}
          fadeStrength={1}
          raycast={NO_RAYCAST}
        />

        <Building />
        <DeformedShape />
        <DiagramRibbons />

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
            labelColor="#e8eaf0"
          />
        </GizmoHelper>
      </Canvas>

      <ControlPanel />

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
