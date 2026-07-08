import { useMemo, type ReactNode } from 'react'
import {
  CONCRETE_CLASSES,
  FINISH_LOAD_PRESETS,
  LIVE_LOAD_PRESETS,
  WALL_PRESETS,
  dist,
  polygonArea,
  type Beam,
  type Column,
  type Project,
  type Slab,
  type WallLoad,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField } from './NumberField'
import { cm, fmt, ROMAN } from './format'
import { IconTrash } from '../components/Icons'

// ---------------------------------------------------------------------------
// blocos reutilizáveis
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        padding: '3px 0',
        fontSize: 12,
      }}
    >
      <span className="muted" style={{ flex: 'none' }}>
        {label}
      </span>
      <span
        className="mono"
        style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12.5,
        padding: '3px 0',
        cursor: 'pointer',
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="btn"
      style={{
        width: '100%',
        marginTop: 14,
        color: 'var(--err)',
        borderColor: 'rgba(255, 92, 105, 0.45)',
      }}
      onClick={onClick}
    >
      <IconTrash size={14} />
      Excluir
    </button>
  )
}

function RotationSelect({ value, onChange }: { value: 0 | 90; onChange: (v: 0 | 90) => void }) {
  return (
    <select
      className="select"
      style={{ width: '100%' }}
      value={String(value)}
      onChange={(e) => onChange(e.target.value === '90' ? 90 : 0)}
    >
      <option value="0">0° — h ao longo de X</option>
      <option value="90">90° — h ao longo de Y</option>
    </select>
  )
}

// ---------------------------------------------------------------------------
// projeto (nada selecionado)
// ---------------------------------------------------------------------------

