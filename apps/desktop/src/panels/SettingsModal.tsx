import { useState, type ReactNode } from 'react'
import {
  CITY_V0_PRESETS,
  CONCRETE_CLASSES,
  COVER_BY_CAA,
  OCCUPANCY_OPTIONS,
  PILE_PRESETS,
  PSI_PRESETS,
  SOIL_PRESETS,
  requiredTRRF,
  type Aggregate,
  type CAA,
  type OccupancyGroup,
  type TRRF,
  type WindParams,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField, OptionalNumberField } from './NumberField'
import { cm, fmt } from './format'
import { IconClose, IconTrash } from '../components/Icons'
import type { PileKind, SoilKind, SoilLayerSPT } from '@hyperframe/engine'
import {
  COPILOT_MODELS,
  getApiKey,
  getModel,
  getProviderKind,
  setApiKey,
  setModel as setCopilotModel,
  setProviderKind,
} from '../copilot/agent'
import LocalModelsSettings from '../copilot/LocalModelsSettings'

// ---------------------------------------------------------------------------
// opções normativas (rótulos pt-BR)
// ---------------------------------------------------------------------------

const AGGREGATE_OPTIONS: { value: Aggregate; label: string }[] = [
  { value: 'basalto', label: 'Basalto / diabásio (αE = 1,2)' },
  { value: 'granito', label: 'Granito / gnaisse (αE = 1,0)' },
  { value: 'calcario', label: 'Calcário (αE = 0,9)' },
  { value: 'arenito', label: 'Arenito (αE = 0,7)' },
]

const CAA_OPTIONS: { value: CAA; label: string }[] = [
  { value: 'I', label: 'I — Fraca (rural / submersa)' },
  { value: 'II', label: 'II — Moderada (urbana)' },
  { value: 'III', label: 'III — Forte (marinha / industrial)' },
  { value: 'IV', label: 'IV — Muito forte (respingos de maré)' },
]

const WIND_CATEGORY_OPTIONS: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: 'I — Mar aberto / lagos' },
  { value: 2, label: 'II — Campo aberto, poucos obstáculos' },
  { value: 3, label: 'III — Subúrbios / casas baixas' },
  { value: 4, label: 'IV — Zona urbanizada (edificações)' },
  { value: 5, label: 'V — Centros de grandes cidades' },
]

const WIND_CLASS_OPTIONS: { value: 'A' | 'B' | 'C'; label: string }[] = [
  { value: 'A', label: 'A — maior dimensão ≤ 20 m' },
  { value: 'B', label: 'B — entre 20 e 50 m' },
  { value: 'C', label: 'C — maior que 50 m' },
]

const S3_GROUP_OPTIONS: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: '1 — Segurança / socorro (hospitais, quartéis)' },
  { value: 2, label: '2 — Residencial / comercial / hotéis' },
  { value: 3, label: '3 — Depósitos / baixa ocupação' },
  { value: 4, label: '4 — Vedações (telhas, vidros)' },
  { value: 5, label: '5 — Edificações temporárias' },
]

const PSI_KEYS = ['residencial', 'comercial', 'deposito'] as const
type PsiKey = (typeof PSI_KEYS)[number]

const SOIL_KIND_OPTIONS: { value: SoilKind; label: string }[] = [
  { value: 'areia', label: 'Areia' },
  { value: 'areia-siltosa', label: 'Areia siltosa' },
  { value: 'areia-argilosa', label: 'Areia argilosa' },
  { value: 'silte-arenoso', label: 'Silte arenoso' },
  { value: 'silte', label: 'Silte' },
  { value: 'silte-argiloso', label: 'Silte argiloso' },
  { value: 'argila-arenosa', label: 'Argila arenosa' },
  { value: 'argila-siltosa', label: 'Argila siltosa' },
  { value: 'argila', label: 'Argila' },
]

