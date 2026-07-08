import { useState } from 'react'
import {
  CITY_V0_PRESETS,
  CONCRETE_CLASSES,
  COVER_BY_CAA,
  type Aggregate,
  type CAA,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField } from '../panels/NumberField'
import { cm, fmt } from '../panels/format'
import { IconClose } from '../components/Icons'

const OUTRA = '__outra__'
const STEPS = ['Obra', 'Materiais', 'Vento'] as const

const AGGREGATE_OPTIONS: { value: Aggregate; label: string }[] = [
  { value: 'basalto', label: 'Basalto / diabásio' },
  { value: 'granito', label: 'Granito / gnaisse' },
  { value: 'calcario', label: 'Calcário' },
  { value: 'arenito', label: 'Arenito' },
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

const S3_GROUP_OPTIONS: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: '1 — Segurança / socorro (hospitais, quartéis)' },
  { value: 2, label: '2 — Residencial / comercial / hotéis' },
  { value: 3, label: '3 — Depósitos / baixa ocupação' },
  { value: 4, label: '4 — Vedações (telhas, vidros)' },
  { value: 5, label: '5 — Edificações temporárias' },
]

function StepIndicator({ step }: { step: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {STEPS.map((label, i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {i > 0 && <div style={{ width: 22, height: 1, background: 'var(--border-strong)' }} />}
          <span
            className="mono"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              background:
                i === step ? 'var(--accent)' : i < step ? 'var(--accent-soft)' : 'var(--bg-3)',
              color: i === step ? '#1a1204' : i < step ? 'var(--accent)' : 'var(--text-dim)',
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: i === step ? 600 : 400,
              color: i === step ? 'var(--text)' : 'var(--text-dim)',
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function NewProjectWizard() {
  const newProject = useStore((s) => s.newProject)
  const setWizardOpen = useStore((s) => s.setWizardOpen)

  const [step, setStep] = useState(0)

  // 1 — obra
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [cityChoice, setCityChoice] = useState<string>(CITY_V0_PRESETS[0].city)
  const [cityCustom, setCityCustom] = useState('')
  const [numFloors, setNumFloors] = useState(8)
  const [floorHeight, setFloorHeight] = useState(2.88)

  // 2 — materiais
  const [fck, setFck] = useState(30_000)
  const [aggregate, setAggregate] = useState<Aggregate>('granito')
  const [caa, setCaa] = useState<CAA>('II')

  // 3 — vento
  const [windEnabled, setWindEnabled] = useState(true)
  const [v0, setV0] = useState(CITY_V0_PRESETS[0].v0)
  const [s1, setS1] = useState(1.0)
  const [category, setCategory] = useState<1 | 2 | 3 | 4 | 5>(4)
  const [s3Group, setS3Group] = useState<1 | 2 | 3 | 4 | 5>(2)

  const nameOk = name.trim().length > 0
  const cover = COVER_BY_CAA[caa]
  const cityLabel = cityChoice === OUTRA ? cityCustom.trim() : cityChoice

  const finish = () => {
    if (!nameOk) return
    newProject({
      name: name.trim(),
      author: author.trim() || undefined,
      city: cityLabel || undefined,
      fck,
      aggregate,
      caa,
      numFloors: Math.round(numFloors),
      floorHeight,
      wind: { enabled: windEnabled, v0, s1, category, s3Group },
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-header">
          Novo Projeto
          <button className="btn-icon" title="Cancelar" onClick={() => setWizardOpen(false)}>
            <IconClose size={16} />
          </button>
        </div>

        <StepIndicator step={step} />

        <div className="modal-body" style={{ minHeight: 264 }}>
          {step === 0 && (
            <>
              <div className="field">
                <label className="label">Nome da obra *</label>
                <input
                  className="input"
                  style={{ width: '100%', fontFamily: 'var(--sans)' }}
                  value={name}
                  autoFocus
                  spellCheck={false}
                  placeholder="Ex.: Edifício Residencial Aurora"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label">Autor / responsável</label>
                <input
                  className="input"
                  style={{ width: '100%', fontFamily: 'var(--sans)' }}
                  value={author}
                  spellCheck={false}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label">Cidade</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={cityChoice}
                  onChange={(e) => {
                    const v = e.target.value
                    setCityChoice(v)
                    const preset = CITY_V0_PRESETS.find((c) => c.city === v)
                    if (preset) setV0(preset.v0)
                  }}
                >
                  {CITY_V0_PRESETS.map((c) => (
                    <option key={c.city} value={c.city}>
                      {c.city}
                    </option>
                  ))}
                  <option value={OUTRA}>Outra…</option>
                </select>
                {cityChoice === OUTRA && (
                  <input
                    className="input"
                    style={{ width: '100%', marginTop: 6, fontFamily: 'var(--sans)' }}
                    value={cityCustom}
                    spellCheck={false}
                    placeholder="Nome da cidade"
                    onChange={(e) => setCityCustom(e.target.value)}
                  />
                )}
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="label">Nº de pavimentos (1–40)</label>
                  <NumberField
                    value={numFloors}
                    digits={0}
                    min={1}
                    max={40}
                    style={{ width: '100%' }}
                    onCommit={(v) => setNumFloors(Math.round(v))}
                  />
                </div>
                <div className="field">
                  <label className="label">Pé-direito (m)</label>
                  <NumberField
                    value={floorHeight}
                    digits={2}
                    trim={false}
                    min={2}
                    max={8}
                    style={{ width: '100%' }}
                    onCommit={(v) => setFloorHeight(v)}
                  />
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="field-row">
                <div className="field">
                  <label className="label">Classe do concreto (fck)</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={String(fck)}
                    onChange={(e) => setFck(Number(e.target.value))}
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
                    value={aggregate}
                    onChange={(e) => setAggregate(e.target.value as Aggregate)}
                  >
                    {AGGREGATE_OPTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="label">Classe de agressividade ambiental (CAA)</label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={caa}
                  onChange={(e) => setCaa(e.target.value as CAA)}
                >
                  {CAA_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label">Cobrimentos nominais (NBR 6118 tab. 7.2)</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="chip">laje {fmt(cm(cover.slab), 1)} cm</span>
                  <span className="chip">viga {fmt(cm(cover.beam), 1)} cm</span>
                  <span className="chip">pilar {fmt(cm(cover.column), 1)} cm</span>
                </div>
              </div>

              <div className="faint" style={{ fontSize: 11, marginTop: 12 }}>
                Aço: CA-50 (fyk 500 MPa, γs 1,15) — padrão do HyperFrame.
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  marginBottom: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={windEnabled}
                  onChange={(e) => setWindEnabled(e.target.checked)}
                />
                Considerar ação do vento (NBR 6123)
              </label>

              <div style={{ opacity: windEnabled ? 1 : 0.5 }}>
                <div className="field-row">
                  <div className="field">
                    <label className="label">V0 — velocidade básica (m/s)</label>
                    <NumberField
                      value={v0}
                      digits={1}
                      min={20}
                      max={70}
                      disabled={!windEnabled}
                      style={{ width: '100%' }}
                      onCommit={(v) => setV0(v)}
                    />
                  </div>
                  <div className="field">
                    <label className="label">S1 (topográfico)</label>
                    <NumberField
                      value={s1}
                      digits={2}
                      trim={false}
                      min={0.5}
                      max={1.5}
                      disabled={!windEnabled}
                      style={{ width: '100%' }}
                      onCommit={(v) => setS1(v)}
                    />
                  </div>
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: -4, marginBottom: 10 }}>
                  {cityLabel
                    ? `V0 sugerido para ${cityLabel} — valor aproximado, confira a isopleta.`
                    : 'Confira a isopleta da NBR 6123.'}
                </div>

                <div className="field">
                  <label className="label">Categoria de rugosidade do terreno</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    disabled={!windEnabled}
                    value={String(category)}
                    onChange={(e) => setCategory(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                  >
                    {WIND_CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={String(c.value)}>
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
                    disabled={!windEnabled}
                    value={String(s3Group)}
                    onChange={(e) => setS3Group(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                  >
                    {S3_GROUP_OPTIONS.map((g) => (
                      <option key={g.value} value={String(g.value)}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 2 ? (
            <button
              className="btn btn-primary"
              disabled={step === 0 && !nameOk}
              title={step === 0 && !nameOk ? 'Informe o nome da obra' : undefined}
              onClick={() => setStep(step + 1)}
            >
              Avançar
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!nameOk}
              title={!nameOk ? 'Informe o nome da obra' : undefined}
              onClick={finish}
            >
              Concluir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