function ProjectInspector({ project }: { project: Project }) {
  const display = useStore((s) => s.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const defaults = useStore((s) => s.defaults)
  const setDefaults = useStore((s) => s.setDefaults)

  const floors = project.levels.filter((l) => l.planId !== null).length
  const height = project.levels[project.levels.length - 1]?.elevation ?? 0
  const concreteLabel =
    CONCRETE_CLASSES.find((c) => c.fck === project.settings.concrete.fck)?.label ??
    `${fmt(project.settings.concrete.fck / 1000, 0)} MPa`
  const wind = project.settings.wind

  const finishMatch = FINISH_LOAD_PRESETS.find((p) => Math.abs(p.g - defaults.slabFinish) < 1e-9)
  const liveMatch = LIVE_LOAD_PRESETS.find(
    (p) => p.label === defaults.slabLiveLabel && Math.abs(p.q - defaults.slabLive) < 1e-9,
  )
  const wallMatch = WALL_PRESETS.find((p) => p.label === defaults.wallLabel)

  return (
    <>
      <h3 className="panel-title">Projeto</h3>
      <Row label="Nome" value={project.name} />
      <Row label="Pavimentos" value={String(floors)} />
      <Row label="Altura total" value={`${fmt(height, 2)} m`} />
      <Row label="Concreto" value={concreteLabel} />
      <Row
        label="Vento"
        value={
          wind.enabled
            ? `V0 ${fmt(wind.v0, 0)} m/s · cat. ${ROMAN[wind.category - 1]}`
            : 'desconsiderado'
        }
      />
      <Row label="Pilares" value={String(project.columns.length)} />

      <div className="panel-section">
        <h3 className="panel-title">Exibição</h3>
        <Check label="Eixos" checked={display.showAxes} onChange={(v) => setDisplay({ showAxes: v })} />
        <Check label="Cotas" checked={display.showDims} onChange={(v) => setDisplay({ showDims: v })} />
        <Check label="Nomes" checked={display.showNames} onChange={(v) => setDisplay({ showNames: v })} />
        <Check label="Cargas" checked={display.showLoads} onChange={(v) => setDisplay({ showLoads: v })} />
        <Check label="Lajes" checked={display.showSlabs} onChange={(v) => setDisplay({ showSlabs: v })} />
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Padrões de inserção</h3>

        <div className="field">
          <label className="label">Pilar — seção bw × h (cm)</label>
          <div className="field-row">
            <NumberField
              value={cm(defaults.columnSection.bw)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) =>
                setDefaults({ columnSection: { ...defaults.columnSection, bw: v / 100 } })
              }
            />
            <NumberField
              value={cm(defaults.columnSection.h)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) =>
                setDefaults({ columnSection: { ...defaults.columnSection, h: v / 100 } })
              }
            />
          </div>
        </div>

        <div className="field">
          <label className="label">Pilar — rotação</label>
          <RotationSelect
            value={defaults.columnRotation}
            onChange={(v) => setDefaults({ columnRotation: v })}
          />
        </div>

        <div className="field">
          <label className="label">Viga — seção bw × h (cm)</label>
          <div className="field-row">
            <NumberField
              value={cm(defaults.beamSection.bw)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) => setDefaults({ beamSection: { ...defaults.beamSection, bw: v / 100 } })}
            />
            <NumberField
              value={cm(defaults.beamSection.h)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) => setDefaults({ beamSection: { ...defaults.beamSection, h: v / 100 } })}
            />
          </div>
        </div>

        <div className="field">
          <label className="label">Laje — espessura (cm)</label>
          <NumberField
            value={cm(defaults.slabThickness)}
            digits={1}
            min={5}
            max={60}
            style={{ width: '100%' }}
            onCommit={(v) => setDefaults({ slabThickness: v / 100 })}
          />
        </div>

        <div className="field">
          <label className="label">Laje — revestimento g₂ (kN/m²)</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={finishMatch ? String(finishMatch.g) : 'custom'}
            onChange={(e) => {
              const p = FINISH_LOAD_PRESETS.find((x) => String(x.g) === e.target.value)
              if (p) setDefaults({ slabFinish: p.g })
            }}
          >
            {!finishMatch && (
              <option value="custom" disabled>
                Personalizado — {fmt(defaults.slabFinish, 2)} kN/m²
              </option>
            )}
            {FINISH_LOAD_PRESETS.map((p) => (
              <option key={p.label} value={String(p.g)}>
                {p.label} — {fmt(p.g, 1)} kN/m²
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Laje — sobrecarga q (NBR 6120)</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={liveMatch ? liveMatch.label : 'custom'}
            onChange={(e) => {
              const p = LIVE_LOAD_PRESETS.find((x) => x.label === e.target.value)
              if (p) setDefaults({ slabLive: p.q, slabLiveLabel: p.label })
            }}
          >
            {!liveMatch && (
              <option value="custom" disabled>
                Personalizado — {fmt(defaults.slabLive, 2)} kN/m²
              </option>
            )}
            {LIVE_LOAD_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} — {fmt(p.q, 1)} kN/m²
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Parede sobre viga (pé-direito 2,40 m)</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={wallMatch ? wallMatch.label : 'custom'}
            onChange={(e) => {
              const p = WALL_PRESETS.find((x) => x.label === e.target.value)
              if (p)
                setDefaults({
                  wallW: Math.round(p.wPerArea * 2.4 * 10) / 10,
                  wallLabel: p.label,
                })
            }}
          >
            {!wallMatch && (
              <option value="custom" disabled>
                {defaults.wallLabel || 'Personalizado'}
              </option>
            )}
            {WALL_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} — {fmt(Math.round(p.wPerArea * 2.4 * 10) / 10, 1)} kN/m
              </option>
            ))}
          </select>
          <div className="field-row" style={{ marginTop: 6, alignItems: 'center' }}>
            <NumberField
              value={defaults.wallW}
              digits={2}
              min={0}
              max={100}
              onCommit={(v) => setDefaults({ wallW: v })}
            />
            <span className="unit" style={{ flex: 'none' }}>
              kN/m
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// pilar
// ---------------------------------------------------------------------------

