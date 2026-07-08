import type { ReactNode } from 'react'
import {
  CITY_V0_PRESETS,
  CONCRETE_CLASSES,
  COVER_BY_CAA,
  PSI_PRESETS,
  type Aggregate,
  type CAA,
  type WindParams,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField, OptionalNumberField } from './NumberField'
import { cm, fmt } from './format'
import { IconClose } from '../components/Icons'

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
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

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
