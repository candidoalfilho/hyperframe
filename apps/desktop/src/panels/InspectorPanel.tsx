import { useMemo, useRef, type ChangeEvent, type ReactNode } from 'react'
import {
  CONCRETE_CLASSES,
  FINISH_LOAD_PRESETS,
  LIVE_LOAD_PRESETS,
  REGION_PRESETS,
  RIBBED_DEFAULTS,
  RIBBED_FILLER_PRESETS,
  STAIR_DEFAULTS,
  TANK_DEFAULTS,
  WALL_PRESETS,
  columnSectionInfo,
  concreteProps,
  designCorbel,
  fyd as fydOf,
  uid as uidGen,
  dist,
  parseDxf,
  polygonArea,
  uid,
  type Beam,
  type BeamOpening,
  type Column,
  type LoadRegion,
  type Project,
  type FoundationOverride,
  type SectionRect,
  type Slab,
  type WallLoad,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField } from './NumberField'
import { cm, fmt, ROMAN } from './format'
import { IconTrash } from '../components/Icons'
import PlansManager from './PlansManager'
import { MemberForcesSection } from './MemberDiagrams'

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

function RotationSelect({
  value,
  onChange,
}: {
  value: 0 | 90 | 180 | 270
  onChange: (v: 0 | 90 | 180 | 270) => void
}) {
  return (
    <select
      className="select"
      style={{ width: '100%' }}
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value) as 0 | 90 | 180 | 270)}
    >
      <option value="0">0° — h ao longo de X</option>
      <option value="90">90° — h ao longo de Y</option>
      <option value="180">180° — h ao longo de −X</option>
      <option value="270">270° — h ao longo de −Y</option>
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
  const activeLevelId = useStore((s) => s.activeLevelId)
  const setPlansManagerOpen = useStore((s) => s.setPlansManagerOpen)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const updateUnderlay = useStore((s) => s.updateUnderlay)
  const dxfInputRef = useRef<HTMLInputElement>(null)

  const activeLevel = project.levels.find((l) => l.id === activeLevelId)
  const activePlan = activeLevel?.planId
    ? project.plans.find((p) => p.id === activeLevel.planId) ?? null
    : null
  const underlay = project.underlay ?? null

  const onDxfFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite reimportar o mesmo arquivo
    if (!file) return
    try {
      const text = await file.text()
      const entities = parseDxf(text)
      if (entities.length === 0) throw new Error('nenhuma entidade suportada encontrada')
      setUnderlay({
        entities,
        scale: 1,
        offset: { x: 0, y: 0 },
        visible: true,
        opacity: 0.45,
        fileName: file.name,
      })
    } catch (err) {
      alert(
        `Não foi possível importar o DXF: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

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
        <h3 className="panel-title">Plantas de forma</h3>
        <Row label="Planta atual" value={activePlan ? activePlan.name : '— sem planta —'} />
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          onClick={() => setPlansManagerOpen(true)}
        >
          Gerenciar plantas…
        </button>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Underlay DXF</h3>
        {!underlay ? (
          <>
            <input
              ref={dxfInputRef}
              type="file"
              accept=".dxf"
              style={{ display: 'none' }}
              onChange={onDxfFile}
            />
            <button
              className="btn"
              style={{ width: '100%' }}
              onClick={() => dxfInputRef.current?.click()}
            >
              Importar DXF…
            </button>
          </>
        ) : (
          <>
            <Row label="Arquivo" value={underlay.fileName ?? 'DXF'} />
            <Row label="Entidades" value={String(underlay.entities.length)} />
            <Check
              label="Visível"
              checked={underlay.visible}
              onChange={(v) => updateUnderlay({ visible: v })}
            />
            <div className="field" style={{ marginTop: 6 }}>
              <label className="label">Opacidade — {fmt(underlay.opacity * 100, 0)}%</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={underlay.opacity}
                style={{ width: '100%' }}
                onChange={(e) => updateUnderlay({ opacity: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="label">Escala (unidade do desenho)</label>
              <select
                className="select"
                style={{ width: '100%' }}
                value={String(underlay.scale)}
                onChange={(e) => updateUnderlay({ scale: Number(e.target.value) })}
              >
                {![1, 0.01, 0.001].includes(underlay.scale) && (
                  <option value={String(underlay.scale)} disabled>
                    Personalizada — ×{fmt(underlay.scale, 3)}
                  </option>
                )}
                <option value="1">metros (×1)</option>
                <option value="0.01">centímetros (×0,01)</option>
                <option value="0.001">milímetros (×0,001)</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Deslocamento x · y (m)</label>
              <div className="field-row">
                <NumberField
                  value={underlay.offset.x}
                  digits={2}
                  trim={false}
                  onCommit={(v) => updateUnderlay({ offset: { ...underlay.offset, x: v } })}
                />
                <NumberField
                  value={underlay.offset.y}
                  digits={2}
                  trim={false}
                  onCommit={(v) => updateUnderlay({ offset: { ...underlay.offset, y: v } })}
                />
              </div>
            </div>
            <button
              className="btn"
              style={{
                width: '100%',
                color: 'var(--err)',
                borderColor: 'rgba(255, 92, 105, 0.45)',
              }}
              onClick={() => setUnderlay(null)}
            >
              Remover underlay
            </button>
          </>
        )}
        <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Escala: escolha a unidade em que o DXF foi desenhado.
        </div>
      </div>

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
          <label className="label">Pilar — seção padrão bw × h (cm)</label>
          <div className="field-row">
            <NumberField
              value={cm(columnSectionInfo(defaults.columnSection).bu)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) =>
                setDefaults({
                  columnSection: { bw: v / 100, h: columnSectionInfo(defaults.columnSection).bv },
                })
              }
            />
            <NumberField
              value={cm(columnSectionInfo(defaults.columnSection).bv)}
              digits={1}
              min={10}
              max={300}
              onCommit={(v) =>
                setDefaults({
                  columnSection: { bw: columnSectionInfo(defaults.columnSection).bu, h: v / 100 },
                })
              }
            />
          </div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>
            Circular/L: mude a forma no inspetor do pilar após inserir.
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

        <div className="field">
          <label className="label">Região de carga — tipo</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={defaults.regionKind}
            onChange={(e) => {
              const p = REGION_PRESETS.find((x) => x.kind === e.target.value)
              if (p) setDefaults({ regionKind: p.kind })
            }}
          >
            {REGION_PRESETS.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label} — g {fmt(p.g, 1)} · q {fmt(p.q, 1)} kN/m²
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// pilar
// ---------------------------------------------------------------------------

function ColumnInspector({ col, project }: { col: Column; project: Project }) {
  const updateColumn = useStore((s) => s.updateColumn)
  const deleteElement = useStore((s) => s.deleteElement)

  const shape = col.section.shape === 'circle' ? 'circle' : col.section.shape === 'L' ? 'L' : 'rect'
  const setShape = (next: string) => {
    if (next === shape) return
    const info = columnSectionInfo(col.section)
    if (next === 'circle') {
      updateColumn(col.id, { section: { shape: 'circle', d: Math.max(info.bu, info.bv) } })
    } else if (next === 'L') {
      const b = Math.max(info.bu, 0.4)
      const h = Math.max(info.bv, 0.4)
      updateColumn(col.id, {
        section: { shape: 'L', b, h, tb: Math.min(0.2, b / 2), th: Math.min(0.2, h / 2) },
      })
    } else {
      updateColumn(col.id, { section: { bw: Math.max(info.minDim, 0.19), h: Math.max(info.bv, 0.4) } })
    }
  }

  const levels = project.levels
  const isTransfer = col.baseLevelId !== levels[0]?.id

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
        <label className="label">Forma da seção</label>
        <select className="select" style={{ width: '100%' }} value={shape} onChange={(e) => setShape(e.target.value)}>
          <option value="rect">Retangular</option>
          <option value="circle">Circular</option>
          <option value="L">Em L</option>
        </select>
      </div>

      {col.section.shape === 'circle' ? (
        <div className="field">
          <label className="label">Diâmetro ø (cm)</label>
          <NumberField
            value={cm(col.section.d)}
            digits={1}
            min={14}
            max={300}
            style={{ width: '100%' }}
            onCommit={(v) => updateColumn(col.id, { section: { shape: 'circle', d: v / 100 } })}
          />
        </div>
      ) : col.section.shape === 'L' ? (
        <LSectionFields colId={col.id} sec={col.section} />
      ) : (
        <RectSectionFields colId={col.id} sec={col.section} />
      )}

      {col.section.shape !== 'circle' && (
        <div className="field">
          <label className="label">Rotação</label>
          <RotationSelect
            value={col.rotationDeg}
            onChange={(v) => updateColumn(col.id, { rotationDeg: v })}
          />
        </div>
      )}

      <div className="field">
        <label className="label">Nasce em · morre em</label>
        <div className="field-row">
          <select
            className="select"
            value={col.baseLevelId}
            onChange={(e) => updateColumn(col.id, { baseLevelId: e.target.value })}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={col.topLevelId}
            onChange={(e) => updateColumn(col.id, { topLevelId: e.target.value })}
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>
        {isTransfer
          ? 'Pilar de transferência: precisa de viga sob o ponto no nível de nascimento.'
          : 'Contínuo da fundação ao topo'}
      </div>

      <CorbelSection col={col} project={project} />

      {!isTransfer && <FoundationSection col={col} project={project} />}

      <MemberForcesSection kind="column" id={col.id} />

      <DeleteButton onClick={() => deleteElement({ kind: 'column', id: col.id })} />
    </>
  )
}

const FOUNDATION_STATUS: Record<string, string> = { ok: 'OK', atencao: 'Atenção', falha: 'FALHA' }

function CorbelSection({ col, project }: { col: Column; project: Project }) {
  const updateColumn = useStore((s) => s.updateColumn)
  const cp = concreteProps(
    project.settings.concrete.fck,
    project.settings.concrete.aggregate,
    project.settings.concrete.gammaC,
  )
  const fydV = fydOf(project.settings.steel)
  const corbels = col.corbels ?? []
  const setAll = (list: typeof corbels) => updateColumn(col.id, { corbels: list })
  const upd = (id: string, patch: Partial<(typeof corbels)[number]>) =>
    setAll(corbels.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 14 }}>
        Consolos (§22.5)
      </h3>
      {corbels.map((cb) => {
        const r = designCorbel({
          fd: cb.fd,
          a: cb.a,
          d: cb.d,
          bw: cb.bw,
          hd: cb.hd,
          fck: cp.fck,
          fcd: cp.fcd,
          fyd: fydV,
        })
        return (
          <div key={cb.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 8 }}>
            <div className="field-row">
              <select
                className="select"
                value={cb.levelId}
                onChange={(e) => upd(cb.id, { levelId: e.target.value })}
              >
                {project.levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <select
                className="select"
                value={String(cb.rotationDeg)}
                onChange={(e) => upd(cb.id, { rotationDeg: Number(e.target.value) as 0 | 90 | 180 | 270 })}
              >
                <option value="0">face +X</option>
                <option value="90">face +Y</option>
                <option value="180">face −X</option>
                <option value="270">face −Y</option>
              </select>
            </div>
            <div className="field-row" style={{ marginTop: 4 }}>
              <NumberField value={cm(cb.bw)} digits={0} min={15} max={100} onCommit={(v) => upd(cb.id, { bw: v / 100 })} />
              <NumberField value={cm(cb.d)} digits={0} min={20} max={120} onCommit={(v) => upd(cb.id, { d: v / 100 })} />
              <NumberField value={cm(cb.a)} digits={0} min={5} max={120} onCommit={(v) => upd(cb.id, { a: v / 100 })} />
              <NumberField value={cb.fd} digits={0} min={1} max={5000} onCommit={(v) => upd(cb.id, { fd: v })} />
            </div>
            <div className="faint" style={{ fontSize: 10 }}>b · d · a (cm) · Fd (kN)</div>
            <div className="field-row" style={{ marginTop: 3 }}>
              <NumberField
                value={cm(cb.tipH ?? (cb.d + 0.05) / 2)}
                digits={0}
                min={cm((cb.d + 0.05) / 2)}
                max={cm(cb.d + 0.05)}
                onCommit={(v) => upd(cb.id, { tipH: v / 100 })}
              />
              <div className="faint" style={{ fontSize: 10, alignSelf: 'center' }}>
                altura da ponta (cm) — ≥ h/2 (perfil trapezoidal)
              </div>
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 3 }} title={r.notes.join(' ')}>
              {r.kind} — tirante {(r.asTie * 1e4).toFixed(1)} cm² · costura {(r.asStitch * 1e4).toFixed(1)} cm² —{' '}
              <b>{r.ok ? 'OK' : 'FALHA (biela)'}</b>
            </div>
            <button className="btn" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setAll(corbels.filter((c) => c.id !== cb.id))}>
              Remover consolo
            </button>
          </div>
        )
      })}
      <button
        className="btn"
        style={{ width: '100%', marginTop: 4 }}
        onClick={() =>
          setAll([
            ...corbels,
            { id: uidGen(), levelId: col.topLevelId, rotationDeg: 0, bw: 0.3, d: 0.5, a: 0.25, fd: 200 },
          ])
        }
      >
        + Adicionar consolo
      </button>
      {corbels.length > 0 && (
        <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>
          Fd é de CÁLCULO e não entra no pórtico automaticamente — aplicar a reação como carga no modelo se relevante.
        </div>
      )}
    </>
  )
}

function FoundationSection({ col, project }: { col: Column; project: Project }) {
  const setFoundationOverride = useStore((s) => s.setFoundationOverride)
  const clearFoundationOverride = useStore((s) => s.clearFoundationOverride)
  const item = useStore((s) => s.results?.foundations.find((f) => f.columnId === col.id) ?? null)
  const ov = project.foundationOverrides?.find((o) => o.columnId === col.id)

  const effKind: FoundationOverride['kind'] =
    ov?.kind ?? (item ? (item.kind === 'bloco' ? 'estacas' : item.kind) : project.settings.foundation.type)
  const patch = (p: Partial<FoundationOverride>) =>
    setFoundationOverride({ ...ov, ...p, columnId: col.id })

  const dims = item
    ? item.combined
      ? `SA ${Math.round(cm(item.combined.a))}×${Math.round(cm(item.combined.b))} c/ ${item.combined.partnerName} · h=${Math.round(cm(item.combined.h))} · σ ${fmt(item.combined.sigma, 0)} kPa · sup ${item.combined.topSpec} / inf ${item.combined.botSpec}`
      : item.footing
      ? `${Math.round(cm(item.footing.a))}×${Math.round(cm(item.footing.b))} · h=${Math.round(cm(item.footing.h))} · σmáx ${fmt(item.footing.sigmaMax, 0)} kPa`
      : item.pileCap
        ? `${item.pileCap.nPiles} est. ø${Math.round(cm(item.pileCap.pileDiameter))} · ${fmt(item.pileCap.pileLoad, 0)}/${fmt(item.pileCap.pileCapacity, 0)} kN`
        : item.caisson
          ? `fuste ø${Math.round(cm(item.caisson.shaftD))} · base ø${Math.round(cm(item.caisson.baseD))}`
          : ''
    : null

  // pilar secundário de sapata associada: a fundação vive no pilar dono
  if (item?.combinedWithId) {
    const owner = project.columns.find((c) => c.id === item.combinedWithId)
    return (
      <>
        <h3 className="panel-title" style={{ marginTop: 14 }}>
          Fundação
        </h3>
        <div className="faint" style={{ fontSize: 11 }}>
          Sapata ASSOCIADA — dimensionada no pilar {owner?.name ?? '?'} (edite lá).
        </div>
      </>
    )
  }

  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 14 }}>
        Fundação
      </h3>

      <div className="field">
        <label className="label">Tipo</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={ov?.kind ?? 'auto'}
          onChange={(e) =>
            patch({ kind: e.target.value === 'auto' ? undefined : (e.target.value as FoundationOverride['kind']) })
          }
        >
          <option value="auto">Automático (configurações)</option>
          <option value="sapata">Sapata isolada</option>
          <option value="estacas">Bloco sobre estacas</option>
          <option value="tubulao">Tubulão</option>
        </select>
      </div>

      {effKind === 'sapata' && (
        <div className="field">
          <label className="label">Sapata a × b (cm) — vazio = automático</label>
          <div className="field-row">
            <NumberField
              value={ov?.a !== undefined ? cm(ov.a) : item?.footing ? cm(item.footing.a) : 0}
              digits={0}
              min={0}
              max={1000}
              onCommit={(v) =>
                patch(
                  v > 0
                    ? { a: v / 100, b: ov?.b ?? item?.footing?.b ?? v / 100 }
                    : { a: undefined, b: undefined },
                )
              }
            />
            <NumberField
              value={ov?.b !== undefined ? cm(ov.b) : item?.footing ? cm(item.footing.b) : 0}
              digits={0}
              min={0}
              max={1000}
              onCommit={(v) =>
                patch(
                  v > 0
                    ? { b: v / 100, a: ov?.a ?? item?.footing?.a ?? v / 100 }
                    : { a: undefined, b: undefined },
                )
              }
            />
          </div>
        </div>
      )}

      {effKind === 'sapata' && (
        <div className="field">
          <label className="label">Forma da sapata</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={ov?.footingShape ?? 'piramidal'}
            onChange={(e) =>
              patch({ footingShape: e.target.value === 'reta' ? 'reta' : undefined })
            }
          >
            <option value="piramidal">Piramidal (faces inclinadas, h0 na borda)</option>
            <option value="reta">Reta (altura constante)</option>
          </select>
        </div>
      )}

      {effKind === 'sapata' && (
        <div className="field">
          <label className="label">Sapata associada com (pilar próximo)</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={ov?.combineWithColumnId ?? ''}
            onChange={(e) => patch({ combineWithColumnId: e.target.value || undefined })}
          >
            <option value="">— (isolada)</option>
            {project.columns
              .filter((c) => c.id !== col.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {effKind === 'estacas' && (
        <div className="field">
          <label className="label">Nº de estacas (0 = automático)</label>
          <NumberField
            value={ov?.nPiles ?? 0}
            digits={0}
            min={0}
            max={5}
            style={{ width: '100%' }}
            onCommit={(v) => patch({ nPiles: v >= 1 ? Math.round(v) : undefined })}
          />
        </div>
      )}

      <div className="field">
        <label className="label">Desloc. do CG x · y (cm) — divisa</label>
        <div className="field-row">
          <NumberField
            value={cm(ov?.offset?.x ?? 0)}
            digits={0}
            min={-500}
            max={500}
            onCommit={(v) => {
              const o = { x: v / 100, y: ov?.offset?.y ?? 0 }
              patch({ offset: o.x === 0 && o.y === 0 ? undefined : o })
            }}
          />
          <NumberField
            value={cm(ov?.offset?.y ?? 0)}
            digits={0}
            min={-500}
            max={500}
            onCommit={(v) => {
              const o = { x: ov?.offset?.x ?? 0, y: v / 100 }
              patch({ offset: o.x === 0 && o.y === 0 ? undefined : o })
            }}
          />
        </div>
      </div>

      {effKind === 'sapata' && ov?.offset && (ov.offset.x !== 0 || ov.offset.y !== 0) && (
        <div className="field">
          <label className="label">Viga alavanca até (pilar interno) — divisa</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={ov?.strapToColumnId ?? ''}
            onChange={(e) => patch({ strapToColumnId: e.target.value || undefined })}
          >
            <option value="">— (sem alavanca: offset vira N·e)</option>
            {project.columns
              .filter((c) => c.id !== col.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {item?.strap && (
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
              VA {col.name}–{item.strap.partnerName}: {Math.round(cm(item.strap.bw))}×
              {Math.round(cm(item.strap.h))} · sup {item.strap.topSpec} · estribos{' '}
              {item.strap.stirrupSpec} · R1 {fmt(item.strap.r1, 0)} kN (alívio{' '}
              {fmt(item.strap.relief, 0)} kN em {item.strap.partnerName})
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label className="label">Prof. de assentamento (m) — desenho/3D</label>
        <NumberField
          value={ov?.depth ?? 0}
          digits={2}
          min={0}
          max={30}
          style={{ width: '100%' }}
          onCommit={(v) => patch({ depth: v > 0 ? v : undefined })}
        />
      </div>

      {dims !== null ? (
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          {item!.manual ? 'Verificação (manual): ' : 'Dimensionado: '}
          {dims} — <b>{FOUNDATION_STATUS[item!.status]}</b>
          {item!.offset && (item!.offset.x !== 0 || item!.offset.y !== 0)
            ? ' · excentricidade considerada como N·e'
            : ''}
        </div>
      ) : (
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          Rode a análise para ver o dimensionamento/verificação.
        </div>
      )}

      {ov && (
        <button className="btn" style={{ marginTop: 8 }} onClick={() => clearFoundationOverride(col.id)}>
          Restaurar automático
        </button>
      )}
    </>
  )
}

function LSectionFields({
  colId,
  sec,
}: {
  colId: string
  sec: Extract<Column['section'], { shape: 'L' }>
}) {
  const updateColumn = useStore((s) => s.updateColumn)
  return (
    <>
      <div className="field">
        <label className="label">Caixa b × h (cm)</label>
        <div className="field-row">
          <NumberField
            value={cm(sec.b)}
            digits={1}
            min={20}
            max={300}
            onCommit={(v) => updateColumn(colId, { section: { ...sec, b: v / 100 } })}
          />
          <NumberField
            value={cm(sec.h)}
            digits={1}
            min={20}
            max={300}
            onCommit={(v) => updateColumn(colId, { section: { ...sec, h: v / 100 } })}
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Abas tb × th (cm)</label>
        <div className="field-row">
          <NumberField
            value={cm(sec.tb)}
            digits={1}
            min={12}
            max={100}
            onCommit={(v) => updateColumn(colId, { section: { ...sec, tb: v / 100 } })}
          />
          <NumberField
            value={cm(sec.th)}
            digits={1}
            min={12}
            max={100}
            onCommit={(v) => updateColumn(colId, { section: { ...sec, th: v / 100 } })}
          />
        </div>
      </div>
    </>
  )
}

function RectSectionFields({
  colId,
  sec,
}: {
  colId: string
  sec: Extract<Column['section'], { bw: number }>
}) {
  const updateColumn = useStore((s) => s.updateColumn)
  return (
    <div className="field">
      <label className="label">Seção bw × h (cm)</label>
      <div className="field-row">
        <NumberField
          value={cm(sec.bw)}
          digits={1}
          min={10}
          max={300}
          onCommit={(v) => updateColumn(colId, { section: { bw: v / 100, h: sec.h } })}
        />
        <NumberField
          value={cm(sec.h)}
          digits={1}
          min={10}
          max={300}
          onCommit={(v) => updateColumn(colId, { section: { bw: sec.bw, h: v / 100 } })}
        />
      </div>
    </div>
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

      {beam.path.length > 2 && <SegmentSectionsEditor beam={beam} />}

      <BeamOpeningsEditor beam={beam} length={length} />

      <MemberForcesSection kind="beam" id={beam.id} />

      <DeleteButton onClick={() => deleteElement({ kind: 'beam', id: beam.id })} />
    </>
  )
}

/** seção por trecho da polilinha (TQS: "alterar seção" por vão) */
function SegmentSectionsEditor({ beam }: { beam: Beam }) {
  const updateBeam = useStore((s) => s.updateBeam)
  const nSegs = beam.path.length - 1
  const overrides: (SectionRect | null)[] = Array.from(
    { length: nSegs },
    (_, i) => beam.segmentSections?.[i] ?? null,
  )
  const setSegment = (i: number, sec: SectionRect | null) => {
    const next = [...overrides]
    next[i] = sec
    const any = next.some((s) => s != null)
    updateBeam(beam.id, { segmentSections: any ? next : undefined })
  }
  const segLength = (i: number) => dist(beam.path[i], beam.path[i + 1])

  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label className="label">Seção por trecho</label>
      {overrides.map((ov, i) => {
        const eff = ov ?? beam.section
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 11, width: 76, flex: 'none' }}>
              {i + 1}º ({fmt(segLength(i), 1)} m)
            </span>
            <NumberField
              value={cm(eff.bw)}
              digits={0}
              min={10}
              max={300}
              style={{ width: 52 }}
              onCommit={(v) => setSegment(i, { bw: v / 100, h: eff.h })}
            />
            <NumberField
              value={cm(eff.h)}
              digits={0}
              min={10}
              max={300}
              style={{ width: 52 }}
              onCommit={(v) => setSegment(i, { bw: eff.bw, h: v / 100 })}
            />
            {ov ? (
              <button
                className="btn"
                title="Voltar à seção padrão da viga"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => setSegment(i, null)}
              >
                ↺
              </button>
            ) : (
              <span className="faint" style={{ fontSize: 10 }}>
                padrão
              </span>
            )}
          </div>
        )
      })}
      <div className="faint" style={{ fontSize: 10.5 }}>
        Mudança de seção corta o vão de dimensionamento no ponto.
      </div>
    </div>
  )
}

/** furos que atravessam a alma (NBR 6118 §13.2.5) */
function BeamOpeningsEditor({ beam, length }: { beam: Beam; length: number }) {
  const updateBeam = useStore((s) => s.updateBeam)
  const openings = beam.openings ?? []

  const patch = (id: string, p: Partial<Omit<BeamOpening, 'id'>>) => {
    updateBeam(beam.id, {
      openings: openings.map((o) => (o.id === id ? { ...o, ...p } : o)),
    })
  }

  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label className="label">Furos na alma (§13.2.5)</label>
      {openings.map((op) => (
        <div
          key={op.id}
          style={{
            border: '1px solid var(--border, #333a48)',
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 11, width: 46, flex: 'none' }}>
              x (m)
            </span>
            <NumberField
              value={op.x}
              digits={2}
              min={0}
              max={Math.max(length, 0.1)}
              style={{ flex: 1 }}
              onCommit={(v) => patch(op.id, { x: v })}
            />
            <button
              className="btn"
              title="Remover furo"
              style={{ padding: '2px 7px', color: 'var(--err)' }}
              onClick={() =>
                updateBeam(beam.id, { openings: openings.filter((o) => o.id !== op.id) })
              }
            >
              <IconTrash size={12} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 11, width: 46, flex: 'none' }}>
              c×a·d (cm)
            </span>
            <NumberField
              value={cm(op.width)}
              digits={0}
              min={2}
              max={100}
              style={{ width: 48 }}
              onCommit={(v) => patch(op.id, { width: v / 100 })}
            />
            <NumberField
              value={cm(op.height)}
              digits={0}
              min={2}
              max={100}
              style={{ width: 48 }}
              onCommit={(v) => patch(op.id, { height: v / 100 })}
            />
            <NumberField
              value={cm(op.yOffset)}
              digits={0}
              min={-100}
              max={100}
              style={{ width: 48 }}
              onCommit={(v) => patch(op.id, { yOffset: v / 100 })}
            />
          </div>
        </div>
      ))}
      <button
        className="btn"
        style={{ width: '100%', fontSize: 12 }}
        onClick={() =>
          updateBeam(beam.id, {
            openings: [
              ...openings,
              { id: uid('op'), x: Math.round(length * 50) / 100, width: 0.1, height: 0.1, yOffset: 0 },
            ],
          })
        }
      >
        + Furo (passagem de tubulação)
      </button>
      {openings.length > 0 && (
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
          c = comprimento, a = altura, d = desvio do meio da alma (+ p/ cima). Verificação de
          dispensa (§13.2.5.2) nos resultados.
        </div>
      )}
    </div>
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

      <div className="field" style={{ marginTop: 10 }}>
        <label className="label">Tipo de laje</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={slab.ribbed ? 'nervurada' : 'macica'}
          onChange={(e) =>
            updateSlab(slab.id, {
              ribbed:
                e.target.value === 'nervurada'
                  ? { ...RIBBED_DEFAULTS }
                  : undefined,
              thickness: e.target.value === 'nervurada' ? Math.max(slab.thickness, 0.2) : slab.thickness,
            })
          }
        >
          <option value="macica">Maciça</option>
          <option value="nervurada">Nervurada (moldada in loco)</option>
        </select>
      </div>

      {slab.ribbed && (
        <>
          <div className="field">
            <label className="label">Nervuras: direções</label>
            <select
              className="select"
              style={{ width: '100%' }}
              value={slab.ribbed.dirs}
              onChange={(e) =>
                updateSlab(slab.id, {
                  ribbed: { ...slab.ribbed!, dirs: e.target.value as 'xy' | 'x' | 'y' },
                })
              }
            >
              <option value="xy">Bidirecional (X e Y)</option>
              <option value="x">Unidirecional — vencem em X</option>
              <option value="y">Unidirecional — vencem em Y</option>
            </select>
          </div>
          <div className="field">
            <label className="label">bw nervura · espaçamento (cm)</label>
            <div className="field-row">
              <NumberField
                value={cm(slab.ribbed.ribWidth)}
                digits={0}
                min={5}
                max={30}
                onCommit={(v) =>
                  updateSlab(slab.id, { ribbed: { ...slab.ribbed!, ribWidth: v / 100 } })
                }
              />
              <NumberField
                value={cm(slab.ribbed.spacing)}
                digits={0}
                min={20}
                max={150}
                onCommit={(v) =>
                  updateSlab(slab.id, { ribbed: { ...slab.ribbed!, spacing: v / 100 } })
                }
              />
            </div>
          </div>
          <div className="field">
            <label className="label">Capa (cm) · enchimento (kN/m³)</label>
            <div className="field-row">
              <NumberField
                value={cm(slab.ribbed.topping)}
                digits={1}
                min={4}
                max={15}
                onCommit={(v) =>
                  updateSlab(slab.id, { ribbed: { ...slab.ribbed!, topping: v / 100 } })
                }
              />
              <NumberField
                value={slab.ribbed.fillerWeight}
                digits={2}
                min={0}
                max={15}
                onCommit={(v) =>
                  updateSlab(slab.id, { ribbed: { ...slab.ribbed!, fillerWeight: v } })
                }
              />
            </div>
            <select
              className="select"
              style={{ width: '100%', marginTop: 6 }}
              value={
                RIBBED_FILLER_PRESETS.find(
                  (p) => Math.abs(p.weight - slab.ribbed!.fillerWeight) < 1e-9,
                )?.label ?? 'custom'
              }
              onChange={(e) => {
                const p = RIBBED_FILLER_PRESETS.find((x) => x.label === e.target.value)
                if (p)
                  updateSlab(slab.id, {
                    ribbed: { ...slab.ribbed!, fillerWeight: p.weight, label: p.label },
                  })
              }}
            >
              {!RIBBED_FILLER_PRESETS.some(
                (p) => Math.abs(p.weight - slab.ribbed!.fillerWeight) < 1e-9,
              ) && (
                <option value="custom" disabled>
                  Personalizado — {fmt(slab.ribbed!.fillerWeight, 2)} kN/m³
                </option>
              )}
              {RIBBED_FILLER_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label} — {fmt(p.weight, 2)} kN/m³
                </option>
              ))}
            </select>
          </div>
          <div className="faint" style={{ fontSize: 10.5 }}>
            Espessura acima = altura TOTAL (capa + nervura). Peso próprio real (capa + nervuras +
            enchimento) entra na análise; dimensionamento por nervura (seção T) — §13.2.4.2.
          </div>
        </>
      )}

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
  const beamLength = useMemo(() => {
    if (!beam) return 0
    let L = 0
    for (let i = 0; i + 1 < beam.path.length; i++) L += dist(beam.path[i], beam.path[i + 1])
    return L
  }, [beam])
  const partial = wl.x0 !== undefined && wl.x1 !== undefined

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

      <Check
        label="Aplicar só em um trecho da viga"
        checked={partial}
        onChange={(v) =>
          updateWallLoad(
            wl.id,
            v
              ? { x0: 0, x1: Math.round(beamLength * 100) / 100 }
              : { x0: undefined, x1: undefined },
          )
        }
      />
      {partial && (
        <div className="field">
          <label className="label">Trecho x₀ · x₁ (m do início da viga)</label>
          <div className="field-row">
            <NumberField
              value={wl.x0 ?? 0}
              digits={2}
              min={0}
              max={beamLength}
              onCommit={(v) => updateWallLoad(wl.id, { x0: v })}
            />
            <NumberField
              value={wl.x1 ?? beamLength}
              digits={2}
              min={0}
              max={beamLength}
              onCommit={(v) => updateWallLoad(wl.id, { x1: v })}
            />
          </div>
        </div>
      )}

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
// região de carga (escada, reservatório…)
// ---------------------------------------------------------------------------

function LoadRegionInspector({ region }: { region: LoadRegion }) {
  const updateLoadRegion = useStore((s) => s.updateLoadRegion)
  const deleteElement = useStore((s) => s.deleteElement)

  const area = useMemo(() => polygonArea(region.polygon), [region.polygon])

  return (
    <>
      <h3 className="panel-title">Região {region.name}</h3>

      <div className="field">
        <label className="label">Tipo</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={region.kind}
          onChange={(e) => {
            const p = REGION_PRESETS.find((x) => x.kind === e.target.value)
            if (p) updateLoadRegion(region.id, { kind: p.kind, g: p.g, q: p.q, label: p.label })
          }}
        >
          {REGION_PRESETS.map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {region.kind !== 'furo' && (
        <>
          <div className="field">
            <label className="label">Permanente adicional g (kN/m²)</label>
            <NumberField
              value={region.g}
              digits={2}
              min={0}
              max={100}
              style={{ width: '100%' }}
              onCommit={(v) => updateLoadRegion(region.id, { g: v })}
            />
          </div>

          <div className="field">
            <label className="label">Variável adicional q (kN/m²)</label>
            <NumberField
              value={region.q}
              digits={2}
              min={0}
              max={100}
              style={{ width: '100%' }}
              onCommit={(v) => updateLoadRegion(region.id, { q: v })}
            />
          </div>
        </>
      )}

      <Row label="Área" value={`${fmt(area, 2)} m²`} />

      <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
        {region.kind === 'furo'
          ? 'Abertura na laje: remove peso próprio/revestimento/sobrecarga na área e aparece como furo no 3D e na planta de forma. Prever reforço nas bordas.'
          : 'Distribuída às lajes sobrepostas (proporcional à área de interseção).'}
      </div>

      {region.kind === 'escada' && <StairParamsEditor region={region} />}
      {region.kind === 'reservatorio' && <TankParamsEditor region={region} />}

      <DeleteButton onClick={() => deleteElement({ kind: 'loadRegion', id: region.id })} />
    </>
  )
}

/** parâmetros do lance p/ o dimensionamento da escada (aba Escadas) */
function StairParamsEditor({ region }: { region: LoadRegion }) {
  const updateLoadRegion = useStore((s) => s.updateLoadRegion)
  const st = { ...STAIR_DEFAULTS, ...(region.stair ?? {}) }
  const upd = (patch: Partial<typeof st>) =>
    updateLoadRegion(region.id, { stair: { ...st, ...patch } })

  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 14 }}>
        Dimensionamento do lance
      </h3>
      <div className="field">
        <label className="label">Tipologia</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={st.kind ?? 'reto'}
          onChange={(e) => upd({ kind: e.target.value as 'reto' | 'L' | 'U' })}
        >
          <option value="reto">Lance reto</option>
          <option value="L">Em L (patamar de canto)</option>
          <option value="U">Em U (2 lances + patamar)</option>
        </select>
      </div>
      {(st.kind === 'L' || st.kind === 'U') && (
        <div className="field">
          <label className="label">Profundidade do patamar (cm)</label>
          <NumberField
            value={(st.landingDepth ?? 1.2) * 100}
            digits={0}
            min={80}
            max={300}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ landingDepth: v / 100 })}
          />
          <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>
            Lance + patamar contínuos (sem viga no patamar) — barras cruzando a dobra.
          </div>
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label className="label">Espessura (cm)</label>
          <NumberField
            value={st.waist * 100}
            digits={0}
            min={8}
            max={30}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ waist: v / 100 })}
          />
        </div>
        <div className="field">
          <label className="label">Espelho (cm)</label>
          <NumberField
            value={st.riser * 100}
            digits={1}
            min={14}
            max={22}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ riser: v / 100 })}
          />
        </div>
        <div className="field">
          <label className="label">Piso (cm)</label>
          <NumberField
            value={st.tread * 100}
            digits={1}
            min={22}
            max={35}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ tread: v / 100 })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label">Revestimento (kN/m²)</label>
          <NumberField
            value={st.finish}
            digits={2}
            min={0}
            max={5}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ finish: v })}
          />
        </div>
        <div className="field">
          <label className="label">Vão do lance (m; 0 = auto)</label>
          <NumberField
            value={st.span ?? 0}
            digits={2}
            min={0}
            max={12}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ span: v })}
          />
        </div>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          margin: '6px 0 2px',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={st.reverse ?? false}
          onChange={(e) => upd({ reverse: e.target.checked })}
        />
        Inverter sentido de subida (3D)
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          margin: '2px 0',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={st.opening ?? true}
          onChange={(e) => upd({ opening: e.target.checked })}
        />
        Abrir furo na laje deste pavimento
      </label>
      <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
        Lance dimensionado como laje armada em uma direção — resultados na aba Escadas. No 3D o
        lance sobe do pavimento inferior até este pavimento, ao longo do lado maior da região.
      </div>
    </>
  )
}

/** parâmetros do reservatório p/ o dimensionamento (aba Reservatórios) */
function TankParamsEditor({ region }: { region: LoadRegion }) {
  const updateLoadRegion = useStore((s) => s.updateLoadRegion)
  const tk = { ...TANK_DEFAULTS, ...(region.tank ?? {}) }
  const upd = (patch: Partial<typeof tk>) =>
    updateLoadRegion(region.id, { tank: { ...tk, ...patch } })

  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 14 }}>
        Dimensionamento do reservatório
      </h3>
      <div className="field-row">
        <div className="field">
          <label className="label">Lâmina d'água (m)</label>
          <NumberField
            value={tk.waterHeight}
            digits={2}
            min={0.3}
            max={6}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ waterHeight: v })}
          />
        </div>
        <div className="field">
          <label className="label">Parede (cm)</label>
          <NumberField
            value={tk.wallThickness * 100}
            digits={0}
            min={10}
            max={40}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ wallThickness: v / 100 })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label">Fundo (cm)</label>
          <NumberField
            value={tk.bottomThickness * 100}
            digits={0}
            min={10}
            max={40}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ bottomThickness: v / 100 })}
          />
        </div>
        <div className="field">
          <label className="label">Tampa (cm)</label>
          <NumberField
            value={tk.topThickness * 100}
            digits={0}
            min={8}
            max={30}
            style={{ width: '100%' }}
            onCommit={(v) => upd({ topThickness: v / 100 })}
          />
        </div>
      </div>
      <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
        Lembre de ajustar g/q acima p/ o peso real (água = 10·lâmina em q). Resultados na aba
        Reservatórios.
      </div>
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
      if (col) content = <ColumnInspector key={col.id} col={col} project={project} />
    } else if (selection.kind === 'beam') {
      const beam = project.plans.flatMap((p) => p.beams).find((b) => b.id === selection.id)
      if (beam) content = <BeamInspector key={beam.id} beam={beam} />
    } else if (selection.kind === 'slab') {
      const slab = project.plans.flatMap((p) => p.slabs).find((x) => x.id === selection.id)
      if (slab) content = <SlabInspector key={slab.id} slab={slab} />
    } else if (selection.kind === 'loadRegion') {
      const region = project.plans
        .flatMap((p) => p.loadRegions)
        .find((r) => r.id === selection.id)
      if (region) content = <LoadRegionInspector key={region.id} region={region} />
    } else {
      const wl = project.plans.flatMap((p) => p.wallLoads).find((w) => w.id === selection.id)
      if (wl) content = <WallLoadInspector key={wl.id} wl={wl} project={project} />
    }
  }
  if (!content) content = <ProjectInspector project={project} />

  return (
    <>
      <div className="panel">{content}</div>
      <PlansManager />
    </>
  )
}