function ColumnInspector({ col }: { col: Column }) {
  const updateColumn = useStore((s) => s.updateColumn)
  const deleteElement = useStore((s) => s.deleteElement)

  return (
    <>
      <h3 className="panel-title">Pilar {col.name}</h3>

      <div className="field">
        <label className="label">Nome</label>
        <input
          className="input"
          style={{ width: '100%' }}
          value={col.name}
          spellCheck={false}
          onChange={(e) => updateColumn(col.id, { name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="label">Posição x · y (m)</label>
        <div className="field-row">
          <NumberField
            value={col.pos.x}
            digits={2}
            trim={false}
            onCommit={(v) => updateColumn(col.id, { pos: { ...col.pos, x: v } })}
          />
          <NumberField
            value={col.pos.y}
            digits={2}
            trim={false}
            onCommit={(v) => updateColumn(col.id, { pos: { ...col.pos, y: v } })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Seção bw × h (cm)</label>
        <div className="field-row">
          <NumberField
            value={cm(col.section.bw)}
            digits={1}
            min={10}
            max={300}
            onCommit={(v) => updateColumn(col.id, { section: { ...col.section, bw: v / 100 } })}
          />
          <NumberField
            value={cm(col.section.h)}
            digits={1}
            min={10}
            max={300}
            onCommit={(v) => updateColumn(col.id, { section: { ...col.section, h: v / 100 } })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Rotação</label>
        <RotationSelect value={col.rotationDeg} onChange={(v) => updateColumn(col.id, { rotationDeg: v })} />
      </div>

      <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>
        Contínuo da fundação ao topo
      </div>

      <DeleteButton onClick={() => deleteElement({ kind: 'column', id: col.id })} />
    </>
  )
}

// ---------------------------------------------------------------------------
// viga
// ---------------------------------------------------------------------------

function BeamInspector({ beam }: { beam: Beam }) {
  const updateBeam = useStore((s) => s.updateBeam)
  const deleteElement = useStore((s) => s.deleteElement)

  const length = useMemo(() => {
    let L = 0
    for (let i = 0; i + 1 < beam.path.length; i++) L += dist(beam.path[i], beam.path[i + 1])
    return L
  }, [beam.path])

  return (
    <>
      <h3 className="panel-title">Viga {beam.name}</h3>

      <div className="field">
        <label className="label">Nome</label>
        <input
          className="input"
          style={{ width: '100%' }}
          value={beam.name}
          spellCheck={false}
          onChange={(e) => updateBeam(beam.id, { name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="label">Seção bw × h (cm)</label>
        <div className="field-row">
          <NumberField
            value={cm(beam.section.bw)}
            digits={1}
            min={10}
            max={300}
            onCommit={(v) => updateBeam(beam.id, { section: { ...beam.section, bw: v / 100 } })}
          />
          <NumberField
            value={cm(beam.section.h)}
            digits={1}
            min={10}
            max={300}
            onCommit={(v) => updateBeam(beam.id, { section: { ...beam.section, h: v / 100 } })}
          />
        </div>
      </div>

      <Row label="Comprimento total" value={`${fmt(length, 2)} m`} />

      <DeleteButton onClick={() => deleteElement({ kind: 'beam', id: beam.id })} />
    </>
  )
}

// ---------------------------------------------------------------------------
// laje
// ---------------------------------------------------------------------------

function SlabInspector({ slab }: { slab: Slab }) {
  const updateSlab = useStore((s) => s.updateSlab)
  const deleteElement = useStore((s) => s.deleteElement)

  const area = useMemo(() => polygonArea(slab.polygon), [slab.polygon])
  const finishMatch = FINISH_LOAD_PRESETS.find((p) => Math.abs(p.g - slab.finishLoad) < 1e-9)
  const liveMatch = LIVE_LOAD_PRESETS.find(
    (p) => p.label === slab.liveLoadLabel && Math.abs(p.q - slab.liveLoad) < 1e-9,
  )

  return (
    <>
      <h3 className="panel-title">Laje {slab.name}</h3>

      <div className="field">
        <label className="label">Nome</label>
        <input
          className="input"
          style={{ width: '100%' }}
          value={slab.name}
          spellCheck={false}
          onChange={(e) => updateSlab(slab.id, { name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="label">Espessura (cm)</label>
        <NumberField
          value={cm(slab.thickness)}
          digits={1}
          min={5}
          max={60}
          style={{ width: '100%' }}
          onCommit={(v) => updateSlab(slab.id, { thickness: v / 100 })}
        />
      </div>

      <div className="field">
        <label className="label">Revestimento g₂ (kN/m²)</label>
        <NumberField
          value={slab.finishLoad}
          digits={2}
          min={0}
          max={50}
          style={{ width: '100%' }}
          onCommit={(v) => updateSlab(slab.id, { finishLoad: v })}
        />
        <select
          className="select"
          style={{ width: '100%', marginTop: 6 }}
          value={finishMatch ? String(finishMatch.g) : 'custom'}
          onChange={(e) => {
            const p = FINISH_LOAD_PRESETS.find((x) => String(x.g) === e.target.value)
            if (p) updateSlab(slab.id, { finishLoad: p.g })
          }}
        >
          {!finishMatch && (
            <option value="custom" disabled>
              Personalizado — {fmt(slab.finishLoad, 2)} kN/m²
            </option>
          )}
          {FINISH_LOAD_PRESETS.map((p) => (
            <option key={p.label} value={String(p.g)}>
              {p.label} — {fmt(p.g, 1)} kN/m²
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">Sobrecarga q (kN/m² — NBR 6120)</label>
        <NumberField
          value={slab.liveLoad}
          digits={2}
          min={0}
          max={50}
          style={{ width: '100%' }}
          onCommit={(v) => updateSlab(slab.id, { liveLoad: v, liveLoadLabel: undefined })}
        />
        <select
          className="select"
          style={{ width: '100%', marginTop: 6 }}
          value={liveMatch ? liveMatch.label : 'custom'}
          onChange={(e) => {
            const p = LIVE_LOAD_PRESETS.find((x) => x.label === e.target.value)
            if (p) updateSlab(slab.id, { liveLoad: p.q, liveLoadLabel: p.label })
          }}
        >
          {!liveMatch && (
            <option value="custom" disabled>
              Personalizado — {fmt(slab.liveLoad, 2)} kN/m²
            </option>
          )}
          {LIVE_LOAD_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} — {fmt(p.q, 1)} kN/m²
            </option>
          ))}
        </select>
      </div>

      <Row label="Área" value={`${fmt(area, 2)} m²`} />

      <DeleteButton onClick={() => deleteElement({ kind: 'slab', id: slab.id })} />
    </>
  )
}

// ---------------------------------------------------------------------------
// carga de parede
// ---------------------------------------------------------------------------

function WallLoadInspector({ wl, project }: { wl: WallLoad; project: Project }) {
  const updateWallLoad = useStore((s) => s.updateWallLoad)
  const deleteElement = useStore((s) => s.deleteElement)

  const beam = project.plans.flatMap((p) => p.beams).find((b) => b.id === wl.beamId)
  const wallMatch = WALL_PRESETS.find((p) => p.label === wl.label)

  return (
    <>
      <h3 className="panel-title">Carga de parede</h3>

      <Row label="Sobre a viga" value={beam?.name ?? '?'} />
      {wl.label ? <Row label="Tipo" value={wl.label} /> : null}

      <div className="field" style={{ marginTop: 8 }}>
        <label className="label">Carga w (kN/m)</label>
        <NumberField
          value={wl.w}
          digits={2}
          min={0}
          max={100}
          style={{ width: '100%' }}
          onCommit={(v) => updateWallLoad(wl.id, { w: v })}
        />
      </div>

      <div className="field">
        <label className="label">Preset (pé-direito 2,40 m)</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={wallMatch ? wallMatch.label : 'custom'}
          onChange={(e) => {
            const p = WALL_PRESETS.find((x) => x.label === e.target.value)
            if (p)
              updateWallLoad(wl.id, {
                w: Math.round(p.wPerArea * 2.4 * 10) / 10,
                label: p.label,
              })
          }}
        >
          {!wallMatch && (
            <option value="custom" disabled>
              {wl.label || 'Personalizado'} — {fmt(wl.w, 1)} kN/m
            </option>
          )}
          {WALL_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} — {fmt(Math.round(p.wPerArea * 2.4 * 10) / 10, 1)} kN/m
            </option>
          ))}
        </select>
      </div>

      <DeleteButton onClick={() => deleteElement({ kind: 'wallLoad', id: wl.id })} />
    </>
  )
}

// ---------------------------------------------------------------------------
// painel (raiz)
// ---------------------------------------------------------------------------

export default function InspectorPanel() {
  const selection = useStore((s) => s.selection)
  const project = useStore((s) => s.project)

  let content: ReactNode = null
  if (selection) {
    if (selection.kind === 'column') {
      const col = project.columns.find((c) => c.id === selection.id)
      if (col) content = <ColumnInspector key={col.id} col={col} />
    } else if (selection.kind === 'beam') {
      const beam = project.plans.flatMap((p) => p.beams).find((b) => b.id === selection.id)
      if (beam) content = <BeamInspector key={beam.id} beam={beam} />
    } else if (selection.kind === 'slab') {
      const slab = project.plans.flatMap((p) => p.slabs).find((x) => x.id === selection.id)
      if (slab) content = <SlabInspector key={slab.id} slab={slab} />
    } else {
      const wl = project.plans.flatMap((p) => p.wallLoads).find((w) => w.id === selection.id)
      if (wl) content = <WallLoadInspector key={wl.id} wl={wl} project={project} />
    }
  }
  if (!content) content = <ProjectInspector project={project} />

  return <div className="panel">{content}</div>
}