const PILE_KIND_OPTIONS: { value: PileKind; label: string }[] = [
  { value: 'helice', label: 'Hélice contínua (F1=2; F2=4)' },
  { value: 'escavada', label: 'Escavada (F1=3; F2=6)' },
  { value: 'pre-moldada', label: 'Pré-moldada (F1=1,75; F2=3,5)' },
  { value: 'franki', label: 'Franki (F1=2,5; F2=5)' },
  { value: 'raiz', label: 'Raiz (F1=2; F2=4)' },
  { value: 'metalica', label: 'Metálica (F1=1,75; F2=3,5)' },
]

// ---------------------------------------------------------------------------

function Section({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div className={first ? undefined : 'panel-section'}>
      <h3 className="panel-title">{title}</h3>
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="faint" style={{ fontSize: 11, marginTop: -4, marginBottom: 10 }}>
      {children}
    </div>
  )
}

export default function SettingsModal() {
  const project = useStore((s) => s.project)
  const updateSettings = useStore((s) => s.updateSettings)
  const setProjectMeta = useStore((s) => s.setProjectMeta)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [copilotKind, setCopilotKindState] = useState<'claude' | 'local'>(getProviderKind())

  const st = project.settings
  const wind = st.wind
  const cover = COVER_BY_CAA[st.caa]
  const windDis = !wind.enabled

  const updWind = (patch: Partial<WindParams>) => updateSettings({ wind: { ...wind, ...patch } })

  const setCaOverride = (axis: 'x' | 'y', v: number | undefined) => {
    const next = { ...(wind.caOverride ?? {}), [axis]: v }
    if (next.x === undefined && next.y === undefined) updWind({ caOverride: undefined })
    else updWind({ caOverride: next })
  }

  const psiKey = PSI_KEYS.find((k) => {
    const p = PSI_PRESETS[k]
    return p.psi0 === st.psiLive.psi0 && p.psi1 === st.psiLive.psi1 && p.psi2 === st.psiLive.psi2
  })

  const soilMatch = SOIL_PRESETS.find(
    (p) => p.label === st.soil.label && Math.abs(p.sigmaAdm - st.soil.sigmaAdm) < 1e-9,
  )

  const buildingHeight = project.levels.reduce((s, l) => Math.max(s, l.elevation), 0)
  const trrfAuto = requiredTRRF(st.fire.occupancy, buildingHeight)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 640, maxWidth: 640 }}>
        <div className="modal-header">
          Parâmetros do Projeto — Normas
          <button className="btn-icon" title="Fechar" onClick={() => setSettingsOpen(false)}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* ------------------------------------------------ materiais */}
          <Section title="Materiais (NBR 6118)" first>
            <div className="field-row">
              <div className="field">
                <label className="label">Classe do concreto (fck)</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={String(st.concrete.fck)}
                  onChange={(e) =>
                    updateSettings({ concrete: { ...st.concrete, fck: Number(e.target.value) } })
                  }
                >
                  {CONCRETE_CLASSES.map((c) => (
                    <option key={c.label} value={String(c.fck)}>
                      {c.label} — fck {fmt(c.fck / 1000, 0)} MPa
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Agregado graúdo</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={st.concrete.aggregate}
                  onChange={(e) =>
                    updateSettings({
                      concrete: { ...st.concrete, aggregate: e.target.value as Aggregate },
                    })
                  }
                >
                  {AGGREGATE_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label">γc (ponderação do concreto)</label>
                <NumberField
                  value={st.concrete.gammaC}
                  digits={2}
                  trim={false}
                  min={1}
                  max={2}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ concrete: { ...st.concrete, gammaC: v } })}
                />
              </div>
              <div className="field">
                <label className="label">Aço</label>
                <div className="muted" style={{ fontSize: 12, lineHeight: '26px' }}>
                  CA-50 (fyk 500 MPa, γs 1,15)
                </div>
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ durabilidade */}
          <Section title="Durabilidade (NBR 6118 tab. 6.1 / 7.2)">
            <div className="field">
              <label className="label">Classe de agressividade ambiental (CAA)</label>
              <select
                className="select"
                style={{ width: '100%' }}
                value={st.caa}
                onChange={(e) => updateSettings({ caa: e.target.value as CAA })}
              >
                {CAA_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Cobrimentos nominais resultantes</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="chip">laje {fmt(cm(cover.slab), 1)} cm</span>
                <span className="chip">viga {fmt(cm(cover.beam), 1)} cm</span>
                <span className="chip">pilar {fmt(cm(cover.column), 1)} cm</span>
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ vento */}
          <Section title="Vento (NBR 6123)">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 10,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={wind.enabled}
                onChange={(e) => updWind({ enabled: e.target.checked })}
              />
              Considerar ação do vento
            </label>

            <div style={{ opacity: windDis ? 0.5 : 1 }}>
              <div className="field">
                <label className="label">Cidade (aplica V0 aproximado)</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  disabled={windDis}
                  value=""
                  onChange={(e) => {
                    const c = CITY_V0_PRESETS.find((x) => x.city === e.target.value)
                    if (c) updWind({ v0: c.v0 })
                  }}
                >
                  <option value="" disabled>
                    Escolher cidade…
                  </option>
                  {CITY_V0_PRESETS.map((c) => (
                    <option key={c.city} value={c.city}>
                      {c.city} — {fmt(c.v0, 0)} m/s
                    </option>
                  ))}
                </select>
              </div>
              <Note>Valores aproximados — confira a isopleta da NBR 6123.</Note>

              <div className="field-row">
                <div className="field">
                  <label className="label">V0 (m/s)</label>
                  <NumberField
                    value={wind.v0}
                    digits={1}
                    min={20}
                    max={70}
                    disabled={windDis}
                    style={{ width: '100%' }}
                    onCommit={(v) => updWind({ v0: v })}
                  />
                </div>
                <div className="field">
                  <label className="label">S1 (topográfico)</label>
                  <NumberField
                    value={wind.s1}
                    digits={2}
                    trim={false}
                    min={0.5}
                    max={1.5}
                    disabled={windDis}
                    style={{ width: '100%' }}
                    onCommit={(v) => updWind({ s1: v })}
                  />
                </div>
              </div>

              <div className="field">
                <label className="label">Categoria de rugosidade (S2)</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  disabled={windDis}
                  value={String(wind.category)}
                  onChange={(e) => updWind({ category: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}
                >
                  {WIND_CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={String(c.value)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="label">Classe da edificação</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    disabled={windDis}
                    value={wind.windClass}
                    onChange={(e) => updWind({ windClass: e.target.value as 'A' | 'B' | 'C' })}
                  >
                    {WIND_CLASS_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Grupo estatístico (S3)</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    disabled={windDis}
                    value={String(wind.s3Group)}
                    onChange={(e) => updWind({ s3Group: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}
                  >
                    {S3_GROUP_OPTIONS.map((g) => (
                      <option key={g.value} value={String(g.value)}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="label">Ca em X (vazio = automático)</label>
                  <OptionalNumberField
                    value={wind.caOverride?.x}
                    digits={2}
                    min={0.5}
                    max={3}
                    disabled={windDis}
                    placeholder="automático"
                    style={{ width: '100%' }}
                    onCommit={(v) => setCaOverride('x', v)}
                  />
                </div>
                <div className="field">
                  <label className="label">Ca em Y (vazio = automático)</label>
                  <OptionalNumberField
                    value={wind.caOverride?.y}
                    digits={2}
                    min={0.5}
                    max={3}
                    disabled={windDis}
                    placeholder="automático"
                    style={{ width: '100%' }}
                    onCommit={(v) => setCaOverride('y', v)}
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ fundações */}
          <Section title="Fundações (NBR 6122)">
            <div className="field">
              <label className="label">Tipo de fundação</label>
              <select
                className="select"
                style={{ width: '100%' }}
                value={st.foundation.type}
                onChange={(e) =>
                  updateSettings({
                    foundation: {
                      ...st.foundation,
                      type: e.target.value as 'sapata' | 'estacas' | 'tubulao',
                    },
                  })
                }
              >
                <option value="sapata">Sapatas rígidas isoladas (fundação direta)</option>
                <option value="estacas">Blocos sobre estacas (método das bielas — Blévot)</option>
                <option value="tubulao">Tubulões a céu aberto (base alargada)</option>
              </select>
            </div>

            {st.foundation.type === 'tubulao' && (
              <div className="field-row">
                <div className="field">
                  <label className="label">σadm do solo na base (kPa)</label>
                  <NumberField
                    value={st.soil.sigmaAdm}
                    digits={0}
                    min={50}
                    max={5000}
                    style={{ width: '100%' }}
                    onCommit={(v) =>
                      updateSettings({ soil: { ...st.soil, sigmaAdm: v, label: 'Personalizado' } })
                    }
                  />
                </div>
                <div className="field">
                  <label className="label">σ concreto do fuste (kPa)</label>
                  <NumberField
                    value={st.foundation.caissonSigmaConcrete ?? 5000}
                    digits={0}
                    min={2000}
                    max={12000}
                    style={{ width: '100%' }}
                    onCommit={(v) =>
                      updateSettings({
                        foundation: { ...st.foundation, caissonSigmaConcrete: v },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label className="label">Profundidade (m)</label>
                  <NumberField
                    value={st.foundation.pileLength ?? 10}
                    digits={1}
                    min={2}
                    max={40}
                    style={{ width: '100%' }}
                    onCommit={(v) =>
                      updateSettings({ foundation: { ...st.foundation, pileLength: v } })
                    }
                  />
                </div>
              </div>
            )}

            {st.foundation.type === 'sapata' ? (
              <div className="field-row">
                <div className="field">
                  <label className="label">Tipo de solo</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={soilMatch ? soilMatch.label : 'custom'}
                    onChange={(e) => {
                      const p = SOIL_PRESETS.find((x) => x.label === e.target.value)
                      if (p) updateSettings({ soil: { sigmaAdm: p.sigmaAdm, label: p.label } })
                    }}
                  >
                    {!soilMatch && (
                      <option value="custom" disabled>
                        {st.soil.label || 'Personalizado'} — {fmt(st.soil.sigmaAdm, 0)} kPa
                      </option>
                    )}
                    {SOIL_PRESETS.map((p) => (
                      <option key={p.label} value={p.label}>
                        {p.label} — {fmt(p.sigmaAdm, 0)} kPa
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">σadm (kPa)</label>
                  <NumberField
                    value={st.soil.sigmaAdm}
                    digits={0}
                    min={10}
                    max={5000}
                    style={{ width: '100%' }}
                    onCommit={(v) =>
                      updateSettings({ soil: { sigmaAdm: v, label: 'Personalizado' } })
                    }
                  />
                </div>
              </div>
            ) : st.foundation.type === 'estacas' ? (
              <>
                <div className="field">
                  <label className="label">Tipo de estaca (aplica φ e carga usuais)</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value=""
                    onChange={(e) => {
                      const p = PILE_PRESETS.find((x) => x.label === e.target.value)
                      if (p) {
                        updateSettings({
                          foundation: {
                            ...st.foundation,
                            pileLabel: p.label,
                            pileDiameter: p.diameter,
                            pileCapacity: p.capacity,
                          },
                        })
                      }
                    }}
                  >
                    <option value="" disabled>
                      {st.foundation.pileLabel} — φ {fmt(cm(st.foundation.pileDiameter), 0)} cm ·{' '}
                      {fmt(st.foundation.pileCapacity, 0)} kN
                    </option>
                    {PILE_PRESETS.map((p) => (
                      <option key={p.label} value={p.label}>
                        {p.label} — φ {fmt(cm(p.diameter), 0)} cm · {fmt(p.capacity, 0)} kN
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label className="label">Carga admissível (kN/estaca)</label>
                    <NumberField
                      value={st.foundation.pileCapacity}
                      digits={0}
                      min={20}
                      max={5000}
                      style={{ width: '100%' }}
                      onCommit={(v) =>
                        updateSettings({ foundation: { ...st.foundation, pileCapacity: v } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label">Diâmetro φ (cm)</label>
                    <NumberField
                      value={cm(st.foundation.pileDiameter)}
                      digits={0}
                      min={15}
                      max={120}
                      style={{ width: '100%' }}
                      onCommit={(v) =>
                        updateSettings({ foundation: { ...st.foundation, pileDiameter: v / 100 } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label">Espaçamento (×φ)</label>
                    <NumberField
                      value={st.foundation.pileSpacingFactor}
                      digits={1}
                      min={2.5}
                      max={5}
                      style={{ width: '100%' }}
                      onCommit={(v) =>
                        updateSettings({
                          foundation: { ...st.foundation, pileSpacingFactor: v },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label className="label">Execução (Aoki–Velloso)</label>
                    <select
                      className="select"
                      style={{ width: '100%' }}
                      value={st.foundation.pileKind ?? 'helice'}
                      onChange={(e) =>
                        updateSettings({
                          foundation: { ...st.foundation, pileKind: e.target.value as PileKind },
                        })
                      }
                    >
                      {PILE_KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">Comprimento (m)</label>
                    <NumberField
                      value={st.foundation.pileLength ?? 10}
                      digits={1}
                      min={3}
                      max={60}
                      style={{ width: '100%' }}
                      onCommit={(v) =>
                        updateSettings({ foundation: { ...st.foundation, pileLength: v } })
                      }
                    />
                  </div>
                </div>
              </>
            ) : null}
            <Note>
              Valores geotécnicos orientativos — o projeto executivo exige sondagem SPT e laudo
              geotécnico (NBR 6122).
            </Note>
          </Section>

          {/* --------------------------------- interação solo-estrutura */}
          <Section title="Interação solo-estrutura (sondagem SPT → molas)">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={st.soilInteraction.enabled}
                onChange={(e) =>
                  updateSettings({
                    soilInteraction: { ...st.soilInteraction, enabled: e.target.checked },
                  })
                }
              />
              Analisar sobre apoios elásticos (CRV/CRH estimados da sondagem) e estimar recalques
            </label>

            <label className="label">Perfil de sondagem (a partir da cota de apoio)</label>
            {st.soilInteraction.layers.map((layer, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <NumberField
                  value={layer.thickness}
                  digits={1}
                  min={0.5}
                  max={40}
                  style={{ width: 58 }}
                  onCommit={(v) => {
                    const layers = st.soilInteraction.layers.map((l, j) =>
                      j === i ? { ...l, thickness: v } : l,
                    )
                    updateSettings({ soilInteraction: { ...st.soilInteraction, layers } })
                  }}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  m
                </span>
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={layer.soil}
                  onChange={(e) => {
                    const layers = st.soilInteraction.layers.map((l, j) =>
                      j === i ? { ...l, soil: e.target.value as SoilKind, label: undefined } : l,
                    )
                    updateSettings({ soilInteraction: { ...st.soilInteraction, layers } })
                  }}
                >
                  {SOIL_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 11 }}>
                  NSPT
                </span>
                <NumberField
                  value={layer.nspt}
                  digits={0}
                  min={1}
                  max={60}
                  style={{ width: 48 }}
                  onCommit={(v) => {
                    const layers = st.soilInteraction.layers.map((l, j) =>
                      j === i ? { ...l, nspt: v } : l,
                    )
                    updateSettings({ soilInteraction: { ...st.soilInteraction, layers } })
                  }}
                />
                <button
                  className="btn"
                  title="Remover camada"
                  style={{ padding: '2px 7px', color: 'var(--err)' }}
                  disabled={st.soilInteraction.layers.length <= 1}
                  onClick={() =>
                    updateSettings({
                      soilInteraction: {
                        ...st.soilInteraction,
                        layers: st.soilInteraction.layers.filter((_, j) => j !== i),
                      },
                    })
                  }
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ))}
            <button
              className="btn"
              style={{ fontSize: 12, marginBottom: 10 }}
              onClick={() => {
                const last = st.soilInteraction.layers[st.soilInteraction.layers.length - 1]
                const nova: SoilLayerSPT = last
                  ? { ...last, thickness: 3 }
                  : { thickness: 3, soil: 'areia', nspt: 15 }
                updateSettings({
                  soilInteraction: {
                    ...st.soilInteraction,
                    layers: [...st.soilInteraction.layers, nova],
                  },
                })
              }}
            >
              + Camada
            </button>

            <div className="field-row">
              <div className="field">
                <label className="label">CRH / CRV</label>
                <NumberField
                  value={st.soilInteraction.chFactor}
                  digits={2}
                  min={0.1}
                  max={1}
                  style={{ width: '100%' }}
                  onCommit={(v) =>
                    updateSettings({ soilInteraction: { ...st.soilInteraction, chFactor: v } })
                  }
                />
              </div>
              <div className="field">
                <label className="label">ν do solo</label>
                <NumberField
                  value={st.soilInteraction.poisson}
                  digits={2}
                  min={0.15}
                  max={0.49}
                  style={{ width: '100%' }}
                  onCommit={(v) =>
                    updateSettings({ soilInteraction: { ...st.soilInteraction, poisson: v } })
                  }
                />
              </div>
            </div>
            <Note>
              Es = α·K·NSPT (Teixeira &amp; Godoy) p/ sapatas; capacidade e mola de estacas por
              Aoki–Velloso. As fundações do 1º passe (engastado) geram as molas; o pórtico é
              re-analisado sobre elas. Sondagem fictícia NÃO substitui o laudo (NBR 6122).
            </Note>
          </Section>

          {/* ------------------------------------------------ custos */}
          <Section title="Custos unitários (estimativa)">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={st.costs.enabled}
                onChange={(e) =>
                  updateSettings({ costs: { ...st.costs, enabled: e.target.checked } })
                }
              />
              Estimar custo da estrutura nos quantitativos e no memorial
            </label>
            <div className="field-row">
              <div className="field">
                <label className="label">Concreto (R$/m³)</label>
                <NumberField
                  value={st.costs.concretePerM3}
                  digits={0}
                  min={100}
                  max={5000}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ costs: { ...st.costs, concretePerM3: v } })}
                />
              </div>
              <div className="field">
                <label className="label">Aço (R$/kg)</label>
                <NumberField
                  value={st.costs.steelPerKg}
                  digits={2}
                  min={1}
                  max={100}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ costs: { ...st.costs, steelPerKg: v } })}
                />
              </div>
              <div className="field">
                <label className="label">Fôrma (R$/m²)</label>
                <NumberField
                  value={st.costs.formworkPerM2}
                  digits={0}
                  min={10}
                  max={1000}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ costs: { ...st.costs, formworkPerM2: v } })}
                />
              </div>
            </div>
            <Note>Concreto lançado, aço cortado/dobrado/montado e fôrma com mão de obra.</Note>
          </Section>

          {/* ------------------------------------------------ incêndio */}
          <Section title="Incêndio (NBR 14432 / NBR 15200)">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 10,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={st.fire.enabled}
                onChange={(e) =>
                  updateSettings({ fire: { ...st.fire, enabled: e.target.checked } })
                }
              />
              Verificar estrutura em situação de incêndio (método tabular/analítico)
            </label>
            <div style={{ opacity: st.fire.enabled ? 1 : 0.5 }}>
              <div className="field-row">
                <div className="field">
                  <label className="label">Ocupação (NBR 14432 tab. A.1)</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    disabled={!st.fire.enabled}
                    value={st.fire.occupancy}
                    onChange={(e) =>
                      updateSettings({
                        fire: { ...st.fire, occupancy: e.target.value as OccupancyGroup },
                      })
                    }
                  >
                    {OCCUPANCY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">TRRF</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    disabled={!st.fire.enabled}
                    value={String(st.fire.trrf)}
                    onChange={(e) => {
                      const v = e.target.value
                      updateSettings({
                        fire: {
                          ...st.fire,
                          trrf: v === 'auto' ? 'auto' : (Number(v) as TRRF),
                        },
                      })
                    }}
                  >
                    <option value="auto">
                      Automático (grupo + altura) — hoje: {trrfAuto} min
                    </option>
                    {[30, 60, 90, 120, 180].map((t) => (
                      <option key={t} value={String(t)}>
                        {t} min
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Note>
                TRRF sugerido pela tab. A.1 — confirme divisão de ocupação, isenções e exigências
                da IT do Corpo de Bombeiros local.
              </Note>
            </div>
          </Section>

          {/* ------------------------------------------------ análise */}
          <Section title="Análise">
            <div className="field-row">
              <div className="field">
                <label className="label">Rigidez das vigas (×EI)</label>
                <NumberField
                  value={st.stiffnessReduction.beams}
                  digits={2}
                  min={0.1}
                  max={1}
                  style={{ width: '100%' }}
                  onCommit={(v) =>
                    updateSettings({
                      stiffnessReduction: { ...st.stiffnessReduction, beams: v },
                    })
                  }
                />
              </div>
              <div className="field">
                <label className="label">Rigidez dos pilares (×EI)</label>
                <NumberField
                  value={st.stiffnessReduction.columns}
                  digits={2}
                  min={0.1}
                  max={1}
                  style={{ width: '100%' }}
                  onCommit={(v) =>
                    updateSettings({
                      stiffnessReduction: { ...st.stiffnessReduction, columns: v },
                    })
                  }
                />
              </div>
            </div>
            <Note>NBR 6118 §15.7.3 — análise global ELU (padrão: vigas 0,4 · pilares 0,8).</Note>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={st.notionalImperfections}
                onChange={(e) => updateSettings({ notionalImperfections: e.target.checked })}
              />
              Desaprumo global (§11.3.3.4.1) combinado ao vento pela regra da norma
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                marginBottom: 10,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={st.secondOrderGammaZ}
                onChange={(e) => updateSettings({ secondOrderGammaZ: e.target.checked })}
              />
              2ª ordem global aproximada: majorar vento ELU por 0,95·γz quando 1,1 &lt; γz ≤ 1,3
              (§15.7.2)
            </label>

            <div className="field-row">
              <div className="field">
                <label className="label">Fator de torção das vigas</label>
                <NumberField
                  value={st.torsionFactor}
                  digits={2}
                  min={0.01}
                  max={1}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ torsionFactor: v })}
                />
              </div>
              <div className="field">
                <label className="label">Peso específico (kN/m³)</label>
                <NumberField
                  value={st.concreteUnitWeight}
                  digits={1}
                  min={15}
                  max={35}
                  style={{ width: '100%' }}
                  onCommit={(v) => updateSettings({ concreteUnitWeight: v })}
                />
              </div>
            </div>

            <div className="field">
              <label className="label">ψ da sobrecarga (NBR 6118 tab. 11.2)</label>
              <select
                className="select"
                style={{ width: '100%' }}
                value={psiKey ?? 'custom'}
                onChange={(e) => {
                  const k = e.target.value as PsiKey
                  if (PSI_KEYS.includes(k)) {
                    const p = PSI_PRESETS[k]
                    updateSettings({ psiLive: { psi0: p.psi0, psi1: p.psi1, psi2: p.psi2 } })
                  }
                }}
              >
                {!psiKey && (
                  <option value="custom" disabled>
                    Personalizado — ψ0 {fmt(st.psiLive.psi0, 1)} · ψ1 {fmt(st.psiLive.psi1, 1)} · ψ2{' '}
                    {fmt(st.psiLive.psi2, 1)}
                  </option>
                )}
                {PSI_KEYS.map((k) => {
                  const p = PSI_PRESETS[k]
                  return (
                    <option key={k} value={k}>
                      {p.label} — ψ0 {fmt(p.psi0, 1)} · ψ1 {fmt(p.psi1, 1)} · ψ2 {fmt(p.psi2, 1)}
                    </option>
                  )
                })}
              </select>
            </div>
          </Section>

          {/* ------------------------------------------------ copiloto IA */}
          <Section title="Copiloto IA">
            <div className="field">
              <label className="label">Provedor</label>
              <select
                className="select"
                style={{ width: '100%' }}
                value={copilotKind}
                onChange={(e) => {
                  setProviderKind(e.target.value as 'claude' | 'local')
                  setCopilotKindState(e.target.value as 'claude' | 'local')
                }}
              >
                <option value="claude">Claude (API da Anthropic) — melhor qualidade</option>
                <option value="local">Local (Ollama) — grátis, offline e privado</option>
              </select>
            </div>

            {copilotKind === 'claude' ? (
              <>
                <div className="field">
                  <label className="label">Chave da API (console.anthropic.com)</label>
                  <input
                    className="input"
                    style={{ width: '100%', fontFamily: 'var(--mono)' }}
                    type="password"
                    placeholder="sk-ant-…"
                    defaultValue={getApiKey()}
                    spellCheck={false}
                    onChange={(e) => setApiKey(e.target.value.trim())}
                  />
                </div>
                <div className="field">
                  <label className="label">Modelo padrão</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    defaultValue={getModel()}
                    onChange={(e) => setCopilotModel(e.target.value)}
                  >
                    {COPILOT_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <LocalModelsSettings />
            )}
            <Note>
              Chave/modelos ficam APENAS neste computador — nunca entram no arquivo do projeto.
              Toda mudança proposta pelo copiloto exige sua aprovação e entra no desfazer (⌘Z).
              Modelos locais são mais fracos com ferramentas que o Claude.
            </Note>
          </Section>

          {/* --------------------------------- identificação (carimbo) */}
          <Section title="Identificação da obra (carimbo das pranchas)">
            <div className="field-row">
              <div className="field">
                <label className="label">Cliente / proprietário</label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={project.client ?? ''}
                  spellCheck={false}
                  onChange={(e) => setProjectMeta({ client: e.target.value || undefined })}
                />
              </div>
              <div className="field">
                <label className="label">Resp. técnico</label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={project.author ?? ''}
                  spellCheck={false}
                  onChange={(e) => setProjectMeta({ author: e.target.value || undefined })}
                />
              </div>
            </div>
            <div className="field">
              <label className="label">Endereço da obra</label>
              <input
                className="input"
                style={{ width: '100%' }}
                value={project.address ?? ''}
                spellCheck={false}
                onChange={(e) => setProjectMeta({ address: e.target.value || undefined })}
              />
            </div>
            <Note>Preenche o carimbo ao exportar pranchas com moldura (aba Pranchas).</Note>
          </Section>
        </div>

        <div className="modal-footer">
          <span
            className="faint"
            style={{ fontSize: 11, marginRight: 'auto', alignSelf: 'center' }}
          >
            Alterar parâmetros invalida os resultados da análise.
          </span>
          <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
