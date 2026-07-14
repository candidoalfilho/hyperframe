import { useState, type CSSProperties } from 'react'
import type { LoadCombo } from '@hyperframe/engine'
import { useStore, type Diagram3D } from '../store'
import { IconChevronDown } from '../components/Icons'

/** Painel de controle do 3D (HTML sobreposto, canto superior esquerdo). */

const MIN_SCALE = 10
const MAX_SCALE = 1000

function scaleToT(scale: number): number {
  const t = Math.round((100 * Math.log(scale / MIN_SCALE)) / Math.log(MAX_SCALE / MIN_SCALE))
  return Math.min(100, Math.max(0, t))
}
function tToScale(t: number): number {
  return Math.round(MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, t / 100))
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  zIndex: 2,
  minWidth: 186,
  maxWidth: 220,
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  pointerEvents: 'auto',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  cursor: 'pointer',
  userSelect: 'none',
  fontWeight: 600,
  color: 'var(--text-dim)',
}
const checkStyle: CSSProperties = { accentColor: 'var(--accent)', margin: 0 }
const dimStyle: CSSProperties = { color: 'var(--text-dim)', marginBottom: 2 }
const selectStyle: CSSProperties = {
  width: '100%',
  height: 22,
  fontSize: 11,
  fontFamily: 'var(--sans)',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 5,
  outline: 'none',
}

export default function ControlPanel() {
  const d3 = useStore((s) => s.d3)
  const setD3 = useStore((s) => s.setD3)
  const results = useStore((s) => s.results)
  const [collapsed, setCollapsed] = useState(false)

  const combos: LoadCombo[] = results?.combos ?? []
  const elu = combos.filter((c) => c.type === 'ELU')
  const els = combos.filter((c) => c.type !== 'ELU')

  return (
    <div style={{ ...panelStyle, minWidth: collapsed ? 0 : panelStyle.minWidth }}>
      <div
        style={headerStyle}
        title={collapsed ? 'Expandir painel' : 'Recolher painel'}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span>Exibição</span>
        <IconChevronDown
          size={12}
          style={{
            transform: collapsed ? 'rotate(-90deg)' : undefined,
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
      </div>
      {collapsed ? null : (
        <>
      <label style={rowStyle}>
        <input
          type="checkbox"
          style={checkStyle}
          checked={d3.showSlabs}
          onChange={(e) => setD3({ showSlabs: e.currentTarget.checked })}
        />
        Lajes
      </label>
      <label style={rowStyle}>
        <input
          type="checkbox"
          style={checkStyle}
          checked={d3.showRegions}
          onChange={(e) => setD3({ showRegions: e.currentTarget.checked })}
        />
        Escadas e reservatórios
      </label>
      <label style={rowStyle}>
        <input
          type="checkbox"
          style={checkStyle}
          checked={d3.isolateActiveLevel}
          onChange={(e) => setD3({ isolateActiveLevel: e.currentTarget.checked })}
        />
        Isolar pavimento ativo
      </label>

      {results && (
        <>
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
          <label style={rowStyle}>
            <input
              type="checkbox"
              style={checkStyle}
              checked={d3.showDeformed}
              onChange={(e) => setD3({ showDeformed: e.currentTarget.checked })}
            />
            Deformada
          </label>
          <div>
            <div style={dimStyle}>
              Escala <span className="mono">×{d3.deformScale}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={scaleToT(d3.deformScale)}
              disabled={!d3.showDeformed}
              onChange={(e) => setD3({ deformScale: tToScale(Number(e.currentTarget.value)) })}
              style={{ width: '100%', margin: 0, accentColor: 'var(--accent)' }}
            />
          </div>
          <div>
            <div style={dimStyle}>Diagrama</div>
            <select
              style={selectStyle}
              value={d3.diagram}
              onChange={(e) => setD3({ diagram: e.currentTarget.value as Diagram3D })}
            >
              <option value="none">Nenhum</option>
              <option value="N">N</option>
              <option value="My">My</option>
              <option value="Mz">Mz</option>
            </select>
          </div>
          <div>
            <div style={dimStyle}>Combinação</div>
            <select
              style={selectStyle}
              value={d3.activeComboId ?? ''}
              onChange={(e) => setD3({ activeComboId: e.currentTarget.value || null })}
            >
              {d3.activeComboId === null && <option value="">— selecione —</option>}
              {elu.length > 0 && (
                <optgroup label="ELU">
                  {elu.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {els.length > 0 && (
                <optgroup label="ELS">
                  {els.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </>
      )}
        </>
      )}
    </div>
  )
}
